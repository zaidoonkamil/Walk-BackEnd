const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const upload = require("../middlewares/uploads");
const { User, AdminSession } = require("../models");
const { authenticate } = require("../middlewares/auth");
const { publicUser } = require("../utils/http");
const {
  generateJti,
  parseDurationMs,
  getClientIp,
  validatePasswordStrength,
} = require("../utils/security");
const { writeAuditLog } = require("../services/audit");
const { createAndSendOtp, verifyOtpCode } = require("../services/otp");

const router = express.Router();

function signToken(user, jti = null) {
  const role = user.role === "brand_owner" ? "brand" : user.role;
  const expiresIn = role === "admin"
    ? process.env.ADMIN_JWT_EXPIRES_IN || "30m"
    : process.env.JWT_EXPIRES_IN || "30d";

  const passwordVersion = user.passwordChangedAt
    ? new Date(user.passwordChangedAt).getTime()
    : new Date(user.createdAt || Date.now()).getTime();

  return jwt.sign(
    { id: user.id, phone: user.phone, role, type: "access", jti, pwd: passwordVersion },
    process.env.JWT_SECRET,
    { expiresIn }
  );
}

function adminExpiresAt() {
  const ttlMs = parseDurationMs(process.env.ADMIN_JWT_EXPIRES_IN || "30m", 30 * 60 * 1000);
  return new Date(Date.now() + ttlMs);
}

function normalizePhone(phone) {
  const text = String(phone || "").trim().replace(/\s+/g, "");
  if (/^964\d{10}$/.test(text)) return text;
  if (/^0\d{10}$/.test(text)) return `964${text.slice(1)}`;
  if (/^\d{10}$/.test(text)) return `964${text}`;
  return text;
}

function getLockMs(role) {
  return role === "admin"
    ? Number(process.env.ADMIN_ACCOUNT_LOCK_MS || 30 * 60 * 1000)
    : Number(process.env.ACCOUNT_LOCK_MS || 15 * 60 * 1000);
}

function getMaxFailedAttempts(role) {
  return role === "admin"
    ? Number(process.env.ADMIN_MAX_FAILED_LOGINS || 5)
    : Number(process.env.MAX_FAILED_LOGINS || 8);
}

async function recordFailedLogin(user) {
  user.failedLoginAttempts += 1;
  if (user.failedLoginAttempts >= getMaxFailedAttempts(user.role)) {
    user.lockedUntil = new Date(Date.now() + getLockMs(user.role));
  }
  await user.save();
}

router.post(["/auth/register", "/users"], upload.single("image"), async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || "");
    const location = String(req.body.location || "").trim();

    if (!name || !phone || !password) {
      return res.status(400).json({ error: "name, phone and password are required" });
    }
    const passwordError = validatePasswordStrength(password, "user");
    if (passwordError) return res.status(400).json({ error: passwordError });

    const exists = await User.unscoped().findOne({ where: { phone } });
    if (exists) return res.status(409).json({ error: "Phone number is already registered" });

    const user = await User.create({
      name,
      phone,
      location,
      image: req.file?.filename || null,
      password: await bcrypt.hash(password, 10),
      passwordChangedAt: new Date(),
      role: "user",
      isVerified: false,
    });

    return res.status(201).json({
      user: publicUser(user),
      requiresOtp: true,
      message: "Account created. Verification code is required.",
    });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/auth/bootstrap-admin", upload.single("image"), async (req, res) => {
  try {
    const adminCount = await User.unscoped().count({ where: { role: "admin" } });
    if (adminCount > 0) {
      return res.status(409).json({ error: "Admin bootstrap is already closed" });
    }

    const name = String(req.body.name || "").trim();
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || "");
    const location = String(req.body.location || "").trim();

    if (!name || !phone || !password || !location) {
      return res.status(400).json({ error: "name, phone, password and location are required" });
    }

    const passwordError = validatePasswordStrength(password, "admin");
    if (passwordError) return res.status(400).json({ error: passwordError });

    const exists = await User.unscoped().findOne({ where: { phone } });
    if (exists) return res.status(409).json({ error: "Phone number is already registered" });

    const admin = await User.create({
      name,
      phone,
      location,
      image: req.file?.filename || null,
      password: await bcrypt.hash(password, 12),
      passwordChangedAt: new Date(),
      role: "admin",
      isVerified: true,
    });

    await writeAuditLog(req, "auth.bootstrap_admin", {
      actorId: admin.id,
      actorRole: admin.role,
      entityType: "User",
      entityId: admin.id,
    });

    return res.status(201).json({ user: publicUser(admin) });
  } catch (error) {
    console.error("Bootstrap admin error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post(["/auth/login", "/login"], async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || "");

    if (!phone || !password) {
      return res.status(400).json({ error: "phone and password are required" });
    }

    const user = await User.unscoped().findOne({ where: { phone } });
    if (!user) {
      return res.status(401).json({ error: "Invalid phone or password" });
    }
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      await writeAuditLog(req, "auth.login_locked", {
        actorId: user.id,
        actorRole: user.role,
        entityType: "User",
        entityId: user.id,
      });
      return res.status(423).json({ error: "Account is temporarily locked" });
    }

    if (!(await bcrypt.compare(password, user.password))) {
      await recordFailedLogin(user);
      await writeAuditLog(req, "auth.login_failed", {
        actorId: user.id,
        actorRole: user.role,
        entityType: "User",
        entityId: user.id,
      });
      return res.status(401).json({ error: "Invalid phone or password" });
    }

    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();
    await user.save();

    if (user.role === "user" && !user.isVerified) {
      return res.status(403).json({
        error: "Account is not verified",
        code: "ACCOUNT_NOT_VERIFIED",
        phone: user.phone,
      });
    }

    let jti = null;
    if (user.role === "admin") {
      jti = generateJti();
      await AdminSession.create({
        userId: user.id,
        jti,
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"] || null,
        expiresAt: adminExpiresAt(),
      });
    }

    await writeAuditLog(req, "auth.login_success", {
      actorId: user.id,
      actorRole: user.role,
      entityType: "User",
      entityId: user.id,
    });

    return res.json({
      user: publicUser(user),
      token: signToken(user, jti),
      tokenExpiresIn: user.role === "admin"
        ? process.env.ADMIN_JWT_EXPIRES_IN || "30m"
        : process.env.JWT_EXPIRES_IN || "30d",
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/send-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ error: "phone is required" });

    const user = await User.unscoped().findOne({ where: { phone } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.role !== "user") {
      return res.status(400).json({ error: "OTP is available for user accounts only" });
    }
    if (user.isVerified) {
      return res.status(409).json({ error: "Account is already verified" });
    }

    const result = await createAndSendOtp({
      req,
      phone,
      userId: user.id,
      purpose: "phone_verify",
    });

    await writeAuditLog(req, "auth.otp_sent", {
      actorId: user.id,
      actorRole: user.role,
      entityType: "User",
      entityId: user.id,
      metadata: { provider: result.otp.provider },
    });

    return res.json({
      message: "Verification code sent",
      expiresInSeconds: result.expiresInSeconds,
      cooldownSeconds: result.cooldownSeconds,
      dryRunCode: result.dryRunCode,
    });
  } catch (error) {
    console.error("Send OTP error:", error.response?.data || error.message || error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Internal Server Error",
      waitSeconds: error.waitSeconds,
    });
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const code = String(req.body.code || "").trim();
    if (!phone || !code) return res.status(400).json({ error: "phone and code are required" });

    const result = await verifyOtpCode({ phone, code, purpose: "phone_verify" });
    if (!result.user) return res.status(404).json({ error: "User not found" });

    await writeAuditLog(req, "auth.otp_verified", {
      actorId: result.user.id,
      actorRole: result.user.role,
      entityType: "User",
      entityId: result.user.id,
    });

    return res.json({
      message: "Account verified successfully",
      user: publicUser(result.user),
      token: signToken(result.user),
      tokenExpiresIn: process.env.JWT_EXPIRES_IN || "30d",
    });
  } catch (error) {
    console.error("Verify OTP error:", error.message || error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Internal Server Error",
    });
  }
});

router.post("/auth/password/forgot", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ error: "phone is required" });

    const user = await User.unscoped().findOne({ where: { phone } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const result = await createAndSendOtp({
      req,
      phone,
      userId: user.id,
      purpose: "reset_password",
    });

    await writeAuditLog(req, "auth.password_reset_otp_sent", {
      actorId: user.id,
      actorRole: user.role,
      entityType: "User",
      entityId: user.id,
      metadata: { provider: result.otp.provider },
    });

    return res.json({
      message: "Password reset code sent",
      expiresInSeconds: result.expiresInSeconds,
      cooldownSeconds: result.cooldownSeconds,
      dryRunCode: result.dryRunCode,
    });
  } catch (error) {
    console.error("Forgot password OTP error:", error.response?.data || error.message || error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Internal Server Error",
      waitSeconds: error.waitSeconds,
    });
  }
});

router.post("/auth/password/reset", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const code = String(req.body.code || "").trim();
    const password = String(req.body.password || "");

    if (!phone || !code || !password) {
      return res.status(400).json({ error: "phone, code and password are required" });
    }

    const result = await verifyOtpCode({
      phone,
      code,
      purpose: "reset_password",
      markUserVerified: false,
    });
    if (!result.user) return res.status(404).json({ error: "User not found" });

    const passwordError = validatePasswordStrength(password, result.user.role);
    if (passwordError) return res.status(400).json({ error: passwordError });

    result.user.password = await bcrypt.hash(password, 10);
    result.user.passwordChangedAt = new Date();
    result.user.failedLoginAttempts = 0;
    result.user.lockedUntil = null;
    await result.user.save();

    if (result.user.role === "admin") {
      await AdminSession.update(
        { revokedAt: new Date() },
        { where: { userId: result.user.id, revokedAt: null } }
      );
    }

    await writeAuditLog(req, "auth.password_reset_success", {
      actorId: result.user.id,
      actorRole: result.user.role,
      entityType: "User",
      entityId: result.user.id,
    });

    return res.json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error.message || error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Internal Server Error",
    });
  }
});

router.get("/auth/me", authenticate, async (req, res) => {
  const user = await User.findByPk(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({ user: publicUser(user) });
});

router.post("/auth/logout", authenticate, async (req, res) => {
  if (req.user.role === "admin" && req.user.jti) {
    await AdminSession.update(
      { revokedAt: new Date() },
      { where: { jti: req.user.jti, userId: req.user.id, revokedAt: null } }
    );
  }

  await writeAuditLog(req, "auth.logout", { entityType: "User", entityId: req.user.id });

  return res.json({ message: "Logged out successfully" });
});

router.post("/auth/admin/revoke-sessions", authenticate, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  const [revokedCount] = await AdminSession.update(
    { revokedAt: new Date() },
    {
      where: {
        userId: req.user.id,
        revokedAt: null,
      },
    }
  );

  await writeAuditLog(req, "auth.admin_revoke_own_sessions", {
    entityType: "User",
    entityId: req.user.id,
    metadata: { revokedCount },
  });

  return res.json({ revokedCount });
});

module.exports = router;
