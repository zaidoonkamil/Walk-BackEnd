const { User, UserDevice } = require("../models");
const NotificationLog = require("../models/notification_log");
const { Op } = require("sequelize");
const axios = require("axios");

const sendNotificationToDevices = async (playerIds, message, title = "Notification") => {
  const url = 'https://onesignal.com/api/v1/notifications';
  const headers = {
    'Authorization': `Basic ${process.env.ONESIGNAL_API_KEY}`,
    'Content-Type': 'application/json',
  };
  const data = {
    app_id: process.env.ONESIGNAL_APP_ID,
    include_player_ids: playerIds,
    contents: { en: message },
    headings: { en: title },
  };

  return axios.post(url, data, { headers });
};

const sendNotificationToAll = async (message, title = "Notification") => {
  const users = await User.findAll({
    where: { role: { [Op.in]: ["user", "brand", "brand_owner"] } },
    attributes: ["id"],
  });
  let sent = 0;
  let failed = 0;
  for (const user of users) {
    const devices = await UserDevice.findAll({ where: { user_id: user.id } });
    const playerIds = devices.map(d => d.player_id);

    const logData = {
      title,
      message,
      target_type: "user",
      target_value: user.id.toString(),
      user_id: user.id, 
    };

    if (playerIds.length === 0) {
      logData.status = "failed";
      await NotificationLog.create(logData);
      failed += 1;
      continue;
    }

    try {
      await sendNotificationToDevices(playerIds, message, title);
      logData.status = "sent";
      await NotificationLog.create(logData);
      sent += 1;
    } catch (err) {
      console.error(`Error sending notification to user ${user.id}:`, err.message);
      logData.status = "failed";
      await NotificationLog.create(logData);
      failed += 1;
    }
  }
  return { success: true, total: users.length, sent, failed };
};

const sendNotificationToRole = async (role, message, title = "Notification") => {
  const roles = role === "brand" ? ["brand", "brand_owner"] : [role];
  const devices = await UserDevice.findAll({
    include: [{ model: User, as: "user", where: { role: { [Op.in]: roles } } }]
  });

  const devicesByUser = {};
  devices.forEach(d => {
    if (!devicesByUser[d.user_id]) devicesByUser[d.user_id] = [];
    devicesByUser[d.user_id].push(d.player_id);
  });

  let sent = 0;
  let failed = 0;
  for (const [userId, playerIds] of Object.entries(devicesByUser)) {
    const logData = {
      title,
      message,
      target_type: "user",
      target_value: userId.toString(),
      user_id: parseInt(userId), 
    };

    try {
      await sendNotificationToDevices(playerIds, message, title);
      logData.status = "sent";
      await NotificationLog.create(logData);
      sent += 1;
    } catch (err) {
      console.error(`Error sending notification to user ${userId}:`, err.message);
      logData.status = "failed";
      await NotificationLog.create(logData);
      failed += 1;
    }
  }
  return { success: true, role, total: Object.keys(devicesByUser).length, sent, failed };
};

const sendNotificationToUser = async (userId, message, title = "Notification") => {
  const devices = await UserDevice.findAll({
    where: { user_id: userId }  
  });

  const playerIds = devices.map(d => d.player_id);

  const logData = {
    title,
    message,
    target_type: "user",
    target_value: userId.toString(),
    user_id: userId,
  };

  if (playerIds.length === 0) {
    logData.status = "failed";
    await NotificationLog.create(logData);
    return { success: false, message: `No devices for user ${userId}` };
  }

  try {
    await sendNotificationToDevices(playerIds, message, title);
    logData.status = "sent";
    await NotificationLog.create(logData);
    return { success: true };
  } catch (err) {
    console.error(`Error sending notification to user ${userId}:`, err.message);
    logData.status = "failed";
    await NotificationLog.create(logData);
    return { success: false, error: err.message };
  }
};



module.exports = {
  sendNotificationToAll,
  sendNotificationToRole,
  sendNotificationToUser
};
