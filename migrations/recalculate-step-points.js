const sequelize = require("../config/db");
const { User, StepEntry, PointTransaction } = require("../models");

const DEFAULT_STEPS_PER_POINT = 5000;
const DEFAULT_MAX_DAILY_STEPS = 50000;

function pointsRule() {
  const stepsPerPoint = Number(process.env.STEPS_PER_POINT || DEFAULT_STEPS_PER_POINT);
  const maxDailySteps = Number(process.env.MAX_DAILY_STEPS || DEFAULT_MAX_DAILY_STEPS);
  const defaultDailyPointsLimit = Math.floor(maxDailySteps / Math.max(1, stepsPerPoint));
  const dailyPointsLimit = Number(process.env.DAILY_POINTS_LIMIT || defaultDailyPointsLimit);
  return { stepsPerPoint, dailyPointsLimit };
}

function calculatePoints(steps) {
  const { stepsPerPoint, dailyPointsLimit } = pointsRule();
  return Math.min(dailyPointsLimit, Math.floor(Math.max(0, steps) / stepsPerPoint));
}

async function main() {
  const apply = process.env.APPLY_STEP_POINTS_RECALC === "true";
  const users = await User.unscoped().findAll();

  let changedUsers = 0;
  let changedEntries = 0;

  for (const user of users) {
    const entries = await StepEntry.findAll({ where: { userId: user.id } });
    const transactions = await PointTransaction.findAll({ where: { userId: user.id } });
    const nonStepPoints = transactions
      .filter((transaction) => transaction.type !== "earn_steps")
      .reduce((sum, transaction) => sum + transaction.points, 0);

    let earnedPoints = 0;
    for (const entry of entries) {
      const nextPoints = calculatePoints(entry.steps);
      earnedPoints += nextPoints;
      if (entry.pointsEarned !== nextPoints) {
        changedEntries += 1;
        if (apply) {
          entry.pointsEarned = nextPoints;
          await entry.save();
        }
      }
    }

    const nextBalance = earnedPoints + nonStepPoints;
    if (user.points !== nextBalance) {
      changedUsers += 1;
      if (apply) {
        user.points = nextBalance;
        await user.save();
      }
    }
  }

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    changedUsers,
    changedEntries,
    rule: pointsRule(),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
