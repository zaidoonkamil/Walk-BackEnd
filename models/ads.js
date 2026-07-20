const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Ads = sequelize.define("ads", {
    images: {
        type: DataTypes.JSON,
        allowNull: false
      },
}, {
    timestamps: true
});

module.exports = Ads;
