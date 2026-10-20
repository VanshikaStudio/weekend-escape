// The daily follow-up robot (rules in AGENTS.md › The follow-up robot).
// Replies are found over IMAP; a lead who replied is never written to again.
const { ImapFlow } = require("imapflow");
const { db } = require("./db");
const { sendFollowUp } = require("./mail");

// First text/plain part of a message, e.g. "1" or "1.1".
function textPart(node) {
  if (!node) return null;
  if (node.type === "text/plain") return node.part || "1";
  for (const c of node.childNodes || []) {
    const p = textPart(c);
    if (p) return p;
  }
  return null;
}

async function readStream(stream, max = 5000) {
  let s = "";
  for await (const chunk of stream) {
    s += chunk.toString("utf8");
    if (s.length > max) break;
  }
  return s.slice(0, max);
}

// Earliest email FROM this address received after `after`. IMAP SINCE works by day,
// so we search from that day and filter on the exact date afterwards.
async function findReply(client, email, after) {
  const day = new Date(after);
  day.setUTCHours(0, 0, 0, 0);
  const uids = await client.search({ from: email, since: day }, { uid: true });
  if (!uids || !uids.length) return null;

  let found = null;
  for await (const m of client.fetch(uids, { uid: true, envelope: true, internalDate: true, bodyStructure: true }, { uid: true })) {
    const from = ((m.envelope.from || [])[0] || {}).address || "";
    const date = new Date(m.envelope.date || m.internalDate);
    if (from.toLowerCase() === email && date > after && (!found || date < found.date)) {
      found = { uid: m.uid, date, subject: m.envelope.subject || "", messageId: m.envelope.messageId, part: textPart(m.bodyStructure) };
    }
  }
  if (!found) return null;
  // Download after the fetch loop: ImapFlow can't run two commands at once.
  found.body = found.part ? await readStream((await client.download(found.uid, found.part, { uid: true })).content) : "";
  return found;
}

async function runRobot() {
  const summary = { checked: 0, repliesFound: 0, followUpsSent: 0, errors: [] };
  const days = Number(process.env.FOLLOW_UP_DAYS ?? 3);
  const leads = await db("leads?select=*&status=in.(contacted,followed_up)&consent=is.true&order=created_at.asc");
  if (!leads.length) return summary;

  const client = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true, logger: false,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    for (const lead of leads) {
      summary.checked++;
      try {
        const since = new Date(lead.last_email_at || lead.created_at);
        const reply = await findReply(client, lead.email.toLowerCase(), since);
        if (reply) {
          await db("emails?on_conflict=message_id", {
            method: "POST",
            body: {
              lead_id: lead.id, direction: "in", subject: reply.subject, body: reply.body,
              message_id: reply.messageId || `imap-${reply.uid}-${lead.id}`, sent_at: reply.date.toISOString(),
            },
            prefer: "resolution=ignore-duplicates,return=minimal",
          });
          await db(`leads?id=eq.${lead.id}`, { method: "PATCH", body: { status: "replied" }, prefer: "return=minimal" });
          summary.repliesFound++;
          continue;
        }
        const due = Date.now() - since.getTime() >= days * 864e5;
        if (lead.status === "contacted" && lead.follow_ups === 0 && !lead.unsubscribed_at && due) {
          const r = await sendFollowUp(lead);
          if (r.sent) summary.followUpsSent++;
        }
      } catch (e) {
        summary.errors.push(`${lead.email}: ${e.message}`);
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return summary;
}

module.exports = { runRobot };
