const express = require('express');
const VendorProfile = require('../../models/vendor-profile');
const Product = require('../../models/product');
const Order = require('../../models/order');
const Coupon = require('../../models/coupon');
const AuditEvent = require('../../models/audit-event');
const { requireRole } = require('../../middleware/auth');
const { ApiError } = require('../../utils/api-error');
const { writeAudit } = require('../../services/audit');
const { orderResponse } = require('../marketplace/serializers');
const { persistProductWithSearchEvent } = require('../../services/search');

function createAdminRouter(config, dependencies = {}) {
  const router = express.Router();
  router.use(requireRole('admin'));

  router.get('/overview', async (_req, res) => {
    const [orders, vendors, products, pendingVendors, paidOrders] = await Promise.all([
      Order.countDocuments(), VendorProfile.countDocuments({ status: 'active' }), Product.countDocuments({ status: 'published' }),
      VendorProfile.countDocuments({ status: 'pending' }), Order.find({ paymentStatus: 'paid' }).select('totalMinor commissionMinor currency').lean()
    ]);
    const currencies = {};
    for (const order of paidOrders) {
      currencies[order.currency] ||= { grossMinor: 0, commissionMinor: 0 };
      currencies[order.currency].grossMinor += order.totalMinor;
      currencies[order.currency].commissionMinor += order.commissionMinor;
    }
    res.json({ data: { orderCount: orders, activeVendors: vendors, activeProducts: products, pendingApplications: pendingVendors, paidSalesByCurrency: currencies, paymentMode: 'test' } });
  });

  router.get('/vendor-applications', async (req, res) => {
    const status = ['pending', 'active', 'rejected', 'suspended'].includes(req.query.status) ? req.query.status : undefined;
    const filter = status ? { status } : {};
    const vendors = await VendorProfile.find(filter).populate('ownerUserId', 'name email').sort({ createdAt: -1 }).limit(200).lean();
    res.json({ data: vendors.map((vendor) => ({ id: String(vendor._id), shopName: vendor.shopName, slug: vendor.slug, description: vendor.description, contactEmail: vendor.contactEmail, country: vendor.country, currency: vendor.currency, status: vendor.status, createdAt: vendor.createdAt, owner: { id: String(vendor.ownerUserId?._id || ''), name: vendor.ownerUserId?.name || '', email: vendor.ownerUserId?.email || '' }, moderation: vendor.moderation })) });
  });
  router.patch('/vendors/:vendorId/status', async (req, res) => {
    const status = req.body?.status;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
    if (!['active', 'rejected', 'suspended'].includes(status)) throw new ApiError(400, 'invalid_vendor_status');
    if (status !== 'active' && reason.length < 4) throw new ApiError(400, 'moderation_reason_required');
    const profile = await VendorProfile.findById(req.params.vendorId);
    if (!profile) throw new ApiError(404, 'vendor_not_found');
    profile.status = status;
    profile.moderation = { actorUserId: req.user.id, reason, at: new Date() };
    await profile.save();
    await writeAudit({ actorUserId: req.user.id, action: `vendor.${status}`, resourceType: 'vendor', resourceId: profile._id, reason });
    res.json({ data: { id: String(profile._id), shopName: profile.shopName, status: profile.status } });
  });

  router.get('/products', async (req, res) => {
    const filter = {};
    if (['draft', 'published', 'unpublished', 'archived', 'flagged'].includes(req.query.status)) filter.status = req.query.status;
    const products = await Product.find(filter).populate('vendorId', 'shopName slug status').sort({ createdAt: -1 }).limit(200).lean();
    res.json({ data: products.map((product) => ({ id: String(product._id), name: product.name, productType: product.productType, category: product.category, priceMinor: product.priceMinor, currency: product.currency, stock: product.stock, status: product.status, vendor: product.vendorId?.shopName || '', vendorId: String(product.vendorId?._id || ''), vendorStatus: product.vendorId?.status || '' })) });
  });
  router.patch('/products/:productId/status', async (req, res) => {
    const status = req.body?.status;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
    if (!['published', 'unpublished', 'archived', 'flagged'].includes(status)) throw new ApiError(400, 'invalid_product_status');
    if (['unpublished', 'archived', 'flagged'].includes(status) && reason.length < 4) throw new ApiError(400, 'moderation_reason_required');
    const product = await Product.findById(req.params.productId);
    if (!product) throw new ApiError(404, 'product_not_found');
    if (status === 'published') {
      const vendor = await VendorProfile.findOne({ _id: product.vendorId, status: 'active' });
      if (!vendor) throw new ApiError(409, 'active_vendor_required');
    }
    product.status = status;
    await persistProductWithSearchEvent(product, { config });
    await writeAudit({ actorUserId: req.user.id, action: `product.${status}`, resourceType: 'product', resourceId: product._id, reason });
    res.json({ data: { id: String(product._id), status: product.status } });
  });

  router.get('/orders', async (req, res) => {
    const filter = {};
    if (['pending', 'paid', 'partially_refunded', 'failed', 'refunded', 'disputed'].includes(req.query.paymentStatus)) filter.paymentStatus = req.query.paymentStatus;
    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json({ data: orders.map((order) => orderResponse(order, { admin: true })) });
  });
  router.patch('/orders/:orderNumber/allocations/:allocationId/delivery', async (req, res) => {
    const decision = req.body?.decision;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
    if (!['confirmed', 'review'].includes(decision)) throw new ApiError(400, 'invalid_delivery_decision');
    if (decision === 'review' && reason.length < 4) throw new ApiError(400, 'review_reason_required');
    const order = await Order.findOne({ orderNumber: req.params.orderNumber });
    const allocation = order?.allocations.id(req.params.allocationId);
    if (!order || !allocation) throw new ApiError(404, 'allocation_not_found');
    if (allocation.status !== 'delivered') throw new ApiError(409, 'vendor_delivery_required');
    if (allocation.stripeTransferId) throw new ApiError(409, 'payout_already_transferred');
    if (decision === 'confirmed') {
      if (!['paid', 'partially_refunded'].includes(order.paymentStatus)) throw new ApiError(409, 'paid_order_required');
      if (['requested', 'approved', 'completed'].includes(allocation.returnStatus)) throw new ApiError(409, 'return_review_blocks_payout');
      if (allocation.deliveryConfirmedAt) {
        if (allocation.payoutStatus === 'review' && !allocation.stripeTransferId) {
          allocation.payoutDueAt = new Date(Math.max(Date.now(), allocation.deliveryConfirmedAt.getTime() + 30 * 86400000));
          allocation.payoutStatus = 'queued';
          await order.save();
          await writeAudit({ actorUserId: req.user.id, action: 'payout.requeued', resourceType: 'order', resourceId: order._id, reason, metadata: { allocationId: String(allocation._id), payoutDueAt: allocation.payoutDueAt } });
        }
        return res.json({ data: { orderNumber: order.orderNumber, allocationId: String(allocation._id), status: allocation.payoutStatus, payoutDueAt: allocation.payoutDueAt } });
      }
      allocation.deliveryConfirmedAt = new Date();
      allocation.deliveryConfirmedBy = req.user.id;
      allocation.payoutDueAt = new Date(allocation.deliveryConfirmedAt.getTime() + 30 * 86400000);
      allocation.payoutStatus = 'queued';
    } else {
      allocation.deliveryConfirmedAt = null;
      allocation.deliveryConfirmedBy = null;
      allocation.payoutDueAt = null;
      allocation.payoutStatus = 'review';
    }
    await order.save();
    await writeAudit({ actorUserId: req.user.id, action: `delivery.${decision}`, resourceType: 'order', resourceId: order._id, reason, metadata: { allocationId: String(allocation._id), payoutDueAt: allocation.payoutDueAt } });
    res.json({ data: { orderNumber: order.orderNumber, allocationId: String(allocation._id), status: allocation.payoutStatus, deliveryConfirmedAt: allocation.deliveryConfirmedAt, payoutDueAt: allocation.payoutDueAt } });
  });
  router.patch('/orders/:orderNumber/allocations/:allocationId/return', async (req, res) => {
    const decision = req.body?.decision;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
    if (!['approved', 'rejected'].includes(decision)) throw new ApiError(400, 'invalid_return_decision');
    if (reason.length < 4) throw new ApiError(400, 'return_review_reason_required');
    const order = await Order.findOne({ orderNumber: req.params.orderNumber });
    const allocation = order?.allocations.id(req.params.allocationId);
    if (!order || !allocation) throw new ApiError(404, 'allocation_not_found');
    if (allocation.returnStatus !== 'requested') throw new ApiError(409, 'return_not_pending');
    if (decision === 'approved' && !dependencies.stripe?.refunds?.create) throw new ApiError(503, 'refunds_not_configured');
    allocation.returnStatus = decision;
    if (decision === 'rejected' && allocation.stripeTransferId) {
      allocation.payoutStatus = 'transferred';
    } else if (decision === 'rejected' && ['paid', 'partially_refunded'].includes(order.paymentStatus) && allocation.deliveryConfirmedAt) {
      allocation.payoutDueAt = new Date(allocation.deliveryConfirmedAt.getTime() + 30 * 86400000);
      allocation.payoutStatus = 'queued';
    } else allocation.payoutStatus = 'review';
    await order.save();
    await writeAudit({ actorUserId: req.user.id, action: `return.${decision}`, resourceType: 'order', resourceId: order._id, reason, metadata: { allocationId: String(allocation._id) } });
    if (decision === 'approved') await requestReturnRefund(order._id, allocation._id, dependencies.stripe);
    const refreshed = decision === 'approved' ? await Order.findById(order._id) : order;
    const finalAllocation = refreshed.allocations.id(allocation._id);
    res.json({ data: { orderNumber: refreshed.orderNumber, allocationId: String(finalAllocation._id), returnStatus: finalAllocation.returnStatus, refundStatus: finalAllocation.refundStatus, refundAmountMinor: finalAllocation.refundAmountMinor, payoutStatus: finalAllocation.payoutStatus, payoutDueAt: finalAllocation.payoutDueAt } });
  });
  router.post('/orders/:orderNumber/allocations/:allocationId/return/refund', async (req, res) => {
    const order = await Order.findOne({ orderNumber: req.params.orderNumber });
    const allocation = order?.allocations.id(req.params.allocationId);
    if (!order || !allocation) throw new ApiError(404, 'allocation_not_found');
    if (allocation.returnStatus !== 'approved' || !['failed', 'pending'].includes(allocation.refundStatus)) throw new ApiError(409, 'refund_retry_not_available');
    if (!dependencies.stripe?.refunds?.create) throw new ApiError(503, 'refunds_not_configured');
    await requestReturnRefund(order._id, allocation._id, dependencies.stripe);
    const refreshed = await Order.findById(order._id);
    const finalAllocation = refreshed.allocations.id(allocation._id);
    await writeAudit({ actorUserId: req.user.id, action: 'return.refund_retry', resourceType: 'order', resourceId: order._id, metadata: { allocationId: String(allocation._id), refundStatus: finalAllocation.refundStatus } });
    res.json({ data: { orderNumber: refreshed.orderNumber, allocationId: String(finalAllocation._id), returnStatus: finalAllocation.returnStatus, refundStatus: finalAllocation.refundStatus, refundAmountMinor: finalAllocation.refundAmountMinor, payoutStatus: finalAllocation.payoutStatus } });
  });
  router.get('/payments', async (_req, res) => {
    const orders = await Order.find({ stripeCheckoutSessionId: { $ne: null } }).select('orderNumber currency totalMinor paymentStatus stripeCheckoutSessionId stripePaymentIntentId createdAt').sort({ createdAt: -1 }).limit(200).lean();
    res.json({ data: orders.map((order) => ({ orderNumber: order.orderNumber, currency: order.currency, amountMinor: order.totalMinor, status: order.paymentStatus, provider: 'stripe', mode: 'test', checkoutSessionId: order.stripeCheckoutSessionId, paymentIntentId: order.stripePaymentIntentId, createdAt: order.createdAt })) });
  });

  router.post('/coupons', async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    const percentOff = Number(req.body?.percentOff);
    const maxUses = req.body?.maxUses === undefined || req.body.maxUses === null || req.body.maxUses === '' ? null : Number(req.body.maxUses);
    const minimumSubtotalMinor = req.body?.minimumSubtotalMinor === undefined ? 0 : Number(req.body.minimumSubtotalMinor);
    if (!/^[A-Z0-9_-]{4,24}$/.test(code) || !Number.isInteger(percentOff) || percentOff < 1 || percentOff > 80 || (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) || !Number.isInteger(minimumSubtotalMinor) || minimumSubtotalMinor < 0) throw new ApiError(400, 'invalid_coupon');
    const startsAt = req.body?.startsAt ? new Date(req.body.startsAt) : new Date();
    const endsAt = req.body?.endsAt ? new Date(req.body.endsAt) : undefined;
    if (!Number.isFinite(startsAt.getTime()) || (endsAt && (!Number.isFinite(endsAt.getTime()) || endsAt <= startsAt))) throw new ApiError(400, 'invalid_coupon_dates');
    const coupon = await Coupon.create({ code, percentOff, maxUses, minimumSubtotalMinor, startsAt, endsAt, description: typeof req.body.description === 'string' ? req.body.description.trim().slice(0, 240) : '' });
    await writeAudit({ actorUserId: req.user.id, action: 'coupon.created', resourceType: 'coupon', resourceId: coupon._id });
    res.status(201).json({ data: couponResponse(coupon) });
  });
  router.get('/coupons', async (_req, res) => {
    const coupons = await Coupon.find().sort({ createdAt: -1 }).limit(200).lean();
    res.json({ data: coupons.map(couponResponse) });
  });
  router.patch('/coupons/:couponId', async (req, res) => {
    const status = req.body?.status;
    if (!['active', 'paused', 'expired'].includes(status)) throw new ApiError(400, 'invalid_coupon_status');
    const coupon = await Coupon.findByIdAndUpdate(req.params.couponId, { $set: { status } }, { new: true, runValidators: true });
    if (!coupon) throw new ApiError(404, 'coupon_not_found');
    await writeAudit({ actorUserId: req.user.id, action: `coupon.${status}`, resourceType: 'coupon', resourceId: coupon._id });
    res.json({ data: couponResponse(coupon) });
  });

  router.get('/audit-events', async (req, res) => {
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
    const events = await AuditEvent.find().sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50).populate('actorUserId', 'name email').lean();
    res.json({ data: events.map((event) => ({ id: String(event._id), actor: event.actorUserId ? { id: String(event.actorUserId._id), name: event.actorUserId.name, email: event.actorUserId.email } : null, action: event.action, resourceType: event.resourceType, resourceId: event.resourceId, reason: event.reason, metadata: event.metadata, createdAt: event.createdAt })), meta: { page, limit: 50 } });
  });
  return router;
}

async function requestReturnRefund(orderId, allocationId, stripe) {
  const order = await Order.findById(orderId);
  const allocation = order?.allocations.id(allocationId);
  if (!order || !allocation || !['paid', 'partially_refunded'].includes(order.paymentStatus) || !order.stripePaymentIntentId) throw new ApiError(409, 'paid_order_required_for_refund');
  if (allocation.refundStatus === 'succeeded') return allocation;
  if (allocation.refundStatus === 'failed') allocation.refundAttempts = (allocation.refundAttempts || 0) + 1;
  else if (!allocation.refundAttempts) allocation.refundAttempts = 1;
  const preTaxTotal = order.allocations.reduce((sum, item) => sum + item.grossMinor, 0);
  const taxShare = preTaxTotal > 0 ? Math.floor((order.taxMinor || 0) * allocation.grossMinor / preTaxTotal) : 0;
  allocation.refundAmountMinor = allocation.grossMinor + taxShare;
  if (!Number.isInteger(allocation.refundAmountMinor) || allocation.refundAmountMinor < 1) throw new ApiError(409, 'refund_amount_unavailable');
  allocation.refundStatus = 'pending';
  await order.save();
  const attempt = allocation.refundAttempts;
  let refund;
  try {
    refund = await stripe.refunds.create({
      payment_intent: order.stripePaymentIntentId,
      amount: allocation.refundAmountMinor,
      reason: 'requested_by_customer',
      metadata: { marketplaceOrderId: String(order._id), orderNumber: order.orderNumber, allocationId: String(allocation._id), environment: 'test' }
    }, { idempotencyKey: `return-refund:${order._id}:${allocation._id}:${attempt}` });
  } catch {
    // Keep this attempt pending: retry with the same idempotency key so a timed-out
    // provider request cannot create a duplicate refund.
    throw new ApiError(503, 'refund_provider_unavailable');
  }
  const latestOrder = await Order.findById(order._id);
  const latestAllocation = latestOrder?.allocations.id(allocation._id);
  if (!latestOrder || !latestAllocation) throw new ApiError(404, 'allocation_not_found');
  const signedEventAlreadyUpdated = latestAllocation.stripeRefundId === refund.id && latestAllocation.refundStatus !== 'none';
  latestAllocation.stripeRefundId = refund.id;
  if (!signedEventAlreadyUpdated) latestAllocation.refundStatus = refund.status === 'failed' ? 'failed' : 'pending';
  await latestOrder.save();
  return latestAllocation;
}

function couponResponse(coupon) {
  const item = coupon.toObject ? coupon.toObject() : coupon;
  return { id: String(item._id), code: item.code, percentOff: item.percentOff, description: item.description, status: item.status, usedCount: item.usedCount, reservedCount: item.reservedCount, maxUses: item.maxUses, startsAt: item.startsAt, endsAt: item.endsAt, minimumSubtotalMinor: item.minimumSubtotalMinor };
}

module.exports = createAdminRouter;
