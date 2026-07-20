const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const AdminSession = sequelize.define("AdminSession", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  jti: { type: DataTypes.STRING, allowNull: false, unique: true },
  ipAddress: { type: DataTypes.STRING, allowNull: true },
  userAgent: { type: DataTypes.TEXT, allowNull: true },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  revokedAt: { type: DataTypes.DATE, allowNull: true },
  lastUsedAt: { type: DataTypes.DATE, allowNull: true },
}, { timestamps: true });

module.exports = AdminSession;
