-- Scheduled backups: export_backup() returns every organisation in the app's backup format, and the
-- woombad_backup login role can run that function and nothing else.
\set ON_ERROR_STOP on
select set_config('zz.suite', '25-backup', false);
select zz.reset_data();

select zz.user('owner', '11111111-2525-0000-0000-000000000001', 'owner@backup.test');
select zz.user('stranger', '44444444-2525-0000-0000-000000000004', 'stranger@backup.test');
select zz.su('select public.set_setup_code(''BACKUP-25'')', true);
select zz.join(zz.id('owner'), 'backup25');
insert into zz.ids select 'org', id from public.organizations;
select zz.eq('seed', 'kos', 'ok:1', zz.att(zz.id('owner'),
  format('insert into public.properties (org_id, name) values (%L, %L)', zz.id('org'), 'Kos Cadangan'), true));
select zz.eq('seed', 'tenant', 'ok:1', zz.att(zz.id('owner'),
  format('insert into public.tenants (org_id, full_name, nik) values (%L, %L, %L)', zz.id('org'), 'Budi', '3201010101010001'), true));
select zz.eq('seed', 'invitation', '8', length(zz.invite('inv', zz.id('owner'), zz.id('org'), 'staff', 'Penjaga'))::text);

do $$
declare
  b jsonb := public.export_backup();
  f jsonb := b -> 0;
begin
  perform zz.eq('export', 'one file per organisation', '1', jsonb_array_length(b)::text);
  perform zz.eq('export', 'app backup format', 'exportedAt,orgName,tables,version',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(f) k));
  perform zz.eq('export', 'version 1', '1', f ->> 'version');
  perform zz.eq('export', 'organisation name', 'Kos Saya', f ->> 'orgName');
  perform zz.eq('export', 'all organisation tables',
    'addon_catalog,audit_log,expenses,invitations,invoices,lease_addons,leases,organization_members,organizations,payments,properties,rooms,tenants',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(f -> 'tables') k));
  perform zz.eq('export', 'kos row', 'Kos Cadangan', f -> 'tables' -> 'properties' -> 0 ->> 'name');
  perform zz.eq('export', 'tenant details kept', '3201010101010001', f -> 'tables' -> 'tenants' -> 0 ->> 'nik');
  perform zz.eq('export', 'members', '1', jsonb_array_length(f -> 'tables' -> 'organization_members')::text);
  perform zz.ok('export', 'history included', jsonb_array_length(f -> 'tables' -> 'audit_log') > 0);
  perform zz.ok('export', 'no code hashes anywhere', position(encode(sha256(convert_to('BACKUP25', 'UTF8')), 'hex') in b::text) = 0
    and not (f -> 'tables' ? 'invitation_codes') and not (f -> 'tables' ? 'app_settings') and not (f -> 'tables' ? 'join_attempts'));
  perform zz.ok('export', 'exportedAt is an ISO time', (f ->> 'exportedAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$');
end $$;

-- as the backup role: the export works, nothing else does (results are recorded after switching back)
do $$
declare
  n int;
  read_tenants text := 'allowed';
  read_settings text := 'allowed';
  write_kos text := 'allowed';
  call_rpc text := 'allowed';
begin
  execute 'set local role woombad_backup';
  n := jsonb_array_length(public.export_backup());
  begin perform 1 from public.tenants limit 1; exception when insufficient_privilege then read_tenants := 'denied'; end;
  begin perform 1 from public.app_settings limit 1; exception when insufficient_privilege then read_settings := 'denied'; end;
  begin insert into public.properties (org_id, name) values (gen_random_uuid(), 'x');
  exception when insufficient_privilege then write_kos := 'denied'; end;
  begin perform public.join_with_code('BACKUP-25'); exception when insufficient_privilege then call_rpc := 'denied'; end;
  execute 'reset role';
  perform zz.eq('backup role', 'export_backup works', '1', n::text);
  perform zz.eq('backup role', 'cannot read tenants directly', 'denied', read_tenants);
  perform zz.eq('backup role', 'cannot read app_settings', 'denied', read_settings);
  perform zz.eq('backup role', 'cannot write', 'denied', write_kos);
  perform zz.eq('backup role', 'cannot call app RPCs', 'denied', call_rpc);
end $$;

-- app users cannot run the export
select zz.ok('app roles', 'authenticated cannot run export_backup', zz.att(zz.id('stranger'), 'select public.export_backup()') like '%permission denied%');
select zz.ok('app roles', 'owner cannot run export_backup either', zz.att(zz.id('owner'), 'select public.export_backup()') like '%permission denied%');

-- keep-alive: anon's ping writes one heartbeat row, at most once a minute, and can read nothing
do $$
declare
  first_pings bigint;
  later_pings bigint;
  read_heartbeat text := 'allowed';
begin
  execute 'set local role anon';
  perform public.keepalive();
  begin perform 1 from public.keepalive_heartbeat; exception when insufficient_privilege then read_heartbeat := 'denied'; end;
  execute 'reset role';
  select pings into first_pings from public.keepalive_heartbeat where id = 1;
  update public.keepalive_heartbeat set pinged_at = now() - interval '2 minutes' where id = 1;
  execute 'set local role anon';
  perform public.keepalive();
  perform public.keepalive();
  perform public.keepalive();
  execute 'reset role';
  select pings into later_pings from public.keepalive_heartbeat where id = 1;
  perform zz.ok('keepalive', 'a ping writes the heartbeat row', first_pings >= 1);
  perform zz.eq('keepalive', 'repeated pings within a minute write once', (first_pings + 1)::text, later_pings::text);
  perform zz.eq('keepalive', 'anon cannot read the heartbeat', 'denied', read_heartbeat);
  perform zz.eq('keepalive', 'one heartbeat row only', '1', (select count(*) from public.keepalive_heartbeat)::text);
end $$;
