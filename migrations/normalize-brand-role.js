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
       WHERE b.isActive = true AND (b.ownerId IS NULL OR b.ownerId = 0 OR u.id IS NULL)`,
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

async function cleanupInactiveFeaturedBrands() {
  try {
    const staleItems = await sequelize.query(
      `SELECT fb.id
       FROM FeaturedBrands fb
       LEFT JOIN Brands b ON fb.brandId = b.id
       WHERE b.id IS NULL OR b.isActive = false`,
      { type: QueryTypes.SELECT }
    );
    const ids = staleItems.map((item) => item.id).filter(Boolean);
    if (!ids.length) return;
    await sequelize.query(
      "DELETE FROM FeaturedBrands WHERE id IN (:ids)",
      { replacements: { ids } }
    );
    console.log(`Removed inactive featured brand links: ${ids.length}`);
  } catch (error) {
    console.warn("Inactive featured brand cleanup skipped:", error.message);
  }
}

async function ensureOtpVerificationsTable() {
  try {
    await sequelize.query(
      `CREATE TABLE IF NOT EXISTS OtpVerifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        phone VARCHAR(255) NOT NULL,
        purpose ENUM('register','login','phone_verify','reset_password') NOT NULL DEFAULT 'phone_verify',
        codeHash VARCHAR(255) NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        maxAttempts INT NOT NULL DEFAULT 5,
        expiresAt DATETIME NOT NULL,
        consumedAt DATETIME NULL,
        ipAddress VARCHAR(255) NULL,
        provider VARCHAR(255) NULL,
        providerMessageId VARCHAR(255) NULL,
        userId INT NULL,
        createdAt DATETIME NOT NULL,
        updatedAt DATETIME NOT NULL,
        INDEX otp_verifications_phone (phone),
        INDEX otp_verifications_phone_purpose (phone, purpose),
        INDEX otp_verifications_expires_at (expiresAt),
        INDEX otp_verifications_user_id (userId),
        CONSTRAINT otp_verifications_user_id_fk
          FOREIGN KEY (userId) REFERENCES Users(id)
          ON DELETE CASCADE ON UPDATE CASCADE
      )`
    );
    await sequelize.query(
      "ALTER TABLE OtpVerifications MODIFY purpose ENUM('register','login','phone_verify','reset_password') NOT NULL DEFAULT 'phone_verify'"
    );
  } catch (error) {
    console.warn("OTP table migration skipped:", error.message);
  }
}

async function runStartupMigrations() {
  await normalizeBrandRole();
  await ensureOtpVerificationsTable();
  await ensureMissingBrandAccounts();
  await cleanupInactiveFeaturedBrands();
}

if (require.main === module) {
  runStartupMigrations()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Normalize brand role failed:", error);
      process.exit(1);
    });
}

module.exports = {
  normalizeBrandRole,
  ensureMissingBrandAccounts,
  cleanupInactiveFeaturedBrands,
  ensureOtpVerificationsTable,
  runStartupMigrations,
};
