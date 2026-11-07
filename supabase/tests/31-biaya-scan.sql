-- Biaya scan (SPEC 7.17): public.scan_usage, one row per Claude reply the scan-nota Edge Function was billed for, written
-- with the project's secret key (service_role) and readable by owners/admins only; and the organisation's Claude credit
-- settings (organizations.claude_credit_monthly_usd / claude_credit_renewal_day), changed by owners/admins only (org_update).
-- Member writes go through the API role (zz.att = one API call); the function's writes run as service_role (zz.bs_svc).
\set ON_ERROR_STOP on
select set_config('zz.suite', '31-biaya-scan', false);
select zz.reset_data();

select zz.user('owner', '11111111-3131-0000-0000-000000000001', 'owner@biaya.test');
select zz.user('wife', '22222222-3131-0000-0000-000000000002', 'wife@biaya.test');
select zz.user('staff', '33333333-3131-0000-0000-000000000003', 'staff@biaya.test');
select zz.user('leaver', '66666666-3131-0000-0000-000000000006', 'leaver@biaya.test');
select zz.user('o2owner', '44444444-3131-0000-0000-000000000004', 'other@biaya.test');
select zz.user('stranger', '55555555-3131-0000-0000-000000000005', 'stranger@biaya.test');
select zz.su('select public.set_setup_code(''BIAYASCAN-31'')', true);
select zz.join(zz.id('owner'), 'biayascan31');
insert into zz.ids select 'org', id from public.organizations;
insert into zz.ids values ('org2', 'f3100000-0000-0000-0000-000000000091');

-- one statement as the scan-nota Edge Function runs it: the secret key = service_role, no signed-in user
create or replace function zz.bs_svc(p_sql text, p_keep boolean default false) returns text language plpgsql as $$
declare n bigint; r text;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'service_role', true);
  begin
    execute p_sql;
    get diagnostics n = row_count;
    r := 'ok:' || n;
    if not p_keep then raise exception using errcode = 'ZZ999', message = 'rollback'; end if;
  exception when others then
    if sqlstate <> 'ZZ999' then r := 'err:' || sqlstate || ':' || sqlerrm; end if;
  end;
  perform set_config('role', 'none', true);
  return r;
end $$;

-- the insert the function sends after a scan (p_at: an SQL expression for created_at)
create or replace function zz.bs_row(p_org uuid, p_user uuid, p_at text, p_cost numeric, p_outcome text default 'ok') returns text language sql as $$
  select format('insert into public.scan_usage (org_id, user_id, created_at, model, input_tokens, output_tokens, cost_usd, outcome, kind, lines, attempts) values (%L, %L, %s, %L, 3000, 4000, %s, %L, %s, %s, %L)',
    p_org, p_user, p_at, 'claude-opus-5-5', p_cost, p_outcome,
    case when p_outcome = 'ok' then quote_literal('expense_list') else 'null' end,
    case when p_outcome = 'ok' then '8' else 'null' end,
    '[{"model": "claude-opus-5-5", "input_tokens": 3000, "output_tokens": 4000, "cost_usd": ' || p_cost || '}]');
$$;

do $$
declare
  o uuid := zz.id('owner');
  org uuid := zz.id('org');
begin
  perform zz.eq('setup', 'wife joins as admin', 'val:' || org, zz.join(zz.id('wife'), zz.invite('wife', o, org, 'admin', 'Istri')));
  perform zz.eq('setup', 'staff joins as staff', 'val:' || org, zz.join(zz.id('staff'), zz.invite('staff', o, org, 'staff', 'Penjaga')));
  perform zz.eq('setup', 'leaver joins as staff', 'val:' || org, zz.join(zz.id('leaver'), zz.invite('leaver', o, org, 'staff', 'Sementara')));
end $$;

-- another family on the same project (operator)
insert into public.organizations (id, name, created_by) values (zz.id('org2'), 'Org Dua', zz.id('o2owner'));
insert into public.organization_members (org_id, user_id, email, role) values (zz.id('org2'), zz.id('o2owner'), 'other@biaya.test', 'owner');

-- A. structure
do $$ begin
  perform zz.eq('A-structure', 'scan_usage columns', 'id:uuid:true,org_id:uuid:true,user_id:uuid:false,created_at:timestamp with time zone:true,model:text:true,input_tokens:integer:true,output_tokens:integer:true,cost_usd:numeric(12,6):true,outcome:text:true,kind:text:false,lines:integer:false,attempts:jsonb:true',
    (select string_agg(attname || ':' || format_type(atttypid, atttypmod) || ':' || attnotnull, ',' order by attnum)
       from pg_attribute where attrelid = 'public.scan_usage'::regclass and attnum > 0 and not attisdropped));
  perform zz.eq('A-structure', 'foreign keys: org cascades, user set null',
    'FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE|FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL',
    (select string_agg(pg_get_constraintdef(oid), '|' order by pg_get_constraintdef(oid)) from pg_constraint where conrelid = 'public.scan_usage'::regclass and contype = 'f'));
  perform zz.eq('A-structure', 'index (org_id, created_at desc)', 'CREATE INDEX scan_usage_org_idx ON public.scan_usage USING btree (org_id, created_at DESC)',
    pg_get_indexdef('public.scan_usage_org_idx'::regclass));
  perform zz.eq('A-structure', 'organizations: credit columns, not null, defaults 100 and 1',
    'claude_credit_monthly_usd:numeric(10,2):true:100,claude_credit_renewal_day:smallint:true:1',
    (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || pg_get_expr(d.adbin, d.adrelid), ',' order by a.attname)
       from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = 'public.organizations'::regclass and a.attname like 'claude_credit_%' and not a.attisdropped));
  perform zz.eq('A-structure', 'one named check per credit column (a re-run adds no copy)',
    'organizations_claude_credit_monthly_usd_check:CHECK ((claude_credit_monthly_usd >= (0)::numeric)),organizations_claude_credit_renewal_day_check:CHECK (((claude_credit_renewal_day >= 1) AND (claude_credit_renewal_day <= 31)))',
    (select string_agg(conname || ':' || pg_get_constraintdef(oid), ',' order by conname) from pg_constraint
      where conrelid = 'public.organizations'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%claude_credit%'));
  perform zz.eq('A-structure', 'the new organisation starts at US$100, renewing on day 1', '100.00|1',
    (select claude_credit_monthly_usd || '|' || claude_credit_renewal_day from public.organizations where id = zz.id('org')));
end $$;

-- B. the function's writes (secret key): append only
do $$
declare
  org uuid := zz.id('org');
  s uuid := zz.id('staff');
begin
  perform zz.eq('B-function', 'records a scan of this cycle', 'ok:1', zz.bs_svc(zz.bs_row(org, s, 'now()', 0.092), true));
  perform zz.eq('B-function', 'records a refused scan (billed too)', 'ok:1', zz.bs_svc(zz.bs_row(org, zz.id('owner'), 'now()', 0.01, 'refused'), true));
  perform zz.eq('B-function', 'records an older scan (last cycle)', 'ok:1', zz.bs_svc(zz.bs_row(org, s, 'now() - interval ''40 days''', 0.15), true));
  perform zz.eq('B-function', 'records a scan by a member who later leaves', 'ok:1', zz.bs_svc(zz.bs_row(org, zz.id('leaver'), 'now()', 0.05), true));
  perform zz.eq('B-function', 'org2''s scan', 'ok:1', zz.bs_svc(zz.bs_row(zz.id('org2'), zz.id('o2owner'), 'now()', 0.2), true));
  perform zz.chk('B-function', 'the key cannot change a cost', '^err:42501', zz.bs_svc('update public.scan_usage set cost_usd = 0'));
  perform zz.chk('B-function', 'nor delete a scan', '^err:42501', zz.bs_svc('delete from public.scan_usage'));
  perform zz.chk('B-function', 'nor truncate', '^err:42501', zz.bs_svc('truncate public.scan_usage'));
  perform zz.chk('B-checks', 'ok without kind/lines -> refused', '^err:23514', zz.bs_svc(format(
    'insert into public.scan_usage (org_id, model, input_tokens, output_tokens, cost_usd, outcome) values (%L, %L, 1, 1, 0, %L)', org, 'claude-opus-5-5', 'ok')));
  perform zz.chk('B-checks', 'refused with lines -> refused', '^err:23514', zz.bs_svc(format(
    'insert into public.scan_usage (org_id, model, input_tokens, output_tokens, cost_usd, outcome, lines) values (%L, %L, 1, 1, 0, %L, 3)', org, 'claude-opus-5-5', 'refused')));
  perform zz.chk('B-checks', 'unknown outcome', '^err:23514', zz.bs_svc(format(
    'insert into public.scan_usage (org_id, model, input_tokens, output_tokens, cost_usd, outcome) values (%L, %L, 1, 1, 0, %L)', org, 'claude-opus-5-5', 'timeout')));
  perform zz.chk('B-checks', 'negative tokens', '^err:23514', zz.bs_svc(format(
    'insert into public.scan_usage (org_id, model, input_tokens, output_tokens, cost_usd, outcome) values (%L, %L, -1, 1, 0, %L)', org, 'claude-opus-5-5', 'refused')));
  perform zz.chk('B-checks', 'negative cost', '^err:23514', zz.bs_svc(format(
    'insert into public.scan_usage (org_id, model, input_tokens, output_tokens, cost_usd, outcome) values (%L, %L, 1, 1, -0.01, %L)', org, 'claude-opus-5-5', 'refused')));
  perform zz.chk('B-checks', 'blank model', '^err:23514', zz.bs_svc(format(
    'insert into public.scan_usage (org_id, model, input_tokens, output_tokens, cost_usd, outcome) values (%L, %L, 1, 1, 0, %L)', org, '  ', 'refused')));
  perform zz.chk('B-checks', 'negative output tokens', '^err:23514', zz.bs_svc(format(
    'insert into public.scan_usage (org_id, model, input_tokens, output_tokens, cost_usd, outcome) values (%L, %L, 1, -1, 0, %L)', org, 'claude-opus-5-5', 'refused')));
  perform zz.chk('B-checks', 'unknown kind', '^err:23514', zz.bs_svc(format(
    'insert into public.scan_usage (org_id, model, input_tokens, output_tokens, cost_usd, outcome, kind, lines) values (%L, %L, 1, 1, 0, %L, %L, 1)', org, 'claude-opus-5-5', 'ok', 'foo')));
  perform zz.chk('B-checks', 'negative lines', '^err:23514', zz.bs_svc(format(
    'insert into public.scan_usage (org_id, model, input_tokens, output_tokens, cost_usd, outcome, kind, lines) values (%L, %L, 1, 1, 0, %L, %L, -1)', org, 'claude-opus-5-5', 'ok', 'receipt')));
  perform zz.chk('B-checks', 'attempts must be an array', '^err:23514', zz.bs_svc(format(
    'insert into public.scan_usage (org_id, model, input_tokens, output_tokens, cost_usd, outcome, attempts) values (%L, %L, 1, 1, 0, %L, %L)', org, 'claude-opus-5-5', 'refused', '{}')));
  perform zz.chk('B-checks', 'an organisation that does not exist', '^err:23503', zz.bs_svc(format(
    'insert into public.scan_usage (org_id, model, input_tokens, output_tokens, cost_usd, outcome) values (%L, %L, 1, 1, 0, %L)', gen_random_uuid(), 'claude-opus-5-5', 'refused')));
  perform zz.eq('B-function', 'cost kept to 6 decimals', '0.092000', (select cost_usd::text from public.scan_usage where cost_usd = 0.092));
  perform zz.eq('B-function', 'scans are not in the change history', '0', (select count(*)::text from public.audit_log where table_name = 'scan_usage'));
end $$;

-- C. members cannot write: no INSERT/UPDATE/DELETE privilege at all, so the history can be neither forged nor hidden
do $$
declare
  org uuid := zz.id('org');
  u text;
begin
  foreach u in array array['owner', 'wife', 'staff'] loop
    perform zz.chk('C-members', u || ' cannot add a scan', '^err:42501', zz.att(zz.id(u), zz.bs_row(org, zz.id(u), 'now()', 0)));
    perform zz.chk('C-members', u || ' cannot change a cost', '^err:42501', zz.att(zz.id(u), 'update public.scan_usage set cost_usd = 0'));
    perform zz.chk('C-members', u || ' cannot delete a scan', '^err:42501', zz.att(zz.id(u), 'delete from public.scan_usage'));
    perform zz.chk('C-members', u || ' cannot truncate', '^err:42501', zz.att(zz.id(u), 'truncate public.scan_usage'));
  end loop;
  perform zz.chk('C-members', 'org2 owner cannot add a scan to org1', '^err:42501', zz.att(zz.id('o2owner'), zz.bs_row(org, zz.id('o2owner'), 'now()', 0)));
  perform zz.chk('C-anon', 'anon cannot read', '^err:42501', zz.val(null, 'select count(*) from public.scan_usage'));
  perform zz.chk('C-anon', 'anon cannot add', '^err:42501', zz.att(null, zz.bs_row(org, null, 'now()', 0)));
end $$;

-- D. who reads: owners/admins of the organisation only
do $$
declare org uuid := zz.id('org');
begin
  perform zz.eq('D-read', 'the owner reads the 4 scans', 'val:4', zz.val(zz.id('owner'), 'select count(*) from public.scan_usage'));
  perform zz.eq('D-read', 'an admin reads them', 'val:4', zz.val(zz.id('wife'), 'select count(*) from public.scan_usage'));
  perform zz.eq('D-read', 'staff read none (not even their own scans)', 'val:0', zz.val(zz.id('staff'), 'select count(*) from public.scan_usage'));
  perform zz.eq('D-read', 'org2 owner reads only org2''s scan', 'val:1', zz.val(zz.id('o2owner'), 'select count(*) from public.scan_usage'));
  perform zz.eq('D-read', '... none of org1''s', 'val:0', zz.val(zz.id('o2owner'), format('select count(*) from public.scan_usage where org_id = %L', org)));
  perform zz.eq('D-read', 'a stranger reads none', 'val:0', zz.val(zz.id('stranger'), 'select count(*) from public.scan_usage'));
  -- the app's estimate: monthly credit minus what this cycle's scans cost (here: everything in the last 30 days)
  perform zz.eq('D-estimate', 'the owner can compute the credit left', 'val:99.848000', zz.val(zz.id('owner'), format(
    'select o.claude_credit_monthly_usd - coalesce((select sum(s.cost_usd) from public.scan_usage s where s.org_id = o.id and s.created_at >= now() - interval ''30 days''), 0)
       from public.organizations o where o.id = %L', org)));
end $$;

-- E. the credit settings: owners/admins change them (org_update), staff and others cannot; every change is in the history
do $$
declare org uuid := zz.id('org');
begin
  perform zz.eq('E-settings', 'the owner sets US$50, renewing on the 15th', 'ok:1', zz.att(zz.id('owner'), format(
    'update public.organizations set claude_credit_monthly_usd = 50, claude_credit_renewal_day = 15 where id = %L', org), true));
  perform zz.eq('E-settings', '... stored', '50.00|15', (select claude_credit_monthly_usd || '|' || claude_credit_renewal_day from public.organizations where id = org));
  perform zz.eq('E-settings', 'an admin sets US$100, renewing on the 31st', 'ok:1', zz.att(zz.id('wife'), format(
    'update public.organizations set claude_credit_monthly_usd = 100, claude_credit_renewal_day = 31 where id = %L', org), true));
  perform zz.eq('E-settings', 'staff cannot change the credit (org_update: no row)', 'ok:0', zz.att(zz.id('staff'), format(
    'update public.organizations set claude_credit_monthly_usd = 1000 where id = %L', org)));
  perform zz.eq('E-settings', 'staff cannot change the renewal day', 'ok:0', zz.att(zz.id('staff'), format(
    'update public.organizations set claude_credit_renewal_day = 2 where id = %L', org)));
  perform zz.eq('E-settings', 'org2 owner cannot change ours', 'ok:0', zz.att(zz.id('o2owner'), format(
    'update public.organizations set claude_credit_monthly_usd = 0 where id = %L', org)));
  perform zz.eq('E-settings', 'a stranger cannot', 'ok:0', zz.att(zz.id('stranger'), format(
    'update public.organizations set claude_credit_monthly_usd = 0 where id = %L', org)));
  perform zz.chk('E-settings', 'anon cannot', '^err:42501', zz.att(null, format(
    'update public.organizations set claude_credit_monthly_usd = 0 where id = %L', org)));
  perform zz.eq('E-settings', 'still the admin''s values', '100.00|31', (select claude_credit_monthly_usd || '|' || claude_credit_renewal_day from public.organizations where id = org));
  perform zz.eq('E-settings', 'staff can read them (org_select: every member)', 'val:100.00|31', zz.val(zz.id('staff'), format(
    'select claude_credit_monthly_usd || ''|'' || claude_credit_renewal_day from public.organizations where id = %L', org)));
  perform zz.chk('E-checks', 'renewal day 0', '^err:23514', zz.att(zz.id('owner'), format('update public.organizations set claude_credit_renewal_day = 0 where id = %L', org)));
  perform zz.chk('E-checks', 'renewal day 32', '^err:23514', zz.att(zz.id('owner'), format('update public.organizations set claude_credit_renewal_day = 32 where id = %L', org)));
  perform zz.chk('E-checks', 'negative credit', '^err:23514', zz.att(zz.id('owner'), format('update public.organizations set claude_credit_monthly_usd = -1 where id = %L', org)));
  perform zz.chk('E-checks', 'no credit (null)', '^err:23502', zz.att(zz.id('owner'), format('update public.organizations set claude_credit_monthly_usd = null where id = %L', org)));
  perform zz.eq('E-checks', 'US$0 is allowed (prepaid credit only)', 'ok:1', zz.att(zz.id('owner'), format('update public.organizations set claude_credit_monthly_usd = 0 where id = %L', org), true));
  perform zz.eq('E-history', 'every kept change in the history, by whom', 'owner:50.00:15,wife:100.00:31,owner:0.00:31',
    (select string_agg(k.k || ':' || (a.new_data ->> 'claude_credit_monthly_usd') || ':' || (a.new_data ->> 'claude_credit_renewal_day'), ',' order by a.changed_at)
       from public.audit_log a join zz.ids k on k.v = a.changed_by
      where a.table_name = 'organizations' and a.row_id = org and a.action = 'update'));
  perform zz.eq('E-history', 'staff do not read it', 'val:0', zz.val(zz.id('staff'), 'select count(*) from public.audit_log where table_name = ''organizations'''));
end $$;

-- F. a member's account is deleted (operator): the cost stays, without the person
do $$
begin
  perform zz.eq('F-retention', 'the operator deletes the leaver''s account', 'val:1', zz.su(format(
    'with d as (delete from auth.users where id = %L returning 1) select count(*) from d', zz.id('leaver')), true));
  perform zz.eq('F-retention', 'the scan is kept, without the person', '1|0', (select count(*) || '|' || count(user_id) from public.scan_usage where cost_usd = 0.05));
end $$;

-- G. the weekly backup carries the scans of each organisation
do $$
declare
  b jsonb := public.export_backup();
  ours jsonb := (select f from jsonb_array_elements(b) f where f -> 'tables' -> 'organizations' -> 0 ->> 'id' = zz.id('org')::text);
  theirs jsonb := (select f from jsonb_array_elements(b) f where f -> 'tables' -> 'organizations' -> 0 ->> 'id' = zz.id('org2')::text);
begin
  perform zz.eq('G-backup', 'our 4 scans in our file', '4', jsonb_array_length(ours -> 'tables' -> 'scan_usage')::text);
  perform zz.eq('G-backup', 'org2''s scan in theirs', '1', jsonb_array_length(theirs -> 'tables' -> 'scan_usage')::text);
  perform zz.eq('G-backup', 'the credit settings in the organisation row', '0.00|31',
    (ours -> 'tables' -> 'organizations' -> 0 ->> 'claude_credit_monthly_usd') || '|' || (ours -> 'tables' -> 'organizations' -> 0 ->> 'claude_credit_renewal_day'));
end $$;

drop function zz.bs_svc(text, boolean), zz.bs_row(uuid, uuid, text, numeric, text);
