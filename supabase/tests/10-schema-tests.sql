\set ON_ERROR_STOP on
create or replace function t(k text) returns text language sql stable as $$ select current_setting('t.' || k, true) $$;
-- helper to act as a given user
create or replace function test_login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  perform set_config('role', case when p_user is null then 'anon' else 'authenticated' end, false);
end $$;

-- 1. first signup creates the org (trigger)
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@example.com');
do $$ begin
  if (select count(*) from public.organizations) <> 1 then raise exception 'first signup must create one org'; end if;
  if (select role from public.organization_members where user_id = '11111111-1111-1111-1111-111111111111') <> 'owner' then raise exception 'first user must be owner'; end if;
end $$;

-- 2. stranger signup: no org, no membership
insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'stranger@example.com');
do $$ begin
  if (select count(*) from public.organizations) <> 1 then raise exception 'stranger must not get an org'; end if;
  if exists (select 1 from public.organization_members where user_id = '22222222-2222-2222-2222-222222222222') then raise exception 'stranger must not be a member'; end if;
end $$;

-- 3. stranger calls ensure_membership -> error with Indonesian message
select test_login('22222222-2222-2222-2222-222222222222');
do $$ begin
  begin
    perform public.ensure_membership();
    raise exception 'stranger ensure_membership should fail';
  exception when others then
    if position('belum menjadi anggota' in sqlerrm) = 0 then raise; end if;
  end;
end $$;
-- stranger cannot create an organisation through the API
do $$ begin
  begin
    insert into public.organizations (name, created_by) values ('Hijack', '22222222-2222-2222-2222-222222222222');
    raise exception 'stranger must not insert organizations';
  exception when insufficient_privilege or others then
    if sqlerrm like '%must not insert%' then raise; end if;
  end;
end $$;
reset role;

-- 4. owner invites wife (not yet registered) and the stranger (registered) -> both become invitations, nobody auto-added
select test_login('11111111-1111-1111-1111-111111111111');
select public.ensure_membership() as owner_org \gset
select set_config('t.owner_org', :'owner_org', false);
select public.add_member_by_email(t('owner_org')::uuid, 'Wife@Example.com', 'admin') as r1 \gset
select set_config('t.r1', :'r1', false);
select public.add_member_by_email(t('owner_org')::uuid, 'stranger@example.com', 'staff') as r2 \gset
select set_config('t.r2', :'r2', false);
do $$ begin
  if t('r1') <> 'invited' or t('r2') <> 'invited' then raise exception 'both should be invited, got % %', t('r1'), t('r2'); end if;
  if (select count(*) from public.organization_members where org_id = t('owner_org')::uuid) <> 1 then raise exception 'no silent auto-add'; end if;
end $$;
reset role;

-- 5. wife signs up -> joins via trigger; stranger logs in -> joins via ensure_membership
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333', 'wife@example.com');
select test_login('22222222-2222-2222-2222-222222222222');
select public.ensure_membership() as stranger_org \gset
select set_config('t.stranger_org', :'stranger_org', false);
reset role;
do $$ begin
  if (select role from public.organization_members where user_id = '33333333-3333-3333-3333-333333333333') <> 'admin' then raise exception 'wife should be admin'; end if;
  if (select role from public.organization_members where user_id = '22222222-2222-2222-2222-222222222222') <> 'staff' then raise exception 'stranger should be staff'; end if;
  if t('stranger_org') <> t('owner_org') then raise exception 'stranger must join the owner org'; end if;
  if exists (select 1 from public.invitations where accepted_at is null) then raise exception 'invitations should be accepted'; end if;
end $$;

-- 6. business rows under RLS as owner
select test_login('11111111-1111-1111-1111-111111111111');
insert into public.properties (org_id, name) values (t('owner_org')::uuid, 'Kos Melati') returning id as prop \gset
select set_config('t.prop', :'prop', false);
insert into public.rooms (org_id, property_id, name, price_monthly) values (t('owner_org')::uuid, t('prop')::uuid, 'A1', 1500000) returning id as room \gset
select set_config('t.room', :'room', false);
insert into public.tenants (org_id, property_id, full_name) values (t('owner_org')::uuid, t('prop')::uuid, 'Budi') returning id as tenant \gset
select set_config('t.tenant', :'tenant', false);
insert into public.leases (org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date)
  values (t('owner_org')::uuid, t('prop')::uuid, t('room')::uuid, t('tenant')::uuid, 'monthly', 1500000, '2026-03-01', '2026-03-31') returning id as lease \gset
select set_config('t.lease', :'lease', false);
insert into public.invoices (org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date)
  values (t('owner_org')::uuid, t('prop')::uuid, t('lease')::uuid, 'INV-202603-0001', '2026-03-01', '2026-03-31', 1500000, 1500000, '2026-03-01') returning id as inv \gset
select set_config('t.inv', :'inv', false);
-- total check: components must explain the total
do $$ begin
  begin
    insert into public.invoices (org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date)
      values (t('owner_org')::uuid, t('prop')::uuid, t('lease')::uuid, 'INV-202603-0002', '2026-04-01', '2026-04-30', 1500000, 1400000, '2026-04-01');
    raise exception 'total check should fail';
  exception when check_violation then null; end;
end $$;
-- payment -> partial -> paid via triggers
insert into public.payments (org_id, property_id, invoice_id, lease_id, amount, paid_at) values (t('owner_org')::uuid, t('prop')::uuid, t('inv')::uuid, t('lease')::uuid, 500000, '2026-03-01');
do $$ begin if (select status from public.invoices where id = t('inv')::uuid) <> 'partial' then raise exception 'expected partial'; end if; end $$;
insert into public.payments (org_id, property_id, invoice_id, lease_id, amount, paid_at) values (t('owner_org')::uuid, t('prop')::uuid, t('inv')::uuid, t('lease')::uuid, 1000000, '2026-03-05');
do $$ begin if (select status from public.invoices where id = t('inv')::uuid) <> 'paid' then raise exception 'expected paid'; end if; end $$;
-- created_by filled from auth.uid()
do $$ begin if (select count(*) from public.payments where created_by = '11111111-1111-1111-1111-111111111111') <> 2 then raise exception 'created_by not set'; end if; end $$;
-- rent payment without invoice rejected; deposit with invoice rejected
do $$ begin
  begin
    insert into public.payments (org_id, property_id, lease_id, amount, paid_at, kind) values (t('owner_org')::uuid, t('prop')::uuid, t('lease')::uuid, 1, '2026-03-01', 'rent');
    raise exception 'rent without invoice should fail';
  exception when check_violation then null; end;
  begin
    insert into public.payments (org_id, property_id, invoice_id, lease_id, amount, paid_at, kind) values (t('owner_org')::uuid, t('prop')::uuid, t('inv')::uuid, t('lease')::uuid, 1, '2026-03-01', 'deposit');
    raise exception 'deposit with invoice should fail';
  exception when check_violation then null; end;
end $$;
-- void guard: paid invoice cannot be voided; total below paid rejected
do $$ begin
  begin
    update public.invoices set status = 'void' where id = t('inv')::uuid;
    raise exception 'void guard should fail';
  exception when others then if sqlerrm not like '%pembayarannya%' then raise; end if; end;
  begin
    update public.invoices set total_amount = 100, base_amount = 100 where id = t('inv')::uuid;
    raise exception 'total below paid should fail';
  exception when others then if sqlerrm not like '%lebih kecil%' then raise; end if; end;
end $$;
-- restrict: cannot delete invoice with payments, nor lease with invoices
do $$ begin
  begin delete from public.invoices where id = t('inv')::uuid; raise exception 'delete invoice should fail';
  exception when foreign_key_violation then null; end;
  begin delete from public.leases where id = t('lease')::uuid; raise exception 'delete lease should fail';
  exception when foreign_key_violation then null; end;
end $$;
-- refund expense requires lease_id
do $$ begin
  begin
    insert into public.expenses (org_id, property_id, category, amount, expense_date, description) values (t('owner_org')::uuid, t('prop')::uuid, 'deposit_refund', 100, '2026-03-31', 'x');
    raise exception 'refund without lease should fail';
  exception when check_violation then null; end;
end $$;
insert into public.expenses (org_id, property_id, lease_id, category, amount, expense_date, description) values (t('owner_org')::uuid, t('prop')::uuid, t('lease')::uuid, 'deposit_refund', 100, '2026-03-31', 'ok');
reset role;

-- 7. staff restrictions
select test_login('22222222-2222-2222-2222-222222222222');
do $$ begin
  -- can read
  if (select count(*) from public.invoices) <> 1 then raise exception 'staff should read invoices'; end if;
  -- cannot update invoices (RLS: zero rows affected, no error)
  update public.invoices set notes = 'x' where id = t('inv')::uuid;
  if (select notes from public.invoices where id = t('inv')::uuid) = 'x' then raise exception 'staff must not update invoices'; end if;
  -- cannot delete payments
  delete from public.payments where invoice_id = t('inv')::uuid;
  if (select count(*) from public.payments where invoice_id = t('inv')::uuid) <> 2 then raise exception 'staff must not delete payments'; end if;
  -- cannot promote self
  update public.organization_members set role = 'owner' where user_id = auth.uid();
  if (select role from public.organization_members where user_id = auth.uid()) <> 'staff' then raise exception 'staff must not change roles'; end if;
  -- cannot invite
  begin perform public.add_member_by_email(t('owner_org')::uuid, 'x@y.z', 'staff'); raise exception 'staff must not invite';
  exception when others then if sqlerrm not like '%Hanya pemilik/admin%' then raise; end if; end;
end $$;
-- staff can record a payment (trigger keeps status consistent without invoice UPDATE rights)
insert into public.invoices (org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date)
  values (t('owner_org')::uuid, t('prop')::uuid, t('lease')::uuid, 'INV-202604-0001', '2026-04-01', '2026-04-30', 1500000, 1500000, '2026-04-01') returning id as inv2 \gset
select set_config('t.inv2', :'inv2', false);
insert into public.payments (org_id, property_id, invoice_id, lease_id, amount, paid_at) values (t('owner_org')::uuid, t('prop')::uuid, t('inv2')::uuid, t('lease')::uuid, 1500000, '2026-04-01');
do $$ begin if (select status from public.invoices where id = t('inv2')::uuid) <> 'paid' then raise exception 'trigger must mark paid for staff payment'; end if; end $$;
reset role;

-- 8. anon sees nothing and cannot call RPCs
select test_login(null);
do $$ begin
  begin perform count(*) from public.properties; raise exception 'anon must not select';
  exception when insufficient_privilege then null; end;
  begin perform public.ensure_membership(); raise exception 'anon must not call ensure_membership';
  exception when insufficient_privilege then null; when others then if sqlerrm not like '%Belum masuk%' then raise; end if; end;
end $$;
reset role;

-- 9. cross-org reference impossible: second org cannot point a payment at org1 invoice
-- (create a second org directly as superuser to simulate a second family on the same project)
insert into public.organizations (id, name, created_by) values ('99999999-9999-9999-9999-999999999999', 'Other', '22222222-2222-2222-2222-222222222222');
insert into public.organization_members (org_id, user_id, email, role) values ('99999999-9999-9999-9999-999999999999', '22222222-2222-2222-2222-222222222222', 'stranger@example.com', 'owner');
insert into public.properties (id, org_id, name) values ('88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999', 'Other kos');
select test_login('22222222-2222-2222-2222-222222222222');
do $$ begin
  begin
    insert into public.payments (org_id, property_id, invoice_id, lease_id, amount, paid_at)
      values ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888', t('inv')::uuid, t('lease')::uuid, 1, '2026-03-01');
    raise exception 'cross-org payment should fail';
  exception when foreign_key_violation then null; end;
end $$;
reset role;

-- 10. storage policy helper and bucket rows
do $$ begin
  if public.path_org_id('not-a-uuid/file.jpg') is not null then raise exception 'bad path should be null'; end if;
  if public.path_org_id(t('owner_org') || '/t1.jpg') <> t('owner_org')::uuid then raise exception 'path org id'; end if;
  if (select count(*) from storage.buckets where id in ('ktp','receipts')) <> 2 then raise exception 'buckets missing'; end if;
end $$;
select 'ALL SCHEMA TESTS PASSED' as result;
