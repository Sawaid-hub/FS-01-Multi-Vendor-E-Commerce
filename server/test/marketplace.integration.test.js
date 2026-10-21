const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Stripe = require('stripe');
const User = require('../src/models/user');
const VendorProfile = require('../src/models/vendor-profile');
const Product = require('../src/models/product');
const Cart = require('../src/models/cart');
const Order = require('../src/models/order');
const Coupon = require('../src/models/coupon');
const AuditEvent = require('../src/models/audit-event');
const WebhookEvent = require('../src/models/webhook-event');
const createApp = require('../src/app');
const { startCheckout } = require('../src/services/checkout');
const { processDuePayouts } = require('../src/jobs/payouts');
const { signAccessToken } = require('../src/utils/tokens');

const mongoUri = process.env.MONGODB_TEST_URI || '';
const runDisposableMongo = process.env.RUN_DISPOSABLE_DB_TESTS === 'true' && Boolean(mongoUri);
const webhookSecret = 'whsec_disposable_test_secret';
const config = {
  nodeEnv: 'test', mongoUri: 'mongodb://127.0.0.1/market-lane-test', port: 0,
  jwtSecret: 'integration-jwt-secret-01234567890123456789',
  refreshSecret: 'integration-refresh-secret-012345678901234567',
  refreshTokenDays: 1, commissionBps: 1000, allowedOrigins: ['http://localhost:5173'],
  cookieSecure: false, cookieSameSite: 'lax', clientBaseUrl: 'http://localhost:5173',
  stripeSecretKey: 'sk_test_disposable_integration_key', stripeWebhookSecret: webhookSecret,
  stripeTaxEnabled: false, fxRatesOverride: JSON.stringify({ USD: { CAD: 1.35, GBP: 0.8 } }),
  fxApiUrl: 'https://unused.invalid/latest', searchProvider: 'mongodb'
};

test('disposable replica-set MongoDB checkout and signed Stripe webhook integration', { skip: !runDisposableMongo }, async (t) => {
  const parsedUri = new URL(mongoUri);
  const databaseName = parsedUri.pathname.replace(/^\//, '').split('/')[0];
  if (!/(^|[-_])test$/i.test(databaseName)) throw new Error('MONGODB_TEST_URI must name a disposable database ending in test.');
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  await mongoose.connection.dropDatabase();
  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  const stripe = new Stripe(config.stripeSecretKey);
  let sessionNumber = 0;
  let failNextSession = false;
  let transferCreates = 0;
  let reversalAmount = 0;
  let refundCreates = 0;
  let lastRefundRequest;
  stripe.checkout.sessions.create = async () => {
    if (failNextSession) { failNextSession = false; throw Object.assign(new Error('test checkout session failure'), { code: 'checkout_session_failed' }); }
    sessionNumber += 1;
    return { id: `cs_test_market_${sessionNumber}`, url: `https://checkout.stripe.test/session/${sessionNumber}` };
  };
  stripe.transfers.create = async () => { transferCreates += 1; return { id: `tr_test_${transferCreates}` }; };
  stripe.transfers.createReversal = async (_id, payload) => { reversalAmount += payload.amount; return { id: 'trr_test_1' }; };
  stripe.refunds.create = async (payload) => { refundCreates += 1; lastRefundRequest = payload; return { id: `re_test_${refundCreates}`, status: 'succeeded', amount: payload.amount, payment_intent: payload.payment_intent, metadata: payload.metadata }; };

  const app = createApp(config, { stripe });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const apiUrl = `http://127.0.0.1:${server.address().port}`;

  async function addUser(email, role = 'customer') {
    return User.create({ name: email.split('@')[0], email, passwordHash: 'integration-only-hash', role, status: 'active', emailVerifiedAt: new Date() });
  }
  async function addProduct(vendorId, slug, stock = 10) {
    return Product.create({ vendorId, name: `Product ${slug}`, slug, productType: 'Ceramic bowl', description: 'A useful handmade item for a test market.', category: 'Home', priceMinor: 1000, currency: 'USD', stock, status: 'published' });
  }
  async function addCart(userId, productId, quantity = 1) {
    return Cart.create({ userId, items: [{ productId, quantity }] });
  }
  async function begin(user, idempotencyKey, couponCode = '') {
    return startCheckout({
      user: { id: String(user._id), name: user.name, email: user.email },
      idempotencyKey,
      config,
      stripe,
      body: { couponCode, address: { firstName: 'Test', lastName: 'Buyer', line1: '1 Test Street', city: 'Test City', postalCode: '10001', country: 'US' } }
    });
  }
  async function sendStripeEvent(event) {
    const payload = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    return fetch(`${apiUrl}/api/v1/webhooks/payments/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body: payload });
  }
  async function apiRequest(path, { method = 'GET', token, body } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    return fetch(`${apiUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  const owner = await addUser('maker@marketlane.test', 'vendor');
  const adminUser = await addUser('admin@marketlane.test', 'admin');
  const adminToken = signAccessToken(adminUser, config);
  const vendor = await VendorProfile.create({ ownerUserId: owner._id, shopName: 'Test Maker', slug: 'test-maker', description: 'A verified disposable integration seller.', contactEmail: owner.email, country: 'US', currency: 'USD', shippingFeeMinor: 500, status: 'active', stripeAccountId: 'acct_test_vendor' });
  const otherOwner = await addUser('other-maker@marketlane.test', 'vendor');
  const otherVendor = await VendorProfile.create({ ownerUserId: otherOwner._id, shopName: 'Other Maker', slug: 'other-maker', description: 'A second disposable integration seller.', contactEmail: otherOwner.email, country: 'US', currency: 'USD', shippingFeeMinor: 500, status: 'active', stripeAccountId: 'acct_test_other', stripeDetailsSubmitted: true, stripeTransfersEnabled: true, stripePayoutsEnabled: true });
  const connectEvent = { id: 'evt_test_account_updated', type: 'account.updated', data: { object: { id: 'acct_test_vendor', details_submitted: true, capabilities: { transfers: 'active' }, payouts_enabled: true } } };
  assert.equal((await sendStripeEvent(connectEvent)).status, 200);
  const connectedVendor = await VendorProfile.findById(vendor._id);
  assert.equal(connectedVendor.stripeDetailsSubmitted, true);
  assert.equal(connectedVendor.stripeTransfersEnabled, true);
  assert.equal(connectedVendor.stripePayoutsEnabled, true);
  const primaryProduct = await addProduct(vendor._id, 'primary-test-product', 8);
  const coupon = await Coupon.create({ code: 'ONEUSE', percentOff: 10, maxUses: 1, usedCount: 0, reservedCount: 0, startsAt: new Date(Date.now() - 1000), status: 'active' });
  const buyer = await addUser('buyer@marketlane.test');
  await addCart(buyer._id, primaryProduct._id, 2);

  const started = await begin(buyer, 'integration-checkout-001', coupon.code);
  assert.equal(started.order.currency, 'USD');
  assert.equal(started.order.items[0].unitPriceMinor, 1000);
  assert.equal(started.order.subtotalMinor, 2000);
  assert.equal(started.order.discountMinor, 200);
  assert.equal(started.order.totalMinor, 2300);
  assert.equal((await Product.findById(primaryProduct._id)).stock, 6);
  assert.equal((await Coupon.findById(coupon._id)).reservedCount, 1);
  const reused = await begin(buyer, 'integration-checkout-001', coupon.code);
  assert.equal(reused.reused, true);
  assert.equal(sessionNumber, 1);

  const successEvent = { id: 'evt_test_checkout_paid_1', type: 'checkout.session.completed', data: { object: {
    id: started.order.stripeCheckoutSessionId, metadata: { orderId: String(started.order._id) },
    payment_status: 'paid', currency: 'usd', amount_total: 2300, payment_intent: 'pi_test_market_1', total_details: { amount_tax: 0 }, customer_details: { email: buyer.email }
  } } };
  const paidResponse = await sendStripeEvent(successEvent);
  assert.equal(paidResponse.status, 200);
  const duplicateResponse = await sendStripeEvent(successEvent);
  assert.equal(duplicateResponse.status, 200);
  assert.equal((await Order.findById(started.order._id)).paymentStatus, 'paid');
  assert.deepEqual((await Cart.findOne({ userId: buyer._id })).items, []);
  assert.equal((await Coupon.findById(coupon._id)).usedCount, 1);
  assert.equal((await Coupon.findById(coupon._id)).reservedCount, 0);
  assert.equal(await WebhookEvent.countDocuments({ providerEventId: successEvent.id, status: 'processed' }), 1);

  const failedBuyer = await addUser('failure@marketlane.test');
  const failedProduct = await addProduct(vendor._id, 'failure-test-product', 2);
  await addCart(failedBuyer._id, failedProduct._id, 1);
  failNextSession = true;
  await assert.rejects(begin(failedBuyer, 'integration-checkout-failure'));
  assert.equal((await Product.findById(failedProduct._id)).stock, 2);
  assert.equal((await Order.findOne({ customerId: failedBuyer._id })).paymentStatus, 'failed');
  assert.ok(await AuditEvent.findOne({ action: 'checkout.checkout_session_failed' }));

  const expiredBuyer = await addUser('expired@marketlane.test');
  const expiredProduct = await addProduct(vendor._id, 'expired-test-product', 2);
  await addCart(expiredBuyer._id, expiredProduct._id, 1);
  const expiredCheckout = await begin(expiredBuyer, 'integration-checkout-expire');
  const expiredEvent = { id: 'evt_test_checkout_expired_1', type: 'checkout.session.expired', data: { object: { id: expiredCheckout.order.stripeCheckoutSessionId } } };
  assert.equal((await sendStripeEvent(expiredEvent)).status, 200);
  assert.equal((await Product.findById(expiredProduct._id)).stock, 2);
  assert.equal((await Order.findById(expiredCheckout.order._id)).status, 'cancelled');

  const amountBuyer = await addUser('amount@marketlane.test');
  const amountProduct = await addProduct(vendor._id, 'amount-test-product', 2);
  await addCart(amountBuyer._id, amountProduct._id, 1);
  const amountCheckout = await begin(amountBuyer, 'integration-checkout-tamper');
  const invalidAmountEvent = { id: 'evt_test_checkout_bad_amount', type: 'checkout.session.completed', data: { object: {
    id: amountCheckout.order.stripeCheckoutSessionId, metadata: { orderId: String(amountCheckout.order._id) }, payment_status: 'paid', currency: 'usd', amount_total: 1, payment_intent: 'pi_test_bad', total_details: { amount_tax: 0 }
  } } };
  assert.equal((await sendStripeEvent(invalidAmountEvent)).status, 500);
  assert.equal((await Order.findById(amountCheckout.order._id)).paymentStatus, 'pending');

  const raceProduct = await addProduct(vendor._id, 'race-test-product', 1);
  const raceBuyerA = await addUser('race-a@marketlane.test');
  const raceBuyerB = await addUser('race-b@marketlane.test');
  await Promise.all([addCart(raceBuyerA._id, raceProduct._id), addCart(raceBuyerB._id, raceProduct._id)]);
  const stockRace = await Promise.allSettled([begin(raceBuyerA, 'integration-stock-race-a'), begin(raceBuyerB, 'integration-stock-race-b')]);
  assert.equal(stockRace.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await Product.findById(raceProduct._id)).stock, 0);

  const couponRace = await Coupon.create({ code: 'RACECAP', percentOff: 5, maxUses: 1, usedCount: 0, reservedCount: 0, startsAt: new Date(Date.now() - 1000), status: 'active' });
  const couponRaceProduct = await addProduct(vendor._id, 'coupon-race-product', 5);
  const couponBuyerA = await addUser('coupon-a@marketlane.test');
  const couponBuyerB = await addUser('coupon-b@marketlane.test');
  await Promise.all([addCart(couponBuyerA._id, couponRaceProduct._id), addCart(couponBuyerB._id, couponRaceProduct._id)]);
  const couponRaceResults = await Promise.allSettled([begin(couponBuyerA, 'integration-coupon-race-a', couponRace.code), begin(couponBuyerB, 'integration-coupon-race-b', couponRace.code)]);
  assert.equal(couponRaceResults.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await Coupon.findById(couponRace._id)).reservedCount, 1);

  const refundBuyer = await addUser('refund@marketlane.test');
  const refundProduct = await addProduct(vendor._id, 'refund-test-product', 3);
  const otherRefundProduct = await addProduct(otherVendor._id, 'other-refund-test-product', 3);
  await Cart.create({ userId: refundBuyer._id, items: [{ productId: refundProduct._id, quantity: 1 }, { productId: otherRefundProduct._id, quantity: 1 }] });
  const refundCheckout = await begin(refundBuyer, 'integration-checkout-refund');
  const refundPaidEvent = { id: 'evt_test_refund_checkout_paid', type: 'checkout.session.completed', data: { object: {
    id: refundCheckout.order.stripeCheckoutSessionId, metadata: { orderId: String(refundCheckout.order._id) }, payment_status: 'paid', currency: 'usd', amount_total: refundCheckout.order.totalMinor, payment_intent: 'pi_test_refund', total_details: { amount_tax: 0 }
  } } };
  assert.equal((await sendStripeEvent(refundPaidEvent)).status, 200);
  const paidForRefund = await Order.findById(refundCheckout.order._id);
  paidForRefund.status = 'delivered';
  paidForRefund.allocations[0].status = 'delivered';
  paidForRefund.allocations[0].deliveredAt = new Date();
  paidForRefund.allocations[0].trackingNumber = 'TRACK12345';
  paidForRefund.allocations[0].carrier = 'Test Carrier';
  paidForRefund.allocations[1].status = 'delivered';
  paidForRefund.allocations[1].deliveredAt = new Date(Date.now() - 31 * 86400000);
  paidForRefund.allocations[1].deliveryConfirmedAt = new Date(Date.now() - 31 * 86400000);
  paidForRefund.allocations[1].trackingNumber = 'TRACK67890';
  paidForRefund.allocations[1].carrier = 'Test Carrier';
  await paidForRefund.save();
  const deliveryPath = `/api/v1/admin/orders/${paidForRefund.orderNumber}/allocations/${paidForRefund.allocations[0]._id}/delivery`;
  const deliveryResponse = await apiRequest(deliveryPath, { method: 'PATCH', token: adminToken, body: { decision: 'confirmed' } });
  assert.equal(deliveryResponse.status, 200);
  const confirmedDelivery = await Order.findById(refundCheckout.order._id);
  assert.equal(confirmedDelivery.allocations[0].payoutStatus, 'queued');
  assert.equal(confirmedDelivery.allocations[0].payoutDueAt.getTime() - confirmedDelivery.allocations[0].deliveryConfirmedAt.getTime(), 30 * 86400000);

  const refundBuyerToken = signAccessToken(refundBuyer, config);
  const returnPath = `/api/v1/orders/${paidForRefund.orderNumber}/allocations/${paidForRefund.allocations[0]._id}/returns`;
  const returnResponse = await apiRequest(returnPath, { method: 'POST', token: refundBuyerToken, body: { reason: 'The item arrived damaged during shipping.' } });
  assert.equal(returnResponse.status, 202);
  const heldOrder = await Order.findById(refundCheckout.order._id);
  assert.equal(heldOrder.allocations[0].payoutStatus, 'review');
  assert.equal(heldOrder.allocations[0].payoutDueAt, null);
  const adminReturnPath = `/api/v1/admin/orders/${paidForRefund.orderNumber}/allocations/${paidForRefund.allocations[0]._id}/return`;
  const approvalResponse = await apiRequest(adminReturnPath, { method: 'PATCH', token: adminToken, body: { decision: 'approved', reason: 'Tracking and customer report reviewed.' } });
  assert.equal(approvalResponse.status, 200);

  const returnApproved = await Order.findById(refundCheckout.order._id);
  assert.equal(returnApproved.allocations.length, 2);
  assert.equal(returnApproved.allocations[0].refundStatus, 'pending');
  assert.equal(refundCreates, 1);
  assert.equal(lastRefundRequest.amount, returnApproved.allocations[0].grossMinor);
  returnApproved.allocations[0].stripeTransferId = 'tr_test_already_transferred';
  returnApproved.allocations[1].stripeTransferId = null;
  await returnApproved.save();
  const allocationRefund = { id: 're_test_1', status: 'succeeded', amount: lastRefundRequest.amount, payment_intent: 'pi_test_refund', metadata: lastRefundRequest.metadata };
  const refundUpdatedEvent = { id: 'evt_test_refund_updated', type: 'refund.updated', data: { object: allocationRefund } };
  assert.equal((await sendStripeEvent(refundUpdatedEvent)).status, 200);
  const refundFinalized = await Order.findById(refundCheckout.order._id);
  assert.equal(refundFinalized.allocations[0].returnStatus, 'completed');
  assert.equal(refundFinalized.allocations[0].payoutStatus, 'held');
  assert.equal(refundFinalized.allocations[1].reversedMinor, 0);
  assert.equal(reversalAmount, refundFinalized.allocations[0].payoutAmountMinor);
  const partialRefundEvent = { id: 'evt_test_refund_partial', type: 'charge.refunded', data: { object: { id: 'ch_test_refund', payment_intent: 'pi_test_refund', amount: refundFinalized.totalMinor, amount_refunded: allocationRefund.amount, refunded: false, refunds: { data: [allocationRefund] } } } };
  assert.equal((await sendStripeEvent(partialRefundEvent)).status, 200);
  const refunded = await Order.findById(refundCheckout.order._id);
  assert.equal(refunded.paymentStatus, 'partially_refunded');
  assert.equal(refunded.allocations[0].payoutStatus, 'held');
  assert.equal(refunded.allocations[1].payoutStatus, 'review');
  assert.equal(refunded.allocations[1].reversedMinor, 0);
  const requeueOtherPath = `/api/v1/admin/orders/${refunded.orderNumber}/allocations/${refunded.allocations[1]._id}/delivery`;
  assert.equal((await apiRequest(requeueOtherPath, { method: 'PATCH', token: adminToken, body: { decision: 'confirmed' } })).status, 200);
  const payoutResult = await processDuePayouts({ stripe });
  assert.equal(payoutResult.processed, 1);
  assert.equal(transferCreates, 1);
});

const redisUrl = process.env.REDIS_TEST_URL || '';
test('disposable Redis shares atomic rate-limit counters between API instances', { skip: !redisUrl }, async (t) => {
  const { createClient } = require('redis');
  const { createRateLimit } = require('../src/middleware/rate-limit');
  const redis = createClient({ url: redisUrl });
  redis.on('error', () => {});
  await redis.connect();
  const namespace = `integration-${Date.now()}`;
  const key = `market-lane:limit:${namespace}:test-client`;
  t.after(async () => { await redis.del(key); await redis.quit(); });
  const firstInstance = createRateLimit({ windowMs: 60000, max: 1, redis, namespace });
  const secondInstance = createRateLimit({ windowMs: 60000, max: 1, redis, namespace });
  async function call(limiter) { return new Promise((resolve) => limiter({ ip: 'test-client' }, null, (error) => resolve(error || null))); }
  assert.equal(await call(firstInstance), null);
  assert.equal((await call(secondInstance)).code, 'rate_limit_exceeded');
});
