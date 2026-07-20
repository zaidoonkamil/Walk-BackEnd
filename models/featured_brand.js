const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const FeaturedBrand = sequelize.define("FeaturedBrand", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  sectionId: { type: DataTypes.INTEGER, allowNull: false },
  brandId: { type: DataTypes.INTEGER, allowNull: false },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  timestamps: true,
  indexes: [{ unique: true, fields: ["sectionId", "brandId"] }],
});

module.exports = FeaturedBrand;
