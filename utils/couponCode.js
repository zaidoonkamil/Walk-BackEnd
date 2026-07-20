const crypto = require("crypto");

function generateCouponCode() {
  const left = crypto.randomBytes(3).toString("hex").toUpperCase();
  const right = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `WLK-${left}-${right}`;
}

module.exports = { generateCouponCode };
