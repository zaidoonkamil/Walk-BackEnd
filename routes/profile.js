const express = require("express");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const upload = require("../middlewares/uploads");
const QRCode = require("qrcode");
const { User, StepEntry, CouponPurchase, Coupon, Brand } = require("../models");
const { authenticate } = require("../middlewares/auth");
const { publicUser, toNumber } = require("../utils/http");
const { validatePasswordStrength } = require("../utils/security");

const router = express.Router();

router.get("/profile", authenticate, async (req, res) => {
  const user = await User.findByPk(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const activeCoupons = await CouponPurchase.count({
    where: { userId: user.id, status: "active" },
  });

  return res.json({ user: publicUser(user), activeCoupons });
});

router.patch("/profile", authenticate, upload.single("image"), async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const fields = [
      "name",
      "location",
      "language",
      "facebookUrl",
      "instagramUrl",
      "tiktokUrl",
      "whatsappSupportUrl",
    ];
    fields.forEach((field) => {
      if (req.body[field] !== undefined) user[field] = String(req.body[field]).trim();
    });

    if (req.body.phone !== undefined) {
      const phone = String(req.body.phone || "").trim();
      if (!phone) return res.status(400).json({ error: "phone is required" });
      const exists = await User.unscoped().findOne({
        where: { phone, id: { [Op.ne]: user.id } },
      });
      if (exists) return res.status(409).json({ error: "Phone already exists" });
      user.phone = phone;
    }

    if (req.body.password !== undefined && String(req.body.password || "").trim()) {
      const password = String(req.body.password || "");
      const passwordError = validatePasswordStrength(password, user.role);
      if (passwordError) return res.status(400).json({ error: passwordError });
      user.password = await bcrypt.hash(password, 10);
      user.passwordChangedAt = new Date();
    }

    if (req.body.dailyStepGoal !== undefined) {
      user.dailyStepGoal = toNumber(req.body.dailyStepGoal, user.dailyStepGoal);
    }
    if (req.file) user.image = req.file.filename;

    await user.save();
    return res.json({ user: publicUser(user) });
  } catch (error) {
    console.error("Update profile error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/profile/coupons", authenticate, async (req, res) => {
  const purchases = await CouponPurchase.findAll({
    where: { userId: req.user.id },
    include: [
      { model: Coupon, as: "coupon" },
      { model: Brand, as: "brand" },
    ],
    order: [["createdAt", "DESC"]],
  });
  const purchasesWithQr = await Promise.all(
    purchases.map(async (purchase) => {
      const json = purchase.toJSON();
      return {
        ...json,
        qrCodeDataUrl: await QRCode.toDataURL(json.qrPayload || json.code),
      };
    }),
  );
  return res.json({ purchases: purchasesWithQr });
});

router.get("/profile/month-stats", authenticate, async (req, res) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const user = await User.findByPk(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const entries = await StepEntry.findAll({
    where: { userId: req.user.id, date: { [Op.gte]: start } },
    order: [["date", "ASC"]],
  });

  const totals = entries.reduce((acc, entry) => {
    acc.steps += entry.steps;
    acc.calories += entry.calories;
    acc.distanceKm += entry.distanceKm;
    acc.activeMinutes += entry.activeMinutes;
    acc.points += entry.pointsEarned;
    acc.iqd += entry.iqdEarned || 0;
    acc.goalDays += entry.steps >= user.dailyStepGoal ? 1 : 0;
    return acc;
  }, { steps: 0, calories: 0, distanceKm: 0, activeMinutes: 0, points: 0, iqd: 0, goalDays: 0 });

  return res.json({
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    dailyGoal: user.dailyStepGoal,
    totals: {
      ...totals,
      calories: Number(totals.calories.toFixed(2)),
      distanceKm: Number(totals.distanceKm.toFixed(2)),
      averageSteps: entries.length ? Math.round(totals.steps / entries.length) : 0,
    },
    days: entries,
  });
});

module.exports = router;
