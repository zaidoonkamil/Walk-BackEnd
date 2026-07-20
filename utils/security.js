const crypto = require("crypto");

function generateJti() {
  return crypto.randomBytes(24).toString("hex");
}

function parseDurationMs(value, fallbackMs) {
  if (!value) return fallbackMs;
  const match = String(value).trim().match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) return fallbackMs;

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return amount * multipliers[unit];
}

function getClientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.ip || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
}

function validatePasswordStrength(password, role = "user") {
  const minLength = role === "admin" || role === "brand_owner" ? 10 : 8;
  if (password.length < minLength) return `Password must be at least ${minLength} characters`;
  if ((role === "admin" || role === "brand_owner") && !/[A-Z]/.test(password)) {
    return "Password must include an uppercase letter";
  }
  if ((role === "admin" || role === "brand_owner") && !/[a-z]/.test(password)) {
    return "Password must include a lowercase letter";
  }
  if ((role === "admin" || role === "brand_owner") && !/\d/.test(password)) {
    return "Password must include a number";
  }
  if ((role === "admin" || role === "brand_owner") && !/[^A-Za-z0-9]/.test(password)) {
    return "Password must include a symbol";
  }
  return null;
}

function assertJwtSecret() {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length >= 32) return;

  const message = "JWT_SECRET must be at least 32 characters for financial-grade token safety";
  if (process.env.NODE_ENV === "production") {
    throw new Error(message);
  }
  console.warn(`Security warning: ${message}`);
}

module.exports = {
  generateJti,
  parseDurationMs,
  getClientIp,
  validatePasswordStrength,
  assertJwtSecret,
};
