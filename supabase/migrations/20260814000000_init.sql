-- Base schema table initialization for local db reset
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

create table if not exists public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  reconciliation_type text not null check (reconciliation_type in ('cash', 'balance')),
  opening_balance numeric(12, 2) not null default 0,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.movements (
  id text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  account_id uuid references public.financial_accounts(id) on delete set null,
  type text not null check (type in ('ingreso', 'egreso')),
  date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  description text not null,
  method text not null check (method in ('efectivo', 'Yape', 'transferencia', 'tarjeta')),
  category text not null,
  person text not null,
  movement_context text,
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
  amount numeric(12, 2),
  due_day integer,
  category text not null,
  status text not null default 'pendiente' check (status in ('pendiente', 'pagado')),
  notes text not null default '',
  recurrence_type text not null default 'indefinite',
  total_installments integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
