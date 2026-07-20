const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const BrandSocialLink = sequelize.define("BrandSocialLink", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  brandId: { type: DataTypes.INTEGER, allowNull: false },
  platform: {
    type: DataTypes.ENUM("instagram", "facebook", "tiktok", "whatsapp", "website", "other"),
    allowNull: false,
  },
  url: { type: DataTypes.STRING, allowNull: false },
}, { timestamps: true });

module.exports = BrandSocialLink;
