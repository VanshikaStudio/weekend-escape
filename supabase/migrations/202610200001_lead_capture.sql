-- Apply once through Supabase SQL Editor or the project's migration workflow.
-- Run as the migration owner, never from a browser or public API endpoint.
begin;

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  submission_key uuid not null unique,
  name text,
  email text not null check (length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  consent boolean not null check (consent),
  consent_at timestamptz not null default now(),
  consent_text text not null check (length(btrim(consent_text)) > 0),
  unsubscribed_at timestamptz,
  answers jsonb not null check (
    jsonb_typeof(answers) = 'object'
    and answers ?& array['budget', 'transport', 'vibe', 'destination']
  ),
  status text not null default 'new'
    check (status in ('new', 'contacted', 'followed_up', 'replied', 'meeting', 'won', 'lost')),
  notes text,
  last_email_at timestamptz,
  follow_ups int not null default 0 check (follow_ups between 0 and 1)
);

create index leads_email_lookup on public.leads (lower(btrim(email)));
create index leads_follow_up_candidates on public.leads (last_email_at)
  where status in ('contacted', 'followed_up') and unsubscribed_at is null;

create table public.emails (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  direction text not null check (direction in ('out', 'in')),
  subject text,
  body text,
  message_id text unique,
  -- Outgoing rows are reserved before SMTP; sent_at remains null until confirmed.
  sent_at timestamptz,
  kind text check (kind in ('initial', 'follow_up')),
  delivery_state text not null check (delivery_state in ('pending', 'sent', 'received', 'failed', 'unknown')),
  check (
    (direction = 'in' and kind is null and delivery_state = 'received' and sent_at is not null)
    or
    (direction = 'out' and kind is not null and delivery_state <> 'received'
      and ((delivery_state = 'sent' and sent_at is not null)
        or (delivery_state <> 'sent' and sent_at is null)))
  )
);

create index emails_lead_history on public.emails (lead_id, created_at);
create index emails_daily_outbound on public.emails (created_at) where direction = 'out';
create unique index emails_one_outbound_per_kind on public.emails (lead_id, kind)
  where direction = 'out';

alter table public.leads enable row level security;
alter table public.emails enable row level security;
-- No public policies: both table privileges and RLS deny browser access.
revoke all on public.leads, public.emails from public, anon, authenticated;
grant select, insert, update, delete on public.leads, public.emails to service_role;

-- A reservation is an audit record, not proof of delivery. Do not automatically
-- recycle it after timeouts: SMTP may have accepted the message before a crash.
create function public.reserve_outbound_email(p_lead_id uuid, p_kind text, p_follow_up_days integer default 3)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.leads%rowtype;
  reservation_id uuid;
  day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
  if p_kind is null or p_kind not in ('initial', 'follow_up')
    or p_follow_up_days is null or p_follow_up_days < 0 then
    raise exception 'Invalid send parameters';
  end if;

  -- All callers share this transaction lock, including overlapping cron runs.
  perform pg_advisory_xact_lock(829143, 1);
  select * into target from public.leads where id = p_lead_id for update;
  if not found or not target.consent or target.unsubscribed_at is not null then
    return null;
  end if;
  if p_kind = 'initial' and target.status <> 'new' then return null; end if;
  if p_kind = 'follow_up' and (
    target.status <> 'contacted' or target.follow_ups <> 0
    or target.last_email_at is null
    or target.last_email_at > now() - make_interval(days => p_follow_up_days)
  ) then return null; end if;

  if exists (select 1 from public.emails where lead_id = p_lead_id
    and direction = 'out' and kind = p_kind) then return null; end if;

  -- Count all reservations conservatively, including failed/unknown sends.
  if (select count(*) from public.emails where direction = 'out'
    and created_at >= day_start and created_at < day_start + interval '24 hours') >= 100
    then return null;
  end if;

  insert into public.emails (lead_id, direction, kind, delivery_state)
    values (p_lead_id, 'out', p_kind, 'pending') returning id into reservation_id;
  return reservation_id;
end;
$$;

revoke all on function public.reserve_outbound_email(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.reserve_outbound_email(uuid, text, integer) to service_role;

commit;
