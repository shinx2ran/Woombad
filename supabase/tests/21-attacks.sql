-- Attack tests against the fixture from 20-attack-fixture.sql: anon, a signed-up stranger, staff, admin,
-- another organisation, storage, column tampering, and the normal work that must keep working.
-- Groups ending in "-allowed" document what staff may still do by design.
\set ON_ERROR_STOP on
select set_config('zz.suite', '20-attacks', false);

create or replace function zz.ins_sql(tbl text, org uuid, me uuid) returns text language plpgsql stable as $$
declare
  prop uuid := case when org = zz.id('org2') then zz.id('prop2') else zz.id('prop1') end;
begin
  return case tbl
    when 'organizations' then format('insert into public.organizations (name, created_by) values (%L, %L)', 'Hijack', me)
    when 'organization_members' then format('insert into public.organization_members (org_id, user_id, email, role) values (%L, %L, %L, %L)', org, me, 'x@x.x', 'owner')
    when 'invitations' then format('insert into public.invitations (org_id, label, role) values (%L, %L, %L)', org, 'friend', 'admin')
    when 'properties' then format('insert into public.properties (org_id, name) values (%L, %L)', org, 'P')
    when 'rooms' then format('insert into public.rooms (org_id, property_id, name) values (%L, %L, %L)', org, prop, 'R')
    when 'addon_catalog' then format('insert into public.addon_catalog (org_id, name) values (%L, %L)', org, 'Wifi')
    when 'tenants' then format('insert into public.tenants (org_id, full_name, id_type, id_number, nationality) values (%L, %L, %L, %L, %L)', org, 'T', 'passport', 'P1', 'SG')
    when 'leases' then format('insert into public.leases (org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date) values (%L, %L, %L, %L, %L, 1, %L, %L)', org, zz.id('prop1'), zz.id('room1'), zz.id('tenant1'), 'monthly', '2026-06-01', '2026-06-30')
    when 'lease_addons' then format('insert into public.lease_addons (org_id, lease_id, name, amount) values (%L, %L, %L, 1)', org, zz.id('lease1'), 'A')
    when 'invoices' then format('insert into public.invoices (org_id, property_id, lease_id, invoice_number, period_type, period_start, period_end, base_amount, total_amount, due_date) values (%L, %L, %L, %L, %L, %L, %L, 1, 1, %L)', org, zz.id('prop1'), zz.id('lease1'), 'INV-X-' || substr(md5(random()::text), 1, 6), 'daily', '2026-06-01', '2026-06-01', '2026-06-01')
    when 'payments' then format('insert into public.payments (org_id, property_id, invoice_id, lease_id, amount, paid_at) values (%L, %L, %L, %L, 1, %L)', org, zz.id('prop1'), zz.id('inv_unpaid'), zz.id('lease1'), '2026-05-01')
    when 'expenses' then format('insert into public.expenses (org_id, property_id, category, amount, expense_date, description) values (%L, %L, %L, 1, %L, %L)', org, prop, 'other', '2026-05-01', 'x')
    when 'audit_log' then format('insert into public.audit_log (org_id, table_name, action) values (%L, %L, %L)', org, 'payments', 'delete')
    when 'invitation_codes' then format('insert into public.invitation_codes (invitation_id, code_hash) values ((select id from public.invitations where org_id = %L limit 1), %L)', org, 'x')
    when 'app_settings' then format('insert into public.app_settings (id, setup_code_hash) values (1, %L) on conflict (id) do update set setup_code_hash = excluded.setup_code_hash, setup_code_used_at = null', md5('mine'))
    when 'join_attempts' then format('insert into public.join_attempts (user_id) values (%L)', coalesce(me, zz.id('owner')))
  end;
end $$;

create or replace function zz.upd_sql(tbl text) returns text language sql immutable as $$
  select format('update public.%I set %s where true', tbl, case tbl
    when 'organizations' then 'name = ''pwned''' when 'organization_members' then 'role = ''owner'''
    when 'invitations' then 'role = ''admin'', expires_at = now() + interval ''1 year''' when 'properties' then 'payment_info = ''BCA 999 attacker'''
    when 'rooms' then 'name = ''x''' when 'addon_catalog' then 'name = ''x''' when 'tenants' then 'id_number = ''x'''
    when 'leases' then 'notes = ''x''' when 'lease_addons' then 'amount = 0' when 'invoices' then 'period_type = ''daily'''
    when 'payments' then 'amount = 1' when 'expenses' then 'amount = 1' when 'audit_log' then 'old_data = null'
    when 'invitation_codes' then 'code_hash = ''x''' when 'app_settings' then 'setup_code_used_at = null, setup_code_hash = ''x'''
    when 'join_attempts' then 'attempted_at = now() - interval ''2 hours''' end)
$$;

-- What an UPDATE/DELETE/SELECT that RLS must reduce to nothing returns: zero rows where authenticated
-- holds the table privilege, "permission denied" where it does not (the privileges themselves are
-- checked by zz.check_structure).
create or replace function zz.nothing(tbl text, priv text) returns text language sql stable as $$
  select case when has_table_privilege('authenticated', 'public.' || tbl, priv) then (case when priv = 'SELECT' then '^val:0$' else '^ok:0$' end)
              else '^err:42501' end;
$$;

do $$
declare
  tables text[] := array['organizations', 'organization_members', 'invitations', 'properties', 'rooms', 'addon_catalog', 'tenants', 'leases',
                         'lease_addons', 'invoices', 'payments', 'expenses', 'audit_log', 'invitation_codes', 'app_settings', 'join_attempts'];
  t text;
  rpc text;
  org1 uuid := zz.id('org1');
begin
  ---------------------------------------------------------------- (a) anon
  foreach t in array tables loop
    perform zz.chk('a-anon', 'anon SELECT ' || t, '^err:42501', zz.val(null, format('select count(*) from public.%I', t)));
    perform zz.chk('a-anon', 'anon INSERT ' || t, '^err:42501', zz.att(null, zz.ins_sql(t, org1, null)));
    perform zz.chk('a-anon', 'anon UPDATE ' || t, '^err:42501', zz.att(null, zz.upd_sql(t)));
    perform zz.chk('a-anon', 'anon DELETE ' || t, '^err:42501', zz.att(null, format('delete from public.%I', t)));
    perform zz.chk('a-anon', 'anon TRUNCATE ' || t, '^err:42501', zz.att(null, format('truncate public.%I cascade', t)));
  end loop;
  perform zz.chk('a-anon', 'anon SELECT storage.objects', '^(err:42501|val:0$)', zz.val(null, 'select count(*) from storage.objects'));
  perform zz.chk('a-anon', 'anon INSERT storage.objects org1 folder', '^err:42501', zz.att(null, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'ktp', org1 || '/a.jpg')));
  foreach rpc in array array[
      'select public.ensure_membership()',
      format('select public.join_with_code(%L)', zz.code('pending')),
      format('select code from public.create_invitation(%L, %L, null)', org1, 'admin'),
      format('select public.set_member_role(%L, %L, %L)', org1, zz.id('owner'), 'staff'),
      format('select public.remove_member(%L, %L)', org1, zz.id('owner')),
      format('select public.recalc_invoice_status(%L)', zz.id('inv1')),
      'select public.set_setup_code(''ANON-CODE'')',
      'select public.hash_code(''ANONCODE'')',
      format('select public.is_org_member(%L)', org1)] loop
    perform zz.chk('a-anon', 'anon RPC ' || rpc, '^err:42501', zz.att(null, rpc));
  end loop;
  -- v0.2 email-based membership functions no longer exist
  foreach rpc in array array[
      format('select public.add_member_by_email(%L, %L, %L)', org1, 'a@b.co', 'admin'),
      format('select public.accept_invitations_for(%L, %L)', zz.id('stranger'), 'pending@example.com'),
      'select public.handle_new_user()'] loop
    perform zz.chk('a-anon', 'removed RPC ' || split_part(rpc, '(', 1), '^err:42883', zz.att(null, rpc));
  end loop;

  ---------------------------------------------------------------- (b) authenticated stranger
  foreach t in array tables loop
    perform zz.chk('b-stranger', 'stranger sees 0 rows in ' || t, zz.nothing(t, 'SELECT'), zz.val(zz.id('stranger'), format('select count(*) from public.%I', t)));
    perform zz.chk('b-stranger', 'stranger INSERT ' || t || ' (org1)', '^err:42501', zz.att(zz.id('stranger'), zz.ins_sql(t, org1, zz.id('stranger'))));
    perform zz.chk('b-stranger', 'stranger UPDATE ' || t, zz.nothing(t, 'UPDATE'), zz.att(zz.id('stranger'), zz.upd_sql(t)));
    perform zz.chk('b-stranger', 'stranger DELETE ' || t, zz.nothing(t, 'DELETE'), zz.att(zz.id('stranger'), format('delete from public.%I', t)));
    perform zz.chk('b-stranger', 'stranger TRUNCATE ' || t, '^err:42501', zz.att(zz.id('stranger'), format('truncate public.%I cascade', t)));
  end loop;
  perform zz.chk('b-stranger', 'stranger sees 0 storage objects', '^val:0$', zz.val(zz.id('stranger'), 'select count(*) from storage.objects'));
  perform zz.chk('b-stranger', 'stranger upload into org1 folder', '^err:42501', zz.att(zz.id('stranger'), format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'ktp', org1 || '/a.jpg')));
  perform zz.chk('b-stranger', 'stranger create_invitation(org1)', 'Hanya pemilik/admin', zz.att(zz.id('stranger'), format('select code from public.create_invitation(%L, %L, null)', org1, 'admin')));
  perform zz.chk('b-stranger', 'stranger remove_member(org1, owner)', 'Hanya pemilik/admin', zz.att(zz.id('stranger'), format('select public.remove_member(%L, %L)', org1, zz.id('owner'))));
  perform zz.chk('b-stranger', 'stranger set_member_role(org1, self, owner)', 'Hanya pemilik', zz.att(zz.id('stranger'), format('select public.set_member_role(%L, %L, %L)', org1, zz.id('stranger'), 'owner')));
  perform zz.chk('b-stranger', 'stranger recalc_invoice_status(org1 invoice)', 'Tidak memiliki akses', zz.att(zz.id('stranger'), format('select public.recalc_invoice_status(%L)', zz.id('inv_unpaid'))));
  perform zz.chk('b-stranger', 'stranger ensure_membership() -> WB001, no org created', '^err:WB001:.*belum menjadi anggota', zz.att(zz.id('stranger'), 'select public.ensure_membership()'));
  perform zz.chk('b-stranger', 'stranger set_setup_code', '^err:42501', zz.att(zz.id('stranger'), 'select public.set_setup_code(''EVIL-CODE'')'));
  perform zz.chk('b-stranger', 'stranger probes is_org_member(org1) -> false only', '^val:(f|false)$', zz.val(zz.id('stranger'), format('select public.is_org_member(%L)', org1)));
  perform zz.chk('b-stranger', 'stranger reuses the (used) setup code', '^val:NULL$', zz.join(zz.id('stranger'), 'SETUP-2026'));
  perform zz.chk('b-stranger', 'stranger reuses an accepted invitation code', '^val:NULL$', zz.join(zz.id('stranger'), zz.code('admin')));
  perform zz.chk('b-stranger', 'stranger types a code with SQL in it', '^val:NULL$', zz.join(zz.id('stranger'), ''' or 1=1 --'));
  perform zz.chk('b-stranger', 'stranger sends an enormous code', '^val:NULL$', zz.join(zz.id('stranger'), repeat('A', 100000)));
  -- brute force: blocked after 10 failures, even when the 11th guess is right
  for i in 1..6 loop
    perform zz.join(zz.id('stranger'), 'GUESS' || lpad(i::text, 3, '0'));
  end loop;
  perform zz.chk('b-stranger', 'stranger guessing: the 11th attempt is refused', 'Terlalu banyak percobaan', zz.join(zz.id('stranger'), zz.code('pending')));
  perform zz.chk('b-stranger', '... though it was the right code: still unused', '^val:0$', zz.val(zz.id('admin'), 'select count(*) from public.invitations where accepted_at is not null and label = ''Belum dipakai'''));
  perform zz.chk('b-stranger', 'stranger clears own attempts to retry', '^err:42501', zz.att(zz.id('stranger'), 'delete from public.join_attempts'));

  ---------------------------------------------------------------- (c) staff (staff2, member of org1 only)
  perform zz.chk('c-staff', 'staff UPDATE invoices notes', '^ok:0$', zz.att(zz.id('staff'), 'update public.invoices set notes = ''x'''));
  perform zz.chk('c-staff', 'staff UPDATE invoices period_type', '^ok:0$', zz.att(zz.id('staff'), 'update public.invoices set period_type = ''daily'''));
  perform zz.chk('c-staff', 'staff UPDATE invoices status=void', '^ok:0$', zz.att(zz.id('staff'), format('update public.invoices set status = ''void'' where id = %L', zz.id('inv_unpaid'))));
  perform zz.chk('c-staff', 'staff UPDATE invoices discount', '^ok:0$', zz.att(zz.id('staff'), 'update public.invoices set discount_amount = total_amount, total_amount = 0'));
  foreach t in array array['payments', 'expenses', 'invoices', 'leases', 'properties', 'rooms', 'addon_catalog'] loop
    perform zz.chk('c-staff', 'staff DELETE ' || t, '^ok:0$', zz.att(zz.id('staff'), format('delete from public.%I', t)));
  end loop;
  perform zz.chk('c-staff', 'staff DELETE own payment', '^ok:0$', zz.att(zz.id('staff'), format('delete from public.payments where id = %L', zz.id('pay_staff'))));
  perform zz.chk('c-staff', 'staff UPDATE owner''s payment', '^ok:0$', zz.att(zz.id('staff'), format('update public.payments set amount = 1 where id = %L', zz.id('pay_owner'))));
  perform zz.chk('c-staff', 'staff UPDATE owner''s expense', '^ok:0$', zz.att(zz.id('staff'), format('update public.expenses set amount = 1 where id = %L', zz.id('exp_owner'))));
  perform zz.chk('c-staff', 'staff promote self to owner', '^err:42501', zz.att(zz.id('staff'), format('update public.organization_members set role = ''owner'' where user_id = %L', zz.id('staff'))));
  perform zz.chk('c-staff', 'staff change other member role', '^err:42501', zz.att(zz.id('staff'), format('update public.organization_members set role = ''staff'' where user_id = %L', zz.id('owner'))));
  perform zz.chk('c-staff', 'staff DELETE members', '^err:42501', zz.att(zz.id('staff'), 'delete from public.organization_members'));
  perform zz.chk('c-staff', 'staff INSERT self as owner member', '^err:42501', zz.att(zz.id('staff'), zz.ins_sql('organization_members', org1, zz.id('staff'))));
  perform zz.chk('c-staff', 'staff create_invitation', 'Hanya pemilik/admin', zz.att(zz.id('staff'), format('select code from public.create_invitation(%L, %L, null)', org1, 'staff')));
  perform zz.chk('c-staff', 'staff INSERT invitations directly', '^err:42501', zz.att(zz.id('staff'), zz.ins_sql('invitations', org1, zz.id('staff'))));
  perform zz.chk('c-staff', 'staff sees 0 invitations', '^val:0$', zz.val(zz.id('staff'), 'select count(*) from public.invitations'));
  perform zz.chk('c-staff', 'staff remove_member(owner)', 'Hanya pemilik/admin', zz.att(zz.id('staff'), format('select public.remove_member(%L, %L)', org1, zz.id('owner'))));
  perform zz.chk('c-staff', 'staff set_member_role(self, owner)', 'Hanya pemilik', zz.att(zz.id('staff'), format('select public.set_member_role(%L, %L, %L)', org1, zz.id('staff'), 'owner')));
  perform zz.chk('c-staff', 'staff rename organisation', '^ok:0$', zz.att(zz.id('staff'), 'update public.organizations set name = ''x'''));
  perform zz.chk('c-staff', 'staff reads the change history', '^val:0$', zz.val(zz.id('staff'), 'select count(*) from public.audit_log'));
  -- allowed in v0.2, refused since v0.3
  perform zz.chk('c-staff-limits', 'staff edits properties.payment_info (bank account in WA reminders)', '^ok:0$', zz.att(zz.id('staff'), format('update public.properties set payment_info = ''BCA 999 staff'' where id = %L', zz.id('prop1'))));
  perform zz.chk('c-staff-limits', 'staff edits lease price', 'harga atau jenis sewa', zz.att(zz.id('staff'), format('update public.leases set price_per_period = 1, status = ''cancelled'' where id = %L', zz.id('lease1'))));
  perform zz.chk('c-staff-limits', 'staff edits room price', 'harga kamar', zz.att(zz.id('staff'), format('update public.rooms set price_monthly = 1 where id = %L', zz.id('room1'))));
  perform zz.chk('c-staff-limits', 'staff lowers amount of own payment afterwards', '^ok:0$', zz.att(zz.id('staff'), format('update public.payments set amount = 1 where id = %L', zz.id('pay_staff'))));
  perform zz.chk('c-staff-limits', 'staff inserts payment attributed to owner (created_by spoof) -> recorded as staff', '^val:' || zz.id('staff') || '$', zz.val(zz.id('staff'), format(
    'with i as (insert into public.payments (org_id, property_id, lease_id, amount, paid_at, kind, created_by) values (%L, %L, %L, 1, %L, %L, %L) returning created_by) select created_by from i',
    org1, zz.id('prop1'), zz.id('lease1'), '2026-05-01', 'other', zz.id('owner'))));
  perform zz.chk('c-staff-limits', 'staff inserts invoice already status=void -> unpaid', '^val:unpaid$', zz.val(zz.id('staff'), format(
    'with i as (insert into public.invoices (org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date, status) values (%L, %L, %L, %L, %L, %L, 5, 5, %L, %L) returning status) select status from i',
    org1, zz.id('prop1'), zz.id('lease1'), 'INV-VOID-1', '2026-07-01', '2026-07-01', '2026-07-01', 'void')));
  perform zz.chk('c-staff-limits', 'staff adds a property', '^err:42501', zz.att(zz.id('staff'), zz.ins_sql('properties', org1, zz.id('staff'))));
  perform zz.chk('c-staff-limits', 'staff adds a room', '^err:42501', zz.att(zz.id('staff'), zz.ins_sql('rooms', org1, zz.id('staff'))));
  perform zz.chk('c-staff-limits', 'staff adds to the add-on price list', '^err:42501', zz.att(zz.id('staff'), zz.ins_sql('addon_catalog', org1, zz.id('staff'))));
  perform zz.chk('c-staff-limits', 'staff edits own expense', '^ok:0$', zz.att(zz.id('staff'), format('update public.expenses set description = ''sapu lidi'' where id = %L', zz.id('exp_staff'))));
  -- still allowed by design
  perform zz.chk('c-staff-allowed', 'staff cancels a lease (status only)', '^ok:1$', zz.att(zz.id('staff'), format('update public.leases set status = ''cancelled'' where id = %L', zz.id('lease1'))));
  perform zz.chk('c-staff-allowed', 'staff inserts invoice with negative addons_amount (visible in the history)', '^ok:1$', zz.att(zz.id('staff'), format('insert into public.invoices (org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, addons_amount, total_amount, due_date) values (%L, %L, %L, %L, %L, %L, 1500000, -1499999, 1, %L)', org1, zz.id('prop1'), zz.id('lease1'), 'INV-NEG-1', '2026-08-01', '2026-08-31', '2026-08-01')));
  perform zz.chk('c-staff-allowed', 'staff deletes a KTP photo object of org1 (app cleans up after deleting a tenant)', '^ok:1$', zz.att(zz.id('staff'), format('delete from storage.objects where name = %L', org1 || '/budi.jpg')));
  perform zz.chk('c-staff-allowed', 'staff deletes a tenant without leases', '^ok:1$', zz.att(zz.id('staff'), format('delete from public.tenants where id = %L', zz.id('tenant_loose'))));

  ---------------------------------------------------------------- (d) admin (wife) and owner
  perform zz.chk('d-admin', 'admin promotes self to owner', '^err:42501', zz.att(zz.id('admin'), format('update public.organization_members set role = ''owner'' where user_id = %L', zz.id('admin'))));
  perform zz.chk('d-admin', 'admin promotes staff to owner', '^err:42501', zz.att(zz.id('admin'), format('update public.organization_members set role = ''owner'' where user_id = %L', zz.id('staff'))));
  perform zz.chk('d-admin', 'admin demotes owner', '^err:42501', zz.att(zz.id('admin'), format('update public.organization_members set role = ''staff'' where user_id = %L', zz.id('owner'))));
  perform zz.chk('d-admin', 'admin set_member_role(self, owner)', 'Hanya pemilik', zz.att(zz.id('admin'), format('select public.set_member_role(%L, %L, %L)', org1, zz.id('admin'), 'owner')));
  perform zz.chk('d-admin', 'admin set_member_role(owner, staff)', 'Hanya pemilik', zz.att(zz.id('admin'), format('select public.set_member_role(%L, %L, %L)', org1, zz.id('owner'), 'staff')));
  perform zz.chk('d-admin', 'admin remove_member(owner)', 'Hanya pemilik yang dapat menghapus pemilik', zz.att(zz.id('admin'), format('select public.remove_member(%L, %L)', org1, zz.id('owner'))));
  perform zz.chk('d-admin', 'admin DELETE owner row directly', '^err:42501', zz.att(zz.id('admin'), format('delete from public.organization_members where user_id = %L', zz.id('owner'))));
  perform zz.chk('d-admin', 'admin invites someone as owner', 'Peran tidak valid', zz.att(zz.id('admin'), format('select code from public.create_invitation(%L, %L, null)', org1, 'owner')));
  perform zz.chk('d-admin', 'admin INSERT owner-role invitation directly', '^err:42501', zz.att(zz.id('admin'), format('insert into public.invitations (org_id, role) values (%L, %L)', org1, 'owner')));
  perform zz.chk('d-admin', 'admin INSERT member row directly', '^err:42501', zz.att(zz.id('admin'), format('insert into public.organization_members (org_id, user_id, role) values (%L, %L, %L)', org1, zz.id('stranger'), 'owner')));
  perform zz.chk('d-admin', 'admin extends an invitation', '^err:42501', zz.att(zz.id('admin'), 'update public.invitations set expires_at = now() + interval ''1 year'''));
  perform zz.chk('d-admin', 'admin reads invitation code hashes', '^err:42501', zz.val(zz.id('admin'), 'select count(*) from public.invitation_codes'));
  perform zz.chk('d-admin', 'admin can remove staff (normal)', '^ok:1$', zz.att(zz.id('admin'), format('select public.remove_member(%L, %L)', org1, zz.id('staff'))));
  perform zz.chk('d-admin', 'admin cannot remove self', 'diri sendiri', zz.att(zz.id('admin'), format('select public.remove_member(%L, %L)', org1, zz.id('admin'))));
  perform zz.chk('d-admin', 'admin reads the change history', '^val:[1-9]', zz.val(zz.id('admin'), 'select count(*) from public.audit_log'));
  perform zz.chk('d-admin', 'admin deletes history', '^err:42501', zz.att(zz.id('admin'), 'delete from public.audit_log'));
  perform zz.chk('d-admin', 'admin edits history', '^err:42501', zz.att(zz.id('admin'), 'update public.audit_log set new_data = null'));
  perform zz.chk('d-admin', 'admin truncates history', '^err:42501', zz.att(zz.id('admin'), 'truncate public.audit_log'));
  -- owner
  perform zz.chk('d-owner', 'owner promotes admin to owner (set_member_role)', '^ok:1$', zz.att(zz.id('owner'), format('select public.set_member_role(%L, %L, %L)', org1, zz.id('admin'), 'owner')));
  perform zz.chk('d-owner', 'owner promotes admin by direct UPDATE', '^err:42501', zz.att(zz.id('owner'), format('update public.organization_members set role = ''owner'' where user_id = %L', zz.id('admin'))));
  perform zz.chk('d-owner', 'sole owner demotes self -> refused (was possible in v0.2)', 'pemilik terakhir', zz.att(zz.id('owner'), format('select public.set_member_role(%L, %L, %L)', org1, zz.id('owner'), 'staff')));
  perform zz.chk('d-owner', 'sole owner demotes self by direct UPDATE', '^err:42501', zz.att(zz.id('owner'), format('update public.organization_members set role = ''staff'' where user_id = %L', zz.id('owner'))));
  perform zz.chk('d-owner', 'owner rewrites a member row user_id to an uninvited account (was possible in v0.2)', '^err:42501', zz.att(zz.id('owner'), format('update public.organization_members set user_id = %L where user_id = %L', zz.id('stranger'), zz.id('staff'))));
  perform zz.chk('d-owner', 'owner deletes history', '^err:42501', zz.att(zz.id('owner'), 'delete from public.audit_log'));
  perform zz.chk('d-owner', 'owner truncates history', '^err:42501', zz.att(zz.id('owner'), 'truncate public.audit_log'));
  perform zz.chk('d-owner', 'owner deletes the organisation', zz.nothing('organizations', 'DELETE'), zz.att(zz.id('owner'), 'delete from public.organizations'));

  ---------------------------------------------------------------- (e) organisation 2 isolation
  foreach t in array tables[1:13] loop
    perform zz.chk('e-org2', 'org2 owner sees 0 org1 rows in ' || t, '^val:0$', zz.val(zz.id('o2owner'),
      case when t = 'organizations' then format('select count(*) from public.organizations where id = %L', org1)
           else format('select count(*) from public.%I where org_id = %L', t, org1) end));
    perform zz.chk('e-org2', 'org2 owner INSERT ' || t || ' with org_id=org1', '^err:42501', zz.att(zz.id('o2owner'), zz.ins_sql(t, org1, zz.id('o2owner'))));
  end loop;
  -- org_id = org2 but foreign keys pointing into org1
  perform zz.chk('e-org2-fk', 'rooms(org2) -> org1 property', '^err:23503', zz.att(zz.id('o2owner'), format('insert into public.rooms (org_id, property_id, name) values (%L, %L, %L)', zz.id('org2'), zz.id('prop1'), 'R')));
  perform zz.chk('e-org2-fk', 'addon_catalog(org2) -> org1 property', '^err:23503', zz.att(zz.id('o2owner'), format('insert into public.addon_catalog (org_id, property_id, name) values (%L, %L, %L)', zz.id('org2'), zz.id('prop1'), 'W')));
  perform zz.chk('e-org2-fk', 'tenants(org2, passport fields) -> org1 property', '^err:23503', zz.att(zz.id('o2owner'), format('insert into public.tenants (org_id, property_id, full_name, id_type, id_number, nationality) values (%L, %L, %L, %L, %L, %L)', zz.id('org2'), zz.id('prop1'), 'T', 'passport', 'A123', 'AU')));
  perform zz.chk('e-org2-fk', 'leases(org2) -> org1 room/tenant', '^err:23503', zz.att(zz.id('o2owner'), format('insert into public.leases (org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date) values (%L, %L, %L, %L, %L, 1, %L, %L)', zz.id('org2'), zz.id('prop2'), zz.id('room1'), zz.id('tenant1'), 'monthly', '2026-06-01', '2026-06-30')));
  perform zz.chk('e-org2-fk', 'leases(org2) -> org1 room only', '^err:23503', zz.att(zz.id('o2owner'), format('insert into public.leases (org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date) values (%L, %L, %L, %L, %L, 1, %L, %L)', zz.id('org2'), zz.id('prop2'), zz.id('room1'), zz.id('tenant2'), 'monthly', '2026-06-01', '2026-06-30')));
  perform zz.chk('e-org2-fk', 'lease_addons(org2) -> org1 lease', '^err:23503', zz.att(zz.id('o2owner'), format('insert into public.lease_addons (org_id, lease_id, name, amount) values (%L, %L, %L, 1)', zz.id('org2'), zz.id('lease1'), 'A')));
  perform zz.chk('e-org2-fk', 'invoices(org2, period_type) -> org1 lease', '^err:23503', zz.att(zz.id('o2owner'), format('insert into public.invoices (org_id, property_id, lease_id, invoice_number, period_type, period_start, period_end, base_amount, total_amount, due_date) values (%L, %L, %L, %L, %L, %L, %L, 1, 1, %L)', zz.id('org2'), zz.id('prop2'), zz.id('lease1'), 'INV-O2', 'weekly', '2026-06-01', '2026-06-07', '2026-06-01')));
  perform zz.chk('e-org2-fk', 'payments(org2) -> org1 invoice', '^err:23503', zz.att(zz.id('o2owner'), format('insert into public.payments (org_id, property_id, invoice_id, amount, paid_at) values (%L, %L, %L, 1, %L)', zz.id('org2'), zz.id('prop2'), zz.id('inv_unpaid'), '2026-06-01')));
  perform zz.chk('e-org2-fk', 'payments(org2) -> org1 lease (deposit)', '^err:23503', zz.att(zz.id('o2owner'), format('insert into public.payments (org_id, property_id, lease_id, amount, paid_at, kind) values (%L, %L, %L, 1, %L, %L)', zz.id('org2'), zz.id('prop2'), zz.id('lease1'), '2026-06-01', 'deposit')));
  perform zz.chk('e-org2-fk', 'expenses(org2) -> org1 lease (refund)', '^err:23503', zz.att(zz.id('o2owner'), format('insert into public.expenses (org_id, property_id, lease_id, category, amount, expense_date, description) values (%L, %L, %L, %L, 1, %L, %L)', zz.id('org2'), zz.id('prop2'), zz.id('lease1'), 'deposit_refund', '2026-06-01', 'x')));
  perform zz.chk('e-org2-fk', 'expenses(org2) -> org1 property', '^err:23503', zz.att(zz.id('o2owner'), format('insert into public.expenses (org_id, property_id, category, amount, expense_date, description) values (%L, %L, %L, 1, %L, %L)', zz.id('org2'), zz.id('prop1'), 'other', '2026-06-01', 'x')));
  perform zz.chk('e-org2-fk', 'org2 tenant UPDATE property_id -> org1 property', '^err:23503', zz.att(zz.id('o2owner'), format('update public.tenants set property_id = %L where id = %L', zz.id('prop1'), zz.id('tenant2'))));
  perform zz.chk('e-org2', 'org2 owner UPDATE org1 tenants', '^ok:0$', zz.att(zz.id('o2owner'), format('update public.tenants set id_number = ''x'' where org_id = %L', org1)));
  perform zz.chk('e-org2', 'org2 owner DELETE org1 properties', '^ok:0$', zz.att(zz.id('o2owner'), format('delete from public.properties where org_id = %L', org1)));
  perform zz.chk('e-org2', 'org2 owner recalc org1 invoice', 'Tidak memiliki akses', zz.att(zz.id('o2owner'), format('select public.recalc_invoice_status(%L)', zz.id('inv_unpaid'))));
  perform zz.chk('e-org2', 'org2 owner creates an invitation into org1', 'Hanya pemilik/admin', zz.att(zz.id('o2owner'), format('select code from public.create_invitation(%L, %L, null)', org1, 'admin')));
  perform zz.chk('e-org2', 'org2 owner changes roles in org1', 'Hanya pemilik', zz.att(zz.id('o2owner'), format('select public.set_member_role(%L, %L, %L)', org1, zz.id('owner'), 'staff')));
  perform zz.chk('e-org2', 'org2 owner removes the org1 owner', 'Hanya pemilik/admin', zz.att(zz.id('o2owner'), format('select public.remove_member(%L, %L)', org1, zz.id('owner'))));
  perform zz.chk('e-org2', 'org2 owner moves own member row into org1', '^err:42501', zz.att(zz.id('o2owner'), format('update public.organization_members set org_id = %L where user_id = %L', org1, zz.id('o2owner'))));
  perform zz.chk('e-org2', 'org2 owner sets org2 tenant org_id = org1', '^err:(42501|23503|P0001)', zz.att(zz.id('o2owner'), format('update public.tenants set org_id = %L where id = %L', org1, zz.id('tenant2'))));

  ---------------------------------------------------------------- (f) storage
  perform zz.chk('f-storage', 'org2 reads org1 objects', '^val:0$', zz.val(zz.id('o2owner'), format('select count(*) from storage.objects where name like %L', org1 || '/%')));
  perform zz.chk('f-storage', 'org2 sees own object', '^val:1$', zz.val(zz.id('o2owner'), 'select count(*) from storage.objects'));
  perform zz.chk('f-storage', 'org2 uploads into org1 folder', '^err:42501', zz.att(zz.id('o2owner'), format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'ktp', org1 || '/evil.jpg')));
  perform zz.chk('f-storage', 'org2 overwrites org1 object', '^ok:0$', zz.att(zz.id('o2owner'), format('update storage.objects set owner = %L where name like %L', zz.id('o2owner'), org1 || '/%')));
  perform zz.chk('f-storage', 'org2 deletes org1 objects', '^ok:0$', zz.att(zz.id('o2owner'), format('delete from storage.objects where name like %L', org1 || '/%')));
  perform zz.chk('f-storage', 'org2 renames own object into org1 folder', '^err:42501', zz.att(zz.id('o2owner'), format('update storage.objects set name = %L where name = %L', org1 || '/moved.jpg', zz.id('org2') || '/org2.jpg')));
  perform zz.chk('f-storage', 'org1 staff renames org1 object into org2 folder', '^err:42501', zz.att(zz.id('staff'), format('update storage.objects set name = %L where name = %L', zz.id('org2') || '/moved.jpg', org1 || '/budi.jpg')));
  perform zz.chk('f-storage', 'upload with no org prefix', '^err:42501', zz.att(zz.id('owner'), 'insert into storage.objects (bucket_id, name) values (''ktp'', ''budi.jpg'')'));
  perform zz.chk('f-storage', 'upload with non-uuid prefix', '^err:42501', zz.att(zz.id('owner'), 'insert into storage.objects (bucket_id, name) values (''ktp'', ''public/budi.jpg'')'));
  perform zz.chk('f-storage', 'upload into a non-app bucket', '^err:42501', zz.att(zz.id('owner'), format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'other', org1 || '/x.jpg')));
  perform zz.chk('f-storage', 'stranger reads any object', '^val:0$', zz.val(zz.id('stranger'), 'select count(*) from storage.objects'));
  perform zz.chk('f-storage', 'path org1/../org2 is treated as org1 (no traversal effect)', '^ok:1$', zz.att(zz.id('owner'), format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'ktp', org1 || '/../' || zz.id('org2') || '/x.jpg')));
  perform zz.chk('f-storage', 'org2 member cannot upload path org2/../org1 and read it as org1', '^val:0$', zz.val(zz.id('o2owner'), format('select count(*) from storage.objects where name like %L', org1 || '/%')));
  -- kos logos (bucket logos, shown on invoices) follow the same org-folder rule
  perform zz.chk('f-storage', 'org1 owner uploads a kos logo', '^ok:1$', zz.att(zz.id('owner'), format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'logos', org1 || '/logo.png'), true));
  perform zz.chk('f-storage', 'org1 staff reads the logo (the invoice image needs it)', '^val:1$', zz.val(zz.id('staff'), format('select count(*) from storage.objects where bucket_id = %L and name = %L', 'logos', org1 || '/logo.png')));
  perform zz.chk('f-storage', 'org2 reads org1 logo', '^val:0$', zz.val(zz.id('o2owner'), 'select count(*) from storage.objects where bucket_id = ''logos'''));
  perform zz.chk('f-storage', 'org2 deletes org1 logo', '^ok:0$', zz.att(zz.id('o2owner'), format('delete from storage.objects where bucket_id = %L and name = %L', 'logos', org1 || '/logo.png')));
  perform zz.chk('f-storage', 'org2 uploads a logo into org1 folder', '^err:42501', zz.att(zz.id('o2owner'), format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'logos', org1 || '/evil.png')));
  perform zz.chk('f-storage', 'stranger reads any logo', '^val:0$', zz.val(zz.id('stranger'), 'select count(*) from storage.objects where bucket_id = ''logos'''));
  perform zz.chk('f-storage', 'org1 owner removes the logo', '^ok:1$', zz.att(zz.id('owner'), format('delete from storage.objects where bucket_id = %L and name = %L', 'logos', org1 || '/logo.png'), true));

  ---------------------------------------------------------------- (g) column-level: org_id / created_by
  perform zz.chk('g-columns', 'staff (single-org) moves tenant org_id -> org2', '^err:(42501|P0001)', zz.att(zz.id('staff'), format('update public.tenants set org_id = %L where id = %L', zz.id('org2'), zz.id('tenant_loose'))));
  perform zz.chk('g-columns', 'owner (single-org) moves property org_id -> org2', '^err:(42501|23503|P0001)', zz.att(zz.id('owner'), format('update public.properties set org_id = %L where id = %L', zz.id('org2'), zz.id('prop1'))));
  perform zz.chk('g-columns', 'owner moves own payment org_id -> org2', '^err:(42501|23503|P0001)', zz.att(zz.id('owner'), format('update public.payments set org_id = %L where id = %L', zz.id('org2'), zz.id('pay_owner'))));
  perform zz.chk('g-columns-dual', 'dual member (staff org1 + owner org9) moves org1 tenant with property', '^err:(23503|P0001)', zz.att(zz.id('dual'), format('update public.tenants set org_id = %L where id = %L', zz.id('org9'), zz.id('tenant1'))));
  perform zz.chk('g-columns-dual', 'dual member moves org1 tenant without property into own org (was possible in v0.2)', '^err:P0001:Data tidak dapat dipindah', zz.att(zz.id('dual'), format('update public.tenants set org_id = %L where id = %L', zz.id('org9'), zz.id('tenant_loose'))));
  perform zz.chk('g-columns-dual', 'dual member moves org1 payment into own org', '^(ok:0|err:)', zz.att(zz.id('dual'), format('update public.payments set org_id = %L where id = %L', zz.id('org9'), zz.id('pay_owner'))));
  perform zz.chk('g-columns', 'staff rewrites created_by on own payment', '^ok:0$', zz.att(zz.id('staff'), format('update public.payments set created_by = %L where id = %L', zz.id('owner'), zz.id('pay_staff'))));
  perform zz.chk('g-columns', 'staff sets created_by on owner payment to self', '^ok:0$', zz.att(zz.id('staff'), format('update public.payments set created_by = %L where id = %L', zz.id('staff'), zz.id('pay_owner'))));
  perform zz.chk('g-columns', 'staff sets created_by on owner expense to self', '^ok:0$', zz.att(zz.id('staff'), format('update public.expenses set created_by = %L where id = %L', zz.id('staff'), zz.id('exp_owner'))));
  perform zz.chk('g-columns', 'admin changes organizations.created_by -> unchanged', '^val:' || zz.id('owner') || '$', zz.val(zz.id('admin'), format('with u as (update public.organizations set created_by = %L where id = %L returning created_by) select created_by from u', zz.id('admin'), org1)));
  perform zz.chk('g-columns', 'admin changes a payment''s created_by -> unchanged', '^val:' || zz.id('owner') || '$', zz.val(zz.id('admin'), format('with u as (update public.payments set created_by = %L where id = %L returning created_by) select created_by from u', zz.id('admin'), zz.id('pay_owner'))));
  perform zz.chk('g-columns', 'owner moves member row org_id -> org2', '^err:42501', zz.att(zz.id('owner'), format('update public.organization_members set org_id = %L where user_id = %L', zz.id('org2'), zz.id('staff'))));

  ---------------------------------------------------------------- (h) normal work still allowed
  perform zz.chk('h-normal', 'staff reads org1 invoices', '^val:[1-9]', zz.val(zz.id('staff'), 'select count(*) from public.invoices'));
  perform zz.chk('h-normal', 'staff inserts tenant with passport fields', '^ok:1$', zz.att(zz.id('staff'), format('insert into public.tenants (org_id, property_id, full_name, id_type, id_number, nationality, ktp_image_path) values (%L, %L, %L, %L, %L, %L, %L)', org1, zz.id('prop1'), 'John', 'passport', 'N1234567', 'AU', org1 || '/john.jpg')));
  perform zz.chk('h-normal', 'tenant with invalid id_type rejected', '^err:23514', zz.att(zz.id('staff'), format('insert into public.tenants (org_id, full_name, id_type) values (%L, %L, %L)', org1, 'Bad', 'sim')));
  perform zz.chk('h-normal', 'staff inserts invoice with period_type weekly', '^ok:1$', zz.att(zz.id('staff'), format('insert into public.invoices (org_id, property_id, lease_id, invoice_number, period_type, period_start, period_end, base_amount, total_amount, due_date) values (%L, %L, %L, %L, %L, %L, %L, 400000, 400000, %L)', org1, zz.id('prop1'), zz.id('lease1'), 'INV-W-1', 'weekly', '2026-06-01', '2026-06-07', '2026-06-01')));
  perform zz.chk('h-normal', 'invoice with invalid period_type rejected', '^err:23514', zz.att(zz.id('admin'), format('insert into public.invoices (org_id, property_id, lease_id, invoice_number, period_type, period_start, period_end, base_amount, total_amount, due_date) values (%L, %L, %L, %L, %L, %L, %L, 1, 1, %L)', org1, zz.id('prop1'), zz.id('lease1'), 'INV-Y-1', 'yearly', '2026-06-01', '2026-06-07', '2026-06-01')));
  perform zz.chk('h-normal', 'staff records rent payment', '^ok:1$', zz.att(zz.id('staff'), format('insert into public.payments (org_id, property_id, invoice_id, lease_id, amount, paid_at, method) values (%L, %L, %L, %L, 700000, %L, %L)', org1, zz.id('prop1'), zz.id('inv_unpaid'), zz.id('lease1'), '2026-05-02', 'transfer')));
  perform zz.chk('h-normal', 'staff records expense', '^ok:1$', zz.att(zz.id('staff'), format('insert into public.expenses (org_id, property_id, category, amount, expense_date, description) values (%L, %L, %L, 20000, %L, %L)', org1, zz.id('prop1'), 'supplies', '2026-05-02', 'lampu')));
  perform zz.chk('h-normal', 'staff extends a lease', '^ok:1$', zz.att(zz.id('staff'), format('update public.leases set end_date = ''2026-06-30'' where id = %L', zz.id('lease1'))));
  perform zz.chk('h-normal', 'staff checks a tenant out', '^ok:1$', zz.att(zz.id('staff'), format('update public.leases set status = ''ended'', checkout_date = ''2026-03-20'', end_date = ''2026-03-20'' where id = %L', zz.id('lease1'))));
  perform zz.chk('h-normal', 'staff moves a tenant to another room', '^ok:1$', zz.att(zz.id('staff'), format('update public.leases set room_id = %L where id = %L', zz.id('room2'), zz.id('lease1'))));
  perform zz.chk('h-normal', 'staff sets a room to maintenance', '^ok:1$', zz.att(zz.id('staff'), format('update public.rooms set status = ''maintenance'' where id = %L', zz.id('room2'))));
  perform zz.chk('h-normal', 'staff adds a lease add-on', '^ok:1$', zz.att(zz.id('staff'), zz.ins_sql('lease_addons', org1, zz.id('staff'))));
  perform zz.chk('h-normal', 'staff uploads KTP/passport photo in org1 folder', '^ok:1$', zz.att(zz.id('staff'), format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'ktp', org1 || '/john.jpg')));
  perform zz.chk('h-normal', 'staff reads org1 objects (signed URL needs select)', '^val:[1-9]', zz.val(zz.id('staff'), 'select count(*) from storage.objects'));
  perform zz.chk('h-normal', 'admin changes invoice period_type (period switch)', '^ok:1$', zz.att(zz.id('admin'), format('update public.invoices set period_type = ''daily'' where id = %L', zz.id('inv_unpaid'))));
  perform zz.chk('h-normal', 'admin voids unpaid invoice', '^ok:1$', zz.att(zz.id('admin'), format('update public.invoices set status = ''void'' where id = %L', zz.id('inv_unpaid'))));
  perform zz.chk('h-normal', 'admin deletes own-org expense', '^ok:1$', zz.att(zz.id('admin'), format('delete from public.expenses where id = %L', zz.id('exp_staff'))));
  perform zz.chk('h-normal', 'admin corrects a payment', '^ok:1$', zz.att(zz.id('admin'), format('update public.payments set amount = 90000 where id = %L', zz.id('pay_staff'))));
  perform zz.chk('h-normal', 'admin changes a room price', '^ok:1$', zz.att(zz.id('admin'), format('update public.rooms set price_monthly = 1600000 where id = %L', zz.id('room1'))));
  perform zz.chk('h-normal', 'admin changes the agreed lease price', '^ok:1$', zz.att(zz.id('admin'), format('update public.leases set price_per_period = 1400000 where id = %L', zz.id('lease1'))));
  perform zz.chk('h-normal', 'admin adds a property, a room and an add-on', '^ok:1$', zz.att(zz.id('admin'), format(
    'with p as (insert into public.properties (org_id, name) values (%L, %L) returning id, org_id), r as (insert into public.rooms (org_id, property_id, name) select org_id, id, %L from p) insert into public.addon_catalog (org_id, name) values (%L, %L)',
    org1, 'Kos Baru', 'Z1', org1, 'Laundry')));
  perform zz.chk('h-normal', 'admin creates a staff invitation code', '^val:[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$', zz.val(zz.id('admin'), format('select code from public.create_invitation(%L, %L, %L)', org1, 'staff', 'Penjaga malam')));
  perform zz.chk('h-normal', 'a new account joins with the pending code', '^val:' || org1 || '$', zz.join(zz.id('newbie'), zz.code('pending')));
  perform zz.chk('h-normal', 'owner changes staff role to admin', '^ok:1$', zz.att(zz.id('owner'), format('select public.set_member_role(%L, %L, %L)', org1, zz.id('staff'), 'admin')));
  perform zz.chk('h-normal', 'owner ensure_membership returns org1', '^val:' || org1 || '$', zz.val(zz.id('owner'), 'select public.ensure_membership()'));
  perform zz.chk('h-normal', 'dual member ensure_membership picks owned org (org9), not the family org', '^val:' || zz.id('org9') || '$', zz.val(zz.id('dual'), 'select public.ensure_membership()'));
end $$;

-- persistent payment flow (kept, then verified): a staff payment drives the invoice status via trigger
select zz.att(zz.id('staff'), format('insert into public.payments (org_id, property_id, invoice_id, lease_id, amount, paid_at) values (%L, %L, %L, %L, 1500000, %L)', zz.id('org1'), zz.id('prop1'), zz.id('inv_unpaid'), zz.id('lease1'), '2026-05-03'), true) as kept_payment;
select zz.chk('h-normal', 'invoice becomes paid after staff payment (trigger, no UPDATE right needed)', '^val:paid$', zz.val(zz.id('staff'), format('select status from public.invoices where id = %L', zz.id('inv_unpaid'))));
select zz.chk('h-normal', '... and the history shows who recorded it', '^val:1$', zz.val(zz.id('owner'), format(
  'select count(*) from public.audit_log where table_name = ''payments'' and action = ''insert'' and changed_by = %L and (new_data ->> ''amount'')::bigint = 1500000', zz.id('staff'))));

-- (e/f) a decoy row pointing at another organisation's file must not delete that file
select zz.att(zz.id('o2owner'), format('insert into public.tenants (id, org_id, property_id, full_name, ktp_image_path) values (%L, %L, %L, %L, %L)', 'a0000000-0000-0000-0000-0000000000ff', zz.id('org2'), zz.id('prop2'), 'Decoy', zz.id('org1') || '/budi.jpg'), true) as decoy_insert;
select zz.chk('e-org2-storage', 'org2 tenant may store a path pointing into org1 folder', '^val:1$', zz.val(zz.id('o2owner'), format('select count(*) from public.tenants where ktp_image_path like %L', zz.id('org1') || '/%')));
select zz.att(zz.id('o2owner'), 'delete from public.tenants where id = ''a0000000-0000-0000-0000-0000000000ff''', true) as decoy_delete;
select zz.chk('e-org2-storage', 'org1 KTP object still exists after org2 deletes decoy tenant', '^1$', (select count(*)::text from storage.objects where name = zz.id('org1') || '/budi.jpg'));
select zz.att(zz.id('o2owner'), format('insert into public.expenses (id, org_id, property_id, category, amount, expense_date, description, receipt_path) values (%L, %L, %L, %L, 1, %L, %L, %L)', 'a0000000-0000-0000-0000-0000000000fe', zz.id('org2'), zz.id('prop2'), 'other', '2026-06-01', 'decoy', zz.id('org1') || '/nota.jpg'), true) as decoy_exp;
select zz.att(zz.id('o2owner'), 'delete from public.expenses where id = ''a0000000-0000-0000-0000-0000000000fe''', true) as decoy_exp_delete;
select zz.chk('e-org2-storage', 'org1 receipt object still exists after org2 deletes decoy expense', '^1$', (select count(*)::text from storage.objects where name = zz.id('org1') || '/nota.jpg'));

-- (b) signing up with an address that used to be invited by email gives nothing any more
insert into auth.users (id, email) values ('77777777-7777-7777-7777-777777777777', 'PENDING@example.com');
select zz.chk('b-invite', 'signup with an email-invited address joins nothing (v0.2: joined as admin)', '^none$',
  coalesce((select role from public.organization_members where user_id = '77777777-7777-7777-7777-777777777777'), 'none'));
select zz.chk('b-invite', '... and ensure_membership says to enter a code', '^err:WB001', zz.val('77777777-7777-7777-7777-777777777777', 'select public.ensure_membership()'));
