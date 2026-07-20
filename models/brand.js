const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Brand = sequelize.define("Brand", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  categoryId: { type: DataTypes.INTEGER, allowNull: true },
  ownerId: { type: DataTypes.INTEGER, allowNull: true },
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  image: { type: DataTypes.STRING, allowNull: true },
  locationText: { type: DataTypes.STRING, allowNull: true },
  mapUrl: { type: DataTypes.STRING, allowNull: true },
  latitude: { type: DataTypes.FLOAT, allowNull: true },
  longitude: { type: DataTypes.FLOAT, allowNull: true },
  websiteUrl: { type: DataTypes.STRING, allowNull: true },
  phone: { type: DataTypes.STRING, allowNull: true },
  defaultDiscountPercent: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  commissionPercent: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  isFeatured: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  popularityScore: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, { timestamps: true });

module.exports = Brand;
