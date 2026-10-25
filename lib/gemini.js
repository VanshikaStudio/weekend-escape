// Asks Gemini to write Email 1's subject and opening text from our brief in lib/prompts/email1.md.
// Throws on any problem (no key, timeout, API error, bad JSON): the caller falls back to the template.
const fs = require("fs");
const path = require("path");

// Main model first; if it's busy or slow, the backup. With a single model, it's tried twice.
const MODELS = [...new Set([process.env.GEMINI_MODEL || "gemini-3.8-flash", "gemini-3.6-flash"])];
const TIMEOUT_MS = 10000; // per attempt, two attempts at most
const PROMPT = fs.readFileSync(path.join(__dirname, "prompts", "email1.md"), "utf8");

// The quiz stores short codes; the model gets them in plain words.
const BUDGET_WORDS = { "under-100": "under €100", "100-150": "€100 to €150", "150-250": "€150 to €250", "250+": "€250 or more" };
const TRANSPORT_WORDS = { train: "train", plane: "plane", either: "train or plane, whichever is cheaper" };
const VIBE_WORDS = { chill: "chill: slow mornings, good views", culture: "culture: museums, history, food", party: "party: bars and nightlife", mix: "a bit of everything" };

// Guardrail 1 · the name and school are typed by strangers: anything that doesn't look like
// a name or a school (too long, links, "ignore your instructions"...) never reaches the model.
const INJECTION = /(ignore|instruction|prompt|system|assistant|http|www\.|@|<|>|\{|\})/i;
function cleanName(s) {
  const v = typeof s === "string" ? s.trim() : "";
  return /^\p{L}[\p{L}' .-]{0,29}$/u.test(v) && v.split(/\s+/).length <= 3 && !INJECTION.test(v) ? v : "there";
}
function cleanSchool(s) {
  const v = typeof s === "string" ? s.trim() : "";
  return /^[\p{L}\p{N}][\p{L}\p{N}' &.,()-]{0,59}$/u.test(v) && v.split(/\s+/).length <= 6 && !INJECTION.test(v) ? v : "not given";
}

// Guardrail 3 · what the model wrote must look like our email: no links, no promises, the right city.
function checkEmail({ subject, body }, city) {
  const all = `${subject}\n${body}`;
  const letters = all.replace(/[^A-Za-zÀ-ÿ]/g, "");
  const caps = letters.replace(/[^A-ZÀ-Þ]/g, "").length / Math.max(1, letters.length);
  if (/(https?:|www\.|\.(com|fr|net|org|example)\b|@)/i.test(all)) return "contains a link or an address";
  if (/\b(booked|booking confirmed|confirmed|refund|guarantee[ds]?|ignore (all |your )?(previous |prior )?instructions)\b/i.test(all)) return "makes a promise we can't keep";
  if (caps > 0.3) return "mostly capital letters";
  if (!all.includes(city)) return "doesn't mention the city";
  return null;
}

function email1Prompt(lead, trip) {
  const a = lead.answers || {};
  const vars = {
    name: cleanName(lead.name),
    school: cleanSchool(a.school),
    budget: BUDGET_WORDS[a.budget] || "not given",
    transport: TRANSPORT_WORDS[a.transport] || TRANSPORT_WORDS.either,
    vibe: VIBE_WORDS[a.vibe] || VIBE_WORDS.mix,
    city: trip.d.city,
    country: trip.d.country,
    total: trip.total,
    tagline: trip.d.tagline || "",
  };
  return PROMPT.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

async function writeEmail1(lead, trip, { fetchFn = fetch, retryDelayMs = 1500 } = {}) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  const call = (model) => fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
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
  // Gemini is often busy (503), rate-limited (429) or slow: then try the next attempt before giving up.
  const attempts = MODELS.length > 1 ? MODELS : [MODELS[0], MODELS[0]];
  let res;
  for (const [i, model] of attempts.entries()) {
    const last = i === attempts.length - 1;
    try {
      res = await call(model);
    } catch (e) {
      if (last) throw e;
      continue;
    }
    if (!last && (res.status === 503 || res.status === 429)) {
      await new Promise((r) => setTimeout(r, retryDelayMs));
      continue;
    }
    break;
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
  const problem = checkEmail({ subject, body }, trip.d.city);
  if (problem) throw new Error(`Gemini email rejected: ${problem}`);
  return { subject, body };
}

module.exports = { writeEmail1, email1Prompt, cleanName, cleanSchool, checkEmail };
