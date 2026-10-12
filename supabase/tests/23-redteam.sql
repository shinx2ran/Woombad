-- Red-team scenarios with lasting effects: an insider (staff) doing as much damage as possible, an
-- admin, and a stolen owner account wiping the data. Checks what is left and what the history keeps.
\set ON_ERROR_STOP on
select set_config('zz.suite', '23-redteam', false);
select zz.reset_data();

select zz.user('owner', '11111111-1111-1111-1111-111111111111', 'owner@family.test');
select zz.user('stranger', '22222222-2222-2222-2222-222222222222', 'stranger@evil.test');
select zz.user('wife', '33333333-3333-3333-3333-333333333333', 'wife@family.test');
select zz.user('staff', '44444444-4444-4444-4444-444444444444', 'staff@family.test');
select zz.su('select public.set_setup_code(''RED-TEAM-01'')', true);
select zz.join(zz.id('owner'), 'redteam01');
insert into zz.ids select 'org', id from public.organizations;
insert into zz.ids values
  ('prop', 'aaaaaaaa-0000-0000-0000-000000000001'), ('room', 'aaaaaaaa-0000-0000-0000-000000000002'),
  ('budi', 'aaaaaaaa-0000-0000-0000-000000000003'), ('lease', 'aaaaaaaa-0000-0000-0000-000000000004'),
  ('inv1', 'aaaaaaaa-0000-0000-0000-000000000005'), ('pay1', 'aaaaaaaa-0000-0000-0000-000000000006'),
  ('sari', 'aaaaaaaa-0000-0000-0000-000000000009'), ('inv2', 'bbbbbbbb-0000-0000-0000-000000000002'),
  ('pay_forged', 'bbbbbbbb-0000-0000-0000-000000000001'), ('pay_cash', 'bbbbbbbb-0000-0000-0000-000000000003');
do $$
declare
  o uuid := zz.id('owner');
  org uuid := zz.id('org');
begin
  perform zz.eq('setup', 'wife joins as admin', 'val:' || org, zz.join(zz.id('wife'), zz.invite('wife', o, org, 'admin', 'Istri')));
  perform zz.eq('setup', 'staff joins as staff', 'val:' || org, zz.join(zz.id('staff'), zz.invite('staff', o, org, 'staff', 'Penjaga')));
  perform zz.eq('setup', 'property', 'ok:1', zz.att(o, format('insert into public.properties (id, org_id, name, payment_info) values (%L, %L, %L, %L)',
    zz.id('prop'), org, 'Kos Melati', 'BCA 1234567890 a.n. Pak Owner'), true));
  perform zz.eq('setup', 'room', 'ok:1', zz.att(o, format('insert into public.rooms (id, org_id, property_id, name, price_monthly) values (%L, %L, %L, %L, 1500000)',
    zz.id('room'), org, zz.id('prop'), 'A1'), true));
  perform zz.eq('setup', 'tenants', 'ok:2', zz.att(o, format('insert into public.tenants (id, org_id, property_id, full_name, nik, ktp_image_path) values (%L, %L, %L, %L, %L, %L), (%L, %L, %L, %L, null, %L)',
    zz.id('budi'), org, zz.id('prop'), 'Budi', '3201010101010001', org || '/budi.jpg',
    zz.id('sari'), org, zz.id('prop'), 'Sari (tanpa sewa)', org || '/sari.jpg'), true));
  perform zz.eq('setup', 'lease', 'ok:1', zz.att(o, format('insert into public.leases (id, org_id, property_id, room_id, tenant_id, period_type, price_per_period, deposit_amount, start_date, end_date) values (%L, %L, %L, %L, %L, %L, 1500000, 1000000, %L, %L)',
    zz.id('lease'), org, zz.id('prop'), zz.id('room'), zz.id('budi'), 'monthly', '2026-10-01', '2027-03-31'), true));
  perform zz.eq('setup', 'expense with a receipt', 'ok:1', zz.att(o, format('insert into public.expenses (org_id, property_id, category, amount, expense_date, description, receipt_path) values (%L, %L, %L, 250000, %L, %L, %L)',
    org, zz.id('prop'), 'maintenance', '2026-10-03', 'Pompa air', org || '/r1.jpg'), true));
  perform zz.eq('setup', 'invoice INV-1', 'ok:1', zz.att(o, format('insert into public.invoices (id, org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date) values (%L, %L, %L, %L, %L, %L, %L, 1500000, 1500000, %L)',
    zz.id('inv1'), org, zz.id('prop'), zz.id('lease'), 'INV-1', '2026-10-01', '2026-10-31', '2026-10-01'), true));
  perform zz.eq('setup', 'INV-1 paid by transfer', 'ok:1', zz.att(o, format('insert into public.payments (id, org_id, property_id, invoice_id, lease_id, amount, paid_at, method, kind) values (%L, %L, %L, %L, %L, 1500000, %L, %L, %L)',
    zz.id('pay1'), org, zz.id('prop'), zz.id('inv1'), zz.id('lease'), '2026-10-02', 'transfer', 'rent'), true));
  insert into storage.objects (bucket_id, name) values ('ktp', org || '/budi.jpg'), ('ktp', org || '/sari.jpg'), ('receipts', org || '/r1.jpg');
end $$;

-- C/D. Anon and a signed-up stranger (the full matrix is in 21-attacks)
do $$
declare
  x uuid := zz.id('stranger');
begin
  perform zz.chk('C-anon', 'anon reads payments', '^err:42501', zz.val(null, 'select count(*) from public.payments'));
  perform zz.chk('C-anon', 'anon calls join_with_code', '^err:42501', zz.val(null, 'select public.join_with_code(''REDTEAM01'')'));
  perform zz.eq('D-stranger', 'stranger sees tenants / payments / members', 'val:0/0/0', zz.val(x,
    'select (select count(*) from public.tenants) || ''/'' || (select count(*) from public.payments) || ''/'' || (select count(*) from public.organization_members)'));
  perform zz.eq('D-stranger', 'stranger recalc on a random id is a no-op', 'ok:1', zz.att(x, 'select public.recalc_invoice_status(gen_random_uuid())'));
  perform zz.chk('D-stranger', 'stranger recalc on the real invoice id', 'Tidak memiliki akses', zz.att(x, format('select public.recalc_invoice_status(%L)', zz.id('inv1'))));
  perform zz.chk('D-stranger', 'stranger uploads into the family folder', '^err:42501', zz.att(x, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'ktp', zz.id('org') || '/evil.jpg')));
end $$;

-- E. Staff member (insider): every attempt is kept, then we look at what is left
do $$
declare
  s uuid := zz.id('staff');
  org uuid := zz.id('org');
begin
  perform zz.eq('E-staff', 'E1 staff can read payments / expenses / tenants with NIK / invoices', 'val:1/1/1/1', zz.val(s,
    'select (select count(*) from public.payments) || ''/'' || (select count(*) from public.expenses) || ''/'' || (select count(*) from public.tenants where nik is not null) || ''/'' || (select count(*) from public.invoices)'));
  perform zz.eq('E-staff', 'E2 change bank account in payment_info (used in WA reminders)', 'ok:0', zz.att(s, 'update public.properties set payment_info = ''BCA 999999 a.n. Staff''', true));
  perform zz.eq('E-staff', 'E3 payment claiming the OWNER as author', 'ok:1', zz.att(s, format('insert into public.payments (id, org_id, property_id, lease_id, amount, paid_at, method, kind, created_by) values (%L, %L, %L, %L, 100000, %L, %L, %L, %L)',
    zz.id('pay_forged'), org, zz.id('prop'), zz.id('lease'), '2026-10-05', 'cash', 'other', zz.id('owner')), true));
  perform zz.eq('E-staff', 'E4 staff creates INV-2', 'ok:1', zz.att(s, format('insert into public.invoices (id, org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date) values (%L, %L, %L, %L, %L, %L, %L, 1500000, 1500000, %L)',
    zz.id('inv2'), org, zz.id('prop'), zz.id('lease'), 'INV-2', '2026-11-01', '2026-11-30', '2026-11-01'), true));
  perform zz.eq('E-staff', 'E4b staff records 1.500.000 cash on INV-2', 'ok:1', zz.att(s, format('insert into public.payments (id, org_id, property_id, invoice_id, lease_id, amount, paid_at, method, kind) values (%L, %L, %L, %L, %L, 1500000, %L, %L, %L)',
    zz.id('pay_cash'), org, zz.id('prop'), zz.id('inv2'), zz.id('lease'), '2026-11-01', 'cash', 'rent'), true));
  perform zz.eq('E-staff', 'E5 later lower own payment to 500.000', 'ok:0', zz.att(s, format('update public.payments set amount = 500000 where id = %L', zz.id('pay_cash')), true));
  perform zz.eq('E-staff', 'E6 re-attribute own payment to the OWNER', 'ok:0', zz.att(s, format('update public.payments set created_by = %L where id = %L', zz.id('owner'), zz.id('pay_cash')), true));
  perform zz.eq('E-staff', 'E7 edit the owner''s payment', 'ok:0', zz.att(s, format('update public.payments set amount = 1 where id = %L', zz.id('pay1')), true));
  perform zz.eq('E-staff', 'E8 delete the owner''s payment', 'ok:0', zz.att(s, format('delete from public.payments where id = %L', zz.id('pay1')), true));
  perform zz.chk('E-staff', 'E9 change lease price / deposit', 'harga atau jenis sewa', zz.att(s, format('update public.leases set price_per_period = 900000, deposit_amount = 0 where id = %L', zz.id('lease')), true));
  perform zz.chk('E-staff', 'E10 change room price', 'harga kamar', zz.att(s, format('update public.rooms set price_monthly = 1 where id = %L', zz.id('room')), true));
  perform zz.eq('E-staff', 'E11 discount INV-1 to zero', 'ok:0', zz.att(s, format('update public.invoices set discount_amount = 1500000, total_amount = 0 where id = %L', zz.id('inv1')), true));
  perform zz.eq('E-staff', 'E12 delete expenses', 'ok:0', zz.att(s, 'delete from public.expenses', true));
  perform zz.eq('E-staff-allowed', 'E13 delete a KTP photo object directly', 'ok:1', zz.att(s, 'delete from storage.objects where bucket_id = ''ktp'' and name like ''%budi.jpg''', true));
  perform zz.eq('E-staff-allowed', 'E14 delete receipt photo objects directly', 'ok:1', zz.att(s, 'delete from storage.objects where bucket_id = ''receipts''', true));
  perform zz.eq('E-staff-allowed', 'E15 delete a tenant without lease', 'ok:1', zz.att(s, format('delete from public.tenants where id = %L', zz.id('sari')), true));
  perform zz.chk('E-staff', 'E16 promote self to owner', '^err:42501', zz.att(s, format('update public.organization_members set role = ''owner'' where user_id = %L', s), true));
  perform zz.eq('E-staff', 'E17 rename the organisation', 'ok:0', zz.att(s, 'update public.organizations set name = ''pwned''', true));
  perform zz.chk('E-staff', 'E18 invite an accomplice', 'Hanya pemilik/admin', zz.att(s, format('select code from public.create_invitation(%L, %L, null)', org, 'staff'), true));
  perform zz.eq('E-staff-allowed', 'E19 cancel the lease (status only)', 'ok:1', zz.att(s, format('update public.leases set status = ''cancelled'' where id = %L', zz.id('lease'))));
  perform zz.chk('E-staff', 'E20 read the history to see what was noticed', '^val:0$', zz.val(s, 'select count(*) from public.audit_log'));
end $$;
do $$
declare
  s text := zz.id('staff')::text;
  o text := zz.id('owner')::text;
begin
  perform zz.eq('E-after', 'payment_info unchanged', 'BCA 1234567890 a.n. Pak Owner', (select payment_info from public.properties));
  perform zz.eq('E-after', 'payments with their real authors', '100000 by staff; 1500000 by owner; 1500000 by staff',
    (select string_agg(amount || ' by ' || case created_by::text when s then 'staff' when o then 'owner' else coalesce(created_by::text, 'null') end, '; ' order by amount, created_by::text = s)
       from public.payments));
  perform zz.eq('E-after', 'INV-1 total and status unchanged', '1500000 paid', (select total_amount || ' ' || status from public.invoices where id = zz.id('inv1')));
  perform zz.eq('E-after', 'INV-2 paid', 'paid', (select status from public.invoices where id = zz.id('inv2')));
  perform zz.eq('E-after', 'lease price and deposit unchanged', '1500000/1000000', (select price_per_period || '/' || deposit_amount from public.leases));
  perform zz.eq('E-after', 'storage objects left (Sari''s photo stays until the app deletes it)', 'ktp:' || zz.id('org') || '/sari.jpg',
    (select string_agg(bucket_id || ':' || name, ', ') from storage.objects));
  perform zz.ok('E-after', 'the history shows each thing staff did', (
    select count(*) = 4 from public.audit_log where changed_by = zz.id('staff') and (table_name, action) in
      (values ('payments', 'insert'), ('invoices', 'insert'), ('tenants', 'delete'))));
end $$;

-- F. Admin (wife)
do $$
declare
  a uuid := zz.id('wife');
  org uuid := zz.id('org');
begin
  perform zz.eq('F-admin', 'F1 admin deletes a payment', 'ok:1', zz.att(a, format('delete from public.payments where id = %L', zz.id('pay1'))));
  perform zz.chk('F-admin', 'F2 admin changes own role directly', '^err:42501', zz.att(a, format('update public.organization_members set role = ''owner'' where user_id = %L', a)));
  perform zz.chk('F-admin', 'F3 admin removes the owner', 'Hanya pemilik yang dapat menghapus pemilik lain', zz.att(a, format('select public.remove_member(%L, %L)', org, zz.id('owner'))));
  perform zz.chk('F-admin', 'F4 admin makes a code for a second admin', '^val:[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$', zz.val(a, format('select code from public.create_invitation(%L, %L, %L)', org, 'admin', 'Adik')));
  -- kept: a way back in after being removed (G1)
  perform zz.invite('backdoor', a, org, 'admin', 'Cadangan');
  perform zz.invite('backdoor2', a, org, 'staff', 'Cadangan 2');
end $$;

-- G. Owner account taken over: how much can be wiped through the API, and what the history keeps
do $$
declare
  o uuid := zz.id('owner');
  org uuid := zz.id('org');
begin
  perform zz.eq('G-takeover', 'G1 remove wife', 'ok:1', zz.att(o, format('select public.remove_member(%L, %L)', org, zz.id('wife')), true));
  perform zz.eq('G-takeover', 'G1a the removed admin re-joins with a code she made -> null', 'val:NULL', zz.join(zz.id('wife'), zz.code('backdoor')));
  perform zz.eq('G-takeover', 'G1b ... or has a new account join with her other code -> null', 'val:NULL', zz.join(zz.id('stranger'), zz.code('backdoor2')));
  perform zz.eq('G-takeover', 'G1c neither is a member', '0', (select count(*)::text from public.organization_members where user_id in (zz.id('wife'), zz.id('stranger'))));
  perform zz.eq('G-takeover', 'G2 delete payments', 'ok:3', zz.att(o, 'delete from public.payments', true));
  perform zz.eq('G-takeover', 'G3 delete expenses', 'ok:1', zz.att(o, 'delete from public.expenses', true));
  perform zz.eq('G-takeover', 'G4 delete invoices', 'ok:2', zz.att(o, 'delete from public.invoices', true));
  perform zz.eq('G-takeover', 'G5 delete leases', 'ok:1', zz.att(o, 'delete from public.leases', true));
  perform zz.eq('G-takeover', 'G6 delete tenants', 'ok:1', zz.att(o, 'delete from public.tenants', true));
  perform zz.eq('G-takeover', 'G7 delete rooms', 'ok:1', zz.att(o, 'delete from public.rooms', true));
  perform zz.eq('G-takeover', 'G8 delete properties', 'ok:1', zz.att(o, 'delete from public.properties', true));
  perform zz.chk('G-takeover', 'G9 delete the organisation', '^err:42501', zz.att(o, 'delete from public.organizations', true));
  perform zz.chk('G-takeover', 'G10 delete the history', '^err:42501', zz.att(o, 'delete from public.audit_log', true));
  perform zz.chk('G-takeover', 'G11 rewrite the history', '^err:42501', zz.att(o, 'update public.audit_log set old_data = null', true));
  perform zz.chk('G-takeover', 'G12 truncate the history', '^err:42501', zz.att(o, 'truncate public.audit_log', true));
  perform zz.chk('G-takeover', 'G13 add fake history', '^err:42501', zz.att(o, format('insert into public.audit_log (org_id, table_name, action) values (%L, %L, %L)', org, 'payments', 'insert'), true));
end $$;
do $$
declare
  org uuid := zz.id('org');
begin
  perform zz.eq('G-after', 'business rows left', '0/0/0/0/0', (select (select count(*) from public.payments) || '/' || (select count(*) from public.invoices) || '/' ||
    (select count(*) from public.leases) || '/' || (select count(*) from public.tenants) || '/' || (select count(*) from public.properties)));
  perform zz.eq('G-after', 'the organisation and its owner remain', '1/1', (select (select count(*) from public.organizations) || '/' ||
    (select count(*) from public.organization_members where role = 'owner')));
  perform zz.eq('G-after', 'every wiped row is in the history, deleted by the owner account', '10',
    (select count(*)::text from public.audit_log where action = 'delete' and changed_by = zz.id('owner') and table_name <> 'organization_members'));
  -- each delete record holds the row exactly as it was last written, so everything can be restored
  perform zz.ok('G-after', 'every deleted row can be restored from the history', not exists (
    select 1 from public.audit_log d
     where d.org_id = org and d.action = 'delete'
       and d.old_data is distinct from (select p.new_data from public.audit_log p
                                         where p.org_id = d.org_id and p.table_name = d.table_name and p.row_id = d.row_id
                                           and p.action in ('insert', 'update') and p.changed_at <= d.changed_at
                                         order by p.changed_at desc limit 1)));
  perform zz.ok('G-after', 'the history still has the original payments', (
    select count(*) = 3 from public.audit_log where table_name = 'payments' and action = 'delete' and old_data ? 'amount'));
  perform zz.ok('G-after', 'removing the wife is recorded', exists (select 1 from public.audit_log where table_name = 'organization_members'
    and action = 'delete' and old_data ->> 'user_id' = zz.id('wife')::text and changed_by = zz.id('owner')));
end $$;

-- H. A change history exists (there was none in v0.2)
select zz.ok('H-audit', 'audit_log exists and covers this organisation', (select count(*) > 20 from public.audit_log where org_id = zz.id('org')));
