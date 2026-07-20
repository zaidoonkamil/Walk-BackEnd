function toNumber(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === "true" || value === "1" || value === 1;
}

function publicUser(user) {
  if (!user) return null;
  const json = user.toJSON ? user.toJSON() : { ...user };
  delete json.password;
  return json;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

module.exports = { toNumber, toBool, publicUser, addDays };
