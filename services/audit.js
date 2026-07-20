const { AuditLog } = require("../models");
const { getClientIp } = require("../utils/security");

async function writeAuditLog(req, action, options = {}) {
  try {
    await AuditLog.create({
      actorId: req.user?.id || options.actorId || null,
      actorRole: req.user?.role || options.actorRole || null,
      action,
      entityType: options.entityType || null,
      entityId: options.entityId === undefined || options.entityId === null ? null : String(options.entityId),
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"] || null,
      metadata: options.metadata || null,
    });
  } catch (error) {
    console.error("Audit log write failed:", error);
  }
}

module.exports = { writeAuditLog };
