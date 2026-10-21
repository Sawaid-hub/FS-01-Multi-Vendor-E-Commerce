const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['customer', 'vendor', 'admin'], default: 'customer', required: true },
  status: { type: String, enum: ['active', 'disabled'], default: 'active', required: true },
  emailVerifiedAt: { type: Date, default: null },
  savedProductIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }]
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('User', userSchema);
