const mongoose = require('mongoose');

const searchOutboxEventSchema = new mongoose.Schema({
  eventType: { type: String, enum: ['product.changed'], required: true },
  entityId: { type: String, required: true, maxlength: 100 },
  status: { type: String, enum: ['pending', 'processing', 'processed', 'failed'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  lockedAt: Date,
  processedAt: Date,
  lastErrorCode: { type: String, maxlength: 100, default: '' }
}, { timestamps: true, versionKey: false });

searchOutboxEventSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });

module.exports = mongoose.model('SearchOutboxEvent', searchOutboxEventSchema);
