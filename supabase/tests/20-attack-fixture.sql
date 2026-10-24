-- Fixture for the attack tests (21-attacks.sql). Memberships come from the real flows: the owner uses
-- the setup code, everyone else an invitation code. Organisations 2 and 9 (other families on the same
-- project) are created by the operator.
\set ON_ERROR_STOP on
select set_config('zz.suite', '20-attacks', false);
select zz.reset_data();

select zz.user('owner',    '11111111-1111-1111-1111-111111111111', 'owner@example.com');
select zz.user('dual',     '22222222-2222-2222-2222-222222222222', 'dual@example.com');  -- staff in org1 AND owner of org9
select zz.user('admin',    '33333333-3333-3333-3333-333333333333', 'wife@example.com');
select zz.user('stranger', '44444444-4444-4444-4444-444444444444', 'evil@example.com');
select zz.user('staff',    '55555555-5555-5555-5555-555555555555', 'staff2@example.com');
select zz.user('o2owner',  '66666666-6666-6666-6666-666666666666', 'other@example.com');
select zz.user('newbie',   '88888888-0000-0000-0000-000000000001', 'newbie@example.com');
insert into zz.ids values
  ('org2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), ('org9', '99999999-9999-9999-9999-999999999999'),
  ('prop1', 'd0000000-0000-0000-0000-000000000001'), ('room1', 'd0000000-0000-0000-0000-000000000002'),
  ('tenant1', 'd0000000-0000-0000-0000-000000000003'), ('lease1', 'd0000000-0000-0000-0000-000000000004'),
  ('inv1', 'd0000000-0000-0000-0000-000000000005'), ('pay_owner', 'd0000000-0000-0000-0000-000000000006'),
  ('exp_owner', 'd0000000-0000-0000-0000-000000000007'), ('room2', 'd0000000-0000-0000-0000-000000000008'),
  ('prop2', 'a0000000-0000-0000-0000-000000000001'), ('tenant2', 'a0000000-0000-0000-0000-000000000002'),
  ('pay_staff', 'b0000000-0000-0000-0000-000000000001'), ('exp_staff', 'b0000000-0000-0000-0000-000000000002'),
  ('tenant_loose', 'b0000000-0000-0000-0000-000000000003'), ('inv_unpaid', 'b0000000-0000-0000-0000-000000000004'),
  ('prop9', '88888888-8888-8888-8888-888888888888');

-- organisation 1: setup code, then invitation codes
select zz.su('select public.set_setup_code(''SETUP-2026'')', true);
select zz.join(zz.id('owner'), 'SETUP-2026');
insert into zz.ids select 'org1', id from public.organizations;
do $$
declare org uuid := zz.id('org1');
begin
  perform zz.eq('fixture', 'admin joins', 'val:' || org, zz.join(zz.id('admin'), zz.invite('admin', zz.id('owner'), org, 'admin', 'Istri')));
  perform zz.eq('fixture', 'dual joins as staff', 'val:' || org, zz.join(zz.id('dual'), zz.invite('dual', zz.id('owner'), org, 'staff', 'Teman')));
  perform zz.eq('fixture', 'staff joins', 'val:' || org, zz.join(zz.id('staff'), zz.invite('staff', zz.id('admin'), org, 'staff', 'Penjaga')));
  perform zz.invite('pending', zz.id('owner'), org, 'admin', 'Belum dipakai');
end $$;

-- organisations 2 and 9 (operator)
insert into public.organizations (id, name, created_by) values (zz.id('org2'), 'Org Two', zz.id('o2owner'));
insert into public.organization_members (org_id, user_id, email, role) values (zz.id('org2'), zz.id('o2owner'), 'other@example.com', 'owner');
insert into public.properties (id, org_id, name) values (zz.id('prop2'), zz.id('org2'), 'Kos Dua');
insert into public.tenants (id, org_id, property_id, full_name, id_type, id_number, nationality)
  values (zz.id('tenant2'), zz.id('org2'), zz.id('prop2'), 'Org2 tenant', 'passport', 'X1234567', 'MY');
insert into public.organizations (id, name, created_by) values (zz.id('org9'), 'Other', zz.id('dual'));
insert into public.organization_members (org_id, user_id, email, role) values (zz.id('org9'), zz.id('dual'), 'dual@example.com', 'owner');
insert into public.properties (id, org_id, name) values (zz.id('prop9'), zz.id('org9'), 'Other kos');

-- organisation 1 data, through the API
do $$
declare
  o uuid := zz.id('owner');
  s uuid := zz.id('staff');
  org uuid := zz.id('org1');
begin
  perform zz.eq('fixture', 'property', 'ok:1', zz.att(o, format('insert into public.properties (id, org_id, name, payment_info) values (%L, %L, %L, %L)',
    zz.id('prop1'), org, 'Kos Melati', 'BCA 123 a.n. Pemilik'), true));
  perform zz.eq('fixture', 'rooms', 'ok:2', zz.att(o, format('insert into public.rooms (id, org_id, property_id, name, price_monthly) values (%L, %L, %L, %L, 1500000), (%L, %L, %L, %L, 1500000)',
    zz.id('room1'), org, zz.id('prop1'), 'A1', zz.id('room2'), org, zz.id('prop1'), 'B1'), true));
  perform zz.eq('fixture', 'tenant', 'ok:1', zz.att(o, format('insert into public.tenants (id, org_id, property_id, full_name, ktp_image_path) values (%L, %L, %L, %L, %L)',
    zz.id('tenant1'), org, zz.id('prop1'), 'Budi', org || '/budi.jpg'), true));
  perform zz.eq('fixture', 'lease', 'ok:1', zz.att(o, format('insert into public.leases (id, org_id, property_id, room_id, tenant_id, period_type, price_per_period, deposit_amount, start_date, end_date) values (%L, %L, %L, %L, %L, %L, 1500000, 1000000, %L, %L)',
    zz.id('lease1'), org, zz.id('prop1'), zz.id('room1'), zz.id('tenant1'), 'monthly', '2026-03-01', '2026-03-31'), true));
  perform zz.eq('fixture', 'add-on price list and a lease add-on', 'ok:1', zz.att(o, format(
    'with a as (insert into public.addon_catalog (org_id, name, default_price) values (%L, %L, 100000) returning org_id, name, default_price)
     insert into public.lease_addons (org_id, lease_id, name, amount) select org_id, %L, name, default_price from a',
    org, 'Parkir', zz.id('lease1')), true));
  perform zz.eq('fixture', 'paid invoice', 'ok:1', zz.att(o, format('insert into public.invoices (id, org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date) values (%L, %L, %L, %L, %L, %L, %L, 1500000, 1500000, %L)',
    zz.id('inv1'), org, zz.id('prop1'), zz.id('lease1'), 'INV-202603-0001', '2026-03-01', '2026-03-31', '2026-03-01'), true));
  perform zz.eq('fixture', 'owner payments', 'ok:2', zz.att(o, format('insert into public.payments (id, org_id, property_id, invoice_id, lease_id, amount, paid_at) values (%L, %L, %L, %L, %L, 500000, %L), (gen_random_uuid(), %L, %L, %L, %L, 1000000, %L)',
    zz.id('pay_owner'), org, zz.id('prop1'), zz.id('inv1'), zz.id('lease1'), '2026-03-01', org, zz.id('prop1'), zz.id('inv1'), zz.id('lease1'), '2026-03-05'), true));
  perform zz.eq('fixture', 'owner expense', 'ok:1', zz.att(o, format('insert into public.expenses (id, org_id, property_id, category, amount, expense_date, description) values (%L, %L, %L, %L, 75000, %L, %L)',
    zz.id('exp_owner'), org, zz.id('prop1'), 'maintenance', '2026-03-03', 'Kran'), true));
  perform zz.eq('fixture', 'staff deposit', 'ok:1', zz.att(s, format('insert into public.payments (id, org_id, property_id, lease_id, amount, paid_at, kind) values (%L, %L, %L, %L, 100000, %L, %L)',
    zz.id('pay_staff'), org, zz.id('prop1'), zz.id('lease1'), '2026-03-01', 'deposit'), true));
  perform zz.eq('fixture', 'staff expense', 'ok:1', zz.att(s, format('insert into public.expenses (id, org_id, property_id, category, amount, expense_date, description) values (%L, %L, %L, %L, 50000, %L, %L)',
    zz.id('exp_staff'), org, zz.id('prop1'), 'supplies', '2026-03-02', 'sapu'), true));
  perform zz.eq('fixture', 'tenant without property', 'ok:1', zz.att(s, format('insert into public.tenants (id, org_id, full_name) values (%L, %L, %L)',
    zz.id('tenant_loose'), org, 'Loose tenant'), true));
  perform zz.eq('fixture', 'unpaid invoice', 'ok:1', zz.att(s, format('insert into public.invoices (id, org_id, property_id, lease_id, invoice_number, period_type, period_start, period_end, base_amount, total_amount, due_date) values (%L, %L, %L, %L, %L, %L, %L, %L, 1500000, 1500000, %L)',
    zz.id('inv_unpaid'), org, zz.id('prop1'), zz.id('lease1'), 'INV-202605-0001', 'monthly', '2026-05-01', '2026-05-31', '2026-05-01'), true));
  -- daftar tunggu (SPEC 7.7), so re-running schema.sql (30-reapply) has a waitlist row to keep
  perform zz.eq('fixture', 'staff waitlist entry', 'ok:1', zz.att(s, format('insert into public.waitlist (org_id, property_id, name, period_type, quantity) values (%L, %L, %L, %L, 2)',
    org, zz.id('prop1'), 'Rina', 'daily'), true));
end $$;

-- storage objects
insert into storage.objects (id, bucket_id, name) values
  ('c0000000-0000-0000-0000-000000000001', 'ktp', zz.id('org1') || '/budi.jpg'),
  ('c0000000-0000-0000-0000-000000000002', 'ktp', zz.id('org2') || '/org2.jpg'),
  ('c0000000-0000-0000-0000-000000000003', 'receipts', zz.id('org1') || '/nota.jpg');
insert into storage.buckets (id, name, public) values ('other', 'other', false) on conflict do nothing;

do $$ begin
  perform zz.eq('fixture', 'members of org1', 'dual:staff,owner:owner,staff2:staff,wife:admin',
    (select string_agg(split_part(email, '@', 1) || ':' || role, ',' order by email) from public.organization_members where org_id = zz.id('org1')));
  perform zz.eq('fixture', 'stranger has no membership', '0', (select count(*)::text from public.organization_members where user_id = zz.id('stranger')));
  perform zz.eq('fixture', 'invoice paid by triggers', 'paid', (select status from public.invoices where id = zz.id('inv1')));
  perform zz.eq('fixture', 'staff rows authored by staff', '2', (select count(*)::text from (
    select created_by from public.payments where id = zz.id('pay_staff') union all select created_by from public.expenses where id = zz.id('exp_staff')) x
    where created_by = zz.id('staff')));
end $$;
