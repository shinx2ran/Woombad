-- Biaya tambahan (SPEC 7.31): invoices.invoice_type is 'rent' (every invoice before 7.31) or 'charge', a one-off amount on
-- a lease (late check-out, damage, cleaning, a guest staying over) billed on one day. invoices_invoice_type_check keeps the
-- list closed; invoices_charge_shape_check keeps a charge an amount on a day (no rent, no add-ons, quantity 1, no period
-- type, extra_amount > 0). A charge is paid like any invoice, by a kind 'rent' payment on it (cash, transfer, QRIS, or
-- method 'deposit' = potong jaminan), so the existing status triggers settle it; any member adds and pays one, only
-- owners/admins change, void or delete it. It is not a lease change: no lease row moves and the overlap guard is not involved.
-- Section B rehearses the live upgrade: a 7.30 installation (no column yet) with invoices of every shape, then schema.sql.
-- Member writes are the requests the app sends (zz.att = one API call).
\set ON_ERROR_STOP on
select set_config('zz.suite', '32-biaya-tambahan', false);
select zz.reset_data();

-- the column and its two checks, each exactly once (a re-run of schema.sql adds no copy) and validated against every row
create or replace function zz.bt_structure(p_grp text) returns void language plpgsql as $$
begin
  perform zz.eq(p_grp, 'invoices.invoice_type: text, not null, default rent', 'invoice_type:text:true:''rent''::text',
    (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), 'no default'), ',')
       from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = 'public.invoices'::regclass and a.attname = 'invoice_type' and not a.attisdropped));
  perform zz.eq(p_grp, 'exactly the two named checks read invoice_type, both validated',
    'invoices_charge_shape_check:CHECK (((invoice_type = ''rent''::text) OR ((base_amount = 0) AND (addons_amount = 0) AND (quantity = 1) AND (period_type IS NULL) AND (period_end = period_start) AND (extra_amount > 0) AND (total_amount > 0)))):true'
    || '|invoices_invoice_type_check:CHECK ((invoice_type = ANY (ARRAY[''rent''::text, ''charge''::text]))):true',
    (select string_agg(conname || ':' || pg_get_constraintdef(oid) || ':' || convalidated, '|' order by conname)
       from pg_constraint where conrelid = 'public.invoices'::regclass and pg_get_constraintdef(oid) like '%invoice_type%'));
end $$;

-- A. as this scenario left it: fresh = schema.sql once, twice = three times, upgrade = v0.2 then once
select zz.bt_structure('A-structure');

select zz.user('owner', '11111111-3232-0000-0000-000000000001', 'owner@charge.test');
select zz.user('wife', '22222222-3232-0000-0000-000000000002', 'wife@charge.test');
select zz.user('staff', '33333333-3232-0000-0000-000000000003', 'staff@charge.test');
select zz.user('o2owner', '44444444-3232-0000-0000-000000000004', 'other@charge.test');
select zz.user('stranger', '55555555-3232-0000-0000-000000000005', 'stranger@charge.test');
select zz.su('select public.set_setup_code(''CHARGE-32'')', true);
select zz.join(zz.id('owner'), 'charge32');
insert into zz.ids select 'org', id from public.organizations;
insert into zz.ids values
  ('prop', 'c3200000-0000-0000-0000-000000000001'), ('room', 'c3200000-0000-0000-0000-000000000002'),
  ('room_b', 'c3200000-0000-0000-0000-000000000003'), ('tenant', 'c3200000-0000-0000-0000-000000000004'),
  ('tenant_next', 'c3200000-0000-0000-0000-000000000005'), ('lease', 'c3200000-0000-0000-0000-000000000006'),
  ('lease_ended', 'c3200000-0000-0000-0000-000000000007'), ('lease_next', 'c3200000-0000-0000-0000-000000000008'),
  ('r_paid', 'c3200000-0000-0000-0000-000000000011'), ('r_partial', 'c3200000-0000-0000-0000-000000000012'),
  ('r_oneday', 'c3200000-0000-0000-0000-000000000013'), ('r_void', 'c3200000-0000-0000-0000-000000000014'),
  ('r_free', 'c3200000-0000-0000-0000-000000000015'),
  ('c_cash', 'c3200000-0000-0000-0000-000000000021'), ('c_split', 'c3200000-0000-0000-0000-000000000022'),
  ('c_deposit', 'c3200000-0000-0000-0000-000000000023'), ('c_later', 'c3200000-0000-0000-0000-000000000024'),
  ('c_late', 'c3200000-0000-0000-0000-000000000025'), ('c_next', 'c3200000-0000-0000-0000-000000000026'),
  ('c_ended', 'c3200000-0000-0000-0000-000000000027'),
  ('org2', 'f3200000-0000-0000-0000-000000000091'), ('prop2', 'f3200000-0000-0000-0000-000000000092'),
  ('room2', 'f3200000-0000-0000-0000-000000000093'), ('tenant2', 'f3200000-0000-0000-0000-000000000094'),
  ('lease2', 'f3200000-0000-0000-0000-000000000095'), ('c_org2', 'f3200000-0000-0000-0000-000000000096');

-- the kos's day in WIB (as leases_overlap_guard counts it), shifted
create or replace function zz.bt_day(p_offset int) returns date language sql stable as $$
  select (now() at time zone 'Asia/Jakarta')::date + p_offset;
$$;

-- the invoice insert the app sends (SupabaseRepo.insert: the row, returning *); number INV-YYYYMM-NNNN of the first day
create or replace function zz.bt_inv(p_org uuid, p_prop uuid, p_lease uuid, p_seq int, p_type text, p_period_type text,
  p_start date, p_end date, p_qty int, p_base bigint, p_addons bigint, p_extra bigint, p_discount bigint, p_notes text,
  p_key text default null) returns text language sql as $$
  select format('insert into public.invoices (id, org_id, property_id, lease_id, invoice_number, invoice_type, period_type, period_start, period_end, quantity, base_amount, addons_amount, extra_amount, discount_amount, total_amount, due_date, notes) values (%L, %L, %L, %L, %L, %L, %L, %L, %L, %s, %s, %s, %s, %s, %s, %L, %L) returning *',
    case when p_key is null then gen_random_uuid() else zz.id(p_key) end, p_org, p_prop, p_lease,
    'INV-' || to_char(p_start, 'YYYYMM') || '-' || lpad(p_seq::text, 4, '0'), p_type, p_period_type, p_start, p_end,
    p_qty, p_base, p_addons, p_extra, p_discount, p_base + p_addons + p_extra - p_discount, p_start, p_notes);
$$;

-- a well-formed charge on one of our leases, as the "Biaya tambahan" dialog saves it
create or replace function zz.bt_charge(p_lease text, p_seq int, p_day date, p_amount bigint, p_notes text, p_key text default null)
returns text language sql as $$
  select zz.bt_inv(zz.id('org'), zz.id('prop'), zz.id(p_lease), p_seq, 'charge', null, p_day, p_day, 1, 0, 0, p_amount, 0, p_notes, p_key);
$$;

-- the invoice insert of the app before 7.31: no invoice_type in the row
create or replace function zz.bt_old_inv(p_key text, p_lease text, p_seq int, p_period_type text, p_start date, p_end date,
  p_qty int, p_base bigint, p_addons bigint, p_extra bigint, p_discount bigint) returns text language sql as $$
  select format('insert into public.invoices (id, org_id, property_id, lease_id, invoice_number, period_type, period_start, period_end, quantity, base_amount, addons_amount, extra_amount, discount_amount, total_amount, due_date) values (%L, %L, %L, %L, %L, %L, %L, %L, %s, %s, %s, %s, %s, %s, %L) returning *',
    case when p_key is null then gen_random_uuid() else zz.id(p_key) end, zz.id('org'), zz.id('prop'), zz.id(p_lease),
    'INV-' || to_char(p_start, 'YYYYMM') || '-' || lpad(p_seq::text, 4, '0'), p_period_type, p_start, p_end,
    p_qty, p_base, p_addons, p_extra, p_discount, p_base + p_addons + p_extra - p_discount, p_start);
$$;

-- the payment the app sends with a charge (or later from the invoice list): on the invoice, paid today
create or replace function zz.bt_pay(p_org uuid, p_prop uuid, p_invoice uuid, p_lease uuid, p_amount bigint, p_method text,
  p_kind text default 'rent') returns text language sql as $$
  select format('insert into public.payments (org_id, property_id, invoice_id, lease_id, amount, paid_at, method, kind, notes) values (%L, %L, %L, %L, %s, %L, %L, %L, %L) returning *',
    p_org, p_prop, p_invoice, p_lease, p_amount, zz.bt_day(0), p_method, p_kind, 'Biaya tambahan');
$$;

create or replace function zz.bt_pay1(p_invoice text, p_lease text, p_amount bigint, p_method text, p_kind text default 'rent')
returns text language sql as $$
  select zz.bt_pay(zz.id('org'), zz.id('prop'), zz.id(p_invoice), zz.id(p_lease), p_amount, p_method, p_kind);
$$;

create or replace function zz.bt_status(p_key text) returns text language sql stable as $$
  select status from public.invoices where id = zz.id(p_key);
$$;

-- organisation 1, through the API: a kos, two rooms, a current lease (deposit held) and an ended one
do $$
declare
  o uuid := zz.id('owner');
  org uuid := zz.id('org');
begin
  perform zz.eq('setup', 'wife joins as admin', 'val:' || org, zz.join(zz.id('wife'), zz.invite('wife', o, org, 'admin', 'Istri')));
  perform zz.eq('setup', 'staff joins as staff', 'val:' || org, zz.join(zz.id('staff'), zz.invite('staff', o, org, 'staff', 'Penjaga')));
  perform zz.eq('setup', 'kos', 'ok:1', zz.att(o, format('insert into public.properties (id, org_id, name) values (%L, %L, %L)',
    zz.id('prop'), org, 'Kos Mawar'), true));
  perform zz.eq('setup', 'rooms', 'ok:2', zz.att(o, format('insert into public.rooms (id, org_id, property_id, name, price_monthly) values (%L, %L, %L, %L, 1500000), (%L, %L, %L, %L, 1500000)',
    zz.id('room'), org, zz.id('prop'), 'A1', zz.id('room_b'), org, zz.id('prop'), 'B1'), true));
  perform zz.eq('setup', 'tenants', 'ok:2', zz.att(o, format('insert into public.tenants (id, org_id, property_id, full_name) values (%L, %L, %L, %L), (%L, %L, %L, %L)',
    zz.id('tenant'), org, zz.id('prop'), 'Budi', zz.id('tenant_next'), org, zz.id('prop'), 'Sari'), true));
  -- Budi in A1: last night 9 days from today
  perform zz.eq('setup', 'current lease', 'ok:1', zz.att(o, format('insert into public.leases (id, org_id, property_id, room_id, tenant_id, period_type, price_per_period, deposit_amount, start_date, end_date) values (%L, %L, %L, %L, %L, %L, 1500000, 1000000, %L, %L)',
    zz.id('lease'), org, zz.id('prop'), zz.id('room'), zz.id('tenant'), 'monthly', zz.bt_day(-20), zz.bt_day(9)), true));
  perform zz.eq('setup', 'ended lease (B1, August)', 'ok:1', zz.att(o, format('insert into public.leases (id, org_id, property_id, room_id, tenant_id, period_type, price_per_period, deposit_amount, start_date, end_date, status, checkout_date) values (%L, %L, %L, %L, %L, %L, 1500000, 500000, %L, %L, %L, %L)',
    zz.id('lease_ended'), org, zz.id('prop'), zz.id('room_b'), zz.id('tenant_next'), 'monthly', '2026-08-01', '2026-08-31', 'ended', '2026-09-01'), true));
  perform zz.eq('setup', 'staff records the deposit held for the current lease', 'ok:1', zz.att(zz.id('staff'), format(
    'insert into public.payments (org_id, property_id, lease_id, amount, paid_at, method, kind) values (%L, %L, %L, 1000000, %L, %L, %L)',
    org, zz.id('prop'), zz.id('lease'), zz.bt_day(-20), 'cash', 'deposit'), true));
end $$;

-- another family on the same project (operator)
insert into public.organizations (id, name, created_by) values (zz.id('org2'), 'Org Dua', zz.id('o2owner'));
insert into public.organization_members (org_id, user_id, email, role) values (zz.id('org2'), zz.id('o2owner'), 'other@charge.test', 'owner');
insert into public.properties (id, org_id, name) values (zz.id('prop2'), zz.id('org2'), 'Kos Dua');
insert into public.rooms (id, org_id, property_id, name, price_monthly) values (zz.id('room2'), zz.id('org2'), zz.id('prop2'), 'X1', 1000000);
insert into public.tenants (id, org_id, property_id, full_name) values (zz.id('tenant2'), zz.id('org2'), zz.id('prop2'), 'Org2 tenant');
insert into public.leases (id, org_id, property_id, room_id, tenant_id, period_type, price_per_period, deposit_amount, start_date, end_date)
values (zz.id('lease2'), zz.id('org2'), zz.id('prop2'), zz.id('room2'), zz.id('tenant2'), 'monthly', 1000000, 500000, zz.bt_day(-5), zz.bt_day(24));

-- B. upgrade: the invoices a 7.30 installation holds, written by the app of then (no invoice_type)
do $$
declare
  o uuid := zz.id('owner');
  s uuid := zz.id('staff');
begin
  perform zz.eq('B-upgrade', 'old invoice: a paid month', 'ok:1', zz.att(o, zz.bt_old_inv('r_paid', 'lease_ended', 1, 'monthly', '2026-08-01', '2026-08-31', 1, 1500000, 0, 0, 0), true));
  perform zz.eq('B-upgrade', 'old invoice: three nights with add-ons and a discount, part paid', 'ok:1', zz.att(o, zz.bt_old_inv('r_partial', 'lease_ended', 2, 'daily', '2026-08-01', '2026-08-03', 3, 300000, 30000, 0, 10000), true));
  perform zz.eq('B-upgrade', 'old invoice: one day, no period type, the amount in extra (a charge''s shape)', 'ok:1', zz.att(o, zz.bt_old_inv('r_oneday', 'lease_ended', 3, null, '2026-08-15', '2026-08-15', 1, 0, 0, 50000, 0), true));
  perform zz.eq('B-upgrade', 'old invoice: to be voided', 'ok:1', zz.att(o, zz.bt_old_inv('r_void', 'lease_ended', 4, 'monthly', '2026-09-01', '2026-09-30', 1, 1500000, 0, 0, 0), true));
  perform zz.eq('B-upgrade', 'old invoice: a free month (total 0)', 'ok:1', zz.att(o, zz.bt_old_inv('r_free', 'lease_ended', 5, 'monthly', '2026-07-01', '2026-07-31', 1, 1500000, 0, 0, 1500000), true));
  perform zz.eq('B-upgrade', 'staff pays the month', 'ok:1', zz.att(s, zz.bt_pay1('r_paid', 'lease_ended', 1500000, 'cash'), true));
  perform zz.eq('B-upgrade', 'staff pays part of the nights', 'ok:1', zz.att(s, zz.bt_pay1('r_partial', 'lease_ended', 100000, 'transfer'), true));
  perform zz.eq('B-upgrade', 'the owner voids one', 'ok:1', zz.att(o, format('update public.invoices set status = %L where id = %L', 'void', zz.id('r_void')), true));
  perform zz.eq('B-upgrade', 'statuses before the upgrade', 'free:paid,oneday:unpaid,paid:paid,partial:partial,void:void',
    (select string_agg(substr(k.k, 3) || ':' || i.status, ',' order by k.k) from public.invoices i join zz.ids k on k.v = i.id));
end $$;

-- The live project before 7.31 is these rows without the column. This is a throwaway test database: dropping the column
-- here stands in for an installation that never had it (its two checks go with it).
alter table public.invoices drop column invoice_type;
select zz.ok('B-upgrade', 'a 7.30 installation: no invoice_type, no check reads it',
  not exists (select 1 from pg_attribute where attrelid = 'public.invoices'::regclass and attname = 'invoice_type' and not attisdropped)
  and not exists (select 1 from pg_constraint where conrelid = 'public.invoices'::regclass and pg_get_constraintdef(oid) like '%invoice_type%'));
drop table if exists zz.bt_snap, zz.bt_audit_n;
create table zz.bt_snap as select i.id, to_jsonb(i) as j from public.invoices i;
create table zz.bt_audit_n as select count(*) as n from public.audit_log;

\ir ../schema.sql

select zz.bt_structure('B-upgrade-structure');
do $$
declare s uuid := zz.id('staff');
begin
  perform zz.eq('B-upgrade', 'every old invoice is rent', 'rent:5', (select string_agg(distinct invoice_type, ',') || ':' || count(*) from public.invoices));
  perform zz.eq('B-upgrade', 'the old one-day invoice in a charge''s shape stays rent', 'rent', (select invoice_type from public.invoices where id = zz.id('r_oneday')));
  perform zz.eq('B-upgrade', 'nothing else changed on them (amounts, dates, status, updated_at)', '5|0',
    (select count(*) || '|' || count(*) filter (where (to_jsonb(i) - 'invoice_type') is distinct from s.j)
       from zz.bt_snap s join public.invoices i on i.id = s.id));
  perform zz.eq('B-upgrade', 'the upgrade writes no history', (select n from zz.bt_audit_n)::text, (select count(*) from public.audit_log)::text);
  perform zz.eq('B-upgrade', 'old invoices still take payments: staff settles the nights', 'ok:1', zz.att(s, zz.bt_pay1('r_partial', 'lease_ended', 220000, 'cash'), true));
  perform zz.eq('B-upgrade', '... paid by the trigger', 'paid', zz.bt_status('r_partial'));
  perform zz.eq('B-upgrade', 'the app before 7.31 (no invoice_type in its insert) still writes rent', 'val:rent', zz.val(s,
    replace(zz.bt_old_inv(null, 'lease', 6, 'monthly', zz.bt_day(10), zz.bt_day(39), 1, 1500000, 0, 0, 0), 'returning *', 'returning invoice_type')));
end $$;
drop table zz.bt_snap, zz.bt_audit_n;

-- what the leases and the history hold before any charge exists (section G compares)
drop table if exists zz.bt_leases, zz.bt_audit_ids;
create table zz.bt_leases as select l.id, to_jsonb(l) as j from public.leases l;
create table zz.bt_audit_ids as select id from public.audit_log;

-- C. the checks bind every writer (staff through the API, the owner, the operator); each attempt is rolled back
do $$
declare
  o uuid := zz.id('owner');
  s uuid := zz.id('staff');
  org uuid := zz.id('org');
  prop uuid := zz.id('prop');
  l uuid := zz.id('lease');
  d date := zz.bt_day(0);
  shape text := '^err:23514:.*"invoices_charge_shape_check"';
begin
  perform zz.eq('C-checks', 'a well-formed charge passes (control)', 'ok:1', zz.att(s, zz.bt_charge('lease', 90, d, 150000, 'Late checkout')));
  perform zz.chk('C-checks', 'type foo -> refused', '^err:23514:.*"invoices_invoice_type_check"', zz.att(s, zz.bt_inv(org, prop, l, 90, 'foo', null, d, d, 1, 0, 0, 150000, 0, 'x')));
  perform zz.chk('C-checks', 'type CHARGE (other case) -> refused', '^err:23514:.*"invoices_invoice_type_check"', zz.att(s, zz.bt_inv(org, prop, l, 90, 'CHARGE', null, d, d, 1, 0, 0, 150000, 0, 'x')));
  perform zz.chk('C-checks', 'no type (null) -> refused', '^err:23502:.*"invoice_type"', zz.att(s, zz.bt_inv(org, prop, l, 90, null, null, d, d, 1, 0, 0, 150000, 0, 'x')));
  perform zz.chk('C-checks', 'a charge with rent (base_amount > 0) -> refused', shape, zz.att(s, zz.bt_inv(org, prop, l, 90, 'charge', null, d, d, 1, 100000, 0, 150000, 0, 'x')));
  perform zz.chk('C-checks', 'a charge with add-ons -> refused', shape, zz.att(s, zz.bt_inv(org, prop, l, 90, 'charge', null, d, d, 1, 0, 20000, 150000, 0, 'x')));
  perform zz.chk('C-checks', 'a charge of quantity 2 -> refused', shape, zz.att(s, zz.bt_inv(org, prop, l, 90, 'charge', null, d, d, 2, 0, 0, 150000, 0, 'x')));
  perform zz.chk('C-checks', 'a charge with a period type (daily) -> refused', shape, zz.att(s, zz.bt_inv(org, prop, l, 90, 'charge', 'daily', d, d, 1, 0, 0, 150000, 0, 'x')));
  perform zz.chk('C-checks', 'a charge with a period type (monthly) -> refused', shape, zz.att(s, zz.bt_inv(org, prop, l, 90, 'charge', 'monthly', d, d, 1, 0, 0, 150000, 0, 'x')));
  perform zz.chk('C-checks', 'a charge over two days (period_end > period_start) -> refused', shape, zz.att(s, zz.bt_inv(org, prop, l, 90, 'charge', null, d, d + 1, 1, 0, 0, 150000, 0, 'x')));
  perform zz.chk('C-checks', 'a charge of 0 (extra_amount 0) -> refused', shape, zz.att(s, zz.bt_inv(org, prop, l, 90, 'charge', null, d, d, 1, 0, 0, 0, 0, 'x')));
  perform zz.chk('C-checks', 'a charge discounted to 0 (paid without a payment) -> refused', shape, zz.att(s, zz.bt_inv(org, prop, l, 90, 'charge', null, d, d, 1, 0, 0, 150000, 150000, 'x')));
  perform zz.chk('C-checks', 'the owner is held to the shape too', shape, zz.att(o, zz.bt_inv(org, prop, l, 90, 'charge', null, d, d, 1, 100000, 0, 150000, 0, 'x')));
  perform zz.chk('C-checks', 'so is the operator (SQL editor)', shape, zz.su(zz.bt_inv(org, prop, l, 90, 'charge', null, d, d, 2, 0, 0, 150000, 0, 'x')));
  perform zz.eq('C-checks', 'the shape does not bind rent: a one-day rent invoice without a period type passes', 'ok:1',
    zz.att(s, zz.bt_inv(org, prop, l, 90, 'rent', null, d, d, 1, 0, 0, 150000, 0, null)));
  perform zz.eq('C-checks', 'a charge sent with only the amount gets the shape from the defaults', 'val:1|0|0|0|NULL', zz.val(s, format(
    'insert into public.invoices (org_id, property_id, lease_id, invoice_number, invoice_type, period_start, period_end, extra_amount, total_amount, due_date) values (%L, %L, %L, %L, %L, %L, %L, 150000, 150000, %L) returning quantity || ''|'' || base_amount || ''|'' || addons_amount || ''|'' || discount_amount || ''|'' || coalesce(period_type, ''NULL'')',
    org, prop, l, 'INV-209901-0090', 'charge', d, d, d)));
end $$;

-- D. staff add charges and take their payments; the status triggers settle them
do $$
declare
  s uuid := zz.id('staff');
  d date := zz.bt_day(0);
begin
  perform zz.eq('D-pay', 'staff add a late check-out charge', 'ok:1', zz.att(s, zz.bt_charge('lease', 11, d, 150000, 'Late checkout', 'c_cash'), true));
  perform zz.eq('D-pay', '... stored as a charge on one day, unpaid', 'charge|NULL|1|0|0|150000|0|150000|unpaid|true|Late checkout',
    (select invoice_type || '|' || coalesce(period_type, 'NULL') || '|' || quantity || '|' || base_amount || '|' || addons_amount || '|' || extra_amount
            || '|' || discount_amount || '|' || total_amount || '|' || status || '|' || (period_start = d and period_end = d and due_date = d) || '|' || notes
       from public.invoices where id = zz.id('c_cash')));
  perform zz.eq('D-pay', 'staff take it in cash (kind rent on the charge)', 'ok:1', zz.att(s, zz.bt_pay1('c_cash', 'lease', 150000, 'cash'), true));
  perform zz.eq('D-pay', '... paid by the trigger', 'paid', zz.bt_status('c_cash'));
  perform zz.chk('D-pay', 'the status RPC the app calls after saving agrees', '^val:', zz.val(s, format('select public.recalc_invoice_status(%L)', zz.id('c_cash')), true));
  perform zz.eq('D-pay', '... still paid', 'paid', zz.bt_status('c_cash'));

  perform zz.eq('D-pay', 'staff add a damage charge', 'ok:1', zz.att(s, zz.bt_charge('lease', 12, d, 300000, 'Kerusakan: kaca jendela', 'c_split'), true));
  perform zz.eq('D-pay', 'part of it by QRIS', 'ok:1', zz.att(s, zz.bt_pay1('c_split', 'lease', 100000, 'qris'), true));
  perform zz.eq('D-pay', '... partial', 'partial', zz.bt_status('c_split'));
  -- checkout/cancel (2b.4) closes a part-paid invoice at the paid amount: the unpaid rest becomes discount
  perform zz.eq('D-pay', 'an admin may close a part-paid charge at the paid amount (2b.4)', 'ok:1', zz.att(zz.id('wife'), format(
    'update public.invoices set discount_amount = 200000, total_amount = 100000, status = %L where id = %L', 'paid', zz.id('c_split'))));
  perform zz.eq('D-pay', 'the rest by transfer', 'ok:1', zz.att(s, zz.bt_pay1('c_split', 'lease', 200000, 'transfer'), true));
  perform zz.eq('D-pay', '... paid', 'paid', zz.bt_status('c_split'));

  perform zz.eq('D-pay', 'staff add a cleaning charge', 'ok:1', zz.att(s, zz.bt_charge('lease', 13, d, 250000, 'Kebersihan', 'c_deposit'), true));
  perform zz.eq('D-pay', 'paid by potong jaminan (method deposit, kind rent)', 'ok:1', zz.att(s, zz.bt_pay1('c_deposit', 'lease', 250000, 'deposit'), true));
  perform zz.eq('D-pay', '... paid', 'paid', zz.bt_status('c_deposit'));
  perform zz.eq('D-pay', '... the payment sits on the charge, by staff', 'rent|deposit|250000|Biaya tambahan|staff',
    (select p.kind || '|' || p.method || '|' || p.amount || '|' || p.notes || '|' || k.k
       from public.payments p join zz.ids k on k.v = p.created_by where p.invoice_id = zz.id('c_deposit')));

  perform zz.eq('D-pay', 'staff add a charge to pay later', 'ok:1', zz.att(s, zz.bt_charge('lease', 14, d, 75000, 'Tamu menginap', 'c_later'), true));
  perform zz.eq('D-pay', '... unpaid', 'unpaid', zz.bt_status('c_later'));
  perform zz.eq('D-pay', 'a charge sent as paid without a payment is unpaid (the trigger decides)', 'val:unpaid', zz.val(s, format(
    'insert into public.invoices (org_id, property_id, lease_id, invoice_number, invoice_type, period_start, period_end, extra_amount, total_amount, due_date, status) values (%L, %L, %L, %L, %L, %L, %L, 50000, 50000, %L, %L) returning status',
    zz.id('org'), zz.id('prop'), zz.id('lease'), 'INV-209901-0091', 'charge', d, d, d, 'paid')));

  perform zz.chk('D-pay', 'the deposit itself (kind deposit) cannot sit on a charge', '^err:23514:.*"payments_check"', zz.att(s, zz.bt_pay1('c_later', 'lease', 75000, 'cash', 'deposit')));
  perform zz.chk('D-pay', 'nor a kind other payment', '^err:23514:.*"payments_check"', zz.att(s, zz.bt_pay1('c_later', 'lease', 75000, 'cash', 'other')));
  perform zz.chk('D-pay', 'nor an unknown method', '^err:23514:.*"payments_method_check"', zz.att(s, zz.bt_pay1('c_later', 'lease', 75000, 'kartu')));
  perform zz.chk('D-pay', 'nor a payment of 0', '^err:23514:.*"payments_amount_check"', zz.att(s, zz.bt_pay1('c_later', 'lease', 0, 'cash')));
  perform zz.eq('D-pay', '... still unpaid', 'unpaid', zz.bt_status('c_later'));
end $$;

-- E. changing, voiding and deleting a charge is owner/admin work (invoices/payments update and delete policies)
do $$
declare
  o uuid := zz.id('owner');
  w uuid := zz.id('wife');
  s uuid := zz.id('staff');
  c uuid := zz.id('c_later');
begin
  perform zz.eq('E-rights', 'staff cannot change a charge''s amount', 'ok:0', zz.att(s, format('update public.invoices set extra_amount = 1, total_amount = 1 where id = %L', c)));
  perform zz.eq('E-rights', 'nor its description', 'ok:0', zz.att(s, format('update public.invoices set notes = %L where id = %L', 'Lainnya', c)));
  perform zz.eq('E-rights', 'nor void it', 'ok:0', zz.att(s, format('update public.invoices set status = %L where id = %L', 'void', c)));
  perform zz.eq('E-rights', 'nor turn it into rent', 'ok:0', zz.att(s, format('update public.invoices set invoice_type = %L where id = %L', 'rent', c)));
  perform zz.eq('E-rights', 'nor delete it', 'ok:0', zz.att(s, format('delete from public.invoices where id = %L', c)));
  perform zz.eq('E-rights', 'nor change a charge''s payment', 'ok:0', zz.att(s, format('update public.payments set amount = 1 where invoice_id = %L', zz.id('c_cash'))));
  perform zz.eq('E-rights', 'nor delete it', 'ok:0', zz.att(s, format('delete from public.payments where invoice_id = %L', zz.id('c_cash'))));
  perform zz.eq('E-rights', '... the charge is as staff left it', 'unpaid|75000|75000|Tamu menginap',
    (select status || '|' || extra_amount || '|' || total_amount || '|' || notes from public.invoices where id = c));

  perform zz.eq('E-rights', 'an admin corrects the amount', 'ok:1', zz.att(w, format('update public.invoices set extra_amount = 100000, total_amount = 100000 where id = %L', c), true));
  perform zz.eq('E-rights', '... stored, still unpaid', 'unpaid|100000', (select status || '|' || total_amount from public.invoices where id = c));
  perform zz.chk('E-rights', 'an admin cannot break the shape (quantity 2)', '^err:23514:.*"invoices_charge_shape_check"',
    zz.att(w, format('update public.invoices set quantity = 2 where id = %L', c)));
  perform zz.chk('E-rights', 'the owner cannot relabel a rent month as a charge', '^err:23514:.*"invoices_charge_shape_check"',
    zz.att(o, format('update public.invoices set invoice_type = %L where id = %L', 'charge', zz.id('r_paid'))));
  perform zz.chk('E-rights', 'the owner cannot void a charge that has payments (invoices_void_guard)', '^err:P0001:Tagihan yang sudah ada pembayarannya',
    zz.att(o, format('update public.invoices set status = %L where id = %L', 'void', zz.id('c_cash'))));
  perform zz.chk('E-rights', 'nor delete it (its payment holds it)', '^err:23503', zz.att(o, format('delete from public.invoices where id = %L', zz.id('c_cash'))));
  perform zz.eq('E-rights', 'the owner may delete an unpaid charge', 'ok:1', zz.att(o, format('delete from public.invoices where id = %L', c)));
  perform zz.eq('E-rights', 'the owner voids it (as Batalkan sewa does)', 'ok:1', zz.att(o, format('update public.invoices set status = %L where id = %L', 'void', c), true));
  perform zz.eq('E-rights', '... void', 'void', zz.bt_status('c_later'));
end $$;

-- F. other organisations, strangers and anon
do $$
declare
  o2 uuid := zz.id('o2owner');
  org uuid := zz.id('org');
  org2 uuid := zz.id('org2');
  d date := zz.bt_day(0);
begin
  perform zz.chk('F-orgs', 'org2 owner cannot add a charge to our lease (our org_id)', '^err:42501',
    zz.att(o2, zz.bt_inv(org, zz.id('prop'), zz.id('lease'), 80, 'charge', null, d, d, 1, 0, 0, 150000, 0, 'x')));
  perform zz.chk('F-orgs', '... nor under their own org_id', '^err:23503',
    zz.att(o2, zz.bt_inv(org2, zz.id('prop2'), zz.id('lease'), 80, 'charge', null, d, d, 1, 0, 0, 150000, 0, 'x')));
  perform zz.chk('F-orgs', 'org2 owner cannot pay our charge (our org_id)', '^err:42501',
    zz.att(o2, zz.bt_pay(org, zz.id('prop'), zz.id('c_split'), zz.id('lease'), 1000, 'cash')));
  perform zz.chk('F-orgs', '... nor under their own org_id', '^err:23503',
    zz.att(o2, zz.bt_pay(org2, zz.id('prop2'), zz.id('c_split'), null, 1000, 'cash')));
  perform zz.eq('F-orgs', 'org2 owner reads none of our charges', 'val:0', zz.val(o2, format('select count(*) from public.invoices where org_id = %L', org)));
  perform zz.eq('F-orgs', 'org2 owner cannot void ours', 'ok:0', zz.att(o2, format('update public.invoices set status = %L where id = %L', 'void', zz.id('c_split'))));
  perform zz.chk('F-orgs', 'a stranger cannot add one', '^err:42501',
    zz.att(zz.id('stranger'), zz.bt_inv(org, zz.id('prop'), zz.id('lease'), 80, 'charge', null, d, d, 1, 0, 0, 150000, 0, 'x')));
  perform zz.chk('F-orgs', 'anon cannot add one', '^err:42501',
    zz.att(null, zz.bt_inv(org, zz.id('prop'), zz.id('lease'), 80, 'charge', null, d, d, 1, 0, 0, 150000, 0, 'x')));
  perform zz.chk('F-orgs', 'anon cannot read them', '^err:42501', zz.val(null, 'select count(*) from public.invoices'));
  perform zz.eq('F-orgs', 'org2 owner adds a charge on their own lease', 'ok:1',
    zz.att(o2, zz.bt_inv(org2, zz.id('prop2'), zz.id('lease2'), 1, 'charge', null, d, d, 1, 0, 0, 40000, 0, 'Kebersihan', 'c_org2'), true));
  perform zz.eq('F-orgs', '... and cuts it from their deposit', 'ok:1',
    zz.att(o2, zz.bt_pay(org2, zz.id('prop2'), zz.id('c_org2'), zz.id('lease2'), 40000, 'deposit'), true));
  perform zz.eq('F-orgs', '... paid', 'paid', zz.bt_status('c_org2'));
  perform zz.eq('F-orgs', 'our staff do not see it', 'val:0', zz.val(zz.id('staff'), format('select count(*) from public.invoices where id = %L', zz.id('c_org2'))));
end $$;

-- G. a charge is not a lease change: no lease row moves, no lease trigger runs, the overlap guard is not in the way
do $$
declare
  s uuid := zz.id('staff');
  org uuid := zz.id('org');
begin
  perform zz.eq('G-leases', 'late check-out charged on the check-out day (the day after the last night)', 'ok:1',
    zz.att(s, zz.bt_charge('lease', 15, zz.bt_day(10), 100000, 'Late checkout', 'c_late'), true));
  perform zz.eq('G-leases', '... the lease still ends on its last night', zz.bt_day(9)::text, (select end_date::text from public.leases where id = zz.id('lease')));
  perform zz.eq('G-leases', 'the next tenant books the room from that day (the charge holds no night)', 'ok:1', zz.att(s, format(
    'insert into public.leases (id, org_id, property_id, room_id, tenant_id, period_type, price_per_period, deposit_amount, start_date, end_date) values (%L, %L, %L, %L, %L, %L, 1500000, 0, %L, %L)',
    zz.id('lease_next'), org, zz.id('prop'), zz.id('room'), zz.id('tenant_next'), 'monthly', zz.bt_day(10), zz.bt_day(39)), true));
  perform zz.eq('G-leases', 'a charge on the new booking, the same day', 'ok:1',
    zz.att(s, zz.bt_charge('lease_next', 16, zz.bt_day(10), 50000, 'Lainnya: kunci cadangan', 'c_next'), true));
  perform zz.eq('G-leases', 'a charge on an ended lease (damage found after check-out)', 'ok:1',
    zz.att(s, zz.bt_charge('lease_ended', 17, '2026-09-01', 200000, 'Kerusakan', 'c_ended'), true));
  perform zz.chk('G-leases', 'the guard still refuses a real double booking (control)', '^err:WB003', zz.att(s, format(
    'insert into public.leases (org_id, property_id, room_id, tenant_id, period_type, price_per_period, deposit_amount, start_date, end_date) values (%L, %L, %L, %L, %L, 1500000, 0, %L, %L)',
    org, zz.id('prop'), zz.id('room'), zz.id('tenant_next'), 'daily', zz.bt_day(5), zz.bt_day(6))));
  perform zz.eq('G-leases', 'no lease that existed before the charges changed', '3|0',
    (select count(*) || '|' || count(*) filter (where to_jsonb(l) is distinct from b.j) from zz.bt_leases b join public.leases l on l.id = b.id));
  perform zz.eq('G-leases', 'the only lease history since: the new booking', 'insert:lease_next',
    (select string_agg(a.action || ':' || k.k, ',') from public.audit_log a join zz.ids k on k.v = a.row_id
      where a.table_name = 'leases' and a.id not in (select id from zz.bt_audit_ids)));
  perform zz.eq('G-leases', 'charges and their payments are the only other rows written', 'invoices,payments',
    (select string_agg(distinct a.table_name, ',') from public.audit_log a
      where a.table_name <> 'leases' and a.id not in (select id from zz.bt_audit_ids)));
end $$;
drop table zz.bt_leases, zz.bt_audit_ids;

-- H. history and the weekly backup
do $$
declare
  b jsonb := public.export_backup();
  ours jsonb := (select f from jsonb_array_elements(b) f where f -> 'tables' -> 'organizations' -> 0 ->> 'id' = zz.id('org')::text);
  theirs jsonb := (select f from jsonb_array_elements(b) f where f -> 'tables' -> 'organizations' -> 0 ->> 'id' = zz.id('org2')::text);
begin
  perform zz.eq('H-history', 'the charge is in the history: added by staff, as a charge', 'staff:charge:Late checkout',
    (select k.k || ':' || (a.new_data ->> 'invoice_type') || ':' || (a.new_data ->> 'notes') from public.audit_log a join zz.ids k on k.v = a.changed_by
      where a.table_name = 'invoices' and a.row_id = zz.id('c_cash') and a.action = 'insert'));
  perform zz.eq('H-history', '... and its payment', 'staff:cash:150000',
    (select k.k || ':' || (a.new_data ->> 'method') || ':' || (a.new_data ->> 'amount') from public.audit_log a join zz.ids k on k.v = a.changed_by
      where a.table_name = 'payments' and a.action = 'insert' and a.new_data ->> 'invoice_id' = zz.id('c_cash')::text));
  perform zz.eq('H-history', 'the admin''s correction and the owner''s void, by whom', 'wife:75000>100000,owner:unpaid>void',
    (select string_agg(k.k || ':' || case when a.old_data ->> 'total_amount' <> a.new_data ->> 'total_amount'
                                          then (a.old_data ->> 'total_amount') || '>' || (a.new_data ->> 'total_amount')
                                          else (a.old_data ->> 'status') || '>' || (a.new_data ->> 'status') end, ',' order by a.changed_at)
       from public.audit_log a join zz.ids k on k.v = a.changed_by
      where a.table_name = 'invoices' and a.row_id = zz.id('c_later') and a.action = 'update'));
  perform zz.eq('H-backup', 'our file marks each invoice''s type', 'charge:7,rent:5',
    (select string_agg(t || ':' || n, ',' order by t) from (
       select i ->> 'invoice_type' as t, count(*) as n from jsonb_array_elements(ours -> 'tables' -> 'invoices') i group by 1) x));
  perform zz.eq('H-backup', 'theirs carries their charge', 'charge:1',
    (select string_agg(t || ':' || n, ',' order by t) from (
       select i ->> 'invoice_type' as t, count(*) as n from jsonb_array_elements(theirs -> 'tables' -> 'invoices') i group by 1) x));
end $$;

drop function zz.bt_structure(text), zz.bt_day(int),
  zz.bt_inv(uuid, uuid, uuid, int, text, text, date, date, int, bigint, bigint, bigint, bigint, text, text),
  zz.bt_charge(text, int, date, bigint, text, text),
  zz.bt_old_inv(text, text, int, text, date, date, int, bigint, bigint, bigint, bigint),
  zz.bt_pay(uuid, uuid, uuid, uuid, bigint, text, text), zz.bt_pay1(text, text, bigint, text, text), zz.bt_status(text);
