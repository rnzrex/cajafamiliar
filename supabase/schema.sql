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
  created_at timestamptz not null default now(),
  constraint movements_registered_by_user_fk
    foreign key (registered_by_user_id)
    references auth.users(id)
    on delete set null
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
create index if not exists idx_movements_registered_by_user on public.movements(household_id, registered_by_user_id);
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
grant select, insert, delete on table public.movements to authenticated;
grant update (type, date, amount, description, method, category) on table public.movements to authenticated;
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
    registered_by_user_id = (select auth.uid())
    and exists (
      select 1
      from public.household_members as hm
      where hm.household_id = movements.household_id
        and hm.user_id = (select auth.uid())
        and hm.display_name is not null
        and btrim(hm.display_name) <> ''
        and hm.display_name = movements.person
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

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  app_origin text not null,
  is_active boolean not null default true,
  expires_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_unique unique (endpoint),
  constraint push_subscriptions_endpoint_not_blank_check check (pg_catalog.btrim(endpoint) <> ''),
  constraint push_subscriptions_p256dh_not_blank_check check (pg_catalog.btrim(p256dh) <> ''),
  constraint push_subscriptions_auth_not_blank_check check (pg_catalog.btrim(auth) <> ''),
  constraint push_subscriptions_app_origin_not_blank_check check (pg_catalog.btrim(app_origin) <> ''),
  constraint push_subscriptions_member_fk foreign key (household_id, user_id)
    references public.household_members(household_id, user_id) on delete cascade
);

create table if not exists public.push_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  notification_date date not null,
  notification_type text not null,
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'failed')),
  error_code text,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint push_notification_deliveries_subscription_day_type_unique unique (subscription_id, notification_date, notification_type)
);

create index if not exists idx_push_subscriptions_active_household
  on public.push_subscriptions(household_id, app_origin)
  where is_active = true;

create index if not exists idx_push_subscriptions_user
  on public.push_subscriptions(user_id);

create index if not exists idx_push_notification_deliveries_date_type
  on public.push_notification_deliveries(notification_date, notification_type);

alter table public.push_subscriptions enable row level security;
alter table public.push_notification_deliveries enable row level security;

revoke all privileges on table public.push_subscriptions, public.push_notification_deliveries
from public, anon, authenticated;

drop policy if exists "push_subscriptions_select_own_member" on public.push_subscriptions;
create policy "push_subscriptions_select_own_member"
  on public.push_subscriptions
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.household_members as hm
      where hm.household_id = push_subscriptions.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create or replace function public.register_push_subscription(
  p_household_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_app_origin text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_subscription public.push_subscriptions%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_household_id is null
     or p_endpoint is null or pg_catalog.btrim(p_endpoint) = ''
     or p_p256dh is null or pg_catalog.btrim(p_p256dh) = ''
     or p_auth is null or pg_catalog.btrim(p_auth) = ''
     or p_app_origin is null or pg_catalog.btrim(p_app_origin) = '' then
    raise exception 'INVALID_PUSH_SUBSCRIPTION';
  end if;

  if not exists (
    select 1
    from public.household_members as hm
    where hm.household_id = p_household_id
      and hm.user_id = v_user_id
      and hm.display_name is not null
      and pg_catalog.btrim(hm.display_name) <> ''
  ) then
    raise exception 'MEMBER_NOT_PROVISIONED';
  end if;

  insert into public.push_subscriptions (
    user_id, household_id, endpoint, p256dh, auth, app_origin,
    is_active, expires_at, last_failure_at, updated_at
  ) values (
    v_user_id, p_household_id, pg_catalog.btrim(p_endpoint), pg_catalog.btrim(p_p256dh),
    pg_catalog.btrim(p_auth), pg_catalog.btrim(p_app_origin), true, p_expires_at, null, pg_catalog.now()
  )
  on conflict (endpoint)
  do update set
    user_id = excluded.user_id,
    household_id = excluded.household_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    app_origin = excluded.app_origin,
    is_active = true,
    expires_at = excluded.expires_at,
    last_failure_at = null,
    updated_at = pg_catalog.now()
  returning * into v_subscription;

  return pg_catalog.jsonb_build_object(
    'id', v_subscription.id,
    'is_active', v_subscription.is_active,
    'app_origin', v_subscription.app_origin
  );
end;
$function$;

create or replace function public.unregister_push_subscription(
  p_household_id uuid,
  p_endpoint text,
  p_app_origin text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_household_id is null or p_endpoint is null or pg_catalog.btrim(p_endpoint) = ''
     or p_app_origin is null or pg_catalog.btrim(p_app_origin) = '' then
    raise exception 'INVALID_PUSH_SUBSCRIPTION';
  end if;

  if not exists (
    select 1
    from public.household_members as hm
    where hm.household_id = p_household_id
      and hm.user_id = v_user_id
  ) then
    raise exception 'MEMBER_NOT_PROVISIONED';
  end if;

  update public.push_subscriptions
     set is_active = false,
         updated_at = pg_catalog.now()
   where user_id = v_user_id
     and household_id = p_household_id
     and endpoint = pg_catalog.btrim(p_endpoint)
     and app_origin = pg_catalog.btrim(p_app_origin);

  return found;
end;
$function$;

create or replace function public.get_push_subscription_status(
  p_household_id uuid,
  p_endpoint text,
  p_app_origin text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_household_id is null or p_endpoint is null or pg_catalog.btrim(p_endpoint) = ''
     or p_app_origin is null or pg_catalog.btrim(p_app_origin) = '' then
    raise exception 'INVALID_PUSH_SUBSCRIPTION';
  end if;

  if not exists (
    select 1
    from public.household_members as hm
    where hm.household_id = p_household_id
      and hm.user_id = v_user_id
  ) then
    raise exception 'MEMBER_NOT_PROVISIONED';
  end if;

  return coalesce(
    (
      select ps.is_active
      from public.push_subscriptions as ps
      where ps.user_id = v_user_id
        and ps.household_id = p_household_id
        and ps.endpoint = pg_catalog.btrim(p_endpoint)
        and ps.app_origin = pg_catalog.btrim(p_app_origin)
      limit 1
    ),
    false
  );
end;
$function$;

revoke execute on function public.register_push_subscription(uuid, text, text, text, text, timestamptz)
  from public, anon, service_role;
grant execute on function public.register_push_subscription(uuid, text, text, text, text, timestamptz)
  to authenticated;

revoke execute on function public.unregister_push_subscription(uuid, text, text)
  from public, anon, service_role;
grant execute on function public.unregister_push_subscription(uuid, text, text)
  to authenticated;

revoke execute on function public.get_push_subscription_status(uuid, text, text)
  from public, anon, service_role;
grant execute on function public.get_push_subscription_status(uuid, text, text)
  to authenticated;
