const express = require("express");
const upload = require("../middlewares/uploads");
const { User, StepEntry, CouponPurchase, Coupon, Brand } = require("../models");
const { authenticate } = require("../middlewares/auth");
const { publicUser, toNumber } = require("../utils/http");

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
  return res.json({ purchases });
});

router.get("/profile/month-stats", authenticate, async (req, res) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const entries = await StepEntry.findAll({
    where: { userId: req.user.id, date: { [require("sequelize").Op.gte]: start } },
    order: [["date", "ASC"]],
  });

  const totals = entries.reduce((acc, entry) => {
    acc.steps += entry.steps;
    acc.calories += entry.calories;
    acc.points += entry.pointsEarned;
    return acc;
  }, { steps: 0, calories: 0, points: 0 });

  return res.json({ totals, days: entries });
});

module.exports = router;
