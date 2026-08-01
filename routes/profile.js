const express = require("express");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const upload = require("../middlewares/uploads");
const QRCode = require("qrcode");
const { User, StepEntry, CouponPurchase, Coupon, Brand } = require("../models");
const { authenticate } = require("../middlewares/auth");
const { publicUser, toNumber } = require("../utils/http");
const { validatePasswordStrength } = require("../utils/security");
const { expireOldCouponPurchases } = require("../services/couponExpiry");

const router = express.Router();

const DEFAULT_IQD_PER_POINT = 1000;

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function monthDayLabel(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  return new Intl.DateTimeFormat("ar", { weekday: "short" }).format(date);
}

function monthStatsRule() {
  return {
    iqdPerPoint: Number(process.env.IQD_PER_POINT || DEFAULT_IQD_PER_POINT),
  };
}

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
  await expireOldCouponPurchases();
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
  const available = purchasesWithQr.filter((purchase) => purchase.status === "active");
  const expired = purchasesWithQr.filter((purchase) => purchase.status !== "active");
  return res.json({
    summary: {
      total: purchasesWithQr.length,
      available: available.length,
      expired: expired.length,
      totalSavings: 0,
    },
    available,
    expired,
    purchases: purchasesWithQr,
  });
});

router.get("/profile/month-stats", authenticate, async (req, res) => {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = dateKey(startDate);
  const end = dateKey(now);
  const rule = monthStatsRule();
  const user = await User.findByPk(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const entries = await StepEntry.findAll({
    where: { userId: req.user.id, date: { [Op.between]: [start, end] } },
    order: [["date", "ASC"]],
  });

  const byDate = new Map(entries.map((entry) => [entry.date, entry]));
  const days = [];
  for (const cursor = new Date(startDate); cursor <= now; cursor.setDate(cursor.getDate() + 1)) {
    const date = dateKey(cursor);
    const entry = byDate.get(date);
    const steps = entry?.steps || 0;
    const calories = entry?.calories || 0;
    const distanceKm = entry?.distanceKm || Number((steps * 0.00075).toFixed(2));
    const activeMinutes = entry?.activeMinutes || Math.round(steps / 100);
    const pointsEarned = entry?.pointsEarned || 0;
    days.push({
      date,
      label: date === end ? "اليوم" : monthDayLabel(date),
      steps,
      calories,
      distanceKm,
      activeMinutes,
      pointsEarned,
      iqdEarned: pointsEarned * rule.iqdPerPoint,
      source: entry?.source || null,
      sourceName: entry?.sourceName || null,
      isTrusted: Boolean(entry?.isTrusted),
    });
  }

  const totals = days.reduce((acc, day) => {
    acc.steps += day.steps;
    acc.calories += day.calories;
    acc.distanceKm += day.distanceKm;
    acc.activeMinutes += day.activeMinutes;
    acc.points += day.pointsEarned;
    acc.iqd += day.iqdEarned;
    acc.goalDays += day.steps >= user.dailyStepGoal ? 1 : 0;
    return acc;
  }, { steps: 0, calories: 0, distanceKm: 0, activeMinutes: 0, points: 0, iqd: 0, goalDays: 0 });

  return res.json({
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    dailyGoal: user.dailyStepGoal,
    totals: {
      ...totals,
      calories: Number(totals.calories.toFixed(2)),
      distanceKm: Number(totals.distanceKm.toFixed(2)),
      averageSteps: days.length ? Math.round(totals.steps / days.length) : 0,
    },
    days,
  });
});

module.exports = router;
