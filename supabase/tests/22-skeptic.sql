-- Skeptic scenarios: the first-signup race, invitation hijack by email, and what staff/admin/owner can
-- do to money records, played out in order with the results kept.
\set ON_ERROR_STOP on
select set_config('zz.suite', '22-skeptic', false);
select zz.reset_data();

-- A. A stranger who found the URL signs up before the owner (email not even confirmed)
insert into auth.users (id, email, email_confirmed_at) values ('aaaaaaaa-0000-0000-0000-000000000001', 'attacker@evil.test', null);
insert into zz.ids values ('attacker', 'aaaaaaaa-0000-0000-0000-000000000001');
select zz.user('owner', '11111111-0000-0000-0000-000000000001', 'owner@family.test');
do $$ begin
  perform zz.eq('A-first-signup', 'attacker who signed up first has no role', '0', (select count(*)::text from public.organization_members where user_id = zz.id('attacker')));
  perform zz.eq('A-first-signup', 'no organisation was created', '0', (select count(*)::text from public.organizations));
  perform zz.eq('A-first-signup', 'attacker guessing a setup code -> null', 'val:NULL', zz.join(zz.id('attacker'), 'KOSSAYA1'));
end $$;
select zz.su('select public.set_setup_code(''FAMI-LY26'')', true);
do $$ begin
  perform zz.chk('A-first-signup', 'real owner enters the setup code', '^val:[0-9a-f-]{36}$', zz.join(zz.id('owner'), 'FAMI-LY26'));
  perform zz.eq('A-first-signup', 'real owner is owner', 'owner', (select role from public.organization_members where user_id = zz.id('owner')));
  perform zz.eq('A-first-signup', 'attacker with the same code afterwards -> null', 'val:NULL', zz.join(zz.id('attacker'), 'FAMI-LY26'));
  perform zz.chk('A-first-signup', 'attacker is still not a member', '^err:WB001', zz.val(zz.id('attacker'), 'select public.ensure_membership()'));
end $$;
insert into zz.ids select 'org', id from public.organizations;

-- B. Owner makes codes for wife (admin) and staff; an attacker registers WIFE@ before her
select zz.invite('wife', zz.id('owner'), zz.id('org'), 'admin', 'Istri');
select zz.invite('staff', zz.id('owner'), zz.id('org'), 'staff', 'Penjaga');
insert into auth.users (id, email, email_confirmed_at) values ('99999999-0000-0000-0000-000000000009', 'WIFE@family.test', null);
insert into zz.ids values ('hijacker', '99999999-0000-0000-0000-000000000009');
select zz.user('wife', '22222222-0000-0000-0000-000000000002', 'wife@family.test');
select zz.user('staff', '33333333-0000-0000-0000-000000000003', 'staff@family.test');
select zz.user('x', '44444444-0000-0000-0000-000000000004', 'x@evil.test');
do $$ begin
  perform zz.eq('B-invite-hijack', 'attacker signed up with the wife''s email: no role', '0', (select count(*)::text from public.organization_members where user_id = zz.id('hijacker')));
  perform zz.chk('B-invite-hijack', '... ensure_membership asks for a code', '^err:WB001', zz.val(zz.id('hijacker'), 'select public.ensure_membership()'));
  perform zz.eq('B-invite-hijack', 'real wife joins with her code', 'val:' || zz.id('org'), zz.join(zz.id('wife'), zz.code('wife')));
  perform zz.eq('B-invite-hijack', 'real wife is admin', 'admin', (select role from public.organization_members where user_id = zz.id('wife')));
  perform zz.eq('B-invite-hijack', 'staff joins', 'val:' || zz.id('org'), zz.join(zz.id('staff'), zz.code('staff')));
  perform zz.eq('B-invite-hijack', 'another stranger signing up creates no organisation', '1', (select count(*)::text from public.organizations));
end $$;

-- seed data as owner
do $$
declare
  o uuid := zz.id('owner');
  org uuid := zz.id('org');
begin
  perform zz.eq('seed', 'property', 'ok:1', zz.att(o, format('insert into public.properties (id, org_id, name, payment_info) values (%L, %L, %L, %L)',
    'b0000000-0000-0000-0000-000000000001', org, 'Kos A', 'BCA 123 a.n. Owner'), true));
  perform zz.eq('seed', 'room', 'ok:1', zz.att(o, format('insert into public.rooms (id, org_id, property_id, name, price_monthly) values (%L, %L, %L, %L, 1500000)',
    'c0000000-0000-0000-0000-000000000001', org, 'b0000000-0000-0000-0000-000000000001', 'R1'), true));
  perform zz.eq('seed', 'tenant', 'ok:1', zz.att(o, format('insert into public.tenants (id, org_id, full_name, nik) values (%L, %L, %L, %L)',
    'd0000000-0000-0000-0000-000000000001', org, 'Budi', '3201'), true));
  perform zz.eq('seed', 'lease', 'ok:1', zz.att(o, format('insert into public.leases (id, org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date) values (%L, %L, %L, %L, %L, %L, 1500000, %L, %L)',
    'e0000000-0000-0000-0000-000000000001', org, 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'monthly', '2026-10-01', '2027-09-30'), true));
  perform zz.eq('seed', 'invoice', 'ok:1', zz.att(o, format('insert into public.invoices (id, org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date) values (%L, %L, %L, %L, %L, %L, %L, 1500000, 1500000, %L)',
    'f0000000-0000-0000-0000-000000000001', org, 'b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'INV-1', '2026-10-01', '2026-10-31', '2026-10-05'), true));
end $$;

-- C. Staff and the money
do $$
declare
  s uuid := zz.id('staff');
begin
  perform zz.eq('C-staff', 'staff role', 'staff', (select role from public.organization_members where user_id = s));
  perform zz.eq('C-staff', 'staff edits payment_info -> 0 rows', 'ok:0', zz.att(s, 'update public.properties set payment_info = ''BCA 999 a.n. Staff''', true));
  perform zz.chk('C-staff', 'staff edits lease price -> refused', 'harga atau jenis sewa', zz.att(s, 'update public.leases set price_per_period = 1', true));
  perform zz.eq('C-staff', 'staff records the rent', 'ok:1', zz.att(s, format('insert into public.payments (id, org_id, property_id, invoice_id, lease_id, amount, paid_at, method, kind) values (%L, %L, %L, %L, %L, 1500000, %L, %L, %L)',
    'a1000000-0000-0000-0000-000000000001', zz.id('org'), 'b0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', '2026-10-02', 'cash', 'rent'), true));
  perform zz.eq('C-staff', 'invoice status after staff payment', 'paid', (select status from public.invoices));
  perform zz.eq('C-staff', 'staff lowers own payment and reattributes it to the owner -> 0 rows', 'ok:0',
    zz.att(s, format('update public.payments set amount = 500000, created_by = %L', zz.id('owner')), true));
  perform zz.eq('C-staff', 'invoice still paid', 'paid', (select status from public.invoices));
  perform zz.eq('C-staff', 'payment still 1500000, by staff', '1500000:' || s, (select amount || ':' || created_by from public.payments));
  perform zz.eq('C-staff', 'staff deletes the payment -> 0 rows', 'ok:0', zz.att(s, 'delete from public.payments', true));
  perform zz.eq('C-staff', 'staff voids the invoice -> 0 rows', 'ok:0', zz.att(s, 'update public.invoices set status = ''void''', true));
end $$;

-- D. Admin (the real wife) vs owner
do $$
declare
  a uuid := zz.id('wife');
begin
  perform zz.chk('D-admin', 'admin self-promotes by UPDATE -> refused', '^err:42501', zz.att(a, format('update public.organization_members set role = ''owner'' where user_id = %L', a), true));
  perform zz.chk('D-admin', 'admin self-promotes by RPC -> refused', 'Hanya pemilik', zz.att(a, format('select public.set_member_role(%L, %L, %L)', zz.id('org'), a, 'owner'), true));
  perform zz.eq('D-admin', 'admin deletes the payment', 'ok:1', zz.att(a, 'delete from public.payments', true));
  perform zz.eq('D-admin', 'invoice status after admin delete', 'unpaid', (select status from public.invoices));
  perform zz.ok('D-admin', 'the history keeps the deleted payment: amount, who recorded it, who deleted it', exists (
    select 1 from public.audit_log where table_name = 'payments' and action = 'delete' and changed_by = a
       and old_data ->> 'amount' = '1500000' and old_data ->> 'created_by' = zz.id('staff')::text));
end $$;

-- E. Owner self-demotion
do $$
declare
  o uuid := zz.id('owner');
begin
  perform zz.chk('E-owner', 'sole owner demotes self by UPDATE -> refused', '^err:42501', zz.att(o, format('update public.organization_members set role = ''staff'' where user_id = %L', o), true));
  perform zz.chk('E-owner', 'sole owner demotes self by RPC -> refused', 'pemilik terakhir', zz.att(o, format('select public.set_member_role(%L, %L, %L)', zz.id('org'), o, 'staff'), true));
  perform zz.eq('E-owner', 'owners left', '1', (select count(*)::text from public.organization_members where role = 'owner'));
end $$;

-- F/G. anon and strangers
do $$ begin
  perform zz.chk('F-anon', 'anon reads tenants', '^err:42501', zz.val(null, 'select count(*) from public.tenants'));
  perform zz.eq('G-stranger', 'stranger sees tenants', 'val:0', zz.val(zz.id('x'), 'select count(*) from public.tenants'));
  perform zz.eq('G-stranger', 'hijacker sees tenants', 'val:0', zz.val(zz.id('hijacker'), 'select count(*) from public.tenants'));
end $$;
