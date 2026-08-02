const path = require("path");
const fs = require("fs");
const qrcode = require("qrcode");

const SESSION_PATH = process.env.WHATSAPP_QR_SESSION_PATH
  ? path.resolve(process.env.WHATSAPP_QR_SESSION_PATH)
  : path.join(__dirname, "..", ".whatsapp_qr_auth");
const AUTO_INIT = process.env.WHATSAPP_QR_AUTO_INIT === "true";
const AUTO_RECONNECT = process.env.WHATSAPP_QR_AUTO_RECONNECT !== "false";
const RECONNECT_DELAY_MS = Number(process.env.WHATSAPP_QR_RECONNECT_DELAY_MS || 15000);
const QR_WAIT_TIMEOUT_MS = Number(process.env.WHATSAPP_QR_WAIT_TIMEOUT_MS || 8000);
const CONNECT_WAIT_TIMEOUT_MS = Number(process.env.WHATSAPP_QR_CONNECT_WAIT_TIMEOUT_MS || 60000);
const CONNECT_TIMEOUT_MS = Number(process.env.WHATSAPP_QR_CONNECT_TIMEOUT_MS || 60000);
const KEEP_ALIVE_INTERVAL_MS = Number(process.env.WHATSAPP_QR_KEEP_ALIVE_INTERVAL_MS || 15000);
const QUERY_TIMEOUT_MS = Number(process.env.WHATSAPP_QR_QUERY_TIMEOUT_MS || 120000);
const HEALTH_CHECK_INTERVAL_MS = Number(process.env.WHATSAPP_QR_HEALTH_CHECK_INTERVAL_MS || 60000);
const DEVICE_NAME = process.env.WHATSAPP_QR_DEVICE_NAME || "Walk";

let baileysModulePromise = null;
let pinoModulePromise = null;
let socket = null;
let initializingPromise = null;
let latestQrText = null;
let latestQrImage = null;
let latestError = null;
let connectionStatus = "idle";
let authenticated = false;
let connectedNumber = null;
let reconnectTimer = null;
let healthTimer = null;
let manualLogout = false;

function ensureSessionPath() {
  fs.mkdirSync(SESSION_PATH, { recursive: true });
}

function hasSessionCredentials() {
  return fs.existsSync(path.join(SESSION_PATH, "creds.json"));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadBaileys() {
  if (!baileysModulePromise) baileysModulePromise = import("baileys");
  return baileysModulePromise;
}

async function loadPino() {
  if (!pinoModulePromise) pinoModulePromise = import("pino");
  const mod = await pinoModulePromise;
  return mod.default || mod;
}

function normalizeWhatsAppPhone(phone = "") {
  let value = String(phone).trim();
  if (!value) throw new Error("Phone number is required");

  value = value.replace(/[^\d+]/g, "");
  if (value.startsWith("+")) value = value.slice(1);
  if (value.startsWith("00")) value = value.slice(2);
  if (value.startsWith("0")) value = `964${value.slice(1)}`;

  if (!/^\d{8,15}$/.test(value)) {
    throw new Error("Phone number format is invalid");
  }
  return value;
}

function getStatus() {
  return {
    provider: "whatsapp_qr",
    status: connectionStatus,
    authenticated,
    hasQr: Boolean(latestQrImage),
    connectedNumber,
    lastError: latestError,
  };
}

async function buildQrImage(qrText) {
  latestQrText = qrText;
  latestQrImage = await qrcode.toDataURL(qrText);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function clearHealthTimer() {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
}

function scheduleReconnect(reason = "unknown", force = false) {
  if ((!AUTO_RECONNECT && !force) || manualLogout || initializingPromise || socket) return;

  clearReconnectTimer();
  connectionStatus = "reconnecting";
  latestError = `Reconnecting after disconnect: ${reason}`;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await initWhatsAppClient();
    } catch (error) {
      latestError = error.message || String(error);
      scheduleReconnect(latestError, force);
    }
  }, force ? 500 : RECONNECT_DELAY_MS);
}

function startHealthCheck() {
  if (!AUTO_RECONNECT || healthTimer) return;
  healthTimer = setInterval(async () => {
    if (manualLogout || initializingPromise) return;
    if (!socket || connectionStatus === "disconnected" || connectionStatus === "failed") {
      try {
        await initWhatsAppClient();
      } catch (error) {
        latestError = error.message || String(error);
      }
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

async function waitForQrOrReady(timeoutMs = QR_WAIT_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (latestQrImage || connectionStatus === "ready") return;
    if (["failed", "auth_failure", "disconnected"].includes(connectionStatus)) return;
    await wait(500);
  }
}

async function waitForReady(timeoutMs = CONNECT_WAIT_TIMEOUT_MS) {
  if (!socket && !initializingPromise && connectionStatus !== "auth_failure") {
    await initWhatsAppClient();
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (connectionStatus === "ready" && socket) return;
    if (!socket && !initializingPromise && connectionStatus === "disconnected") {
      await initWhatsAppClient();
    }
    if (connectionStatus === "auth_failure") break;
    await wait(500);
  }

  const error = new Error("WhatsApp QR sender is not ready. Scan QR first.");
  error.statusCode = 503;
  throw error;
}

async function initWhatsAppClient() {
  if (socket && connectionStatus === "ready") return getStatus();
  if (initializingPromise) {
    await Promise.race([initializingPromise, wait(2500)]);
    return getStatus();
  }

  connectionStatus = "initializing";
  latestError = null;
  manualLogout = false;
  ensureSessionPath();

  initializingPromise = (async () => {
    const baileys = await loadBaileys();
    const pino = await loadPino();
    const { state, saveCreds } = await baileys.useMultiFileAuthState(SESSION_PATH);

    const instance = baileys.makeWASocket({
      auth: state,
      browser: baileys.Browsers.ubuntu(DEVICE_NAME),
      logger: pino({ level: process.env.WHATSAPP_QR_LOG_LEVEL || "silent" }),
      connectTimeoutMs: CONNECT_TIMEOUT_MS,
      keepAliveIntervalMs: KEEP_ALIVE_INTERVAL_MS,
      defaultQueryTimeoutMs: QUERY_TIMEOUT_MS,
      markOnlineOnConnect: false,
      printQRInTerminal: false,
      syncFullHistory: false,
    });

    socket = instance;
    authenticated = Boolean(state?.creds?.registered);
    instance.ev.on("creds.update", saveCreds);
    instance.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        connectionStatus = "qr_ready";
        latestError = null;
        authenticated = false;
        connectedNumber = null;
        await buildQrImage(qr);
      }

      if (connection === "connecting") {
        connectionStatus = latestQrImage ? "qr_ready" : "initializing";
      }

      if (connection === "open") {
        clearReconnectTimer();
        connectionStatus = "ready";
        latestQrText = null;
        latestQrImage = null;
        latestError = null;
        authenticated = true;
        connectedNumber = instance.user?.id?.split(":")[0]?.replace("@s.whatsapp.net", "") || null;
        startHealthCheck();
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === baileys.DisconnectReason.loggedOut;
        const restartRequired = statusCode === baileys.DisconnectReason.restartRequired;
        latestError = lastDisconnect?.error?.message || "WhatsApp connection closed";
        socket = null;

        if (loggedOut || manualLogout) {
          connectionStatus = "auth_failure";
          authenticated = false;
          return;
        }

        connectionStatus = "disconnected";
        if (restartRequired || AUTO_RECONNECT) {
          scheduleReconnect(latestError, restartRequired || AUTO_RECONNECT);
        }
      }
    });
  })()
    .catch((error) => {
      latestError = error.message || String(error);
      connectionStatus = "failed";
      socket = null;
      scheduleReconnect(latestError);
    })
    .finally(() => {
      initializingPromise = null;
    });

  await Promise.race([initializingPromise, wait(2500)]);
  return getStatus();
}

async function getQrCode() {
  if (!socket && !initializingPromise && connectionStatus !== "ready") {
    await initWhatsAppClient();
  }
  await waitForQrOrReady();
  return {
    status: connectionStatus,
    qrText: latestQrText,
    qrImage: latestQrImage,
    provider: "whatsapp_qr",
  };
}

async function inspectWhatsAppTarget(phone) {
  await waitForReady();
  const normalizedPhone = normalizeWhatsAppPhone(phone);
  const jid = `${normalizedPhone}@s.whatsapp.net`;
  let registered = true;
  try {
    const result = await socket.onWhatsApp(normalizedPhone);
    registered = Boolean(result?.[0]?.exists);
  } catch (_) {
    registered = true;
  }
  return { phone: normalizedPhone, chatId: jid, exists: registered, registered, connectedNumber };
}

async function sendWhatsAppText(phone, message) {
  const body = String(message || "").trim();
  if (!body) throw new Error("Message is required");
  await waitForReady();

  const target = await inspectWhatsAppTarget(phone);
  if (!target.exists) throw new Error("This number does not appear to have WhatsApp");

  const sent = await socket.sendMessage(target.chatId, { text: body });
  const messageId = sent?.key?.id || null;
  if (!messageId) throw new Error("WhatsApp did not return a message id");

  return {
    to: target.phone,
    messageId,
    timestamp: Math.floor(Date.now() / 1000),
    status: "accepted_by_whatsapp_qr",
    provider: "whatsapp_qr",
  };
}

async function logoutWhatsApp() {
  manualLogout = true;
  clearReconnectTimer();
  clearHealthTimer();
  if (socket) {
    try {
      await socket.logout();
    } catch (_) {}
    try {
      socket.end?.();
    } catch (_) {}
  }
  socket = null;
  initializingPromise = null;
  latestError = null;
  connectionStatus = "idle";
  latestQrText = null;
  latestQrImage = null;
  authenticated = false;
  connectedNumber = null;
  return { success: true, ...getStatus() };
}

async function resetWhatsAppSession() {
  await logoutWhatsApp();
  fs.rmSync(SESSION_PATH, { recursive: true, force: true });
  ensureSessionPath();
  manualLogout = false;
  return initWhatsAppClient();
}

function startWhatsAppAutoInit() {
  startHealthCheck();
  if (!AUTO_INIT && !hasSessionCredentials()) return;
  scheduleReconnect("server_boot", true);
}

module.exports = {
  getQrCode,
  getStatus,
  initWhatsAppClient,
  inspectWhatsAppTarget,
  logoutWhatsApp,
  normalizeWhatsAppPhone,
  resetWhatsAppSession,
  sendWhatsAppText,
  startWhatsAppAutoInit,
};
