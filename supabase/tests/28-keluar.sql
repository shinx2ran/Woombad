-- Rencana keluar (SPEC 7.8): leases.planned_checkout_date, the check-out day a tenant said he will leave. A nullable
-- column with one named check constraint (null or after start_date); not a lease term, so every member may set or clear
-- it; row-level security as for any lease column; recorded in the history and the weekly backup; a start-date correction
-- never moves it and is refused when the new start reaches it. Every write goes through the API role (zz.att = one API
-- call). Dates are relative to the kos's today (WIB), as the double-booking guard only checks future nights.
\set ON_ERROR_STOP on
select set_config('zz.suite', '28-keluar', false);
select zz.reset_data();

select zz.user('owner', '11111111-2828-0000-0000-000000000001', 'owner@keluar.test');
select zz.user('wife', '22222222-2828-0000-0000-000000000002', 'wife@keluar.test');
select zz.user('staff', '33333333-2828-0000-0000-000000000003', 'staff@keluar.test');
select zz.user('o2owner', '44444444-2828-0000-0000-000000000004', 'other@keluar.test');
select zz.user('stranger', '55555555-2828-0000-0000-000000000005', 'stranger@keluar.test');
select zz.su('select public.set_setup_code(''KELUAR-28'')', true);
select zz.join(zz.id('owner'), 'keluar28');
insert into zz.ids select 'org', id from public.organizations;
insert into zz.ids values
  ('prop', 'f8000000-0000-0000-0000-000000000001'),
  ('budi', 'f8000000-0000-0000-0000-000000000011'), ('sari', 'f8000000-0000-0000-0000-000000000012'),
  ('r1', 'f8000000-0000-0000-0000-000000000021'), ('r2', 'f8000000-0000-0000-0000-000000000022'),
  ('l1', 'f8000000-0000-0000-0000-000000000031'), ('l2', 'f8000000-0000-0000-0000-000000000032'),
  ('org2', 'f8000000-0000-0000-0000-000000000091'), ('prop9', 'f8000000-0000-0000-0000-000000000092');

-- today (the kos's day, WIB) + n
create or replace function zz.kl_d(n int) returns date language sql stable as $$ select (now() at time zone 'Asia/Jakarta')::date + n $$;

create or replace function zz.kl_planned(p_lease text) returns text language sql as $$
  select coalesce((select planned_checkout_date - zz.kl_d(0) from public.leases where id = zz.id(p_lease))::text, 'NULL');
$$;

-- one update of a lease through the API, as the app sends it (useLeaseActions.setPlannedCheckout)
create or replace function zz.kl_set(p_user text, p_lease text, p_day date, p_keep boolean default true) returns text language sql as $$
  select zz.att(zz.id(p_user), format('update public.leases set planned_checkout_date = %L where id = %L', p_day, zz.id(p_lease)), p_keep);
$$;

do $$
declare
  o uuid := zz.id('owner');
  org uuid := zz.id('org');
begin
  perform zz.eq('setup', 'wife joins as admin', 'val:' || org, zz.join(zz.id('wife'), zz.invite('wife', o, org, 'admin', 'Istri')));
  perform zz.eq('setup', 'staff joins as staff', 'val:' || org, zz.join(zz.id('staff'), zz.invite('staff', o, org, 'staff', 'Penjaga')));
  perform zz.eq('seed', 'kos', 'ok:1', zz.att(o, format('insert into public.properties (id, org_id, name) values (%L, %L, %L)', zz.id('prop'), org, 'Kos Melati'), true));
  perform zz.eq('seed', 'rooms', 'ok:2', zz.att(o, format('insert into public.rooms (id, org_id, property_id, name, price_daily, price_monthly) values (%L, %L, %L, %L, 100000, 1500000), (%L, %L, %L, %L, 100000, 1500000)',
    zz.id('r1'), org, zz.id('prop'), 'A1', zz.id('r2'), org, zz.id('prop'), 'A2'), true));
  perform zz.eq('seed', 'tenants', 'ok:2', zz.att(o, format('insert into public.tenants (id, org_id, property_id, full_name) values (%L, %L, %L, %L), (%L, %L, %L, %L)',
    zz.id('budi'), org, zz.id('prop'), 'Budi', zz.id('sari'), org, zz.id('prop'), 'Sari'), true));
  -- Budi: monthly in A1 since 60 days ago, billed through the night of +20 (check-out +21), no plan yet
  perform zz.eq('seed', 'Budi''s monthly lease, no plan', 'ok:1', zz.att(o, format(
    'insert into public.leases (id, org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date) values (%L, %L, %L, %L, %L, %L, 1500000, %L, %L)',
    zz.id('l1'), org, zz.id('prop'), zz.id('r1'), zz.id('budi'), 'monthly', zz.kl_d(-60), zz.kl_d(20)), true));
end $$;

-- another family on the same project (operator)
insert into public.organizations (id, name, created_by) values (zz.id('org2'), 'Org Dua', zz.id('o2owner'));
insert into public.organization_members (org_id, user_id, email, role) values (zz.id('org2'), zz.id('o2owner'), 'other@keluar.test', 'owner');
insert into public.properties (id, org_id, name) values (zz.id('prop9'), zz.id('org2'), 'Kos Lain');

-- A. structure: one nullable date column and one named check constraint, nothing else on leases changes
do $$ begin
  perform zz.eq('A-structure', 'leases.planned_checkout_date: date, nullable, no default', 'date|false|none',
    (select concat_ws('|', format_type(a.atttypid, a.atttypmod), a.attnotnull::text, coalesce(pg_get_expr(d.adbin, d.adrelid), 'none'))
       from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = 'public.leases'::regclass and a.attname = 'planned_checkout_date' and not a.attisdropped));
  perform zz.eq('A-structure', 'leases_planned_checkout_check: null or after start_date',
    'CHECK (((planned_checkout_date IS NULL) OR (planned_checkout_date > start_date)))',
    (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.leases'::regclass and conname = 'leases_planned_checkout_check'));
  perform zz.eq('A-structure', 'exactly one such constraint (schema.sql re-run adds no copy)', '1',
    (select count(*)::text from pg_constraint where conrelid = 'public.leases'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%planned_checkout_date%'));
  perform zz.ok('A-structure', 'leases_terms_guard does not look at it', (select pg_get_functiondef(p.oid) !~ 'planned_checkout'
    from pg_proc p where p.oid = 'public.leases_terms_guard()'::regprocedure));
  perform zz.ok('A-structure', 'leases_overlap_guard does not look at it', (select pg_get_functiondef(p.oid) !~ 'planned_checkout'
    from pg_proc p where p.oid = 'public.leases_overlap_guard()'::regprocedure));
end $$;

-- B. who may set and clear it: every member of the organisation (front-desk work), nobody else
do $$
declare
  s uuid := zz.id('staff');
begin
  perform zz.eq('B-members', 'the owner records Budi''s check-out day +21', 'ok:1', zz.kl_set('owner', 'l1', zz.kl_d(21)));
  perform zz.eq('B-members', '... stored', '21', zz.kl_planned('l1'));
  perform zz.eq('B-members', 'staff moves it to +25 (not a lease term: leases_terms_guard lets it through)', 'ok:1', zz.kl_set('staff', 'l1', zz.kl_d(25)));
  perform zz.eq('B-members', '... stored', '25', zz.kl_planned('l1'));
  perform zz.eq('B-members', 'staff clears it (Batalkan rencana keluar)', 'ok:1', zz.kl_set('staff', 'l1', null));
  perform zz.eq('B-members', '... cleared', 'NULL', zz.kl_planned('l1'));
  perform zz.eq('B-members', 'an admin records it again (+21)', 'ok:1', zz.kl_set('wife', 'l1', zz.kl_d(21)));
  perform zz.eq('B-members', 'staff still cannot change the price in the same write', 'err:P0001:Hanya pemilik/admin yang dapat mengubah harga atau jenis sewa.',
    zz.att(s, format('update public.leases set planned_checkout_date = %L, price_per_period = 1 where id = %L', zz.kl_d(30), zz.id('l1'))));
  -- the check constraint
  perform zz.chk('B-check', 'a day on the start date is refused (23514, named constraint)', '^err:23514:.*leases_planned_checkout_check',
    zz.kl_set('staff', 'l1', zz.kl_d(-60), false));
  perform zz.chk('B-check', '... and one before it', '^err:23514:.*leases_planned_checkout_check', zz.kl_set('owner', 'l1', zz.kl_d(-61), false));
  perform zz.eq('B-check', 'the day after the start is fine (one night)', 'ok:1', zz.kl_set('owner', 'l1', zz.kl_d(-59), false));
  perform zz.chk('B-check', 'a new lease with a plan on its start day is refused', '^err:23514:.*leases_planned_checkout_check', zz.att(s, format(
    'insert into public.leases (org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date, planned_checkout_date) values (%L, %L, %L, %L, %L, 1, %L, %L, %L)',
    zz.id('org'), zz.id('prop'), zz.id('r2'), zz.id('sari'), 'monthly', zz.kl_d(40), zz.kl_d(69), zz.kl_d(40))));
  perform zz.eq('B-check', '... with a plan after it is fine', 'ok:1', zz.att(s, format(
    'insert into public.leases (org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date, planned_checkout_date) values (%L, %L, %L, %L, %L, 1, %L, %L, %L)',
    zz.id('org'), zz.id('prop'), zz.id('r2'), zz.id('sari'), 'monthly', zz.kl_d(40), zz.kl_d(69), zz.kl_d(70))));
  -- other organisations and strangers: row-level security as for any column of the lease
  perform zz.eq('B-rls', 'the other organisation cannot change ours (RLS: no row)', 'ok:0', zz.kl_set('o2owner', 'l1', zz.kl_d(30), false));
  perform zz.eq('B-rls', '... nor clear it', 'ok:0', zz.kl_set('o2owner', 'l1', null, false));
  perform zz.eq('B-rls', '... nor read it', 'val:0', zz.val(zz.id('o2owner'), format('select count(*) from public.leases where planned_checkout_date is not null and org_id = %L', zz.id('org'))));
  perform zz.eq('B-rls', 'a stranger cannot change it', 'ok:0', zz.kl_set('stranger', 'l1', zz.kl_d(30), false));
  perform zz.chk('B-rls', 'anon cannot', '^err:42501', zz.att(null, format('update public.leases set planned_checkout_date = %L where id = %L', zz.kl_d(30), zz.id('l1'))));
  perform zz.eq('B-rls', 'still the admin''s +21', '21', zz.kl_planned('l1'));
end $$;

-- C. the double-booking guard is unchanged: a booking after Budi's billed nights (+21, his check-out day) is allowed,
-- one inside them is not, whatever his plan says (the app requires the plan first, SPEC 7.8)
do $$
declare
  s uuid := zz.id('staff');
  ins constant text := 'insert into public.leases (org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date) values (%L, %L, %L, %L, %L, 100000, %L, %L)';
begin
  perform zz.eq('C-guard', 'a guest booked in A1 from Budi''s check-out day', 'ok:1', zz.att(s, format(ins, zz.id('org'), zz.id('prop'), zz.id('r1'), zz.id('sari'), 'daily', zz.kl_d(21), zz.kl_d(22))));
  perform zz.eq('C-guard', 'a guest on his last billed night is refused', 'err:WB003:Kamar sudah terisi atau dipesan pada tanggal itu.',
    zz.att(s, format(ins, zz.id('org'), zz.id('prop'), zz.id('r1'), zz.id('sari'), 'daily', zz.kl_d(20), zz.kl_d(20))));
  -- an earlier plan (+10) does not free his billed nights either: the guard still holds the room through end_date
  perform zz.eq('C-guard', 'the owner moves the plan before his billed end (+10)', 'ok:1', zz.kl_set('owner', 'l1', zz.kl_d(10)));
  perform zz.eq('C-guard', 'a guest on +12 is still refused', 'err:WB003:Kamar sudah terisi atau dipesan pada tanggal itu.',
    zz.att(s, format(ins, zz.id('org'), zz.id('prop'), zz.id('r1'), zz.id('sari'), 'daily', zz.kl_d(12), zz.kl_d(12))));
  perform zz.eq('C-guard', 'back to his check-out day (+21)', 'ok:1', zz.kl_set('owner', 'l1', zz.kl_d(21)));
  perform zz.eq('C-guard', 'still +21', '21', zz.kl_planned('l1'));
end $$;

-- D. a start-date correction (redate_lease) never moves the plan, and is refused when the new start reaches it
do $$
declare
  o uuid := zz.id('owner');
begin
  perform zz.eq('D-redate', 'Sari: monthly in A2 from -30, billed to +29, plan +10 (no invoices)', 'ok:1', zz.att(o, format(
    'insert into public.leases (id, org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date, planned_checkout_date) values (%L, %L, %L, %L, %L, %L, 1500000, %L, %L, %L)',
    zz.id('l2'), zz.id('org'), zz.id('prop'), zz.id('r2'), zz.id('sari'), 'monthly', zz.kl_d(-30), zz.kl_d(29), zz.kl_d(10)), true));
  perform zz.chk('D-redate', 'a new start on the planned day is refused (the constraint, all rolled back)', '^err:23514:.*leases_planned_checkout_check',
    zz.val(o, format('select public.redate_lease(%L, %L, %L, %L, %L::jsonb, %L)', zz.id('l2'), zz.kl_d(-30), zz.kl_d(10), zz.kl_d(69), '[]', 'koreksi')));
  perform zz.chk('D-redate', '... and one after it', '^err:23514:.*leases_planned_checkout_check',
    zz.val(o, format('select public.redate_lease(%L, %L, %L, %L, %L::jsonb, null)', zz.id('l2'), zz.kl_d(-30), zz.kl_d(15), zz.kl_d(74), '[]')));
  perform zz.eq('D-redate', 'nothing written: start, end, plan, notes as they were', '-30|29|10|',
    (select concat_ws('|', start_date - zz.kl_d(0), end_date - zz.kl_d(0), planned_checkout_date - zz.kl_d(0), coalesce(notes, '')) from public.leases where id = zz.id('l2')));
  perform zz.chk('D-redate', 'five days earlier works', '^val:', zz.val(o, format('select public.redate_lease(%L, %L, %L, %L, %L::jsonb, null)', zz.id('l2'), zz.kl_d(-30), zz.kl_d(-35), zz.kl_d(24), '[]'), true));
  perform zz.eq('D-redate', '... and the plan stays where it was', '-35|24|10',
    (select concat_ws('|', start_date - zz.kl_d(0), end_date - zz.kl_d(0), planned_checkout_date - zz.kl_d(0)) from public.leases where id = zz.id('l2')));
end $$;

-- E. history: every change of the plan, readable by owners/admins only
do $$ begin
  -- one transaction per block shares one changed_at, so the entries are compared as a sorted list
  perform zz.eq('E-audit', 'Budi''s plan: set, moved, cleared, set, moved early, back (kept writes only, by whom)', 'owner:10,owner:21,owner:21,staff:-,staff:25,wife:21',
    (select string_agg(x, ',' order by x) from (
       select concat_ws(':', k.k, coalesce(((a.new_data ->> 'planned_checkout_date')::date - zz.kl_d(0))::text, '-')) as x
         from public.audit_log a join zz.ids k on k.v = a.changed_by
        where a.table_name = 'leases' and a.row_id = zz.id('l1') and a.action = 'update'
          and (a.old_data ->> 'planned_checkout_date') is distinct from (a.new_data ->> 'planned_checkout_date')) e));
  perform zz.chk('E-audit', 'an admin reads it', '^val:[1-9]', zz.val(zz.id('wife'), format('select count(*) from public.audit_log where row_id = %L', zz.id('l1'))));
  perform zz.eq('E-audit', 'staff do not', 'val:0', zz.val(zz.id('staff'), format('select count(*) from public.audit_log where row_id = %L', zz.id('l1'))));
end $$;

-- F. the weekly backup carries the plan (export_backup takes every column)
do $$
declare
  b jsonb := public.export_backup();
  ours jsonb := (select f from jsonb_array_elements(b) f where f -> 'tables' -> 'organizations' -> 0 ->> 'id' = zz.id('org')::text);
begin
  perform zz.eq('F-backup', 'Budi''s and Sari''s plans in our file', zz.kl_d(21)::text || ',' || zz.kl_d(10)::text,
    (select string_agg(l ->> 'planned_checkout_date', ',' order by l ->> 'start_date') from jsonb_array_elements(ours -> 'tables' -> 'leases') l
      where l ->> 'id' in (zz.id('l1')::text, zz.id('l2')::text)));
  perform zz.ok('F-backup', 'leases without a plan carry the key as null', (select bool_and(l ? 'planned_checkout_date')
    from jsonb_array_elements(ours -> 'tables' -> 'leases') l));
end $$;

drop function zz.kl_d(int), zz.kl_planned(text), zz.kl_set(text, text, date, boolean);
