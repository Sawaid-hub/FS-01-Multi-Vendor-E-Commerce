const AuditEvent = require('../models/audit-event');

function writeAudit({ actorUserId = null, action, resourceType, resourceId, reason = '', metadata = {}, session }) {
  const event = { actorUserId, action, resourceType, resourceId: String(resourceId), reason, metadata };
  return session ? AuditEvent.create([event], { session }).then((events) => events[0]) : AuditEvent.create(event);
}

module.exports = { writeAudit };
