const mongoose = require('mongoose');

const webhookEventSchema = new mongoose.Schema({
  providerEventId: { type: String, required: true, unique: true },
  eventType: { type: String, required: true },
  status: { type: String, enum: ['processing', 'processed', 'failed'], default: 'processing', index: true },
  lockExpiresAt: Date,
  attempts: { type: Number, default: 1 },
  processedAt: Date, failedAt: Date, failureCode: String
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);
