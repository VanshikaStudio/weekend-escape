// Email 1: Gemini writes it, and if Gemini fails we still send the template. Run: npm test
const test = require("node:test");
const assert = require("node:assert");
const { buildEmail1 } = require("../lib/mail");
const { writeEmail1, email1Prompt } = require("../lib/gemini");

const lead = {
  id: "test", email: "test@example.com", name: "Léa", consent: true,
  answers: {
    school: "ESSEC", budget: "under-100", budgetMax: 100, transport: "train", vibe: "party",
    destination: { id: "lille", city: "Lille", estimatedTotal: 99 },
  },
};
const geminiReply = (obj) => async () => ({
  ok: true,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }),
});

test("fallback: if Gemini fails, email 1 is our template with the itinerary", async () => {
  const e = await buildEmail1(lead, { write: async () => { throw new Error("Gemini HTTP 503"); } });
  assert.equal(e.by, "template");
  assert.equal(e.subject, "Your weekend in Lille is planned 🎒");
  assert.match(e.text, /Hi Léa/);
  assert.match(e.text, /Estimated total: about €99/);
});

test("fallback: a Gemini HTTP error or a broken answer makes writeEmail1 throw", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  const trip = { d: { city: "Lille", country: "France" }, total: 99 };
  let calls = 0;
  const busy = async () => { calls++; return { ok: false, status: 503 }; };
  await assert.rejects(writeEmail1(lead, trip, { fetchFn: busy, retryDelayMs: 0 }), /503/);
  assert.equal(calls, 2, "a busy Gemini is tried twice");
  await assert.rejects(writeEmail1(lead, trip, { fetchFn: geminiReply({ subject: "", body: "" }) }), /unusable/);
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(writeEmail1(lead, trip), /not set/);
});

test("backup model: if the main model is busy or slow, the backup model writes the email", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  const trip = { d: { city: "Lille", country: "France" }, total: 99 };
  const ok = geminiReply({ subject: "Lille for €99 🧇", body: "Hi Léa, Lille is a great party weekend by train." });
  for (const firstFails of [async () => ({ ok: false, status: 503 }), async () => { throw new Error("aborted due to timeout"); }]) {
    const urls = [];
    const fetchFn = async (url, opts) => { urls.push(url); return urls.length === 1 ? firstFails() : ok(url, opts); };
    const out = await writeEmail1(lead, trip, { fetchFn, retryDelayMs: 0 });
    assert.equal(out.subject, "Lille for €99 🧇");
    assert.match(urls[0], /gemini-3\.8-flash/);
    assert.match(urls[1], /gemini-3\.6-flash/);
  }
  delete process.env.GEMINI_API_KEY;
});

test("Gemini path: its subject and text are used, our itinerary is added below", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  const write = (l, t) => writeEmail1(l, t, {
    fetchFn: geminiReply({ subject: "Lille on a student budget 🧇", body: "Hi Léa,\n\nLille is perfect for a party weekend by train, all for about €99." }),
  });
  const e = await buildEmail1(lead, { write });
  delete process.env.GEMINI_API_KEY;
  assert.equal(e.by, "gemini");
  assert.equal(e.subject, "Lille on a student budget 🧇");
  assert.match(e.text, /party weekend by train/);
  assert.match(e.text, /Estimated total: about €99/);
});

test("the prompt contains the lead's answers", () => {
  const p = email1Prompt(lead, { d: { city: "Lille", country: "France", tagline: "Student capital" }, total: 99 });
  for (const s of ["Léa", "ESSEC", "under €100", "train", "party", "Lille", "€99"]) assert.ok(p.includes(s), s);
});

// Guardrails against the trap lead (prompt injection in the name and school fields).
const { cleanName, cleanSchool, checkEmail } = require("../lib/gemini");
const TEST_LEADS = require("../lib/prompts/test-leads.json");

test("guardrail 1: a trap name or school never reaches the model", () => {
  const trap = TEST_LEADS.find((t) => t.label === "trap").lead;
  assert.equal(cleanName(trap.name), "there");
  assert.equal(cleanSchool(trap.answers.school), "not given");
  for (const ok of ["Léa", "Jean-Marc", "Anne Sophie", "O'Neil"]) assert.equal(cleanName(ok), ok);
  for (const ok of ["HEC", "Sciences Po", "Université Paris 1 (Panthéon-Sorbonne)"]) assert.equal(cleanSchool(ok), ok);
  const p = email1Prompt(trap, { d: { city: "Lille", country: "France", tagline: "" }, total: 77 });
  assert.ok(!/win-a-trip|FREE|refund/.test(p.split("## The student's answers")[1]), "injected text is not in the answers");
});

test("guardrail 3: an email with a link, a promise, shouting or the wrong city is rejected", () => {
  const good = { subject: "Your Lille weekend 🧇", body: "Hey there, Lille has cheap beers and big squares, about €77 all in." };
  assert.equal(checkEmail(good, "Lille"), null);
  assert.match(checkEmail({ ...good, body: good.body + " Book at http://win-a-trip.example" }, "Lille"), /link/);
  assert.match(checkEmail({ ...good, body: good.body + " Your trip is already booked!" }, "Lille"), /promise/);
  assert.match(checkEmail({ subject: "YOUR LILLE TRIP", body: "HEY THERE, LILLE IS GREAT AND IT IS ALL SORTED FOR YOU." }, "Lille"), /capital/);
  assert.match(checkEmail(good, "Brussels"), /city/);
});
