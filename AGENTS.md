# AGENTS.md · Weekend Escape

## The project · OURS

- **What our lead magnet does:** Helps students in Paris discover an affordable weekend trip based on their budget, transport preference and travel vibe, then unlock a Friday-to-Sunday itinerary with an email address.
- **Who it is for:** Budget-conscious university, business-school and Erasmus students living or studying in Paris who want short European trips departing from Paris.
- **What we want from a lead:** A permission-based email sign-up to receive their itinerary and, where consented to, relevant weekend travel offers. Later, encourage a return visit or booking through clearly disclosed links; there is no sales call requirement.
- **What our form collects:** Quiz: `budget` (selected range and maximum), `transport` (`train`, `plane`, `either`), `vibe` (`chill`, `culture`, `party`, `mix`). Email gate: `email` (required), `firstName` (optional), `school` (optional), `consent` (required). Also save the recommended `destination` and quiz answers in `answers` JSONB. Preserve the original selected values rather than inventing additional answers.
- **A good lead for us:** A Paris-based student who completes the quiz, enters a valid email and explicitly agrees to receive the itinerary and relevant offers.
- **A lead we ignore:** An invalid or unconsented submission, or a bot/spam entry. Never send marketing emails to a lead without valid consent.

### Current website and scope

- Start from the existing `index.html` landing page; preserve its visual design, quiz, destination cards, recommendation logic, estimated-price disclosures and email-gated itinerary.
- The current recommendation engine is **rules-based on curated destination data**, not a live-price search or an LLM. Do not represent estimates as live prices or simulated operations as completed actions.
- The current `submitLead()` is a simulated delay. Replace it with a real call to a server endpoint; only unlock after a successful server response, with clear error and retry states.
- The first implementation should connect the existing page to a server, Supabase and the agreed email workflow. Do not add live booking APIs, an LLM, paid products or new services without asking.
- Before changing the page's email consent wording, ask us to approve the final wording and clarify whether itinerary delivery and optional travel marketing require separate choices.

## How you work with us · KEEP

1. **Plan first.** For every request, propose a short plan (files, tables, variables) and wait for our OK.
2. **Small steps.** After each step, tell us exactly how to check that it works.
3. **Secrets.** Never print, log or commit a secret. When we give you one in the chat, set it yourself in `.env.local` and in Vercel (`vercel env add`, value piped so it is never displayed, for every environment), then redeploy. Generate `CRON_SECRET` yourself.
4. **Ship.** When a step works, commit with a clear message and push to `main`: Vercel deploys on every push. Confirm the target repository and deployment before the first push.
5. **Tools.** Supabase MCP for tables and rows, Vercel MCP for deployments and logs, the terminal for git and `vercel`.
6. **Ask before** adding a service, a library we did not mention or a paid plan.
7. **When something breaks**, read the error and the Vercel logs first, explain the cause, then fix.

## Infrastructure · KEEP

| Piece | What we use | Notes |
|---|---|---|
| Front + back-end | Our app on Vercel | The back-end is the app's server routes. Static site? Vercel Functions in `/api` (Node.js). |
| Database | Supabase, created from Vercel › Storage | The integration sets the Supabase variables in Vercel. Locally: `vercel link`, then `vercel env pull .env.local`. |
| Send emails | Our project Gmail, SMTP with Nodemailer | `smtp.gmail.com`, port 465, `secure: true`, an app password (not the account password). |
| Read replies | Same Gmail, IMAP with ImapFlow | `imap.gmail.com`, port 993, TLS, same app password. |
| Daily robot | Vercel Cron in `vercel.json` | Free plan: once a day, within the hour. |

**Back-end rules:** The browser never talks to Supabase or Gmail; every read and write goes through server routes. `/admin` is protected by `ADMIN_PASSWORD`, checked on the server. The robot is a server route called by Vercel Cron, which refuses any call without `Authorization: Bearer <CRON_SECRET>`.

## Environment variables · KEEP (names only, never the values)

| Variable | Set by | Used for |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Vercel › Storage › Supabase | Server routes only: the service role key never reaches the browser. |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | We create them in Google, you set them | SMTP and IMAP. |
| `ADMIN_PASSWORD` | We choose it, you set it | Login of `/admin`. |
| `CRON_SECRET` | You generate it (long random text) | Vercel sends it to the robot route. |
| `FOLLOW_UP_DAYS` | You, 3 by default | Days without reply before the follow-up; 0 to test. |

`.env.local` stays in `.gitignore`. After changing a variable in Vercel, redeploy.

## Database · KEEP the shape, adapt the fields

Two tables. Keep `email`, `consent`, `status`, `last_email_at` and `follow_ups`, which the emails and robot rely on. Store quiz answers and the selected destination in `answers` JSONB; use `name` for the optional first name, and keep school in `answers.school`.

```sql
create table leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  email text not null,
  consent boolean not null,
  answers jsonb,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'followed_up', 'replied', 'meeting', 'won', 'lost')),
  notes text,
  last_email_at timestamptz,
  follow_ups int not null default 0
);

create table emails (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  direction text not null check (direction in ('out', 'in')),
  subject text,
  body text,
  message_id text unique,
  sent_at timestamptz not null default now()
);

alter table leads enable row level security;
alter table emails enable row level security;
```

No browser-accessible RLS policies: only server routes use the service role key. Validate all submitted data server-side. Avoid duplicate submissions and concurrent duplicate follow-ups.

## Emails · KEEP the settings, OURS the words

- **KEEP:** Send from `"Weekend Escape" <GMAIL_USER>`, plain text plus a short HTML version, with one line explaining why the recipient receives it. Only send to leads with `consent = true`, at most 100 emails a day, and test on our own addresses first. Save every sent and received email in `emails`. Email 1 moves the lead to `contacted` and updates `last_email_at`.
- **OURS · Email 1 (copy pending team approval):** Friendly, concise, student-to-student tone. Deliver or link to the student's personalized weekend itinerary, including destination, estimated budget and next step. Ask us to supply and approve the exact subject and text before implementing sending.
- **OURS · The follow-up (copy pending team approval):** Friendly, low-pressure, brief reminder of their trip idea with one helpful additional suggestion and a single next step. Ask us to supply and approve the exact subject and text before implementing sending.

**We write the texts: ask us for them, do not invent them.** Include a working opt-out mechanism before sending promotional emails; respect opt-outs and never follow up with opted-out leads. Do not claim that a booking is confirmed or that estimates are live prices.

## The follow-up robot · KEEP

At every run:

1. Take the waiting leads: `status` is `contacted` or `followed_up`. Never touch `replied`, `meeting`, `won`, `lost`.
2. Over IMAP, look for an email **from** the lead's address received after `last_email_at`. IMAP `SINCE` works by day: filter on the message date after fetching.
3. Reply found: save it in `emails` (`direction = 'in'`), set `status = 'replied'`. The robot never writes to this lead again.
4. No reply, `status = 'contacted'`, `last_email_at` older than `FOLLOW_UP_DAYS` days: send **one** follow-up (same subject with `Re:`), save it, set `status = 'followed_up'`, `follow_ups = 1`, `last_email_at = now()`.
5. Never a second follow-up, never after a reply: running the robot twice in a row sends nothing more.
6. Return a summary: leads checked, replies found, follow-ups sent, errors.

Schedule once a day in `vercel.json` (`"schedule": "0 7 * * *"` is 07:00 UTC; Paris local time varies with daylight saving). Include a **Run robot now** button in `/admin` for tests; its server call must enforce the same authorization protections.

## Out of scope today · KEEP

The LLM (Thursday), mass emailing, open tracking, any paid service.
