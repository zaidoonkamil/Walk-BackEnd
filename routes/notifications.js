const express = require("express");
const multer = require("multer");
const { Op } = require("sequelize");
const { authenticate, authorize } = require("../middlewares/auth");
const { UserDevice } = require("../models");
const NotificationLog = require("../models/notification_log");
const {
  sendNotificationToAll,
  sendNotificationToRole,
  sendNotificationToUser,
} = require("../services/notifications");

const router = express.Router();
const upload = multer();

router.post("/register-device", authenticate, async (req, res) => {
  const { player_id } = req.body;

  if (!player_id) {
    return res.status(400).json({ error: "player_id is required" });
  }

  try {
    let device = await UserDevice.findOne({ where: { player_id } });

    if (device) {
      device.user_id = req.user.id;
      await device.save();
    } else {
      await UserDevice.create({ user_id: req.user.id, player_id });
    }

    return res.json({ success: true, message: "Device registered successfully" });
  } catch (error) {
    console.error("Device registration error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/notification/user", authenticate, authorize("admin"), upload.none(), async (req, res) => {
  try {
    const { user_id, message, title } = req.body;

    if (!user_id || !message || !title) {
      return res.status(400).json({ error: "user_id, message and title are required" });
    }

    const result = await sendNotificationToUser(user_id, message, title);

    await NotificationLog.create({
      target_type: "user",
      target_value: user_id.toString(),
      message,
      title,
    });

    return res.json({ success: true, result });
  } catch (error) {
    console.error("Send user notification error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/notification", authenticate, authorize("admin"), upload.none(), async (req, res) => {
  try {
    const { target_type, target_value, message, title } = req.body;

    if (!target_type || !message || !title) {
      return res.status(400).json({ error: "target_type, message and title are required" });
    }

    let result;
    if (target_type === "all") {
      result = await sendNotificationToAll(message, title);
    } else if (target_type === "role") {
      if (!target_value) return res.status(400).json({ error: "target_value is required" });
      result = await sendNotificationToRole(target_value, message, title);
    } else if (target_type === "user") {
      if (!target_value) return res.status(400).json({ error: "target_value is required" });
      result = await sendNotificationToUser(target_value, message, title);
    } else {
      return res.status(400).json({ error: "Invalid target_type" });
    }

    return res.json({ success: true, result });
  } catch (error) {
    console.error("Send notification error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/notifications-log", authenticate, async (req, res) => {
  const { role, user_id, page = 1, limit = 20 } = req.query;

  try {
    const isAdmin = req.user.role === "admin";
    const orConditions = [{ target_type: "all" }];

    if (isAdmin) {
      if (role) orConditions.push({ target_type: "role", target_value: role });
      if (user_id) {
        orConditions.push({ target_type: "user", target_value: user_id.toString() });
        orConditions.push({ user_id: Number(user_id) });
      }
    } else {
      orConditions.push({ target_type: "role", target_value: req.user.role });
      orConditions.push({ target_type: "user", target_value: req.user.id.toString() });
      orConditions.push({ user_id: req.user.id });
    }

    const offset = (Number(page) - 1) * Number(limit);

    const { count, rows: logs } = await NotificationLog.findAndCountAll({
      where: { [Op.or]: orConditions },
      order: [["createdAt", "DESC"]],
      limit: Number(limit),
      offset,
    });

    return res.json({
      total: count,
      page: Number(page),
      totalPages: Math.ceil(count / Number(limit)),
      logs,
    });
  } catch (error) {
    console.error("Notifications log error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
