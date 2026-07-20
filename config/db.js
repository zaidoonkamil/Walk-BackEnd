const { Sequelize } = require("sequelize");
require("dotenv").config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.MYSQL_PORT || process.env.DB_MYSQL_PORT || 3306),
    dialect: "mysql",
    logging: process.env.DB_LOGGING === "true" ? console.log : false,
  }
);

module.exports = sequelize;
