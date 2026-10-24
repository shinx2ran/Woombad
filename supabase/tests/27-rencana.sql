-- Rencana check-in & daftar tunggu (SPEC 7.7): the double-booking guard on leases (public.leases_overlap_guard) and the
-- waitlist table. Every write goes through the API role (zz.att = one API call). Dates are relative to the server's
-- today, because the guard only checks future nights.
\set ON_ERROR_STOP on
select set_config('zz.suite', '27-rencana', false);
select zz.reset_data();

select zz.user('owner', '11111111-2727-0000-0000-000000000001', 'owner@rencana.test');
select zz.user('wife', '22222222-2727-0000-0000-000000000002', 'wife@rencana.test');
select zz.user('staff', '33333333-2727-0000-0000-000000000003', 'staff@rencana.test');
select zz.user('o2owner', '44444444-2727-0000-0000-000000000004', 'other@rencana.test');
select zz.user('stranger', '55555555-2727-0000-0000-000000000005', 'stranger@rencana.test');
select zz.su('select public.set_setup_code(''RENCANA-27'')', true);
select zz.join(zz.id('owner'), 'rencana27');
insert into zz.ids select 'org', id from public.organizations;
insert into zz.ids values
  ('prop', 'f7000000-0000-0000-0000-000000000001'), ('prop_empty', 'f7000000-0000-0000-0000-000000000002'),
  ('budi', 'f7000000-0000-0000-0000-000000000011'), ('sari', 'f7000000-0000-0000-0000-000000000012'),
  ('r1', 'f7000000-0000-0000-0000-000000000021'), ('r2', 'f7000000-0000-0000-0000-000000000022'),
  ('r3', 'f7000000-0000-0000-0000-000000000023'), ('r4', 'f7000000-0000-0000-0000-000000000024'),
  ('r5', 'f7000000-0000-0000-0000-000000000025'), ('r6', 'f7000000-0000-0000-0000-000000000026'),
  ('b1', 'f7000000-0000-0000-0000-000000000031'), ('b2', 'f7000000-0000-0000-0000-000000000032'),
  ('old2', 'f7000000-0000-0000-0000-000000000033'), ('ended3', 'f7000000-0000-0000-0000-000000000034'),
  ('weekly4', 'f7000000-0000-0000-0000-000000000035'), ('next4', 'f7000000-0000-0000-0000-000000000036'),
  ('w_staff', 'f7000000-0000-0000-0000-000000000041'), ('w_owner', 'f7000000-0000-0000-0000-000000000042'),
  ('w_kos', 'f7000000-0000-0000-0000-000000000043'),
  ('org2', 'f7000000-0000-0000-0000-000000000091'), ('prop9', 'f7000000-0000-0000-0000-000000000092'),
  ('w9', 'f7000000-0000-0000-0000-000000000093');

-- today + n
create or replace function zz.rc_d(n int) returns date language sql stable as $$ select current_date + n $$;

-- one lease insert through the API, as the app sends it (Check-in cepat / Rencana / wizard); p_key null = a new id
create or replace function zz.rc_lease(p_user text, p_key text, p_room text, p_tenant text, p_type text, p_start date, p_end date,
  p_status text default 'active', p_checkout date default null, p_keep boolean default true)
returns text language sql as $$
  select zz.att(zz.id(p_user), format(
    'insert into public.leases (id, org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date, status, checkout_date) values (%L, %L, %L, %L, %L, %L, 100000, %L, %L, %L, %L)',
    case when p_key is null then gen_random_uuid() else zz.id(p_key) end, zz.id('org'), zz.id('prop'), zz.id(p_room), zz.id(p_tenant), p_type,
    p_start, p_end, p_status, p_checkout), p_keep);
$$;

create or replace function zz.rc_leases(p_room text) returns text language sql as $$
  select coalesce(string_agg(concat_ws('..', start_date - current_date, end_date - current_date, status), ' ' order by start_date, end_date), '')
    from public.leases where room_id = zz.id(p_room);
$$;

do $$
declare
  o uuid := zz.id('owner');
  org uuid := zz.id('org');
begin
  perform zz.eq('setup', 'wife joins as admin', 'val:' || org, zz.join(zz.id('wife'), zz.invite('wife', o, org, 'admin', 'Istri')));
  perform zz.eq('setup', 'staff joins as staff', 'val:' || org, zz.join(zz.id('staff'), zz.invite('staff', o, org, 'staff', 'Penjaga')));
  perform zz.eq('seed', 'kos', 'ok:2', zz.att(o, format('insert into public.properties (id, org_id, name) values (%L, %L, %L), (%L, %L, %L)',
    zz.id('prop'), org, 'Kos Melati', zz.id('prop_empty'), org, 'Kos Kosong'), true));
  perform zz.eq('seed', 'rooms', 'ok:6', zz.att(o, format('insert into public.rooms (id, org_id, property_id, name, price_daily) values %s',
    (select string_agg(format('(%L, %L, %L, %L, 100000)', zz.id(r), org, zz.id('prop'), upper(r)), ', ') from unnest(array['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) r)), true));
  perform zz.eq('seed', 'tenants', 'ok:2', zz.att(o, format('insert into public.tenants (id, org_id, property_id, full_name) values (%L, %L, %L, %L), (%L, %L, %L, %L)',
    zz.id('budi'), org, zz.id('prop'), 'Budi', zz.id('sari'), org, zz.id('prop'), 'Sari'), true));
end $$;

-- another family on the same project (operator)
insert into public.organizations (id, name, created_by) values (zz.id('org2'), 'Org Dua', zz.id('o2owner'));
insert into public.organization_members (org_id, user_id, email, role) values (zz.id('org2'), zz.id('o2owner'), 'other@rencana.test', 'owner');
insert into public.properties (id, org_id, name) values (zz.id('prop9'), zz.id('org2'), 'Kos Lain');
insert into public.waitlist (id, org_id, property_id, name) values (zz.id('w9'), zz.id('org2'), zz.id('prop9'), 'Tamu org dua');

-- A. structure
do $$ begin
  perform zz.eq('A-structure', 'leases_overlap_guard: BEFORE INSERT OR UPDATE, for each row', 'leases_overlap_guard',
    (select string_agg(tgname, ',') from pg_trigger where tgrelid = 'public.leases'::regclass and tgname = 'leases_overlap_guard'
       and tgtype & 2 = 2 and tgtype & 4 = 4 and tgtype & 16 = 16 and tgtype & 1 = 1));
  perform zz.ok('A-structure', 'guard: security definer with a pinned search_path, not callable through the API', (
    select p.prosecdef and 'search_path=public, pg_temp' = any (p.proconfig) and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      from pg_proc p where p.oid = 'public.leases_overlap_guard()'::regprocedure));
  perform zz.ok('A-structure', 'waitlist: RLS enabled', (select relrowsecurity from pg_class where oid = 'public.waitlist'::regclass));
  perform zz.eq('A-structure', 'waitlist policies: members read/add/change, admins delete',
    'DELETE:is_org_admin,INSERT:is_org_member,SELECT:is_org_member,UPDATE:is_org_member',
    (select string_agg(cmd || ':' || substring(coalesce(qual, with_check) from 'is_org_(?:member|admin)'), ',' order by cmd)
       from pg_policies where schemaname = 'public' and tablename = 'waitlist'));
  perform zz.ok('A-structure', 'waitlist: authenticated may select/insert/update/delete, nothing more',
    has_table_privilege('authenticated', 'public.waitlist', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated', 'public.waitlist', 'TRUNCATE,REFERENCES,TRIGGER'));
  perform zz.ok('A-structure', 'waitlist: anon has nothing', not has_table_privilege('anon', 'public.waitlist', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'));
  perform zz.eq('A-structure', 'waitlist triggers', 'audit_row_change,keep_org_id,set_created_by,set_updated_at',
    (select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'public.waitlist'::regclass and not tgisinternal));
  perform zz.eq('A-structure', 'waitlist foreign keys: kos and lease set null, organisation cascades',
    'leases:SET NULL (lease_id),organizations:CASCADE,properties:SET NULL (property_id)',
    (select string_agg(f.relname || ':' || substring(pg_get_constraintdef(c.oid) from 'ON DELETE (.*)$'), ',' order by f.relname)
       from pg_constraint c join pg_class f on f.oid = c.confrelid where c.conrelid = 'public.waitlist'::regclass and c.contype = 'f'));
end $$;

-- B. new bookings (INSERT): only a NEW double booking of a future night is refused
do $$ begin
  perform zz.eq('B-insert', 'Budi books r1 for nights +5, +6', 'ok:1', zz.rc_lease('owner', 'b1', 'r1', 'budi', 'daily', zz.rc_d(5), zz.rc_d(6)));
  perform zz.eq('B-insert', 'a second booking of night +6 is refused with the app''s message (WB003)',
    'err:WB003:Kamar sudah terisi atau dipesan pada tanggal itu.', zz.rc_lease('owner', null, 'r1', 'sari', 'daily', zz.rc_d(6), zz.rc_d(8)));
  perform zz.eq('B-insert', '... by staff too', 'err:WB003:Kamar sudah terisi atau dipesan pada tanggal itu.',
    zz.rc_lease('staff', null, 'r1', 'sari', 'weekly', zz.rc_d(0), zz.rc_d(6)));
  perform zz.eq('B-insert', '... and a monthly lease from today', 'err:WB003:Kamar sudah terisi atau dipesan pada tanggal itu.',
    zz.rc_lease('wife', null, 'r1', 'sari', 'monthly', zz.rc_d(0), zz.rc_d(29)));
  perform zz.eq('B-insert', 'check-out day reuse: a stay from +7 (Budi''s check-out day) is fine', 'ok:1',
    zz.rc_lease('staff', 'b2', 'r1', 'sari', 'daily', zz.rc_d(7), zz.rc_d(8)));
  perform zz.eq('B-insert', 'and one ending the night before +5', 'ok:1', zz.rc_lease('staff', null, 'r1', 'sari', 'daily', zz.rc_d(1), zz.rc_d(4), 'active', null, false));
  perform zz.eq('B-insert', 'a cancelled booking over the same nights is history, not checked', 'ok:1',
    zz.rc_lease('owner', null, 'r1', 'sari', 'daily', zz.rc_d(5), zz.rc_d(6), 'cancelled', null, false));
  perform zz.eq('B-insert', 'an ended lease over the same nights is history (demo import), not checked', 'ok:1',
    zz.rc_lease('owner', null, 'r1', 'sari', 'daily', zz.rc_d(5), zz.rc_d(6), 'ended', zz.rc_d(7), false));
  perform zz.eq('B-insert', 'two overlapping bookings in one statement: the second sees the first', 'err:WB003:Kamar sudah terisi atau dipesan pada tanggal itu.',
    zz.att(zz.id('owner'), format('insert into public.leases (org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date) values (%L, %L, %L, %L, %L, 1, %L, %L), (%L, %L, %L, %L, %L, 1, %L, %L)',
      zz.id('org'), zz.id('prop'), zz.id('r6'), zz.id('budi'), 'daily', zz.rc_d(20), zz.rc_d(21),
      zz.id('org'), zz.id('prop'), zz.id('r6'), zz.id('sari'), 'daily', zz.rc_d(21), zz.rc_d(22))));
  perform zz.eq('B-insert', 'r1 holds exactly the two bookings', '5..6..active 7..8..active', zz.rc_leases('r1'));
  -- the past is never checked: r2 had a tenant until 10 days ago; an active lease overlapping only those past nights is fine
  perform zz.eq('B-insert', 'r2: an old monthly lease that ended 10 days ago (still active, never checked out)', 'ok:1',
    zz.rc_lease('owner', 'old2', 'r2', 'budi', 'monthly', zz.rc_d(-40), zz.rc_d(-10)));
  perform zz.eq('B-insert', 'r2: a lease from 20 days ago to +3 overlaps it only in the past', 'ok:1',
    zz.rc_lease('owner', null, 'r2', 'sari', 'daily', zz.rc_d(-20), zz.rc_d(3), 'active', null, false));
  -- an ended lease holds its room until the night before its checkout date
  perform zz.eq('B-insert', 'r3: a tenant leaving on +4 (checkout recorded ahead)', 'ok:1',
    zz.rc_lease('owner', 'ended3', 'r3', 'budi', 'monthly', zz.rc_d(-30), zz.rc_d(10), 'ended', zz.rc_d(4)));
  perform zz.eq('B-insert', 'r3: a stay from +3 is refused', 'err:WB003:Kamar sudah terisi atau dipesan pada tanggal itu.',
    zz.rc_lease('staff', null, 'r3', 'sari', 'daily', zz.rc_d(3), zz.rc_d(5)));
  perform zz.eq('B-insert', 'r3: a stay from +4 (the checkout day) is fine', 'ok:1', zz.rc_lease('staff', null, 'r3', 'sari', 'daily', zz.rc_d(4), zz.rc_d(5), 'active', null, false));
end $$;

-- C. changes to a lease: only an extension (Perpanjang / Tagih) is checked
do $$
declare
  s uuid := zz.id('staff');
  o uuid := zz.id('owner');
begin
  perform zz.eq('C-update', 'r4: Sari (weekly) staying from -3 to +3', 'ok:1', zz.rc_lease('owner', 'weekly4', 'r4', 'sari', 'weekly', zz.rc_d(-3), zz.rc_d(3)));
  perform zz.eq('C-update', 'r4: Budi booked from +5 to +6', 'ok:1', zz.rc_lease('owner', 'next4', 'r4', 'budi', 'daily', zz.rc_d(5), zz.rc_d(6)));
  perform zz.eq('C-update', 'staff extends Sari up to the night before Budi', 'ok:1',
    zz.att(s, format('update public.leases set end_date = %L where id = %L', zz.rc_d(4), zz.id('weekly4'))));
  perform zz.eq('C-update', 'staff extending Sari into Budi''s nights is refused', 'err:WB003:Kamar sudah terisi atau dipesan pada tanggal itu.',
    zz.att(s, format('update public.leases set end_date = %L where id = %L', zz.rc_d(10), zz.id('weekly4'))));
  perform zz.eq('C-update', '... and so is the owner', 'err:WB003:Kamar sudah terisi atau dipesan pada tanggal itu.',
    zz.att(o, format('update public.leases set end_date = %L, notes = %L where id = %L', zz.rc_d(10), 'Perpanjang', zz.id('weekly4'))));
  perform zz.eq('C-update', 'a shorter end is not checked', 'ok:1', zz.att(s, format('update public.leases set end_date = %L where id = %L', zz.rc_d(1), zz.id('weekly4'))));
  perform zz.eq('C-update', 'notes are not checked', 'ok:1', zz.att(s, format('update public.leases set notes = %L where id = %L', 'Tamu baik', zz.id('weekly4'))));
  -- room moves are the app's check (SPEC 2b.9): moving Sari into r1 next to Budi's booking is not refused here
  perform zz.eq('C-update', 'a room move is not checked by the guard', 'ok:1',
    zz.att(s, format('update public.leases set room_id = %L where id = %L', zz.id('r1'), zz.id('weekly4'))));
  -- start-date corrections check themselves (redate_lease): a correction into Budi's nights gets redate's message
  perform zz.eq('C-update', 'redate into the next booking: redate_lease''s own refusal', 'err:P0001:Jadwal bentrok dengan sewa lain di kamar yang sama.',
    zz.val(o, format('select public.redate_lease(%L, %L, %L, %L, %L::jsonb, null)', zz.id('weekly4'), zz.rc_d(-3), zz.rc_d(0), zz.rc_d(6), '[]')));
  perform zz.chk('C-update', 'redate one day earlier works (the guard does not interfere)', '^val:',
    zz.val(o, format('select public.redate_lease(%L, %L, %L, %L, %L::jsonb, null)', zz.id('weekly4'), zz.rc_d(-3), zz.rc_d(-4), zz.rc_d(0), '[]')));
  perform zz.eq('C-update', 'checkout is not checked', 'ok:1',
    zz.att(s, format('update public.leases set status = %L, checkout_date = %L, end_date = %L where id = %L', 'ended', zz.rc_d(1), zz.rc_d(0), zz.id('weekly4'))));
  perform zz.eq('C-update', 'cancel (no-show) is not checked', 'ok:1',
    zz.att(o, format('update public.leases set status = %L, end_date = start_date where id = %L', 'cancelled', zz.id('next4'))));
  perform zz.eq('C-update', 'r4 as stored', '-3..3..active 5..6..active', zz.rc_leases('r4'));
end $$;

-- D. two phones book the same room at the same moment: the second waits for the first, then is refused
select zz.dbl_open('p1', zz.id('owner'));
select set_config('zz.pid', zz.dbl_open('p2', zz.id('wife'))::text, false);
select zz.dblink_exec('p1', 'begin');
select zz.eq('D-race', 'first phone books r5 for +10..+12 (not committed yet)', '1', (select r from zz.dblink('p1', format(
  'with x as (insert into public.leases (org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date) values (%L, %L, %L, %L, %L, 100000, %L, %L) returning 1) select count(*)::text from x',
  zz.id('org'), zz.id('prop'), zz.id('r5'), zz.id('budi'), 'daily', zz.rc_d(10), zz.rc_d(12))) as t(r text)));
select zz.dblink_send_query('p2', format(
  'with x as (insert into public.leases (org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date) values (%L, %L, %L, %L, %L, 100000, %L, %L) returning 1) select count(*)::text from x',
  zz.id('org'), zz.id('prop'), zz.id('r5'), zz.id('sari'), 'daily', zz.rc_d(11), zz.rc_d(13)));
select zz.eq('D-race', 'second phone waits on the room lock', 'Lock', zz.wait_for_lock(current_setting('zz.pid')::int));
select zz.dblink_exec('p1', 'commit');
select count(*) from zz.dblink_get_result('p2', false) as t(r text);
select zz.chk('D-race', 'second phone is refused once the first committed', 'Kamar sudah terisi atau dipesan pada tanggal itu', zz.dblink_error_message('p2'));
select * from zz.dblink_get_result('p2', false) as t(r text);
select zz.eq('D-race', 'r5 has the first booking only', '10..12..active', zz.rc_leases('r5'));
-- different nights of the same room: the second phone waits, then books
select zz.dblink_exec('p1', 'begin');
select zz.dblink_exec('p1', format('insert into public.leases (org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date) values (%L, %L, %L, %L, %L, 100000, %L, %L)',
  zz.id('org'), zz.id('prop'), zz.id('r6'), zz.id('budi'), 'daily', zz.rc_d(10), zz.rc_d(12)));
select zz.dblink_send_query('p2', format(
  'with x as (insert into public.leases (org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date) values (%L, %L, %L, %L, %L, 100000, %L, %L) returning 1) select count(*)::text from x',
  zz.id('org'), zz.id('prop'), zz.id('r6'), zz.id('sari'), 'daily', zz.rc_d(13), zz.rc_d(14)));
select zz.eq('D-race', 'a booking of other nights waits too', 'Lock', zz.wait_for_lock(current_setting('zz.pid')::int));
select zz.dblink_exec('p1', 'commit');
select zz.eq('D-race', '... and then goes through', '1', (select r from zz.dblink_get_result('p2') as t(r text)));
select * from zz.dblink_get_result('p2') as t(r text);
select zz.dblink_disconnect('p1'), zz.dblink_disconnect('p2');
select zz.eq('D-race', 'r6 has both', '10..12..active 13..14..active', zz.rc_leases('r6'));

-- E. daftar tunggu: front-desk work for every member, deleting for owners/admins, nothing across organisations
do $$
declare
  s uuid := zz.id('staff');
  o uuid := zz.id('owner');
  w uuid := zz.id('wife');
  org uuid := zz.id('org');
begin
  perform zz.eq('E-waitlist', 'staff adds an entry (created_by is forced to the staff member)', 'ok:1', zz.att(s, format(
    'insert into public.waitlist (id, org_id, property_id, name, phone, wanted_from, period_type, quantity, max_price, room_note, created_by) values (%L, %L, %L, %L, %L, %L, %L, 2, 150000, %L, %L)',
    zz.id('w_staff'), org, zz.id('prop'), 'Rina', '+6281234567811', zz.rc_d(5), 'daily', 'lantai bawah', o), true));
  perform zz.eq('E-waitlist', '... defaults: waiting, no lease', 'waiting|-|' || s::text,
    (select concat_ws('|', status, coalesce(lease_id::text, '-'), created_by) from public.waitlist where id = zz.id('w_staff')));
  perform zz.eq('E-waitlist', 'owner adds one for any kos, secepatnya', 'ok:1', zz.att(o, format(
    'insert into public.waitlist (id, org_id, name, period_type, quantity) values (%L, %L, %L, %L, 1)', zz.id('w_owner'), org, 'Joko', 'weekly'), true));
  perform zz.eq('E-waitlist', 'staff sees both', 'val:2', zz.val(s, 'select count(*) from public.waitlist'));
  perform zz.eq('E-waitlist', 'staff changes an entry', 'ok:1', zz.att(s, format('update public.waitlist set room_note = %L, quantity = 3 where id = %L', 'kamar mandi dalam', zz.id('w_owner')), true));
  perform zz.eq('E-waitlist', 'staff cancels an entry', 'ok:1', zz.att(s, format('update public.waitlist set status = %L where id = %L', 'cancelled', zz.id('w_owner')), true));
  perform zz.eq('E-waitlist', 'staff marks an entry booked with its lease', 'ok:1', zz.att(s, format('update public.waitlist set status = %L, lease_id = %L where id = %L', 'booked', zz.id('b2'), zz.id('w_staff')), true));
  perform zz.eq('E-waitlist', 'staff cannot delete (RLS: no row)', 'ok:0', zz.att(s, format('delete from public.waitlist where id = %L', zz.id('w_owner'))));
  perform zz.eq('E-waitlist', 'an admin can (rolled back)', 'ok:1', zz.att(w, format('delete from public.waitlist where id = %L', zz.id('w_owner'))));
  perform zz.eq('E-waitlist', 'the owner deletes one', 'ok:1', zz.att(o, format('delete from public.waitlist where id = %L', zz.id('w_owner')), true));
  -- the database's checks
  perform zz.chk('E-waitlist', 'a name is required', '^err:23514', zz.att(s, format('insert into public.waitlist (org_id, name) values (%L, %L)', org, '  ')));
  perform zz.chk('E-waitlist', 'at least one night/week/month', '^err:23514', zz.att(s, format('insert into public.waitlist (org_id, name, quantity) values (%L, %L, 0)', org, 'X')));
  perform zz.chk('E-waitlist', 'a known status', '^err:23514', zz.att(s, format('update public.waitlist set status = %L where id = %L', 'x', zz.id('w_staff'))));
  perform zz.chk('E-waitlist', 'a budget is never negative', '^err:23514', zz.att(s, format('update public.waitlist set max_price = -1 where id = %L', zz.id('w_staff'))));
  perform zz.chk('E-waitlist', 'a known period type', '^err:23514', zz.att(s, format('update public.waitlist set period_type = %L where id = %L', 'yearly', zz.id('w_staff'))));
  -- other organisations and strangers
  perform zz.eq('E-waitlist', 'the other organisation sees none of ours', 'val:0', zz.val(zz.id('o2owner'), format('select count(*) from public.waitlist where org_id = %L', org)));
  perform zz.eq('E-waitlist', '... and we see none of theirs', 'val:0', zz.val(o, format('select count(*) from public.waitlist where org_id = %L', zz.id('org2'))));
  perform zz.chk('E-waitlist', 'the other organisation cannot add to ours', '^err:42501', zz.att(zz.id('o2owner'), format('insert into public.waitlist (org_id, name) values (%L, %L)', org, 'X')));
  perform zz.eq('E-waitlist', '... nor change ours', 'ok:0', zz.att(zz.id('o2owner'), format('update public.waitlist set name = %L where org_id = %L', 'X', org)));
  perform zz.eq('E-waitlist', '... nor delete ours', 'ok:0', zz.att(zz.id('o2owner'), format('delete from public.waitlist where org_id = %L', org)));
  perform zz.chk('E-waitlist', 'their entry cannot point at our kos', '^err:23503', zz.att(zz.id('o2owner'), format('insert into public.waitlist (org_id, property_id, name) values (%L, %L, %L)', zz.id('org2'), zz.id('prop'), 'X')));
  perform zz.chk('E-waitlist', '... nor at our lease', '^err:23503', zz.att(zz.id('o2owner'), format('insert into public.waitlist (org_id, name, lease_id) values (%L, %L, %L)', zz.id('org2'), 'X', zz.id('b1'))));
  perform zz.chk('E-waitlist', 'an entry never moves to another organisation', '^err:', zz.att(o, format('update public.waitlist set org_id = %L where id = %L', zz.id('org2'), zz.id('w_staff'))));
  perform zz.eq('E-waitlist', 'a stranger sees nothing', 'val:0', zz.val(zz.id('stranger'), 'select count(*) from public.waitlist'));
  perform zz.chk('E-waitlist', 'a stranger cannot add', '^err:42501', zz.att(zz.id('stranger'), format('insert into public.waitlist (org_id, name) values (%L, %L)', org, 'X')));
  perform zz.chk('E-waitlist', 'anon cannot read', '^err:42501', zz.val(null, 'select count(*) from public.waitlist'));
  -- ON DELETE SET NULL: the booked lease (no invoices) and an empty kos are deleted by the owner
  perform zz.eq('E-waitlist', 'an entry for the empty kos', 'ok:1', zz.att(s, format('insert into public.waitlist (id, org_id, property_id, name) values (%L, %L, %L, %L)', zz.id('w_kos'), org, zz.id('prop_empty'), 'Wulan'), true));
  perform zz.eq('E-waitlist', 'the owner deletes the booked lease', 'ok:1', zz.att(o, format('delete from public.leases where id = %L', zz.id('b2')), true));
  perform zz.eq('E-waitlist', '... the entry stays booked without the link', 'booked|', (select concat_ws('|', status, coalesce(lease_id::text, '')) from public.waitlist where id = zz.id('w_staff')));
  perform zz.eq('E-waitlist', 'the owner deletes the empty kos', 'ok:1', zz.att(o, format('delete from public.properties where id = %L', zz.id('prop_empty')), true));
  perform zz.eq('E-waitlist', '... its entry now waits for any kos', 'NULL', coalesce((select property_id::text from public.waitlist where id = zz.id('w_kos')), 'NULL'));
end $$;

-- F. history: every change of an entry, readable by owners/admins only
do $$ begin
  perform zz.eq('F-audit', 'insert, updates and the delete of the entries', 'w_owner:delete,w_owner:insert,w_owner:update,w_owner:update,w_staff:insert,w_staff:update',
    (select string_agg(k.k || ':' || a.action, ',' order by k.k, a.action)
       from public.audit_log a join zz.ids k on k.v = a.row_id
      where a.table_name = 'waitlist' and k.k in ('w_staff', 'w_owner') and a.changed_by is not null and a.row_id is not null
        and not (a.action = 'update' and a.old_data ->> 'lease_id' is not null and a.new_data ->> 'lease_id' is null)));
  perform zz.eq('F-audit', 'the staff member''s changes are recorded as theirs', '4',
    (select count(*)::text from public.audit_log where table_name = 'waitlist' and changed_by = zz.id('staff') and row_id in (zz.id('w_staff'), zz.id('w_owner'))));
  perform zz.eq('F-audit', 'clearing the link when the lease went is recorded too', '1',
    (select count(*)::text from public.audit_log where table_name = 'waitlist' and row_id = zz.id('w_staff') and action = 'update'
       and old_data ->> 'lease_id' = zz.id('b2')::text and new_data ->> 'lease_id' is null));
  perform zz.chk('F-audit', 'an admin reads it', '^val:[1-9]', zz.val(zz.id('wife'), 'select count(*) from public.audit_log where table_name = ''waitlist'''));
  perform zz.eq('F-audit', 'staff do not', 'val:0', zz.val(zz.id('staff'), 'select count(*) from public.audit_log where table_name = ''waitlist'''));
end $$;

-- G. the weekly backup carries the daftar tunggu of each organisation
do $$
declare
  b jsonb := public.export_backup();
  ours jsonb := (select f from jsonb_array_elements(b) f where f -> 'tables' -> 'organizations' -> 0 ->> 'id' = zz.id('org')::text);
  theirs jsonb := (select f from jsonb_array_elements(b) f where f -> 'tables' -> 'organizations' -> 0 ->> 'id' = zz.id('org2')::text);
begin
  perform zz.eq('G-backup', 'our entries', 'Rina,Wulan', (select string_agg(e ->> 'name', ',' order by e ->> 'name') from jsonb_array_elements(ours -> 'tables' -> 'waitlist') e));
  perform zz.eq('G-backup', 'with what they want', 'daily|2|150000|lantai bawah',
    (select concat_ws('|', e ->> 'period_type', e ->> 'quantity', e ->> 'max_price', e ->> 'room_note') from jsonb_array_elements(ours -> 'tables' -> 'waitlist') e where e ->> 'name' = 'Rina'));
  perform zz.eq('G-backup', 'theirs in their own file', 'Tamu org dua', (select string_agg(e ->> 'name', ',') from jsonb_array_elements(theirs -> 'tables' -> 'waitlist') e));
end $$;

drop function zz.rc_d(int), zz.rc_lease(text, text, text, text, text, date, date, text, date, boolean), zz.rc_leases(text);
