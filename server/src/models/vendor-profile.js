const mongoose = require('mongoose');

const vendorProfileSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  shopName: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  description: { type: String, required: true, trim: true, maxlength: 500 },
  contactEmail: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  country: { type: String, enum: ['US', 'CA', 'GB'], required: true, default: 'US' },
  currency: { type: String, enum: ['USD', 'CAD', 'GBP'], required: true, default: 'USD' },
  shippingFeeMinor: { type: Number, min: 0, max: 100000, default: 500 },
  status: { type: String, enum: ['pending', 'active', 'rejected', 'suspended'], default: 'pending', index: true },
  stripeAccountId: { type: String, default: null, select: false },
  stripeDetailsSubmitted: { type: Boolean, default: false },
  stripeTransfersEnabled: { type: Boolean, default: false },
  stripePayoutsEnabled: { type: Boolean, default: false },
  moderation: { actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, reason: { type: String, maxlength: 500 }, at: Date }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('VendorProfile', vendorProfileSchema);
