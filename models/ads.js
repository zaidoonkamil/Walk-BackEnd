const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Ads = sequelize.define("ads", {
    images: {
        type: DataTypes.JSON,
        allowNull: false
      },
    type: {
        type: DataTypes.ENUM("main", "small"),
        allowNull: false,
        defaultValue: "main"
      },
    placement: {
        type: DataTypes.ENUM("all", "home", "interests", "steps", "profile"),
        allowNull: false,
        defaultValue: "all"
      },
    linkUrl: {
        type: DataTypes.STRING,
        allowNull: true
      },
    isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
    sortOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
}, {
    timestamps: true
});

module.exports = Ads;
