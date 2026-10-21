const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Product = require('../src/models/product');
const VendorProfile = require('../src/models/vendor-profile');
const Coupon = require('../src/models/coupon');
const { buildQuote } = require('../src/services/quote');
const { ApiError } = require('../src/utils/api-error');

const originalMethods = {};
const productId = new mongoose.Types.ObjectId();
const vendorId = new mongoose.Types.ObjectId();
const product = { _id: productId, vendorId, name: 'Saved bowl', priceMinor: 1000, currency: 'USD', stock: 8, status: 'published', imageKeys: [] };
const vendor = { _id: vendorId, shopName: 'Northstar Studio', currency: 'USD', shippingFeeMinor: 500, status: 'active' };

function replace(target, key, value) { originalMethods[`${target.modelName}.${key}`] = target[key]; target[key] = value; }
function query(value) { return { lean: async () => value }; }

describe('server checkout quotes', { concurrency: false }, () => {
  beforeEach(() => {
    replace(Product, 'find', (filter) => { assert.deepEqual(filter._id.$in.map(String), [String(productId)]); return query([product]); });
    replace(VendorProfile, 'find', () => query([vendor]));
    replace(Coupon, 'findOne', () => query({ code: 'SAVE10', percentOff: 10, minimumSubtotalMinor: 0, maxUses: 5, usedCount: 0, reservedCount: 0 }));
  });
  afterEach(() => { for (const [key, method] of Object.entries(originalMethods)) { const [modelName, methodName] = key.split('.'); const model = modelName === 'Product' ? Product : modelName === 'VendorProfile' ? VendorProfile : Coupon; model[methodName] = method; delete originalMethods[key]; } });

  it('uses saved catalog prices and records local currency, coupon, shipping, and FX for US, CA, and GB', async () => {
    const config = { fxRatesOverride: JSON.stringify({ USD: { CAD: 1.35, GBP: 0.8 } }), fxApiUrl: 'https://unused.invalid/latest' };
    for (const [country, currency, unitPrice, total] of [['US', 'USD', 1000, 2300], ['CA', 'CAD', 1350, 3105], ['GB', 'GBP', 800, 1840]]) {
      const quote = await buildQuote({ cartItems: [{ productId: String(productId), quantity: 2, priceMinor: 1, currency: 'USD' }], country, couponCode: 'SAVE10', config });
      assert.equal(quote.currency, currency);
      assert.equal(quote.lines[0].unitPriceMinor, unitPrice);
      assert.equal(quote.lines[0].baseUnitPriceMinor, 1000);
      assert.equal(quote.discountMinor, unitPrice * 2 / 10);
      assert.equal(quote.totalMinor, total);
      assert.ok(quote.fxRates.some((rate) => rate.pair === `USD:${currency}`));
      assert.equal(quote.vendorGroups[0].shippingMinor, currency === 'USD' ? 500 : Math.round(500 * (currency === 'CAD' ? 1.35 : 0.8)));
    }
  });

  it('rejects unsupported delivery markets, invalid quantities, and unavailable stock', async () => {
    const config = { fxRatesOverride: '', fxApiUrl: 'https://unused.invalid/latest' };
    await assert.rejects(buildQuote({ cartItems: [{ productId: String(productId), quantity: 1 }], country: 'AU', config }), (error) => error instanceof ApiError && error.code === 'unsupported_shipping_country');
    await assert.rejects(buildQuote({ cartItems: [{ productId: String(productId), quantity: 0 }], country: 'US', config }), (error) => error instanceof ApiError && error.code === 'invalid_quantity');
    const savedStock = product.stock;
    product.stock = 1;
    await assert.rejects(buildQuote({ cartItems: [{ productId: String(productId), quantity: 2 }], country: 'US', config }), (error) => error instanceof ApiError && error.code === 'insufficient_stock');
    product.stock = savedStock;
  });
});
