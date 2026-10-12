-- Data as a v0.2 installation would have it (needs fixtures/schema-v0.2.sql and 01-harness.sql):
-- the first signup became the owner, members joined by email invitation, one invitation is still pending.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@example.com');
insert into zz.ids values ('v2owner', '11111111-1111-1111-1111-111111111111'), ('v2wife', '33333333-3333-3333-3333-333333333333'),
  ('v2staff', '55555555-5555-5555-5555-555555555555'), ('v2later', '77777777-7777-7777-7777-777777777777');
insert into zz.ids select 'v2org', org_id from public.organization_members;
do $$
declare
  o uuid := zz.id('v2owner');
  org uuid := zz.id('v2org');
  r text;
begin
  r := zz.val(o, format('select public.add_member_by_email(%L, %L, %L)', org, 'Wife@Example.com', 'admin'), true)
    || zz.val(o, format('select public.add_member_by_email(%L, %L, %L)', org, 'staff@example.com', 'staff'), true)
    || zz.val(o, format('select public.add_member_by_email(%L, %L, %L)', org, 'later@example.com', 'staff'), true);
  if r <> 'val:invitedval:invitedval:invited' then raise exception 'v0.2 invitations: %', r; end if;
  insert into auth.users (id, email) values (zz.id('v2wife'), 'wife@example.com'), (zz.id('v2staff'), 'staff@example.com');
  r := zz.att(o, format('insert into public.properties (id, org_id, name, payment_info) values (%L, %L, %L, %L)', 'e0000000-0000-0000-0000-000000000001', org, 'Kos Lama', 'BCA 1'), true)
    || zz.att(o, format('insert into public.rooms (id, org_id, property_id, name, price_monthly) values (%L, %L, %L, %L, 1000000)', 'e0000000-0000-0000-0000-000000000002', org, 'e0000000-0000-0000-0000-000000000001', 'A1'), true)
    || zz.att(o, format('insert into public.tenants (id, org_id, property_id, full_name, ktp_image_path) values (%L, %L, %L, %L, %L)', 'e0000000-0000-0000-0000-000000000003', org, 'e0000000-0000-0000-0000-000000000001', 'Tono', org || '/tono.jpg'), true)
    || zz.att(o, format('insert into public.leases (id, org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date) values (%L, %L, %L, %L, %L, %L, 1000000, %L, %L)', 'e0000000-0000-0000-0000-000000000004', org, 'e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000003', 'monthly', '2026-01-01', '2026-01-31'), true)
    || zz.att(o, format('insert into public.invoices (id, org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date) values (%L, %L, %L, %L, %L, %L, %L, 1000000, 1000000, %L)', 'e0000000-0000-0000-0000-000000000005', org, 'e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004', 'INV-202601-0001', '2026-01-01', '2026-01-31', '2026-01-01'), true)
    || zz.att(o, format('insert into public.payments (org_id, property_id, invoice_id, lease_id, amount, paid_at) values (%L, %L, %L, %L, 400000, %L)', org, 'e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000004', '2026-01-01'), true)
    || zz.att(zz.id('v2staff'), format('insert into public.payments (org_id, property_id, invoice_id, lease_id, amount, paid_at) values (%L, %L, %L, %L, 600000, %L)', org, 'e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000004', '2026-01-05'), true)
    || zz.att(zz.id('v2staff'), format('insert into public.expenses (org_id, property_id, category, amount, expense_date, description, receipt_path) values (%L, %L, %L, 30000, %L, %L, %L)', org, 'e0000000-0000-0000-0000-000000000001', 'supplies', '2026-01-02', 'Lampu', org || '/nota.jpg'), true);
  if r <> repeat('ok:1', 8) then raise exception 'v0.2 data: %', r; end if;
  insert into storage.objects (bucket_id, name) values ('ktp', org || '/tono.jpg'), ('receipts', org || '/nota.jpg');
end $$;
