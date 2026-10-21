const express = require('express');
const mongoose = require('mongoose');
const Order = require('../../models/order');
const Coupon = require('../../models/coupon');
const Cart = require('../../models/cart');
const WebhookEvent = require('../../models/webhook-event');
const { writeAudit } = require('../../services/audit');
const { releaseReservation } = require('../../services/checkout');
const { ApiError } = require('../../utils/api-error');

function createWebhookRouter(config, { stripe } = {}) {
  const router = express.Router();
  router.post('/payments/stripe', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    if (!stripe || !config.stripeWebhookSecret) throw new ApiError(503, 'stripe_webhook_not_configured');
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), config.stripeWebhookSecret); }
    catch { throw new ApiError(400, 'invalid_webhook_signature'); }
    let record;
    try { record = await WebhookEvent.create({ providerEventId: event.id, eventType: event.type, status: 'processing', lockExpiresAt: new Date(Date.now() + 60000), attempts: 1 }); }
    catch (error) {
      if (error.code !== 11000) throw error;
      record = await WebhookEvent.findOneAndUpdate({ providerEventId: event.id, status: { $ne: 'processed' }, $or: [{ lockExpiresAt: null }, { lockExpiresAt: { $lt: new Date() } }] }, { $set: { status: 'processing', eventType: event.type, lockExpiresAt: new Date(Date.now() + 60000), failedAt: null, failureCode: null }, $inc: { attempts: 1 } }, { new: true });
      if (!record) {
        const current = await WebhookEvent.findOne({ providerEventId: event.id });
        if (current?.status === 'processed') return res.json({ received: true, duplicate: true });
        return res.status(503).json({ error: { code: 'webhook_processing_in_progress', requestId: req.id } });
      }
    }
    try {
      await processStripeEvent(event, stripe);
      record.status = 'processed';
      record.processedAt = new Date();
      record.lockExpiresAt = null;
      record.failedAt = undefined;
      record.failureCode = undefined;
      await record.save();
      res.json({ received: true });
    } catch (error) {
      record.failedAt = new Date();
      record.status = 'failed';
      record.lockExpiresAt = null;
      record.failureCode = error.code || 'processing_failed';
      await record.save();
      console.error(JSON.stringify({ event: 'webhook_processing_failed', eventId: event.id, type: event.type, code: record.failureCode }));
      res.status(500).json({ error: { code: 'webhook_processing_failed', requestId: req.id } });
    }
  });
  return router;
}

async function processStripeEvent(event, stripe) {
  const payload = event.data.object;
  if (event.type === 'account.updated') {
    const VendorProfile = require('../../models/vendor-profile');
    const vendor = await VendorProfile.findOne({ stripeAccountId: payload.id }).select('+stripeAccountId');
    if (!vendor) return;
    vendor.stripeDetailsSubmitted = Boolean(payload.details_submitted);
    vendor.stripeTransfersEnabled = payload.capabilities?.transfers === 'active';
    vendor.stripePayoutsEnabled = Boolean(payload.payouts_enabled);
    await vendor.save();
    await writeAudit({ action: 'vendor.connect_capabilities_updated', resourceType: 'vendor', resourceId: vendor._id, metadata: { detailsSubmitted: vendor.stripeDetailsSubmitted, transfersEnabled: vendor.stripeTransfersEnabled, payoutsEnabled: vendor.stripePayoutsEnabled, mode: 'test' } });
    return;
  }
  if (['refund.created', 'refund.updated', 'refund.failed'].includes(event.type)) {
    await processAllocationRefund(payload, stripe);
    return;
  }
  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
    const order = await Order.findOne({ _id: payload.metadata?.orderId, stripeCheckoutSessionId: payload.id });
    if (!order) throw new Error('Order for Stripe checkout session not found');
    if (order.paymentStatus === 'paid') return;
    if (payload.payment_status !== 'paid') return;
    if (String(payload.currency || '').toUpperCase() !== order.currency || !Number.isInteger(payload.amount_total) || payload.amount_total < order.totalMinor) throw new Error('Stripe checkout amount or currency does not match the saved order');
    const address = payload.shipping_details?.address || payload.customer_details?.address;
    const updates = {
      paymentStatus: 'paid', status: 'placed', paidAt: new Date(),
      stripePaymentIntentId: typeof payload.payment_intent === 'string' ? payload.payment_intent : payload.payment_intent?.id,
      taxMinor: payload.total_details?.amount_tax || 0, totalMinor: payload.amount_total || order.totalMinor,
      reservationExpiresAt: null, 'allocations.$[].status': 'placed'
    };
    if (address) Object.assign(updates, {
      'shippingAddress.line1': address.line1 || order.shippingAddress.line1,
      'shippingAddress.line2': address.line2 || '', 'shippingAddress.city': address.city || order.shippingAddress.city,
      'shippingAddress.region': address.state || '', 'shippingAddress.postalCode': address.postal_code || order.shippingAddress.postalCode,
      'shippingAddress.country': address.country || order.shippingAddress.country
    });
    if (payload.customer_details?.email) updates['customerSnapshot.email'] = payload.customer_details.email;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const paid = await Order.findOneAndUpdate({ _id: order._id, paymentStatus: 'pending' }, { $set: updates }, { new: true, session });
        if (!paid) return;
        await Cart.updateOne({ userId: order.customerId }, { $set: { items: [] } }, { session });
        if (order.couponId) {
          const coupon = await Coupon.updateOne({ _id: order.couponId, reservedCount: { $gt: 0 } }, { $inc: { reservedCount: -1, usedCount: 1 } }, { session });
          if (coupon.modifiedCount !== 1) throw new Error('Coupon reservation missing while confirming payment.');
        }
        await writeAudit({ action: 'payment.paid', resourceType: 'order', resourceId: order._id, metadata: { paymentIntentId: paid.stripePaymentIntentId, mode: 'test' }, session });
      });
    } finally { await session.endSession(); }
    return;
  }
  if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
    const order = await Order.findOne({ stripeCheckoutSessionId: payload.id, paymentStatus: 'pending' });
    if (order) await releaseReservation(order, 'stripe_checkout_expired');
    return;
  }
  if (event.type === 'payment_intent.payment_failed') {
    const order = await Order.findOne({ _id: payload.metadata?.orderId, paymentStatus: 'pending' });
    if (order) await releaseReservation(order, 'stripe_payment_failed');
    return;
  }
  if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.updated') {
    const paymentIntentId = typeof payload.payment_intent === 'string' ? payload.payment_intent : payload.payment_intent?.id;
    const order = await Order.findOne({ stripePaymentIntentId: paymentIntentId });
    if (order) {
      order.paymentStatus = 'disputed';
      for (const allocation of order.allocations) allocation.payoutStatus = 'review';
      await order.save();
      await writeAudit({ action: 'payment.disputed', resourceType: 'order', resourceId: order._id, metadata: { disputeId: payload.id } });
    }
    return;
  }
  if (event.type === 'charge.refunded') {
    const paymentIntentId = typeof payload.payment_intent === 'string' ? payload.payment_intent : payload.payment_intent?.id;
    const order = await Order.findOne({ stripePaymentIntentId: paymentIntentId });
    if (!order) return;
    order.paymentStatus = payload.refunded && payload.amount_refunded >= payload.amount ? 'refunded' : 'partially_refunded';
    const allocationRefunds = (payload.refunds?.data || []).filter((refund) => refund.status === 'succeeded' && refund.metadata?.marketplaceOrderId === String(order._id) && refund.metadata?.allocationId);
    for (const refund of allocationRefunds) await processAllocationRefund(refund, stripe, order);
    const explicitRefundMinor = allocationRefunds.reduce((sum, refund) => sum + refund.amount, 0);
    const explicitAllocationIds = new Set(allocationRefunds.map((refund) => String(refund.metadata.allocationId)));
    for (const allocation of order.allocations) {
      if (allocation.returnStatus === 'completed' && allocation.refundStatus === 'succeeded') explicitAllocationIds.add(String(allocation._id));
      if (!explicitAllocationIds.has(String(allocation._id))) allocation.payoutStatus = 'review';
    }
    await order.save();
    const remainingRefund = Math.max(0, (payload.amount_refunded || payload.amount) - explicitRefundMinor);
    const remainingOriginal = Math.max(0, (payload.amount || order.totalMinor) - explicitRefundMinor);
    if (remainingRefund > 0 && remainingOriginal > 0) await reverseTransfers(order, stripe, remainingRefund, remainingOriginal, explicitAllocationIds);
    await writeAudit({ action: 'payment.refunded', resourceType: 'order', resourceId: order._id, metadata: { chargeId: payload.id, mode: 'test' } });
  }
}

async function processAllocationRefund(refund, stripe, existingOrder) {
  const orderId = refund.metadata?.marketplaceOrderId;
  const allocationId = refund.metadata?.allocationId;
  if (!orderId || !allocationId) return;
  const paymentIntentId = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id;
  const order = existingOrder || await Order.findOne({ _id: orderId, stripePaymentIntentId: paymentIntentId });
  const allocation = order?.allocations.id(allocationId);
  if (!order || String(order._id) !== orderId || !allocation || (paymentIntentId && order.stripePaymentIntentId !== paymentIntentId)) throw new Error('Marketplace allocation for Stripe refund was not found');
  if (allocation.refundStatus === 'succeeded' && allocation.returnStatus === 'completed' && (!allocation.stripeTransferId || allocation.reversedMinor >= allocation.payoutAmountMinor)) return;
  allocation.stripeRefundId = refund.id;
  allocation.refundAmountMinor = refund.amount;
  allocation.refundStatus = refund.status === 'failed' ? 'failed' : refund.status === 'succeeded' ? 'succeeded' : 'pending';
  if (refund.status === 'failed') {
    allocation.payoutStatus = 'review';
  } else if (refund.status === 'succeeded') {
    allocation.returnStatus = 'completed';
    await reverseAllocationTransfer(order, allocation, stripe, refund.id);
  }
  await order.save();
  if (refund.status === 'succeeded') await writeAudit({ action: 'return.refund_succeeded', resourceType: 'order', resourceId: order._id, metadata: { allocationId: String(allocation._id), refundId: refund.id, mode: 'test' } });
}

async function reverseAllocationTransfer(order, allocation, stripe, refundId) {
  if (!allocation.stripeTransferId) { allocation.payoutStatus = 'held'; return; }
  const amount = allocation.payoutAmountMinor - allocation.reversedMinor;
  if (amount <= 0) { allocation.payoutStatus = 'held'; return; }
  await stripe.transfers.createReversal(allocation.stripeTransferId, { amount }, { idempotencyKey: `return-reversal:${refundId}:${allocation._id}` });
  allocation.reversedMinor += amount;
  allocation.payoutStatus = 'held';
}

async function reverseTransfers(order, stripe, refundMinor, originalMinor, excludedAllocations = new Set()) {
  for (const allocation of order.allocations) {
    if (!allocation.stripeTransferId || excludedAllocations.has(String(allocation._id))) continue;
    const targetReversal = Math.min(allocation.payoutAmountMinor, Math.round(allocation.payoutAmountMinor * refundMinor / Math.max(originalMinor, 1)));
    const amount = targetReversal - allocation.reversedMinor;
    if (amount <= 0) continue;
    try {
      await stripe.transfers.createReversal(allocation.stripeTransferId, { amount }, { idempotencyKey: `refund-reversal:${order._id}:${allocation._id}:${targetReversal}` });
      allocation.reversedMinor = targetReversal;
      allocation.payoutStatus = targetReversal >= allocation.payoutAmountMinor ? 'held' : 'review';
    } catch (error) {
      allocation.payoutStatus = 'review';
      throw error;
    }
  }
  await order.save();
}

module.exports = createWebhookRouter;
module.exports.processStripeEvent = processStripeEvent;
