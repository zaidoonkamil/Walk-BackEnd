const express = require("express");
const bcrypt = require("bcryptjs");
const { Op, fn, col } = require("sequelize");
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
const { publicUser, toNumber, toBool } = require("../utils/http");
const { validatePasswordStrength } = require("../utils/security");
const { writeAuditLog } = require("../services/audit");

const router = express.Router();

function normalizePhone(phone) {
  return String(phone || "").trim().replace(/\s+/g, "");
}

function dateRangeWhere(query, field = "createdAt") {
  const where = {};
  const range = {};
  if (query.from) range[Op.gte] = new Date(query.from);
  if (query.to) {
    const end = new Date(query.to);
    end.setHours(23, 59, 59, 999);
    range[Op.lte] = end;
  }
  if (Object.keys(range).length) where[field] = range;
  return where;
}

function dateOnlyRangeWhere(query) {
  const range = {};
  if (query.from) range[Op.gte] = String(query.from).slice(0, 10);
  if (query.to) range[Op.lte] = String(query.to).slice(0, 10);
  return Object.keys(range).length ? { date: range } : {};
}

function asNumber(value) {
  return Number(value || 0);
}

async function authenticateAdminOrBootstrapFirstAdmin(req, res, next) {
  const requestedRole = String(req.body.role || "").trim();
  if (requestedRole === "admin") {
    const adminCount = await User.unscoped().count({ where: { role: "admin" } });
    if (adminCount === 0) {
      req.bootstrapFirstAdmin = true;
      return next();
    }
  }

  const authHeader = req.headers.authorization || "";
  if (!authHeader) return res.status(401).json({ error: "Token is required" });

  return authenticate(req, res, () => authorize("admin")(req, res, next));
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

router.get("/admin/reports", authenticate, authorize("admin"), async (req, res) => {
  const createdWhere = dateRangeWhere(req.query);
  const stepWhere = dateOnlyRangeWhere(req.query);

  const [
    usersTotal,
    usersByRole,
    brandsTotal,
    activeBrands,
    couponsTotal,
    activeCoupons,
    purchasesTotal,
    purchasesByStatus,
    pointsSpent,
    commissionTotal,
    stepsTotal,
    caloriesTotal,
    distanceTotal,
    activeMinutesTotal,
    pointsEarned,
    pointsByType,
    topBrands,
    recentPurchases,
    recentCommissions,
    recentPointTransactions,
  ] = await Promise.all([
    User.count(),
    User.findAll({
      attributes: ["role", [fn("COUNT", col("id")), "count"]],
      group: ["role"],
      raw: true,
    }),
    Brand.count(),
    Brand.count({ where: { isActive: true } }),
    Coupon.count(),
    Coupon.count({ where: { isActive: true } }),
    CouponPurchase.count({ where: createdWhere }),
    CouponPurchase.findAll({
      attributes: ["status", [fn("COUNT", col("id")), "count"]],
      where: createdWhere,
      group: ["status"],
      raw: true,
    }),
    CouponPurchase.sum("pointsSpent", { where: createdWhere }),
    CommissionLog.sum("amount", { where: createdWhere }),
    StepEntry.sum("steps", { where: stepWhere }),
    StepEntry.sum("calories", { where: stepWhere }),
    StepEntry.sum("distanceKm", { where: stepWhere }),
    StepEntry.sum("activeMinutes", { where: stepWhere }),
    StepEntry.sum("pointsEarned", { where: stepWhere }),
    PointTransaction.findAll({
      attributes: ["type", [fn("SUM", col("points")), "points"]],
      where: createdWhere,
      group: ["type"],
      raw: true,
    }),
    CouponPurchase.findAll({
      attributes: [
        "brandId",
        [fn("COUNT", col("CouponPurchase.id")), "purchases"],
        [fn("SUM", col("pointsSpent")), "pointsSpent"],
        [fn("SUM", col("commissionAmount")), "commission"],
      ],
      where: createdWhere,
      include: [{ model: Brand, as: "brand", attributes: ["id", "name"] }],
      group: ["brandId", "brand.id", "brand.name"],
      order: [[fn("COUNT", col("CouponPurchase.id")), "DESC"]],
      limit: 10,
    }),
    CouponPurchase.findAll({
      where: createdWhere,
      include: [
        { model: User, as: "user", attributes: ["id", "name", "phone"] },
        { model: Brand, as: "brand", attributes: ["id", "name"] },
        { model: Coupon, as: "coupon", attributes: ["id", "title"] },
      ],
      order: [["createdAt", "DESC"]],
      limit: 20,
    }),
    CommissionLog.findAll({
      where: createdWhere,
      include: [{ model: Brand, as: "brand", attributes: ["id", "name"] }],
      order: [["createdAt", "DESC"]],
      limit: 20,
    }),
    PointTransaction.findAll({
      where: createdWhere,
      include: [{ model: User, as: "user", attributes: ["id", "name", "phone"] }],
      order: [["createdAt", "DESC"]],
      limit: 20,
    }),
  ]);

  return res.json({
    filters: {
      from: req.query.from || null,
      to: req.query.to || null,
    },
    summary: {
      usersTotal,
      usersByRole,
      brandsTotal,
      activeBrands,
      couponsTotal,
      activeCoupons,
      purchasesTotal,
      purchasesByStatus,
      pointsSpent: asNumber(pointsSpent),
      commissionTotal: asNumber(commissionTotal),
      stepsTotal: asNumber(stepsTotal),
      caloriesTotal: asNumber(caloriesTotal),
      distanceTotal: asNumber(distanceTotal),
      activeMinutesTotal: asNumber(activeMinutesTotal),
      pointsEarned: asNumber(pointsEarned),
      pointsByType,
    },
    topBrands,
    recentPurchases,
    recentCommissions,
    recentPointTransactions,
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

router.get("/admin/users/:id", authenticate, authorize("admin"), async (req, res) => {
  const user = await User.findByPk(req.params.id, {
    attributes: { exclude: ["password"] },
    include: [
      { model: StepEntry, as: "stepEntries", separate: true, limit: 30, order: [["date", "DESC"]] },
      { model: PointTransaction, as: "pointTransactions", separate: true, limit: 30, order: [["createdAt", "DESC"]] },
      { model: CouponPurchase, as: "couponPurchases", separate: true, limit: 30, order: [["createdAt", "DESC"]] },
      { model: Brand, as: "ownedBrands" },
    ],
  });
  if (!user) return res.status(404).json({ error: "User not found" });

  const [stepsTotal, couponsTotal, redeemedCoupons, pointTransactionsTotal] = await Promise.all([
    StepEntry.sum("steps", { where: { userId: user.id } }),
    CouponPurchase.count({ where: { userId: user.id } }),
    CouponPurchase.count({ where: { userId: user.id, status: "redeemed" } }),
    PointTransaction.count({ where: { userId: user.id } }),
  ]);

  return res.json({
    user: publicUser(user),
    stats: {
      stepsTotal: stepsTotal || 0,
      couponsTotal,
      redeemedCoupons,
      pointTransactionsTotal,
    },
  });
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

router.patch("/admin/users/:id", upload.single("image"), authenticate, authorize("admin"), async (req, res) => {
  try {
    const user = await User.unscoped().findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const nextRole = req.body.role === undefined ? user.role : String(req.body.role || "").trim();
    if (!["user", "admin", "brand_owner"].includes(nextRole)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    if (req.user.id === user.id && nextRole !== "admin") {
      return res.status(400).json({ error: "You cannot remove admin role from your own account" });
    }

    const phone = req.body.phone === undefined ? user.phone : normalizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ error: "phone is required" });

    const existing = await User.unscoped().findOne({
      where: { phone, id: { [Op.ne]: user.id } },
    });
    if (existing) return res.status(409).json({ error: "Phone number already exists" });

    if (req.body.name !== undefined) user.name = String(req.body.name || "").trim() || user.name;
    user.phone = phone;
    user.role = nextRole;
    if (req.body.location !== undefined) user.location = req.body.location || null;
    if (req.body.language !== undefined) user.language = req.body.language || user.language;
    if (req.body.dailyStepGoal !== undefined) {
      user.dailyStepGoal = toNumber(req.body.dailyStepGoal, user.dailyStepGoal);
    }
    if (req.body.isVerified !== undefined) {
      user.isVerified = toBool(req.body.isVerified, user.isVerified);
    }
    if (req.file?.filename) user.image = req.file.filename;

    if (req.body.password !== undefined && String(req.body.password || "").trim()) {
      const password = String(req.body.password || "");
      const passwordError = validatePasswordStrength(password, nextRole);
      if (passwordError) return res.status(400).json({ error: passwordError });
      user.password = await bcrypt.hash(password, 10);
      user.passwordChangedAt = new Date();
    }

    await user.save();
    await writeAuditLog(req, "admin.user_update", {
      entityType: "User",
      entityId: user.id,
      metadata: { role: user.role },
    });

    return res.json({ user: publicUser(user) });
  } catch (error) {
    console.error("Admin update user error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/admin/users/:id", authenticate, authorize("admin"), async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (req.user.id === user.id) {
    return res.status(400).json({ error: "You cannot delete your own account" });
  }
  await user.destroy();
  await writeAuditLog(req, "admin.user_delete", {
    entityType: "User",
    entityId: user.id,
    metadata: { role: user.role },
  });
  return res.json({ message: "User deleted" });
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
