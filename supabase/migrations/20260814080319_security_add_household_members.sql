create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index if not exists idx_household_members_user_id on public.household_members(user_id);

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
  status text not null default 'pendiente',
  notes text not null default '',
  recurrence_type text not null default 'indefinite',
  total_installments integer,
  paid_installments integer not null default 0,
  is_active boolean not null default true,
  last_paid_month integer,
  last_paid_year integer,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.household_members enable row level security;

revoke all privileges on table public.household_members from public, anon, authenticated;
grant select on table public.household_members to authenticated;

drop policy if exists "household_members_select_self" on public.household_members;
create policy "household_members_select_self"
  on public.household_members
  for select
  to authenticated
  using (user_id = (select auth.uid()));
