const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorProfile', required: true },
  vendorName: { type: String, required: true }, name: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  baseUnitPriceMinor: { type: Number, required: true }, baseCurrency: { type: String, required: true },
  unitPriceMinor: { type: Number, required: true }, currency: { type: String, required: true },
  commissionMinor: { type: Number, required: true, min: 0 }, imageKey: String,
  fxRate: { type: Number, required: true }, fxProvider: String, fxQuotedAt: Date
}, { _id: false });

const allocationSchema = new mongoose.Schema({
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorProfile', required: true },
  vendorName: { type: String, required: true }, itemIndexes: [{ type: Number }],
  grossMinor: { type: Number, required: true }, commissionMinor: { type: Number, required: true }, netMinor: { type: Number, required: true },
  payoutAmountMinor: { type: Number, required: true }, payoutCurrency: { type: String, required: true }, payoutFxRate: Number, payoutFxProvider: String,
  payoutFxQuotedAt: Date,
  status: { type: String, enum: ['placed', 'packed', 'shipped', 'delivered'], default: 'placed' },
  trackingNumber: { type: String, default: '' }, carrier: { type: String, default: '' }, deliveredAt: Date,
  deliveryConfirmedAt: Date, deliveryConfirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  returnStatus: { type: String, enum: ['none', 'requested', 'approved', 'rejected', 'completed'], default: 'none' },
  returnRequestedAt: Date, returnReason: { type: String, maxlength: 500, default: '' },
  stripeRefundId: String, refundStatus: { type: String, enum: ['none', 'pending', 'succeeded', 'failed'], default: 'none' },
  refundAmountMinor: { type: Number, min: 0, default: 0 }, refundAttempts: { type: Number, min: 0, default: 0 },
  payoutStatus: { type: String, enum: ['held', 'queued', 'transferred', 'failed', 'review'], default: 'held' },
  payoutDueAt: Date, stripeTransferId: String, reversedMinor: { type: Number, default: 0 }, payoutAttempts: { type: Number, default: 0 }
}, { _id: true });

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true, index: true },
  checkoutKey: { type: String, required: true, unique: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  customerSnapshot: { name: String, email: String },
  shippingAddress: { firstName: String, lastName: String, line1: String, line2: String, city: String, region: String, postalCode: String, country: { type: String, enum: ['US', 'CA', 'GB'] } },
  items: [orderItemSchema], allocations: [allocationSchema],
  shippingAllocations: [{ vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorProfile' }, vendorName: String, baseShippingMinor: Number, baseCurrency: String, shippingMinor: Number, currency: String, fxRate: Number, fxProvider: String, fxQuotedAt: Date }],
  currency: { type: String, enum: ['USD', 'CAD', 'GBP'], required: true },
  subtotalMinor: { type: Number, required: true }, discountMinor: { type: Number, default: 0 },
  shippingMinor: { type: Number, default: 0 }, taxMinor: { type: Number, default: 0 }, totalMinor: { type: Number, required: true },
  couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', default: null },
  couponSnapshot: { code: String, percentOff: Number },
  fxSnapshot: [{ pair: String, rate: Number, provider: String, quotedAt: Date }],
  commissionMinor: { type: Number, required: true },
  status: { type: String, enum: ['pending_payment', 'placed', 'partially_shipped', 'shipped', 'delivered', 'cancelled'], default: 'pending_payment', index: true },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'partially_refunded', 'failed', 'refunded', 'disputed'], default: 'pending', index: true },
  stripeCheckoutSessionId: { type: String, default: null, index: true }, stripePaymentIntentId: { type: String, default: null },
  checkoutUrl: { type: String, default: null, select: false },
  reservationExpiresAt: { type: Date, default: null },
  paidAt: Date, cancelledAt: Date
}, { timestamps: true, versionKey: false });

orderSchema.index({ customerId: 1, createdAt: -1 });
orderSchema.index({ 'allocations.vendorId': 1, createdAt: -1 });
orderSchema.index({ 'allocations.payoutStatus': 1, 'allocations.payoutDueAt': 1 });

module.exports = mongoose.model('Order', orderSchema);
