// Secret comparisons and signed tokens (unsubscribe links, admin session).
const crypto = require("crypto");

// Constant-time comparison of two strings of any length.
function safeEqual(a, b) {
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

const sign = (key, value) => crypto.createHmac("sha256", key).update(String(value)).digest("hex");

const unsubToken = (leadId) => sign(process.env.CRON_SECRET, `unsub:${leadId}`).slice(0, 32);
const adminToken = () => sign(process.env.ADMIN_PASSWORD, "admin-session");

module.exports = { safeEqual, unsubToken, adminToken };
