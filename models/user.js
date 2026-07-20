const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const User = sequelize.define("User", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  image: { type: DataTypes.STRING, allowNull: true },
  name: { type: DataTypes.STRING, allowNull: false },
  phone: { type: DataTypes.STRING, allowNull: false, unique: true },
  password: { type: DataTypes.STRING, allowNull: false },
  role: {
    type: DataTypes.ENUM("user", "admin", "brand_owner", "restaurant", "delivery"),
    allowNull: false,
    defaultValue: "user",
  },
  isVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  points: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  walletBalance: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  location: { type: DataTypes.STRING, allowNull: true },
  latitude: { type: DataTypes.FLOAT, allowNull: true },
  longitude: { type: DataTypes.FLOAT, allowNull: true },
  language: { type: DataTypes.STRING, allowNull: false, defaultValue: "ar" },
  dailyStepGoal: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 8000 },
  totalSteps: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  totalCalories: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  currentStreakDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  longestStreakDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  facebookUrl: { type: DataTypes.STRING, allowNull: true },
  instagramUrl: { type: DataTypes.STRING, allowNull: true },
  tiktokUrl: { type: DataTypes.STRING, allowNull: true },
  whatsappSupportUrl: { type: DataTypes.STRING, allowNull: true },
  failedLoginAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  lockedUntil: { type: DataTypes.DATE, allowNull: true },
  passwordChangedAt: { type: DataTypes.DATE, allowNull: true },
  lastLoginAt: { type: DataTypes.DATE, allowNull: true },
}, {
  timestamps: true,
  defaultScope: {
    attributes: { exclude: ["password"] },
  },
  scopes: {
    withPassword: {
      attributes: {},
    },
  },
});

module.exports = User;
