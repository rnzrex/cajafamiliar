-- Base initial schema fixture for local test setup (NOT a production migration)
create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  display_name text,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
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
  registered_by_user_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.cash_counts (
  id text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  date date not null,
  counted_amount numeric(12, 2) not null check (counted_amount >= 0),
  notes text,
  registered_by_user_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.recurring_payments (
  id text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  amount numeric(12, 2) not null check (amount > 0),
  category text not null,
  person text not null,
  due_day integer not null check (due_day >= 1 and due_day <= 31),
  status text not null default 'pendiente' check (status in ('pendiente', 'pagado')),
  notes text not null default '',
  recurrence_type text not null default 'indefinite',
  total_installments integer,
  paid_installments integer not null default 0 check (paid_installments >= 0),
  is_active boolean not null default true,
  last_paid_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.settings enable row level security;
alter table public.categories enable row level security;
alter table public.movements enable row level security;
alter table public.cash_counts enable row level security;
alter table public.recurring_payments enable row level security;

grant all privileges on all tables in schema public to postgres, service_role;
grant select, insert, update, delete on public.households, public.household_members, public.settings, public.categories, public.movements, public.cash_counts, public.recurring_payments to authenticated;
grant select on public.households, public.household_members, public.settings, public.categories, public.movements, public.cash_counts, public.recurring_payments to anon;
