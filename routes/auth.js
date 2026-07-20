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

const router = express.Router();

function signToken(user, jti = null) {
  const expiresIn = user.role === "admin"
    ? process.env.ADMIN_JWT_EXPIRES_IN || "30m"
    : process.env.JWT_EXPIRES_IN || "30d";

  const passwordVersion = user.passwordChangedAt
    ? new Date(user.passwordChangedAt).getTime()
    : new Date(user.createdAt || Date.now()).getTime();

  return jwt.sign(
    { id: user.id, phone: user.phone, role: user.role, type: "access", jti, pwd: passwordVersion },
    process.env.JWT_SECRET,
    { expiresIn }
  );
}

function adminExpiresAt() {
  const ttlMs = parseDurationMs(process.env.ADMIN_JWT_EXPIRES_IN || "30m", 30 * 60 * 1000);
  return new Date(Date.now() + ttlMs);
}

function normalizePhone(phone) {
  return String(phone || "").trim().replace(/\s+/g, "");
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

router.post("/auth/register", upload.single("image"), async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || "");
    const location = String(req.body.location || "").trim();

    if (!name || !phone || !password || !location) {
      return res.status(400).json({ error: "name, phone, password and location are required" });
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
    });

    return res.status(201).json({ user: publicUser(user), token: signToken(user) });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/auth/login", async (req, res) => {
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
