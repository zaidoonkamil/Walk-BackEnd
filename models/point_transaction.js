const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const PointTransaction = sequelize.define("PointTransaction", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  type: {
    type: DataTypes.ENUM("earn_steps", "coupon_purchase", "admin_adjustment"),
    allowNull: false,
  },
  points: { type: DataTypes.INTEGER, allowNull: false },
  description: { type: DataTypes.STRING, allowNull: true },
}, { timestamps: true });

module.exports = PointTransaction;
