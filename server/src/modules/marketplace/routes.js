const express = require('express');
const mongoose = require('mongoose');
const User = require('../../models/user');
const Product = require('../../models/product');
const VendorProfile = require('../../models/vendor-profile');
const Cart = require('../../models/cart');
const Order = require('../../models/order');
const Review = require('../../models/review');
const Coupon = require('../../models/coupon');
const { authenticate, requireRole } = require('../../middleware/auth');
const { ApiError } = require('../../utils/api-error');
const { writeAudit } = require('../../services/audit');
const { buildQuote } = require('../../services/quote');
const { startCheckout } = require('../../services/checkout');
const { createConnectAccount, createAccountLink } = require('../../services/stripe');
const { createStorage } = require('../../services/storage');
const { createRateLimit } = require('../../middleware/rate-limit');
const { convertMinor } = require('../../services/fx');
const { createSearchAdapter, persistProductWithSearchEvent } = require('../../services/search');

const currencyForCountry = { US: 'USD', CA: 'CAD', GB: 'GBP' };
const orderSteps = ['placed', 'packed', 'shipped', 'delivered'];
const storageFor = (config, dependencies) => dependencies.storage || createStorage(config);
const money = (minor, currency) => ({ amountMinor: minor, currency, amount: Number((minor / 100).toFixed(2)) });
const slugify = (value) => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
const validId = (value) => mongoose.isValidObjectId(value);

function productResponse(product, vendor) {
  const item = product.toObject ? product.toObject() : product;
  return {
    id: String(item._id), slug: item.slug, name: item.name, productType: item.productType,
    description: item.description, category: item.category, vendorId: String(item.vendorId), vendor: vendor?.shopName || 'Independent shop',
    shopSlug: vendor?.slug || '', priceMinor: item.priceMinor, currency: item.currency, basePriceMinor: item.priceMinor, baseCurrency: item.currency,
    price: Number((item.priceMinor / 100).toFixed(2)), stock: item.stock, status: item.status,
    archived: item.status === 'archived', rating: item.ratingAverage || 0, ratingCount: item.ratingCount || 0,
    imageKeys: item.imageKeys || [], imageUrl: item.imageKeys?.[0] ? `/api/v1/media?key=${encodeURIComponent(item.imageKeys[0])}` : ''
  };
}

async function productForMarket(product, vendor, country, config) {
  const targetCurrency = currencyForCountry[country] || 'USD';
  const converted = await convertMinor(product.priceMinor, product.currency, targetCurrency, config);
  return { ...productResponse(product, vendor), basePriceMinor: product.priceMinor, baseCurrency: product.currency, priceMinor: converted.amountMinor, currency: targetCurrency, price: converted.amountMinor / 100, fxRate: converted.rate, fxProvider: converted.provider, fxQuotedAt: converted.quotedAt };
}

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
    allocations: obj.allocations.map((allocation) => ({ id: String(allocation._id), vendorId: String(allocation.vendorId), vendor: allocation.vendorName, status: allocation.status, trackingNumber: allocation.trackingNumber, carrier: allocation.carrier, deliveredAt: allocation.deliveredAt, deliveryConfirmedAt: allocation.deliveryConfirmedAt, returnStatus: allocation.returnStatus || 'none', returnRequestedAt: allocation.returnRequestedAt, returnReason: admin ? allocation.returnReason : undefined, payoutStatus: allocation.payoutStatus, payoutDueAt: allocation.payoutDueAt, grossMinor: allocation.grossMinor, commissionMinor: allocation.commissionMinor, netMinor: allocation.netMinor, payoutAmountMinor: allocation.payoutAmountMinor, payoutCurrency: allocation.payoutCurrency }))
  };
}

function validateProductInput(body, currency) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const productType = typeof body.productType === 'string' ? body.productType.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const category = body.category;
  const stock = Number(body.stock);
  const priceMinor = Number.isInteger(body.priceMinor) ? body.priceMinor : Number.isFinite(Number(body.price)) ? Math.round(Number(body.price) * 100) : NaN;
  if (name.length < 2 || name.length > 100 || productType.length < 1 || productType.length > 60 || description.length < 8 || description.length > 2000) throw new ApiError(400, 'invalid_product_text');
  if (!['Home', 'Accessories', 'Stationery'].includes(category)) throw new ApiError(400, 'invalid_product_category');
  if (!Number.isInteger(stock) || stock < 0 || stock > 1000000 || !Number.isInteger(priceMinor) || priceMinor < 1 || priceMinor > 100000000) throw new ApiError(400, 'invalid_product_price_or_stock');
  if (body.status && !['draft', 'published'].includes(body.status)) throw new ApiError(400, 'invalid_product_status');
  const imageKeys = Array.isArray(body.imageKeys) ? body.imageKeys : [];
  if (imageKeys.length > 8 || imageKeys.some((key) => typeof key !== 'string' || key.length > 300)) throw new ApiError(400, 'invalid_product_images');
  return { name, slug: slugify(name), productType, description, category, stock, priceMinor, currency, imageKeys };
}

function createMarketplaceRouter(config, dependencies = {}) {
  const router = express.Router();
  const storage = storageFor(config, dependencies);
  const search = dependencies.search || createSearchAdapter(config);
  const customerAuth = [authenticate(config), requireRole('customer', 'vendor', 'admin')];
  const vendorAuth = [authenticate(config), requireRole('vendor')];
  const checkoutLimit = createRateLimit({ windowMs: 10 * 60 * 1000, max: 8, redis: dependencies.redis, namespace: 'checkout' });
  const uploadLimit = createRateLimit({ windowMs: 10 * 60 * 1000, max: 20, redis: dependencies.redis, namespace: 'upload' });
  const reviewLimit = createRateLimit({ windowMs: 60 * 60 * 1000, max: 5, redis: dependencies.redis, namespace: 'review' });

  router.get('/products', async (req, res) => {
    const country = ['US', 'CA', 'GB'].includes(req.query.country) ? req.query.country : 'US';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
    const filter = { status: 'published' };
    if (req.query.category && ['Home', 'Accessories', 'Stationery'].includes(req.query.category)) filter.category = req.query.category;
    if (req.query.productType && typeof req.query.productType === 'string') filter.productType = new RegExp(escapeRegex(req.query.productType.slice(0, 60)), 'i');
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 24));
    const sort = req.query.sort === 'rating' ? { ratingAverage: -1 } : { createdAt: -1 };
    let all;
    if (q) {
      const ids = await search.searchProductIds(q, { category: filter.category, productType: typeof req.query.productType === 'string' ? req.query.productType.slice(0, 60) : '' });
      const products = await Product.find({ ...filter, _id: { $in: ids } }).limit(500).lean();
      const byId = new Map(products.map((product) => [String(product._id), product]));
      all = ids.map((id) => byId.get(String(id))).filter(Boolean);
    } else all = await Product.find(filter).sort(sort).limit(500).lean();
    const vendorIds = [...new Set(all.map((product) => String(product.vendorId)))];
    const vendors = await VendorProfile.find({ _id: { $in: vendorIds }, status: 'active' }).select('shopName slug').lean();
    const vendorMap = new Map(vendors.map((vendor) => [String(vendor._id), vendor]));
    const visible = all.filter((product) => vendorMap.has(String(product.vendorId)));
    let results = await Promise.all(visible.map((product) => productForMarket(product, vendorMap.get(String(product.vendorId)), country, config)));
    if (Number.isFinite(Number(req.query.minPrice))) results = results.filter((product) => product.priceMinor >= Math.round(Number(req.query.minPrice) * 100));
    if (Number.isFinite(Number(req.query.maxPrice))) results = results.filter((product) => product.priceMinor <= Math.round(Number(req.query.maxPrice) * 100));
    if (req.query.sort === 'price-low') results.sort((a, b) => a.priceMinor - b.priceMinor);
    if (req.query.sort === 'price-high') results.sort((a, b) => b.priceMinor - a.priceMinor);
    if (req.query.sort === 'rating') results.sort((a, b) => b.rating - a.rating);
    const start = (page - 1) * limit;
    res.json({ data: results.slice(start, start + limit), meta: { page, limit, hasMore: results.length > start + limit } });
  });

  router.get('/products/:slug', async (req, res) => {
    const country = ['US', 'CA', 'GB'].includes(req.query.country) ? req.query.country : 'US';
    const product = await Product.findOne({ [validId(req.params.slug) ? '_id' : 'slug']: req.params.slug, status: 'published' }).lean();
    if (!product) throw new ApiError(404, 'product_not_found');
    const vendor = await VendorProfile.findOne({ _id: product.vendorId, status: 'active' }).select('shopName slug').lean();
    if (!vendor) throw new ApiError(404, 'product_not_found');
    const reviews = await Review.find({ productId: product._id, status: 'published' }).populate('customerId', 'name').sort({ createdAt: -1 }).limit(20).lean();
    res.json({ data: { ...await productForMarket(product, vendor, country, config), reviews: reviews.map((review) => ({ id: String(review._id), author: review.customerId?.name || 'Customer', rating: review.rating, text: review.body, createdAt: review.createdAt })) } });
  });

  router.get('/shops/:slug', async (req, res) => {
    const vendor = await VendorProfile.findOne({ slug: req.params.slug, status: 'active' }).select('shopName slug description country currency').lean();
    if (!vendor) throw new ApiError(404, 'shop_not_found');
    const products = await Product.find({ vendorId: vendor._id, status: 'published' }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ data: { shop: vendor, products: products.map((product) => productResponse(product, vendor)) } });
  });

  router.get('/media', async (req, res) => {
    const key = typeof req.query.key === 'string' ? req.query.key : '';
    if (!/^vendors\/[a-f\d]{24}\/[a-f\d-]+\.(jpg|png|webp)$/i.test(key)) throw new ApiError(404, 'not_found');
    const image = await storage.read(key);
    res.set({ 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    if (image?.Body?.pipe) image.Body.pipe(res);
    else res.type(key.endsWith('.png') ? 'png' : key.endsWith('.webp') ? 'webp' : 'jpg').send(image);
  });

  router.get('/cart', ...customerAuth, async (req, res) => {
    const country = ['US', 'CA', 'GB'].includes(req.query.country) ? req.query.country : 'US';
    const cart = await loadCart(req.user.id, dependencies.redis);
    const products = await Product.find({ _id: { $in: cart.items.map((item) => item.productId) }, status: 'published' }).lean();
    const vendors = await VendorProfile.find({ _id: { $in: products.map((product) => product.vendorId) }, status: 'active' }).select('shopName slug').lean();
    const vendorMap = new Map(vendors.map((vendor) => [String(vendor._id), vendor]));
    const productItems = cart.items.flatMap((item) => {
      const product = products.find((value) => String(value._id) === String(item.productId));
      if (!product || !vendorMap.has(String(product.vendorId))) return [];
      return [{ product, vendor: vendorMap.get(String(product.vendorId)), quantity: item.quantity }];
    });
    const items = await Promise.all(productItems.map(async ({ product, vendor, quantity }) => ({ ...await productForMarket(product, vendor, country, config), quantity })));
    res.json({ data: { items } });
  });

  router.put('/cart/items/:productId', ...customerAuth, async (req, res) => {
    if (!validId(req.params.productId)) throw new ApiError(404, 'product_not_found');
    const quantity = req.body?.quantity;
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99) throw new ApiError(400, 'invalid_quantity');
    if (quantity > 0) {
      const product = await Product.findOne({ _id: req.params.productId, status: 'published' });
      if (!product) throw new ApiError(404, 'product_not_found');
      if (product.stock < quantity) throw new ApiError(409, 'insufficient_stock');
    }
    const cart = await loadCart(req.user.id, dependencies.redis);
    const items = cart.items.filter((item) => String(item.productId) !== req.params.productId);
    if (quantity > 0) items.push({ productId: req.params.productId, quantity });
    await saveCart(req.user.id, items, dependencies.redis);
    res.json({ data: { items } });
  });
  router.delete('/cart/items/:productId', ...customerAuth, async (req, res) => {
    if (!validId(req.params.productId)) throw new ApiError(404, 'product_not_found');
    const cart = await loadCart(req.user.id, dependencies.redis);
    const items = cart.items.filter((item) => String(item.productId) !== req.params.productId);
    await saveCart(req.user.id, items, dependencies.redis);
    res.status(204).end();
  });

  router.post('/checkout/quote', ...customerAuth, checkoutLimit, async (req, res) => {
    const cart = await loadCart(req.user.id, dependencies.redis);
    const quote = await buildQuote({ cartItems: cart.items, country: req.body?.country, couponCode: req.body?.couponCode || '', config });
    res.json({ data: { currency: quote.currency, subtotal: money(quote.subtotalMinor, quote.currency), discount: money(quote.discountMinor, quote.currency), shipping: money(quote.shippingMinor, quote.currency), tax: money(quote.taxMinor, quote.currency), total: money(quote.totalMinor, quote.currency), coupon: quote.coupon ? { code: quote.coupon.code, percentOff: quote.coupon.percentOff } : null, items: quote.lines.map((line) => ({ productId: String(line.productId), name: line.name, quantity: line.quantity, unitPrice: money(line.unitPriceMinor, quote.currency), baseCurrency: line.baseCurrency, fxRate: line.fxRate, fxProvider: line.fxProvider, fxQuotedAt: line.fxQuotedAt })) } });
  });

  router.post('/checkout', ...customerAuth, checkoutLimit, async (req, res) => {
    const result = await startCheckout({ user: req.user, body: req.body, idempotencyKey: req.get('idempotency-key'), config, stripe: dependencies.stripe });
    res.status(result.reused ? 200 : 201).json({ data: { order: orderResponse(result.order), checkoutUrl: result.checkoutUrl, mode: 'test' } });
  });

  router.get('/orders', ...customerAuth, async (req, res) => {
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
    const orders = await Order.find({ customerId: req.user.id }).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20);
    res.json({ data: orders.map((order) => orderResponse(order, { customer: true })), meta: { page, limit: 20 } });
  });
  router.get('/orders/:orderNumber', ...customerAuth, async (req, res) => {
    const filter = { orderNumber: req.params.orderNumber, ...(req.user.role === 'admin' ? {} : { customerId: req.user.id }) };
    const order = await Order.findOne(filter);
    if (!order) throw new ApiError(404, 'order_not_found');
    res.json({ data: orderResponse(order, { customer: req.user.role !== 'admin' }) });
  });
  router.get('/orders/:orderNumber/invoice', ...customerAuth, async (req, res) => {
    const order = await Order.findOne({ orderNumber: req.params.orderNumber, ...(req.user.role === 'admin' ? {} : { customerId: req.user.id }) });
    if (!order || order.paymentStatus !== 'paid') throw new ApiError(404, 'invoice_not_found');
    res.json({ data: { ...orderResponse(order, { customer: true }), invoice: { seller: 'Market Lane Marketplace', customer: order.customerSnapshot, address: order.shippingAddress, lines: order.items, subtotalMinor: order.subtotalMinor, discountMinor: order.discountMinor, shippingMinor: order.shippingMinor, taxMinor: order.taxMinor, totalMinor: order.totalMinor, currency: order.currency } } });
  });
  router.post('/orders/:orderNumber/allocations/:allocationId/returns', ...customerAuth, async (req, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
    if (reason.length < 4) throw new ApiError(400, 'return_reason_required');
    const order = await Order.findOne({ orderNumber: req.params.orderNumber, customerId: req.user.id, paymentStatus: { $in: ['paid', 'partially_refunded'] } });
    const allocation = order?.allocations.id(req.params.allocationId);
    if (!order || !allocation) throw new ApiError(404, 'order_allocation_not_found');
    if (allocation.status !== 'delivered' || !allocation.deliveredAt) throw new ApiError(409, 'delivered_order_required');
    if (Date.now() - allocation.deliveredAt.getTime() > 30 * 86400000) throw new ApiError(409, 'return_window_expired');
    if (['requested', 'approved', 'completed'].includes(allocation.returnStatus)) throw new ApiError(409, 'return_already_open');
    allocation.returnStatus = 'requested';
    allocation.returnRequestedAt = new Date();
    allocation.returnReason = reason;
    allocation.payoutStatus = 'review';
    allocation.payoutDueAt = null;
    await order.save();
    await writeAudit({ actorUserId: req.user.id, action: 'return.requested', resourceType: 'order', resourceId: order._id, reason, metadata: { allocationId: String(allocation._id) } });
    res.status(202).json({ data: { orderNumber: order.orderNumber, allocationId: String(allocation._id), returnStatus: allocation.returnStatus, payoutStatus: allocation.payoutStatus } });
  });

  router.get('/me/saved-products', ...customerAuth, async (req, res) => {
    const country = ['US', 'CA', 'GB'].includes(req.query.country) ? req.query.country : 'US';
    const user = await User.findById(req.user.id).select('savedProductIds');
    const products = await Product.find({ _id: { $in: user.savedProductIds }, status: 'published' }).lean();
    const vendors = await VendorProfile.find({ _id: { $in: products.map((product) => product.vendorId) }, status: 'active' }).select('shopName slug').lean();
    const vendorMap = new Map(vendors.map((vendor) => [String(vendor._id), vendor]));
    res.json({ data: await Promise.all(products.filter((product) => vendorMap.has(String(product.vendorId))).map((product) => productForMarket(product, vendorMap.get(String(product.vendorId)), country, config))) });
  });
  router.put('/me/saved-products/:productId', ...customerAuth, async (req, res) => {
    if (!validId(req.params.productId)) throw new ApiError(404, 'product_not_found');
    const product = await Product.findOne({ _id: req.params.productId, status: 'published' });
    if (!product) throw new ApiError(404, 'product_not_found');
    await User.updateOne({ _id: req.user.id }, { $addToSet: { savedProductIds: product._id } });
    res.status(204).end();
  });
  router.delete('/me/saved-products/:productId', ...customerAuth, async (req, res) => {
    if (!validId(req.params.productId)) throw new ApiError(404, 'product_not_found');
    await User.updateOne({ _id: req.user.id }, { $pull: { savedProductIds: req.params.productId } });
    res.status(204).end();
  });

  router.post('/products/:productId/reviews', ...customerAuth, reviewLimit, async (req, res) => {
    const rating = Number(req.body?.rating);
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || body.length < 8 || body.length > 1000) throw new ApiError(400, 'invalid_review');
    if (!validId(req.params.productId)) throw new ApiError(404, 'product_not_found');
    const purchasedProduct = await Product.findById(req.params.productId).select('vendorId');
    const order = await Order.findOne({ customerId: req.user.id, paymentStatus: 'paid', 'items.productId': req.params.productId, allocations: { $elemMatch: { vendorId: purchasedProduct?.vendorId, status: 'delivered' } } });
    if (!purchasedProduct || !order) throw new ApiError(403, 'delivered_purchase_required');
    const review = await Review.create({ customerId: req.user.id, productId: req.params.productId, orderId: order._id, rating, body });
    const product = await Product.findById(req.params.productId);
    if (product) { product.ratingAverage = ((product.ratingAverage * product.ratingCount) + rating) / (product.ratingCount + 1); product.ratingCount += 1; await persistProductWithSearchEvent(product, { config }); }
    res.status(201).json({ data: { id: String(review._id), productId: String(review.productId), rating: review.rating, body: review.body } });
  });

  router.post('/vendor-applications', authenticate(config), async (req, res) => {
    if (!['customer', 'vendor'].includes(req.user.role)) throw new ApiError(403, 'forbidden');
    const { shopName, description, contactEmail, country } = req.body || {};
    if (typeof shopName !== 'string' || shopName.trim().length < 2 || shopName.trim().length > 80 || typeof description !== 'string' || description.trim().length < 8 || description.trim().length > 500) throw new ApiError(400, 'invalid_vendor_application');
    if (!currencyForCountry[country] || typeof contactEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new ApiError(400, 'invalid_vendor_contact');
    const existing = await VendorProfile.findOne({ ownerUserId: req.user.id });
    if (existing) throw new ApiError(409, 'vendor_application_exists');
    const slug = slugify(shopName);
    const profile = await VendorProfile.create({ ownerUserId: req.user.id, shopName: shopName.trim(), slug, description: description.trim(), contactEmail: contactEmail.trim().toLowerCase(), country, currency: currencyForCountry[country], shippingFeeMinor: country === 'US' ? 500 : 700, status: 'pending' });
    await User.updateOne({ _id: req.user.id, role: 'customer' }, { $set: { role: 'vendor' } });
    await writeAudit({ actorUserId: req.user.id, action: 'vendor.application_submitted', resourceType: 'vendor', resourceId: profile._id });
    res.status(201).json({ data: serializeVendor(profile) });
  });

  router.get('/vendor/profile', ...vendorAuth, async (req, res) => {
    const profile = await VendorProfile.findOne({ ownerUserId: req.user.id });
    if (!profile) throw new ApiError(404, 'vendor_profile_not_found');
    res.json({ data: serializeVendor(profile) });
  });
  router.patch('/vendor/profile', ...vendorAuth, async (req, res) => {
    const profile = await VendorProfile.findOne({ ownerUserId: req.user.id });
    if (!profile) throw new ApiError(404, 'vendor_profile_not_found');
    const allowed = {};
    if (req.body.shopName !== undefined) {
      if (typeof req.body.shopName !== 'string' || req.body.shopName.trim().length < 2 || req.body.shopName.trim().length > 80) throw new ApiError(400, 'invalid_shop_name');
      allowed.shopName = req.body.shopName.trim(); allowed.slug = slugify(allowed.shopName);
    }
    if (req.body.description !== undefined) {
      if (typeof req.body.description !== 'string' || req.body.description.trim().length < 8 || req.body.description.trim().length > 500) throw new ApiError(400, 'invalid_shop_description');
      allowed.description = req.body.description.trim();
    }
    if (req.body.shippingFeeMinor !== undefined) {
      if (!Number.isInteger(req.body.shippingFeeMinor) || req.body.shippingFeeMinor < 0 || req.body.shippingFeeMinor > 100000) throw new ApiError(400, 'invalid_shipping_fee');
      allowed.shippingFeeMinor = req.body.shippingFeeMinor;
    }
    Object.assign(profile, allowed);
    await profile.save();
    res.json({ data: serializeVendor(profile) });
  });
  router.post('/vendor/connect/onboarding', ...vendorAuth, async (req, res) => {
    const profile = await VendorProfile.findOne({ ownerUserId: req.user.id }).select('+stripeAccountId');
    if (!profile || profile.status !== 'active') throw new ApiError(403, 'active_vendor_required');
    let accountId = profile.stripeAccountId;
    if (!accountId) {
      const account = await createConnectAccount(dependencies.stripe, profile, req.user);
      accountId = account.id; profile.stripeAccountId = accountId; await profile.save();
    }
    const link = await createAccountLink(dependencies.stripe, accountId, config);
    await writeAudit({ actorUserId: req.user.id, action: 'vendor.connect_onboarding_started', resourceType: 'vendor', resourceId: profile._id, metadata: { mode: 'test' } });
    res.json({ data: { onboardingUrl: link.url, expiresAt: link.expires_at, mode: 'test' } });
  });
  router.get('/vendor/products', ...vendorAuth, async (req, res) => {
    const profile = await requireVendorProfile(req.user.id, true);
    const products = await Product.find({ vendorId: profile._id }).sort({ createdAt: -1 }).lean();
    res.json({ data: products.map((product) => productResponse(product, profile)) });
  });
  router.post('/vendor/products', ...vendorAuth, async (req, res) => {
    const profile = await requireVendorProfile(req.user.id, true);
    const values = validateProductInput(req.body || {}, profile.currency);
    values.slug = `${values.slug}-${String(profile._id).slice(-6)}`;
    validateOwnedImageKeys(values.imageKeys, profile._id);
    const product = await persistProductWithSearchEvent({ ...values, vendorId: profile._id, status: 'draft' }, { create: true, config });
    await writeAudit({ actorUserId: req.user.id, action: 'product.created', resourceType: 'product', resourceId: product._id });
    res.status(201).json({ data: productResponse(product, profile) });
  });
  router.get('/vendor/products/:id', ...vendorAuth, async (req, res) => {
    const profile = await requireVendorProfile(req.user.id, true);
    const product = await Product.findOne({ _id: req.params.id, vendorId: profile._id });
    if (!product) throw new ApiError(404, 'product_not_found');
    res.json({ data: productResponse(product, profile) });
  });
  router.patch('/vendor/products/:id', ...vendorAuth, async (req, res) => {
    const profile = await requireVendorProfile(req.user.id, true);
    const product = await Product.findOne({ _id: req.params.id, vendorId: profile._id });
    if (!product) throw new ApiError(404, 'product_not_found');
    const values = validateProductInput({ ...product.toObject(), ...req.body }, profile.currency);
    values.slug = `${values.slug}-${String(profile._id).slice(-6)}`;
    validateOwnedImageKeys(values.imageKeys, profile._id);
    Object.assign(product, values);
    if (req.body.status && req.body.status !== 'draft') throw new ApiError(403, 'admin_moderation_required');
    if (product.status === 'published') product.status = 'draft';
    await persistProductWithSearchEvent(product, { config });
    await writeAudit({ actorUserId: req.user.id, action: 'product.updated', resourceType: 'product', resourceId: product._id });
    res.json({ data: productResponse(product, profile) });
  });
  router.delete('/vendor/products/:id', ...vendorAuth, async (req, res) => {
    const profile = await requireVendorProfile(req.user.id, true);
    const product = await Product.findOne({ _id: req.params.id, vendorId: profile._id });
    if (!product) throw new ApiError(404, 'product_not_found');
    product.status = 'archived';
    await persistProductWithSearchEvent(product, { config });
    await writeAudit({ actorUserId: req.user.id, action: 'product.archived', resourceType: 'product', resourceId: product._id });
    res.status(204).end();
  });
  router.post('/vendor/uploads/presign', ...vendorAuth, uploadLimit, async (req, res) => {
    const profile = await requireVendorProfile(req.user.id, true);
    res.json({ data: await storage.createUpload({ vendorId: profile._id, contentType: req.body?.contentType, size: req.body?.size }) });
  });
  router.put('/vendor/uploads/local', ...vendorAuth, uploadLimit, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }), async (req, res) => {
    const profile = await requireVendorProfile(req.user.id, true);
    const key = typeof req.query.key === 'string' ? req.query.key : '';
    if (!key.startsWith(`vendors/${profile._id}/`) || !Buffer.isBuffer(req.body)) throw new ApiError(400, 'invalid_upload');
    res.status(201).json({ data: await storage.storeLocal({ key, contentType: req.get('content-type'), bytes: req.body }) });
  });
  router.post('/vendor/uploads/confirm', ...vendorAuth, async (req, res) => {
    const profile = await requireVendorProfile(req.user.id, true);
    res.json({ data: await storage.confirm({ key: req.body?.key, vendorId: profile._id }) });
  });
  router.get('/vendor/orders', ...vendorAuth, async (req, res) => {
    const profile = await requireVendorProfile(req.user.id, true);
    const orders = await Order.find({ 'allocations.vendorId': profile._id }).sort({ createdAt: -1 }).limit(100);
    res.json({ data: orders.map((order) => {
      const result = orderResponse(order);
      result.items = result.items.filter((item) => item.vendorId === String(profile._id));
      result.allocations = result.allocations.filter((allocation) => allocation.vendorId === String(profile._id));
      return result;
    }) });
  });
  router.patch('/vendor/orders/:allocationId/status', ...vendorAuth, async (req, res) => {
    const profile = await requireVendorProfile(req.user.id, true);
    const order = await Order.findOne({ 'allocations._id': req.params.allocationId, 'allocations.vendorId': profile._id, paymentStatus: { $in: ['paid', 'partially_refunded'] } });
    if (!order) throw new ApiError(404, 'allocation_not_found');
    const allocation = order.allocations.id(req.params.allocationId);
    const next = req.body?.status;
    const currentIndex = orderSteps.indexOf(allocation.status);
    if (next !== orderSteps[currentIndex + 1]) throw new ApiError(409, 'invalid_fulfillment_transition');
    if (next === 'shipped') {
      if (typeof req.body.trackingNumber !== 'string' || req.body.trackingNumber.trim().length < 4 || req.body.trackingNumber.length > 80 || typeof req.body.carrier !== 'string' || req.body.carrier.trim().length < 2 || req.body.carrier.length > 80) throw new ApiError(400, 'tracking_details_required');
      allocation.trackingNumber = req.body.trackingNumber.trim(); allocation.carrier = req.body.carrier.trim();
    }
    allocation.status = next;
    if (next === 'delivered') { allocation.deliveredAt = new Date(); allocation.payoutDueAt = null; allocation.payoutStatus = 'review'; }
    const statuses = order.allocations.map((item) => item.status);
    order.status = statuses.every((status) => status === 'delivered') ? 'delivered' : statuses.some((status) => status === 'shipped' || status === 'delivered') ? 'partially_shipped' : 'placed';
    await order.save();
    await writeAudit({ actorUserId: req.user.id, action: `fulfillment.${next}`, resourceType: 'order', resourceId: order._id, metadata: { allocationId: String(allocation._id) } });
    res.json({ data: orderResponse(order) });
  });
  router.get('/vendor/analytics/summary', ...vendorAuth, async (req, res) => {
    const profile = await requireVendorProfile(req.user.id, true);
    const [products, orders] = await Promise.all([Product.find({ vendorId: profile._id }).lean(), Order.find({ 'allocations.vendorId': profile._id, paymentStatus: { $in: ['paid', 'partially_refunded'] } }).lean()]);
    const allocations = orders.flatMap((order) => order.allocations.filter((allocation) => String(allocation.vendorId) === String(profile._id)));
    res.json({ data: { productCount: products.filter((p) => p.status === 'published').length, lowStockCount: products.filter((p) => p.stock < 10 && p.status === 'published').length, orderCount: orders.length, payoutAllocatedMinor: allocations.reduce((sum, allocation) => sum + allocation.payoutAmountMinor, 0), currency: profile.currency } });
  });
  router.get('/vendor/payouts', ...vendorAuth, async (req, res) => {
    const profile = await requireVendorProfile(req.user.id, true);
    const orders = await Order.find({ 'allocations.vendorId': profile._id }).sort({ createdAt: -1 }).limit(100);
    res.json({ data: orders.flatMap((order) => order.allocations.filter((allocation) => String(allocation.vendorId) === String(profile._id)).map((allocation) => ({ orderNumber: order.orderNumber, currency: allocation.payoutCurrency, amountMinor: allocation.payoutAmountMinor, status: allocation.payoutStatus, dueAt: allocation.payoutDueAt, transferId: allocation.stripeTransferId || null }))) });
  });

  return router;
}

async function requireVendorProfile(userId, mustBeActive) {
  const profile = await VendorProfile.findOne({ ownerUserId: userId });
  if (!profile) throw new ApiError(404, 'vendor_profile_not_found');
  if (mustBeActive && profile.status !== 'active') throw new ApiError(403, 'active_vendor_required');
  return profile;
}

function serializeVendor(profile) {
  return { id: String(profile._id), shopName: profile.shopName, slug: profile.slug, description: profile.description, contactEmail: profile.contactEmail, country: profile.country, currency: profile.currency, shippingFeeMinor: profile.shippingFeeMinor, status: profile.status, stripeDetailsSubmitted: Boolean(profile.stripeDetailsSubmitted), stripeTransfersEnabled: Boolean(profile.stripeTransfersEnabled), stripePayoutsEnabled: Boolean(profile.stripePayoutsEnabled) };
}

function validateOwnedImageKeys(keys, vendorId) {
  if (keys.some((key) => !key.startsWith(`vendors/${vendorId}/`))) throw new ApiError(403, 'image_not_owned');
}

async function loadCart(userId, redis) {
  if (redis) {
    try {
      const value = await redis.get(`market-lane:cart:${userId}`);
      if (value) return { items: JSON.parse(value) };
    } catch (error) { console.error(JSON.stringify({ event: 'redis_cart_fallback', errorType: error.name || 'Error', code: error.code || 'redis_cart_fallback' })); }
  }
  const cart = await Cart.findOne({ userId }).lean();
  return cart || { items: [] };
}

async function saveCart(userId, items, redis) {
  await Cart.findOneAndUpdate({ userId }, { $set: { items } }, { upsert: true, new: true, runValidators: true });
  if (redis) {
    try { await redis.set(`market-lane:cart:${userId}`, JSON.stringify(items), { EX: 60 * 60 * 24 * 30 }); }
    catch (error) { console.error(JSON.stringify({ event: 'redis_cart_write_fallback', errorType: error.name || 'Error', code: error.code || 'redis_cart_write_fallback' })); }
  }
}

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

module.exports = createMarketplaceRouter;
