-- Caja Familiar - Supabase schema
-- Run this file in Supabase SQL Editor before deploying the app.

create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  household_id uuid primary key references public.households(id) on delete cascade,
  initial_balance numeric(12, 2) not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  type text not null check (type in ('ingreso', 'egreso', 'ambos')),
  color text,
  icon text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.movements (
  id text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  type text not null check (type in ('ingreso', 'egreso')),
  date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  description text not null,
  method text not null check (method in ('efectivo', 'Yape', 'transferencia', 'tarjeta')),
  category text not null,
  person text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.cash_counts (
  id text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  created_at timestamptz not null default now(),
  denominations jsonb not null default '{}'::jsonb,
  total numeric(12, 2) not null default 0,
  expected numeric(12, 2) not null default 0,
  difference numeric(12, 2) not null default 0
);

create table if not exists public.recurring_payments (
  id text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  amount numeric(12, 2) not null check (amount > 0),
  due_day integer not null check (due_day between 1 and 31),
  category text not null,
  status text not null default 'pendiente' check (status in ('pendiente', 'pagado')),
  notes text not null default '',
  recurrence_type text not null default 'indefinite' check (recurrence_type in ('indefinite', 'fixed')),
  total_installments integer check (total_installments is null or total_installments > 0),
  paid_installments integer not null default 0 check (paid_installments >= 0),
  is_active boolean not null default true,
  last_paid_month integer check (last_paid_month is null or last_paid_month between 1 and 12),
  last_paid_year integer check (last_paid_year is null or last_paid_year >= 2000),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_categories_household on public.categories(household_id);
create unique index if not exists categories_household_name_unique
on public.categories (household_id, lower(name));
create index if not exists idx_movements_household_date on public.movements(household_id, date desc);
create index if not exists idx_cash_counts_household_created on public.cash_counts(household_id, created_at desc);
create index if not exists idx_recurring_payments_household on public.recurring_payments(household_id);

alter table public.households enable row level security;
alter table public.settings enable row level security;
alter table public.categories enable row level security;
alter table public.movements enable row level security;
alter table public.cash_counts enable row level security;
alter table public.recurring_payments enable row level security;

drop policy if exists "public read households" on public.households;
drop policy if exists "public write households" on public.households;
drop policy if exists "public update households" on public.households;
drop policy if exists "public read settings" on public.settings;
drop policy if exists "public write settings" on public.settings;
drop policy if exists "public update settings" on public.settings;
drop policy if exists "public read categories" on public.categories;
drop policy if exists "public write categories" on public.categories;
drop policy if exists "public update categories" on public.categories;
drop policy if exists "public delete categories" on public.categories;
drop policy if exists "public read movements" on public.movements;
drop policy if exists "public write movements" on public.movements;
drop policy if exists "public update movements" on public.movements;
drop policy if exists "public delete movements" on public.movements;
drop policy if exists "public read cash_counts" on public.cash_counts;
drop policy if exists "public write cash_counts" on public.cash_counts;
drop policy if exists "public update cash_counts" on public.cash_counts;
drop policy if exists "public delete cash_counts" on public.cash_counts;
drop policy if exists "public read recurring_payments" on public.recurring_payments;
drop policy if exists "public write recurring_payments" on public.recurring_payments;
drop policy if exists "public update recurring_payments" on public.recurring_payments;
drop policy if exists "public delete recurring_payments" on public.recurring_payments;

-- MVP family-sharing policies.
-- The app filters every request by VITE_SUPABASE_HOUSEHOLD_ID.
-- For stricter production security, add Supabase Auth and replace these policies with user-bound household membership policies.
create policy "public read households" on public.households for select using (true);
create policy "public write households" on public.households for insert with check (true);
create policy "public update households" on public.households for update using (true) with check (true);

create policy "public read settings" on public.settings for select using (true);
create policy "public write settings" on public.settings for insert with check (true);
create policy "public update settings" on public.settings for update using (true) with check (true);

create policy "public read categories" on public.categories for select using (true);
create policy "public write categories" on public.categories for insert with check (true);
create policy "public update categories" on public.categories for update using (true) with check (true);
create policy "public delete categories" on public.categories for delete using (true);

create policy "public read movements" on public.movements for select using (true);
create policy "public write movements" on public.movements for insert with check (true);
create policy "public update movements" on public.movements for update using (true) with check (true);
create policy "public delete movements" on public.movements for delete using (true);

create policy "public read cash_counts" on public.cash_counts for select using (true);
create policy "public write cash_counts" on public.cash_counts for insert with check (true);
create policy "public update cash_counts" on public.cash_counts for update using (true) with check (true);
create policy "public delete cash_counts" on public.cash_counts for delete using (true);

create policy "public read recurring_payments" on public.recurring_payments for select using (true);
create policy "public write recurring_payments" on public.recurring_payments for insert with check (true);
create policy "public update recurring_payments" on public.recurring_payments for update using (true) with check (true);
create policy "public delete recurring_payments" on public.recurring_payments for delete using (true);
