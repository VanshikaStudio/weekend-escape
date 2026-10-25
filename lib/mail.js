// Builds and sends our emails through the project Gmail (SMTP), and saves each one in `emails`.
const nodemailer = require("nodemailer");
const { db } = require("./db");
const { unsubToken } = require("./auth");
const { EMAIL_1, FOLLOW_UP } = require("./email-texts");
const { writeEmail1 } = require("./gemini");
const { destinations } = require("../data/destinations.json");

const DAILY_LIMIT = 100;
const BOOKING_LINKS = {
  train: { label: "Train times (SNCF Connect)", url: "https://www.sncf-connect.com/" },
  plane: { label: "Flight times (Google Flights)", url: "https://www.google.com/travel/flights" },
};

const siteUrl = () => `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || "weekend-escape-kappa.vercel.app"}`;
const unsubUrl = (id) => `${siteUrl()}/api/unsubscribe?id=${encodeURIComponent(id)}&t=${unsubToken(id)}`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const paras = (text) => text.split(/\n\n+/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

// ---------- Content ----------

function tripOf(lead) {
  const a = lead.answers || {};
  const d = destinations.find((x) => x.id === (a.destination && a.destination.id));
  if (!d) throw new Error(`unknown destination for ${lead.email}`);
  const modes = a.transport === "either" ? d.transport : d.transport.filter((t) => t.mode === a.transport);
  const tr = [...(modes.length ? modes : d.transport)].sort((x, y) => x.price - y.price)[0];
  const total = Number(a.destination.estimatedTotal) || tr.price + d.stay_per_night * 2 + d.food;
  return { d, tr, total };
}

function fill(text, lead, trip) {
  const vars = { name: lead.name || "there", city: trip.d.city, country: trip.d.country, total: trip.total };
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

function itinerary({ d, tr, total }) {
  const days = [["Friday night", d.plan.friday], ["Saturday", d.plan.saturday], ["Sunday", d.plan.sunday]];
  const link = BOOKING_LINKS[tr.mode];
  const cost = [
    `Getting there: ${tr.mode}, ${tr.duration}, about €${tr.price} return`,
    `Stay: about €${d.stay_per_night} a night × 2`,
    `Food: about €${d.food} for the weekend`,
    `Estimated total: about €${total}`,
  ];
  const note = "These are estimates, not live prices, and nothing is booked yet.";
  const text = [
    `${d.emoji} ${d.city}, ${d.country}`,
    cost.join("\n"),
    ...days.map(([t, items]) => `${t}\n${items.map((i) => `- ${i}`).join("\n")}`),
    `${link.label}: ${link.url}\nPlan another weekend: ${siteUrl()}`,
    note,
  ].join("\n\n");
  const html = `<h2 style="margin:24px 0 8px">${d.emoji} ${esc(d.city)}, ${esc(d.country)}</h2>
    <p>${cost.map(esc).join("<br>")}</p>
    ${days.map(([t, items]) => `<p style="margin:16px 0 4px"><b>${t}</b></p><ul style="margin:0;padding-left:20px">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`).join("")}
    <p style="margin-top:16px"><a href="${link.url}">${link.label}</a> · <a href="${siteUrl()}">Plan another weekend</a></p>
    <p style="color:#5B5167;font-size:13px">${note}</p>`;
  return { text, html };
}

function footer(lead) {
  const why = "You're receiving this because you asked for your weekend itinerary on Weekend Escape"
    + (lead.marketing_consent ? " and agreed to occasional cheap-ticket alerts from Paris." : ".");
  const url = unsubUrl(lead.id);
  return {
    text: `\n\n--\n${why} Unsubscribe anytime: ${url}`,
    html: `<hr style="border:0;border-top:1px solid #eee;margin:24px 0 12px"><p style="color:#5B5167;font-size:12px">${esc(why)} <a href="${url}">Unsubscribe</a></p>`,
  };
}

const wrapHtml = (inner) => `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#231B2E;max-width:560px">${inner}</div>`;

// Gemini writes the subject and opening text; if it fails for any reason we send our template.
// The itinerary (and the footer, in sendToLead) is always ours, so prices and plans stay exact.
async function buildEmail1(lead, { write = writeEmail1 } = {}) {
  const trip = tripOf(lead);
  const it = itinerary(trip);
  try {
    const ai = await write(lead, trip);
    return {
      subject: ai.subject,
      text: `${ai.body}\n\n${it.text}`,
      html: `${paras(ai.body)}${it.html}`,
      opening: ai.body,
      by: "gemini",
    };
  } catch (e) {
    console.error("mail: Gemini failed, using the template for email 1", e.message);
  }
  return {
    subject: fill(EMAIL_1.subject, lead, trip),
    text: `${fill(EMAIL_1.text, lead, trip)}\n\n${it.text}\n\n${fill(EMAIL_1.after, lead, trip)}`,
    html: `${paras(fill(EMAIL_1.text, lead, trip))}${it.html}${paras(fill(EMAIL_1.after, lead, trip))}`,
    opening: `${fill(EMAIL_1.text, lead, trip)}\n\n${fill(EMAIL_1.after, lead, trip)}`,
    by: "template",
  };
}

function buildFollowUp(lead, firstSubject) {
  const trip = tripOf(lead);
  const text = fill(FOLLOW_UP.text, lead, trip);
  return { subject: `Re: ${firstSubject}`, text, html: paras(text) };
}

// ---------- Sending ----------

let transport;
const transporter = () => (transport ||= nodemailer.createTransport({
  host: "smtp.gmail.com", port: 465, secure: true,
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
}));

async function sentLast24h() {
  const since = new Date(Date.now() - 864e5).toISOString();
  const rows = await db(`emails?select=id&direction=eq.out&sent_at=gte.${encodeURIComponent(since)}&limit=${DAILY_LIMIT}`);
  return rows.length;
}

// Sends one email to a lead and saves it. Refuses without consent, after opt-out or over the daily limit.
async function sendToLead(lead, { subject, text, html, inReplyTo }, { save = true } = {}) {
  if (lead.consent !== true) throw new Error("no consent");
  if (lead.unsubscribed_at) throw new Error("unsubscribed");
  if (await sentLast24h() >= DAILY_LIMIT) throw new Error(`daily limit of ${DAILY_LIMIT} emails reached`);
  const f = footer(lead);
  const info = await transporter().sendMail({
    from: `"Weekend Escape" <${process.env.GMAIL_USER}>`,
    to: lead.email,
    subject,
    text: text + f.text,
    html: wrapHtml(html + f.html),
    ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
    headers: { "List-Unsubscribe": `<${unsubUrl(lead.id)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  });
  if (save) {
    // Logged, not thrown: the email is already sent and must not be resent because of a save error.
    await db("emails", {
      method: "POST",
      body: { lead_id: lead.id, direction: "out", subject, body: text + f.text, message_id: info.messageId },
      prefer: "return=minimal",
    }).catch((e) => console.error("mail: could not save sent email", e.message));
  }
  return info.messageId;
}

// Email 1: claims the lead (new -> contacted) first, so two parallel calls never send twice.
async function sendEmail1(lead) {
  const claimed = await db(
    `leads?id=eq.${lead.id}&status=eq.new&consent=is.true&unsubscribed_at=is.null`,
    { method: "PATCH", body: { status: "contacted", last_email_at: new Date().toISOString() }, prefer: "return=representation" },
  );
  if (!claimed.length) return { sent: false, reason: "already emailed or not allowed" };
  try {
    const e1 = await buildEmail1(claimed[0]);
    await sendToLead(claimed[0], e1);
    return { sent: true, by: e1.by };
  } catch (e) {
    await db(`leads?id=eq.${lead.id}`, { method: "PATCH", body: { status: "new", last_email_at: null }, prefer: "return=minimal" });
    throw e;
  }
}

// The one follow-up: claims the lead (contacted -> followed_up) first, same reason.
async function sendFollowUp(lead) {
  const [first] = await db(`emails?select=subject,message_id&lead_id=eq.${lead.id}&direction=eq.out&order=sent_at.asc&limit=1`);
  if (!first) return { sent: false, reason: "no email 1 on record" };
  const claimed = await db(
    `leads?id=eq.${lead.id}&status=eq.contacted&follow_ups=eq.0&consent=is.true&unsubscribed_at=is.null`,
    { method: "PATCH", body: { status: "followed_up", follow_ups: 1, last_email_at: new Date().toISOString() }, prefer: "return=representation" },
  );
  if (!claimed.length) return { sent: false, reason: "already followed up or not allowed" };
  try {
    await sendToLead(claimed[0], { ...buildFollowUp(claimed[0], first.subject), inReplyTo: first.message_id });
    return { sent: true };
  } catch (e) {
    await db(`leads?id=eq.${lead.id}`, {
      method: "PATCH", body: { status: "contacted", follow_ups: 0, last_email_at: lead.last_email_at }, prefer: "return=minimal",
    });
    throw e;
  }
}

// Preview of both emails to a test address. Not saved, not counted against a lead.
async function sendPreview(to) {
  const fake = {
    id: "preview", email: to, name: "Test", consent: true, marketing_consent: true,
    answers: { transport: "train", destination: { id: "lille", city: "Lille", estimatedTotal: 99 } },
  };
  const e1 = await buildEmail1(fake);
  await sendToLead(fake, { ...e1, subject: `[Preview] ${e1.subject}` }, { save: false });
  const fu = buildFollowUp(fake, e1.subject);
  await sendToLead(fake, { ...fu, subject: `[Preview] ${fu.subject}` }, { save: false });
}

module.exports = { sendEmail1, sendFollowUp, sendPreview, buildEmail1 };
