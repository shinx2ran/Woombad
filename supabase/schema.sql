-- =====================================================================================
-- Woombad: Supabase / PostgreSQL schema (v0.3)
-- Run this whole file in Supabase Dashboard -> SQL Editor. It is the complete schema: it works on an
-- empty project, can be run again, and upgrades a v0.2 installation in place (no separate migration).
-- Then the operator sets the owner's one-time setup code (not callable from the app):
--   select public.set_setup_code('ABCD-EFGH');
-- Design notes:
--  * One family = one organisation. Signing up gives no access by itself: the owner enters the setup
--    code (once, only while no organisation exists) and everyone else enters a one-time invitation
--    code made by an owner/admin (join_with_code). Codes are stored only as SHA-256 hashes.
--  * Every business row carries org_id; Row Level Security is is_org_member(org_id) (admin-only for
--    money edits, prices and master data), and composite foreign keys (org_id, id) make
--    cross-organisation references impossible.
--  * Financial rows are never cascaded away: voiding/cancelling is the only path.
--  * Every change is recorded in audit_log by triggers; nobody can change that history via the API.
-- =====================================================================================

begin;

-- ---------- helpers ----------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- organisations & membership ----------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  role text not null check (role in ('owner', 'admin', 'staff')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists organization_members_user_idx on public.organization_members (user_id);

-- One row per invitation code. The code itself lives (hashed) in invitation_codes.
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- who it is for, free text ("Istri", "Pak Udin")
  label text,
  -- legacy (v0.2 email invitations); null for code invitations
  email text,
  -- 'owner' can never be granted through an invitation
  role text not null check (role in ('admin', 'staff')),
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.invitations alter column email drop not null;
alter table public.invitations add column if not exists label text;
alter table public.invitations add column if not exists expires_at timestamptz not null default now() + interval '7 days';
alter table public.invitations add column if not exists accepted_by uuid references auth.users(id) on delete set null;
-- v0.2 kept one pending invitation per email; codes have no email
drop index if exists public.invitations_pending_unique;
do $$
declare r record;
begin
  for r in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.invitations'::regclass and c.contype = 'u'
      and exists (select 1 from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey) and a.attname = 'email')
  loop
    execute format('alter table public.invitations drop constraint %I', r.conname);
  end loop;
  for r in
    select i.indexrelid::regclass::text as name from pg_index i
    where i.indrelid = 'public.invitations'::regclass and i.indisunique and not i.indisprimary
      and pg_get_indexdef(i.indexrelid) ilike '%email%'
  loop
    execute format('drop index %s', r.name);
  end loop;
end $$;
create index if not exists invitations_org_idx on public.invitations (org_id, expires_at) where accepted_at is null;

-- Code hashes are kept apart from invitations: no grants, no policies, so they never reach a client
-- (nor a backup made through the API).
create table if not exists public.invitation_codes (
  invitation_id uuid primary key references public.invitations(id) on delete cascade,
  code_hash text not null unique
);

-- v0.2 email invitations have no code and can never be used any more
update public.invitations i set expires_at = now()
where i.accepted_at is null and i.email is not null and i.expires_at > now()
  and not exists (select 1 from public.invitation_codes c where c.invitation_id = i.id);

-- Singleton with the owner's setup code (set by the operator with set_setup_code).
create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  setup_code_hash text,
  setup_code_used_at timestamptz
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- Failed join_with_code attempts, for rate limiting.
create table if not exists public.join_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists join_attempts_user_idx on public.join_attempts (user_id, attempted_at);

-- security definer so RLS policies on organization_members itself do not recurse
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  );
$$;

create or replace function public.is_org_owner(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- Same normalisation as the client (normalizeCode): upper case, letters and digits only.
create or replace function public.normalize_code(p_code text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');
$$;

create or replace function public.hash_code(p_code text)
returns text language sql stable set search_path = public, pg_temp as $$
  select encode(sha256(convert_to(public.normalize_code(p_code), 'UTF8')), 'hex');
$$;

-- Operator only (SQL editor / service role): store the owner's setup code and make it usable again.
create or replace function public.set_setup_code(p_code text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if char_length(public.normalize_code(p_code)) < 8 then
    raise exception 'Kode pemilik minimal 8 huruf/angka.';
  end if;
  insert into public.app_settings (id, setup_code_hash, setup_code_used_at)
  values (1, public.hash_code(p_code), null)
  on conflict (id) do update set setup_code_hash = excluded.setup_code_hash, setup_code_used_at = null;
  if exists (select 1 from public.organizations) then
    return 'Kode disimpan, tetapi organisasi sudah ada: kode pemilik hanya berlaku selama belum ada organisasi.';
  end if;
  return 'Kode pemilik disimpan. Berlaku sekali, untuk akun pertama yang memasukkannya.';
end $$;

-- Called by the app after login: the existing membership (owner first, then oldest). Never creates
-- anything; SQLSTATE WB001 tells the app to show the "enter a code" screen.
create or replace function public.ensure_membership()
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  org uuid;
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Belum masuk.'; end if;
  select org_id into org from public.organization_members
   where user_id = me order by (role = 'owner') desc, created_at asc limit 1;
  if org is null then
    raise exception using errcode = 'WB001', message = 'Akun ini belum menjadi anggota. Masukkan kode dari pemilik kos.';
  end if;
  return org;
end $$;

-- Join with an invitation code, or (while no organisation exists) the owner setup code.
-- Returns the organisation id, or null for a wrong/expired/used code.
create or replace function public.join_with_code(p_code text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  h text;
  inv record;
  new_org uuid;
  added int;
begin
  if me is null then raise exception 'Belum masuk.'; end if;
  -- one attempt per account at a time, so parallel requests cannot get past the limit
  perform pg_advisory_xact_lock(hashtextextended('join_with_code:' || me::text, 0));
  delete from public.join_attempts where user_id = me and attempted_at < now() - interval '1 day';
  if (select count(*) from public.join_attempts
      where user_id = me and attempted_at > now() - interval '1 hour') >= 10 then
    raise exception 'Terlalu banyak percobaan. Coba lagi dalam 1 jam.';
  end if;

  if char_length(public.normalize_code(p_code)) >= 8 then
    h := public.hash_code(p_code);

    -- the row lock makes a code usable once, even when two people enter it at the same moment
    select i.id, i.org_id, i.role, i.invited_by into inv
      from public.invitation_codes c
      join public.invitations i on i.id = c.invitation_id
     where c.code_hash = h and i.accepted_at is null and i.expires_at > now()
       for update of i;
    -- a code only works while whoever made it may still invite (checked after the lock, so a
    -- removal or demotion committed meanwhile counts)
    if found and exists (select 1 from public.organization_members m
                          where m.org_id = inv.org_id and m.user_id = inv.invited_by and m.role in ('owner', 'admin')) then
      insert into public.organization_members (org_id, user_id, email, role)
      values (inv.org_id, me, (select u.email from auth.users u where u.id = me), inv.role)
      on conflict (org_id, user_id) do nothing;
      get diagnostics added = row_count;
      -- already a member: leave the code for the person it was made for
      if added > 0 then
        update public.invitations set accepted_at = now(), accepted_by = me where id = inv.id;
      end if;
      return inv.org_id;
    end if;

    -- owner setup code; the lock serialises two people entering it at the same moment
    perform 1 from public.app_settings s
     where s.id = 1 and s.setup_code_hash = h and s.setup_code_used_at is null
       for update;
    if found and not exists (select 1 from public.organizations) then
      insert into public.organizations (name, created_by) values ('Kos Saya', me) returning id into new_org;
      insert into public.organization_members (org_id, user_id, email, role)
      values (new_org, me, (select u.email from auth.users u where u.id = me), 'owner');
      update public.app_settings set setup_code_used_at = now() where id = 1;
      return new_org;
    end if;
  end if;

  -- an exception would roll this record back, so a failure returns null instead
  insert into public.join_attempts (user_id) values (me);
  return null;
end $$;

-- Admin only: a one-time code (8 characters, valid 7 days) for a new admin/staff member. It works
-- only while its maker is still an owner/admin. The plain code is returned once; only its hash is stored.
create or replace function public.create_invitation(p_org_id uuid, p_role text, p_label text)
returns table (code text, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  clean_label text := nullif(btrim(p_label, E' \t\r\n'), '');
  new_code text;
  inv_id uuid;
  inv_expires timestamptz;
  rnd bytea;
  b int;
begin
  if not public.is_org_admin(p_org_id) then
    raise exception 'Hanya pemilik/admin yang dapat membuat kode undangan.';
  end if;
  if p_role is null or p_role not in ('admin', 'staff') then
    raise exception 'Peran tidak valid.';
  end if;
  if char_length(clean_label) > 60 then
    raise exception 'Keterangan maksimal 60 karakter.';
  end if;
  -- serialise per organisation so the limit holds under concurrent calls
  perform 1 from public.organizations o where o.id = p_org_id for no key update;
  if (select count(*) from public.invitations i
      where i.org_id = p_org_id and i.accepted_at is null and i.expires_at > now()) >= 20 then
    raise exception 'Sudah ada 20 kode undangan aktif. Hapus kode yang tidak dipakai dulu.';
  end if;

  insert into public.invitations as i (org_id, label, role, invited_by)
  values (p_org_id, clean_label, p_role, auth.uid())
  returning i.id, i.expires_at into inv_id, inv_expires;

  loop
    new_code := '';
    while char_length(new_code) < 8 loop
      rnd := uuid_send(gen_random_uuid());
      for k in 0..15 loop
        b := get_byte(rnd, k);
        -- bytes 6 and 8 hold the UUID version/variant bits; values >= 248 would bias the modulo
        continue when k in (6, 8) or b >= 248;
        new_code := new_code || substr(alphabet, 1 + b % 31, 1);
        exit when char_length(new_code) = 8;
      end loop;
    end loop;
    begin
      insert into public.invitation_codes (invitation_id, code_hash) values (inv_id, public.hash_code(new_code));
      exit;
    exception when unique_violation then
      null; -- that code is already in use: draw another
    end;
  end loop;

  return query select new_code, inv_expires;
end $$;

-- Owner only. The organisation always keeps at least one owner.
create or replace function public.set_member_role(p_org_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target_role text;
begin
  -- serialise membership changes per organisation (two owners demoting each other at once)
  perform 1 from public.organizations where id = p_org_id for no key update;
  if not public.is_org_owner(p_org_id) then
    raise exception 'Hanya pemilik yang dapat mengubah peran anggota.';
  end if;
  if p_role is null or p_role not in ('owner', 'admin', 'staff') then
    raise exception 'Peran tidak valid.';
  end if;
  select role into target_role from public.organization_members where org_id = p_org_id and user_id = p_user_id;
  if target_role is null then
    raise exception 'Anggota tidak ditemukan.';
  end if;
  if target_role = 'owner' and p_role <> 'owner'
     and (select count(*) from public.organization_members where org_id = p_org_id and role = 'owner') <= 1 then
    raise exception 'Tidak dapat mengubah peran pemilik terakhir.';
  end if;
  update public.organization_members set role = p_role
   where org_id = p_org_id and user_id = p_user_id and role <> p_role;
  -- staff cannot invite: codes they made earlier stop working
  if p_role = 'staff' then
    update public.invitations set expires_at = now()
     where org_id = p_org_id and invited_by = p_user_id and accepted_at is null and expires_at > now();
  end if;
end $$;

create or replace function public.remove_member(p_org_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  owners int;
  target_role text;
begin
  perform 1 from public.organizations where id = p_org_id for no key update;
  if not public.is_org_admin(p_org_id) then
    raise exception 'Hanya pemilik/admin yang dapat menghapus anggota.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Tidak dapat menghapus diri sendiri.';
  end if;
  select role into target_role from public.organization_members where org_id = p_org_id and user_id = p_user_id;
  if target_role is null then return; end if;
  if target_role = 'owner' then
    if not public.is_org_owner(p_org_id) then
      raise exception 'Hanya pemilik yang dapat menghapus pemilik lain.';
    end if;
    select count(*) into owners from public.organization_members where org_id = p_org_id and role = 'owner';
    if owners <= 1 then
      raise exception 'Tidak dapat menghapus pemilik terakhir.';
    end if;
  elsif target_role = 'admin' and not public.is_org_owner(p_org_id) then
    raise exception 'Hanya pemilik yang dapat menghapus admin.';
  end if;
  -- codes the person made stop working too
  update public.invitations set expires_at = now()
   where org_id = p_org_id and invited_by = p_user_id and accepted_at is null and expires_at > now();
  delete from public.organization_members where org_id = p_org_id and user_id = p_user_id;
end $$;

-- v0.2 joined people by email on signup; membership now only comes from codes.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop function if exists public.accept_invitations_for(uuid, text);
drop function if exists public.add_member_by_email(uuid, text, text);

-- ---------- business tables ----------
-- Every table has unique (org_id, id) so children can reference parents with a composite FK.

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text,
  notes text,
  -- bank account / QRIS instructions inserted into WhatsApp reminders
  payment_info text,
  -- storage path of the kos logo (bucket logos), shown on invoices
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);
-- storage path of the kos logo (bucket logos), shown on invoices (added after v0.3; the create above is a
-- no-op on an existing installation)
alter table public.properties add column if not exists logo_path text;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null,
  name text not null,
  floor text,
  price_daily bigint check (price_daily is null or price_daily >= 0),
  price_weekly bigint check (price_weekly is null or price_weekly >= 0),
  price_monthly bigint check (price_monthly is null or price_monthly >= 0),
  status text not null default 'active' check (status in ('active', 'maintenance')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, property_id) references public.properties (org_id, id) on delete restrict
);

create table if not exists public.addon_catalog (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid,
  name text not null,
  default_price bigint not null default 0,
  billing text not null default 'per_period' check (billing in ('per_period', 'one_time')),
  created_at timestamptz not null default now(),
  foreign key (org_id, property_id) references public.properties (org_id, id) on delete cascade
);

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid,
  full_name text not null,
  nik text,
  id_type text not null default 'ktp' check (id_type in ('ktp', 'passport', 'other')),
  id_number text,
  nationality text,
  phone text,
  gender text check (gender is null or gender in ('L', 'P')),
  birth_place text,
  birth_date date,
  address text,
  religion text,
  marital_status text,
  occupation text,
  emergency_contact_name text,
  emergency_contact_phone text,
  ktp_image_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, property_id) references public.properties (org_id, id) on delete set null (property_id)
);

create table if not exists public.leases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null,
  room_id uuid not null,
  tenant_id uuid not null,
  period_type text not null check (period_type in ('daily', 'weekly', 'monthly')),
  price_per_period bigint not null check (price_per_period >= 0),
  deposit_amount bigint not null default 0 check (deposit_amount >= 0),
  start_date date not null,
  end_date date not null,
  status text not null default 'active' check (status in ('active', 'ended', 'cancelled')),
  checkout_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  unique (org_id, id),
  foreign key (org_id, property_id) references public.properties (org_id, id) on delete restrict,
  foreign key (org_id, room_id) references public.rooms (org_id, id) on delete restrict,
  foreign key (org_id, tenant_id) references public.tenants (org_id, id) on delete restrict
);

create table if not exists public.lease_addons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lease_id uuid not null,
  name text not null,
  amount bigint not null,
  billing text not null default 'per_period' check (billing in ('per_period', 'one_time')),
  created_at timestamptz not null default now(),
  foreign key (org_id, lease_id) references public.leases (org_id, id) on delete cascade
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null,
  lease_id uuid not null,
  invoice_number text not null,
  -- period type this invoice was billed with (null = lease's type at the time; leases may switch type)
  period_type text check (period_type is null or period_type in ('daily', 'weekly', 'monthly')),
  period_start date not null,
  period_end date not null,
  quantity int not null default 1 check (quantity >= 1),
  base_amount bigint not null default 0 check (base_amount >= 0),
  addons_amount bigint not null default 0,
  extra_amount bigint not null default 0 check (extra_amount >= 0),
  discount_amount bigint not null default 0 check (discount_amount >= 0),
  total_amount bigint not null default 0 check (total_amount >= 0),
  due_date date not null,
  status text not null default 'unpaid' check (status in ('unpaid', 'partial', 'paid', 'void')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  -- the components always explain the total
  check (total_amount = base_amount + addons_amount + extra_amount - discount_amount),
  unique (org_id, id),
  unique (org_id, invoice_number),
  foreign key (org_id, property_id) references public.properties (org_id, id) on delete restrict,
  foreign key (org_id, lease_id) references public.leases (org_id, id) on delete restrict
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null,
  invoice_id uuid,
  lease_id uuid,
  amount bigint not null check (amount > 0),
  paid_at date not null,
  -- 'deposit' = paid by using the tenant's held deposit (potong jaminan): revenue, not cash in
  method text not null default 'cash' check (method in ('cash', 'transfer', 'qris', 'deposit', 'other')),
  kind text not null default 'rent' check (kind in ('rent', 'deposit', 'other')),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  -- rent payments always sit on an invoice; deposit/other never do
  check ((kind = 'rent') = (invoice_id is not null)),
  foreign key (org_id, property_id) references public.properties (org_id, id) on delete restrict,
  foreign key (org_id, invoice_id) references public.invoices (org_id, id) on delete restrict,
  foreign key (org_id, lease_id) references public.leases (org_id, id) on delete restrict
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid,
  -- deposit_refund / rent_refund are money returned to a tenant, not operating cost; they need lease_id
  lease_id uuid,
  category text not null check (category in ('wages', 'maintenance', 'utilities', 'supplies', 'tax', 'marketing', 'deposit_refund', 'rent_refund', 'other')),
  amount bigint not null check (amount >= 0),
  expense_date date not null,
  description text not null,
  vendor text,
  receipt_path text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (category not in ('deposit_refund', 'rent_refund') or lease_id is not null),
  foreign key (org_id, property_id) references public.properties (org_id, id) on delete set null (property_id),
  foreign key (org_id, lease_id) references public.leases (org_id, id) on delete restrict
);

-- Daftar tunggu (SPEC 7.7): people waiting for a room, with what they want. Front-desk work: every member may add and
-- change entries (staff included); only owners/admins may delete one (cancelling is the normal path). lease_id is the
-- lease booked for the entry; deleting that lease (or the kos) only clears the reference.
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- null = any kos
  property_id uuid,
  name text not null check (btrim(name) <> ''),
  phone text,
  -- first night wanted; null = secepatnya (as soon as possible)
  wanted_from date,
  period_type text not null default 'daily' check (period_type in ('daily', 'weekly', 'monthly')),
  quantity int not null default 1 check (quantity >= 1),
  -- highest price per night / week / month
  max_price bigint check (max_price is null or max_price >= 0),
  -- room preference, e.g. 'lantai bawah, kamar mandi dalam'
  room_note text,
  notes text,
  status text not null default 'waiting' check (status in ('waiting', 'booked', 'cancelled')),
  lease_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, property_id) references public.properties (org_id, id) on delete set null (property_id),
  foreign key (org_id, lease_id) references public.leases (org_id, id) on delete set null (lease_id)
);

-- Deleting a property clears only property_id on its tenants and expenses (v0.2 cleared org_id too,
-- which failed). Replace older constraints in place.
do $$
declare
  t text;
  c record;
begin
  foreach t in array array['tenants', 'expenses'] loop
    for c in
      select con.conname from pg_constraint con
       where con.conrelid = ('public.' || t)::regclass and con.contype = 'f'
         and con.confrelid = 'public.properties'::regclass
         and pg_get_constraintdef(con.oid) not like '%ON DELETE SET NULL (property_id)'
    loop
      execute format('alter table public.%I drop constraint %I', t, c.conname);
    end loop;
    if not exists (select 1 from pg_constraint con
                    where con.conrelid = ('public.' || t)::regclass and con.contype = 'f'
                      and con.confrelid = 'public.properties'::regclass) then
      execute format('alter table public.%I add foreign key (org_id, property_id) references public.properties (org_id, id) on delete set null (property_id)', t);
    end if;
  end loop;
end $$;

-- indexes
create index if not exists properties_org_idx on public.properties (org_id);
create index if not exists rooms_org_idx on public.rooms (org_id, property_id);
create index if not exists addon_catalog_org_idx on public.addon_catalog (org_id);
create index if not exists tenants_org_idx on public.tenants (org_id);
create index if not exists leases_org_idx on public.leases (org_id, status);
create index if not exists leases_room_idx on public.leases (room_id);
create index if not exists leases_tenant_idx on public.leases (tenant_id);
create index if not exists lease_addons_lease_idx on public.lease_addons (lease_id);
create index if not exists invoices_org_idx on public.invoices (org_id, due_date);
create index if not exists invoices_lease_idx on public.invoices (lease_id);
create index if not exists invoices_status_idx on public.invoices (org_id, status);
create index if not exists payments_org_idx on public.payments (org_id, paid_at);
create index if not exists payments_invoice_idx on public.payments (invoice_id);
create index if not exists payments_lease_idx on public.payments (lease_id);
create index if not exists expenses_org_idx on public.expenses (org_id, expense_date);
create index if not exists expenses_lease_idx on public.expenses (lease_id);
create index if not exists waitlist_org_idx on public.waitlist (org_id, status);
create index if not exists waitlist_lease_idx on public.waitlist (lease_id);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['properties', 'rooms', 'tenants', 'leases', 'invoices', 'expenses', 'waitlist'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------- invoice status consistency ----------
-- Status is derived from rent payments. The app computes it too (for demo mode); these triggers
-- make the database the source of truth online, so staff never need UPDATE on invoices to pay.

create or replace function public.invoice_status_for(p_total bigint, p_paid bigint)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when p_paid >= p_total then 'paid' when p_paid > 0 then 'partial' else 'unpaid' end;
$$;

create or replace function public.recalc_invoice_status(p_invoice uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inv record;
  paid bigint;
begin
  if p_invoice is null then return; end if;
  select id, org_id, total_amount, status into inv from public.invoices where id = p_invoice;
  if not found then return; end if;
  -- callable through RPC too, so guard it (auth.uid() is null only for the operator)
  if auth.uid() is not null and not public.is_org_member(inv.org_id) then
    raise exception 'Tidak memiliki akses.';
  end if;
  if inv.status = 'void' then return; end if;
  select coalesce(sum(amount), 0) into paid from public.payments where invoice_id = p_invoice and kind = 'rent';
  update public.invoices
  set status = public.invoice_status_for(inv.total_amount, paid)
  where id = p_invoice and status is distinct from public.invoice_status_for(inv.total_amount, paid);
end $$;

create or replace function public.payments_recalc_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalc_invoice_status(old.invoice_id);
    return old;
  end if;
  perform public.recalc_invoice_status(new.invoice_id);
  if tg_op = 'UPDATE' and old.invoice_id is distinct from new.invoice_id then
    perform public.recalc_invoice_status(old.invoice_id);
  end if;
  return new;
end $$;

drop trigger if exists payments_recalc on public.payments;
create trigger payments_recalc
  after insert or update or delete on public.payments
  for each row execute function public.payments_recalc_trigger();

create or replace function public.invoices_recalc_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare paid bigint;
begin
  -- voiding is an admin edit; an invoice inserted as void by anyone else is treated as a normal one
  if new.status = 'void'
     and (tg_op = 'UPDATE' or auth.uid() is null or public.is_org_admin(new.org_id)) then
    return new;
  end if;
  select coalesce(sum(amount), 0) into paid from public.payments where invoice_id = new.id and kind = 'rent';
  if tg_op = 'UPDATE' and new.total_amount < paid then
    raise exception 'Total tagihan tidak boleh lebih kecil dari jumlah yang sudah dibayar.';
  end if;
  new.status := public.invoice_status_for(new.total_amount, paid);
  return new;
end $$;

drop trigger if exists invoices_recalc on public.invoices;
create trigger invoices_recalc
  before insert or update of total_amount, status on public.invoices
  for each row execute function public.invoices_recalc_trigger();

-- Refuse to void an invoice that still has rent payments (move/delete them first).
create or replace function public.invoices_void_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'void' and old.status <> 'void'
     and exists (select 1 from public.payments where invoice_id = new.id and kind = 'rent') then
    raise exception 'Tagihan yang sudah ada pembayarannya tidak dapat dibatalkan.';
  end if;
  return new;
end $$;

drop trigger if exists invoices_void_guard on public.invoices;
create trigger invoices_void_guard
  before update of status on public.invoices
  for each row execute function public.invoices_void_guard();

-- ---------- staff limits ----------
-- Row-level rules are in the policies below; these triggers guard single columns. auth.uid() is null
-- for the operator (SQL editor, service role), who is not limited.

create or replace function public.rooms_price_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null
     and (new.price_daily is distinct from old.price_daily
       or new.price_weekly is distinct from old.price_weekly
       or new.price_monthly is distinct from old.price_monthly)
     and not public.is_org_admin(old.org_id) then
    raise exception 'Hanya pemilik/admin yang dapat mengubah harga kamar.';
  end if;
  return new;
end $$;

drop trigger if exists rooms_price_guard on public.rooms;
create trigger rooms_price_guard
  before update on public.rooms
  for each row execute function public.rooms_price_guard();

create or replace function public.leases_terms_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null
     and (new.price_per_period is distinct from old.price_per_period
       or new.deposit_amount is distinct from old.deposit_amount
       or new.period_type is distinct from old.period_type)
     and not public.is_org_admin(old.org_id) then
    raise exception 'Hanya pemilik/admin yang dapat mengubah harga atau jenis sewa.';
  end if;
  -- the start date anchors every billing period (SPEC 7.6): moving it is an owner/admin correction (redate_lease)
  if auth.uid() is not null
     and new.start_date is distinct from old.start_date
     and not public.is_org_admin(old.org_id) then
    raise exception 'Hanya pemilik/admin yang dapat mengubah tanggal mulai sewa.';
  end if;
  return new;
end $$;

drop trigger if exists leases_terms_guard on public.leases;
create trigger leases_terms_guard
  before update on public.leases
  for each row execute function public.leases_terms_guard();

-- ---------- lease start correction (SPEC 7.6) ----------
-- The owner typed a wrong start date and noticed months later. The app plans the new dates of the lease and of every
-- one of its invoices (src/features/leases/redate.ts) and saves them here in ONE transaction. Security invoker: the
-- caller's row-level security and every trigger still apply (only owners/admins may update invoices); amounts, numbers,
-- statuses and payments are never touched. SQLSTATE WB002 = the lease or its invoices changed since the screen read
-- them (another device): nothing is written and the app reloads. Mode Demo mirrors this in LocalRepo.redateLease.
create or replace function public.redate_lease(
  p_lease_id uuid,
  p_expected_start date,
  p_new_start date,
  p_new_end date,
  p_invoices jsonb,
  p_note text default null)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  l public.leases%rowtype;
  v_given int;
  v_distinct int;
  v_own int;
  v_match int;
  v_note text := nullif(btrim(coalesce(p_note, ''), E' \t\r\n'), '');
  v_changed constant text := 'Tagihan atau pembayaran sewa ini baru saja diubah dari perangkat lain. Periksa angka terbaru di layar, lalu coba lagi.';
begin
  -- one correction at a time per lease; an invoice issued meanwhile (it extends end_date) waits for this one
  select * into l from public.leases where id = p_lease_id for update;
  if not found then
    raise exception 'Sewa tidak ditemukan.';
  end if;
  if auth.uid() is not null and not public.is_org_admin(l.org_id) then
    raise exception 'Hanya pemilik/admin yang dapat mengubah tanggal mulai sewa.';
  end if;
  if p_expected_start is null or p_new_start is null or p_new_end is null or p_invoices is null or jsonb_typeof(p_invoices) <> 'array' then
    raise exception 'Data perubahan tanggal tidak lengkap.';
  end if;
  -- ended/cancelled leases keep their dates: their check-out and refunds were real events
  if l.status <> 'active' then
    raise exception 'Sewa yang sudah selesai atau dibatalkan tidak bisa diubah tanggal mulainya.';
  end if;
  if l.start_date <> p_expected_start then
    raise exception using errcode = 'WB002', message = v_changed;
  end if;
  perform 1 from public.invoices where lease_id = l.id for update;
  if exists (select 1 from jsonb_to_recordset(p_invoices) as g(id uuid, period_start date, period_end date, due_date date)
              where g.id is null or g.period_start is null or g.period_end is null or g.due_date is null) then
    raise exception 'Data perubahan tanggal tidak lengkap.';
  end if;
  -- exactly the lease's invoices (void ones too), each once
  select count(*), count(distinct g.id) into v_given, v_distinct from jsonb_to_recordset(p_invoices) as g(id uuid);
  select count(*) into v_own from public.invoices where lease_id = l.id;
  select count(*) into v_match from public.invoices i
   where i.lease_id = l.id and i.id in (select g.id from jsonb_to_recordset(p_invoices) as g(id uuid));
  if v_given <> v_distinct or v_given <> v_own or v_match <> v_own then
    raise exception using errcode = 'WB002', message = v_changed;
  end if;
  if p_new_start = l.start_date then
    raise exception 'Tanggal mulai sama dengan sebelumnya.';
  end if;
  if p_new_end < p_new_start then
    raise exception 'Tanggal akhir sewa tidak boleh sebelum tanggal mulai.';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_invoices) as g(id uuid, period_start date, period_end date)
              where g.period_end < g.period_start) then
    raise exception 'Periode tagihan tidak valid: tanggal akhir sebelum tanggal mulai.';
  end if;
  -- double booking (SPEC 2b.8, same rule as leaseOverlaps): another non-cancelled lease of the room holds a night of
  -- [p_new_start, p_new_end]; an ended lease holds its room until the night before its checkout_date (SPEC 7.3).
  -- Only collisions this correction creates: a lease that already overlaps the stored span [l.start_date, l.end_date]
  -- is room history (the previous tenant of a room this lease moved into, SPEC 2b.9), not a new double booking.
  if exists (
    select 1 from public.leases o
     where o.room_id = l.room_id and o.id <> l.id and o.status <> 'cancelled'
       and o.start_date <= p_new_end
       and (case when o.status = 'ended' and o.checkout_date is not null then o.checkout_date - 1 else o.end_date end) >= p_new_start
       and not (o.start_date <= l.end_date
                and (case when o.status = 'ended' and o.checkout_date is not null then o.checkout_date - 1 else o.end_date end) >= l.start_date)) then
    raise exception 'Jadwal bentrok dengan sewa lain di kamar yang sama.';
  end if;

  update public.invoices i
     set period_start = g.period_start, period_end = g.period_end, due_date = g.due_date
    from jsonb_to_recordset(p_invoices) as g(id uuid, period_start date, period_end date, due_date date)
   where i.id = g.id and i.lease_id = l.id
     and (i.period_start, i.period_end, i.due_date) is distinct from (g.period_start, g.period_end, g.due_date);
  update public.leases
     set start_date = p_new_start,
         end_date = p_new_end,
         notes = case
           when v_note is null then notes
           when nullif(btrim(coalesce(notes, ''), E' \t\r\n'), '') is null then v_note
           else btrim(notes, E' \t\r\n') || E'\n' || v_note
         end
   where id = l.id;
end $$;

-- ---------- double booking (SPEC 2b.8, 7.7) ----------
-- The app checks a room before it books it, but two phones can book the same room at the same moment. This trigger
-- serialises bookings per room (a transaction advisory lock on the room id: the second phone waits until the first
-- commits, then sees its row) and refuses a write that would create a NEW double booking: another lease of the room,
-- not cancelled, holding a night the write adds (same rule as leaseOverlaps: an ended lease holds its room until
-- checkout_date - 1, an active one until end_date; a lease without a night holds none). Only future nights (from today)
-- are checked, so history and the existing flows keep working:
--  * INSERT of an active lease: [greatest(start_date, today), end_date]; ended/cancelled rows (history, imports) pass;
--  * UPDATE keeping room, start_date and status active while end_date grows (Perpanjang / Tagih):
--    [greatest(old end_date + 1, today), new end_date];
--  * not checked: room moves (the app checks them, SPEC 2b.9), start-date corrections (redate_lease checks itself),
--    shorter ends, checkouts and cancels.
-- SQLSTATE WB003; the app shows the message as is (LEASE_OVERLAP_MESSAGE).
create or replace function public.leases_overlap_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_from date;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'active' then return new; end if;
    v_from := greatest(new.start_date, current_date);
  else
    if new.room_id is distinct from old.room_id or new.start_date is distinct from old.start_date
       or old.status <> 'active' or new.status <> 'active' or new.end_date <= old.end_date then
      return new;
    end if;
    v_from := greatest(old.end_date + 1, current_date);
  end if;
  if v_from > new.end_date then return new; end if;
  -- one booking per room at a time; the check below runs after the lock, so it sees what the other phone committed
  perform pg_advisory_xact_lock(hashtextextended('leases_overlap_guard:' || new.room_id::text, 0));
  if exists (
    select 1 from (
      select o.start_date as first_night,
             case when o.status = 'ended' and o.checkout_date is not null then o.checkout_date - 1 else o.end_date end as last_night
        from public.leases o
       where o.room_id = new.room_id and o.id <> new.id and o.status <> 'cancelled'
    ) h
     where h.last_night >= h.first_night and h.first_night <= new.end_date and h.last_night >= v_from) then
    raise exception using errcode = 'WB003', message = 'Kamar sudah terisi atau dipesan pada tanggal itu.';
  end if;
  return new;
end $$;

drop trigger if exists leases_overlap_guard on public.leases;
create trigger leases_overlap_guard
  before insert or update on public.leases
  for each row execute function public.leases_overlap_guard();

-- created_by is always the signed-in user who inserted the row, and never changes afterwards.
create or replace function public.set_created_by()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
    else
      new.created_by := old.created_by;
    end if;
  end if;
  return new;
end $$;

-- A row never moves to another organisation (someone in two organisations could otherwise carry
-- tenants' data across).
create or replace function public.keep_org_id()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and new.org_id is distinct from old.org_id then
    raise exception 'Data tidak dapat dipindah ke organisasi lain.';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['organizations', 'payments', 'expenses', 'waitlist'] loop
    execute format('drop trigger if exists set_created_by on public.%I', t);
    execute format('create trigger set_created_by before insert or update of created_by on public.%I for each row execute function public.set_created_by()', t);
  end loop;
  foreach t in array array['properties', 'rooms', 'addon_catalog', 'tenants', 'leases', 'lease_addons', 'invoices', 'payments', 'expenses', 'waitlist'] loop
    execute format('drop trigger if exists keep_org_id on public.%I', t);
    execute format('create trigger keep_org_id before update of org_id on public.%I for each row execute function public.keep_org_id()', t);
  end loop;
end $$;

-- ---------- audit log ----------
-- Append-only history written by triggers. Owners/admins can read it; nobody can change it via the API.

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  table_name text not null,
  row_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb
);
create index if not exists audit_log_org_changed_idx on public.audit_log (org_id, changed_at desc);

create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  any_row jsonb := coalesce(new_row, old_row);
  org uuid := (case when tg_table_name = 'organizations' then any_row ->> 'id' else any_row ->> 'org_id' end)::uuid;
begin
  if tg_op = 'UPDATE' and old_row = new_row then return null; end if;
  -- rows removed while an organisation is being deleted (operator only): its history goes with it
  if not exists (select 1 from public.organizations where id = org) then return null; end if;
  -- clock_timestamp keeps several changes made in one request in order
  insert into public.audit_log (org_id, table_name, row_id, action, changed_by, changed_at, old_data, new_data)
  values (org, tg_table_name, (any_row ->> 'id')::uuid, lower(tg_op), auth.uid(), clock_timestamp(), old_row, new_row);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['organizations', 'organization_members', 'invitations', 'properties', 'rooms', 'addon_catalog',
                           'tenants', 'leases', 'lease_addons', 'invoices', 'payments', 'expenses', 'waitlist'] loop
    execute format('drop trigger if exists audit_row_change on public.%I', t);
    execute format('create trigger audit_row_change after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- ---------- storage cleanup ----------
-- Supabase refuses direct deletes from storage.objects; the app deletes the row first, then the file
-- through the Storage API.
drop trigger if exists tenants_delete_ktp on public.tenants;
drop trigger if exists expenses_delete_receipt on public.expenses;
drop function if exists public.delete_tenant_ktp();
drop function if exists public.delete_expense_receipt();

-- ---------- Row Level Security ----------

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.invitations enable row level security;
alter table public.invitation_codes enable row level security;
alter table public.app_settings enable row level security;
alter table public.join_attempts enable row level security;
alter table public.properties enable row level security;
alter table public.rooms enable row level security;
alter table public.addon_catalog enable row level security;
alter table public.tenants enable row level security;
alter table public.leases enable row level security;
alter table public.lease_addons enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.audit_log enable row level security;
alter table public.waitlist enable row level security;
-- invitation_codes, app_settings, join_attempts: no policies (and no grants) on purpose

-- organizations: created only by join_with_code() (security definer)
drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations for select using (public.is_org_member(id));
drop policy if exists org_insert on public.organizations;
drop policy if exists org_update on public.organizations;
create policy org_update on public.organizations for update using (public.is_org_admin(id)) with check (public.is_org_admin(id));
drop policy if exists org_delete on public.organizations;

-- organization_members: read-only; changes go through join_with_code / set_member_role / remove_member
drop policy if exists members_select on public.organization_members;
create policy members_select on public.organization_members for select using (public.is_org_member(org_id));
drop policy if exists members_insert on public.organization_members;
drop policy if exists members_update on public.organization_members;
drop policy if exists members_delete on public.organization_members;

-- invitations: admins see and delete them; they are created by create_invitation()
drop policy if exists invitations_all on public.invitations;
drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations for select using (public.is_org_admin(org_id));
drop policy if exists invitations_delete on public.invitations;
create policy invitations_delete on public.invitations for delete using (public.is_org_admin(org_id));

-- audit_log: owners/admins read; no insert/update/delete policy for anyone
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select using (public.is_org_admin(org_id));

-- business tables
do $$
declare
  t text;
  op text;
begin
  foreach t in array array['properties', 'rooms', 'addon_catalog', 'tenants', 'leases', 'lease_addons', 'invoices', 'payments', 'expenses'] loop
    foreach op in array array['select', 'insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I', t || '_' || op, t);
    end loop;
    execute format('create policy %I on public.%I for select using (public.is_org_member(org_id))', t || '_select', t);
  end loop;

  -- insert: every member, except master data that carries prices or the bank account
  foreach t in array array['tenants', 'leases', 'lease_addons', 'invoices', 'payments', 'expenses'] loop
    execute format('create policy %I on public.%I for insert with check (public.is_org_member(org_id))', t || '_insert', t);
  end loop;
  foreach t in array array['properties', 'rooms', 'addon_catalog'] loop
    execute format('create policy %I on public.%I for insert with check (public.is_org_admin(org_id))', t || '_insert', t);
  end loop;

  -- update: staff may edit rooms and leases (price columns guarded by triggers), tenants and add-ons
  foreach t in array array['rooms', 'tenants', 'leases', 'lease_addons'] loop
    execute format('create policy %I on public.%I for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id))', t || '_update', t);
  end loop;
  foreach t in array array['properties', 'addon_catalog', 'invoices', 'payments', 'expenses'] loop
    execute format('create policy %I on public.%I for update using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id))', t || '_update', t);
  end loop;

  -- delete: staff may delete tenants and lease add-ons (the DB restricts rows still referenced)
  foreach t in array array['tenants', 'lease_addons'] loop
    execute format('create policy %I on public.%I for delete using (public.is_org_member(org_id))', t || '_delete', t);
  end loop;
  foreach t in array array['properties', 'rooms', 'addon_catalog', 'leases', 'invoices', 'payments', 'expenses'] loop
    execute format('create policy %I on public.%I for delete using (public.is_org_admin(org_id))', t || '_delete', t);
  end loop;
end $$;

-- waitlist (SPEC 7.7): front-desk work, so every member reads, adds and changes entries; deleting is owner/admin only
drop policy if exists waitlist_select on public.waitlist;
create policy waitlist_select on public.waitlist for select using (public.is_org_member(org_id));
drop policy if exists waitlist_insert on public.waitlist;
create policy waitlist_insert on public.waitlist for insert with check (public.is_org_member(org_id));
drop policy if exists waitlist_update on public.waitlist;
create policy waitlist_update on public.waitlist for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
drop policy if exists waitlist_delete on public.waitlist;
create policy waitlist_delete on public.waitlist for delete using (public.is_org_admin(org_id));

-- ---------- Storage (KTP photos, receipts & kos logos) ----------
-- Object paths are "<org_id>/<file>"; access is granted to members of that org. The logos bucket holds the
-- kos logo shown on digital invoices (properties.logo_path); small images only (1 MB).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('ktp', 'ktp', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('logos', 'logos', false, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create or replace function public.path_org_id(p_name text)
returns uuid language plpgsql immutable set search_path = public, pg_temp as $$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when others then
  return null;
end $$;

drop policy if exists storage_org_select on storage.objects;
create policy storage_org_select on storage.objects for select
  using (bucket_id in ('ktp', 'receipts', 'logos') and public.is_org_member(public.path_org_id(name)));
-- Writing a logo follows the kos itself (admin only, SPEC 6.2); every member may read it for the invoice image.
drop policy if exists storage_org_insert on storage.objects;
create policy storage_org_insert on storage.objects for insert
  with check (
    (bucket_id in ('ktp', 'receipts') and public.is_org_member(public.path_org_id(name)))
    or (bucket_id = 'logos' and public.is_org_admin(public.path_org_id(name)))
  );
drop policy if exists storage_org_update on storage.objects;
create policy storage_org_update on storage.objects for update
  using (
    (bucket_id in ('ktp', 'receipts') and public.is_org_member(public.path_org_id(name)))
    or (bucket_id = 'logos' and public.is_org_admin(public.path_org_id(name)))
  );
drop policy if exists storage_org_delete on storage.objects;
create policy storage_org_delete on storage.objects for delete
  using (
    (bucket_id in ('ktp', 'receipts') and public.is_org_member(public.path_org_id(name)))
    or (bucket_id = 'logos' and public.is_org_admin(public.path_org_id(name)))
  );

-- ---------- keep-alive ----------
-- Free Supabase projects are paused after about a week with too little database activity. A scheduled GitHub
-- Action (.github/workflows/keepalive.yml) calls keepalive() a few times a day. Since 2026 read-only pings are
-- reported not to count any more, so it updates one heartbeat row (at most once a minute, so calling it in a loop
-- changes nothing). The row is not readable through the API and not part of the change history.
create table if not exists public.keepalive_heartbeat (
  id int primary key default 1 check (id = 1),
  pinged_at timestamptz not null default now(),
  pings bigint not null default 0
);
alter table public.keepalive_heartbeat enable row level security;

create or replace function public.keepalive()
returns timestamptz language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  insert into public.keepalive_heartbeat as h (id, pinged_at, pings) values (1, now(), 1)
  on conflict (id) do update set pinged_at = now(), pings = h.pings + 1
  where h.pinged_at < now() - interval '1 minute';
  return now();
end $$;

-- ---------- scheduled backups ----------
-- A weekly GitHub Action (.github/workflows/backup.yml) signs in as woombad_backup, a login role that can do one
-- thing: run export_backup(). It cannot read or change any table directly. Its password is set by the operator
-- only, never in this file:  alter role woombad_backup password '...';
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'woombad_backup') then
    create role woombad_backup login noinherit connection limit 2;
  end if;
end $$;
alter role woombad_backup set statement_timeout = '60s';

-- Every organisation as one backup file in the app's format ({ version, exportedAt, orgName, tables }, the same as
-- Pengaturan -> Data -> Unduh cadangan lengkap). Code hashes, the setup code and join attempts are left out.
create or replace function public.export_backup()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  o record;
  t text;
  tables jsonb;
  rows jsonb;
  result jsonb := '[]'::jsonb;
begin
  for o in select * from public.organizations order by created_at, id loop
    tables := jsonb_build_object('organizations', jsonb_build_array(to_jsonb(o)));
    foreach t in array array['organization_members', 'invitations', 'properties', 'rooms', 'addon_catalog', 'tenants',
                             'leases', 'lease_addons', 'invoices', 'payments', 'expenses', 'waitlist'] loop
      execute format('select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), ''[]'') from public.%I x where x.org_id = $1', t)
        into rows using o.id;
      tables := tables || jsonb_build_object(t, rows);
    end loop;
    select coalesce(jsonb_agg(to_jsonb(a) order by a.changed_at, a.id), '[]') into rows from public.audit_log a where a.org_id = o.id;
    tables := tables || jsonb_build_object('audit_log', rows);
    result := result || jsonb_build_array(jsonb_build_object(
      'version', 1,
      'exportedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'orgName', o.name,
      'tables', tables));
  end loop;
  return result;
end $$;

-- ---------- grants: least privilege ----------
-- Supabase grants ALL (including TRUNCATE, which ignores RLS) on new tables and EXECUTE on new
-- functions to anon and authenticated. Take everything back, then grant exactly what the app uses:
-- anon gets only keepalive(); authenticated gets the table rights its policies need and the RPCs.
-- Trigger functions need no grant (EXECUTE is not checked when a trigger fires).

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select, update on public.organizations to authenticated;
grant select on public.organization_members to authenticated;
grant select, delete on public.invitations to authenticated;
grant select, insert, update, delete on public.properties, public.rooms, public.addon_catalog, public.tenants,
  public.leases, public.lease_addons, public.invoices, public.payments, public.expenses to authenticated;
grant select, insert, update, delete on public.waitlist to authenticated;
grant select on public.audit_log to authenticated;
-- RPCs
grant execute on function public.ensure_membership() to authenticated;
grant execute on function public.join_with_code(text) to authenticated;
grant execute on function public.create_invitation(uuid, text, text) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.recalc_invoice_status(uuid) to authenticated;
grant execute on function public.redate_lease(uuid, date, date, date, jsonb, text) to authenticated;
-- policy and trigger helpers are evaluated as the calling role and must stay executable
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;
grant execute on function public.is_org_owner(uuid) to authenticated;
grant execute on function public.path_org_id(text) to authenticated;
grant execute on function public.invoice_status_for(bigint, bigint) to authenticated;
-- the scheduled keep-alive ping uses the public key, i.e. the anon role
grant execute on function public.keepalive() to anon;
-- the weekly backup job
grant usage on schema public to woombad_backup;
grant execute on function public.export_backup() to woombad_backup;
-- operator only
grant execute on function public.set_setup_code(text) to service_role;
-- objects added to public later get no access until granted explicitly
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

commit;
