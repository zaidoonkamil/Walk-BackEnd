const crypto = require("crypto");
const fs = require("fs");
const multer = require("multer");
const path = require("path");

const uploadDir = "uploads";
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, `${crypto.randomBytes(24).toString("hex")}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024),
    files: Number(process.env.MAX_UPLOAD_FILES || 5),
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (allowedMimeTypes.has(file.mimetype) && allowedExtensions.has(ext)) {
      return cb(null, true);
    }
    return cb(new Error("Only jpeg, png, webp and gif images are allowed"));
  },
});

module.exports = upload;
