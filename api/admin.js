// /api/admin?action=... · back-end of the /admin page, protected by ADMIN_PASSWORD (checked here, on the server).
//   POST login {password}   sets a session cookie
//   POST logout
//   GET  leads              list of leads + email counts
//   POST robot              "Run robot now"
//   POST preview {to}       sends both emails to a test address
//   POST update {id, status?, notes?}   changes a lead's status or notes by hand
//   POST samples            Email 1 for the 3 fixed test leads (good, vague, trap). Nothing is sent.
const { db } = require("../lib/db");
const { safeEqual, adminToken } = require("../lib/auth");
const { runRobot } = require("../lib/robot");
const { sendPreview, buildEmail1 } = require("../lib/mail");
const TEST_LEADS = require("../lib/prompts/test-leads.json");

const STATUSES = ["new", "contacted", "followed_up", "replied", "meeting", "won", "lost"];
const COOKIE = "we_admin";
const cookieOf = (req) => (String(req.headers.cookie || "").match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`)) || [])[1] || "";
const setCookie = (res, value, maxAge) =>
  res.setHeader("Set-Cookie", `${COOKIE}=${value}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`);

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.ADMIN_PASSWORD) return res.status(503).json({ ok: false, error: "ADMIN_PASSWORD is not set yet." });

  const action = String(req.query.action || "");
  const body = typeof req.body === "object" && req.body ? req.body : {};

  if (req.method === "POST" && action === "login") {
    if (!safeEqual(String(body.password || ""), process.env.ADMIN_PASSWORD)) {
      await new Promise((r) => setTimeout(r, 800)); // slows down guessing
      return res.status(401).json({ ok: false, error: "Wrong password." });
    }
    setCookie(res, adminToken(), 60 * 60 * 12);
    return res.status(200).json({ ok: true });
  }
  if (req.method === "POST" && action === "logout") {
    setCookie(res, "", 0);
    return res.status(200).json({ ok: true });
  }

  if (!safeEqual(cookieOf(req), adminToken())) return res.status(401).json({ ok: false, error: "Please log in." });

  try {
    if (req.method === "GET" && action === "leads") {
      const leads = await db("leads?select=id,created_at,name,email,consent,marketing_consent,answers,status,notes,score,score_reason,last_email_at,follow_ups,unsubscribed_at,emails(direction)&order=created_at.desc&limit=500");
      return res.status(200).json({ ok: true, leads });
    }
    if (req.method === "POST" && action === "robot") {
      const summary = await runRobot();
      console.log("robot (admin):", JSON.stringify(summary));
      return res.status(200).json({ ok: true, summary });
    }
    if (req.method === "POST" && action === "preview") {
      const to = String(body.to || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ ok: false, error: "Enter a valid email." });
      await sendPreview(to);
      return res.status(200).json({ ok: true });
    }
    if (req.method === "POST" && action === "samples") {
      const samples = await Promise.all(TEST_LEADS.map(async (t) => {
        const e = await buildEmail1(t.lead);
        return { label: t.label, by: e.by, subject: e.subject, opening: e.opening };
      }));
      return res.status(200).json({ ok: true, samples });
    }
    if (req.method === "POST" && action === "update") {
      const id = String(body.id || "");
      if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ ok: false, error: "Unknown lead." });
      const patch = {};
      if (body.status !== undefined) {
        if (!STATUSES.includes(body.status)) return res.status(400).json({ ok: false, error: "Unknown status." });
        patch.status = body.status;
      }
      if (body.notes !== undefined) patch.notes = String(body.notes).slice(0, 2000) || null;
      if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: "Nothing to update." });
      const rows = await db(`leads?id=eq.${id}`, { method: "PATCH", body: patch, prefer: "return=representation" });
      if (!rows.length) return res.status(404).json({ ok: false, error: "Unknown lead." });
      return res.status(200).json({ ok: true });
    }
  } catch (e) {
    console.error(`admin ${action} failed:`, e);
    return res.status(500).json({ ok: false, error: e.message });
  }
  return res.status(404).json({ ok: false, error: "Unknown action." });
};
