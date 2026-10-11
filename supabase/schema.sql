-- =====================================================================================
-- Woombad: Supabase / PostgreSQL schema
-- Run this whole file once in Supabase Dashboard -> SQL Editor (it is idempotent-ish:
-- safe to re-run after dropping, not designed as an incremental migration).
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
  created_by uuid not null references auth.users(id) on delete cascade,
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
  role text not null check (role in ('owner', 'admin', 'staff')),
  invited_by uuid not null references auth.users(id) on delete cascade,
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

-- On signup: join any org that invited this email, otherwise create a fresh org.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  inv record;
  joined boolean := false;
  new_org uuid;
begin
  for inv in
    select * from public.invitations
    where lower(email) = lower(new.email) and accepted_at is null
  loop
    insert into public.organization_members (org_id, user_id, email, role)
    values (inv.org_id, new.id, new.email, inv.role)
    on conflict (org_id, user_id) do nothing;
    update public.invitations set accepted_at = now() where id = inv.id;
    joined := true;
  end loop;

  if not joined then
    insert into public.organizations (name, created_by) values ('Kos Saya', new.id) returning id into new_org;
    insert into public.organization_members (org_id, user_id, email, role) values (new_org, new.id, new.email, 'owner');
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Add a member by email (admin only). Existing user -> member now; unknown email -> invitation.
create or replace function public.add_member_by_email(p_org_id uuid, p_email text, p_role text)
returns text language plpgsql security definer set search_path = public as $$
declare
  target_user uuid;
  normalized text := lower(trim(p_email));
begin
  if not public.is_org_admin(p_org_id) then
    raise exception 'Hanya pemilik/admin yang dapat menambah anggota.';
  end if;
  if p_role not in ('admin', 'staff') then
    raise exception 'Peran tidak valid.';
  end if;

  select id into target_user from auth.users where lower(email) = normalized limit 1;

  if target_user is not null then
    if exists (select 1 from public.organization_members where org_id = p_org_id and user_id = target_user) then
      return 'already_member';
    end if;
    insert into public.organization_members (org_id, user_id, email, role)
    values (p_org_id, target_user, normalized, p_role);
    return 'added';
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
  select role into target_role from public.organization_members where org_id = p_org_id and user_id = p_user_id;
  if target_role = 'owner' then
    select count(*) into owners from public.organization_members where org_id = p_org_id and role = 'owner';
    if owners <= 1 then
      raise exception 'Tidak dapat menghapus pemilik terakhir.';
    end if;
  end if;
  delete from public.organization_members where org_id = p_org_id and user_id = p_user_id;
end $$;

-- ---------- business tables ----------

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  floor text,
  price_daily bigint check (price_daily is null or price_daily >= 0),
  price_weekly bigint check (price_weekly is null or price_weekly >= 0),
  price_monthly bigint check (price_monthly is null or price_monthly >= 0),
  status text not null default 'active' check (status in ('active', 'maintenance')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.addon_catalog (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  name text not null,
  default_price bigint not null default 0,
  billing text not null default 'per_period' check (billing in ('per_period', 'one_time')),
  created_at timestamptz not null default now()
);

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
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
  updated_at timestamptz not null default now()
);

create table if not exists public.leases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  period_type text not null check (period_type in ('daily', 'weekly', 'monthly')),
  price_per_period bigint not null check (price_per_period >= 0),
  deposit_amount bigint not null default 0 check (deposit_amount >= 0),
  start_date date not null,
  end_date date not null,
  status text not null default 'active' check (status in ('active', 'ended', 'cancelled')),
  checkout_date date,
  deposit_returned_amount bigint,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists public.lease_addons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lease_id uuid not null references public.leases(id) on delete cascade,
  name text not null,
  amount bigint not null,
  billing text not null default 'per_period' check (billing in ('per_period', 'one_time')),
  created_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  lease_id uuid not null references public.leases(id) on delete cascade,
  invoice_number text not null,
  period_start date not null,
  period_end date not null,
  quantity int not null default 1 check (quantity >= 1),
  base_amount bigint not null default 0,
  addons_amount bigint not null default 0,
  extra_amount bigint not null default 0,
  discount_amount bigint not null default 0,
  total_amount bigint not null default 0 check (total_amount >= 0),
  due_date date not null,
  status text not null default 'unpaid' check (status in ('unpaid', 'partial', 'paid', 'void')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete cascade,
  lease_id uuid references public.leases(id) on delete set null,
  amount bigint not null check (amount > 0),
  paid_at date not null,
  method text not null default 'cash' check (method in ('cash', 'transfer', 'qris', 'other')),
  kind text not null default 'rent' check (kind in ('rent', 'deposit', 'other')),
  notes text,
  created_at timestamptz not null default now(),
  check (kind <> 'rent' or invoice_id is not null)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  category text not null check (category in ('wages', 'maintenance', 'utilities', 'supplies', 'tax', 'marketing', 'deposit_refund', 'other')),
  amount bigint not null check (amount >= 0),
  expense_date date not null,
  description text not null,
  vendor text,
  receipt_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['properties', 'rooms', 'tenants', 'leases', 'invoices', 'expenses'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- Keep invoice.status consistent with rent payments (the app also sets it, this is the safety net).
create or replace function public.recalc_invoice_status(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  total bigint;
  cur text;
  paid bigint;
begin
  if p_invoice is null then return; end if;
  select total_amount, status into total, cur from public.invoices where id = p_invoice;
  if not found or cur = 'void' then return; end if;
  select coalesce(sum(amount), 0) into paid from public.payments where invoice_id = p_invoice and kind = 'rent';
  update public.invoices
  set status = case when paid >= total then 'paid' when paid > 0 then 'partial' else 'unpaid' end
  where id = p_invoice
    and status is distinct from (case when paid >= total then 'paid' when paid > 0 then 'partial' else 'unpaid' end);
end $$;

create or replace function public.payments_recalc_trigger()
returns trigger language plpgsql as $$
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
returns trigger language plpgsql as $$
declare paid bigint;
begin
  if new.status = 'void' then return new; end if;
  select coalesce(sum(amount), 0) into paid from public.payments where invoice_id = new.id and kind = 'rent';
  new.status := case when paid >= new.total_amount then 'paid' when paid > 0 then 'partial' else 'unpaid' end;
  return new;
end $$;

drop trigger if exists invoices_recalc on public.invoices;
create trigger invoices_recalc
  before insert or update of total_amount, status on public.invoices
  for each row execute function public.invoices_recalc_trigger();

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

-- organizations
drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations for select using (public.is_org_member(id));
drop policy if exists org_insert on public.organizations;
create policy org_insert on public.organizations for insert with check (created_by = auth.uid());
drop policy if exists org_update on public.organizations;
create policy org_update on public.organizations for update using (public.is_org_admin(id));
drop policy if exists org_delete on public.organizations;
create policy org_delete on public.organizations for delete using (
  exists (select 1 from public.organization_members m where m.org_id = id and m.user_id = auth.uid() and m.role = 'owner')
);

-- organization_members
drop policy if exists members_select on public.organization_members;
create policy members_select on public.organization_members for select using (public.is_org_member(org_id));
drop policy if exists members_insert on public.organization_members;
create policy members_insert on public.organization_members for insert with check (
  public.is_org_admin(org_id)
  or (
    -- creator adding themselves as the first member (fallback when the signup trigger did not run)
    user_id = auth.uid()
    and exists (select 1 from public.organizations o where o.id = org_id and o.created_by = auth.uid())
    and not exists (select 1 from public.organization_members m where m.org_id = org_id)
  )
);
drop policy if exists members_update on public.organization_members;
create policy members_update on public.organization_members for update using (public.is_org_admin(org_id));
drop policy if exists members_delete on public.organization_members;
create policy members_delete on public.organization_members for delete using (public.is_org_admin(org_id) and user_id <> auth.uid());

-- invitations (admins only)
drop policy if exists invitations_all on public.invitations;
create policy invitations_all on public.invitations for all using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

-- business tables: members read/insert/update; deletes of financial records restricted to admins
do $$
declare t text;
begin
  foreach t in array array['properties', 'rooms', 'addon_catalog', 'tenants', 'leases', 'lease_addons', 'invoices', 'payments', 'expenses'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('create policy %I_insert on public.%I for insert with check (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('create policy %I_update on public.%I for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
  end loop;
  -- anyone in the org may delete master data they created by mistake
  foreach t in array array['rooms', 'addon_catalog', 'tenants', 'lease_addons'] loop
    execute format('create policy %I_delete on public.%I for delete using (public.is_org_member(org_id))', t, t);
  end loop;
  -- financial records and properties: admins only
  foreach t in array array['properties', 'leases', 'invoices', 'payments', 'expenses'] loop
    execute format('create policy %I_delete on public.%I for delete using (public.is_org_admin(org_id))', t, t);
  end loop;
end $$;

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

-- ---------- grants (Supabase default roles) ----------
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
