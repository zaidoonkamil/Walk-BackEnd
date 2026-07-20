const express = require("express");
const { Op } = require("sequelize");
const upload = require("../middlewares/uploads");
const { authenticate, authorize } = require("../middlewares/auth");
const { BrandCategory, Brand, BrandSocialLink, Coupon } = require("../models");
const { toBool, toNumber } = require("../utils/http");

const router = express.Router();

const brandInclude = [
  { model: BrandCategory, as: "category" },
  { model: BrandSocialLink, as: "socialLinks" },
];

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

function validateCoordinates(latitude, longitude) {
  if (latitude === null && longitude === null) return null;
  if (latitude === null || longitude === null) return "latitude and longitude must be sent together";
  if (latitude < -90 || latitude > 90) return "latitude must be between -90 and 90";
  if (longitude < -180 || longitude > 180) return "longitude must be between -180 and 180";
  return null;
}

router.get("/categories", async (req, res) => {
  const categories = await BrandCategory.findAll({
    where: { isActive: true },
    order: [["sortOrder", "ASC"], ["name", "ASC"]],
  });
  return res.json({ categories });
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
  return res.json({ brands });
});

router.get("/brands/:id", async (req, res) => {
  const brand = await Brand.findByPk(req.params.id, {
    include: [...brandInclude, { model: Coupon, as: "coupons", where: { isActive: true }, required: false }],
  });
  if (!brand || !brand.isActive) return res.status(404).json({ error: "Brand not found" });
  return res.json({ brand });
});

router.get("/admin/categories", authenticate, authorize("admin"), async (req, res) => {
  const where = {};
  if (req.query.includeInactive !== "true") where.isActive = true;
  const categories = await BrandCategory.findAll({
    where,
    order: [["sortOrder", "ASC"], ["name", "ASC"]],
  });
  return res.json({ categories });
});

router.get("/admin/brands", authenticate, authorize("admin"), async (req, res) => {
  const where = {};
  if (req.query.categoryId) where.categoryId = req.query.categoryId;
  if (req.query.q) where.name = { [Op.like]: `%${req.query.q}%` };

  const brands = await Brand.findAll({
    where,
    include: brandInclude,
    order: [["popularityScore", "DESC"], ["createdAt", "DESC"]],
  });
  return res.json({ brands });
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
    return res.status(201).json({ category });
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

    return res.json({ category });
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

    const brand = await Brand.create({
      name,
      categoryId: toNumber(req.body.categoryId),
      ownerId: toNumber(req.body.ownerId),
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

    const links = parseSocialLinks(req.body)
      .filter((link) => link.platform && link.url)
      .map((link) => ({ brandId: brand.id, platform: link.platform, url: link.url }));
    if (links.length) await BrandSocialLink.bulkCreate(links);

    const fresh = await Brand.findByPk(brand.id, { include: brandInclude });
    return res.status(201).json({ brand: fresh });
  } catch (error) {
    console.error("Create brand error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
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
    brand.latitude = nextLatitude;
    brand.longitude = nextLongitude;
    ["isActive", "isFeatured"].forEach((field) => {
      if (req.body[field] !== undefined) brand[field] = toBool(req.body[field], brand[field]);
    });
    if (req.file) brand.image = req.file.filename;
    await brand.save();

    if (req.body.socialLinks !== undefined) {
      await BrandSocialLink.destroy({ where: { brandId: brand.id } });
      const links = parseSocialLinks(req.body)
        .filter((link) => link.platform && link.url)
        .map((link) => ({ brandId: brand.id, platform: link.platform, url: link.url }));
      if (links.length) await BrandSocialLink.bulkCreate(links);
    }

    const fresh = await Brand.findByPk(brand.id, { include: brandInclude });
    return res.json({ brand: fresh });
  } catch (error) {
    console.error("Update brand error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
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
  const brand = await Brand.findByPk(req.params.id);
  if (!brand) return res.status(404).json({ error: "Brand not found" });
  brand.isActive = false;
  await brand.save();
  return res.json({ message: "Brand disabled successfully" });
});

router.get("/brand-owner/brands", authenticate, authorize("brand_owner"), async (req, res) => {
  const brands = await Brand.findAll({ where: { ownerId: req.user.id }, include: brandInclude });
  return res.json({ brands });
});

router.patch("/brand-owner/brands/:id", authenticate, authorize("brand_owner"), upload.single("image"), async (req, res) => {
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

  return res.json({ brand });
});

module.exports = router;
