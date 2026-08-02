const express = require("express");
const multer = require("multer");
const { authenticate, authorize } = require("../middlewares/auth");
const {
  getQrCode,
  getStatus,
  initWhatsAppClient,
  logoutWhatsApp,
  resetWhatsAppSession,
  sendWhatsAppText,
} = require("../services/whatsappQrSender");

const router = express.Router();
const upload = multer();
const adminOnly = [authenticate, authorize("admin")];

router.post("/admin/whatsapp/init", adminOnly, async (req, res) => {
  try {
    const status = await initWhatsAppClient();
    return res.json({ success: true, ...status });
  } catch (error) {
    console.error("WhatsApp init error:", error.message || error);
    return res.status(error.statusCode || 500).json({ error: error.message || "Internal Server Error" });
  }
});

router.get("/admin/whatsapp/status", adminOnly, async (req, res) => {
  return res.json({ success: true, ...getStatus() });
});

router.get("/admin/whatsapp/qr", adminOnly, async (req, res) => {
  try {
    const qr = await getQrCode();
    return res.json({ success: true, ...qr });
  } catch (error) {
    console.error("WhatsApp QR error:", error.message || error);
    return res.status(error.statusCode || 500).json({ error: error.message || "Internal Server Error" });
  }
});

router.post("/admin/whatsapp/logout", adminOnly, async (req, res) => {
  try {
    return res.json(await logoutWhatsApp());
  } catch (error) {
    console.error("WhatsApp logout error:", error.message || error);
    return res.status(error.statusCode || 500).json({ error: error.message || "Internal Server Error" });
  }
});

router.post("/admin/whatsapp/reset-session", adminOnly, async (req, res) => {
  try {
    const status = await resetWhatsAppSession();
    return res.json({ success: true, ...status });
  } catch (error) {
    console.error("WhatsApp reset error:", error.message || error);
    return res.status(error.statusCode || 500).json({ error: error.message || "Internal Server Error" });
  }
});

router.post("/admin/whatsapp/test-message", adminOnly, upload.none(), async (req, res) => {
  try {
    const phone = String(req.body.phone || "").trim();
    const message = String(req.body.message || "").trim();
    if (!phone || !message) {
      return res.status(400).json({ error: "phone and message are required" });
    }
    const result = await sendWhatsAppText(phone, message);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("WhatsApp test send error:", error.message || error);
    return res.status(error.statusCode || 500).json({ error: error.message || "Internal Server Error" });
  }
});

module.exports = router;
