const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const AuditLog = sequelize.define("AuditLog", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  actorId: { type: DataTypes.INTEGER, allowNull: true },
  actorRole: { type: DataTypes.STRING, allowNull: true },
  action: { type: DataTypes.STRING, allowNull: false },
  entityType: { type: DataTypes.STRING, allowNull: true },
  entityId: { type: DataTypes.STRING, allowNull: true },
  ipAddress: { type: DataTypes.STRING, allowNull: true },
  userAgent: { type: DataTypes.TEXT, allowNull: true },
  metadata: { type: DataTypes.JSON, allowNull: true },
}, { timestamps: true });

module.exports = AuditLog;
