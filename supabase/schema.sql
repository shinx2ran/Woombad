-- =====================================================================================
-- Woombad: Supabase / PostgreSQL schema
-- Run this whole file once in Supabase Dashboard -> SQL Editor on a fresh project.
-- Design notes:
--  * One family = one organisation. The FIRST account to sign up creates the organisation;
--    every later account must be invited (Pengaturan -> Anggota) and signs up with that email.
--  * Every business row carries org_id; Row Level Security is a single is_org_member(org_id) check,
--    and composite foreign keys (org_id, id) make cross-organisation references impossible.
--  * Financial rows are never cascaded away: voiding/cancelling is the only path.
-- =====================================================================================

create extension if not exists pgcrypto;

-- ---------- helpers ----------

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
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

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  -- 'owner' can never be granted through an invitation
  role text not null check (role in ('admin', 'staff')),
  invited_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists invitations_pending_unique on public.invitations (org_id, lower(email)) where accepted_at is null;

-- security definer so RLS policies on organization_members itself do not recurse
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  );
$$;

create or replace function public.is_org_owner(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- Accept every pending invitation addressed to this email. Returns the number accepted.
create or replace function public.accept_invitations_for(p_user uuid, p_email text)
returns int language plpgsql security definer set search_path = public as $$
declare
  inv record;
  n int := 0;
begin
  if p_email is null then return 0; end if;
  for inv in
    select * from public.invitations
    where lower(email) = lower(p_email) and accepted_at is null
  loop
    insert into public.organization_members (org_id, user_id, email, role)
    values (inv.org_id, p_user, lower(p_email), inv.role)
    on conflict (org_id, user_id) do nothing;
    update public.invitations set accepted_at = now() where id = inv.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- On signup: join the organisation(s) that invited this email. The very first account of the
-- project creates the organisation. Any other uninvited account stays without an organisation
-- (it can do nothing; ensure_membership() explains why in Indonesian).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  new_org uuid;
begin
  if public.accept_invitations_for(new.id, new.email) = 0
     and not exists (select 1 from public.organizations) then
    insert into public.organizations (name, created_by) values ('Kos Saya', new.id) returning id into new_org;
    insert into public.organization_members (org_id, user_id, email, role) values (new_org, new.id, new.email, 'owner');
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Called by the app after login. Resolves the organisation server-side (never trusts the client):
-- existing membership (owner first, then oldest) -> pending invitations for this email ->
-- first-ever account creates the organisation -> otherwise a clear error.
create or replace function public.ensure_membership()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org uuid;
  me uuid := auth.uid();
  my_email text;
begin
  if me is null then raise exception 'Belum masuk.'; end if;
  select org_id into org from public.organization_members
   where user_id = me order by (role = 'owner') desc, created_at asc limit 1;
  if org is not null then return org; end if;

  select email into my_email from auth.users where id = me;
  if public.accept_invitations_for(me, my_email) > 0 then
    select org_id into org from public.organization_members where user_id = me order by created_at asc limit 1;
    return org;
  end if;

  if not exists (select 1 from public.organizations) then
    insert into public.organizations (name, created_by) values ('Kos Saya', me) returning id into org;
    insert into public.organization_members (org_id, user_id, email, role) values (org, me, my_email, 'owner');
    return org;
  end if;

  raise exception 'Akun ini belum menjadi anggota kos mana pun. Minta pemilik kos mengundang email Anda di Pengaturan > Anggota.';
end $$;

-- Invite by email (admin only). Never adds an existing account silently: the invited person
-- joins when they sign in (ensure_membership) or sign up (handle_new_user) with that email.
create or replace function public.add_member_by_email(p_org_id uuid, p_email text, p_role text)
returns text language plpgsql security definer set search_path = public as $$
declare
  normalized text := lower(trim(p_email));
begin
  if not public.is_org_admin(p_org_id) then
    raise exception 'Hanya pemilik/admin yang dapat menambah anggota.';
  end if;
  if p_role not in ('admin', 'staff') then
    raise exception 'Peran tidak valid.';
  end if;
  if normalized !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Format email tidak valid.';
  end if;
  if exists (
    select 1 from public.organization_members m
    where m.org_id = p_org_id and lower(coalesce(m.email, '')) = normalized
  ) then
    return 'already_member';
  end if;

  insert into public.invitations (org_id, email, role, invited_by)
  values (p_org_id, normalized, p_role, auth.uid())
  on conflict (org_id, lower(email)) where accepted_at is null do update set role = excluded.role;
  return 'invited';
end $$;

create or replace function public.remove_member(p_org_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  owners int;
  target_role text;
begin
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
  delete from public.organization_members where org_id = p_org_id and user_id = p_user_id;
end $$;

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);

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
  foreign key (org_id, property_id) references public.properties (org_id, id) on delete set null
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
  foreign key (org_id, property_id) references public.properties (org_id, id) on delete set null,
  foreign key (org_id, lease_id) references public.leases (org_id, id) on delete restrict
);

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

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['properties', 'rooms', 'tenants', 'leases', 'invoices', 'expenses'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------- invoice status consistency ----------
-- Status is derived from rent payments. The app computes it too (for demo mode); these triggers
-- make the database the source of truth online, so staff never need UPDATE on invoices to pay.

create or replace function public.invoice_status_for(p_total bigint, p_paid bigint)
returns text language sql immutable as $$
  select case when p_paid >= p_total then 'paid' when p_paid > 0 then 'partial' else 'unpaid' end;
$$;

create or replace function public.recalc_invoice_status(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  inv record;
  paid bigint;
begin
  if p_invoice is null then return; end if;
  select id, org_id, total_amount, status into inv from public.invoices where id = p_invoice;
  if not found then return; end if;
  -- callable through RPC too, so guard it
  if not public.is_org_member(inv.org_id) then
    raise exception 'Tidak memiliki akses.';
  end if;
  if inv.status = 'void' then return; end if;
  select coalesce(sum(amount), 0) into paid from public.payments where invoice_id = p_invoice and kind = 'rent';
  update public.invoices
  set status = public.invoice_status_for(inv.total_amount, paid)
  where id = p_invoice and status is distinct from public.invoice_status_for(inv.total_amount, paid);
end $$;

create or replace function public.payments_recalc_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
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
returns trigger language plpgsql security definer set search_path = public as $$
declare paid bigint;
begin
  if new.status = 'void' then return new; end if;
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
returns trigger language plpgsql security definer set search_path = public as $$
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

-- ---------- storage cleanup ----------

create or replace function public.delete_tenant_ktp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.ktp_image_path is not null then
    delete from storage.objects where bucket_id = 'ktp' and name = old.ktp_image_path;
  end if;
  return old;
end $$;
drop trigger if exists tenants_delete_ktp on public.tenants;
create trigger tenants_delete_ktp after delete on public.tenants for each row execute function public.delete_tenant_ktp();

create or replace function public.delete_expense_receipt()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.receipt_path is not null then
    delete from storage.objects where bucket_id = 'receipts' and name = old.receipt_path;
  end if;
  return old;
end $$;
drop trigger if exists expenses_delete_receipt on public.expenses;
create trigger expenses_delete_receipt after delete on public.expenses for each row execute function public.delete_expense_receipt();

-- ---------- Row Level Security ----------

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.invitations enable row level security;
alter table public.properties enable row level security;
alter table public.rooms enable row level security;
alter table public.addon_catalog enable row level security;
alter table public.tenants enable row level security;
alter table public.leases enable row level security;
alter table public.lease_addons enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;

-- organizations: created only by ensure_membership()/handle_new_user() (security definer)
drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations for select using (public.is_org_member(id));
drop policy if exists org_insert on public.organizations;
drop policy if exists org_update on public.organizations;
create policy org_update on public.organizations for update using (public.is_org_admin(id)) with check (public.is_org_admin(id));
drop policy if exists org_delete on public.organizations;

-- organization_members: membership changes go through the RPCs; owners may edit roles directly
drop policy if exists members_select on public.organization_members;
create policy members_select on public.organization_members for select using (public.is_org_member(org_id));
drop policy if exists members_insert on public.organization_members;
drop policy if exists members_update on public.organization_members;
create policy members_update on public.organization_members for update
  using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));
drop policy if exists members_delete on public.organization_members;

-- invitations: admins manage; the invitee cannot see them (joins happen server-side)
drop policy if exists invitations_all on public.invitations;
create policy invitations_select on public.invitations for select using (public.is_org_admin(org_id));
create policy invitations_delete on public.invitations for delete using (public.is_org_admin(org_id));

-- business tables
do $$
declare t text;
begin
  foreach t in array array['properties', 'rooms', 'addon_catalog', 'tenants', 'leases', 'lease_addons', 'invoices', 'payments', 'expenses'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('create policy %I_insert on public.%I for insert with check (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
  end loop;

  -- master data and leases: every member may edit
  foreach t in array array['properties', 'rooms', 'addon_catalog', 'tenants', 'leases', 'lease_addons'] loop
    execute format('create policy %I_update on public.%I for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id))', t, t);
  end loop;
  -- master data: members may delete (DB restricts rows that are referenced)
  foreach t in array array['rooms', 'addon_catalog', 'tenants', 'lease_addons'] loop
    execute format('create policy %I_delete on public.%I for delete using (public.is_org_member(org_id))', t, t);
  end loop;
  -- properties, leases, invoices, payments, expenses: delete is admin-only
  foreach t in array array['properties', 'leases', 'invoices', 'payments', 'expenses'] loop
    execute format('create policy %I_delete on public.%I for delete using (public.is_org_admin(org_id))', t, t);
  end loop;
end $$;

-- invoices: editing (amounts, void) is admin-only; status is maintained by triggers
create policy invoices_update on public.invoices for update
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
-- payments / expenses: admins, or the member who recorded the row
create policy payments_update on public.payments for update
  using (public.is_org_admin(org_id) or created_by = auth.uid())
  with check (public.is_org_member(org_id));
create policy expenses_update on public.expenses for update
  using (public.is_org_admin(org_id) or created_by = auth.uid())
  with check (public.is_org_member(org_id));

-- ---------- Storage (KTP photos & receipts) ----------
-- Object paths are "<org_id>/<file>"; access is granted to members of that org.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('ktp', 'ktp', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create or replace function public.path_org_id(p_name text)
returns uuid language plpgsql immutable as $$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when others then
  return null;
end $$;

drop policy if exists storage_org_select on storage.objects;
create policy storage_org_select on storage.objects for select
  using (bucket_id in ('ktp', 'receipts') and public.is_org_member(public.path_org_id(name)));
drop policy if exists storage_org_insert on storage.objects;
create policy storage_org_insert on storage.objects for insert
  with check (bucket_id in ('ktp', 'receipts') and public.is_org_member(public.path_org_id(name)));
drop policy if exists storage_org_update on storage.objects;
create policy storage_org_update on storage.objects for update
  using (bucket_id in ('ktp', 'receipts') and public.is_org_member(public.path_org_id(name)));
drop policy if exists storage_org_delete on storage.objects;
create policy storage_org_delete on storage.objects for delete
  using (bucket_id in ('ktp', 'receipts') and public.is_org_member(public.path_org_id(name)));

-- ---------- grants: least privilege ----------
-- anon (not signed in) can do nothing in the public schema; authenticated users get DML under RLS
-- and may call the RPCs. Trigger functions are not callable through the API.

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke execute on all functions in schema public from public, authenticated;
grant execute on function public.ensure_membership() to authenticated;
grant execute on function public.add_member_by_email(uuid, text, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.recalc_invoice_status(uuid) to authenticated;
-- policy helpers are evaluated as the calling role and must stay executable
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;
grant execute on function public.is_org_owner(uuid) to authenticated;
grant execute on function public.path_org_id(text) to authenticated;
grant execute on function public.invoice_status_for(bigint, bigint) to authenticated;
-- trigger functions: the role performing the DML fires them
grant execute on function public.handle_new_user() to supabase_auth_admin;
grant execute on function public.accept_invitations_for(uuid, text) to supabase_auth_admin;
grant execute on function public.set_updated_at() to authenticated;
grant execute on function public.payments_recalc_trigger() to authenticated;
grant execute on function public.invoices_recalc_trigger() to authenticated;
grant execute on function public.invoices_void_guard() to authenticated;
grant execute on function public.delete_tenant_ktp() to authenticated;
grant execute on function public.delete_expense_receipt() to authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon, public;
