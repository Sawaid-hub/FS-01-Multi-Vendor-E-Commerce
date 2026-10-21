const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true, match: /^[A-Z0-9_-]{4,24}$/ },
  percentOff: { type: Number, required: true, min: 1, max: 80 },
  description: { type: String, trim: true, maxlength: 240, default: '' },
  status: { type: String, enum: ['active', 'paused', 'expired'], default: 'active', index: true },
  startsAt: { type: Date, default: Date.now }, endsAt: Date,
  maxUses: { type: Number, min: 1, default: null }, usedCount: { type: Number, min: 0, default: 0 }, reservedCount: { type: Number, min: 0, default: 0 },
  minimumSubtotalMinor: { type: Number, min: 0, default: 0 }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('Coupon', couponSchema);
