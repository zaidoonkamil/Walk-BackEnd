const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const BrandCategory = sequelize.define("BrandCategory", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  image: { type: DataTypes.STRING, allowNull: true },
  icon: { type: DataTypes.STRING, allowNull: true },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { timestamps: true });

module.exports = BrandCategory;
