// GET /api/robot · called once a day by Vercel Cron (vercel.json).
// Vercel sends "Authorization: Bearer <CRON_SECRET>"; anything else is refused.
const { safeEqual } = require("../lib/auth");
const { runRobot } = require("../lib/robot");

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.authorization || "", `Bearer ${secret}`)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  try {
    const summary = await runRobot();
    console.log("robot:", JSON.stringify(summary));
    return res.status(200).json({ ok: true, summary });
  } catch (e) {
    console.error("robot failed:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
