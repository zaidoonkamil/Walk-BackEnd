const User = require("./user");
const UserDevice = require("./user_device");
const UserRating = require("./user_rating");
const AdminSession = require("./admin_session");
const AuditLog = require("./audit_log");
const NotificationLog = require("./notification_log");
const Ads = require("./ads");
const BrandCategory = require("./brand_category");
const Brand = require("./brand");
const BrandSocialLink = require("./brand_social_link");
const StepEntry = require("./step_entry");
const PointTransaction = require("./point_transaction");
const Coupon = require("./coupon");
const CouponPurchase = require("./coupon_purchase");
const CouponCartItem = require("./coupon_cart_item");
const CommissionLog = require("./commission_log");
const FeaturedSection = require("./featured_section");
const FeaturedBrand = require("./featured_brand");

User.hasMany(UserDevice, { foreignKey: "user_id", as: "devices", onDelete: "CASCADE" });
UserDevice.belongsTo(User, { foreignKey: "user_id", as: "user", onDelete: "CASCADE" });

User.hasMany(UserRating, { foreignKey: "userId", as: "ratings", onDelete: "CASCADE" });
UserRating.belongsTo(User, { foreignKey: "userId", as: "ratedUser", onDelete: "CASCADE" });
User.hasMany(UserRating, { foreignKey: "ratedByUserId", as: "givenRatings", onDelete: "CASCADE" });
UserRating.belongsTo(User, { foreignKey: "ratedByUserId", as: "ratedBy", onDelete: "CASCADE" });

User.hasMany(AdminSession, { foreignKey: "userId", as: "adminSessions", onDelete: "CASCADE" });
AdminSession.belongsTo(User, { foreignKey: "userId", as: "admin", onDelete: "CASCADE" });
User.hasMany(AuditLog, { foreignKey: "actorId", as: "auditLogs", onDelete: "SET NULL" });
AuditLog.belongsTo(User, { foreignKey: "actorId", as: "actor", onDelete: "SET NULL" });

BrandCategory.hasMany(Brand, { foreignKey: "categoryId", as: "brands", onDelete: "SET NULL" });
Brand.belongsTo(BrandCategory, { foreignKey: "categoryId", as: "category", onDelete: "SET NULL" });

User.hasMany(Brand, { foreignKey: "ownerId", as: "ownedBrands", onDelete: "SET NULL" });
Brand.belongsTo(User, { foreignKey: "ownerId", as: "owner", onDelete: "SET NULL" });

Brand.hasMany(BrandSocialLink, { foreignKey: "brandId", as: "socialLinks", onDelete: "CASCADE" });
BrandSocialLink.belongsTo(Brand, { foreignKey: "brandId", as: "brand", onDelete: "CASCADE" });

User.hasMany(StepEntry, { foreignKey: "userId", as: "stepEntries", onDelete: "CASCADE" });
StepEntry.belongsTo(User, { foreignKey: "userId", as: "user", onDelete: "CASCADE" });

User.hasMany(PointTransaction, { foreignKey: "userId", as: "pointTransactions", onDelete: "CASCADE" });
PointTransaction.belongsTo(User, { foreignKey: "userId", as: "user", onDelete: "CASCADE" });

Brand.hasMany(Coupon, { foreignKey: "brandId", as: "coupons", onDelete: "CASCADE" });
Coupon.belongsTo(Brand, { foreignKey: "brandId", as: "brand", onDelete: "CASCADE" });
User.hasMany(Coupon, { foreignKey: "createdById", as: "createdCoupons", onDelete: "SET NULL" });
Coupon.belongsTo(User, { foreignKey: "createdById", as: "createdBy", onDelete: "SET NULL" });

User.hasMany(CouponPurchase, { foreignKey: "userId", as: "couponPurchases", onDelete: "CASCADE" });
CouponPurchase.belongsTo(User, { foreignKey: "userId", as: "user", onDelete: "CASCADE" });
Coupon.hasMany(CouponPurchase, { foreignKey: "couponId", as: "purchases", onDelete: "CASCADE" });
CouponPurchase.belongsTo(Coupon, { foreignKey: "couponId", as: "coupon", onDelete: "CASCADE" });
Brand.hasMany(CouponPurchase, { foreignKey: "brandId", as: "couponPurchases", onDelete: "CASCADE" });
CouponPurchase.belongsTo(Brand, { foreignKey: "brandId", as: "brand", onDelete: "CASCADE" });
CouponPurchase.belongsTo(User, { foreignKey: "redeemedById", as: "redeemedBy", onDelete: "SET NULL" });

User.hasMany(CouponCartItem, { foreignKey: "userId", as: "couponCartItems", onDelete: "CASCADE" });
CouponCartItem.belongsTo(User, { foreignKey: "userId", as: "user", onDelete: "CASCADE" });
Coupon.hasMany(CouponCartItem, { foreignKey: "couponId", as: "cartItems", onDelete: "CASCADE" });
CouponCartItem.belongsTo(Coupon, { foreignKey: "couponId", as: "coupon", onDelete: "CASCADE" });

Brand.hasMany(CommissionLog, { foreignKey: "brandId", as: "commissionLogs", onDelete: "CASCADE" });
CommissionLog.belongsTo(Brand, { foreignKey: "brandId", as: "brand", onDelete: "CASCADE" });
CouponPurchase.hasOne(CommissionLog, { foreignKey: "couponPurchaseId", as: "commissionLog", onDelete: "CASCADE" });
CommissionLog.belongsTo(CouponPurchase, { foreignKey: "couponPurchaseId", as: "couponPurchase", onDelete: "CASCADE" });

FeaturedSection.hasMany(FeaturedBrand, { foreignKey: "sectionId", as: "items", onDelete: "CASCADE" });
FeaturedBrand.belongsTo(FeaturedSection, { foreignKey: "sectionId", as: "section", onDelete: "CASCADE" });
Brand.hasMany(FeaturedBrand, { foreignKey: "brandId", as: "featuredLinks", onDelete: "CASCADE" });
FeaturedBrand.belongsTo(Brand, { foreignKey: "brandId", as: "brand", onDelete: "CASCADE" });

module.exports = {
  User,
  UserDevice,
  UserRating,
  AdminSession,
  AuditLog,
  NotificationLog,
  Ads,
  BrandCategory,
  Brand,
  BrandSocialLink,
  StepEntry,
  PointTransaction,
  Coupon,
  CouponPurchase,
  CouponCartItem,
  CommissionLog,
  FeaturedSection,
  FeaturedBrand,
};
