"""Validate the migration in disposable PostgreSQL; never uses cloud credentials."""
import concurrent.futures
import pathlib
import subprocess
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONTAINER = 'weekend-escape-test-' + uuid.uuid4().hex[:12]


def docker(*args, sql=None):
    return subprocess.run(['docker', *args], input=sql, text=True, check=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


def query(sql):
    return docker('exec', '-i', CONTAINER, 'psql', '-h', '127.0.0.1', '-U', 'postgres',
                  '-v', 'ON_ERROR_STOP=1', '-Atq', sql=sql)


try:
    # No published host port. Trust is restricted to this disposable test instance.
    docker('run', '--detach', '--rm', '--name', CONTAINER,
           '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine')
    for attempt in range(100):
        try:
            docker('exec', CONTAINER, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres')
            break
        except subprocess.CalledProcessError:
            time.sleep(0.2)
    else:
        raise RuntimeError('Disposable PostgreSQL did not become ready')
    # Match the relevant Supabase built-in roles without real credentials.
    query('create role anon; create role authenticated; '
          'create role service_role bypassrls; '
          'grant usage on schema public to anon, authenticated, service_role;')
    query((ROOT / 'supabase/migrations/202610200001_lead_capture.sql').read_text())
    query((ROOT / 'supabase/tests/schema.sql').read_text())
    print('PASS: role access, RLS, submission deduplication, consent, send eligibility, '
          'reply/opt-out suppression, message deduplication, and 100-send daily cap')
    lead_id = query("insert into public.leads(submission_key,email,consent,consent_text,answers) "
                    "values(gen_random_uuid(),'race@example.com',true,'Test consent',"
                    "'{\"budget\":{},\"transport\":\"train\",\"vibe\":\"chill\",\"destination\":\"lille\"}') returning id;").strip()

    def reserve(_):
        return query("set role service_role; select public.reserve_outbound_email('"
                     + lead_id + "','initial');").strip()

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        claims = list(pool.map(reserve, range(4)))
    assert sum(bool(claim) for claim in claims) == 1, claims
    assert query('select count(*) from public.emails;').strip() == '1'
    print('PASS: four simultaneous requests produce exactly one reservation')
    query("""do $$ declare candidate uuid; begin
      for i in 1..98 loop
        insert into public.leads(submission_key,email,consent,consent_text,answers)
        values(gen_random_uuid(),'limit@example.com',true,'Test consent',
          '{"budget":{},"transport":"train","vibe":"chill","destination":"lille"}') returning id into candidate;
        perform public.reserve_outbound_email(candidate,'initial');
      end loop;
    end $$;""")
    candidates = query("""insert into public.leads(submission_key,email,consent,consent_text,answers)
      select gen_random_uuid(),'race-limit@example.com',true,'Test consent',
      '{"budget":{},"transport":"train","vibe":"chill","destination":"lille"}'::jsonb
      from generate_series(1,4) returning id;""").splitlines()

    def reserve_candidate(candidate):
        return query("set role service_role; select public.reserve_outbound_email('"
                     + candidate + "','initial');").strip()

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        claims = list(pool.map(reserve_candidate, candidates))
    assert sum(bool(claim) for claim in claims) == 1, claims
    assert query('select count(*) from public.emails;').strip() == '100'
    print('PASS: concurrent requests across different leads cannot exceed the daily cap')
except subprocess.CalledProcessError as error:
    # These commands use synthetic data only, never production secrets.
    raise RuntimeError(error.stderr) from error
finally:
    subprocess.run(['docker', 'rm', '-f', CONTAINER], stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL, check=False)
