const express = require("express");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const { authenticate, authorize } = require("../middlewares/auth");
const upload = require("../middlewares/uploads");
const {
  User,
  Brand,
  Coupon,
  CouponPurchase,
  CommissionLog,
  StepEntry,
  PointTransaction,
  AdminSession,
} = require("../models");
const { publicUser, toNumber } = require("../utils/http");
const { validatePasswordStrength } = require("../utils/security");
const { writeAuditLog } = require("../services/audit");

const router = express.Router();

function normalizePhone(phone) {
  return String(phone || "").trim().replace(/\s+/g, "");
}

async function authenticateAdminOrBootstrapFirstAdmin(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (authHeader) {
    return authenticate(req, res, () => authorize("admin")(req, res, next));
  }

  const requestedRole = String(req.body.role || "").trim();
  if (requestedRole !== "admin") {
    return res.status(401).json({ error: "Token is required" });
  }

  const adminCount = await User.unscoped().count({ where: { role: "admin" } });
  if (adminCount > 0) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  req.bootstrapFirstAdmin = true;
  return next();
}

router.get("/admin/dashboard", authenticate, authorize("admin"), async (req, res) => {
  const [
    users,
    brandOwners,
    brands,
    activeCoupons,
    redeemedCoupons,
    steps,
    commissions,
  ] = await Promise.all([
    User.count({ where: { role: "user" } }),
    User.count({ where: { role: "brand_owner" } }),
    Brand.count(),
    Coupon.count({ where: { isActive: true } }),
    CouponPurchase.count({ where: { status: "redeemed" } }),
    StepEntry.sum("steps"),
    CommissionLog.sum("amount"),
  ]);

  return res.json({
    users,
    brandOwners,
    brands,
    activeCoupons,
    redeemedCoupons,
    totalSteps: steps || 0,
    totalCommission: commissions || 0,
  });
});

router.get("/admin/users", authenticate, authorize("admin"), async (req, res) => {
  const where = {};
  if (req.query.role) where.role = req.query.role;
  if (req.query.q) {
    where[Op.or] = [
      { name: { [Op.like]: `%${req.query.q}%` } },
      { phone: { [Op.like]: `%${req.query.q}%` } },
    ];
  }

  const users = await User.findAll({
    where,
    attributes: { exclude: ["password"] },
    order: [["createdAt", "DESC"]],
  });
  return res.json({ users });
});

router.post("/admin/users", upload.single("image"), authenticateAdminOrBootstrapFirstAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || "");
    const role = req.bootstrapFirstAdmin
      ? "admin"
      : ["user", "admin", "brand_owner"].includes(req.body.role)
        ? req.body.role
        : "user";

    if (!name || !phone || !password) {
      return res.status(400).json({ error: "name, phone and password are required" });
    }
    const passwordError = validatePasswordStrength(password, role);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const exists = await User.unscoped().findOne({ where: { phone } });
    if (exists) return res.status(409).json({ error: "Phone number already exists" });

    const user = await User.create({
      name,
      phone,
      role,
      location: req.body.location || null,
      image: req.file?.filename || null,
      password: await bcrypt.hash(password, 10),
      passwordChangedAt: new Date(),
    });

    await writeAuditLog(req, req.bootstrapFirstAdmin ? "admin.bootstrap_first_admin" : "admin.user_create", {
      actorId: req.bootstrapFirstAdmin ? user.id : undefined,
      actorRole: req.bootstrapFirstAdmin ? user.role : undefined,
      entityType: "User",
      entityId: user.id,
      metadata: { role },
    });

    return res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    console.error("Admin create user error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.patch("/admin/users/:id/points", authenticate, authorize("admin"), async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const points = toNumber(req.body.points, 0);
  user.points += points;
  await user.save();
  await PointTransaction.create({
    userId: user.id,
    type: "admin_adjustment",
    points,
    description: req.body.description || "Admin adjustment",
  });

  await writeAuditLog(req, "admin.points_adjust", {
    entityType: "User",
    entityId: user.id,
    metadata: { points },
  });

  return res.json({ user: publicUser(user) });
});

router.post("/admin/users/:id/revoke-admin-sessions", authenticate, authorize("admin"), async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user || user.role !== "admin") {
    return res.status(404).json({ error: "Admin user not found" });
  }

  const [revokedCount] = await AdminSession.update(
    { revokedAt: new Date() },
    { where: { userId: user.id, revokedAt: null } }
  );

  await writeAuditLog(req, "admin.revoke_admin_sessions", {
    entityType: "User",
    entityId: user.id,
    metadata: { revokedCount },
  });

  return res.json({ revokedCount });
});

router.get("/admin/brands/:id/report", authenticate, authorize("admin"), async (req, res) => {
  const brand = await Brand.findByPk(req.params.id, { include: [{ model: User, as: "owner", attributes: { exclude: ["password"] } }] });
  if (!brand) return res.status(404).json({ error: "Brand not found" });

  const [coupons, purchases, commission] = await Promise.all([
    Coupon.findAll({ where: { brandId: brand.id }, order: [["createdAt", "DESC"]] }),
    CouponPurchase.findAll({ where: { brandId: brand.id }, include: [{ model: User, as: "user", attributes: { exclude: ["password"] } }], order: [["createdAt", "DESC"]] }),
    CommissionLog.sum("amount", { where: { brandId: brand.id } }),
  ]);

  return res.json({ brand, coupons, purchases, commission: commission || 0 });
});

router.get("/admin/commissions", authenticate, authorize("admin"), async (req, res) => {
  const logs = await CommissionLog.findAll({
    include: [{ model: Brand, as: "brand" }, { model: CouponPurchase, as: "couponPurchase" }],
    order: [["createdAt", "DESC"]],
  });
  return res.json({ logs });
});

module.exports = router;
