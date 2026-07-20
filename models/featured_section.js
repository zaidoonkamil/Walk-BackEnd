const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const FeaturedSection = sequelize.define("FeaturedSection", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  key: { type: DataTypes.STRING, allowNull: false, unique: true },
  title: { type: DataTypes.STRING, allowNull: false },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { timestamps: true });

module.exports = FeaturedSection;
