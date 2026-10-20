// GET or POST /api/unsubscribe?id=<lead id>&t=<signed token>
// The link at the bottom of every email. POST is Gmail's one-click unsubscribe.
const { db } = require("../lib/db");
const { safeEqual, unsubToken } = require("../lib/auth");

const page = (title, msg) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Weekend Escape</title>
<style>body{margin:0;background:#FFF3E4;color:#231B2E;font:16px/1.5 Arial,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px}
main{background:#FFFCF7;border:2px solid #231B2E;border-radius:16px;box-shadow:6px 6px 0 #231B2E;padding:28px;max-width:420px}
h1{margin:0 0 8px;font-size:22px}a{color:#E8412F}</style></head>
<body><main><h1>${title}</h1><p>${msg}</p><p><a href="/">Back to Weekend Escape</a></p></main></body></html>`;

module.exports = async (req, res) => {
  const id = String(req.query.id || "");
  const t = String(req.query.t || "");
  const valid = /^[0-9a-f-]{36}$/.test(id) && process.env.CRON_SECRET && safeEqual(t, unsubToken(id));
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!valid) return res.status(400).send(page("Link not valid", "This unsubscribe link looks broken. Reply to any of our emails and we'll remove you by hand."));

  try {
    await db(`leads?id=eq.${id}&unsubscribed_at=is.null`, {
      method: "PATCH",
      body: { unsubscribed_at: new Date().toISOString(), marketing_consent: false },
      prefer: "return=minimal",
    });
  } catch (e) {
    console.error("unsubscribe failed:", e.message);
    return res.status(500).send(page("Something went wrong", "Please try the link again in a minute."));
  }
  return res.status(200).send(page("You're unsubscribed", "We won't email you again. Sorry to see you go, and have a great weekend anyway!"));
};
