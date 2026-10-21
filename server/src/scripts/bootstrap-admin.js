require('dotenv').config();

const mongoose = require('mongoose');
const { loadConfig } = require('../config/env');
const User = require('../models/user');
const { hashPassword } = require('../utils/tokens');

async function bootstrapAdmin() {
  const config = loadConfig();
  const email = process.env.ADMIN_EMAIL;
  const name = process.env.ADMIN_NAME || 'Marketplace Admin';
  const password = process.env.ADMIN_PASSWORD;
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 12) {
    throw new Error('Set a valid ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters for this one-time command.');
  }

  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    if (existing.role === 'admin') throw new Error('This account is already an admin; no changes were made.');
    existing.role = 'admin';
    existing.status = 'active';
    existing.emailVerifiedAt = existing.emailVerifiedAt || new Date();
    await existing.save();
    console.log(`Promoted ${normalizedEmail} to admin.`);
  } else {
    await User.create({ name, email: normalizedEmail, role: 'admin', status: 'active', emailVerifiedAt: new Date(), passwordHash: await hashPassword(password) });
    console.log(`Created the initial admin account for ${normalizedEmail}.`);
  }
}

bootstrapAdmin().catch((error) => {
  console.error(`Admin bootstrap failed (${error.code || error.name || 'bootstrap_failed'}).`);
  process.exitCode = 1;
}).finally(async () => mongoose.connection.readyState && mongoose.disconnect());
