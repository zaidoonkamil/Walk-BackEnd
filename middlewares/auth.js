const jwt = require("jsonwebtoken");
require("dotenv").config();
const { AdminSession, User } = require("../models");

function readToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : header;
}

async function authenticate(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: "Token is required" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== "access") {
      return res.status(401).json({ error: "Invalid token type" });
    }

    const tokenUser = await User.findByPk(decoded.id);
    if (!tokenUser) return res.status(401).json({ error: "Token user no longer exists" });

    const passwordVersion = tokenUser.passwordChangedAt
      ? new Date(tokenUser.passwordChangedAt).getTime()
      : new Date(tokenUser.createdAt || 0).getTime();
    if (!decoded.pwd || decoded.pwd !== passwordVersion) {
      return res.status(401).json({ error: "Token is no longer valid" });
    }

    if (decoded.role === "admin") {
      if (!decoded.jti) return res.status(401).json({ error: "Invalid admin token" });

      const session = await AdminSession.findOne({ where: { jti: decoded.jti, userId: decoded.id } });
      if (!session || session.revokedAt) {
        return res.status(401).json({ error: "Admin session has been revoked" });
      }
      if (new Date(session.expiresAt) <= new Date()) {
        return res.status(401).json({ error: "Admin session has expired" });
      }

      session.lastUsedAt = new Date();
      await session.save();
      req.adminSession = session;
    }

    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission" });
    }
    return next();
  };
}

module.exports = {
  authenticate,
  authorize,
  authenticateToken: authenticate,
};
