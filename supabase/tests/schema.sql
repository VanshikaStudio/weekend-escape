-- Disposable database only. Roll back all test data.
begin;

do $$
declare
  lead_id uuid;
  claim uuid;
  i integer;
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('leads','emails') and not c.relrowsecurity)
    then raise exception 'RLS not enabled'; end if;
  if has_table_privilege('anon', 'public.leads', 'SELECT')
    or has_table_privilege('authenticated', 'public.emails', 'INSERT')
    or has_function_privilege('anon', 'public.reserve_outbound_email(uuid,text,integer)', 'EXECUTE')
    then raise exception 'Browser role has access'; end if;
end $$;

set local role anon;
do $$ begin
  begin
    perform 1 from public.leads;
    raise exception 'Anonymous read unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    delete from public.emails;
    raise exception 'Authenticated write unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;

do $$
declare
  target uuid;
  key uuid := gen_random_uuid();
  claim uuid;
  candidate uuid;
  payload jsonb := '{"budget":{"max":100,"cap":100},"transport":"train","vibe":"chill","destination":"lille","school":"Test"}';
begin
  insert into public.leads (submission_key,email,consent,consent_text,answers)
    values (key,'student@example.com',true,'Test consent',payload) returning id into target;
  begin
    insert into public.leads (submission_key,email,consent,consent_text,answers)
      values (key,'student@example.com',true,'Test consent',payload);
    raise exception 'Duplicate submission accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.leads (submission_key,email,consent,consent_text,answers)
      values (gen_random_uuid(),'student@example.com',false,'Test consent',payload);
    raise exception 'Unconsented lead accepted';
  exception when check_violation then null; end;

  claim := public.reserve_outbound_email(target,'initial');
  if claim is null then raise exception 'Initial claim denied'; end if;
  if public.reserve_outbound_email(target,'initial') is not null
    then raise exception 'Duplicate claim allowed'; end if;
  if public.reserve_outbound_email(target,'follow_up',0) is not null
    then raise exception 'Follow-up before delivery allowed'; end if;
  update public.emails set delivery_state='sent',sent_at=now(),message_id='test-initial' where id=claim;
  update public.leads set status='contacted',last_email_at=now() where id=target;
  if public.reserve_outbound_email(target,'follow_up',3) is not null
    then raise exception 'Premature follow-up allowed'; end if;
  update public.leads set last_email_at=now()-interval '4 days',unsubscribed_at=now() where id=target;
  if public.reserve_outbound_email(target,'follow_up') is not null
    then raise exception 'Opted-out follow-up allowed'; end if;
  update public.leads set unsubscribed_at=null,status='replied' where id=target;
  if public.reserve_outbound_email(target,'follow_up') is not null
    then raise exception 'Follow-up after reply allowed'; end if;
  update public.leads set status='contacted' where id=target;
  claim := public.reserve_outbound_email(target,'follow_up');
  if claim is null then raise exception 'Eligible follow-up denied'; end if;
  if public.reserve_outbound_email(target,'follow_up') is not null
    then raise exception 'Second follow-up allowed'; end if;

  insert into public.emails (lead_id,direction,delivery_state,message_id,sent_at)
    values (target,'in','received','test-reply',now());
  begin
    insert into public.emails (lead_id,direction,delivery_state,message_id,sent_at)
      values (target,'in','received','test-reply',now());
    raise exception 'Duplicate inbound message accepted';
  exception when unique_violation then null; end;

  -- Two previous reservations + 98 new ones consume the shared daily budget.
  for i in 1..98 loop
    insert into public.leads (submission_key,email,consent,consent_text,answers)
      values (gen_random_uuid(),'cap@example.com',true,'Test consent',payload) returning id into candidate;
    if public.reserve_outbound_email(candidate,'initial') is null
      then raise exception 'Daily cap triggered too early'; end if;
  end loop;
  insert into public.leads (submission_key,email,consent,consent_text,answers)
    values (gen_random_uuid(),'cap@example.com',true,'Test consent',payload) returning id into candidate;
  if public.reserve_outbound_email(candidate,'initial') is not null
    then raise exception 'Daily cap exceeded'; end if;
end $$;
reset role;
rollback;
