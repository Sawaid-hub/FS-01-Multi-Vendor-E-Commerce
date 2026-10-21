const mongoose = require('mongoose');

const auditEventSchema = new mongoose.Schema({
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  action: { type: String, required: true, maxlength: 100 },
  resourceType: { type: String, required: true, maxlength: 80 },
  resourceId: { type: String, required: true, maxlength: 100 },
  reason: { type: String, maxlength: 500, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true, versionKey: false });
auditEventSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditEvent', auditEventSchema);
