-- Caja Familiar - Supabase schema
-- Run this file in Supabase SQL Editor before deploying the app.

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
  created_at timestamptz not null default now(),
  constraint recurring_payments_amount_positive_or_null_check check (amount is null or amount > 0),
  constraint recurring_payments_amount_mode_check check (
    (amount_mode = 'fixed' and amount is not null and amount > 0)
    or (amount_mode = 'variable' and (amount is null or amount > 0))
  ),
  constraint recurring_payments_amount_mode_values_check check (amount_mode in ('fixed', 'variable')),
  constraint recurring_payments_due_day_check check (due_day is null or due_day between 1 and 31),
  constraint recurring_payments_schedule_check check (
    (recurrence_type = 'one_time' and due_date is not null and due_day is null)
    or (recurrence_type in ('indefinite', 'fixed') and due_day is not null and due_day between 1 and 31 and due_date is null)
  ),
  constraint recurring_payments_recurrence_type_check check (recurrence_type in ('indefinite', 'fixed', 'one_time')),
  constraint recurring_payments_installments_check check (
    (recurrence_type = 'fixed' and total_installments is not null and total_installments > 0)
    or (recurrence_type in ('indefinite', 'one_time') and total_installments is null)
  )
);

create index if not exists idx_categories_household on public.categories(household_id);
create unique index if not exists categories_household_name_unique
on public.categories (household_id, lower(name));
create index if not exists idx_household_members_user_id on public.household_members(user_id);
create index if not exists idx_movements_household_date on public.movements(household_id, date desc);
create index if not exists idx_cash_counts_household_created on public.cash_counts(household_id, created_at desc);
create index if not exists idx_recurring_payments_household on public.recurring_payments(household_id);

alter table public.households enable row level security;
alter table public.settings enable row level security;
alter table public.categories enable row level security;
alter table public.movements enable row level security;
alter table public.cash_counts enable row level security;
alter table public.recurring_payments enable row level security;
alter table public.household_members enable row level security;

revoke all privileges on table
  public.households,
  public.settings,
  public.categories,
  public.movements,
  public.cash_counts,
  public.recurring_payments,
  public.household_members
from PUBLIC, anon, authenticated;

grant select on table public.households to authenticated;
grant select, insert, update on table public.settings to authenticated;
grant select, insert, update, delete on table public.categories to authenticated;
grant select, insert, update, delete on table public.movements to authenticated;
grant select, insert on table public.cash_counts to authenticated;
grant select, insert, update on table public.recurring_payments to authenticated;
grant select on table public.household_members to authenticated;

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
drop policy if exists "household_members_select_self" on public.household_members;
drop policy if exists "households_select_member" on public.households;
drop policy if exists "settings_select_member" on public.settings;
drop policy if exists "settings_insert_member" on public.settings;
drop policy if exists "settings_update_member" on public.settings;
drop policy if exists "categories_select_member" on public.categories;
drop policy if exists "categories_insert_member" on public.categories;
drop policy if exists "categories_update_member" on public.categories;
drop policy if exists "categories_delete_member" on public.categories;
drop policy if exists "movements_select_member" on public.movements;
drop policy if exists "movements_insert_member" on public.movements;
drop policy if exists "movements_update_member" on public.movements;
drop policy if exists "movements_delete_member" on public.movements;
drop policy if exists "cash_counts_select_member" on public.cash_counts;
drop policy if exists "cash_counts_insert_member" on public.cash_counts;
drop policy if exists "recurring_payments_select_member" on public.recurring_payments;
drop policy if exists "recurring_payments_insert_member" on public.recurring_payments;
drop policy if exists "recurring_payments_update_member" on public.recurring_payments;

create policy "household_members_select_self"
  on public.household_members
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "households_select_member"
  on public.households
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = households.id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "settings_select_member"
  on public.settings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = settings.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "settings_insert_member"
  on public.settings
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = settings.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "settings_update_member"
  on public.settings
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = settings.household_id
        and hm.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = settings.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "categories_select_member"
  on public.categories
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = categories.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "categories_insert_member"
  on public.categories
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = categories.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "categories_update_member"
  on public.categories
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = categories.household_id
        and hm.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = categories.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "categories_delete_member"
  on public.categories
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = categories.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "movements_select_member"
  on public.movements
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = movements.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "movements_insert_member"
  on public.movements
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = movements.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "movements_update_member"
  on public.movements
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = movements.household_id
        and hm.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = movements.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "movements_delete_member"
  on public.movements
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = movements.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "cash_counts_select_member"
  on public.cash_counts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = cash_counts.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "cash_counts_insert_member"
  on public.cash_counts
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = cash_counts.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "recurring_payments_select_member"
  on public.recurring_payments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = recurring_payments.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "recurring_payments_insert_member"
  on public.recurring_payments
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = recurring_payments.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "recurring_payments_update_member"
  on public.recurring_payments
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = recurring_payments.household_id
        and hm.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = recurring_payments.household_id
        and hm.user_id = (select auth.uid())
    )
  );
