function orderResponse(order, { admin = false, customer = false } = {}) {
  const obj = order.toObject ? order.toObject() : order;
  return {
    id: String(obj._id), orderNumber: obj.orderNumber, customer: obj.customerSnapshot?.name || '', email: admin || customer ? obj.customerSnapshot?.email : undefined,
    currency: obj.currency, subtotalMinor: obj.subtotalMinor, discountMinor: obj.discountMinor, shippingMinor: obj.shippingMinor, taxMinor: obj.taxMinor, totalMinor: obj.totalMinor,
    subtotal: obj.subtotalMinor / 100, discount: obj.discountMinor / 100, total: obj.totalMinor / 100,
    status: obj.status, paymentStatus: obj.paymentStatus, payment: obj.paymentStatus === 'paid' ? 'Stripe test · paid' : `Stripe test · ${obj.paymentStatus}`,
    commissionMinor: obj.commissionMinor, commission: obj.commissionMinor / 100, createdAt: obj.createdAt,
    date: obj.createdAt ? new Date(obj.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '',
    items: obj.items.map((item) => ({ productId: String(item.productId), vendorId: String(item.vendorId), vendor: item.vendorName, name: item.name, priceMinor: item.unitPriceMinor, currency: item.currency, price: item.unitPriceMinor / 100, quantity: item.quantity, imageKey: item.imageKey })),
    allocations: obj.allocations.map((allocation) => ({ id: String(allocation._id), vendorId: String(allocation.vendorId), vendor: allocation.vendorName, status: allocation.status, trackingNumber: allocation.trackingNumber, carrier: allocation.carrier, deliveredAt: allocation.deliveredAt, deliveryConfirmedAt: allocation.deliveryConfirmedAt, returnStatus: allocation.returnStatus || 'none', returnRequestedAt: allocation.returnRequestedAt, returnReason: admin ? allocation.returnReason : undefined, refundStatus: allocation.refundStatus || 'none', refundAmountMinor: allocation.refundAmountMinor || 0, payoutStatus: allocation.payoutStatus, payoutDueAt: allocation.payoutDueAt, grossMinor: allocation.grossMinor, commissionMinor: allocation.commissionMinor, netMinor: allocation.netMinor, payoutAmountMinor: allocation.payoutAmountMinor, payoutCurrency: allocation.payoutCurrency }))
  };
}

module.exports = { orderResponse };
