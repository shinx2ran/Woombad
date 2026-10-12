-- "Kembalikan" (refund a DP) at checkout / cancel, replayed with the exact requests the app sends as an admin,
-- one API call per zz.att / zz.val. The app never voids a paid invoice (invoices_void_guard refuses it): it re-reads
-- the lease's invoices and their payments, closes the part-paid invoice at the paid amount, voids the unpaid ones,
-- records the rent_refund expense, then ends the lease. Also the database answers SupabaseRepo relies on for deletes
-- (23503 wording, 0 rows under RLS).
\set ON_ERROR_STOP on
select set_config('zz.suite', '24-refund', false);
select zz.reset_data();

select zz.user('owner', '11111111-2424-0000-0000-000000000001', 'owner@family.test');
select zz.user('wife', '22222222-2424-0000-0000-000000000002', 'wife@family.test');
select zz.user('staff', '33333333-2424-0000-0000-000000000003', 'staff@family.test');
select zz.su('select public.set_setup_code(''REFUND-24'')', true);
select zz.join(zz.id('owner'), 'refund24');
insert into zz.ids select 'org', id from public.organizations;
insert into zz.ids values
  ('prop', 'cccccccc-0000-0000-0000-000000000001'), ('tenant', 'cccccccc-0000-0000-0000-000000000002'),
  ('r5', 'cccccccc-0000-0000-0000-000000000051'), ('l5', 'cccccccc-0000-0000-0000-000000000052'),
  ('l5_sep', 'cccccccc-0000-0000-0000-000000000053'), ('l5_oct', 'cccccccc-0000-0000-0000-000000000054'),
  ('l5_nov', 'cccccccc-0000-0000-0000-000000000055'),
  ('r4', 'cccccccc-0000-0000-0000-000000000041'), ('l4', 'cccccccc-0000-0000-0000-000000000042'),
  ('l4_oct', 'cccccccc-0000-0000-0000-000000000043'),
  ('r8', 'cccccccc-0000-0000-0000-000000000081'), ('l8', 'cccccccc-0000-0000-0000-000000000082'),
  ('l8_dec', 'cccccccc-0000-0000-0000-000000000083'), ('l8_jan', 'cccccccc-0000-0000-0000-000000000084'),
  ('r9', 'cccccccc-0000-0000-0000-000000000091'), ('l9', 'cccccccc-0000-0000-0000-000000000092'),
  ('l9_oct', 'cccccccc-0000-0000-0000-000000000093'),
  ('r10', 'cccccccc-0000-0000-0000-000000000101'), ('l10', 'cccccccc-0000-0000-0000-000000000102'),
  ('l10_dec', 'cccccccc-0000-0000-0000-000000000103'), ('l10_jan', 'cccccccc-0000-0000-0000-000000000104');

-- seed as owner: a lease + its invoices, and the DP payments
create or replace function zz.refund_lease(p_room text, p_lease text, p_start date, p_end date) returns void language plpgsql as $$
begin
  perform zz.eq('seed', 'room ' || p_room, 'ok:1', zz.att(zz.id('owner'), format('insert into public.rooms (id, org_id, property_id, name, price_monthly) values (%L, %L, %L, %L, 1500000)',
    zz.id(p_room), zz.id('org'), zz.id('prop'), p_room), true));
  perform zz.eq('seed', 'lease ' || p_lease, 'ok:1', zz.att(zz.id('owner'), format('insert into public.leases (id, org_id, property_id, room_id, tenant_id, period_type, price_per_period, deposit_amount, start_date, end_date) values (%L, %L, %L, %L, %L, %L, 1500000, 0, %L, %L)',
    zz.id(p_lease), zz.id('org'), zz.id('prop'), zz.id(p_room), zz.id('tenant'), 'monthly', p_start, p_end), true));
end $$;

create or replace function zz.refund_invoice(p_key text, p_lease text, p_number text, p_start date, p_end date) returns void language plpgsql as $$
begin
  perform zz.eq('seed', 'invoice ' || p_number, 'ok:1', zz.att(zz.id('owner'), format('insert into public.invoices (id, org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date) values (%L, %L, %L, %L, %L, %L, %L, 1500000, 1500000, %L)',
    zz.id(p_key), zz.id('org'), zz.id('prop'), zz.id(p_lease), p_number, p_start, p_end, p_start), true));
end $$;

create or replace function zz.refund_pay(p_user text, p_invoice text, p_lease text, p_amount bigint) returns void language plpgsql as $$
begin
  perform zz.eq('seed', p_user || ' records ' || p_amount || ' on ' || p_invoice, 'ok:1', zz.att(zz.id(p_user), format('insert into public.payments (org_id, property_id, invoice_id, lease_id, amount, paid_at, method, kind) values (%L, %L, %L, %L, %s, %L, %L, %L)',
    zz.id('org'), zz.id('prop'), zz.id(p_invoice), zz.id(p_lease), p_amount, '2026-09-10', 'transfer', 'rent'), true));
end $$;

-- The requests of closePartialInvoicePatch / rentRefundExpense (SupabaseRepo.update/insert add org_id and returning *).
create or replace function zz.refund_close(p_user text, p_invoice text, p_discount bigint, p_total bigint, p_note text) returns text language sql as $$
  select zz.att(zz.id(p_user), format('update public.invoices set discount_amount = %s, total_amount = %s, status = %L, notes = %L where id = %L and org_id = %L returning *',
    p_discount, p_total, 'paid', p_note, zz.id(p_invoice), zz.id('org')), true);
$$;

create or replace function zz.refund_expense(p_user text, p_lease text, p_amount bigint, p_date date, p_description text) returns text language sql as $$
  select zz.att(zz.id(p_user), format('insert into public.expenses (property_id, lease_id, category, amount, expense_date, description, vendor, receipt_path, org_id) values (%L, %L, %L, %s, %L, %L, null, null, %L) returning *',
    zz.id('prop'), zz.id(p_lease), 'rent_refund', p_amount, p_date, p_description, zz.id('org')), true);
$$;

-- rent paid on the lease minus its rent_refund expenses (SPEC 2a: refunds reduce revenue)
create or replace function zz.refund_net(p_lease text) returns text language sql as $$
  select ((select coalesce(sum(amount), 0) from public.payments where lease_id = zz.id(p_lease) and kind = 'rent')
        - (select coalesce(sum(amount), 0) from public.expenses where lease_id = zz.id(p_lease) and category = 'rent_refund'))::text;
$$;

-- what is still owed on a non-void invoice: total - rent paid
create or replace function zz.refund_owed(p_invoice text) returns text language sql as $$
  select (i.total_amount - coalesce((select sum(amount) from public.payments p where p.invoice_id = i.id and p.kind = 'rent'), 0))::text
  from public.invoices i where i.id = zz.id(p_invoice);
$$;

do $$
declare
  o uuid := zz.id('owner');
  org uuid := zz.id('org');
begin
  perform zz.eq('setup', 'wife joins as admin', 'val:' || org, zz.join(zz.id('wife'), zz.invite('wife', o, org, 'admin', 'Istri')));
  perform zz.eq('setup', 'staff joins as staff', 'val:' || org, zz.join(zz.id('staff'), zz.invite('staff', o, org, 'staff', 'Penjaga')));
  perform zz.eq('seed', 'property', 'ok:1', zz.att(o, format('insert into public.properties (id, org_id, name) values (%L, %L, %L)', zz.id('prop'), org, 'Kos Melati'), true));
  perform zz.eq('seed', 'tenant', 'ok:1', zz.att(o, format('insert into public.tenants (id, org_id, property_id, full_name) values (%L, %L, %L, %L)', zz.id('tenant'), org, zz.id('prop'), 'Budi'), true));
  -- L5: checkout on 2026-09-20; September open, October holds a DP, November unpaid
  perform zz.refund_lease('r5', 'l5', '2026-09-01', '2026-11-30');
  perform zz.refund_invoice('l5_sep', 'l5', 'INV-202609-0001', '2026-09-01', '2026-09-30');
  perform zz.refund_invoice('l5_oct', 'l5', 'INV-202610-0001', '2026-10-01', '2026-10-31');
  perform zz.refund_invoice('l5_nov', 'l5', 'INV-202611-0001', '2026-11-01', '2026-11-30');
  perform zz.refund_pay('owner', 'l5_oct', 'l5', 500000);
  perform zz.eq('seed', 'L5 deposit received', 'ok:1', zz.att(o, format('insert into public.payments (org_id, property_id, lease_id, amount, paid_at, method, kind) values (%L, %L, %L, 1000000, %L, %L, %L)',
    org, zz.id('prop'), zz.id('l5'), '2026-09-01', 'cash', 'deposit'), true));
  -- L4: not started yet, cancelled with a DP of 400000
  perform zz.refund_lease('r4', 'l4', '2026-10-15', '2026-11-14');
  perform zz.refund_invoice('l4_oct', 'l4', 'INV-202610-0002', '2026-10-15', '2026-11-14');
  perform zz.refund_pay('owner', 'l4_oct', 'l4', 400000);
  -- L8: December DP + January unpaid, cancelled
  perform zz.refund_lease('r8', 'l8', '2026-12-01', '2027-01-31');
  perform zz.refund_invoice('l8_dec', 'l8', 'INV-202612-0001', '2026-12-01', '2026-12-31');
  perform zz.refund_invoice('l8_jan', 'l8', 'INV-202701-0001', '2027-01-01', '2027-01-31');
  perform zz.refund_pay('owner', 'l8_dec', 'l8', 300000);
  -- L9: DP 200000 seen by the admin's screen; staff records 100000 more on another phone before the admin submits
  perform zz.refund_lease('r9', 'l9', '2026-10-01', '2026-10-31');
  perform zz.refund_invoice('l9_oct', 'l9', 'INV-202610-0003', '2026-10-01', '2026-10-31');
  perform zz.refund_pay('owner', 'l9_oct', 'l9', 200000);
  perform zz.refund_pay('staff', 'l9_oct', 'l9', 100000);
  -- L10: December DP 300000 + January unpaid seen by the admin's screen (staff adds 100000 in G)
  perform zz.refund_lease('r10', 'l10', '2026-12-01', '2027-01-31');
  perform zz.refund_invoice('l10_dec', 'l10', 'INV-202612-0002', '2026-12-01', '2026-12-31');
  perform zz.refund_invoice('l10_jan', 'l10', 'INV-202701-0002', '2027-01-01', '2027-01-31');
  perform zz.refund_pay('owner', 'l10_dec', 'l10', 300000);
  perform zz.eq('seed', 'part-paid invoices are partial', 'partial,partial,partial,partial,partial',
    (select string_agg(status, ',' order by invoice_number) from public.invoices where id in (zz.id('l5_oct'), zz.id('l4_oct'), zz.id('l8_dec'), zz.id('l9_oct'), zz.id('l10_dec'))));
end $$;

-- The app's re-read before a checkout/cancel writes (SupabaseRepo.list through bindOrg): the lease's invoices, then
-- the rent paid on the invoices it is about to void/close/refund.
create or replace function zz.refund_reread(p_user text, p_lease text, p_invoices text[]) returns text language sql as $$
  select zz.val(zz.id(p_user), format('select count(*) || %L || (select coalesce(sum(amount), 0) from public.payments where invoice_id = any(%L::uuid[]) and kind = %L and org_id = %L) from public.invoices where lease_id = %L and org_id = %L',
    ':', (select array_agg(zz.id(k)) from unnest(p_invoices) k), 'rent', zz.id('org'), zz.id(p_lease), zz.id('org')));
$$;

-- A. Why the app must not void: the guard refuses a paid invoice (and the old "Kembalikan" always failed here)
do $$ begin
  perform zz.chk('A-guard', 'admin voids a part-paid invoice -> refused', '^err:P0001:Tagihan yang sudah ada pembayarannya tidak dapat dibatalkan',
    zz.att(zz.id('wife'), format('update public.invoices set status = %L where id = %L and org_id = %L returning *', 'void', zz.id('l5_oct'), zz.id('org'))));
end $$;

-- B. Checkout of L5 on 2026-09-20, "Kembalikan" for October, deposit returned: every invoice write first
do $$
declare
  a uuid := zz.id('wife');
begin
  perform zz.eq('B-checkout', '0. re-read: 3 invoices, 500000 paid on October + November (as on the screen)', 'val:3:500000',
    zz.refund_reread('wife', 'l5', array['l5_oct', 'l5_nov']));
  perform zz.eq('B-checkout', '1. close October at the paid amount', 'ok:1', zz.refund_close('wife', 'l5_oct', 1000000, 500000, 'DP dikembalikan (checkout)'));
  perform zz.eq('B-checkout', '2. void November (unpaid, after checkout)', 'ok:1',
    zz.att(a, format('update public.invoices set status = %L where id = %L and org_id = %L returning *', 'void', zz.id('l5_nov'), zz.id('org')), true));
  perform zz.eq('B-checkout', '3. read existing refunds of the lease (none yet)', 'val:0',
    zz.val(a, format('select count(*) from public.expenses where lease_id = %L and category = %L and org_id = %L', zz.id('l5'), 'rent_refund', zz.id('org'))));
  perform zz.eq('B-checkout', '4. rent_refund expense', 'ok:1', zz.refund_expense('wife', 'l5', 500000, '2026-09-20', 'Pengembalian DP tagihan INV-202610-0001 (checkout)'));
  perform zz.eq('B-checkout', '5. deposit_refund expense', 'ok:1', zz.att(a, format('insert into public.expenses (property_id, lease_id, category, amount, expense_date, description, vendor, receipt_path, org_id) values (%L, %L, %L, 1000000, %L, %L, null, null, %L) returning *',
    zz.id('prop'), zz.id('l5'), 'deposit_refund', '2026-09-20', 'Pengembalian uang jaminan', zz.id('org')), true));
  perform zz.eq('B-checkout', '6. lease ended', 'ok:1', zz.att(a, format('update public.leases set status = %L, checkout_date = %L, end_date = %L where id = %L and org_id = %L returning *',
    'ended', '2026-09-20', '2026-09-20', zz.id('l5'), zz.id('org')), true));
  perform zz.eq('B-checkout', 'October: paid, total = DP, discount = rest', 'paid:500000:1000000',
    (select status || ':' || total_amount || ':' || discount_amount from public.invoices where id = zz.id('l5_oct')));
  perform zz.eq('B-checkout', 'October owes nothing', '0', zz.refund_owed('l5_oct'));
  perform zz.eq('B-checkout', 'November void, September still receivable', 'void:1500000', (select status from public.invoices where id = zz.id('l5_nov')) || ':' || zz.refund_owed('l5_sep'));
  perform zz.eq('B-checkout', 'one rent_refund of 500000', '1:500000',
    (select count(*) || ':' || sum(amount) from public.expenses where lease_id = zz.id('l5') and category = 'rent_refund'));
  perform zz.eq('B-checkout', 'rent paid - refunds = 0', '0', zz.refund_net('l5'));
  perform zz.eq('B-checkout', 'lease ended on the checkout date', 'ended:2026-09-20', (select status || ':' || checkout_date from public.leases where id = zz.id('l5')));
  -- a retry re-reads October as already closed and sends no close; even the same close sent again would be harmless
  perform zz.eq('B-checkout', 'the same close sent again is accepted unchanged', 'ok:1', zz.refund_close('wife', 'l5_oct', 1000000, 500000, 'DP dikembalikan (checkout)'));
  perform zz.eq('B-checkout', '... and the app then finds the refund already recorded', 'val:1',
    zz.val(a, format('select count(*) from public.expenses where lease_id = %L and category = %L and description like %L', zz.id('l5'), 'rent_refund', '%INV-202610-0001%')));
end $$;

-- C. Cancel L4 (not started) with "Kembalikan"
do $$
declare
  a uuid := zz.id('wife');
begin
  perform zz.eq('C-cancel', '0. re-read: 1 invoice, 400000 paid', 'val:1:400000', zz.refund_reread('wife', 'l4', array['l4_oct']));
  perform zz.eq('C-cancel', '1. close the DP invoice', 'ok:1', zz.refund_close('wife', 'l4_oct', 1100000, 400000, 'DP dikembalikan (sewa dibatalkan)'));
  perform zz.eq('C-cancel', '2. rent_refund expense', 'ok:1', zz.refund_expense('wife', 'l4', 400000, '2026-10-05', 'Pengembalian DP tagihan INV-202610-0002 (sewa dibatalkan)'));
  perform zz.eq('C-cancel', '3. lease cancelled (end_date kept at start_date)', 'ok:1', zz.att(a, format('update public.leases set status = %L, end_date = %L where id = %L and org_id = %L returning *',
    'cancelled', '2026-10-15', zz.id('l4'), zz.id('org')), true));
  perform zz.eq('C-cancel', 'invoice paid at 400000, owes nothing', 'paid:400000:0',
    (select status || ':' || total_amount from public.invoices where id = zz.id('l4_oct')) || ':' || zz.refund_owed('l4_oct'));
  perform zz.eq('C-cancel', 'rent paid - refunds = 0', '0', zz.refund_net('l4'));
  perform zz.eq('C-cancel', 'lease cancelled', 'cancelled', (select status from public.leases where id = zz.id('l4')));
end $$;

-- D. Cancel L8 (December DP + January unpaid) in the app's order
do $$
declare
  a uuid := zz.id('wife');
begin
  perform zz.eq('D-cancel-two', '0. re-read: 2 invoices, 300000 paid on December + January', 'val:2:300000',
    zz.refund_reread('wife', 'l8', array['l8_jan', 'l8_dec']));
  perform zz.eq('D-cancel-two', '1. close December', 'ok:1', zz.refund_close('wife', 'l8_dec', 1200000, 300000, 'DP dikembalikan (sewa dibatalkan)'));
  perform zz.eq('D-cancel-two', '2. void January', 'ok:1',
    zz.att(a, format('update public.invoices set status = %L where id = %L and org_id = %L returning *', 'void', zz.id('l8_jan'), zz.id('org')), true));
  perform zz.eq('D-cancel-two', '3. rent_refund expense', 'ok:1', zz.refund_expense('wife', 'l8', 300000, '2026-11-20', 'Pengembalian DP tagihan INV-202612-0001 (sewa dibatalkan)'));
  perform zz.eq('D-cancel-two', '4. lease cancelled', 'ok:1', zz.att(a, format('update public.leases set status = %L, end_date = %L where id = %L and org_id = %L returning *',
    'cancelled', '2026-12-01', zz.id('l8'), zz.id('org')), true));
  perform zz.eq('D-cancel-two', 'final state: cancelled, January void, December paid, one refund, net 0', 'cancelled:void:paid:1:0',
    (select status from public.leases where id = zz.id('l8')) || ':' || (select status from public.invoices where id = zz.id('l8_jan')) || ':'
    || (select status from public.invoices where id = zz.id('l8_dec')) || ':'
    || (select count(*) from public.expenses where lease_id = zz.id('l8') and category = 'rent_refund') || ':' || zz.refund_net('l8'));
end $$;

-- E. The admin's screen missed a payment: the re-read shows it and the app writes nothing. Should the payment land
-- between the re-read and the write, the close the database refuses comes first, so nothing else is written.
do $$
declare
  a uuid := zz.id('wife');
begin
  perform zz.eq('E-refused', '0. re-read: 300000 paid, the screen shows 200000 -> the app stops here', 'val:1:300000',
    zz.refund_reread('wife', 'l9', array['l9_oct']));
  perform zz.chk('E-refused', 'close with a stale paid amount -> refused', '^err:P0001:Total tagihan tidak boleh lebih kecil',
    zz.refund_close('wife', 'l9_oct', 1300000, 200000, 'DP dikembalikan (sewa dibatalkan)'));
  perform zz.eq('E-refused', 'no refund recorded, invoice still partial, lease still active', '0:partial:active',
    (select count(*) from public.expenses where lease_id = zz.id('l9')) || ':' || (select status from public.invoices where id = zz.id('l9_oct'))
    || ':' || (select status from public.leases where id = zz.id('l9')));
  perform zz.eq('E-refused', 'staff cannot close an invoice -> 0 rows (PostgREST answers PGRST116)', 'ok:0',
    zz.refund_close('staff', 'l9_oct', 1200000, 300000, 'DP dikembalikan (sewa dibatalkan)'));
end $$;

-- F. Two invoices (December DP 300000 + January unpaid on the admin's screen); staff records 100000 more on December
-- from another phone before the admin presses "Batalkan sewa". The app used to void January first, then the close
-- of December was refused: an active lease with January silently voided. Now the re-read stops it before any write,
-- and should the payment land after the re-read, the refused close still comes before the void.
do $$
declare
  a uuid := zz.id('wife');
begin
  perform zz.refund_pay('staff', 'l10_dec', 'l10', 100000);
  perform zz.eq('F-stale-two', '0. re-read: 400000 paid, the screen shows 300000 -> the app stops here', 'val:2:400000',
    zz.refund_reread('wife', 'l10', array['l10_dec', 'l10_jan']));
  perform zz.chk('F-stale-two', '1. close December with the screen''s amounts -> refused', '^err:P0001:Total tagihan tidak boleh lebih kecil',
    zz.refund_close('wife', 'l10_dec', 1200000, 300000, 'DP dikembalikan (sewa dibatalkan)'));
  perform zz.eq('F-stale-two', 'nothing written: January unpaid, December partial, lease active, no expense', 'unpaid:partial:active:0',
    (select status from public.invoices where id = zz.id('l10_jan')) || ':' || (select status from public.invoices where id = zz.id('l10_dec'))
    || ':' || (select status from public.leases where id = zz.id('l10')) || ':' || (select count(*) from public.expenses where lease_id = zz.id('l10')));
  -- after "Periksa angka terbaru": the screen shows 400000, the same steps go through
  perform zz.eq('F-stale-two', 'retry 0. re-read matches the refreshed screen', 'val:2:400000', zz.refund_reread('wife', 'l10', array['l10_dec', 'l10_jan']));
  perform zz.eq('F-stale-two', 'retry 1. close December at 400000', 'ok:1', zz.refund_close('wife', 'l10_dec', 1100000, 400000, 'DP dikembalikan (sewa dibatalkan)'));
  perform zz.eq('F-stale-two', 'retry 2. void January', 'ok:1',
    zz.att(a, format('update public.invoices set status = %L where id = %L and org_id = %L returning *', 'void', zz.id('l10_jan'), zz.id('org')), true));
  perform zz.eq('F-stale-two', 'retry 3. rent_refund expense of 400000', 'ok:1', zz.refund_expense('wife', 'l10', 400000, '2026-11-20', 'Pengembalian DP tagihan INV-202612-0002 (sewa dibatalkan)'));
  perform zz.eq('F-stale-two', 'retry 4. lease cancelled', 'ok:1', zz.att(a, format('update public.leases set status = %L, end_date = %L where id = %L and org_id = %L returning *',
    'cancelled', '2026-12-01', zz.id('l10'), zz.id('org')), true));
  perform zz.eq('F-stale-two', 'final state: cancelled, January void, December paid, net 0', 'cancelled:void:paid:0',
    (select status from public.leases where id = zz.id('l10')) || ':' || (select status from public.invoices where id = zz.id('l10_jan')) || ':'
    || (select status from public.invoices where id = zz.id('l10_dec')) || ':' || zz.refund_net('l10'));
end $$;

-- G. What SupabaseRepo.remove / translateDbError rely on
do $$
declare
  a uuid := zz.id('wife');
  s uuid := zz.id('staff');
begin
  perform zz.chk('G-delete', 'deleting a room that has a lease -> 23503 "update or delete on table"',
    '^err:23503:update or delete on table "rooms" violates foreign key constraint',
    zz.att(a, format('delete from public.rooms where id = %L and org_id = %L returning id', zz.id('r5'), zz.id('org'))));
  perform zz.chk('G-delete', 'deleting a tenant that has leases -> 23503 "update or delete on table"',
    '^err:23503:update or delete on table "tenants" violates foreign key constraint',
    zz.att(a, format('delete from public.tenants where id = %L and org_id = %L returning id', zz.id('tenant'), zz.id('org'))));
  perform zz.eq('G-delete', 'staff deletes a payment -> no error, 0 rows (remove() must report it)', 'ok:0',
    zz.att(s, format('delete from public.payments where invoice_id = %L and org_id = %L returning id', zz.id('l9_oct'), zz.id('org'))));
  perform zz.eq('G-delete', 'the payments are still there', '2', (select count(*)::text from public.payments where invoice_id = zz.id('l9_oct')));
  perform zz.eq('G-delete', 'admin deletes a row that is already gone -> 0 rows', 'ok:0',
    zz.att(a, format('delete from public.payments where id = %L and org_id = %L returning id', gen_random_uuid(), zz.id('org'))));
end $$;

drop function zz.refund_lease(text, text, date, date);
drop function zz.refund_invoice(text, text, text, date, date);
drop function zz.refund_pay(text, text, text, bigint);
drop function zz.refund_close(text, text, bigint, bigint, text);
drop function zz.refund_expense(text, text, bigint, date, text);
drop function zz.refund_net(text);
drop function zz.refund_reread(text, text, text[]);
drop function zz.refund_owed(text);
