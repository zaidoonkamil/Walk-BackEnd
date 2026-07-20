const express = require("express");
const { Op } = require("sequelize");
const sequelize = require("../config/db");
const { User, StepEntry, PointTransaction } = require("../models");
const { authenticate } = require("../middlewares/auth");
const { toNumber } = require("../utils/http");

const router = express.Router();

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function calculatePoints(steps) {
  const stepsPerPoint = Number(process.env.STEPS_PER_POINT || 100);
  const dailyPointsLimit = Number(process.env.DAILY_POINTS_LIMIT || 200);
  return Math.min(dailyPointsLimit, Math.floor(Math.max(0, steps) / stepsPerPoint));
}

function validateStepPayload({ steps, source, deviceId }) {
  const maxDailySteps = Number(process.env.MAX_DAILY_STEPS || 50000);
  const trustedSources = ["pedometer", "google_fit", "healthkit"];

  if (steps < 0) return "steps must be positive";
  if (steps > maxDailySteps) return `steps exceeds daily limit of ${maxDailySteps}`;
  if (!["manual", ...trustedSources].includes(source)) return "Invalid steps source";
  if (trustedSources.includes(source) && !deviceId) return "deviceId is required for trusted sources";
  return null;
}

function weekDayLabel(dateText) {
  const date = new Date(`${dateText}T12:00:00Z`);
  return ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"][date.getUTCDay()];
}

async function refreshUserTotals(user, transaction) {
  const entries = await StepEntry.findAll({
    where: { userId: user.id },
    order: [["date", "DESC"]],
    transaction,
  });

  user.totalSteps = entries.reduce((sum, entry) => sum + entry.steps, 0);
  user.totalCalories = entries.reduce((sum, entry) => sum + entry.calories, 0);

  let streak = 0;
  const byDate = new Map(entries.map((entry) => [entry.date, entry]));
  for (let cursor = new Date(); ; cursor.setDate(cursor.getDate() - 1)) {
    const key = todayKey(cursor);
    const entry = byDate.get(key);
    if (!entry || entry.steps < user.dailyStepGoal) break;
    streak += 1;
  }
  user.currentStreakDays = streak;
  user.longestStreakDays = Math.max(user.longestStreakDays, streak);
  await user.save({ transaction });
}

router.post("/steps", authenticate, async (req, res) => {
  let transaction;
  try {
    const date = String(req.body.date || todayKey()).slice(0, 10);
    const steps = toNumber(req.body.steps, 0);
    const calories = toNumber(req.body.calories, Number((steps * 0.04).toFixed(2)));
    const distanceKm = toNumber(req.body.distanceKm, Number((steps * 0.00075).toFixed(2)));
    const activeMinutes = toNumber(req.body.activeMinutes, Math.round(steps / 100));
    const source = String(req.body.source || "manual").trim();
    const deviceId = req.body.deviceId ? String(req.body.deviceId).trim() : null;
    const sourceName = req.body.sourceName ? String(req.body.sourceName).trim().slice(0, 120) : null;
    const isTrusted = ["pedometer", "google_fit", "health_connect", "healthkit"].includes(source);
    const rejectedReason = validateStepPayload({ steps, source, deviceId });

    if (rejectedReason) return res.status(400).json({ error: rejectedReason });

    transaction = await sequelize.transaction();

    const user = await User.findByPk(req.user.id, { transaction, lock: true });
    if (!user) {
      await transaction.rollback();
      return res.status(404).json({ error: "User not found" });
    }

    let entry = await StepEntry.findOne({
      where: { userId: user.id, date },
      transaction,
      lock: true,
    });

    const oldPoints = entry ? entry.pointsEarned : 0;
    const pointsEarned = calculatePoints(steps);
    const pointDelta = pointsEarned - oldPoints;

    if (!entry) {
      entry = await StepEntry.create({
        userId: user.id,
        date,
        steps,
        calories,
        distanceKm,
        activeMinutes,
        pointsEarned,
        source,
        deviceId,
        sourceName,
        isTrusted,
      }, { transaction });
    } else {
      entry.steps = steps;
      entry.calories = calories;
      entry.distanceKm = distanceKm;
      entry.activeMinutes = activeMinutes;
      entry.pointsEarned = pointsEarned;
      entry.source = source;
      entry.deviceId = deviceId;
      entry.sourceName = sourceName;
      entry.isTrusted = isTrusted;
      entry.rejectedReason = null;
      await entry.save({ transaction });
    }

    if (pointDelta !== 0) {
      user.points += pointDelta;
      await PointTransaction.create({
        userId: user.id,
        type: "earn_steps",
        points: pointDelta,
        description: `Steps for ${date}`,
      }, { transaction });
    }

    await refreshUserTotals(user, transaction);
    await transaction.commit();
    return res.json({ entry, user: { points: user.points, totalSteps: user.totalSteps, currentStreakDays: user.currentStreakDays } });
  } catch (error) {
    if (transaction) await transaction.rollback();
    console.error("Steps update error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/steps/dashboard", authenticate, async (req, res) => {
  const user = await User.findByPk(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const today = todayKey();
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);

  const entries = await StepEntry.findAll({
    where: {
      userId: user.id,
      date: { [Op.gte]: todayKey(weekStart) },
    },
    order: [["date", "ASC"]],
  });

  const todayEntry = entries.find((entry) => entry.date === today) || null;
  const byDate = new Map(entries.map((entry) => [entry.date, entry]));
  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const cursor = new Date();
    cursor.setDate(cursor.getDate() - offset);
    const date = todayKey(cursor);
    const entry = byDate.get(date);
    days.push({
      date,
      label: offset === 0 ? "اليوم" : weekDayLabel(date),
      steps: entry?.steps || 0,
      calories: entry?.calories || 0,
      distanceKm: entry?.distanceKm || Number(((entry?.steps || 0) * 0.00075).toFixed(2)),
      activeMinutes: entry?.activeMinutes || Math.round((entry?.steps || 0) / 100),
      pointsEarned: entry?.pointsEarned || 0,
      source: entry?.source || null,
      sourceName: entry?.sourceName || null,
      isTrusted: Boolean(entry?.isTrusted),
    });
  }
  const weekTotals = days.reduce((totals, day) => ({
    steps: totals.steps + day.steps,
    calories: totals.calories + day.calories,
    distanceKm: totals.distanceKm + day.distanceKm,
    activeMinutes: totals.activeMinutes + day.activeMinutes,
    goalDays: totals.goalDays + (day.steps >= user.dailyStepGoal ? 1 : 0),
  }), { steps: 0, calories: 0, distanceKm: 0, activeMinutes: 0, goalDays: 0 });

  return res.json({
    points: user.points,
    pointsRule: {
      stepsPerPoint: Number(process.env.STEPS_PER_POINT || 100),
      dailyPointsLimit: Number(process.env.DAILY_POINTS_LIMIT || 200),
      maxDailySteps: Number(process.env.MAX_DAILY_STEPS || 50000),
    },
    dailyGoal: user.dailyStepGoal,
    today: {
      steps: todayEntry?.steps || 0,
      calories: todayEntry?.calories || 0,
      distanceKm: todayEntry?.distanceKm || Number(((todayEntry?.steps || 0) * 0.00075).toFixed(2)),
      activeMinutes: todayEntry?.activeMinutes || Math.round((todayEntry?.steps || 0) / 100),
      pointsEarned: todayEntry?.pointsEarned || 0,
      goalProgress: user.dailyStepGoal ? Math.min(1, (todayEntry?.steps || 0) / user.dailyStepGoal) : 0,
      source: todayEntry?.source || null,
      sourceName: todayEntry?.sourceName || null,
      isTrusted: Boolean(todayEntry?.isTrusted),
    },
    totals: {
      steps: user.totalSteps,
      calories: user.totalCalories,
      currentStreakDays: user.currentStreakDays,
      longestStreakDays: user.longestStreakDays,
    },
    weekTotals: {
      ...weekTotals,
      distanceKm: Number(weekTotals.distanceKm.toFixed(2)),
      averageSteps: Math.round(weekTotals.steps / 7),
    },
    last7Days: days,
  });
});

module.exports = router;
