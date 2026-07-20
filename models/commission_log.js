const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const CommissionLog = sequelize.define("CommissionLog", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  brandId: { type: DataTypes.INTEGER, allowNull: false },
  couponPurchaseId: { type: DataTypes.INTEGER, allowNull: false },
  percent: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  amount: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  note: { type: DataTypes.STRING, allowNull: true },
}, { timestamps: true });

module.exports = CommissionLog;
