# Supabase database setup (stage 2)

The migration is not applied automatically by Vercel. It contains no secrets.
Use a dedicated development/preview Supabase project first, separate from any
production database. Do not apply it to an existing database without reviewing
its tables. The migration intentionally fails on existing objects rather than
silently replacing them. It runs in one transaction; record successful application
and do not rerun an already-applied migration.

## Apply and inspect

1. In the intended Vercel project, use Storage to create/connect Supabase.
2. In that Supabase project's SQL Editor, run
   `migrations/202610200001_lead_capture.sql` once.
3. In Table Editor, verify `leads` and `emails`, with RLS enabled for both.
4. Run the read-only checks below. Both RLS flags must be true, both browser role
   privileges must be false, and service_role privileges must be true.

```sql
select relname, relrowsecurity
from pg_class join pg_namespace on pg_namespace.oid = pg_class.relnamespace
where nspname = 'public' and relname in ('leads', 'emails');

select role_name, table_name,
  has_table_privilege(role_name, 'public.' || table_name, 'SELECT') as can_read,
  has_table_privilege(role_name, 'public.' || table_name, 'INSERT') as can_insert
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
cross join (values ('leads'), ('emails')) tables(table_name);
```

Do not add browser-accessible policies. All application reads/writes must go
through server routes using `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
Configure these only in the appropriate Vercel environment settings; never paste
keys in chat or GitHub. Do not create `.env` files or run `vercel env pull`.
Do not bind a development preview to a production database by default.

## Data contract for the next stages

- Generate one `submission_key` UUID per logical form submission and reuse it on
  retries. The unique constraint rejects repeats; the server must compare the
  saved payload before treating a duplicate as a successful retry. A new quiz
  submission can have a new key; email addresses are not globally unique.
- Save `firstName` as `name`; save the original budget object, transport, vibe,
  destination ID, and optional school in `answers`. The server must fully
  validate these against the curated data; the database checks basic JSON shape.
- Save the exact approved consent wording and server timestamp. The check
  requires consent for this current form; separate marketing preferences will
  require a reviewed change after the team approves the consent model.
- `unsubscribed_at` suppresses future sends, regardless of lead status. A new
  submission must not be used to bypass an existing email-address opt-out; the
  server opt-out workflow must update/check matching normalized addresses.
- Before SMTP, call `reserve_outbound_email` server-side with kind `initial` or
  `follow_up`. It serializes claims, checks status/consent/opt-out, enforces the
  follow-up delay, and caps reservations at 100 per UTC day across both kinds.
  NULL means no send is authorized. Only a returned reservation UUID permits the
  next step. The mailer must recheck consent, replies, and opt-out immediately
  before sending; a reservation alone cannot eliminate SMTP/database races.
- Fill in the approved subject/body/message ID; after confirmed SMTP acceptance,
  set `delivery_state='sent'`, `sent_at`, and the lead's status/last_email_at
  atomically. Follow-ups also set `follow_ups=1`. Completion operations and the
  actual SMTP/IMAP integration belong to later stages.
- Pending/unknown reservations are never automatically reused. Inspect ambiguous
  outcomes before retrying; this avoids duplicate emails after SMTP timeouts.
  Failed/unknown reservations consume a daily slot conservatively. This is a
  reservation-day limit; the mailer must not send stale reservations on a later
  UTC day without a reviewed reconciliation path.
- Inbound messages use `direction='in'`, `delivery_state='received'`, `kind=NULL`,
  and the message timestamp in `sent_at`. A unique `message_id` deduplicates IMAP
  imports. Rows with an outbound reservation are not reported as delivered.

This stage does not connect the form or send email. Those features remain pending.
