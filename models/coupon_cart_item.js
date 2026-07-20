const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const CouponCartItem = sequelize.define("CouponCartItem", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  couponId: { type: DataTypes.INTEGER, allowNull: false },
  quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
}, {
  timestamps: true,
  indexes: [{ unique: true, fields: ["userId", "couponId"] }],
});

module.exports = CouponCartItem;
