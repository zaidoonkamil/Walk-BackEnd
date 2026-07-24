require("dotenv").config();
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { QueryTypes } = require("sequelize");
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

function cleanPhone(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function generatedBrandPhone(brandId) {
  return `brand-${brandId}`;
}

async function ensureMissingBrandAccounts() {
  let brands = [];
  try {
    brands = await sequelize.query(
      `SELECT b.id, b.name, b.phone, b.locationText
       FROM Brands b
       LEFT JOIN Users u ON b.ownerId = u.id
       WHERE b.ownerId IS NULL OR b.ownerId = 0 OR u.id IS NULL`,
      { type: QueryTypes.SELECT }
    );
  } catch (error) {
    console.warn("Missing brand account scan skipped:", error.message);
    return;
  }

  for (const brand of brands) {
    const desiredPhone = cleanPhone(brand.phone) || generatedBrandPhone(brand.id);
    const [existing] = await sequelize.query(
      "SELECT id, role FROM Users WHERE phone = :phone LIMIT 1",
      { replacements: { phone: desiredPhone }, type: QueryTypes.SELECT }
    );

    let ownerId = null;
    if (existing && existing.role === "brand") {
      ownerId = existing.id;
    } else {
      const phone = existing ? generatedBrandPhone(brand.id) : desiredPhone;
      const password = crypto.randomBytes(18).toString("base64url");
      const passwordHash = await bcrypt.hash(password, 10);
      const now = new Date();
      const result = await sequelize.query(
        `INSERT INTO Users
          (name, phone, password, role, isVerified, points, walletBalance, location, language,
           dailyStepGoal, totalSteps, totalCalories, currentStreakDays, longestStreakDays,
           failedLoginAttempts, passwordChangedAt, createdAt, updatedAt)
         VALUES
          (:name, :phone, :password, 'brand', true, 0, 0, :location, 'ar',
           8000, 0, 0, 0, 0, 0, :passwordChangedAt, :createdAt, :updatedAt)`,
        {
          replacements: {
            name: brand.name || `Brand ${brand.id}`,
            phone,
            password: passwordHash,
            location: brand.locationText || null,
            passwordChangedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        }
      );
      ownerId = result[0]?.insertId;
      if (!ownerId) {
        const [created] = await sequelize.query(
          "SELECT id FROM Users WHERE phone = :phone LIMIT 1",
          { replacements: { phone }, type: QueryTypes.SELECT }
        );
        ownerId = created?.id;
      }
    }

    if (ownerId) {
      await sequelize.query(
        "UPDATE Brands SET ownerId = :ownerId, updatedAt = :updatedAt WHERE id = :brandId",
        {
          replacements: {
            ownerId,
            brandId: brand.id,
            updatedAt: new Date(),
          },
        }
      );
    }
  }

  if (brands.length) {
    console.log(`Created or linked brand accounts: ${brands.length}`);
  }
}

async function runStartupMigrations() {
  await normalizeBrandRole();
  await ensureMissingBrandAccounts();
}

if (require.main === module) {
  runStartupMigrations()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Normalize brand role failed:", error);
      process.exit(1);
    });
}

module.exports = { normalizeBrandRole, ensureMissingBrandAccounts, runStartupMigrations };
