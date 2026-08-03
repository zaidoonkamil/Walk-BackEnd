const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const StepReward = sequelize.define("StepReward", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  image: { type: DataTypes.STRING, allowNull: true },
  requiredSteps: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
});

module.exports = StepReward;
