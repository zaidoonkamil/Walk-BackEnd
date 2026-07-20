const express = require("express");
const QRCode = require("qrcode");
const sequelize = require("../config/db");
const { authenticate, authorize } = require("../middlewares/auth");
const {
  User,
  Brand,
  Coupon,
  CouponPurchase,
  CouponCartItem,
  CommissionLog,
  PointTransaction,
} = require("../models");
const { addDays, toBool, toNumber } = require("../utils/http");
const { generateCouponCode } = require("../utils/couponCode");
const { expireOldCouponPurchases } = require("../services/couponExpiry");
const { writeAuditLog } = require("../services/audit");

const router = express.Router();

async function findOwnedBrand(userId, brandId) {
  return Brand.findOne({ where: { id: brandId, ownerId: userId } });
}

async function attachQr(purchase) {
  const json = purchase.toJSON ? purchase.toJSON() : purchase;
  return {
    ...json,
    qrCodeDataUrl: await QRCode.toDataURL(json.qrPayload || json.code),
  };
}

async function buyCouponForUser({ userId, couponId, transaction }) {
  const user = await User.findByPk(userId, { transaction, lock: true });
  const coupon = await Coupon.findByPk(couponId, {
    include: [{ model: Brand, as: "brand" }],
    transaction,
    lock: true,
  });

  if (!coupon || !coupon.isActive || !coupon.brand?.isActive) {
    const error = new Error("Coupon not available");
    error.status = 404;
    throw error;
  }
  if (coupon.quantity !== null && coupon.purchasedCount >= coupon.quantity) {
    const error = new Error("Coupon quantity finished");
    error.status = 400;
    throw error;
  }
  if (user.points < coupon.pointsCost) {
    const error = new Error("Not enough points");
    error.status = 400;
    throw error;
  }

  const now = new Date();
  const code = generateCouponCode();
  const commissionPercent = coupon.commissionPercent ?? coupon.brand.commissionPercent;
  const commissionAmount = Number(((coupon.pointsCost * commissionPercent) / 100).toFixed(2));

  user.points -= coupon.pointsCost;
  coupon.purchasedCount += 1;
  await user.save({ transaction });
  await coupon.save({ transaction });

  const purchase = await CouponPurchase.create({
    userId: user.id,
    couponId: coupon.id,
    brandId: coupon.brandId,
    code,
    qrPayload: code,
    pointsSpent: coupon.pointsCost,
    status: "active",
    purchasedAt: now,
    expiresAt: addDays(now, 30),
    commissionPercent,
    commissionAmount,
  }, { transaction });

  await PointTransaction.create({
    userId: user.id,
    type: "coupon_purchase",
    points: -coupon.pointsCost,
    description: `Purchased coupon ${coupon.title}`,
  }, { transaction });

  return { purchase, remainingPoints: user.points };
}

async function createCoupon(req, res, forcedOwnerId = null) {
  try {
    const brandId = toNumber(req.body.brandId);
    const brand = forcedOwnerId ? await findOwnedBrand(forcedOwnerId, brandId) : await Brand.findByPk(brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const coupon = await Coupon.create({
      brandId: brand.id,
      createdById: req.user.id,
      title: String(req.body.title || "").trim(),
      description: req.body.description || null,
      discountType: req.body.discountType === "fixed" ? "fixed" : "percentage",
      discountValue: toNumber(req.body.discountValue, 0),
      pointsCost: toNumber(req.body.pointsCost, 0),
      quantity: toNumber(req.body.quantity),
      commissionPercent: req.body.commissionPercent !== undefined
        ? toNumber(req.body.commissionPercent)
        : brand.commissionPercent,
      isActive: toBool(req.body.isActive, true),
    });

    return res.status(201).json({ coupon });
  } catch (error) {
    console.error("Create coupon error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

router.get("/coupons", async (req, res) => {
  const where = { isActive: true };
  if (req.query.brandId) where.brandId = req.query.brandId;

  const coupons = await Coupon.findAll({
    where,
    include: [{ model: Brand, as: "brand" }],
    order: [["createdAt", "DESC"]],
  });
  return res.json({ coupons });
});

router.post("/admin/coupons", authenticate, authorize("admin"), (req, res) => createCoupon(req, res));
router.post("/brand-owner/coupons", authenticate, authorize("brand_owner"), (req, res) => createCoupon(req, res, req.user.id));

router.patch("/brand-owner/coupons/:id", authenticate, authorize("brand_owner"), async (req, res) => {
  const coupon = await Coupon.findByPk(req.params.id, { include: [{ model: Brand, as: "brand" }] });
  if (!coupon || coupon.brand.ownerId !== req.user.id) return res.status(404).json({ error: "Coupon not found" });

  ["title", "description"].forEach((field) => {
    if (req.body[field] !== undefined) coupon[field] = req.body[field];
  });
  ["discountValue", "pointsCost", "quantity", "commissionPercent"].forEach((field) => {
    if (req.body[field] !== undefined) coupon[field] = toNumber(req.body[field], coupon[field]);
  });
  if (req.body.discountType !== undefined) coupon.discountType = req.body.discountType === "fixed" ? "fixed" : "percentage";
  if (req.body.isActive !== undefined) coupon.isActive = toBool(req.body.isActive, coupon.isActive);
  await coupon.save();
  return res.json({ coupon });
});

router.get("/coupon-cart", authenticate, authorize("user"), async (req, res) => {
  const items = await CouponCartItem.findAll({
    where: { userId: req.user.id },
    include: [{ model: Coupon, as: "coupon", include: [{ model: Brand, as: "brand" }] }],
    order: [["createdAt", "DESC"]],
  });

  const totalPoints = items.reduce((sum, item) => sum + (item.coupon?.pointsCost || 0) * item.quantity, 0);
  return res.json({ items, totalPoints });
});

router.post("/coupon-cart", authenticate, authorize("user"), async (req, res) => {
  const couponId = toNumber(req.body.couponId);
  const coupon = await Coupon.findByPk(couponId);
  if (!coupon || !coupon.isActive) return res.status(404).json({ error: "Coupon not found" });

  const [item, created] = await CouponCartItem.findOrCreate({
    where: { userId: req.user.id, couponId },
    defaults: { quantity: 1 },
  });
  if (!created) {
    item.quantity += 1;
    await item.save();
  }

  return res.status(created ? 201 : 200).json({ item });
});

router.delete("/coupon-cart/:id", authenticate, authorize("user"), async (req, res) => {
  const item = await CouponCartItem.findOne({ where: { id: req.params.id, userId: req.user.id } });
  if (!item) return res.status(404).json({ error: "Cart item not found" });
  await item.destroy();
  return res.json({ message: "Cart item removed" });
});

router.post("/coupon-cart/checkout", authenticate, authorize("user"), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const items = await CouponCartItem.findAll({
      where: { userId: req.user.id },
      transaction,
      lock: true,
    });
    if (!items.length) {
      await transaction.rollback();
      return res.status(400).json({ error: "Cart is empty" });
    }

    const purchases = [];
    let remainingPoints = null;
    for (const item of items) {
      for (let index = 0; index < item.quantity; index += 1) {
        const result = await buyCouponForUser({
          userId: req.user.id,
          couponId: item.couponId,
          transaction,
        });
        purchases.push(result.purchase);
        remainingPoints = result.remainingPoints;
      }
    }

    await CouponCartItem.destroy({ where: { userId: req.user.id }, transaction });
    await transaction.commit();

    const purchasesWithQr = await Promise.all(purchases.map((purchase) => attachQr(purchase)));
    await writeAuditLog(req, "coupon.cart_checkout", {
      entityType: "CouponPurchase",
      metadata: { purchaseIds: purchases.map((purchase) => purchase.id), remainingPoints },
    });
    return res.status(201).json({ purchases: purchasesWithQr, remainingPoints });
  } catch (error) {
    await transaction.rollback();
    console.error("Checkout coupon cart error:", error);
    return res.status(error.status || 500).json({ error: error.message || "Internal Server Error" });
  }
});

router.post("/coupons/:id/buy", authenticate, authorize("user"), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { purchase, remainingPoints } = await buyCouponForUser({
      userId: req.user.id,
      couponId: req.params.id,
      transaction,
    });
    await transaction.commit();
    await writeAuditLog(req, "coupon.direct_buy", {
      entityType: "CouponPurchase",
      entityId: purchase.id,
      metadata: { couponId: req.params.id, remainingPoints },
    });
    return res.status(201).json({ purchase: await attachQr(purchase), remainingPoints });
  } catch (error) {
    await transaction.rollback();
    console.error("Buy coupon error:", error);
    return res.status(error.status || 500).json({ error: error.message || "Internal Server Error" });
  }
});

router.get("/coupon-purchases/:id/qr", authenticate, async (req, res) => {
  const where = { id: req.params.id };
  if (req.user.role === "user") where.userId = req.user.id;

  const purchase = await CouponPurchase.findOne({ where });
  if (!purchase) return res.status(404).json({ error: "Coupon purchase not found" });

  if (req.user.role === "brand_owner") {
    const brand = await Brand.findOne({ where: { id: purchase.brandId, ownerId: req.user.id } });
    if (!brand) return res.status(403).json({ error: "You do not have permission" });
  }

  return res.json(await attachQr(purchase));
});

router.post("/brand-owner/coupons/redeem", authenticate, authorize("brand_owner"), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const code = String(req.body.code || req.body.qrPayload || "").trim().toUpperCase();
    if (!code) {
      await transaction.rollback();
      return res.status(400).json({ error: "code is required" });
    }

    const purchase = await CouponPurchase.findOne({
      where: { code },
      include: [{ model: Brand, as: "brand" }, { model: Coupon, as: "coupon" }],
      transaction,
      lock: true,
    });
    if (!purchase || purchase.brand.ownerId !== req.user.id) {
      await transaction.rollback();
      return res.status(404).json({ error: "Coupon not found for this brand" });
    }
    if (purchase.status !== "active") {
      await transaction.rollback();
      return res.status(400).json({ error: `Coupon is ${purchase.status}` });
    }
    if (new Date(purchase.expiresAt) < new Date()) {
      purchase.status = "expired";
      await purchase.save({ transaction });
      await transaction.commit();
      return res.status(400).json({ error: "Coupon expired" });
    }

    purchase.status = "redeemed";
    purchase.redeemedAt = new Date();
    purchase.redeemedById = req.user.id;
    await purchase.save({ transaction });

    await CommissionLog.create({
      brandId: purchase.brandId,
      couponPurchaseId: purchase.id,
      percent: purchase.commissionPercent,
      amount: purchase.commissionAmount,
      note: `Redeemed coupon ${purchase.code}`,
    }, { transaction });

    await transaction.commit();
    await writeAuditLog(req, "coupon.redeem", {
      entityType: "CouponPurchase",
      entityId: purchase.id,
      metadata: { brandId: purchase.brandId, code: purchase.code },
    });
    return res.json({ purchase });
  } catch (error) {
    await transaction.rollback();
    console.error("Redeem coupon error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/brand-owner/coupons/purchases", authenticate, authorize("brand_owner"), async (req, res) => {
  const brandIds = (await Brand.findAll({ where: { ownerId: req.user.id }, attributes: ["id"] })).map((brand) => brand.id);
  const purchases = await CouponPurchase.findAll({
    where: { brandId: brandIds },
    include: [{ model: Coupon, as: "coupon" }, { model: User, as: "user", attributes: { exclude: ["password"] } }],
    order: [["createdAt", "DESC"]],
  });
  return res.json({ purchases });
});

router.post("/admin/coupons/expire", authenticate, authorize("admin"), async (req, res) => {
  const expiredCount = await expireOldCouponPurchases();
  await writeAuditLog(req, "coupon.expire_old", {
    entityType: "CouponPurchase",
    metadata: { expiredCount },
  });
  return res.json({ expiredCount });
});

module.exports = router;
