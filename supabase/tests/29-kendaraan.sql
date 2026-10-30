-- Nomor kendaraan (SPEC 7.11): leases.vehicle_plate, the plate(s) of the tenant's vehicle(s) for this stay. One nullable
-- text column without a default or a constraint; not a lease term, so every member may set or clear it (also when
-- creating the lease, as Check-in cepat does); row-level security as for any lease column; recorded in the history and
-- the weekly backup. Every write goes through the API role (zz.att = one API call).
\set ON_ERROR_STOP on
select set_config('zz.suite', '29-kendaraan', false);
select zz.reset_data();

select zz.user('owner', '11111111-2929-0000-0000-000000000001', 'owner@plat.test');
select zz.user('wife', '22222222-2929-0000-0000-000000000002', 'wife@plat.test');
select zz.user('staff', '33333333-2929-0000-0000-000000000003', 'staff@plat.test');
select zz.user('o2owner', '44444444-2929-0000-0000-000000000004', 'other@plat.test');
select zz.user('stranger', '55555555-2929-0000-0000-000000000005', 'stranger@plat.test');
select zz.su('select public.set_setup_code(''KENDARAAN-29'')', true);
select zz.join(zz.id('owner'), 'kendaraan29');
insert into zz.ids select 'org', id from public.organizations;
insert into zz.ids values
  ('prop', 'f9000000-0000-0000-0000-000000000001'),
  ('budi', 'f9000000-0000-0000-0000-000000000011'), ('sari', 'f9000000-0000-0000-0000-000000000012'),
  ('r1', 'f9000000-0000-0000-0000-000000000021'), ('r2', 'f9000000-0000-0000-0000-000000000022'),
  ('l1', 'f9000000-0000-0000-0000-000000000031'), ('l2', 'f9000000-0000-0000-0000-000000000032'),
  ('org2', 'f9000000-0000-0000-0000-000000000091'), ('prop9', 'f9000000-0000-0000-0000-000000000092');

create or replace function zz.kd_plate(p_lease text) returns text language sql as $$
  select coalesce((select vehicle_plate from public.leases where id = zz.id(p_lease)), 'NULL');
$$;

-- one update of a lease through the API, as the app sends it (useLeaseActions.setVehiclePlate)
create or replace function zz.kd_set(p_user text, p_lease text, p_plate text, p_keep boolean default true) returns text language sql as $$
  select zz.att(zz.id(p_user), format('update public.leases set vehicle_plate = %L where id = %L', p_plate, zz.id(p_lease)), p_keep);
$$;

do $$
declare
  o uuid := zz.id('owner');
  org uuid := zz.id('org');
  today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  perform zz.eq('setup', 'wife joins as admin', 'val:' || org, zz.join(zz.id('wife'), zz.invite('wife', o, org, 'admin', 'Istri')));
  perform zz.eq('setup', 'staff joins as staff', 'val:' || org, zz.join(zz.id('staff'), zz.invite('staff', o, org, 'staff', 'Penjaga')));
  perform zz.eq('seed', 'kos', 'ok:1', zz.att(o, format('insert into public.properties (id, org_id, name) values (%L, %L, %L)', zz.id('prop'), org, 'Kos Melati'), true));
  perform zz.eq('seed', 'rooms', 'ok:2', zz.att(o, format('insert into public.rooms (id, org_id, property_id, name, price_daily, price_monthly) values (%L, %L, %L, %L, 100000, 1500000), (%L, %L, %L, %L, 100000, 1500000)',
    zz.id('r1'), org, zz.id('prop'), 'C1', zz.id('r2'), org, zz.id('prop'), 'D06'), true));
  perform zz.eq('seed', 'tenants', 'ok:2', zz.att(o, format('insert into public.tenants (id, org_id, property_id, full_name) values (%L, %L, %L, %L), (%L, %L, %L, %L)',
    zz.id('budi'), org, zz.id('prop'), 'Budi', zz.id('sari'), org, zz.id('prop'), 'Sari'), true));
  -- Budi: monthly in C1, no plate yet (a lease written before the column, as the app still sends it without one)
  perform zz.eq('seed', 'Budi''s monthly lease, no plate', 'ok:1', zz.att(o, format(
    'insert into public.leases (id, org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date) values (%L, %L, %L, %L, %L, %L, 1500000, %L, %L)',
    zz.id('l1'), org, zz.id('prop'), zz.id('r1'), zz.id('budi'), 'monthly', today - 30, today + 29), true));
end $$;

-- another family on the same project (operator)
insert into public.organizations (id, name, created_by) values (zz.id('org2'), 'Org Dua', zz.id('o2owner'));
insert into public.organization_members (org_id, user_id, email, role) values (zz.id('org2'), zz.id('o2owner'), 'other@plat.test', 'owner');
insert into public.properties (id, org_id, name) values (zz.id('prop9'), zz.id('org2'), 'Kos Lain');

-- A. structure: one nullable text column, no default, no constraint; the guards do not look at it
do $$ begin
  perform zz.eq('A-structure', 'leases.vehicle_plate: text, nullable, no default', 'text|false|none',
    (select concat_ws('|', format_type(a.atttypid, a.atttypmod), a.attnotnull::text, coalesce(pg_get_expr(d.adbin, d.adrelid), 'none'))
       from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = 'public.leases'::regclass and a.attname = 'vehicle_plate' and not a.attisdropped));
  perform zz.eq('A-structure', 'no constraint mentions it', '0',
    (select count(*)::text from pg_constraint where conrelid = 'public.leases'::regclass and pg_get_constraintdef(oid) like '%vehicle_plate%'));
  perform zz.eq('A-structure', 'a lease written without it reads null', 'NULL', zz.kd_plate('l1'));
  perform zz.ok('A-structure', 'leases_terms_guard does not look at it', (select pg_get_functiondef(p.oid) !~ 'vehicle_plate'
    from pg_proc p where p.oid = 'public.leases_terms_guard()'::regprocedure));
  perform zz.ok('A-structure', 'leases_overlap_guard does not look at it', (select pg_get_functiondef(p.oid) !~ 'vehicle_plate'
    from pg_proc p where p.oid = 'public.leases_overlap_guard()'::regprocedure));
end $$;

-- B. who may set and clear it: every member of the organisation (front-desk work), nobody else
do $$
declare
  s uuid := zz.id('staff');
  today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  perform zz.eq('B-members', 'the owner fills in Budi''s plate', 'ok:1', zz.kd_set('owner', 'l1', 'KB 1442 GZ'));
  perform zz.eq('B-members', '... stored as sent', 'KB 1442 GZ', zz.kd_plate('l1'));
  perform zz.eq('B-members', 'staff adds his second vehicle (not a lease term: leases_terms_guard lets it through)', 'ok:1', zz.kd_set('staff', 'l1', 'KB 1442 GZ, B 1251 SGA'));
  perform zz.eq('B-members', '... stored', 'KB 1442 GZ, B 1251 SGA', zz.kd_plate('l1'));
  perform zz.eq('B-members', 'staff clears it', 'ok:1', zz.kd_set('staff', 'l1', null));
  perform zz.eq('B-members', '... cleared', 'NULL', zz.kd_plate('l1'));
  perform zz.eq('B-members', 'an admin fills it in again', 'ok:1', zz.kd_set('wife', 'l1', 'KB 1442 GZ'));
  perform zz.eq('B-members', 'staff still cannot change the price in the same write', 'err:P0001:Hanya pemilik/admin yang dapat mengubah harga atau jenis sewa.',
    zz.att(s, format('update public.leases set vehicle_plate = %L, price_per_period = 1 where id = %L', 'B 1 X', zz.id('l1'))));
  perform zz.eq('B-members', '... and the plate stays', 'KB 1442 GZ', zz.kd_plate('l1'));
  -- Check-in cepat by the staff: the plate comes with the new lease
  perform zz.eq('B-members', 'staff checks Sari in with her plate', 'ok:1', zz.att(s, format(
    'insert into public.leases (id, org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date, vehicle_plate) values (%L, %L, %L, %L, %L, %L, 100000, %L, %L, %L)',
    zz.id('l2'), zz.id('org'), zz.id('prop'), zz.id('r2'), zz.id('sari'), 'daily', today, today + 1, 'KB 1604 GR'), true));
  perform zz.eq('B-members', '... stored', 'KB 1604 GR', zz.kd_plate('l2'));
  -- other organisations and strangers: row-level security as for any column of the lease
  perform zz.eq('B-rls', 'the other organisation cannot change ours (RLS: no row)', 'ok:0', zz.kd_set('o2owner', 'l1', 'X 1 X', false));
  perform zz.eq('B-rls', '... nor clear it', 'ok:0', zz.kd_set('o2owner', 'l1', null, false));
  perform zz.eq('B-rls', '... nor read it', 'val:0', zz.val(zz.id('o2owner'), format('select count(*) from public.leases where vehicle_plate is not null and org_id = %L', zz.id('org'))));
  perform zz.eq('B-rls', 'a stranger cannot change it', 'ok:0', zz.kd_set('stranger', 'l1', 'X 1 X', false));
  perform zz.chk('B-rls', 'anon cannot', '^err:42501', zz.att(null, format('update public.leases set vehicle_plate = %L where id = %L', 'X 1 X', zz.id('l1'))));
  perform zz.eq('B-rls', 'still the admin''s plate', 'KB 1442 GZ', zz.kd_plate('l1'));
end $$;

-- C. history: every change of the plate, readable by owners/admins only
do $$ begin
  -- one transaction per block shares one changed_at, so the entries are compared as a sorted list
  perform zz.eq('C-audit', 'Budi''s plate: set, second vehicle, cleared, set again (kept writes only, by whom)', 'owner:KB 1442 GZ,staff:-,staff:KB 1442 GZ, B 1251 SGA,wife:KB 1442 GZ',
    (select string_agg(x, ',' order by x) from (
       select concat_ws(':', k.k, coalesce(a.new_data ->> 'vehicle_plate', '-')) as x
         from public.audit_log a join zz.ids k on k.v = a.changed_by
        where a.table_name = 'leases' and a.row_id = zz.id('l1') and a.action = 'update'
          and (a.old_data ->> 'vehicle_plate') is distinct from (a.new_data ->> 'vehicle_plate')) e));
  perform zz.chk('C-audit', 'an admin reads it', '^val:[1-9]', zz.val(zz.id('wife'), format('select count(*) from public.audit_log where row_id = %L', zz.id('l1'))));
  perform zz.eq('C-audit', 'staff do not', 'val:0', zz.val(zz.id('staff'), format('select count(*) from public.audit_log where row_id = %L', zz.id('l1'))));
end $$;

-- D. the weekly backup carries the plate (export_backup takes every column)
do $$
declare
  b jsonb := public.export_backup();
  ours jsonb := (select f from jsonb_array_elements(b) f where f -> 'tables' -> 'organizations' -> 0 ->> 'id' = zz.id('org')::text);
begin
  perform zz.eq('D-backup', 'Budi''s and Sari''s plates in our file', 'KB 1442 GZ|KB 1604 GR',
    (select string_agg(l ->> 'vehicle_plate', '|' order by l ->> 'start_date') from jsonb_array_elements(ours -> 'tables' -> 'leases') l
      where l ->> 'id' in (zz.id('l1')::text, zz.id('l2')::text)));
  perform zz.ok('D-backup', 'every lease carries the key', (select bool_and(l ? 'vehicle_plate')
    from jsonb_array_elements(ours -> 'tables' -> 'leases') l));
end $$;

drop function zz.kd_plate(text), zz.kd_set(text, text, text, boolean);
