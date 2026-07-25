const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const OtpVerification = sequelize.define("OtpVerification", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  phone: { type: DataTypes.STRING, allowNull: false },
  purpose: {
    type: DataTypes.ENUM("register", "login", "phone_verify"),
    allowNull: false,
    defaultValue: "phone_verify",
  },
  codeHash: { type: DataTypes.STRING, allowNull: false },
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  maxAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  consumedAt: { type: DataTypes.DATE, allowNull: true },
  ipAddress: { type: DataTypes.STRING, allowNull: true },
  provider: { type: DataTypes.STRING, allowNull: true },
  providerMessageId: { type: DataTypes.STRING, allowNull: true },
}, {
  timestamps: true,
  indexes: [
    { fields: ["phone"] },
    { fields: ["phone", "purpose"] },
    { fields: ["expiresAt"] },
  ],
});

module.exports = OtpVerification;
