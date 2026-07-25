const axios = require("axios");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { Op } = require("sequelize");
const { OtpVerification, User } = require("../models");
const { getClientIp } = require("../utils/security");

const DEFAULT_PROVIDER = "whatsapp-telegram-sms";

function otpTtlMs() {
  return Number(process.env.OTP_TTL_MS || 5 * 60 * 1000);
}

function resendCooldownMs() {
  return Number(process.env.OTP_RESEND_COOLDOWN_MS || 60 * 1000);
}

function maxAttempts() {
  return Number(process.env.OTP_MAX_VERIFY_ATTEMPTS || 5);
}

function dailySendLimit() {
  return Number(process.env.OTP_DAILY_SEND_LIMIT || 10);
}

function generateOtpCode() {
  const length = Number(process.env.OTP_CODE_LENGTH || 6);
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(crypto.randomInt(min, max + 1));
}

function isDryRun() {
  return process.env.OTP_DRY_RUN === "true" && process.env.NODE_ENV !== "production";
}

async function assertCanSendOtp(phone, purpose) {
  const now = new Date();
  const cooldownSince = new Date(now.getTime() - resendCooldownMs());
  const lastOtp = await OtpVerification.findOne({
    where: {
      phone,
      purpose,
      createdAt: { [Op.gt]: cooldownSince },
      consumedAt: null,
    },
    order: [["createdAt", "DESC"]],
  });
  if (lastOtp) {
    const waitSeconds = Math.ceil((resendCooldownMs() - (now - lastOtp.createdAt)) / 1000);
    const error = new Error("Please wait before requesting another code");
    error.statusCode = 429;
    error.waitSeconds = waitSeconds;
    throw error;
  }

  const today = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const count = await OtpVerification.count({
    where: { phone, purpose, createdAt: { [Op.gt]: today } },
  });
  if (count >= dailySendLimit()) {
    const error = new Error("OTP daily limit reached");
    error.statusCode = 429;
    throw error;
  }
}

async function sendViaOtpiq(phone, code) {
  if (isDryRun()) {
    console.log(`OTP dry-run for ${phone}: ${code}`);
    return { provider: "dry-run", messageId: null };
  }

  const apiKey = process.env.OTPIQ_API_KEY;
  if (!apiKey) {
    const error = new Error("OTP service is not configured");
    error.statusCode = 503;
    throw error;
  }

  const baseUrl = process.env.OTPIQ_BASE_URL || "https://api.otpiq.com";
  const provider = process.env.OTPIQ_PROVIDER || DEFAULT_PROVIDER;
  const response = await axios.post(
    `${baseUrl.replace(/\/+$/, "")}/api/sms`,
    {
      phoneNumber: phone,
      smsType: "verification",
      provider,
      verificationCode: code,
    },
    {
      timeout: Number(process.env.OTPIQ_TIMEOUT_MS || 10000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  return {
    provider,
    messageId:
      response.data?.id ||
      response.data?.messageId ||
      response.data?.data?.id ||
      null,
  };
}

async function createAndSendOtp({ req, phone, userId = null, purpose = "phone_verify" }) {
  await assertCanSendOtp(phone, purpose);

  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  const sent = await sendViaOtpiq(phone, code);
  const otp = await OtpVerification.create({
    phone,
    userId,
    purpose,
    codeHash,
    maxAttempts: maxAttempts(),
    expiresAt: new Date(Date.now() + otpTtlMs()),
    ipAddress: getClientIp(req),
    provider: sent.provider,
    providerMessageId: sent.messageId,
  });

  return {
    otp,
    expiresInSeconds: Math.floor(otpTtlMs() / 1000),
    cooldownSeconds: Math.floor(resendCooldownMs() / 1000),
    dryRunCode: isDryRun() ? code : undefined,
  };
}

async function verifyOtpCode({ phone, code, purpose = "phone_verify", markUserVerified = true }) {
  const otp = await OtpVerification.findOne({
    where: {
      phone,
      purpose,
      consumedAt: null,
      expiresAt: { [Op.gt]: new Date() },
    },
    order: [["createdAt", "DESC"]],
  });

  if (!otp) {
    const error = new Error("Invalid or expired verification code");
    error.statusCode = 400;
    throw error;
  }

  if (otp.attempts >= otp.maxAttempts) {
    const error = new Error("Too many invalid verification attempts");
    error.statusCode = 429;
    throw error;
  }

  const valid = await bcrypt.compare(String(code || "").trim(), otp.codeHash);
  if (!valid) {
    otp.attempts += 1;
    await otp.save();
    const error = new Error("Invalid verification code");
    error.statusCode = 400;
    throw error;
  }

  otp.consumedAt = new Date();
  await otp.save();

  const user = await User.unscoped().findOne({ where: { phone } });
  if (markUserVerified && user && !user.isVerified) {
    user.isVerified = true;
    await user.save();
  }

  return { otp, user };
}

module.exports = {
  createAndSendOtp,
  verifyOtpCode,
};
