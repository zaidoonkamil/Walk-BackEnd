const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const StepEntry = sequelize.define("StepEntry", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  date: { type: DataTypes.DATEONLY, allowNull: false },
  steps: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  calories: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  distanceKm: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  activeMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  pointsEarned: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  source: {
    type: DataTypes.ENUM("manual", "pedometer", "google_fit", "healthkit"),
    allowNull: false,
    defaultValue: "manual",
  },
  deviceId: { type: DataTypes.STRING, allowNull: true },
  sourceName: { type: DataTypes.STRING, allowNull: true },
  isTrusted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  rejectedReason: { type: DataTypes.STRING, allowNull: true },
}, {
  timestamps: true,
  indexes: [{ unique: true, fields: ["userId", "date"] }],
});

module.exports = StepEntry;
