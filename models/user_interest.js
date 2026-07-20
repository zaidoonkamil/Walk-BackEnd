const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const UserInterest = sequelize.define("UserInterest", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  categoryId: { type: DataTypes.INTEGER, allowNull: false },
}, {
  timestamps: true,
  indexes: [
    { unique: true, fields: ["userId", "categoryId"] },
  ],
});

module.exports = UserInterest;
