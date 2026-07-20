require("dotenv").config();

const bcrypt = require("bcryptjs");
const sequelize = require("../config/db");
const { User } = require("../models");
const { validatePasswordStrength } = require("../utils/security");

function readArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

function normalizePhone(phone) {
  return String(phone || "").trim().replace(/\s+/g, "");
}

async function main() {
  const name = readArg("name") || process.env.FIRST_ADMIN_NAME;
  const phone = normalizePhone(readArg("phone") || process.env.FIRST_ADMIN_PHONE);
  const password = readArg("password") || process.env.FIRST_ADMIN_PASSWORD;
  const location = readArg("location") || process.env.FIRST_ADMIN_LOCATION || "Baghdad";

  if (!name || !phone || !password || !location) {
    throw new Error(
      "Missing admin data. Use --name, --phone, --password, --location or FIRST_ADMIN_* env vars."
    );
  }

  const passwordError = validatePasswordStrength(password, "admin");
  if (passwordError) throw new Error(passwordError);

  await sequelize.authenticate();
  await sequelize.sync();

  const adminCount = await User.unscoped().count({ where: { role: "admin" } });
  if (adminCount > 0) {
    console.log("Admin already exists. No changes made.");
    return;
  }

  const existingUser = await User.unscoped().findOne({ where: { phone } });
  if (existingUser) {
    throw new Error("Phone number is already registered.");
  }

  const admin = await User.create({
    name,
    phone,
    location,
    password: await bcrypt.hash(password, 12),
    passwordChangedAt: new Date(),
    role: "admin",
    isVerified: true,
  });

  console.log(`First admin created successfully. id=${admin.id}, phone=${admin.phone}`);
}

main()
  .then(() => sequelize.close())
  .catch(async (error) => {
    console.error("Create first admin failed:", error.message);
    await sequelize.close().catch(() => {});
    process.exit(1);
  });
