const VendorProfile = require('../models/vendor-profile');
const Coupon = require('../models/coupon');
const { convertMinor } = require('./fx');
const { ApiError } = require('../utils/api-error');

const countryCurrencies = { US: 'USD', CA: 'CAD', GB: 'GBP' };
const supportedCountries = new Set(Object.keys(countryCurrencies));

async function buildQuote({ cartItems, country, couponCode = '', config }) {
  if (!supportedCountries.has(country)) throw new ApiError(400, 'unsupported_shipping_country');
  if (!Array.isArray(cartItems) || cartItems.length === 0) throw new ApiError(400, 'cart_empty');
  const currency = countryCurrencies[country];
  const productIds = cartItems.map((item) => item.productId);
  const Product = require('../models/product');
  const products = await Product.find({ _id: { $in: productIds }, status: 'published' }).lean();
  if (products.length !== productIds.length) throw new ApiError(409, 'cart_product_unavailable');
  const vendors = await VendorProfile.find({ _id: { $in: products.map((product) => product.vendorId) }, status: 'active' }).lean();
  const vendorById = new Map(vendors.map((vendor) => [String(vendor._id), vendor]));
  const lines = [];
  const rates = new Map();
  let subtotalMinor = 0;
  for (const cartItem of cartItems) {
    const product = products.find((candidate) => String(candidate._id) === String(cartItem.productId));
    const vendor = product && vendorById.get(String(product.vendorId));
    if (!product || !vendor) throw new ApiError(409, 'cart_product_unavailable');
    const quantity = Number(cartItem.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new ApiError(400, 'invalid_quantity');
    if (product.stock < quantity) throw new ApiError(409, 'insufficient_stock', `Only ${product.stock} item(s) remain for ${product.name}.`);
    const fx = await convertMinor(product.priceMinor, product.currency, currency, config);
    rates.set(`${product.currency}:${currency}`, fx);
    const line = {
      productId: product._id, vendorId: vendor._id, vendorName: vendor.shopName, name: product.name,
      quantity, baseUnitPriceMinor: product.priceMinor, baseCurrency: product.currency,
      unitPriceMinor: fx.amountMinor, currency, fxRate: fx.rate, fxProvider: fx.provider, fxQuotedAt: fx.quotedAt,
      imageKey: product.imageKeys?.[0] || ''
    };
    line.lineTotalMinor = line.unitPriceMinor * quantity;
    subtotalMinor += line.lineTotalMinor;
    lines.push(line);
  }
  let coupon = null;
  let discountMinor = 0;
  if (couponCode) {
    coupon = await Coupon.findOne({ code: String(couponCode).trim().toUpperCase(), status: 'active', startsAt: { $lte: new Date() }, $or: [{ endsAt: null }, { endsAt: { $gt: new Date() } }] }).lean();
    if (!coupon || coupon.minimumSubtotalMinor > subtotalMinor || (coupon.maxUses !== null && coupon.maxUses !== undefined && coupon.usedCount + (coupon.reservedCount || 0) >= coupon.maxUses)) throw new ApiError(400, 'coupon_invalid_or_unavailable');
    discountMinor = Math.floor(subtotalMinor * coupon.percentOff / 100);
  }
  const vendorGroups = new Map();
  for (const line of lines) {
    const key = String(line.vendorId);
    const vendor = vendorById.get(key);
    const group = vendorGroups.get(key) || { vendorId: line.vendorId, vendorName: line.vendorName, payoutCurrency: vendor.currency, itemIndexes: [], shippingMinor: 0 };
    group.itemIndexes.push(lines.indexOf(line));
    vendorGroups.set(key, group);
  }
  let shippingMinor = 0;
  for (const group of vendorGroups.values()) {
    const vendor = vendorById.get(String(group.vendorId));
    const fx = await convertMinor(vendor.shippingFeeMinor || 0, vendor.currency, currency, config);
    group.shippingMinor = fx.amountMinor;
    group.baseShippingMinor = vendor.shippingFeeMinor || 0;
    group.baseCurrency = vendor.currency;
    group.shippingFxRate = fx.rate;
    group.shippingFxProvider = fx.provider;
    group.shippingFxQuotedAt = fx.quotedAt;
    shippingMinor += group.shippingMinor;
  }
  const totalMinor = subtotalMinor - discountMinor + shippingMinor;
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 1 || totalMinor > 99999999) throw new ApiError(400, 'order_total_out_of_range');
  return { currency, country, lines, vendorGroups: [...vendorGroups.values()], subtotalMinor, discountMinor, shippingMinor, taxMinor: 0, totalMinor, coupon, fxRates: [...rates.entries()].map(([pair, value]) => ({ pair, ...value })) };
}

module.exports = { buildQuote, countryCurrencies };
