-- Runs schema.sql again over the data left by 20/21-attacks (the operator re-running the file in the
-- SQL editor): nothing may be lost or changed, and everything must keep working.
\set ON_ERROR_STOP on
select set_config('zz.suite', '30-reapply', false);
drop table if exists zz.snap_counts, zz.snap_audit, zz.snap_settings;
create table zz.snap_counts (t text primary key, n bigint);
do $$
declare
  r record;
  n bigint;
begin
  for r in select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' loop
    execute format('select count(*) from public.%I', r.relname) into n;
    insert into zz.snap_counts values (r.relname, n);
  end loop;
end $$;
create table zz.snap_audit as select * from public.audit_log;
create table zz.snap_settings as select * from public.app_settings;

\ir ../schema.sql

do $$
declare
  r record;
  cnt bigint;
begin
  perform zz.ok('reapply', 'there was data to keep', (select count(*) = 0 from zz.snap_counts s where s.n = 0 and s.t <> 'join_attempts'));
  for r in select * from zz.snap_counts order by t loop
    execute format('select count(*) from public.%I', r.t) into cnt;
    perform zz.eq('reapply', 'rows kept in ' || r.t, r.n::text, cnt::text);
  end loop;
  perform zz.ok('reapply', 'history unchanged', not exists (select * from zz.snap_audit except select * from public.audit_log)
                                           and not exists (select * from public.audit_log except select * from zz.snap_audit));
  perform zz.ok('reapply', 'setup code state unchanged', not exists (select * from zz.snap_settings except select * from public.app_settings));
  -- still works: a new member joins, staff limits still apply
  perform zz.eq('reapply', 'owner still resolves the organisation', 'val:' || zz.id('org1'), zz.val(zz.id('owner'), 'select public.ensure_membership()'));
  perform zz.eq('reapply', 'a new code works', 'val:' || zz.id('org1'), zz.join(zz.user('after', 'abababab-0000-0000-0000-000000000001', 'after@example.com'),
    zz.invite('after-reapply', zz.id('owner'), zz.id('org1'), 'staff', 'Setelah ulang')));
  perform zz.chk('reapply', 'staff still cannot add a property', '^err:42501', zz.att(zz.id('after'),
    format('insert into public.properties (org_id, name) values (%L, %L)', zz.id('org1'), 'X')));
  perform zz.chk('reapply', 'staff still cannot change a room price', 'harga kamar', zz.att(zz.id('after'), 'update public.rooms set price_monthly = 1'));
  perform zz.chk('reapply', 'owner still cannot delete history', '^err:42501', zz.att(zz.id('owner'), 'delete from public.audit_log'));
end $$;
select zz.check_structure('reapply-structure');
drop table zz.snap_counts, zz.snap_audit, zz.snap_settings;
