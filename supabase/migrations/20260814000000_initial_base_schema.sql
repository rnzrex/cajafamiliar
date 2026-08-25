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
  registered_by_user_id uuid references auth.users(id) on delete set null,
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
  amount_mode text not null default 'fixed',
  due_day integer,
  due_date date,
  category text not null,
  status text not null default 'pendiente' check (status in ('pendiente', 'pagado')),
  notes text not null default '',
  recurrence_type text not null default 'indefinite',
  total_installments integer,
  paid_installments integer not null default 0 check (paid_installments >= 0),
  is_active boolean not null default true,
  last_paid_month integer check (last_paid_month is null or last_paid_month between 1 and 12),
  last_paid_year integer check (last_paid_year is null or last_paid_year >= 2000),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
