const { Op } = require("sequelize");
const { CouponPurchase } = require("../models");

async function expireOldCouponPurchases() {
  const [updatedCount] = await CouponPurchase.update(
    { status: "expired" },
    {
      where: {
        status: "active",
        expiresAt: { [Op.lt]: new Date() },
      },
    }
  );

  return updatedCount;
}

module.exports = { expireOldCouponPurchases };
