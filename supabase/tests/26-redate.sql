-- Ubah tanggal mulai sewa (SPEC 7.6): public.redate_lease, replayed with the request the app sends (SupabaseRepo.redateLease,
-- one zz.val per API call). The owner typed 1 Sep instead of 18 Agt; the app moves the lease and every invoice in one call.
-- Owners/admins only (the function and leases_terms_guard), active leases only, the exact invoice list, the room rule,
-- all or nothing, amounts untouched, every change in the history.
\set ON_ERROR_STOP on
select set_config('zz.suite', '26-redate', false);
select zz.reset_data();

select zz.user('owner', '11111111-2626-0000-0000-000000000001', 'owner@redate.test');
select zz.user('wife', '22222222-2626-0000-0000-000000000002', 'wife@redate.test');
select zz.user('staff', '33333333-2626-0000-0000-000000000003', 'staff@redate.test');
select zz.user('o2owner', '44444444-2626-0000-0000-000000000004', 'other@redate.test');
select zz.su('select public.set_setup_code(''REDATE-26'')', true);
select zz.join(zz.id('owner'), 'redate26');
insert into zz.ids select 'org', id from public.organizations;
insert into zz.ids values
  ('prop', 'eeeeeeee-0000-0000-0000-000000000001'), ('tenant', 'eeeeeeee-0000-0000-0000-000000000002'),
  ('tenant_prev', 'eeeeeeee-0000-0000-0000-000000000003'),
  ('r1', 'eeeeeeee-0000-0000-0000-000000000011'), ('l1', 'eeeeeeee-0000-0000-0000-000000000012'),
  ('sep', 'eeeeeeee-0000-0000-0000-000000000013'), ('oct', 'eeeeeeee-0000-0000-0000-000000000014'),
  ('oct_void', 'eeeeeeee-0000-0000-0000-000000000015'), ('nov', 'eeeeeeee-0000-0000-0000-000000000016'),
  ('r2', 'eeeeeeee-0000-0000-0000-000000000021'), ('l2', 'eeeeeeee-0000-0000-0000-000000000022'),
  ('l2_sep', 'eeeeeeee-0000-0000-0000-000000000023'), ('prev', 'eeeeeeee-0000-0000-0000-000000000024'),
  ('r3', 'eeeeeeee-0000-0000-0000-000000000031'), ('l3', 'eeeeeeee-0000-0000-0000-000000000032'),
  ('r4', 'eeeeeeee-0000-0000-0000-000000000041'), ('l4', 'eeeeeeee-0000-0000-0000-000000000042'),
  ('r5', 'eeeeeeee-0000-0000-0000-000000000051'), ('l5', 'eeeeeeee-0000-0000-0000-000000000052'),
  ('l5_sep', 'eeeeeeee-0000-0000-0000-000000000053'),
  ('org2', 'eeeeeeee-0000-0000-0000-000000000091'), ('prop9', 'eeeeeeee-0000-0000-0000-000000000092'),
  ('room9', 'eeeeeeee-0000-0000-0000-000000000093'), ('tenant9', 'eeeeeeee-0000-0000-0000-000000000094'),
  ('l9', 'eeeeeeee-0000-0000-0000-000000000095'), ('l9_sep', 'eeeeeeee-0000-0000-0000-000000000096');

-- seed as the owner, through the API
create or replace function zz.rd_lease(p_room text, p_lease text, p_tenant text, p_start date, p_end date, p_status text default 'active', p_checkout date default null)
returns void language plpgsql as $$
begin
  perform zz.eq('seed', 'room ' || p_room, 'ok:1', zz.att(zz.id('owner'), format('insert into public.rooms (id, org_id, property_id, name, price_monthly) values (%L, %L, %L, %L, 1500000)',
    zz.id(p_room), zz.id('org'), zz.id('prop'), p_room), true));
  perform zz.eq('seed', 'lease ' || p_lease, 'ok:1', zz.att(zz.id('owner'), format('insert into public.leases (id, org_id, property_id, room_id, tenant_id, period_type, price_per_period, deposit_amount, start_date, end_date, status, checkout_date, notes) values (%L, %L, %L, %L, %L, %L, 1500000, 1000000, %L, %L, %L, %L, %L)',
    zz.id(p_lease), zz.id('org'), zz.id('prop'), zz.id(p_room), zz.id(p_tenant), 'monthly', p_start, p_end, p_status, p_checkout, 'Kamar pojok'), true));
end $$;

create or replace function zz.rd_invoice(p_key text, p_lease text, p_number text, p_start date, p_end date, p_status text default 'unpaid')
returns void language plpgsql as $$
begin
  perform zz.eq('seed', 'invoice ' || p_number, 'ok:1', zz.att(zz.id('owner'), format('insert into public.invoices (id, org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date, status) values (%L, %L, %L, %L, %L, %L, %L, 1500000, 1500000, %L, %L)',
    zz.id(p_key), zz.id('org'), zz.id('prop'), zz.id(p_lease), p_number, p_start, p_end, p_start, p_status), true));
end $$;

-- one element of p_invoices, as SupabaseRepo.redateLease sends it
create or replace function zz.rd_item(p_key text, p_start date, p_end date, p_due date default null) returns jsonb language sql as $$
  select jsonb_build_object('id', zz.id(p_key), 'period_start', p_start, 'period_end', p_end, 'due_date', coalesce(p_due, p_start));
$$;

-- the app's call: select public.redate_lease(...) as that user (null = anon); kept only when p_keep
create or replace function zz.rd_call(p_user text, p_lease text, p_expected date, p_start date, p_end date, p_invoices jsonb, p_note text default null, p_keep boolean default false)
returns text language sql as $$
  select zz.val(case when p_user is null then null else zz.id(p_user) end,
    format('select public.redate_lease(%L, %L, %L, %L, %L::jsonb, %L)', zz.id(p_lease), p_expected, p_start, p_end, p_invoices, p_note), p_keep);
$$;

-- what must not change: amounts, numbers, statuses of every invoice and every payment row
create or replace function zz.rd_money() returns text language sql as $$
  select md5(coalesce((select string_agg(concat_ws('|', invoice_number, status, quantity, base_amount, addons_amount, extra_amount, discount_amount, total_amount, period_type), ',' order by invoice_number) from public.invoices), '')
          || coalesce((select string_agg(concat_ws('|', id, invoice_id, amount, paid_at, method, kind), ',' order by id) from public.payments), ''));
$$;

create or replace function zz.rd_dates(p_lease text) returns text language sql as $$
  select (select concat_ws('..', start_date, end_date) from public.leases where id = zz.id(p_lease)) || ' ' ||
         coalesce((select string_agg(concat_ws('..', period_start, period_end, due_date), ' ' order by invoice_number) from public.invoices where lease_id = zz.id(p_lease)), '');
$$;

-- the owner's lease, corrected from 1 Sep to 18 Agt: every invoice of it
create or replace function zz.rd_good() returns jsonb language sql as $$
  select jsonb_build_array(
    zz.rd_item('sep', '2026-08-18', '2026-09-17'),
    zz.rd_item('oct', '2026-09-18', '2026-10-17'),
    zz.rd_item('oct_void', '2026-10-01', '2026-10-31'),
    zz.rd_item('nov', '2026-10-18', '2026-11-17'));
$$;

do $$
declare
  o uuid := zz.id('owner');
  org uuid := zz.id('org');
begin
  perform zz.eq('setup', 'wife joins as admin', 'val:' || org, zz.join(zz.id('wife'), zz.invite('wife', o, org, 'admin', 'Istri')));
  perform zz.eq('setup', 'staff joins as staff', 'val:' || org, zz.join(zz.id('staff'), zz.invite('staff', o, org, 'staff', 'Penjaga')));
  perform zz.eq('seed', 'property', 'ok:1', zz.att(o, format('insert into public.properties (id, org_id, name) values (%L, %L, %L)', zz.id('prop'), org, 'Kos Melati'), true));
  perform zz.eq('seed', 'tenants', 'ok:2', zz.att(o, format('insert into public.tenants (id, org_id, property_id, full_name) values (%L, %L, %L, %L), (%L, %L, %L, %L)',
    zz.id('tenant'), org, zz.id('prop'), 'Budi', zz.id('tenant_prev'), org, zz.id('prop'), 'Siti'), true));
  -- L1: the owner's case. September paid, October has a DP, a voided duplicate of October, November open
  perform zz.rd_lease('r1', 'l1', 'tenant', '2026-09-01', '2026-11-30');
  perform zz.rd_invoice('sep', 'l1', 'INV-202609-0001', '2026-09-01', '2026-09-30');
  perform zz.rd_invoice('oct', 'l1', 'INV-202610-0001', '2026-10-01', '2026-10-31');
  perform zz.rd_invoice('oct_void', 'l1', 'INV-202610-0002', '2026-10-01', '2026-10-31', 'void');
  perform zz.rd_invoice('nov', 'l1', 'INV-202611-0001', '2026-11-01', '2026-11-30');
  perform zz.eq('seed', 'payments on L1', 'ok:3', zz.att(o, format('insert into public.payments (org_id, property_id, invoice_id, lease_id, amount, paid_at, method, kind) values (%L, %L, %L, %L, 1500000, %L, %L, %L), (%L, %L, %L, %L, 500000, %L, %L, %L), (%L, %L, null, %L, 1000000, %L, %L, %L)',
    org, zz.id('prop'), zz.id('sep'), zz.id('l1'), '2026-09-01', 'transfer', 'rent',
    org, zz.id('prop'), zz.id('oct'), zz.id('l1'), '2026-10-02', 'cash', 'rent',
    org, zz.id('prop'), zz.id('l1'), '2026-09-01', 'cash', 'deposit'), true));
  -- L2 in room r2 right after the previous tenant, who checked out on 25 Agt (last night 24 Agt)
  perform zz.rd_lease('r2', 'prev', 'tenant_prev', '2026-07-01', '2026-08-24', 'ended', '2026-08-25');
  perform zz.eq('seed', 'L2 lease', 'ok:1', zz.att(o, format('insert into public.leases (id, org_id, property_id, room_id, tenant_id, period_type, price_per_period, deposit_amount, start_date, end_date) values (%L, %L, %L, %L, %L, %L, 1500000, 0, %L, %L)',
    zz.id('l2'), org, zz.id('prop'), zz.id('r2'), zz.id('tenant'), 'monthly', '2026-09-01', '2026-09-30'), true));
  perform zz.rd_invoice('l2_sep', 'l2', 'INV-202609-0002', '2026-09-01', '2026-09-30');
  -- L3 ended, L4 cancelled, L5 for the two-phone race
  perform zz.rd_lease('r3', 'l3', 'tenant', '2026-06-01', '2026-06-30', 'ended', '2026-07-01');
  perform zz.rd_lease('r4', 'l4', 'tenant', '2026-06-01', '2026-06-01', 'cancelled');
  perform zz.rd_lease('r5', 'l5', 'tenant', '2026-09-01', '2026-09-30');
  perform zz.rd_invoice('l5_sep', 'l5', 'INV-202609-0003', '2026-09-01', '2026-09-30');
  perform zz.eq('seed', 'statuses from the payments', 'paid,partial,void,unpaid',
    (select string_agg(status, ',' order by invoice_number) from public.invoices where lease_id = zz.id('l1')));
end $$;

-- another family on the same project (operator)
insert into public.organizations (id, name, created_by) values (zz.id('org2'), 'Org Dua', zz.id('o2owner'));
insert into public.organization_members (org_id, user_id, email, role) values (zz.id('org2'), zz.id('o2owner'), 'other@redate.test', 'owner');
insert into public.properties (id, org_id, name) values (zz.id('prop9'), zz.id('org2'), 'Kos Lain');
insert into public.rooms (id, org_id, property_id, name) values (zz.id('room9'), zz.id('org2'), zz.id('prop9'), 'Z1');
insert into public.tenants (id, org_id, property_id, full_name) values (zz.id('tenant9'), zz.id('org2'), zz.id('prop9'), 'Lain');
insert into public.leases (id, org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date)
  values (zz.id('l9'), zz.id('org2'), zz.id('prop9'), zz.id('room9'), zz.id('tenant9'), 'monthly', 1000000, '2026-09-01', '2026-09-30');
insert into public.invoices (id, org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date)
  values (zz.id('l9_sep'), zz.id('org2'), zz.id('prop9'), zz.id('l9'), 'INV-202609-0001', '2026-09-01', '2026-09-30', 1000000, 1000000, '2026-09-01');

create table if not exists zz.rd_snap (k text primary key, v text);
truncate zz.rd_snap;
insert into zz.rd_snap values ('money', zz.rd_money()), ('l1', zz.rd_dates('l1')), ('l2', zz.rd_dates('l2')), ('l9', zz.rd_dates('l9')),
  -- the seed's payments already wrote status updates of their invoices (payments_recalc)
  ('audit', (select count(*)::text from public.audit_log where table_name in ('leases', 'invoices') and action = 'update'));

-- A. the function itself
do $$ begin
  perform zz.ok('A-structure', 'redate_lease is security invoker (row-level security applies) with a pinned search_path', (
    select not p.prosecdef and 'search_path=public, pg_temp' = any (p.proconfig)
      from pg_proc p where p.oid = 'public.redate_lease(uuid,date,date,date,jsonb,text)'::regprocedure));
  perform zz.ok('A-structure', 'executable by authenticated', has_function_privilege('authenticated', 'public.redate_lease(uuid,date,date,date,jsonb,text)', 'EXECUTE'));
  perform zz.ok('A-structure', 'not executable by anon', not has_function_privilege('anon', 'public.redate_lease(uuid,date,date,date,jsonb,text)', 'EXECUTE'));
  perform zz.chk('A-structure', 'anon is refused', '^err:42501', zz.rd_call(null, 'l1', '2026-09-01', '2026-08-18', '2026-11-17', zz.rd_good()));
end $$;

-- B. who may: owners/admins only, in their own organisation
do $$ begin
  perform zz.eq('B-who', 'staff is refused by the function', 'err:P0001:Hanya pemilik/admin yang dapat mengubah tanggal mulai sewa.',
    zz.rd_call('staff', 'l1', '2026-09-01', '2026-08-18', '2026-11-17', zz.rd_good(), null, true));
  perform zz.eq('B-who', 'the owner of another organisation cannot see the lease', 'err:P0001:Sewa tidak ditemukan.',
    zz.rd_call('o2owner', 'l1', '2026-09-01', '2026-08-18', '2026-11-17', zz.rd_good(), null, true));
  perform zz.eq('B-who', 'nor can this owner move theirs', 'err:P0001:Sewa tidak ditemukan.',
    zz.rd_call('owner', 'l9', '2026-09-01', '2026-08-18', '2026-09-17', jsonb_build_array(zz.rd_item('l9_sep', '2026-08-18', '2026-09-17')), null, true));
  -- leases_terms_guard: a direct update of start_date by staff is refused too; their extensions still work
  perform zz.eq('B-who', 'staff cannot change start_date directly (leases_terms_guard)', 'err:P0001:Hanya pemilik/admin yang dapat mengubah tanggal mulai sewa.',
    zz.att(zz.id('staff'), format('update public.leases set start_date = %L where id = %L and org_id = %L returning *', '2026-08-18', zz.id('l1'), zz.id('org'))));
  perform zz.eq('B-who', 'staff still extends a lease (end_date)', 'ok:1',
    zz.att(zz.id('staff'), format('update public.leases set end_date = %L where id = %L and org_id = %L returning *', '2026-12-31', zz.id('l1'), zz.id('org'))));
  perform zz.eq('B-who', 'staff still moves rooms and writes notes', 'ok:1',
    zz.att(zz.id('staff'), format('update public.leases set room_id = %L, notes = %L where id = %L', zz.id('r3'), 'Pindah', zz.id('l1'))));
  perform zz.eq('B-who', 'an admin may change start_date directly', 'ok:1',
    zz.att(zz.id('wife'), format('update public.leases set start_date = %L where id = %L', '2026-08-18', zz.id('l1'))));
  perform zz.eq('B-who', 'staff cannot move invoices directly either (invoices update is admin-only)', 'ok:0',
    zz.att(zz.id('staff'), format('update public.invoices set period_start = %L where id = %L', '2026-08-18', zz.id('sep'))));
  perform zz.eq('B-who', 'nothing changed', (select v from zz.rd_snap where k = 'l1'), zz.rd_dates('l1'));
end $$;

-- C. refusals: nothing is written by any of them
do $$
declare
  good jsonb := zz.rd_good();
begin
  perform zz.eq('C-refused', 'a start changed since the screen read it (WB002)',
    'err:WB002:Tagihan atau pembayaran sewa ini baru saja diubah dari perangkat lain. Periksa angka terbaru di layar, lalu coba lagi.',
    zz.rd_call('wife', 'l1', '2026-08-31', '2026-08-18', '2026-11-17', good, null, true));
  perform zz.chk('C-refused', 'an invoice missing from the list (issued on another phone) -> WB002', '^err:WB002:',
    zz.rd_call('wife', 'l1', '2026-09-01', '2026-08-18', '2026-11-17', good - 3, null, true));
  perform zz.chk('C-refused', 'an extra invoice of another lease -> WB002', '^err:WB002:',
    zz.rd_call('wife', 'l1', '2026-09-01', '2026-08-18', '2026-11-17', good || jsonb_build_array(zz.rd_item('l2_sep', '2026-08-18', '2026-09-17')), null, true));
  perform zz.chk('C-refused', 'an invoice of another organisation -> WB002', '^err:WB002:',
    zz.rd_call('wife', 'l1', '2026-09-01', '2026-08-18', '2026-11-17', (good - 3) || jsonb_build_array(zz.rd_item('l9_sep', '2026-10-18', '2026-11-17')), null, true));
  perform zz.chk('C-refused', 'an invoice listed twice -> WB002', '^err:WB002:',
    zz.rd_call('wife', 'l1', '2026-09-01', '2026-08-18', '2026-11-17', (good - 3) || jsonb_build_array(good -> 0), null, true));
  perform zz.eq('C-refused', 'an invoice without dates', 'err:P0001:Data perubahan tanggal tidak lengkap.',
    zz.rd_call('wife', 'l1', '2026-09-01', '2026-08-18', '2026-11-17', (good - 0) || jsonb_build_array(jsonb_build_object('id', zz.id('sep'))), null, true));
  perform zz.eq('C-refused', 'not a list', 'err:P0001:Data perubahan tanggal tidak lengkap.',
    zz.rd_call('wife', 'l1', '2026-09-01', '2026-08-18', '2026-11-17', '{}'::jsonb, null, true));
  perform zz.eq('C-refused', 'the same start', 'err:P0001:Tanggal mulai sama dengan sebelumnya.',
    zz.rd_call('wife', 'l1', '2026-09-01', '2026-09-01', '2026-11-30', good, null, true));
  perform zz.eq('C-refused', 'an end before the start', 'err:P0001:Tanggal akhir sewa tidak boleh sebelum tanggal mulai.',
    zz.rd_call('wife', 'l1', '2026-09-01', '2026-08-18', '2026-08-17', good, null, true));
  perform zz.eq('C-refused', 'the last invoice ending before it starts', 'err:P0001:Periode tagihan tidak valid: tanggal akhir sebelum tanggal mulai.',
    zz.rd_call('wife', 'l1', '2026-09-01', '2026-08-18', '2026-11-17', (good - 3) || jsonb_build_array(zz.rd_item('nov', '2026-10-18', '2026-10-01')), null, true));
  perform zz.eq('C-refused', 'an ended lease keeps its dates', 'err:P0001:Sewa yang sudah selesai atau dibatalkan tidak bisa diubah tanggal mulainya.',
    zz.rd_call('wife', 'l3', '2026-06-01', '2026-05-20', '2026-06-19', '[]'::jsonb, null, true));
  perform zz.eq('C-refused', 'a cancelled lease too', 'err:P0001:Sewa yang sudah selesai atau dibatalkan tidak bisa diubah tanggal mulainya.',
    zz.rd_call('wife', 'l4', '2026-06-01', '2026-05-20', '2026-05-20', '[]'::jsonb, null, true));
  -- the room: L2 moved into the previous tenant's last nights (until 24 Agt) is a double booking
  perform zz.eq('C-refused', 'a start inside the previous stay of the room', 'err:P0001:Jadwal bentrok dengan sewa lain di kamar yang sama.',
    zz.rd_call('wife', 'l2', '2026-09-01', '2026-08-18', '2026-09-17', jsonb_build_array(zz.rd_item('l2_sep', '2026-08-18', '2026-09-17')), null, true));
  perform zz.chk('C-refused', 'same-day turnover is fine: starting on the checkout day (25 Agt) works (rolled back)', '^val:',
    zz.rd_call('wife', 'l2', '2026-09-01', '2026-08-25', '2026-09-24', jsonb_build_array(zz.rd_item('l2_sep', '2026-08-25', '2026-09-24'))));
  perform zz.eq('C-refused', 'L1 untouched', (select v from zz.rd_snap where k = 'l1'), zz.rd_dates('l1'));
  perform zz.eq('C-refused', 'L2 untouched', (select v from zz.rd_snap where k = 'l2'), zz.rd_dates('l2'));
  perform zz.eq('C-refused', 'the other organisation untouched', (select v from zz.rd_snap where k = 'l9'), zz.rd_dates('l9'));
  perform zz.eq('C-refused', 'money untouched', (select v from zz.rd_snap where k = 'money'), zz.rd_money());
  perform zz.eq('C-refused', 'no history written by refusals', (select v from zz.rd_snap where k = 'audit'),
    (select count(*)::text from public.audit_log where table_name in ('leases', 'invoices') and action = 'update'));
end $$;

-- D. all or nothing: when the lease write fails after the invoices were moved, the invoices go back too
create or replace function zz.rd_fail_lease() returns trigger language plpgsql as $$
begin
  if new.notes like '%GAGAL%' then raise exception 'lease write failed'; end if;
  return new;
end $$;
create trigger zz_rd_fail before update on public.leases for each row execute function zz.rd_fail_lease();
do $$ begin
  perform zz.chk('D-atomic', 'the call fails as a whole', 'lease write failed',
    zz.rd_call('wife', 'l1', '2026-09-01', '2026-08-18', '2026-11-17', zz.rd_good(), 'GAGAL', true));
  perform zz.eq('D-atomic', 'no invoice moved', (select v from zz.rd_snap where k = 'l1'), zz.rd_dates('l1'));
  perform zz.eq('D-atomic', 'no history either', (select v from zz.rd_snap where k = 'audit'),
    (select count(*)::text from public.audit_log where table_name in ('leases', 'invoices') and action = 'update'));
end $$;
drop trigger zz_rd_fail on public.leases;
drop function zz.rd_fail_lease();

-- E. the owner's correction, as the admin (wife), kept
do $$
declare
  w uuid := zz.id('wife');
begin
  perform zz.chk('E-success', 'admin corrects 1 Sep -> 18 Agt', '^val:',
    zz.rd_call('wife', 'l1', '2026-09-01', '2026-08-18', '2026-11-17', zz.rd_good(),
      'Tanggal mulai dikoreksi dari 1 Sep 2026 ke 18 Agt 2026 (23 Okt 2026): salah ketik', true));
  perform zz.eq('E-success', 'lease and invoices moved (the void one was sent unchanged)',
    '2026-08-18..2026-11-17 2026-08-18..2026-09-17..2026-08-18 2026-09-18..2026-10-17..2026-09-18 2026-10-01..2026-10-31..2026-10-01 2026-10-18..2026-11-17..2026-10-18',
    zz.rd_dates('l1'));
  perform zz.eq('E-success', 'note appended to the lease notes', E'Kamar pojok\nTanggal mulai dikoreksi dari 1 Sep 2026 ke 18 Agt 2026 (23 Okt 2026): salah ketik',
    (select notes from public.leases where id = zz.id('l1')));
  perform zz.eq('E-success', 'amounts, numbers, statuses and payments untouched', (select v from zz.rd_snap where k = 'money'), zz.rd_money());
  perform zz.eq('E-success', 'statuses still from the payments', 'paid,partial,void,unpaid',
    (select string_agg(status, ',' order by invoice_number) from public.invoices where lease_id = zz.id('l1')));
  perform zz.eq('E-success', 'price, deposit and status of the lease untouched', '1500000|1000000|active|monthly',
    (select concat_ws('|', price_per_period, deposit_amount, status, period_type) from public.leases where id = zz.id('l1')));
  -- history: one row per moved invoice and one for the lease, by the admin, with old and new dates
  perform zz.eq('E-success', 'one history row per moved invoice', 'INV-202609-0001,INV-202610-0001,INV-202611-0001',
    (select string_agg(new_data ->> 'invoice_number', ',' order by new_data ->> 'invoice_number') from public.audit_log
      where table_name = 'invoices' and action = 'update' and changed_by = w));
  perform zz.eq('E-success', 'the history keeps the old and new period of September', '2026-09-01..2026-09-30 -> 2026-08-18..2026-09-17',
    (select concat(old_data ->> 'period_start', '..', old_data ->> 'period_end', ' -> ', new_data ->> 'period_start', '..', new_data ->> 'period_end')
       from public.audit_log where table_name = 'invoices' and row_id = zz.id('sep') and action = 'update' and changed_by = w));
  perform zz.eq('E-success', 'and the lease start and end', '2026-09-01..2026-11-30 -> 2026-08-18..2026-11-17',
    (select concat(old_data ->> 'start_date', '..', old_data ->> 'end_date', ' -> ', new_data ->> 'start_date', '..', new_data ->> 'end_date')
       from public.audit_log where table_name = 'leases' and row_id = zz.id('l1') and action = 'update' and changed_by = w));
  perform zz.eq('E-success', 'the admin can read that history', 'val:4',
    zz.val(w, format('select count(*) from public.audit_log where row_id in (%L, %L, %L, %L) and action = %L and changed_by = %L', zz.id('l1'), zz.id('sep'), zz.id('oct'), zz.id('nov'), 'update', w)));
  -- the screen that still shows 1 Sep is refused now
  perform zz.chk('E-success', 'a second phone sending the old start is refused (WB002)', '^err:WB002:',
    zz.rd_call('owner', 'l1', '2026-09-01', '2026-08-18', '2026-11-17', zz.rd_good(), null, true));
  -- the next invoice the app issues continues on the new grid (as staff: an ordinary insert)
  perform zz.eq('E-success', 'next invoice 18 Nov .. 17 Des inserted by staff', 'ok:1', zz.att(zz.id('staff'), format(
    'insert into public.invoices (org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date) values (%L, %L, %L, %L, %L, %L, 1500000, 1500000, %L)',
    zz.id('org'), zz.id('prop'), zz.id('l1'), 'INV-202611-0002', '2026-11-18', '2026-12-17', '2026-11-18')));
end $$;

-- F. two phones at once: the second waits for the first, then finds the start moved (WB002)
select zz.dbl_open('rd1', zz.id('owner'));
select set_config('zz.pid', zz.dbl_open('rd2', zz.id('wife'))::text, false);
select zz.dblink_exec('rd1', 'begin');
select zz.eq('F-race', 'first phone corrects L5', '', (select coalesce(r, '') from zz.dblink('rd1', format(
  'select public.redate_lease(%L, %L, %L, %L, %L::jsonb, null)::text', zz.id('l5'), '2026-09-01', '2026-08-25', '2026-09-24',
  jsonb_build_array(zz.rd_item('l5_sep', '2026-08-25', '2026-09-24')))) as t(r text)));
select zz.dblink_send_query('rd2', format(
  'select public.redate_lease(%L, %L, %L, %L, %L::jsonb, null)::text', zz.id('l5'), '2026-09-01', '2026-08-20', '2026-09-19',
  jsonb_build_array(zz.rd_item('l5_sep', '2026-08-20', '2026-09-19'))));
select zz.eq('F-race', 'second phone waits on the lease row lock', 'Lock', zz.wait_for_lock(current_setting('zz.pid')::int));
select zz.dblink_exec('rd1', 'commit');
select count(*) from zz.dblink_get_result('rd2', false) as t(r text);
select zz.chk('F-race', 'second phone is refused with the reload message', 'baru saja diubah dari perangkat lain', zz.dblink_error_message('rd2'));
select * from zz.dblink_get_result('rd2', false) as t(r text);
select zz.dblink_disconnect('rd1'), zz.dblink_disconnect('rd2');
select zz.eq('F-race', 'L5 has the first correction only', '2026-08-25..2026-09-24 2026-08-25..2026-09-24..2026-08-25', zz.rd_dates('l5'));

drop function zz.rd_lease(text, text, text, date, date, text, date), zz.rd_invoice(text, text, text, date, date, text),
  zz.rd_item(text, date, date, date), zz.rd_call(text, text, date, date, date, jsonb, text, boolean), zz.rd_money(), zz.rd_dates(text), zz.rd_good();
drop table zz.rd_snap;
