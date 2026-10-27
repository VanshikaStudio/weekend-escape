// The site tells n8n about each new lead. Run: npm test
const test = require("node:test");
const assert = require("node:assert");
const { notifyNewLead } = require("../lib/n8n");

test("n8n: skipped quietly when the webhook isn't configured", async () => {
  delete process.env.N8N_WEBHOOK_URL; delete process.env.N8N_WEBHOOK_SECRET;
  assert.deepEqual(await notifyNewLead("abc"), { sent: false, reason: "n8n webhook not configured" });
});

test("n8n: sends only the lead id, with the secret header; errors are reported", async () => {
  process.env.N8N_WEBHOOK_URL = "https://n8n.example/webhook/new-lead";
  process.env.N8N_WEBHOOK_SECRET = "s3cret";
  const real = global.fetch;
  let seen;
  global.fetch = async (url, opts) => { seen = { url, opts }; return { ok: true, status: 200 }; };
  assert.deepEqual(await notifyNewLead("lead-1"), { sent: true });
  assert.equal(seen.opts.headers["X-Webhook-Secret"], "s3cret");
  assert.deepEqual(JSON.parse(seen.opts.body), { leadId: "lead-1" });
  global.fetch = async () => ({ ok: false, status: 403 });
  await assert.rejects(notifyNewLead("lead-1"), /403/);
  global.fetch = real;
  delete process.env.N8N_WEBHOOK_URL; delete process.env.N8N_WEBHOOK_SECRET;
});
