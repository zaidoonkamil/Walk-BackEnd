const express = require("express");
const { Op } = require("sequelize");
const sequelize = require("../config/db");
const { User, StepEntry, PointTransaction } = require("../models");
const { authenticate } = require("../middlewares/auth");
const { toNumber } = require("../utils/http");

const router = express.Router();
const DEFAULT_STEPS_PER_POINT = 5000;
const DEFAULT_IQD_PER_POINT = 1000;
const DEFAULT_MAX_DAILY_STEPS = 50000;

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function stepsRule() {
  const stepsPerPoint = Number(process.env.STEPS_PER_POINT || DEFAULT_STEPS_PER_POINT);
  const iqdPerPoint = Number(process.env.IQD_PER_POINT || DEFAULT_IQD_PER_POINT);
  const maxDailySteps = Number(process.env.MAX_DAILY_STEPS || DEFAULT_MAX_DAILY_STEPS);
  const defaultDailyPointsLimit = Math.floor(maxDailySteps / Math.max(1, stepsPerPoint));
  const dailyPointsLimit = Number(process.env.DAILY_POINTS_LIMIT || defaultDailyPointsLimit);
  return { stepsPerPoint, iqdPerPoint, maxDailySteps, dailyPointsLimit };
}

function calculatePoints(steps) {
  const { stepsPerPoint, dailyPointsLimit } = stepsRule();
  return Math.min(dailyPointsLimit, Math.floor(Math.max(0, steps) / stepsPerPoint));
}

function validateStepPayload({ steps, source, deviceId }) {
  const { maxDailySteps } = stepsRule();
  const trustedSources = ["pedometer", "google_fit", "health_connect", "healthkit"];

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

function buildAchievement({ id, title, description, target, progress, unit, color, icon }) {
  const safeTarget = Math.max(1, Number(target || 1));
  const safeProgress = Math.max(0, Math.floor(Number(progress || 0)));
  return {
    id,
    title,
    description,
    target: safeTarget,
    progress: safeProgress,
    unit,
    percent: Math.min(1, Number((safeProgress / safeTarget).toFixed(4))),
    unlocked: safeProgress >= safeTarget,
    color,
    icon,
  };
}

function buildAchievements({ user, todayEntry, weekTotals }) {
  const todaySteps = todayEntry?.steps || 0;
  const todayCalories = Math.round(todayEntry?.calories || 0);
  const todayDistanceMeters = Math.round((todayEntry?.distanceKm || 0) * 1000);

  return [
    buildAchievement({
      id: "daily_10k",
      title: "10K خطوة",
      description: "حقق 10,000 خطوة بيوم واحد",
      target: 10000,
      progress: todaySteps,
      unit: "خطوة",
      color: "#7B61FF",
      icon: "cup",
    }),
    buildAchievement({
      id: "daily_calories_500",
      title: "500 كالوري",
      description: "احرق 500 كالوري خلال اليوم",
      target: 500,
      progress: todayCalories,
      unit: "كالوري",
      color: "#F2A51E",
      icon: "medal_star",
    }),
    buildAchievement({
      id: "active_week",
      title: "أسبوع نشط",
      description: "حقق هدفك في 5 أيام خلال آخر أسبوع",
      target: 5,
      progress: weekTotals.goalDays,
      unit: "أيام",
      color: "#27B66F",
      icon: "calendar_tick",
    }),
    buildAchievement({
      id: "monthly_25k",
      title: "25K خطوة",
      description: "اجمع 25,000 خطوة بالمجموع",
      target: 25000,
      progress: user.totalSteps,
      unit: "خطوة",
      color: "#2F8BE8",
      icon: "award",
    }),
    buildAchievement({
      id: "first_points_100",
      title: "100 نقطة",
      description: "اجمع أول 100 نقطة من المشي",
      target: 100,
      progress: user.points,
      unit: "نقطة",
      color: "#9B59B6",
      icon: "star",
    }),
    buildAchievement({
      id: "daily_distance_5k",
      title: "5 كم",
      description: "امش 5 كم خلال اليوم",
      target: 5000,
      progress: todayDistanceMeters,
      unit: "متر",
      color: "#32C7B5",
      icon: "route",
    }),
  ];
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
  const rule = stepsRule();

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
      iqdEarned: (entry?.pointsEarned || 0) * rule.iqdPerPoint,
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
      stepsPerPoint: rule.stepsPerPoint,
      iqdPerPoint: rule.iqdPerPoint,
      dailyPointsLimit: rule.dailyPointsLimit,
      maxDailySteps: rule.maxDailySteps,
    },
    dailyGoal: user.dailyStepGoal,
    today: {
      steps: todayEntry?.steps || 0,
      calories: todayEntry?.calories || 0,
      distanceKm: todayEntry?.distanceKm || Number(((todayEntry?.steps || 0) * 0.00075).toFixed(2)),
      activeMinutes: todayEntry?.activeMinutes || Math.round((todayEntry?.steps || 0) / 100),
      pointsEarned: todayEntry?.pointsEarned || 0,
      iqdEarned: (todayEntry?.pointsEarned || 0) * rule.iqdPerPoint,
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
    achievements: buildAchievements({ user, todayEntry, weekTotals }),
  });
});

module.exports = router;
