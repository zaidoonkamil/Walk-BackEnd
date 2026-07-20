const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const UserRating = sequelize.define("UserRating", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  ratedByUserId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  rating: {
    type: DataTypes.FLOAT,
    allowNull: false,
  },
  comment: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  timestamps: true,
  indexes: [{ unique: true, fields: ["userId", "ratedByUserId"] }],
});

module.exports = UserRating;
