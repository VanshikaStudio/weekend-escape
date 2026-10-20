// POST /api/lead · saves a lead from the email gate into Supabase.
// The browser only talks to this route; the service role key stays on the server.

const BUDGETS = { 100: "under-100", 150: "100-150", 250: "150-250", 450: "250+" };
const TRANSPORTS = ["train", "plane", "either"];
const VIBES = ["chill", "culture", "party", "mix"];

const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const body = typeof req.body === "object" && req.body ? req.body : {};

  // Honeypot: real visitors never fill this hidden field. Pretend success for bots.
  if (clean(body.website, 200)) return res.status(200).json({ ok: true });

  const email = clean(body.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: "Please enter a valid email." });
  }
  if (body.consent !== true) {
    return res.status(400).json({ ok: false, error: "Please tick the box so we can email you." });
  }

  const a = typeof body.answers === "object" && body.answers ? body.answers : {};
  const budgetMax = Number(a.budget && a.budget.max);
  if (!BUDGETS[budgetMax] || !TRANSPORTS.includes(a.transport) || !VIBES.includes(a.vibe)) {
    return res.status(400).json({ ok: false, error: "Please answer the 3 questions first." });
  }

  const dest = typeof body.destination === "object" && body.destination ? body.destination : {};
  const lead = {
    email,
    name: clean(body.firstName, 80) || null,
    consent: true,
    marketing_consent: body.marketing === true,
    answers: {
      school: clean(body.school, 120) || null,
      budget: BUDGETS[budgetMax],
      budgetMax,
      transport: a.transport,
      vibe: a.vibe,
      destination: {
        id: clean(dest.id, 60),
        city: clean(dest.city, 80),
        estimatedTotal: Number.isFinite(Number(dest.total)) ? Number(dest.total) : null,
      },
    },
  };

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("lead: Supabase variables missing");
    return res.status(500).json({ ok: false, error: "Server not configured." });
  }

  // Upsert on email: a second quiz updates the same lead and keeps its status.
  const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?on_conflict=email`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(lead),
  });

  if (!r.ok) {
    console.error("lead: Supabase error", r.status, await r.text());
    return res.status(502).json({ ok: false, error: "Could not save right now. Please try again." });
  }
  return res.status(200).json({ ok: true });
};
