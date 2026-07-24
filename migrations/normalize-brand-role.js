require("dotenv").config();
const sequelize = require("../config/db");

async function normalizeBrandRole() {
  try {
    await sequelize.query(
      "UPDATE Users SET role = 'brand' WHERE role IN ('brand_owner','restaurant','delivery','agent')"
    );
  } catch (error) {
    console.warn("Brand role update skipped:", error.message);
    return;
  }

  try {
    await sequelize.query("ALTER TABLE Users MODIFY role ENUM('user','admin','brand') NOT NULL DEFAULT 'user'");
  } catch (error) {
    console.warn("Role enum alter skipped:", error.message);
  }

  console.log("Brand roles normalized successfully");
}

if (require.main === module) {
  normalizeBrandRole()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Normalize brand role failed:", error);
      process.exit(1);
    });
}

module.exports = { normalizeBrandRole };
