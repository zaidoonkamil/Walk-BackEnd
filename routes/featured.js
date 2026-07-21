const express = require("express");
const { authenticate, authorize } = require("../middlewares/auth");
const { FeaturedSection, FeaturedBrand, Brand, BrandSocialLink } = require("../models");
const { toBool, toNumber } = require("../utils/http");

const router = express.Router();

const includeItems = [{
  model: FeaturedBrand,
  as: "items",
  include: [{ model: Brand, as: "brand", include: [{ model: BrandSocialLink, as: "socialLinks" }] }],
}];

router.get("/home/sections", async (req, res) => {
  const sections = await FeaturedSection.findAll({
    where: { isActive: true },
    include: includeItems,
    order: [["sortOrder", "ASC"], [{ model: FeaturedBrand, as: "items" }, "sortOrder", "ASC"]],
  });
  return res.json({ sections });
});

router.get("/admin/featured-sections", authenticate, authorize("admin"), async (req, res) => {
  const sections = await FeaturedSection.findAll({
    include: includeItems,
    order: [["sortOrder", "ASC"]],
  });
  return res.json({ sections });
});

router.post("/admin/featured-sections", authenticate, authorize("admin"), async (req, res) => {
  const key = String(req.body.key || "").trim();
  const title = String(req.body.title || "").trim();
  if (!key || !title) return res.status(400).json({ error: "key and title are required" });

  const section = await FeaturedSection.create({
    key,
    title,
    sortOrder: toNumber(req.body.sortOrder, 0),
    isActive: toBool(req.body.isActive, true),
  });
  return res.status(201).json({ section });
});

router.patch("/admin/featured-sections/:id", authenticate, authorize("admin"), async (req, res) => {
  const section = await FeaturedSection.findByPk(req.params.id);
  if (!section) return res.status(404).json({ error: "Section not found" });

  if (req.body.title !== undefined) section.title = req.body.title;
  if (req.body.sortOrder !== undefined) section.sortOrder = toNumber(req.body.sortOrder, section.sortOrder);
  if (req.body.isActive !== undefined) section.isActive = toBool(req.body.isActive, section.isActive);
  await section.save();
  return res.json({ section });
});

router.post("/admin/featured-sections/:id/brands", authenticate, authorize("admin"), async (req, res) => {
  const section = await FeaturedSection.findByPk(req.params.id);
  const brand = await Brand.findByPk(req.body.brandId);
  if (!section || !brand) return res.status(404).json({ error: "Section or brand not found" });

  const item = await FeaturedBrand.create({
    sectionId: section.id,
    brandId: brand.id,
    sortOrder: toNumber(req.body.sortOrder, 0),
  });
  return res.status(201).json({ item });
});

router.delete("/admin/featured-items/:id", authenticate, authorize("admin"), async (req, res) => {
  const item = await FeaturedBrand.findByPk(req.params.id);
  if (!item) return res.status(404).json({ error: "Featured item not found" });
  await item.destroy();
  return res.json({ message: "Featured brand removed" });
});

module.exports = router;
