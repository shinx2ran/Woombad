-- Functional tests for the v0.3 flows: setup code, invitation codes, rate limit, roles, staff limits,
-- invoice triggers, audit log, storage. Starts from an empty project (zz.reset_data).
\set ON_ERROR_STOP on
select set_config('zz.suite', '10-schema', false);
select zz.reset_data();

select zz.user('early', '99999999-9999-9999-9999-999999999999', 'early@evil.test');
select zz.user('owner', '11111111-1111-1111-1111-111111111111', 'owner@example.com');
select zz.user('staff', '22222222-2222-2222-2222-222222222222', 'staff@example.com');
select zz.user('wife', '33333333-3333-3333-3333-333333333333', 'wife@example.com');
select zz.user('stranger', '44444444-4444-4444-4444-444444444444', 'stranger@example.com');
select zz.user('racer', '55555555-5555-5555-5555-555555555551', 'racer@example.com');
select zz.user('racer2', '55555555-5555-5555-5555-555555555552', 'racer2@example.com');
select zz.user('guesser', '66666666-6666-6666-6666-666666666666', 'guesser@example.com');

-- 1. Signing up gives no access by itself (an attacker who signs up first gets nothing)
do $$ begin
  perform zz.eq('signup', 'signing up creates no organisation', '0', (select count(*)::text from public.organizations));
  perform zz.eq('signup', 'signing up creates no membership', '0', (select count(*)::text from public.organization_members));
  perform zz.eq('signup', 'ensure_membership without membership -> WB001 + Indonesian message',
    'err:WB001:Akun ini belum menjadi anggota. Masukkan kode dari pemilik kos.', zz.val(zz.id('early'), 'select public.ensure_membership()'));
  perform zz.chk('signup', 'anon cannot call ensure_membership', '^err:42501', zz.val(null, 'select public.ensure_membership()'));
  perform zz.chk('signup', 'anon cannot call join_with_code', '^err:42501', zz.val(null, 'select public.join_with_code(''ABCDEFGH'')'));
  perform zz.eq('signup', 'join before any setup code exists -> null', 'val:NULL', zz.join(zz.id('early'), 'ABCD-EFGH'));
  perform zz.eq('signup', '... and still no organisation', '0', (select count(*)::text from public.organizations));
end $$;

-- 2. Setup code (operator only)
do $$ begin
  perform zz.chk('setup-code', 'authenticated cannot call set_setup_code', '^err:42501', zz.val(zz.id('owner'), 'select public.set_setup_code(''ABCD-EFGH'')'));
  perform zz.chk('setup-code', 'anon cannot call set_setup_code', '^err:42501', zz.val(null, 'select public.set_setup_code(''ABCD-EFGH'')'));
  perform zz.chk('setup-code', 'authenticated cannot read app_settings', '^err:42501', zz.val(zz.id('owner'), 'select count(*) from public.app_settings'));
  perform zz.chk('setup-code', 'authenticated cannot write app_settings', '^err:42501', zz.att(zz.id('owner'), 'update public.app_settings set setup_code_used_at = null'));
  perform zz.chk('setup-code', 'shorter than 8 after normalising -> refused', 'minimal 8 huruf/angka', zz.su('select public.set_setup_code(''ab-cd 12'')'));
  perform zz.chk('setup-code', 'operator sets the code', '^val:Kode pemilik disimpan', zz.su('select public.set_setup_code('' woom-bad 7k '')', true));
  perform zz.eq('setup-code', 'stored as sha256 hex of the normalised code', encode(sha256(convert_to('WOOMBAD7K', 'UTF8')), 'hex'),
    (select setup_code_hash from public.app_settings));
  perform zz.ok('setup-code', 'setup_code_used_at is empty', (select setup_code_used_at is null from public.app_settings));
  perform zz.eq('setup-code', 'a wrong code -> null', 'val:NULL', zz.join(zz.id('early'), 'WOOM-BAD7X'));
end $$;

-- 3. Two people enter the setup code at the same moment: exactly one becomes the owner
select zz.dbl_open('c1', zz.id('owner'));
select set_config('zz.pid', zz.dbl_open('c2', zz.id('wife'))::text, false);
select zz.dblink_exec('c1', 'begin');
select zz.chk('setup-race', 'first person joins with the setup code (transaction still open)', '^[0-9a-f-]{36}$',
  (select r from zz.dblink('c1', 'select public.join_with_code(''woom-bad7k'')::text') as t(r text)));
select zz.dblink_send_query('c2', 'select public.join_with_code(''WOOMBAD7K'')::text');
select zz.eq('setup-race', 'second person waits for the first (row lock on app_settings)', 'Lock', zz.wait_for_lock(current_setting('zz.pid')::int));
select zz.dblink_exec('c1', 'commit');
select zz.eq('setup-race', 'second person gets null once the first commits', 'NULL',
  (select coalesce(r, 'NULL') from zz.dblink_get_result('c2') as t(r text)));
select * from zz.dblink_get_result('c2') as t(r text);
select zz.dblink_disconnect('c1'), zz.dblink_disconnect('c2');
insert into zz.ids select 'org1', id from public.organizations;
do $$ begin
  perform zz.eq('setup-race', 'exactly one organisation', '1', (select count(*)::text from public.organizations));
  perform zz.eq('setup-race', 'named Kos Saya, created by the owner', 'Kos Saya/' || zz.id('owner'), (select name || '/' || created_by from public.organizations));
  perform zz.eq('setup-race', 'only the owner is a member, with the email of the account', 'owner@example.com:owner',
    (select string_agg(email || ':' || role, ',') from public.organization_members));
  perform zz.ok('setup-race', 'setup code marked used', (select setup_code_used_at is not null from public.app_settings));
  perform zz.eq('setup-race', 'the second person has one failed attempt', '1', (select count(*)::text from public.join_attempts where user_id = zz.id('wife')));
  perform zz.eq('setup-code', 'the setup code cannot be used again', 'val:NULL', zz.join(zz.id('stranger'), 'WOOMBAD7K'));
  perform zz.chk('setup-code', 'operator resets the code once an organisation exists -> warned', 'organisasi sudah ada', zz.su('select public.set_setup_code(''WOOMBAD7K'')', true));
  perform zz.eq('setup-code', '... and it cannot create a second organisation', 'val:NULL', zz.join(zz.id('early'), 'WOOMBAD7K'));
  perform zz.eq('setup-code', 'still one organisation', '1', (select count(*)::text from public.organizations));
  perform zz.eq('setup-code', 'owner: ensure_membership returns the organisation', 'val:' || zz.id('org1'), zz.val(zz.id('owner'), 'select public.ensure_membership()'));
  perform zz.chk('setup-code', 'the early sign-up is still not a member', '^err:WB001', zz.val(zz.id('early'), 'select public.ensure_membership()'));
end $$;

-- 4. Invitation codes
do $$
declare c text;
begin
  c := zz.invite('wife', zz.id('owner'), zz.id('org1'), 'admin', '  Istri  ');
  perform zz.chk('invite', 'code is 8 characters from the alphabet', '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$', c);
  perform zz.eq('invite', 'label trimmed, role, invited_by, no email, pending', 'Istri|admin|' || zz.id('owner') || '|-|pending',
    (select label || '|' || role || '|' || invited_by || '|' || coalesce(email, '-') || '|' || coalesce(accepted_at::text, 'pending')
       from public.invitations where org_id = zz.id('org1')));
  perform zz.ok('invite', 'expires in 7 days', (select expires_at between now() + interval '7 days' - interval '1 minute'
                                                   and now() + interval '7 days' + interval '1 minute' from public.invitations));
  perform zz.eq('invite', 'only the sha256 hex of the code is stored', encode(sha256(convert_to(c, 'UTF8')), 'hex'), (select code_hash from public.invitation_codes));
  perform zz.ok('invite', 'the invitation row does not contain the code', not exists (select 1 from public.invitations i where to_jsonb(i)::text like '%' || c || '%'));
  perform zz.chk('invite', 'owner cannot read invitation_codes', '^err:42501', zz.val(zz.id('owner'), 'select count(*) from public.invitation_codes'));
  perform zz.chk('invite', 'create_invitation also returns expires_at (7 days ahead)', '^val:(t|true)$', zz.val(zz.id('owner'), format(
    'select (select expires_at from public.create_invitation(%L, %L, null)) > now() + interval ''6 days''', zz.id('org1'), 'staff')));
  -- typed in lower case with a dash, like the screen shows it
  perform zz.eq('invite', 'join_with_code returns the organisation', 'val:' || zz.id('org1'),
    zz.join(zz.id('wife'), lower(substr(c, 1, 4)) || '-' || lower(substr(c, 5))));
  perform zz.eq('invite', 'wife is admin, with her account email', 'admin|wife@example.com',
    (select role || '|' || email from public.organization_members where user_id = zz.id('wife')));
  perform zz.eq('invite', 'invitation accepted by wife', zz.id('wife')::text, (select accepted_by::text from public.invitations where label = 'Istri' and accepted_at is not null));
  perform zz.eq('invite', 'the same code cannot be used twice', 'val:NULL', zz.join(zz.id('stranger'), c));
  perform zz.chk('invite', 'the stranger is still not a member', '^err:WB001', zz.val(zz.id('stranger'), 'select public.ensure_membership()'));
  -- validation
  perform zz.chk('invite', 'label longer than 60 characters refused', 'maksimal 60 karakter', zz.val(zz.id('owner'),
    format('select code from public.create_invitation(%L, %L, %L)', zz.id('org1'), 'staff', repeat('x', 61))));
  perform zz.chk('invite', 'label of 60 characters accepted', '^val:[A-Z0-9]{8}$', zz.val(zz.id('owner'),
    format('select code from public.create_invitation(%L, %L, %L)', zz.id('org1'), 'staff', '  ' || repeat('x', 60) || '  ')));
  c := zz.invite('blank', zz.id('owner'), zz.id('org1'), 'staff', E' \t\n ');
  perform zz.ok('invite', 'blank label (spaces, tab, newline) stored as null', (select i.label is null from public.invitations i join public.invitation_codes ic on ic.invitation_id = i.id
                                                         where ic.code_hash = encode(sha256(convert_to(c, 'UTF8')), 'hex')));
  perform zz.chk('invite', 'role owner refused', 'Peran tidak valid', zz.val(zz.id('owner'), format('select code from public.create_invitation(%L, %L, null)', zz.id('org1'), 'owner')));
  perform zz.chk('invite', 'role null refused', 'Peran tidak valid', zz.val(zz.id('owner'), format('select code from public.create_invitation(%L, null, null)', zz.id('org1'))));
  perform zz.chk('invite', 'non-member cannot create invitations', 'Hanya pemilik/admin', zz.val(zz.id('stranger'), format('select code from public.create_invitation(%L, %L, null)', zz.id('org1'), 'staff')));
  perform zz.chk('invite', 'anon cannot create invitations', '^err:42501', zz.val(null, format('select code from public.create_invitation(%L, %L, null)', zz.id('org1'), 'staff')));
end $$;

do $$
declare c text;
begin
  c := zz.invite('staff', zz.id('wife'), zz.id('org1'), 'staff', 'Penjaga');
  perform zz.eq('invite', 'admin creates a staff code (invited_by = admin)', zz.id('wife')::text, (select invited_by::text from public.invitations where label = 'Penjaga'));
  perform zz.eq('invite', 'a member entering a code gets the organisation back', 'val:' || zz.id('org1'), zz.join(zz.id('wife'), c));
  perform zz.eq('invite', '... keeps her role', 'admin', (select role from public.organization_members where user_id = zz.id('wife')));
  perform zz.ok('invite', '... and does not use up the code', (select accepted_at is null from public.invitations where label = 'Penjaga'));
  perform zz.eq('invite', 'staff joins with that code', 'val:' || zz.id('org1'), zz.join(zz.id('staff'), c));
  perform zz.eq('invite', 'staff has role staff', 'staff', (select role from public.organization_members where user_id = zz.id('staff')));
  perform zz.chk('invite', 'staff cannot create invitations', 'Hanya pemilik/admin', zz.val(zz.id('staff'), format('select code from public.create_invitation(%L, %L, null)', zz.id('org1'), 'staff')));
  perform zz.eq('invite', 'staff sees no invitations', 'val:0', zz.val(zz.id('staff'), 'select count(*) from public.invitations'));
  perform zz.chk('invite', 'admin sees the invitations', '^val:[1-9]', zz.val(zz.id('wife'), 'select count(*) from public.invitations'));

  c := zz.invite('expired', zz.id('owner'), zz.id('org1'), 'staff', 'Kedaluwarsa');
  update public.invitations set expires_at = now() - interval '1 second' where label = 'Kedaluwarsa';
  perform zz.eq('invite', 'expired code -> null', 'val:NULL', zz.join(zz.id('stranger'), c));

  c := zz.invite('deleted', zz.id('owner'), zz.id('org1'), 'admin', 'Batal');
  perform zz.chk('invite', 'staff cannot delete invitations', '^ok:0$', zz.att(zz.id('staff'), 'delete from public.invitations'));
  perform zz.eq('invite', 'admin deletes an invitation', 'ok:1', zz.att(zz.id('wife'), 'delete from public.invitations where label = ''Batal''', true));
  perform zz.eq('invite', 'its code hash goes with it', '0', (select count(*)::text from public.invitation_codes where code_hash = encode(sha256(convert_to(c, 'UTF8')), 'hex')));
  perform zz.eq('invite', 'deleted code -> null', 'val:NULL', zz.join(zz.id('stranger'), c));
  perform zz.chk('invite', 'admin cannot insert invitations directly', '^err:42501', zz.att(zz.id('wife'),
    format('insert into public.invitations (org_id, role) values (%L, %L)', zz.id('org1'), 'admin')));
  perform zz.chk('invite', 'admin cannot extend an invitation', '^err:42501', zz.att(zz.id('wife'), 'update public.invitations set expires_at = now() + interval ''1 year'''));
end $$;

-- Two people enter the same invitation code at the same moment: one joins, the other gets null
select zz.invite('race', zz.id('owner'), zz.id('org1'), 'staff', 'Rebutan');
select zz.dbl_open('c1', zz.id('racer'));
select set_config('zz.pid', zz.dbl_open('c2', zz.id('racer2'))::text, false);
select zz.dblink_exec('c1', 'begin');
select zz.eq('invite-race', 'first person joins (transaction still open)', zz.id('org1')::text,
  (select r from zz.dblink('c1', format('select public.join_with_code(%L)::text', zz.code('race'))) as t(r text)));
select zz.dblink_send_query('c2', format('select public.join_with_code(%L)::text', zz.code('race')));
select zz.eq('invite-race', 'second person waits on the invitation row lock', 'Lock', zz.wait_for_lock(current_setting('zz.pid')::int));
select zz.dblink_exec('c1', 'commit');
select zz.eq('invite-race', 'second person gets null', 'NULL', (select coalesce(r, 'NULL') from zz.dblink_get_result('c2') as t(r text)));
select * from zz.dblink_get_result('c2') as t(r text);
select zz.dblink_disconnect('c1'), zz.dblink_disconnect('c2');
do $$ begin
  perform zz.eq('invite-race', 'only the first person became a member', 'racer@example.com',
    (select string_agg(email, ',') from public.organization_members where user_id in (zz.id('racer'), zz.id('racer2'))));
  perform zz.eq('invite-race', 'invitation accepted by the first person', zz.id('racer')::text, (select accepted_by::text from public.invitations where label = 'Rebutan'));
end $$;

-- At most 20 active invitations per organisation; used and expired ones do not count
do $$
declare
  active int := (select count(*) from public.invitations where org_id = zz.id('org1') and accepted_at is null and expires_at > now());
  c text;
begin
  for i in active + 1 .. 20 loop
    perform zz.invite('bulk' || i, zz.id('owner'), zz.id('org1'), 'staff', 'Bulk ' || i);
  end loop;
  perform zz.eq('invite-limit', '20 active invitations', '20', (select count(*)::text from public.invitations
    where org_id = zz.id('org1') and accepted_at is null and expires_at > now()));
  perform zz.chk('invite-limit', 'the 21st is refused', 'Sudah ada 20 kode undangan aktif', zz.val(zz.id('owner'),
    format('select code from public.create_invitation(%L, %L, null)', zz.id('org1'), 'staff')));
  perform zz.eq('invite-limit', 'someone uses one of them', 'val:' || zz.id('org1'), zz.join(zz.id('racer2'), zz.code('bulk20')));
  c := zz.invite('after-use', zz.id('owner'), zz.id('org1'), 'staff', 'Setelah dipakai');
  perform zz.chk('invite-limit', 'a used invitation frees a slot', '^[A-Z0-9]{8}$', c);
  update public.invitations set expires_at = now() - interval '1 second' where label = 'Bulk 19';
  c := zz.invite('after-expiry', zz.id('owner'), zz.id('org1'), 'staff', 'Setelah kedaluwarsa');
  perform zz.chk('invite-limit', 'an expired invitation frees a slot', '^[A-Z0-9]{8}$', c);
  delete from public.invitations where label like 'Bulk%' or label like 'Setelah%' or label = 'Rebutan' or label is null;
end $$;

-- Generated codes: alphabet only, all different, evenly spread over the alphabet at every position
do $$
declare
  c text;
  codes text[] := '{}';
begin
  for i in 1..300 loop
    c := zz.invite('gen', zz.id('owner'), zz.id('org1'), 'staff', null);
    codes := codes || c;
    delete from public.invitations i using public.invitation_codes ic
     where ic.invitation_id = i.id and ic.code_hash = encode(sha256(convert_to(c, 'UTF8')), 'hex');
  end loop;
  perform zz.ok('invite-codes', '300 codes, all from the alphabet', (select bool_and(x ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$') from unnest(codes) x));
  perform zz.eq('invite-codes', '300 codes, all different', '300', (select count(distinct x)::text from unnest(codes) x));
  perform zz.ok('invite-codes', 'no look-alike characters (0 O 1 I L)', not exists (select 1 from unnest(codes) x where x ~ '[0O1IL]'));
  perform zz.eq('invite-codes', 'all 31 characters are used', '31', (select count(distinct ch)::text from unnest(codes) x, regexp_split_to_table(x, '') ch));
  -- uniform: about 15/31 of the codes have a character from the second half of the alphabet at each
  -- position (expected 145 of 300; outside 105..185 is > 4.5 standard deviations away)
  perform zz.eq('invite-codes', 'every position is uniform (no UUID version/variant bits)', '',
    (select coalesce(string_agg(format('position %s: %s', pos, n), '; '), '') from (
       select pos, count(*) filter (where strpos('ABCDEFGHJKMNPQRSTUVWXYZ23456789', substr(x, pos, 1)) > 16) as n
       from unnest(codes) x, generate_series(1, 8) pos group by pos) s
     where n not between 105 and 185));
end $$;

-- 5. Rate limit: 10 failures per hour per account
do $$
declare
  c text;
  r text;
begin
  foreach r in array array['', 'AB', 'ABCDEFG', 'ZZZZ-ZZZZ', '22222222', 'XXXXXXXX', 'YYYYYYYY', 'KKKKKKKK', 'MMMMMMMM', 'NNNNNNNN'] loop
    perform zz.eq('rate-limit', format('wrong code %L -> null', r), 'val:NULL', zz.join(zz.id('guesser'), r));
  end loop;
  perform zz.eq('rate-limit', 'every failure is recorded (empty and short codes too)', '10',
    (select count(*)::text from public.join_attempts where user_id = zz.id('guesser')));
  c := zz.invite('rl', zz.id('owner'), zz.id('org1'), 'staff', 'Batas percobaan');
  perform zz.eq('rate-limit', 'the 11th attempt is refused, even with a valid code', 'err:P0001:Terlalu banyak percobaan. Coba lagi dalam 1 jam.',
    zz.join(zz.id('guesser'), c));
  perform zz.eq('rate-limit', '... not a member', '0', (select count(*)::text from public.organization_members where user_id = zz.id('guesser')));
  perform zz.ok('rate-limit', '... and the code is still unused', (select accepted_at is null from public.invitations where label = 'Batas percobaan'));
  perform zz.eq('rate-limit', 'other accounts are not affected', 'val:NULL', zz.join(zz.id('early'), 'QQQQ-QQQQ'));
  perform zz.eq('rate-limit', 'a null code counts as a failure', 'val:NULL', zz.val(zz.id('early'), 'select public.join_with_code(null)', true));
  perform zz.chk('rate-limit', 'a user cannot clear own attempts', '^err:42501', zz.att(zz.id('guesser'), 'delete from public.join_attempts'));
  perform zz.chk('rate-limit', 'a user cannot read attempts', '^err:42501', zz.val(zz.id('guesser'), 'select count(*) from public.join_attempts'));
  perform zz.chk('rate-limit', 'a user cannot add attempts for someone else', '^err:42501', zz.att(zz.id('guesser'),
    format('insert into public.join_attempts (user_id) values (%L)', zz.id('owner'))));
  update public.join_attempts set attempted_at = attempted_at - interval '61 minutes' where user_id = zz.id('guesser');
  perform zz.eq('rate-limit', 'an hour later the valid code works', 'val:' || zz.id('org1'), zz.join(zz.id('guesser'), c));
end $$;

-- 6. Roles (owner only) and removing members
do $$
declare
  org text := zz.id('org1');
  q text := 'select public.set_member_role(%L, %L, %L)';
begin
  perform zz.chk('roles', 'admin cannot change roles', 'Hanya pemilik yang dapat mengubah peran', zz.att(zz.id('wife'), format(q, org, zz.id('staff'), 'admin')));
  perform zz.chk('roles', 'staff cannot promote self', 'Hanya pemilik', zz.att(zz.id('staff'), format(q, org, zz.id('staff'), 'owner')));
  perform zz.chk('roles', 'non-member cannot change roles', 'Hanya pemilik', zz.att(zz.id('stranger'), format(q, org, zz.id('stranger'), 'owner')));
  perform zz.chk('roles', 'anon cannot call set_member_role', '^err:42501', zz.att(null, format(q, org, zz.id('staff'), 'owner')));
  perform zz.chk('roles', 'invalid role refused', 'Peran tidak valid', zz.att(zz.id('owner'), format(q, org, zz.id('staff'), 'boss')));
  perform zz.chk('roles', 'unknown member refused', 'Anggota tidak ditemukan', zz.att(zz.id('owner'), format(q, org, zz.id('stranger'), 'admin')));
  perform zz.eq('roles', 'sole owner cannot step down', 'err:P0001:Tidak dapat mengubah peran pemilik terakhir.', zz.att(zz.id('owner'), format(q, org, zz.id('owner'), 'admin')));
  perform zz.eq('roles', 'owner promotes staff to admin', 'ok:1', zz.att(zz.id('owner'), format(q, org, zz.id('racer'), 'admin'), true));
  perform zz.eq('roles', '... role is admin', 'admin', (select role from public.organization_members where user_id = zz.id('racer')));
  perform zz.eq('roles', 'owner demotes admin to staff', 'ok:1', zz.att(zz.id('owner'), format(q, org, zz.id('racer'), 'staff'), true));
  perform zz.eq('roles', '... role is staff', 'staff', (select role from public.organization_members where user_id = zz.id('racer')));
  perform zz.eq('roles', 'owner makes wife a second owner', 'ok:1', zz.att(zz.id('owner'), format(q, org, zz.id('wife'), 'owner'), true));
  perform zz.eq('roles', 'with two owners, an owner may step down', 'ok:1', zz.att(zz.id('owner'), format(q, org, zz.id('owner'), 'admin'), true));
  perform zz.chk('roles', 'the remaining owner cannot step down', 'pemilik terakhir', zz.att(zz.id('wife'), format(q, org, zz.id('wife'), 'staff')));
  perform zz.chk('roles', 'the former owner (now admin) cannot take it back', 'Hanya pemilik', zz.att(zz.id('owner'), format(q, org, zz.id('owner'), 'owner')));
  perform zz.eq('roles', 'wife gives ownership back', 'ok:1', zz.att(zz.id('wife'), format(q, org, zz.id('owner'), 'owner'), true));
  perform zz.eq('roles', 'owner ensure_membership still prefers the owned organisation', 'val:' || org, zz.val(zz.id('owner'), 'select public.ensure_membership()'));
  perform zz.chk('roles', 'direct UPDATE of organization_members refused', '^err:42501', zz.att(zz.id('owner'), 'update public.organization_members set role = ''owner'''));
  perform zz.chk('roles', 'direct INSERT into organization_members refused', '^err:42501', zz.att(zz.id('owner'),
    format('insert into public.organization_members (org_id, user_id, role) values (%L, %L, %L)', org, zz.id('stranger'), 'owner')));
  perform zz.chk('roles', 'direct DELETE from organization_members refused', '^err:42501', zz.att(zz.id('owner'), 'delete from public.organization_members'));

  -- owners: owner + wife; admin: racer (below); staff: staff, racer2, guesser
  perform zz.att(zz.id('owner'), format(q, org, zz.id('racer'), 'admin'), true);
  perform zz.att(zz.id('owner'), format(q, org, zz.id('guesser'), 'admin'), true);
  q := 'select public.remove_member(%L, %L)';
  perform zz.chk('remove', 'owner cannot remove self', 'diri sendiri', zz.att(zz.id('owner'), format(q, org, zz.id('owner'))));
  perform zz.chk('remove', 'staff cannot remove members', 'Hanya pemilik/admin', zz.att(zz.id('staff'), format(q, org, zz.id('racer2'))));
  perform zz.chk('remove', 'non-member cannot remove members', 'Hanya pemilik/admin', zz.att(zz.id('stranger'), format(q, org, zz.id('staff'))));
  perform zz.chk('remove', 'admin cannot remove an owner', 'Hanya pemilik yang dapat menghapus pemilik lain', zz.att(zz.id('racer'), format(q, org, zz.id('wife'))));
  perform zz.chk('remove', 'admin cannot remove another admin', 'Hanya pemilik yang dapat menghapus admin', zz.att(zz.id('racer'), format(q, org, zz.id('guesser'))));
  perform zz.eq('remove', 'with two owners, an owner may remove the other', 'ok:1', zz.att(zz.id('owner'), format(q, org, zz.id('wife'))));
  perform zz.eq('remove', 'admin removes staff', 'ok:1', zz.att(zz.id('racer'), format(q, org, zz.id('racer2')), true));
  perform zz.eq('remove', '... gone', '0', (select count(*)::text from public.organization_members where user_id = zz.id('racer2')));
  perform zz.eq('remove', 'owner removes an admin', 'ok:1', zz.att(zz.id('owner'), format(q, org, zz.id('guesser')), true));
  perform zz.eq('roles', 'wife back to admin', 'ok:1', zz.att(zz.id('owner'), format('select public.set_member_role(%L, %L, %L)', org, zz.id('wife'), 'admin'), true));
  perform zz.eq('roles', 'members now', 'owner:owner,racer:admin,staff:staff,wife:admin',
    (select string_agg(split_part(email, '@', 1) || ':' || role, ',' order by email) from public.organization_members));
end $$;

-- Two owners demote each other at the same moment: the organisation keeps an owner
select zz.att(zz.id('owner'), format('select public.set_member_role(%L, %L, %L)', zz.id('org1'), zz.id('wife'), 'owner'), true);
select zz.dbl_open('c1', zz.id('owner'));
select set_config('zz.pid', zz.dbl_open('c2', zz.id('wife'))::text, false);
select zz.dblink_exec('c1', 'begin');
select * from zz.dblink('c1', format('select public.set_member_role(%L, %L, %L)::text', zz.id('org1'), zz.id('wife'), 'admin')) as t(r text);
select zz.dblink_send_query('c2', format('select public.set_member_role(%L, %L, %L)::text', zz.id('org1'), zz.id('owner'), 'admin'));
select zz.eq('roles-race', 'second owner waits for the first (organisation row lock)', 'Lock', zz.wait_for_lock(current_setting('zz.pid')::int));
select zz.dblink_exec('c1', 'commit');
select zz.eq('roles-race', 'second owner is refused once the first has committed', '0', (select count(*)::text from zz.dblink_get_result('c2', false) as t(r text)));
select zz.chk('roles-race', '... she is no longer an owner', 'Hanya pemilik yang dapat mengubah peran', zz.dblink_error_message('c2'));
select * from zz.dblink_get_result('c2', false) as t(r text);
select zz.dblink_disconnect('c1'), zz.dblink_disconnect('c2');
select zz.eq('roles-race', 'the first change won, one owner left', 'owner@example.com:owner,wife@example.com:admin',
  (select string_agg(email || ':' || role, ',' order by email) from public.organization_members where user_id in (zz.id('owner'), zz.id('wife'))));

-- 7. Business rows and invoice triggers (as the owner, through RLS)
insert into zz.ids values
  ('prop1', 'a1000000-0000-0000-0000-000000000001'), ('room1', 'a1000000-0000-0000-0000-000000000002'),
  ('tenant1', 'a1000000-0000-0000-0000-000000000003'), ('lease1', 'a1000000-0000-0000-0000-000000000004'),
  ('inv1', 'a1000000-0000-0000-0000-000000000005'), ('room2', 'a1000000-0000-0000-0000-000000000006'),
  ('addon1', 'a1000000-0000-0000-0000-000000000007'), ('pay_staff', 'a1000000-0000-0000-0000-000000000008'),
  ('exp_staff', 'a1000000-0000-0000-0000-000000000009'), ('lease_addon1', 'a1000000-0000-0000-0000-00000000000a'),
  ('tenant_loose', 'a1000000-0000-0000-0000-00000000000b'), ('tenant_move', 'a1000000-0000-0000-0000-00000000000c'),
  ('org9', '99999999-0000-0000-0000-000000000009');
do $$
declare
  o uuid := zz.id('owner');
  org uuid := zz.id('org1');
begin
  perform zz.eq('business', 'owner adds a property', 'ok:1', zz.att(o, format('insert into public.properties (id, org_id, name, payment_info) values (%L, %L, %L, %L)',
    zz.id('prop1'), org, 'Kos Melati', 'BCA 123 a.n. Pemilik'), true));
  perform zz.eq('business', 'owner adds rooms', 'ok:2', zz.att(o, format('insert into public.rooms (id, org_id, property_id, name, price_daily, price_weekly, price_monthly) values (%L, %L, %L, %L, 150000, 600000, 1500000), (%L, %L, %L, %L, 150000, 600000, 1500000)',
    zz.id('room1'), org, zz.id('prop1'), 'A1', zz.id('room2'), org, zz.id('prop1'), 'B1'), true));
  perform zz.eq('business', 'owner adds a tenant', 'ok:1', zz.att(o, format('insert into public.tenants (id, org_id, property_id, full_name, nik, ktp_image_path) values (%L, %L, %L, %L, %L, %L)',
    zz.id('tenant1'), org, zz.id('prop1'), 'Budi', '3201010101010001', org || '/budi.jpg'), true));
  perform zz.eq('business', 'owner adds a lease', 'ok:1', zz.att(o, format('insert into public.leases (id, org_id, property_id, room_id, tenant_id, period_type, price_per_period, deposit_amount, start_date, end_date) values (%L, %L, %L, %L, %L, %L, 1500000, 1000000, %L, %L)',
    zz.id('lease1'), org, zz.id('prop1'), zz.id('room1'), zz.id('tenant1'), 'monthly', '2026-03-01', '2026-03-31'), true));
  perform zz.eq('business', 'owner adds an invoice', 'ok:1', zz.att(o, format('insert into public.invoices (id, org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date) values (%L, %L, %L, %L, %L, %L, %L, 1500000, 1500000, %L)',
    zz.id('inv1'), org, zz.id('prop1'), zz.id('lease1'), 'INV-202603-0001', '2026-03-01', '2026-03-31', '2026-03-01'), true));
  perform zz.chk('business', 'components must explain the total', '^err:23514', zz.att(o, format('insert into public.invoices (org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date) values (%L, %L, %L, %L, %L, %L, 1500000, 1400000, %L)',
    org, zz.id('prop1'), zz.id('lease1'), 'INV-202604-0001', '2026-04-01', '2026-04-30', '2026-04-01')));
  perform zz.eq('business', 'DP payment', 'ok:1', zz.att(o, format('insert into public.payments (org_id, property_id, invoice_id, lease_id, amount, paid_at) values (%L, %L, %L, %L, 500000, %L)',
    org, zz.id('prop1'), zz.id('inv1'), zz.id('lease1'), '2026-03-01'), true));
  perform zz.eq('business', '... invoice partial', 'partial', (select status from public.invoices where id = zz.id('inv1')));
  perform zz.eq('business', 'rest paid', 'ok:1', zz.att(o, format('insert into public.payments (org_id, property_id, invoice_id, lease_id, amount, paid_at) values (%L, %L, %L, %L, 1000000, %L)',
    org, zz.id('prop1'), zz.id('inv1'), zz.id('lease1'), '2026-03-05'), true));
  perform zz.eq('business', '... invoice paid', 'paid', (select status from public.invoices where id = zz.id('inv1')));
  perform zz.eq('business', 'created_by filled from auth.uid()', '2', (select count(*)::text from public.payments where created_by = o));
  perform zz.chk('business', 'rent payment without invoice refused', '^err:23514', zz.att(o, format('insert into public.payments (org_id, property_id, lease_id, amount, paid_at, kind) values (%L, %L, %L, 1, %L, %L)',
    org, zz.id('prop1'), zz.id('lease1'), '2026-03-01', 'rent')));
  perform zz.chk('business', 'deposit payment on an invoice refused', '^err:23514', zz.att(o, format('insert into public.payments (org_id, property_id, invoice_id, lease_id, amount, paid_at, kind) values (%L, %L, %L, %L, 1, %L, %L)',
    org, zz.id('prop1'), zz.id('inv1'), zz.id('lease1'), '2026-03-01', 'deposit')));
  perform zz.chk('business', 'paid invoice cannot be voided', 'pembayarannya tidak dapat dibatalkan', zz.att(o, format('update public.invoices set status = ''void'' where id = %L', zz.id('inv1'))));
  perform zz.chk('business', 'total below the paid amount refused', 'lebih kecil', zz.att(o, format('update public.invoices set total_amount = 100, base_amount = 100 where id = %L', zz.id('inv1'))));
  perform zz.chk('business', 'invoice with payments cannot be deleted', '^err:23503', zz.att(o, format('delete from public.invoices where id = %L', zz.id('inv1'))));
  perform zz.chk('business', 'lease with invoices cannot be deleted', '^err:23503', zz.att(o, format('delete from public.leases where id = %L', zz.id('lease1'))));
  perform zz.chk('business', 'refund expense needs a lease', '^err:23514', zz.att(o, format('insert into public.expenses (org_id, property_id, category, amount, expense_date, description) values (%L, %L, %L, 100, %L, %L)',
    org, zz.id('prop1'), 'deposit_refund', '2026-03-31', 'x')));
  perform zz.eq('business', 'refund expense with a lease', 'ok:1', zz.att(o, format('insert into public.expenses (org_id, property_id, lease_id, category, amount, expense_date, description) values (%L, %L, %L, %L, 100, %L, %L)',
    org, zz.id('prop1'), zz.id('lease1'), 'deposit_refund', '2026-03-31', 'ok'), true));
  perform zz.chk('business', 'non-member cannot recalculate an invoice', 'Tidak memiliki akses', zz.att(zz.id('stranger'), format('select public.recalc_invoice_status(%L)', zz.id('inv1'))));
  perform zz.eq('business', 'member may recalculate an invoice', 'ok:1', zz.att(zz.id('staff'), format('select public.recalc_invoice_status(%L)', zz.id('inv1'))));
  -- a second organisation the owner also belongs to (created by the operator)
  insert into public.organizations (id, name, created_by) values (zz.id('org9'), 'Kos Lain', o);
  insert into public.organization_members (org_id, user_id, email, role) values (zz.id('org9'), o, 'owner@example.com', 'owner');
end $$;

-- 8. Staff limits
do $$
declare
  s uuid := zz.id('staff');
  a uuid := zz.id('wife');
  org uuid := zz.id('org1');
begin
  -- properties: admin only (payment_info is the bank account in WhatsApp reminders)
  perform zz.chk('staff-limits', 'staff cannot add a property', '^err:42501', zz.att(s, format('insert into public.properties (org_id, name) values (%L, %L)', org, 'Kos Staf')));
  perform zz.eq('staff-limits', 'staff cannot change the bank account (payment_info)', 'ok:0', zz.att(s, 'update public.properties set payment_info = ''BCA 999 a.n. Staf'''));
  perform zz.eq('staff-limits', 'staff cannot delete a property', 'ok:0', zz.att(s, 'delete from public.properties'));
  perform zz.eq('staff-limits', 'admin changes payment_info', 'ok:1', zz.att(a, format('update public.properties set payment_info = ''BCA 456'' where id = %L', zz.id('prop1'))));
  -- add-on price list: admin only
  perform zz.chk('staff-limits', 'staff cannot add to the add-on price list', '^err:42501', zz.att(s, format('insert into public.addon_catalog (org_id, name, default_price) values (%L, %L, 1)', org, 'Parkir')));
  perform zz.eq('staff-limits', 'admin adds an add-on', 'ok:1', zz.att(a, format('insert into public.addon_catalog (id, org_id, name, default_price) values (%L, %L, %L, 100000)', zz.id('addon1'), org, 'Parkir'), true));
  perform zz.eq('staff-limits', 'staff cannot change an add-on price', 'ok:0', zz.att(s, 'update public.addon_catalog set default_price = 1'));
  perform zz.eq('staff-limits', 'staff cannot delete an add-on', 'ok:0', zz.att(s, 'delete from public.addon_catalog'));
  perform zz.eq('staff-limits', 'admin changes an add-on price', 'ok:1', zz.att(a, 'update public.addon_catalog set default_price = 120000'));
  perform zz.eq('staff-limits', 'admin deletes an add-on', 'ok:1', zz.att(a, 'delete from public.addon_catalog'));
  -- rooms: staff may edit, but not prices; insert/delete admin only
  perform zz.chk('staff-limits', 'staff cannot add a room', '^err:42501', zz.att(s, format('insert into public.rooms (org_id, property_id, name) values (%L, %L, %L)', org, zz.id('prop1'), 'C1')));
  perform zz.eq('staff-limits', 'staff cannot delete a room', 'ok:0', zz.att(s, format('delete from public.rooms where id = %L', zz.id('room2'))));
  perform zz.eq('staff-limits', 'staff cannot change a room price', 'err:P0001:Hanya pemilik/admin yang dapat mengubah harga kamar.',
    zz.att(s, format('update public.rooms set price_monthly = 1 where id = %L', zz.id('room1'))));
  perform zz.chk('staff-limits', 'staff cannot clear a room price', 'harga kamar', zz.att(s, format('update public.rooms set price_daily = null where id = %L', zz.id('room1'))));
  perform zz.eq('staff-limits', 'staff may set a room to maintenance and rename it', 'ok:1', zz.att(s, format('update public.rooms set status = ''maintenance'', name = ''A1 baru'' where id = %L', zz.id('room1'))));
  perform zz.eq('staff-limits', 'staff may save a room form with unchanged prices', 'ok:1', zz.att(s, format('update public.rooms set price_daily = 150000, price_weekly = 600000, price_monthly = 1500000, notes = ''x'' where id = %L', zz.id('room1'))));
  perform zz.eq('staff-limits', 'admin changes a room price', 'ok:1', zz.att(a, format('update public.rooms set price_monthly = 1600000 where id = %L', zz.id('room1'))));
  perform zz.eq('staff-limits', 'operator (no auth.uid) changes a room price', 'val:1', zz.su(format('with u as (update public.rooms set price_monthly = 1700000 where id = %L returning 1) select count(*) from u', zz.id('room1')), true));
  -- leases: staff may extend, check out and move, but not change price, deposit or period type
  perform zz.eq('staff-limits', 'staff extends a lease', 'ok:1', zz.att(s, format('update public.leases set end_date = ''2026-04-30'' where id = %L', zz.id('lease1'))));
  perform zz.eq('staff-limits', 'staff checks a tenant out', 'ok:1', zz.att(s, format('update public.leases set status = ''ended'', checkout_date = ''2026-03-20'', end_date = ''2026-03-20'' where id = %L', zz.id('lease1'))));
  perform zz.eq('staff-limits', 'staff moves a tenant to another room (same price)', 'ok:1', zz.att(s, format('update public.leases set room_id = %L, notes = ''Pindah dari A1 ke B1'' where id = %L', zz.id('room2'), zz.id('lease1'))));
  perform zz.eq('staff-limits', 'staff cannot change the agreed price', 'err:P0001:Hanya pemilik/admin yang dapat mengubah harga atau jenis sewa.',
    zz.att(s, format('update public.leases set price_per_period = 1 where id = %L', zz.id('lease1'))));
  perform zz.chk('staff-limits', 'staff cannot change the deposit', 'harga atau jenis sewa', zz.att(s, format('update public.leases set deposit_amount = 0 where id = %L', zz.id('lease1'))));
  perform zz.chk('staff-limits', 'staff cannot change the period type', 'harga atau jenis sewa', zz.att(s, format('update public.leases set period_type = ''weekly'' where id = %L', zz.id('lease1'))));
  perform zz.chk('staff-limits', 'staff cannot move a tenant and change the price', 'harga atau jenis sewa', zz.att(s, format('update public.leases set room_id = %L, price_per_period = 1400000 where id = %L', zz.id('room2'), zz.id('lease1'))));
  perform zz.eq('staff-limits', 'staff may save a lease form with unchanged terms', 'ok:1', zz.att(s, format('update public.leases set price_per_period = 1500000, deposit_amount = 1000000, period_type = ''monthly'', notes = ''catatan'' where id = %L', zz.id('lease1'))));
  perform zz.eq('staff-limits', 'admin changes the agreed price', 'ok:1', zz.att(a, format('update public.leases set price_per_period = 1400000, period_type = ''weekly'' where id = %L', zz.id('lease1'))));
  perform zz.eq('staff-limits', 'operator (no auth.uid) changes the agreed price and deposit', 'val:1', zz.su(format(
    'with u as (update public.leases set price_per_period = 1300000, deposit_amount = 0 where id = %L returning 1) select count(*) from u', zz.id('lease1'))));
  perform zz.eq('staff-limits', 'staff may create a lease with a negotiated price', 'ok:1', zz.att(s, format('insert into public.leases (org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date) values (%L, %L, %L, %L, %L, 1, %L, %L)',
    org, zz.id('prop1'), zz.id('room2'), zz.id('tenant1'), 'daily', '2026-05-01', '2026-05-03')));
  perform zz.eq('staff-limits', 'staff may add a lease add-on', 'ok:1', zz.att(s, format('insert into public.lease_addons (id, org_id, lease_id, name, amount) values (%L, %L, %L, %L, 50000)',
    zz.id('lease_addon1'), org, zz.id('lease1'), 'Parkir'), true));
  -- payments & expenses: staff record them; only admins edit or delete
  perform zz.eq('staff-limits', 'staff records a deposit', 'ok:1', zz.att(s, format('insert into public.payments (id, org_id, property_id, lease_id, amount, paid_at, kind) values (%L, %L, %L, %L, 100000, %L, %L)',
    zz.id('pay_staff'), org, zz.id('prop1'), zz.id('lease1'), '2026-03-01', 'deposit'), true));
  perform zz.eq('staff-limits', 'staff cannot change own payment', 'ok:0', zz.att(s, format('update public.payments set amount = 1 where id = %L', zz.id('pay_staff'))));
  perform zz.eq('staff-limits', 'staff cannot delete own payment', 'ok:0', zz.att(s, format('delete from public.payments where id = %L', zz.id('pay_staff'))));
  perform zz.eq('staff-limits', 'admin corrects the payment', 'ok:1', zz.att(a, format('update public.payments set amount = 90000 where id = %L', zz.id('pay_staff')), true));
  perform zz.eq('staff-limits', 'staff records an expense', 'ok:1', zz.att(s, format('insert into public.expenses (id, org_id, property_id, category, amount, expense_date, description) values (%L, %L, %L, %L, 50000, %L, %L)',
    zz.id('exp_staff'), org, zz.id('prop1'), 'supplies', '2026-03-02', 'Sapu'), true));
  perform zz.eq('staff-limits', 'staff cannot edit own expense', 'ok:0', zz.att(s, format('update public.expenses set amount = 1 where id = %L', zz.id('exp_staff'))));
  perform zz.eq('staff-limits', 'staff cannot delete own expense', 'ok:0', zz.att(s, format('delete from public.expenses where id = %L', zz.id('exp_staff'))));
  perform zz.eq('staff-limits', 'admin edits the expense', 'ok:1', zz.att(a, format('update public.expenses set description = ''Sapu lidi'' where id = %L', zz.id('exp_staff')), true));
  perform zz.eq('staff-limits', 'staff cannot change an invoice', 'ok:0', zz.att(s, 'update public.invoices set discount_amount = total_amount, total_amount = 0'));
  -- created_by is always the author
  perform zz.eq('created-by', 'staff payment claiming the owner as author -> staff', 'val:' || s, zz.val(s, format(
    'with i as (insert into public.payments (org_id, property_id, lease_id, amount, paid_at, kind, created_by) values (%L, %L, %L, 1, %L, %L, %L) returning created_by) select created_by from i',
    org, zz.id('prop1'), zz.id('lease1'), '2026-03-01', 'other', zz.id('owner'))));
  perform zz.eq('created-by', 'staff expense claiming the owner as author -> staff', 'val:' || s, zz.val(s, format(
    'with i as (insert into public.expenses (org_id, category, amount, expense_date, description, created_by) values (%L, %L, 1, %L, %L, %L) returning created_by) select created_by from i',
    org, 'other', '2026-03-01', 'x', zz.id('owner'))));
  perform zz.eq('created-by', 'created_by null (demo import) -> the importer', 'val:' || a, zz.val(a, format(
    'with i as (insert into public.payments (org_id, property_id, lease_id, amount, paid_at, kind, created_by) values (%L, %L, %L, 1, %L, %L, null) returning created_by) select created_by from i',
    org, zz.id('prop1'), zz.id('lease1'), '2026-03-01', 'other')));
  perform zz.eq('created-by', 'operator may set created_by', 'val:' || zz.id('owner'), zz.su(format(
    'with i as (insert into public.payments (org_id, property_id, lease_id, amount, paid_at, kind, created_by) values (%L, %L, %L, 1, %L, %L, %L) returning created_by) select created_by from i',
    org, zz.id('prop1'), zz.id('lease1'), '2026-03-01', 'other', zz.id('owner'))));
  perform zz.eq('created-by', 'admin cannot rewrite the author of a payment', 'val:' || s, zz.val(a, format(
    'with u as (update public.payments set created_by = %L where id = %L returning created_by) select created_by from u', a, zz.id('pay_staff'))));
  perform zz.eq('created-by', 'admin cannot rewrite who created the organisation', 'val:' || zz.id('owner'), zz.val(a, format(
    'with u as (update public.organizations set created_by = %L, name = ''Kos Kita'' where id = %L returning created_by) select created_by from u', a, org)));
  -- rows never move to another organisation
  perform zz.eq('org-id', 'a tenant without a property', 'ok:1', zz.att(zz.id('owner'), format('insert into public.tenants (id, org_id, full_name) values (%L, %L, %L)',
    zz.id('tenant_move'), org, 'Tamu'), true));
  perform zz.chk('org-id', 'owner of two organisations cannot move it across', 'tidak dapat dipindah ke organisasi lain', zz.att(zz.id('owner'),
    format('update public.tenants set org_id = %L where id = %L', zz.id('org9'), zz.id('tenant_move'))));
  perform zz.chk('org-id', '... nor a payment', 'tidak dapat dipindah|^err:23503', zz.att(zz.id('owner'), format('update public.payments set org_id = %L where id = %L', zz.id('org9'), zz.id('pay_staff'))));
  -- an invoice inserted as void by a non-admin is a normal invoice
  perform zz.eq('void-insert', 'staff invoice inserted as void -> unpaid', 'val:unpaid', zz.val(s, format(
    'with i as (insert into public.invoices (org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date, status) values (%L, %L, %L, %L, %L, %L, 5, 5, %L, %L) returning status) select status from i',
    org, zz.id('prop1'), zz.id('lease1'), 'INV-VOID-1', '2026-07-01', '2026-07-01', '2026-07-01', 'void')));
  perform zz.eq('void-insert', 'staff invoice inserted as paid -> unpaid', 'val:unpaid', zz.val(s, format(
    'with i as (insert into public.invoices (org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date, status) values (%L, %L, %L, %L, %L, %L, 5, 5, %L, %L) returning status) select status from i',
    org, zz.id('prop1'), zz.id('lease1'), 'INV-PAID-1', '2026-07-01', '2026-07-01', '2026-07-01', 'paid')));
  perform zz.eq('void-insert', 'admin may insert a void invoice', 'val:void', zz.val(a, format(
    'with i as (insert into public.invoices (org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date, status) values (%L, %L, %L, %L, %L, %L, 5, 5, %L, %L) returning status) select status from i',
    org, zz.id('prop1'), zz.id('lease1'), 'INV-VOID-2', '2026-07-01', '2026-07-01', '2026-07-01', 'void')));
  perform zz.eq('void-insert', 'operator may insert a void invoice', 'val:void', zz.su(format(
    'with i as (insert into public.invoices (org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date, status) values (%L, %L, %L, %L, %L, %L, 5, 5, %L, %L) returning status) select status from i',
    org, zz.id('prop1'), zz.id('lease1'), 'INV-VOID-3', '2026-07-01', '2026-07-01', '2026-07-01', 'void')));
end $$;

-- 9. Audit log
do $$
declare
  n bigint;
  org uuid := zz.id('org1');
begin
  perform zz.ok('audit', 'organisation creation logged with its creator', exists (select 1 from public.audit_log
    where table_name = 'organizations' and action = 'insert' and org_id = org and changed_by = zz.id('owner')));
  perform zz.ok('audit', 'joining by code logged (member row + accepted invitation)', exists (select 1 from public.audit_log
    where table_name = 'organization_members' and action = 'insert' and changed_by = zz.id('staff') and new_data ->> 'role' = 'staff')
    and exists (select 1 from public.audit_log where table_name = 'invitations' and action = 'update' and changed_by = zz.id('staff')
      and old_data ->> 'accepted_at' is null and new_data ->> 'accepted_by' = zz.id('staff')::text));
  perform zz.ok('audit', 'role change logged', exists (select 1 from public.audit_log where table_name = 'organization_members' and action = 'update'
    and changed_by = zz.id('owner') and old_data ->> 'role' = 'staff' and new_data ->> 'role' = 'admin'));
  perform zz.ok('audit', 'removed member logged', exists (select 1 from public.audit_log where table_name = 'organization_members' and action = 'delete'
    and old_data ->> 'user_id' = zz.id('racer2')::text and new_data is null));
  perform zz.ok('audit', 'payment insert logged with its author', exists (select 1 from public.audit_log where table_name = 'payments' and action = 'insert'
    and row_id = zz.id('pay_staff') and changed_by = zz.id('staff') and old_data is null and new_data ->> 'amount' = '100000'));
  perform zz.ok('audit', 'payment correction logged with old and new amount', exists (select 1 from public.audit_log where table_name = 'payments' and action = 'update'
    and row_id = zz.id('pay_staff') and changed_by = zz.id('wife') and old_data ->> 'amount' = '100000' and new_data ->> 'amount' = '90000'));
  perform zz.ok('audit', 'invoice status set by the payment trigger is logged with the payer', exists (select 1 from public.audit_log
    where table_name = 'invoices' and action = 'update' and row_id = zz.id('inv1') and changed_by = zz.id('owner')
      and old_data ->> 'status' = 'unpaid' and new_data ->> 'status' = 'partial'));
  perform zz.ok('audit', 'operator changes logged without an author', exists (select 1 from public.audit_log where table_name = 'rooms'
    and changed_by is null and new_data ->> 'price_monthly' = '1700000'));
  perform zz.ok('audit', 'refused changes leave no trace', not exists (select 1 from public.audit_log where table_name = 'rooms'
    and new_data ->> 'price_monthly' = '1'));
  perform zz.ok('audit', 'invitation code hashes never reach the log', not exists (select 1 from public.audit_log a, public.invitation_codes c
    where a.old_data::text like '%' || c.code_hash || '%' or a.new_data::text like '%' || c.code_hash || '%'));
  perform zz.eq('audit', 'admin deletes an expense', 'ok:1', zz.att(zz.id('wife'), format('delete from public.expenses where id = %L', zz.id('exp_staff')), true));
  perform zz.ok('audit', 'delete logged with the old row', exists (select 1 from public.audit_log where table_name = 'expenses' and action = 'delete'
    and row_id = zz.id('exp_staff') and changed_by = zz.id('wife') and new_data is null and old_data ->> 'description' = 'Sapu lidi'));
  n := (select count(*) from public.audit_log);
  perform zz.eq('audit', 'an update that changes nothing', 'ok:1', zz.att(zz.id('staff'), format('update public.lease_addons set amount = amount where id = %L', zz.id('lease_addon1')), true));
  perform zz.eq('audit', '... is not logged', n::text, (select count(*)::text from public.audit_log));
  -- who reads it
  perform zz.chk('audit', 'owner reads the history', '^val:[1-9]', zz.val(zz.id('owner'), 'select count(*) from public.audit_log'));
  perform zz.chk('audit', 'admin reads the history', '^val:[1-9]', zz.val(zz.id('wife'), 'select count(*) from public.audit_log'));
  perform zz.eq('audit', 'staff sees no history', 'val:0', zz.val(zz.id('staff'), 'select count(*) from public.audit_log'));
  perform zz.eq('audit', 'non-member sees no history', 'val:0', zz.val(zz.id('stranger'), 'select count(*) from public.audit_log'));
  perform zz.chk('audit', 'anon cannot read the history', '^err:42501', zz.val(null, 'select count(*) from public.audit_log'));
  -- nobody changes it
  perform zz.chk('audit', 'owner cannot delete history', '^err:42501', zz.att(zz.id('owner'), 'delete from public.audit_log'));
  perform zz.chk('audit', 'owner cannot edit history', '^err:42501', zz.att(zz.id('owner'), 'update public.audit_log set old_data = null'));
  perform zz.chk('audit', 'owner cannot truncate history', '^err:42501', zz.att(zz.id('owner'), 'truncate public.audit_log'));
  perform zz.chk('audit', 'owner cannot forge history', '^err:42501', zz.att(zz.id('owner'),
    format('insert into public.audit_log (org_id, table_name, action) values (%L, %L, %L)', org, 'payments', 'delete')));
  perform zz.chk('audit', 'the trigger function cannot be called directly', '^err:', zz.att(zz.id('owner'), 'select public.audit_row_change()'));
end $$;

-- the operator deletes a whole organisation: rows and history go, nothing fails on the way
do $$
declare
  x uuid := '99999999-0000-0000-0000-00000000000a';
  p uuid := 'a2000000-0000-0000-0000-000000000001';
begin
  insert into public.organizations (id, name) values (x, 'Dihapus');
  insert into public.organization_members (org_id, user_id, role) values (x, zz.id('stranger'), 'owner');
  insert into public.invitations (org_id, role) values (x, 'staff');
  insert into public.properties (id, org_id, name) values (p, x, 'P');
  insert into public.rooms (id, org_id, property_id, name) values ('a2000000-0000-0000-0000-000000000002', x, p, 'R');
  insert into public.tenants (id, org_id, property_id, full_name) values ('a2000000-0000-0000-0000-000000000003', x, p, 'T');
  insert into public.leases (id, org_id, property_id, room_id, tenant_id, period_type, price_per_period, start_date, end_date)
    values ('a2000000-0000-0000-0000-000000000004', x, p, 'a2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000003', 'monthly', 1, '2026-01-01', '2026-01-31');
  insert into public.invoices (id, org_id, property_id, lease_id, invoice_number, period_start, period_end, base_amount, total_amount, due_date)
    values ('a2000000-0000-0000-0000-000000000005', x, p, 'a2000000-0000-0000-0000-000000000004', 'I1', '2026-01-01', '2026-01-31', 1, 1, '2026-01-01');
  insert into public.payments (org_id, property_id, invoice_id, lease_id, amount, paid_at)
    values (x, p, 'a2000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000004', 1, '2026-01-01');
  perform zz.eq('operator', 'operator records a payment (invoice becomes paid)', 'val:paid',
    zz.su(format('select status from public.invoices where org_id = %L', x)));
  perform zz.ok('audit', '... with their history', (select count(*) >= 9 from public.audit_log where org_id = x));
  perform zz.eq('audit', 'operator deletes the whole organisation', 'val:1', zz.su(format('with d as (delete from public.organizations where id = %L returning 1) select count(*) from d', x), true));
  perform zz.eq('audit', 'its history went with it', '0', (select count(*)::text from public.audit_log where org_id = x));
  perform zz.eq('audit', 'its rows went with it', '0', (select count(*)::text from public.payments where org_id = x));
end $$;

-- 10. Storage: the app deletes the row first, then the file through the Storage API
do $$
declare
  org uuid := zz.id('org1');
begin
  insert into storage.objects (bucket_id, name) values ('ktp', org || '/sari.jpg');
  perform zz.eq('storage', 'staff adds a tenant with a KTP photo path', 'ok:1', zz.att(zz.id('staff'), format('insert into public.tenants (id, org_id, full_name, ktp_image_path) values (%L, %L, %L, %L)',
    zz.id('tenant_loose'), org, 'Sari', org || '/sari.jpg'), true));
  perform zz.eq('storage', 'staff deletes that tenant (no lease)', 'ok:1', zz.att(zz.id('staff'), format('delete from public.tenants where id = %L', zz.id('tenant_loose')), true));
  perform zz.eq('storage', 'the photo is not deleted by the database', '1', (select count(*)::text from storage.objects where name = org || '/sari.jpg'));
  perform zz.eq('storage', 'the app then removes it (Storage API)', 'ok:1', zz.att(zz.id('staff'), format('delete from storage.objects where name = %L', org || '/sari.jpg'), true));
  perform zz.ok('storage', 'bad path -> no organisation', public.path_org_id('not-a-uuid/file.jpg') is null);
  perform zz.eq('storage', 'path org id', org::text, public.path_org_id(org || '/t1.jpg')::text);
  perform zz.eq('storage', 'buckets exist', '2', (select count(*)::text from storage.buckets where id in ('ktp', 'receipts')));
end $$;

-- 11. Structure and privileges
select zz.check_structure('structure');
