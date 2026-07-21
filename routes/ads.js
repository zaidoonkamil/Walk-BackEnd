const express = require("express");
const Ads = require("../models/ads");
const upload = require("../middlewares/uploads");
const { authenticate, authorize } = require("../middlewares/auth");

const router = express.Router();

const TYPES = new Set(["main", "small"]);
const PLACEMENTS = new Set(["all", "home", "interests", "steps", "profile"]);

function cleanEnum(value, allowed, fallback) {
  const text = String(value || "").trim().toLowerCase();
  return allowed.has(text) ? text : fallback;
}

function uploadUrl(req, image) {
  const text = String(image || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  const baseUrl = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  return `${baseUrl}/uploads/${text}`;
}

function cleanLinkUrl(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function serializeAd(req, ad) {
  const json = ad.toJSON ? ad.toJSON() : ad;
  const images = Array.isArray(json.images) ? json.images : [];
  return {
    ...json,
    linkUrl: json.linkUrl || null,
    imageUrls: images.map((image) => uploadUrl(req, image)).filter(Boolean),
  };
}

router.post("/ads", authenticate, authorize("admin"), upload.array("images", 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "Image is required" });
    }

    const images = req.files.map((file) => file.filename);
    const ads = await Ads.create({
      images,
      type: cleanEnum(req.body.type, TYPES, "main"),
      placement: cleanEnum(req.body.placement, PLACEMENTS, "all"),
      linkUrl: cleanLinkUrl(req.body.linkUrl || req.body.link || req.body.url),
      isActive: req.body.isActive === undefined ? true : req.body.isActive === "true" || req.body.isActive === true,
      sortOrder: Number(req.body.sortOrder || 0),
    });

    return res.status(201).json({ message: "Ad created successfully", ads: serializeAd(req, ads) });
  } catch (err) {
    console.error("Error creating ad:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/ads", async (req, res) => {
  try {
    const where = {};
    const type = cleanEnum(req.query.type, TYPES, null);
    const placement = cleanEnum(req.query.placement, PLACEMENTS, null);
    if (type) where.type = type;
    if (placement) where.placement = placement;
    if (req.query.includeInactive !== "true") where.isActive = true;

    const ads = await Ads.findAll({ where, order: [["sortOrder", "ASC"], ["createdAt", "DESC"]] });
    return res.json(ads.map((ad) => serializeAd(req, ad)));
  } catch (err) {
    console.error("Error fetching ads:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/ads/:id", authenticate, authorize("admin"), async (req, res) => {
  try {
    const ad = await Ads.findByPk(req.params.id);
    if (!ad) return res.status(404).json({ error: "Ad not found" });

    await ad.destroy();
    return res.status(200).json({ message: "Ad deleted successfully" });
  } catch (err) {
    console.error("Error deleting ad:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
