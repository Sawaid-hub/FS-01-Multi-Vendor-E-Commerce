require('dotenv').config();

const mongoose = require('mongoose');
const { loadConfig } = require('../config/env');
const User = require('../models/user');
const VendorProfile = require('../models/vendor-profile');
const Product = require('../models/product');
const { hashPassword } = require('../utils/tokens');

async function seedPilot() {
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_PILOT_SEED !== 'true') {
    throw new Error('Pilot seed is disabled. Set ALLOW_PILOT_SEED=true in a non-production environment to proceed.');
  }
  const password = process.env.DEMO_PASSWORD;
  if (typeof password !== 'string' || password.length < 12) throw new Error('Set DEMO_PASSWORD to a password with at least 12 characters.');
  const config = loadConfig();
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  const passwordHash = await hashPassword(password);
  const customer = await User.findOneAndUpdate({ email: 'customer@marketlane.test' }, { $setOnInsert: { name: 'Pilot Customer', email: 'customer@marketlane.test', role: 'customer', status: 'active', emailVerifiedAt: new Date(), passwordHash } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  const vendorUser = await User.findOneAndUpdate({ email: 'maker@marketlane.test' }, { $setOnInsert: { name: 'Pilot Maker', email: 'maker@marketlane.test', role: 'vendor', status: 'active', emailVerifiedAt: new Date(), passwordHash } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (vendorUser.role !== 'vendor') throw new Error('maker@marketlane.test already exists with a different role; seed stopped without changing it.');
  const vendor = await VendorProfile.findOneAndUpdate({ ownerUserId: vendorUser._id }, { $setOnInsert: { ownerUserId: vendorUser._id, shopName: 'Northstar Studio', slug: 'northstar-studio', description: 'Small-batch home and stationery goods for the pilot catalog.', contactEmail: vendorUser.email, country: 'US', currency: 'USD', shippingFeeMinor: 600, status: 'active' } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  const products = [
    { slug: 'northstar-studio-hand-thrown-bowl', name: 'Hand-thrown breakfast bowl', productType: 'Ceramic bowl', category: 'Home', description: 'A handmade stoneware bowl with a quiet glaze and a generous everyday shape.', priceMinor: 3600, currency: 'USD', stock: 24 },
    { slug: 'northstar-studio-linen-market-tote', name: 'Linen market tote', productType: 'Tote bag', category: 'Accessories', description: 'A sturdy natural linen tote made for market trips and daily errands.', priceMinor: 2800, currency: 'USD', stock: 18 },
    { slug: 'northstar-studio-weekly-planner', name: 'Weekly paper planner', productType: 'Planner', category: 'Stationery', description: 'An undated weekly planner printed on recycled paper for flexible routines.', priceMinor: 1800, currency: 'USD', stock: 40 }
  ];
  for (const product of products) {
    await Product.findOneAndUpdate({ slug: product.slug }, { $setOnInsert: { ...product, vendorId: vendor._id, status: 'published', imageKeys: [] } }, { upsert: true, setDefaultsOnInsert: true });
  }
  console.log(JSON.stringify({ event: 'pilot_seed_complete', customerEmail: customer.email, vendorEmail: vendorUser.email, productCount: products.length, passwordSource: 'DEMO_PASSWORD' }));
}

seedPilot().catch((error) => {
  console.error(`Pilot seed failed (${error.code || error.name || 'seed_failed'}).`);
  process.exitCode = 1;
}).finally(async () => { if (mongoose.connection.readyState) await mongoose.disconnect(); });
