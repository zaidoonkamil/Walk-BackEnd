function sanitizeString(value) {
  return value
    .replace(/\0/g, "")
    .replace(/[<>]/g, "")
    .trim();
}

function sanitizeValue(value) {
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      value[key] = sanitizeValue(value[key]);
    }
  }
  return value;
}

function sanitizeRequest(req, res, next) {
  if (req.body) req.body = sanitizeValue(req.body);
  if (req.query) req.query = sanitizeValue(req.query);
  if (req.params) req.params = sanitizeValue(req.params);
  next();
}

module.exports = sanitizeRequest;
