-- After schema.sql ran over a v0.2 installation with data (fixtures/schema-v0.2.sql + fixtures/seed-v0.2.sql).
\set ON_ERROR_STOP on
select set_config('zz.suite', '11-upgrade', false);
select zz.check_structure('upgrade-structure');

do $$
declare
  org uuid := zz.id('v2org');
  o uuid := zz.id('v2owner');
  c text;
begin
  -- data kept
  perform zz.eq('upgrade-data', 'members kept with their roles', 'owner@example.com:owner,staff@example.com:staff,wife@example.com:admin',
    (select string_agg(email || ':' || role, ',' order by email) from public.organization_members));
  perform zz.eq('upgrade-data', 'business rows kept', '1/1/1/1/1/2/1', (select (select count(*) from public.properties) || '/' || (select count(*) from public.rooms) || '/' ||
    (select count(*) from public.tenants) || '/' || (select count(*) from public.leases) || '/' || (select count(*) from public.invoices) || '/' ||
    (select count(*) from public.payments) || '/' || (select count(*) from public.expenses)));
  perform zz.eq('upgrade-data', 'payment authors kept', '400000:' || o || ',600000:' || zz.id('v2staff'),
    (select string_agg(amount || ':' || created_by, ',' order by amount) from public.payments));
  perform zz.eq('upgrade-data', 'invoice status kept', 'paid', (select status from public.invoices));
  perform zz.eq('upgrade-data', 'storage objects kept', '2', (select count(*)::text from storage.objects));
  perform zz.ok('upgrade-data', 'properties.logo_path added, empty for the old kos', (select logo_path is null from public.properties));
  perform zz.eq('upgrade-data', 'owner can set a kos logo on the old kos', 'ok:1', zz.att(o, format('update public.properties set logo_path = %L', org || '/logo.png')));
  perform zz.eq('upgrade-data', 'owner uploads into the new logos bucket', 'ok:1', zz.att(o, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'logos', org || '/logo.png')));
  perform zz.eq('upgrade-data', 'no history for old rows', '0', (select count(*)::text from public.audit_log));
  -- v0.2 email invitations
  perform zz.eq('upgrade-invitations', 'accepted email invitations kept', '2', (select count(*)::text from public.invitations where accepted_at is not null and email is not null));
  perform zz.ok('upgrade-invitations', 'the pending email invitation is expired (it has no code)',
    (select expires_at <= now() and accepted_at is null from public.invitations where email = 'later@example.com'));
  perform zz.eq('upgrade-invitations', 'old invitations have no code', '0', (select count(*)::text from public.invitation_codes));
  insert into auth.users (id, email) values (zz.id('v2later'), 'later@example.com');
  perform zz.eq('upgrade-invitations', 'signing up with the invited email no longer joins', '0',
    (select count(*)::text from public.organization_members where user_id = zz.id('v2later')));
  perform zz.chk('upgrade-invitations', '... ensure_membership asks for a code', '^err:WB001', zz.val(zz.id('v2later'), 'select public.ensure_membership()'));
  -- the upgraded installation works the v0.3 way
  perform zz.eq('upgrade-flows', 'owner ensure_membership', 'val:' || org, zz.val(o, 'select public.ensure_membership()'));
  perform zz.eq('upgrade-flows', 'the expired email invitation does not count toward the limit', '0',
    (select count(*)::text from public.invitations where accepted_at is null and expires_at > now()));
  c := zz.invite('v2later', zz.id('v2wife'), org, 'staff', 'Later');
  perform zz.eq('upgrade-flows', 'the admin from v0.2 makes a code; the invited person joins with it', 'val:' || org, zz.join(zz.id('v2later'), c));
  perform zz.chk('upgrade-flows', 'a setup code cannot create a second organisation', '^val:Kode disimpan, tetapi organisasi sudah ada', zz.su('select public.set_setup_code(''UPGRADE1'')', true));
  perform zz.eq('upgrade-flows', '... joining with it -> null', 'val:NULL', zz.join(zz.id('v2later'), 'UPGRADE1'));
  perform zz.chk('upgrade-flows', 'staff from v0.2 can no longer edit own payment', '^ok:0$', zz.att(zz.id('v2staff'), 'update public.payments set amount = 1'));
  perform zz.chk('upgrade-flows', 'staff from v0.2 cannot change a room price', 'harga kamar', zz.att(zz.id('v2staff'), 'update public.rooms set price_monthly = 1'));
  perform zz.eq('upgrade-flows', 'owner changes are now logged', 'ok:1', zz.att(o, 'update public.properties set name = ''Kos Lama Baru''', true));
  perform zz.ok('upgrade-flows', '... in the history', exists (select 1 from public.audit_log where table_name = 'properties' and changed_by = o
    and old_data ->> 'name' = 'Kos Lama' and new_data ->> 'name' = 'Kos Lama Baru'));
end $$;
