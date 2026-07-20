require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const hpp = require("hpp");
const rateLimit = require("express-rate-limit");
const sequelize = require("./config/db");
const { FeaturedSection } = require("./models");
const { expireOldCouponPurchases } = require("./services/couponExpiry");
const { assertJwtSecret } = require("./utils/security");
const sanitizeRequest = require("./middlewares/sanitize");

const authRouter = require("./routes/auth");
const profileRouter = require("./routes/profile");
const stepsRouter = require("./routes/steps");
const brandsRouter = require("./routes/brands");
const couponsRouter = require("./routes/coupons");
const adminRouter = require("./routes/admin");
const featuredRouter = require("./routes/featured");
const adsRouter = require("./routes/ads");
const notificationsRouter = require("./routes/notifications");

const app = express();
const server = http.createServer(app);
const port = Number(process.env.APP_PORT || process.env.PORT || 1011);

const allowedOrigins = (process.env.CORS_ORIGINS || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(hpp());
app.use(cors({
  origin: allowedOrigins.includes("*") ? "*" : allowedOrigins,
  credentials: !allowedOrigins.includes("*"),
}));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "100kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(sanitizeRequest);
app.use("/uploads", express.static("uploads"));

const authLimiter = rateLimit({
  windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many auth attempts, please try again later" },
});

const registerLimiter = rateLimit({
  windowMs: Number(process.env.REGISTER_RATE_LIMIT_WINDOW_MS || 60 * 60 * 1000),
  limit: Number(process.env.REGISTER_RATE_LIMIT_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many registration attempts, please try again later" },
});

const adminLimiter = rateLimit({
  windowMs: Number(process.env.ADMIN_RATE_LIMIT_WINDOW_MS || 60 * 1000),
  limit: Number(process.env.ADMIN_RATE_LIMIT_MAX || 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many admin requests, please slow down" },
});

app.use(["/auth/login", "/login"], authLimiter);
app.use(["/auth/register", "/users"], registerLimiter);
app.use("/admin", adminLimiter);

app.get("/health", (req, res) => res.json({ ok: true, service: "Walk Backend" }));

app.use("/", authRouter);
app.use("/", profileRouter);
app.use("/", stepsRouter);
app.use("/", brandsRouter);
app.use("/", couponsRouter);
app.use("/", adminRouter);
app.use("/", featuredRouter);
app.use("/", adsRouter);
app.use("/", notificationsRouter);

app.use((error, req, res, next) => {
  console.error("Request error:", error);
  if (error.name === "MulterError") {
    return res.status(400).json({ error: "Invalid upload request" });
  }
  if (error.message && error.message.includes("Only jpeg")) {
    return res.status(400).json({ error: error.message });
  }
  return res.status(500).json({ error: "Internal Server Error" });
});

app.use((req, res) => res.status(404).json({ error: "Route not found" }));

async function seedFeaturedSections() {
  const defaults = [
    ["most_requested", "الاكثر طلبا"],
    ["loved_restaurants", "مطاعم محبوبة"],
    ["loved_brands", "براندات محبوبة"],
    ["featured_brands", "براندات مميزة"],
    ["near_you", "قريبة منك"],
    ["new_offers", "عروض جديدة"],
    ["fitness_favorites", "مفضلة المشاة"],
    ["weekend_picks", "اختيارات الويكند"],
    ["best_value", "افضل قيمة"],
    ["top_cashback", "اعلى خصومات"],
  ];

  for (let index = 0; index < defaults.length; index += 1) {
    const [key, title] = defaults[index];
    await FeaturedSection.findOrCreate({
      where: { key },
      defaults: { title, sortOrder: index + 1 },
    });
  }
}

async function start() {
  try {
    assertJwtSecret();
    await sequelize.authenticate();
    await sequelize.sync({ alter: process.env.DB_SYNC_ALTER !== "false" });
    await seedFeaturedSections();
    await expireOldCouponPurchases();

    setInterval(() => {
      expireOldCouponPurchases().catch((error) => {
        console.error("Coupon expiry job failed:", error);
      });
    }, Number(process.env.COUPON_EXPIRY_JOB_MS || 60 * 60 * 1000));

    server.listen(port, () => {
      console.log(`Walk Backend running on http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

start();
