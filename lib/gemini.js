// Asks Gemini to write Email 1's subject and opening text from our brief in lib/prompts/email1.md.
// Throws on any problem (no key, timeout, API error, bad JSON): the caller falls back to the template.
const fs = require("fs");
const path = require("path");

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const TIMEOUT_MS = 20000;
const PROMPT = fs.readFileSync(path.join(__dirname, "prompts", "email1.md"), "utf8");

function email1Prompt(lead, trip) {
  const a = lead.answers || {};
  const vars = {
    name: lead.name || "there",
    school: a.school || "not given",
    budget: a.budget ? `${a.budget} €` : "not given",
    transport: a.transport || "either",
    vibe: a.vibe || "mix",
    city: trip.d.city,
    country: trip.d.country,
    total: trip.total,
    tagline: trip.d.tagline || "",
  };
  return PROMPT.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

async function writeEmail1(lead, trip, { fetchFn = fetch, retryDelayMs = 1500 } = {}) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  const call = () => fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      contents: [{ parts: [{ text: email1Prompt(lead, trip) }] }],
      generationConfig: {
        thinkingConfig: { thinkingLevel: "low" },
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: { subject: { type: "STRING" }, body: { type: "STRING" } },
          required: ["subject", "body"],
        },
      },
    }),
  });
  let res = await call();
  // Gemini is often briefly busy (503) or rate-limited (429): try once more before giving up.
  if (res.status === 503 || res.status === 429) {
    await new Promise((r) => setTimeout(r, retryDelayMs));
    res = await call();
  }
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  const out = JSON.parse(raw);
  const subject = typeof out.subject === "string" ? out.subject.trim() : "";
  const body = typeof out.body === "string" ? out.body.trim() : "";
  if (!subject || subject.length > 120 || body.length < 40 || body.length > 2000) {
    throw new Error("Gemini returned an unusable email");
  }
  return { subject, body };
}

module.exports = { writeEmail1, email1Prompt };
