const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const CouponPurchase = sequelize.define("CouponPurchase", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  couponId: { type: DataTypes.INTEGER, allowNull: false },
  brandId: { type: DataTypes.INTEGER, allowNull: false },
  code: { type: DataTypes.STRING, allowNull: false, unique: true },
  qrPayload: { type: DataTypes.STRING, allowNull: false },
  pointsSpent: { type: DataTypes.INTEGER, allowNull: false },
  status: {
    type: DataTypes.ENUM("in_cart", "active", "redeemed", "expired", "cancelled"),
    allowNull: false,
    defaultValue: "active",
  },
  purchasedAt: { type: DataTypes.DATE, allowNull: false },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  redeemedAt: { type: DataTypes.DATE, allowNull: true },
  redeemedById: { type: DataTypes.INTEGER, allowNull: true },
  commissionPercent: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  commissionAmount: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
}, { timestamps: true });

module.exports = CouponPurchase;
