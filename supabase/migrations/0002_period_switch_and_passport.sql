-- Run this ONLY if you installed schema.sql before 2026-10-12 (otherwise schema.sql already contains it).
-- 1. Each invoice remembers the period type it was billed with, so a daily guest can switch to monthly.
alter table public.invoices
  add column if not exists period_type text
  check (period_type is null or period_type in ('daily', 'weekly', 'monthly'));
-- 2. Passport check-in: identity document type, passport number, nationality.
alter table public.tenants add column if not exists id_type text not null default 'ktp';
alter table public.tenants add column if not exists id_number text;
alter table public.tenants add column if not exists nationality text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_id_type_check') then
    alter table public.tenants add constraint tenants_id_type_check check (id_type in ('ktp', 'passport', 'other'));
  end if;
end $$;
