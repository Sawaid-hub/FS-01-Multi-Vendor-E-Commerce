const Order = require('../models/order');
const VendorProfile = require('../models/vendor-profile');
const { createVendorTransfer } = require('../services/stripe');

async function processDuePayouts({ stripe }) {
  if (!stripe) return { processed: 0, skipped: 'stripe_not_configured' };
  const orders = await Order.find({ paymentStatus: { $in: ['paid', 'partially_refunded'] }, status: { $in: ['delivered', 'partially_shipped'] }, 'allocations.payoutStatus': { $in: ['queued', 'failed'] }, 'allocations.payoutDueAt': { $lte: new Date() } }).limit(50);
  let processed = 0;
  for (const order of orders) {
    let changed = false;
    for (const allocation of order.allocations) {
      if (!['queued', 'failed'].includes(allocation.payoutStatus) || !allocation.payoutDueAt || allocation.payoutDueAt > new Date()) continue;
      if (['requested', 'approved', 'completed'].includes(allocation.returnStatus)) { allocation.payoutStatus = 'review'; allocation.payoutDueAt = null; changed = true; continue; }
      const vendor = await VendorProfile.findById(allocation.vendorId).select('+stripeAccountId');
      if (!vendor?.stripeAccountId || vendor.status !== 'active' || !vendor.stripeDetailsSubmitted || !vendor.stripeTransfersEnabled || !vendor.stripePayoutsEnabled) { allocation.payoutStatus = 'review'; allocation.payoutDueAt = null; changed = true; continue; }
      try {
        const transfer = await createVendorTransfer(stripe, allocation, order, vendor.stripeAccountId);
        allocation.stripeTransferId = transfer.id;
        allocation.payoutStatus = 'transferred';
      } catch (error) {
        allocation.payoutAttempts += 1;
        allocation.payoutStatus = allocation.payoutAttempts >= 5 ? 'review' : 'failed';
        console.error(JSON.stringify({ event: 'vendor_payout_failed', orderId: order.orderNumber, allocationId: String(allocation._id), code: error.code || 'stripe_error' }));
      }
      changed = true;
    }
    if (changed) { await order.save(); processed += 1; }
  }
  return { processed };
}

function startPayoutWorker({ stripe, intervalMs = 15 * 60 * 1000 }) {
  const timer = setInterval(() => processDuePayouts({ stripe }).catch((error) => console.error(JSON.stringify({ event: 'payout_worker_failed', errorType: error.name || 'Error', code: error.code || 'payout_worker_failed' }))), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { processDuePayouts, startPayoutWorker };
