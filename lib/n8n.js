// Tells our n8n instance that a lead was just saved, so the workflow
// "Leads — Score new leads with AI" scores it right away (A/B/C with Gemini).
// Only the lead id is sent; n8n reads the rest from Supabase. If the call fails,
// n8n's hourly check still picks the lead up, so this never blocks a sign-up.

const TIMEOUT_MS = 5000;

async function notifyNewLead(leadId) {
  const { N8N_WEBHOOK_URL: url, N8N_WEBHOOK_SECRET: secret } = process.env;
  if (!url || !secret) return { sent: false, reason: "n8n webhook not configured" };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
    body: JSON.stringify({ leadId }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`n8n webhook HTTP ${r.status}`);
  return { sent: true };
}

module.exports = { notifyNewLead };
