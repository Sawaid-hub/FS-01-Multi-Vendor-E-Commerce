const mongoose = require('mongoose');

const emailTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  purpose: { type: String, enum: ['verify_email', 'reset_password'], required: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  consumedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('EmailToken', emailTokenSchema);
