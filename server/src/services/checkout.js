const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Product = require('../models/product');
const VendorProfile = require('../models/vendor-profile');
const Cart = require('../models/cart');
const Coupon = require('../models/coupon');
const Order = require('../models/order');
const { buildQuote } = require('./quote');
const { convertMinor } = require('./fx');
const { createCheckoutSession, requireStripe } = require('./stripe');
const { ApiError } = require('../utils/api-error');
const { writeAudit } = require('./audit');

function allocateDiscount(lines, discountMinor, commissionBps) {
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  let discountAssigned = 0;
  return lines.map((line, index) => {
    const lineDiscount = index === lines.length - 1 ? discountMinor - discountAssigned : Math.floor(discountMinor * line.lineTotalMinor / subtotal);
    discountAssigned += lineDiscount;
    const commissionMinor = Math.floor((line.lineTotalMinor - lineDiscount) * commissionBps / 10000);
    return { ...line, discountMinor: lineDiscount, commissionMinor };
  });
}

async function startCheckout({ user, body, idempotencyKey, config, stripe }) {
  requireStripe(stripe);
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey || '')) throw new ApiError(400, 'idempotency_key_required');
  if (!body?.address || typeof body.address !== 'object') throw new ApiError(400, 'shipping_address_required');
  const address = body.address;
  for (const field of ['firstName', 'lastName', 'line1', 'city', 'postalCode']) if (typeof address[field] !== 'string' || !address[field].trim() || address[field].length > 120) throw new ApiError(400, 'invalid_shipping_address');
  if (!['US', 'CA', 'GB'].includes(address.country)) throw new ApiError(400, 'unsupported_shipping_country');
  const cart = await Cart.findOne({ userId: user.id }).lean();
  if (!cart?.items?.length) throw new ApiError(400, 'cart_empty');
  const existing = await Order.findOne({ checkoutKey: idempotencyKey, customerId: user.id }).select('+checkoutUrl');
  if (existing) {
    if (existing.checkoutUrl) return { order: existing, checkoutUrl: existing.checkoutUrl, reused: true };
    throw new ApiError(409, 'checkout_already_in_progress');
  }
  const quote = await buildQuote({ cartItems: cart.items, country: address.country, couponCode: body.couponCode || '', config });
  const session = await mongoose.startSession();
  const orderId = new mongoose.Types.ObjectId();
  const orderNumber = `ML-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  let order;
  try {
    await session.withTransaction(async () => {
      const pricedLines = allocateDiscount(quote.lines, quote.discountMinor, config.commissionBps);
      for (const item of cart.items) {
        const changed = await Product.updateOne({ _id: item.productId, status: 'published', stock: { $gte: item.quantity } }, { $inc: { stock: -item.quantity } }, { session });
        if (changed.modifiedCount !== 1) throw new ApiError(409, 'insufficient_stock');
      }
      if (quote.coupon) {
        const criteria = { _id: quote.coupon._id, status: 'active' };
        if (quote.coupon.maxUses !== null && quote.coupon.maxUses !== undefined) criteria.$expr = { $lt: [{ $add: ['$usedCount', '$reservedCount'] }, quote.coupon.maxUses] };
        const reserved = await Coupon.updateOne(criteria, { $inc: { reservedCount: 1 } }, { session });
        if (reserved.modifiedCount !== 1) throw new ApiError(409, 'coupon_unavailable');
      }
      const allocations = await Promise.all(quote.vendorGroups.map(async (group) => {
        const assigned = group.itemIndexes.map((index) => pricedLines[index]);
        const itemGrossMinor = assigned.reduce((sum, item) => sum + item.lineTotalMinor - item.discountMinor, 0);
        const commissionMinor = assigned.reduce((sum, item) => sum + item.commissionMinor, 0);
        const itemNetMinor = itemGrossMinor - commissionMinor;
        const grossMinor = itemGrossMinor + group.shippingMinor;
        const netMinor = itemNetMinor + group.shippingMinor;
        const payout = await convertMinor(itemNetMinor, quote.currency, group.payoutCurrency, config);
        return { vendorId: group.vendorId, vendorName: group.vendorName, itemIndexes: group.itemIndexes, grossMinor, commissionMinor, netMinor, payoutAmountMinor: payout.amountMinor + group.baseShippingMinor, payoutCurrency: group.payoutCurrency, payoutFxRate: payout.rate, payoutFxProvider: payout.provider, payoutFxQuotedAt: payout.quotedAt, payoutStatus: 'held' };
      }));
      const fxSnapshot = [
        ...quote.fxRates.map(({ pair, rate, provider, quotedAt }) => ({ pair, rate, provider, quotedAt })),
        ...quote.vendorGroups.map((group) => ({ pair: `${group.baseCurrency}:${quote.currency}`, rate: group.shippingFxRate, provider: group.shippingFxProvider, quotedAt: group.shippingFxQuotedAt })),
        ...allocations.map((allocation) => ({ pair: `${quote.currency}:${allocation.payoutCurrency}`, rate: allocation.payoutFxRate, provider: allocation.payoutFxProvider, quotedAt: allocation.payoutFxQuotedAt }))
      ];
      order = new Order({
        _id: orderId, orderNumber, checkoutKey: idempotencyKey, customerId: user.id,
        customerSnapshot: { name: user.name, email: user.email },
        shippingAddress: { firstName: address.firstName.trim(), lastName: address.lastName.trim(), line1: address.line1.trim(), line2: String(address.line2 || '').trim(), city: address.city.trim(), region: String(address.region || '').trim(), postalCode: address.postalCode.trim(), country: address.country },
        items: pricedLines.map((item) => ({ productId: item.productId, vendorId: item.vendorId, vendorName: item.vendorName, name: item.name, quantity: item.quantity, baseUnitPriceMinor: item.baseUnitPriceMinor, baseCurrency: item.baseCurrency, unitPriceMinor: item.unitPriceMinor, currency: item.currency, fxRate: item.fxRate, fxProvider: item.fxProvider, fxQuotedAt: item.fxQuotedAt, commissionMinor: item.commissionMinor, imageKey: item.imageKey })),
        allocations, shippingAllocations: quote.vendorGroups.map((group) => ({ vendorId: group.vendorId, vendorName: group.vendorName, baseShippingMinor: group.baseShippingMinor, baseCurrency: group.baseCurrency, shippingMinor: group.shippingMinor, currency: quote.currency, fxRate: group.shippingFxRate, fxProvider: group.shippingFxProvider, fxQuotedAt: group.shippingFxQuotedAt })),
        currency: quote.currency, subtotalMinor: quote.subtotalMinor, discountMinor: quote.discountMinor,
        shippingMinor: quote.shippingMinor, taxMinor: 0, totalMinor: quote.totalMinor, commissionMinor: allocations.reduce((sum, item) => sum + item.commissionMinor, 0),
        couponId: quote.coupon?._id || null, couponSnapshot: quote.coupon ? { code: quote.coupon.code, percentOff: quote.coupon.percentOff } : undefined,
        fxSnapshot, reservationExpiresAt: new Date(Date.now() + 30 * 60 * 1000)
      });
      await order.save({ session });
      await writeAudit({ actorUserId: user.id, action: 'checkout.started', resourceType: 'order', resourceId: order._id, metadata: { currency: order.currency, totalMinor: order.totalMinor, mode: 'test' }, session });
    });
  } finally { await session.endSession(); }
  try {
    const stripeSession = await createCheckoutSession(stripe, order, config);
    order.stripeCheckoutSessionId = stripeSession.id;
    order.checkoutUrl = stripeSession.url;
    await order.save();
    return { order, checkoutUrl: stripeSession.url, reused: false };
  } catch (error) {
    await releaseReservation(order, 'checkout_session_failed');
    throw error;
  }
}

async function releaseReservation(order, reason) {
  const session = await mongoose.startSession();
  let released = false;
  try {
    await session.withTransaction(async () => {
      const claimed = await Order.findOneAndUpdate({ _id: order._id, paymentStatus: 'pending', status: 'pending_payment' }, { $set: { paymentStatus: 'failed', status: 'cancelled', cancelledAt: new Date(), reservationExpiresAt: null } }, { new: true, session });
      if (!claimed) return;
      for (const item of claimed.items) {
        const restored = await Product.updateOne({ _id: item.productId }, { $inc: { stock: item.quantity } }, { session });
        if (restored.matchedCount !== 1) throw new Error('Reserved product missing while releasing inventory.');
      }
      if (claimed.couponId) {
        const coupon = await Coupon.updateOne({ _id: claimed.couponId, reservedCount: { $gt: 0 } }, { $inc: { reservedCount: -1 } }, { session });
        if (coupon.modifiedCount !== 1) throw new Error('Coupon reservation missing while releasing checkout.');
      }
      await writeAudit({ action: `checkout.${reason}`, resourceType: 'order', resourceId: claimed._id, session });
      released = true;
    });
    return released;
  } finally { await session.endSession(); }
}

async function expireReservations() {
  const expired = await Order.find({ paymentStatus: 'pending', status: 'pending_payment', reservationExpiresAt: { $lte: new Date() } }).limit(100);
  for (const order of expired) await releaseReservation(order, 'checkout_expired');
  return expired.length;
}

module.exports = { startCheckout, releaseReservation, expireReservations };
