const Stripe = require('stripe');
const { ApiError } = require('../utils/api-error');

function createStripe(config) {
  if (!config.stripeSecretKey) return null;
  if (!config.stripeSecretKey.startsWith('sk_test_')) throw new Error('Only Stripe test-mode keys are allowed.');
  return new Stripe(config.stripeSecretKey, { appInfo: { name: 'Market Lane', version: '0.2.0' } });
}

function requireStripe(stripe) {
  if (!stripe) throw new ApiError(503, 'payments_not_configured', 'Stripe test mode is not configured.');
  return stripe;
}

async function createCheckoutSession(stripe, order, config) {
  requireStripe(stripe);
  const lineItems = [{
    quantity: 1,
    price_data: {
      currency: order.currency.toLowerCase(),
      unit_amount: order.totalMinor,
      product_data: { name: `Market Lane order ${order.orderNumber}`, description: `${order.items.length} marketplace item${order.items.length === 1 ? '' : 's'}` }
    }
  }];
  return stripe.checkout.sessions.create({
    mode: 'payment', line_items: lineItems,
    success_url: `${config.clientBaseUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.clientBaseUrl}/?checkout=cancelled`,
    expires_at: Math.floor(Date.now() / 1000) + 1800,
    billing_address_collection: 'required',
    shipping_address_collection: { allowed_countries: [order.shippingAddress.country] },
    automatic_tax: { enabled: Boolean(config.stripeTaxEnabled) },
    payment_intent_data: { transfer_group: order.orderNumber, metadata: { orderId: String(order._id), orderNumber: order.orderNumber } },
    metadata: { orderId: String(order._id), orderNumber: order.orderNumber, environment: 'test' }
  }, { idempotencyKey: `checkout:${order.checkoutKey}` });
}

async function createConnectAccount(stripe, profile, user) {
  requireStripe(stripe);
  return stripe.accounts.create({ type: 'express', country: profile.country, email: user.email, capabilities: { transfers: { requested: true } }, metadata: { vendorProfileId: String(profile._id) } }, { idempotencyKey: `connect:${profile._id}` });
}

async function createAccountLink(stripe, accountId, config) {
  requireStripe(stripe);
  return stripe.accountLinks.create({ account: accountId, refresh_url: `${config.clientBaseUrl}/?connect=refresh`, return_url: `${config.clientBaseUrl}/?connect=complete`, type: 'account_onboarding' });
}

async function createVendorTransfer(stripe, allocation, order, accountId) {
  requireStripe(stripe);
  if (!accountId) throw new ApiError(409, 'vendor_payout_not_configured');
  return stripe.transfers.create({
    amount: allocation.payoutAmountMinor,
    currency: allocation.payoutCurrency.toLowerCase(),
    destination: accountId,
    transfer_group: order.orderNumber,
    metadata: { orderNumber: order.orderNumber, allocationId: String(allocation._id), environment: 'test' }
  }, { idempotencyKey: `payout:${order._id}:${allocation._id}` });
}

module.exports = { createStripe, requireStripe, createCheckoutSession, createConnectAccount, createAccountLink, createVendorTransfer };
