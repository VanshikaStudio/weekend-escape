-- Weekend Escape · database schema (Supabase / Postgres)
-- Shape from AGENTS.md. Run once; safe to re-run.

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  email text not null,
  consent boolean not null,
  answers jsonb,                -- quiz answers, school and the destination we showed
  status text not null default 'new'
    check (status in ('new', 'contacted', 'followed_up', 'replied', 'meeting', 'won', 'lost')),
  notes text,
  last_email_at timestamptz,
  follow_ups int not null default 0,
  unsubscribed_at timestamptz   -- set when the lead opts out; never email them again
);

-- consent = itinerary + follow-up emails (required box).
-- marketing_consent = optional cheap-ticket alerts (separate, unticked box).
alter table leads add column if not exists marketing_consent boolean not null default false;

-- One lead per email address: a second quiz updates the same row.
-- The server saves emails in lowercase, so a plain unique constraint is enough.
drop index if exists leads_email_unique;
do $$ begin
  alter table leads add constraint leads_email_key unique (email);
exception when duplicate_table or duplicate_object then null; end $$;

create table if not exists emails (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  direction text not null check (direction in ('out', 'in')),
  subject text,
  body text,
  message_id text unique,       -- the same email is never saved twice
  sent_at timestamptz not null default now()
);

create index if not exists emails_lead_id on emails (lead_id);

-- No policy: only the server, with the service role key, can read or write.
alter table leads enable row level security;
alter table emails enable row level security;
