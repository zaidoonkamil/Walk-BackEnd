const express = require("express");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const sequelize = require("../config/db");
const upload = require("../middlewares/uploads");
const { authenticate, authorize } = require("../middlewares/auth");
const {
  BrandCategory,
  Brand,
  BrandSocialLink,
  Coupon,
  User,
  UserInterest,
  UserDevice,
  AdminSession,
  CouponCartItem,
  StepEntry,
  PointTransaction,
  UserRating,
  CouponPurchase,
  AuditLog,
  NotificationLog,
  FeaturedBrand,
} = require("../models");
const { toBool, toNumber } = require("../utils/http");
const { validatePasswordStrength } = require("../utils/security");

const router = express.Router();

function uploadUrl(req, image) {
  const text = String(image || "").trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  const baseUrl = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  return `${baseUrl}/uploads/${text}`;
}

function withImageUrl(req, item) {
  const json = item.toJSON ? item.toJSON() : item;
  const socialLinks = Array.isArray(json.socialLinks)
    ? json.socialLinks.filter((link) => SOCIAL_PLATFORMS.has(String(link.platform || "").toLowerCase()) && link.url)
    : [];
  return { ...json, socialLinks, imageUrl: uploadUrl(req, json.image) };
}

const brandInclude = [
  { model: BrandCategory, as: "category" },
  { model: BrandSocialLink, as: "socialLinks" },
];

const SOCIAL_PLATFORMS = new Set(["facebook", "instagram", "tiktok", "whatsapp"]);

function parseSocialLinks(body) {
  if (!body.socialLinks) return [];
  if (Array.isArray(body.socialLinks)) return body.socialLinks;
  try {
    const parsed = JSON.parse(body.socialLinks);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function sanitizeSocialLinks(body) {
  return parseSocialLinks(body)
    .map((link) => ({
      platform: String(link.platform || "").trim().toLowerCase(),
      url: String(link.url || "").trim(),
    }))
    .filter((link) => SOCIAL_PLATFORMS.has(link.platform) && link.url);
}

function validateCoordinates(latitude, longitude) {
  if (latitude === null && longitude === null) return null;
  if (latitude === null || longitude === null) return "latitude and longitude must be sent together";
  if (latitude < -90 || latitude > 90) return "latitude must be between -90 and 90";
  if (longitude < -180 || longitude > 180) return "longitude must be between -180 and 180";
  return null;
}

function normalizePhone(phone) {
  return String(phone || "").trim().replace(/\s+/g, "");
}

async function resolveBrandOwner(req, name, fallbackLocation) {
  const explicitOwnerId = toNumber(req.body.ownerId);
  if (explicitOwnerId) {
    const owner = await User.findByPk(explicitOwnerId);
    if (!owner) {
      const error = new Error("Brand owner account not found");
      error.status = 404;
      throw error;
    }
    return owner.id;
  }

  const password = String(req.body.password || "").trim();
  if (!password) {
    const error = new Error("brand account password is required");
    error.status = 400;
    throw error;
  }

  const phone = normalizePhone(req.body.accountPhone || req.body.phone);
  if (!phone) {
    const error = new Error("brand account phone is required");
    error.status = 400;
    throw error;
  }

  const passwordError = validatePasswordStrength(password, "brand");
  if (passwordError) {
    const error = new Error(passwordError);
    error.status = 400;
    throw error;
  }

  const exists = await User.unscoped().findOne({ where: { phone } });
  if (exists) {
    if (exists.role === "brand") return exists.id;
    const error = new Error("Phone number already exists");
    error.status = 409;
    throw error;
  }

  const owner = await User.create({
    name,
    phone,
    role: "brand",
    location: req.body.locationText || fallbackLocation || null,
    password: await bcrypt.hash(password, 10),
    passwordChangedAt: new Date(),
    isVerified: true,
  });
  return owner.id;
}

function generatedBrandPhone(brandId) {
  return `brand-${brandId}`;
}

async function createOwnerForBrand(brand, password) {
  const desiredPhone = normalizePhone(brand.phone) || generatedBrandPhone(brand.id);
  let phone = desiredPhone;
  const existing = await User.unscoped().findOne({ where: { phone } });
  if (existing) {
    if (existing.role === "brand") {
      existing.password = await bcrypt.hash(password, 10);
      existing.passwordChangedAt = new Date();
      await existing.save();
      return existing;
    }
    phone = generatedBrandPhone(brand.id);
  }

  let suffix = 0;
  while (await User.unscoped().findOne({ where: { phone } })) {
    suffix += 1;
    phone = `${generatedBrandPhone(brand.id)}-${suffix}`;
  }

  return User.create({
    name: brand.name,
    phone,
    role: "brand",
    location: brand.locationText || null,
    password: await bcrypt.hash(password, 10),
    passwordChangedAt: new Date(),
    isVerified: true,
  });
}

router.get("/categories", async (req, res) => {
  const categories = await BrandCategory.findAll({
    where: { isActive: true },
    order: [["sortOrder", "ASC"], ["name", "ASC"]],
  });
  return res.json({ categories: categories.map((category) => withImageUrl(req, category)) });
});

router.get("/brands", async (req, res) => {
  const where = { isActive: true };
  if (req.query.categoryId) where.categoryId = req.query.categoryId;
  if (req.query.featured !== undefined) where.isFeatured = toBool(req.query.featured);
  if (req.query.q) where.name = { [Op.like]: `%${req.query.q}%` };

  const brands = await Brand.findAll({
    where,
    include: brandInclude,
    order: [["popularityScore", "DESC"], ["createdAt", "DESC"]],
  });
  return res.json({ brands: brands.map((brand) => withImageUrl(req, brand)) });
});

router.get("/brands/:id", async (req, res) => {
  const brand = await Brand.findByPk(req.params.id, {
    include: [...brandInclude, { model: Coupon, as: "coupons", where: { isActive: true }, required: false }],
  });
  if (!brand || !brand.isActive) return res.status(404).json({ error: "Brand not found" });
  return res.json({ brand: withImageUrl(req, brand) });
});

router.get("/admin/categories", authenticate, authorize("admin"), async (req, res) => {
  const where = {};
  if (req.query.includeInactive !== "true") where.isActive = true;
  const categories = await BrandCategory.findAll({
    where,
    order: [["sortOrder", "ASC"], ["name", "ASC"]],
  });
  return res.json({ categories: categories.map((category) => withImageUrl(req, category)) });
});

router.get("/admin/brands", authenticate, authorize("admin"), async (req, res) => {
  const where = {};
  if (req.query.includeInactive !== "true") where.isActive = true;
  if (req.query.categoryId) where.categoryId = req.query.categoryId;
  if (req.query.q) where.name = { [Op.like]: `%${req.query.q}%` };

  const brands = await Brand.findAll({
    where,
    include: brandInclude,
    order: [["popularityScore", "DESC"], ["createdAt", "DESC"]],
  });
  return res.json({ brands: brands.map((brand) => withImageUrl(req, brand)) });
});

router.get("/interests", authenticate, async (req, res) => {
  try {
    const [categories, interests] = await Promise.all([
      BrandCategory.findAll({
        where: { isActive: true },
        order: [["sortOrder", "ASC"], ["name", "ASC"]],
      }),
      UserInterest.findAll({ where: { userId: req.user.id } }),
    ]);

    const selectedCategoryIds = interests.map((item) => item.categoryId);
    const selected = new Set(selectedCategoryIds);

    return res.json({
      selectedCategoryIds,
      categories: categories.map((category) => ({
        ...withImageUrl(req, category),
        isSelected: selected.has(category.id),
      })),
    });
  } catch (error) {
    console.error("Get interests error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/interests", authenticate, async (req, res) => {
  try {
    const categoryIds = Array.isArray(req.body.categoryIds)
      ? [...new Set(req.body.categoryIds.map((item) => toNumber(item)).filter((item) => item !== null))]
      : [];

    const activeCategories = await BrandCategory.findAll({
      where: { id: categoryIds, isActive: true },
      attributes: ["id"],
    });
    const validCategoryIds = activeCategories.map((category) => category.id);

    await UserInterest.destroy({ where: { userId: req.user.id } });
    if (validCategoryIds.length) {
      await UserInterest.bulkCreate(
        validCategoryIds.map((categoryId) => ({ userId: req.user.id, categoryId }))
      );
    }

    return res.json({ selectedCategoryIds: validCategoryIds });
  } catch (error) {
    console.error("Save interests error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/admin/categories", authenticate, authorize("admin"), upload.single("image"), async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });

    const category = await BrandCategory.create({
      name,
      description: req.body.description || null,
      image: req.file?.filename || req.body.image || null,
      icon: req.body.icon || null,
      sortOrder: toNumber(req.body.sortOrder, 0),
      isActive: toBool(req.body.isActive, true),
    });
    return res.status(201).json({ category: withImageUrl(req, category) });
  } catch (error) {
    console.error("Create category error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.patch("/admin/categories/:id", authenticate, authorize("admin"), upload.single("image"), async (req, res) => {
  try {
    const category = await BrandCategory.findByPk(req.params.id);
    if (!category) return res.status(404).json({ error: "Category not found" });

    ["name", "description", "icon"].forEach((field) => {
      if (req.body[field] !== undefined) category[field] = req.body[field];
    });
    if (req.body.sortOrder !== undefined) category.sortOrder = toNumber(req.body.sortOrder, category.sortOrder);
    if (req.body.isActive !== undefined) category.isActive = toBool(req.body.isActive, category.isActive);
    if (req.file) category.image = req.file.filename;
    await category.save();

    return res.json({ category: withImageUrl(req, category) });
  } catch (error) {
    console.error("Update category error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/admin/brands", authenticate, authorize("admin"), upload.single("image"), async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });
    const latitude = toNumber(req.body.latitude);
    const longitude = toNumber(req.body.longitude);
    const coordinatesError = validateCoordinates(latitude, longitude);
    if (coordinatesError) return res.status(400).json({ error: coordinatesError });

    const ownerId = await resolveBrandOwner(req, name, req.body.locationText);

    const brand = await Brand.create({
      name,
      categoryId: toNumber(req.body.categoryId),
      ownerId,
      description: req.body.description || null,
      image: req.file?.filename || req.body.image || null,
      locationText: req.body.locationText || null,
      latitude,
      longitude,
      websiteUrl: req.body.websiteUrl || null,
      phone: req.body.phone || null,
      defaultDiscountPercent: toNumber(req.body.defaultDiscountPercent, 0),
      commissionPercent: toNumber(req.body.commissionPercent, 0),
      isActive: toBool(req.body.isActive, true),
      isFeatured: toBool(req.body.isFeatured, false),
      popularityScore: toNumber(req.body.popularityScore, 0),
    });

    const links = sanitizeSocialLinks(req.body)
      .map((link) => ({ brandId: brand.id, platform: link.platform, url: link.url }));
    if (links.length) await BrandSocialLink.bulkCreate(links);

    const fresh = await Brand.findByPk(brand.id, { include: brandInclude });
    return res.status(201).json({ brand: withImageUrl(req, fresh) });
  } catch (error) {
    console.error("Create brand error:", error);
    return res.status(error.status || 500).json({ error: error.message || "Internal Server Error" });
  }
});

router.patch("/admin/brands/:id", authenticate, authorize("admin"), upload.single("image"), async (req, res) => {
  try {
    const brand = await Brand.findByPk(req.params.id);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    [
      "name",
      "description",
      "locationText",
      "websiteUrl",
      "phone",
    ].forEach((field) => {
      if (req.body[field] !== undefined) brand[field] = req.body[field];
    });

    const nextLatitude = req.body.latitude !== undefined ? toNumber(req.body.latitude) : brand.latitude;
    const nextLongitude = req.body.longitude !== undefined ? toNumber(req.body.longitude) : brand.longitude;
    const coordinatesError = validateCoordinates(nextLatitude, nextLongitude);
    if (coordinatesError) return res.status(400).json({ error: coordinatesError });

    ["categoryId", "ownerId", "defaultDiscountPercent", "commissionPercent", "popularityScore"].forEach((field) => {
      if (req.body[field] !== undefined) brand[field] = toNumber(req.body[field], brand[field]);
    });
    if (!brand.ownerId && String(req.body.password || "").trim()) {
      brand.ownerId = await resolveBrandOwner(req, brand.name, brand.locationText);
    }
    if (brand.ownerId && String(req.body.password || "").trim()) {
      const password = String(req.body.password || "");
      const passwordError = validatePasswordStrength(password, "brand");
      if (passwordError) return res.status(400).json({ error: passwordError });
      const owner = await User.unscoped().findByPk(brand.ownerId);
      if (owner) {
        owner.password = await bcrypt.hash(password, 10);
        owner.passwordChangedAt = new Date();
        await owner.save();
      }
    }
    brand.latitude = nextLatitude;
    brand.longitude = nextLongitude;
    ["isActive", "isFeatured"].forEach((field) => {
      if (req.body[field] !== undefined) brand[field] = toBool(req.body[field], brand[field]);
    });
    if (req.file) brand.image = req.file.filename;
    await brand.save();

    if (req.body.socialLinks !== undefined) {
      await BrandSocialLink.destroy({ where: { brandId: brand.id } });
      const links = sanitizeSocialLinks(req.body)
        .map((link) => ({ brandId: brand.id, platform: link.platform, url: link.url }));
      if (links.length) await BrandSocialLink.bulkCreate(links);
    }

    const fresh = await Brand.findByPk(brand.id, { include: brandInclude });
    return res.json({ brand: withImageUrl(req, fresh) });
  } catch (error) {
    console.error("Update brand error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.patch("/admin/brands/:id/owner-password", authenticate, authorize("admin"), async (req, res) => {
  try {
    const brand = await Brand.findByPk(req.params.id);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const password = String(req.body.password || "");
    const passwordError = validatePasswordStrength(password, "brand");
    if (passwordError) return res.status(400).json({ error: passwordError });

    let owner = brand.ownerId ? await User.unscoped().findByPk(brand.ownerId) : null;
    if (!owner) {
      owner = await createOwnerForBrand(brand, password);
      brand.ownerId = owner.id;
      await brand.save();
    } else {
      owner.password = await bcrypt.hash(password, 10);
      owner.passwordChangedAt = new Date();
      if (owner.role !== "brand") owner.role = "brand";
      await owner.save();
    }

    return res.json({ message: "Brand password updated successfully", ownerId: owner.id });
  } catch (error) {
    console.error("Update brand owner password error:", error);
    return res.status(error.status || 500).json({ error: error.message || "Internal Server Error" });
  }
});

router.delete("/admin/categories/:id", authenticate, authorize("admin"), async (req, res) => {
  const category = await BrandCategory.findByPk(req.params.id);
  if (!category) return res.status(404).json({ error: "Category not found" });
  category.isActive = false;
  await category.save();
  return res.json({ message: "Category disabled successfully" });
});

router.delete("/admin/brands/:id", authenticate, authorize("admin"), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const brand = await Brand.findByPk(req.params.id, { transaction });
    if (!brand) {
      await transaction.rollback();
      return res.status(404).json({ error: "Brand not found" });
    }

    const ownerId = brand.ownerId;
    brand.isActive = false;
    brand.ownerId = null;
    await brand.save({ transaction });
    await FeaturedBrand.destroy({ where: { brandId: brand.id }, transaction });

    let ownerDeleted = false;
    if (ownerId) {
      const activeBrands = await Brand.count({
        where: { ownerId, isActive: true },
        transaction,
      });
      const owner = await User.unscoped().findByPk(ownerId, { transaction });
      if (owner && owner.role === "brand" && activeBrands === 0) {
        await Promise.all([
          UserDevice.destroy({ where: { user_id: owner.id }, transaction }),
          AdminSession.destroy({ where: { userId: owner.id }, transaction }),
          UserInterest.destroy({ where: { userId: owner.id }, transaction }),
          CouponCartItem.destroy({ where: { userId: owner.id }, transaction }),
          StepEntry.destroy({ where: { userId: owner.id }, transaction }),
          PointTransaction.destroy({ where: { userId: owner.id }, transaction }),
          UserRating.destroy({ where: { [Op.or]: [{ userId: owner.id }, { ratedByUserId: owner.id }] }, transaction }),
          CouponPurchase.destroy({ where: { userId: owner.id }, transaction }),
          CouponPurchase.update({ redeemedById: null }, { where: { redeemedById: owner.id }, transaction }),
          Coupon.update({ createdById: null }, { where: { createdById: owner.id }, transaction }),
          AuditLog.update({ actorId: null }, { where: { actorId: owner.id }, transaction }),
          NotificationLog.update({ user_id: null }, { where: { user_id: owner.id }, transaction }),
        ]);
        await owner.destroy({ transaction });
        ownerDeleted = true;
      }
    }

    await transaction.commit();
    return res.json({ message: "Brand disabled successfully", ownerDeleted });
  } catch (error) {
    await transaction.rollback();
    console.error("Delete brand error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/brand-owner/brands", authenticate, authorize("brand", "brand_owner"), async (req, res) => {
  const brands = await Brand.findAll({ where: { ownerId: req.user.id }, include: brandInclude });
  return res.json({ brands: brands.map((brand) => withImageUrl(req, brand)) });
});

router.patch("/brand-owner/brands/:id", authenticate, authorize("brand", "brand_owner"), upload.single("image"), async (req, res) => {
  const brand = await Brand.findOne({ where: { id: req.params.id, ownerId: req.user.id } });
  if (!brand) return res.status(404).json({ error: "Brand not found" });

  ["description", "locationText", "websiteUrl", "phone"].forEach((field) => {
    if (req.body[field] !== undefined) brand[field] = req.body[field];
  });
  const nextLatitude = req.body.latitude !== undefined ? toNumber(req.body.latitude) : brand.latitude;
  const nextLongitude = req.body.longitude !== undefined ? toNumber(req.body.longitude) : brand.longitude;
  const coordinatesError = validateCoordinates(nextLatitude, nextLongitude);
  if (coordinatesError) return res.status(400).json({ error: coordinatesError });
  brand.latitude = nextLatitude;
  brand.longitude = nextLongitude;
  if (req.file) brand.image = req.file.filename;
  await brand.save();

  if (req.body.socialLinks !== undefined) {
    await BrandSocialLink.destroy({ where: { brandId: brand.id } });
    const links = sanitizeSocialLinks(req.body)
      .map((link) => ({ brandId: brand.id, platform: link.platform, url: link.url }));
    if (links.length) await BrandSocialLink.bulkCreate(links);
  }

  const fresh = await Brand.findByPk(brand.id, { include: brandInclude });
  return res.json({ brand: withImageUrl(req, fresh) });
});

module.exports = router;
