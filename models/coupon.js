const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Coupon = sequelize.define("Coupon", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  brandId: { type: DataTypes.INTEGER, allowNull: false },
  createdById: { type: DataTypes.INTEGER, allowNull: true },
  title: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  discountType: {
    type: DataTypes.ENUM("percentage", "fixed"),
    allowNull: false,
    defaultValue: "percentage",
  },
  discountValue: { type: DataTypes.FLOAT, allowNull: false },
  pointsCost: { type: DataTypes.INTEGER, allowNull: false },
  quantity: { type: DataTypes.INTEGER, allowNull: true },
  purchasedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  commissionPercent: { type: DataTypes.FLOAT, allowNull: true },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { timestamps: true });

module.exports = Coupon;
