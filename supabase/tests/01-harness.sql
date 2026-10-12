-- Test harness shared by every test file. Runs as a superuser. Each check is one row in zz.results;
-- 99-report.sql prints the failures and fails the run if there are any.
--   zz.att(user, sql [, keep])  run one statement as that user (null = anon) -> 'ok:<rows>' | 'err:<sqlstate>:<message>'
--   zz.val(user, sql [, keep])  same for a scalar query                    -> 'val:<value>' | 'err:...'
--   zz.su(sql [, keep])         same as the superuser (operator / SQL editor)
-- Attempts are rolled back unless keep is true; an error always rolls the attempt back (like one API call).
\set ON_ERROR_STOP on
create schema if not exists zz;
create extension if not exists dblink schema zz;
create table if not exists zz.ids (k text primary key, v uuid not null);
create table if not exists zz.codes (k text primary key, v text not null);
create table if not exists zz.results (n serial primary key, suite text, grp text, descr text, expected text, actual text, pass boolean);

create or replace function zz.id(p text) returns uuid language plpgsql stable as $$
declare r uuid;
begin
  select v into r from zz.ids where k = p;
  if r is null then raise exception 'zz.id: unknown key %', p; end if;
  return r;
end $$;

create or replace function zz.code(p text) returns text language plpgsql stable as $$
declare r text;
begin
  select v into r from zz.codes where k = p;
  if r is null then raise exception 'zz.code: unknown key %', p; end if;
  return r;
end $$;

create or replace function zz.att(p_user uuid, p_sql text, p_keep boolean default false) returns text
language plpgsql as $$
declare n bigint; r text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform set_config('role', case when p_user is null then 'anon' else 'authenticated' end, true);
  begin
    execute p_sql;
    get diagnostics n = row_count;
    r := 'ok:' || n;
    if not p_keep then raise exception using errcode = 'ZZ999', message = 'rollback'; end if;
  exception when others then
    if sqlstate <> 'ZZ999' then r := 'err:' || sqlstate || ':' || sqlerrm; end if;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return r;
end $$;

create or replace function zz.val(p_user uuid, p_sql text, p_keep boolean default false) returns text
language plpgsql as $$
declare v text; r text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform set_config('role', case when p_user is null then 'anon' else 'authenticated' end, true);
  begin
    execute p_sql into v;
    r := 'val:' || coalesce(v, 'NULL');
    if not p_keep then raise exception using errcode = 'ZZ999', message = 'rollback'; end if;
  exception when others then
    if sqlstate <> 'ZZ999' then r := 'err:' || sqlstate || ':' || sqlerrm; end if;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return r;
end $$;

create or replace function zz.su(p_sql text, p_keep boolean default false) returns text
language plpgsql as $$
declare v text; r text;
begin
  begin
    execute p_sql into v;
    r := 'val:' || coalesce(v, 'NULL');
    if not p_keep then raise exception using errcode = 'ZZ999', message = 'rollback'; end if;
  exception when others then
    if sqlstate <> 'ZZ999' then r := 'err:' || sqlstate || ':' || sqlerrm; end if;
  end;
  return r;
end $$;

create or replace function zz.chk(p_grp text, p_descr text, p_expected text, p_actual text) returns void
language sql as $$
  insert into zz.results (suite, grp, descr, expected, actual, pass)
  values (current_setting('zz.suite', true), p_grp, p_descr, p_expected, p_actual, coalesce(p_actual ~ p_expected, false));
$$;

create or replace function zz.ok(p_grp text, p_descr text, p_cond boolean) returns void
language sql as $$
  select zz.chk(p_grp, p_descr, '^true$', coalesce(p_cond::text, 'null'));
$$;

create or replace function zz.eq(p_grp text, p_descr text, p_expected text, p_actual text) returns void
language sql as $$
  insert into zz.results (suite, grp, descr, expected, actual, pass)
  values (current_setting('zz.suite', true), p_grp, p_descr, '= ' || coalesce(p_expected, 'NULL'), coalesce(p_actual, 'NULL'),
          p_expected is not distinct from p_actual);
$$;

-- an auth.users row (= someone who signed up)
create or replace function zz.user(p_key text, p_id uuid, p_email text) returns uuid language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at) values (p_id, p_email, now());
  insert into zz.ids values (p_key, p_id) on conflict (k) do update set v = excluded.v;
  return p_id;
end $$;

-- join_with_code as that user, kept (like a real API call)
create or replace function zz.join(p_user uuid, p_code text) returns text language sql as $$
  select zz.val(p_user, format('select public.join_with_code(%L)', p_code), true);
$$;

-- create_invitation as that user, kept; returns the plain code and remembers it under p_key
create or replace function zz.invite(p_key text, p_user uuid, p_org uuid, p_role text, p_label text default null) returns text
language plpgsql as $$
declare r text;
begin
  r := zz.val(p_user, format('select code from public.create_invitation(%L, %L, %L)', p_org, p_role, p_label), true);
  if r !~ '^val:[A-Z0-9]{8}$' then raise exception 'zz.invite(%): %', p_key, r; end if;
  insert into zz.codes values (p_key, substr(r, 5)) on conflict (k) do update set v = excluded.v;
  return substr(r, 5);
end $$;

-- Start from an empty project (keeps zz.results so one report covers every suite).
create or replace function zz.reset_data() returns void language plpgsql as $$
begin
  truncate public.audit_log, public.join_attempts, public.invitation_codes, public.invitations,
    public.organization_members, public.expenses, public.payments, public.invoices, public.lease_addons,
    public.leases, public.tenants, public.addon_catalog, public.rooms, public.properties, public.organizations cascade;
  truncate auth.users cascade;
  delete from storage.objects;
  update public.app_settings set setup_code_hash = null, setup_code_used_at = null;
  truncate zz.ids, zz.codes;
end $$;

-- Second session for lock tests: connects as the same superuser, then acts as p_user through the API role.
create or replace function zz.dbl_open(p_name text, p_user uuid) returns int language plpgsql as $$
begin
  perform zz.dblink_connect(p_name, format('dbname=%s user=%s port=%s', current_database(), current_user, current_setting('port')));
  perform zz.dblink_exec(p_name, format('set request.jwt.claim.sub = %L', p_user));
  perform zz.dblink_exec(p_name, 'set role authenticated');
  return (select pid from zz.dblink(p_name, 'select pg_backend_pid()') as t(pid int));
end $$;

-- Wait until backend p_pid is blocked on a lock; returns its wait_event_type ('Lock') or 'not waiting'.
create or replace function zz.wait_for_lock(p_pid int) returns text language plpgsql as $$
declare w text;
begin
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    select wait_event_type into w from pg_stat_activity where pid = p_pid;
    if w = 'Lock' then return w; end if;
    perform pg_sleep(0.05);
  end loop;
  return 'not waiting';
end $$;

-- Structural and privilege checks that must hold after every application of schema.sql.
create or replace function zz.check_structure(p_grp text) returns void language plpgsql as $$
declare
  t text;
  f text;
  secret text[] := array['app_settings', 'join_attempts', 'invitation_codes'];
  rpc text[] := array['ensure_membership()', 'join_with_code(text)', 'create_invitation(uuid,text,text)',
    'set_member_role(uuid,uuid,text)', 'remove_member(uuid,uuid)', 'recalc_invoice_status(uuid)',
    'is_org_member(uuid)', 'is_org_admin(uuid)', 'is_org_owner(uuid)', 'path_org_id(text)', 'invoice_status_for(bigint,bigint)'];
begin
  -- secrets: RLS on, no policies, no table privileges for the API roles
  foreach t in array secret loop
    perform zz.ok(p_grp, t || ': RLS enabled', (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass));
    perform zz.ok(p_grp, t || ': no policies', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t));
    perform zz.ok(p_grp, t || ': no privileges for anon/authenticated', not (
      has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('authenticated', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')));
  end loop;
  -- every table: RLS on, anon has nothing, nobody can TRUNCATE (it ignores RLS)
  for t in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' loop
    perform zz.ok(p_grp, t || ': RLS enabled', (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass));
    perform zz.ok(p_grp, t || ': anon has no privileges',
      not has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
    perform zz.ok(p_grp, t || ': authenticated cannot TRUNCATE/REFERENCES/TRIGGER',
      not has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE,REFERENCES,TRIGGER'));
  end loop;
  -- audit_log: read-only for authenticated, admin-only select policy, nothing else
  perform zz.ok(p_grp, 'audit_log: authenticated may SELECT', has_table_privilege('authenticated', 'public.audit_log', 'SELECT'));
  perform zz.ok(p_grp, 'audit_log: authenticated cannot INSERT/UPDATE/DELETE',
    not has_table_privilege('authenticated', 'public.audit_log', 'INSERT,UPDATE,DELETE'));
  perform zz.chk(p_grp, 'audit_log: only a select policy', '^SELECT:[^,]*is_org_admin\(org_id\)[^,]*$',
    (select string_agg(cmd || ':' || qual, ',') from pg_policies where schemaname = 'public' and tablename = 'audit_log'));
  -- functions: authenticated may execute exactly the RPCs and policy helpers; anon nothing
  perform zz.eq(p_grp, 'functions executable by authenticated', array_to_string(array(select x from unnest(rpc) x order by x), ','),
    (select string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text)
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')));
  perform zz.ok(p_grp, 'anon cannot execute any public function', not exists (
    select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
       and has_function_privilege('anon', p.oid, 'EXECUTE')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')));
  perform zz.ok(p_grp, 'set_setup_code: not executable by PUBLIC/anon/authenticated', not (
    has_function_privilege('anon', 'public.set_setup_code(text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.set_setup_code(text)', 'EXECUTE')
    or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.oid = 'public.set_setup_code(text)'::regprocedure and a.grantee = 0)));
  perform zz.ok(p_grp, 'set_setup_code: executable by service_role', has_function_privilege('service_role', 'public.set_setup_code(text)', 'EXECUTE'));
  perform zz.ok(p_grp, 'every security definer function pins search_path', not exists (
    select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
       and not exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public, pg_temp')));
  perform zz.ok(p_grp, 'join_with_code is security definer', (select prosecdef from pg_proc where oid = 'public.join_with_code(text)'::regprocedure));
  -- dropped in v0.3
  foreach f in array array['handle_new_user', 'accept_invitations_for', 'add_member_by_email', 'delete_tenant_ktp', 'delete_expense_receipt'] loop
    perform zz.ok(p_grp, f || ' is gone', not exists (select 1 from pg_proc where proname = f and pronamespace = 'public'::regnamespace));
  end loop;
  perform zz.ok(p_grp, 'no trigger on auth.users', not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal));
  perform zz.ok(p_grp, 'storage cleanup triggers are gone', not exists (
    select 1 from pg_trigger where tgname in ('tenants_delete_ktp', 'expenses_delete_receipt')));
  perform zz.ok(p_grp, 'members_update policy is gone', not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'organization_members' and cmd <> 'SELECT'));
  perform zz.ok(p_grp, 'no unique index on invitations email', not exists (
    select 1 from pg_index i where i.indrelid = 'public.invitations'::regclass and i.indisunique and pg_get_indexdef(i.indexrelid) ilike '%email%'));
  -- invitation columns
  perform zz.ok(p_grp, 'invitations.email is nullable', (select not attnotnull from pg_attribute where attrelid = 'public.invitations'::regclass and attname = 'email'));
  perform zz.chk(p_grp, 'invitations has label, expires_at (not null), accepted_by', '^label:false,expires_at:true,accepted_by:false$',
    (select string_agg(attname || ':' || attnotnull, ',' order by array_position(array['label', 'expires_at', 'accepted_by'], attname::text))
       from pg_attribute where attrelid = 'public.invitations'::regclass and attname in ('label', 'expires_at', 'accepted_by') and not attisdropped));
  perform zz.ok(p_grp, 'app_settings has its single row', (select count(*) = 1 from public.app_settings where id = 1));
  -- audit triggers on all twelve tables
  perform zz.chk(p_grp, 'audit trigger on every audited table', '^12$', (select count(*)::text from pg_trigger where tgname = 'audit_row_change'));
end $$;
