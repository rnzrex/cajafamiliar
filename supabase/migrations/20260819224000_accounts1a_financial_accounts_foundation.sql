create table if not exists public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  name text not null,
  reconciliation_type text not null,
  opening_balance numeric(12, 2) not null default 0,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.financial_accounts
  drop constraint if exists financial_accounts_household_fkey,
  add constraint financial_accounts_household_fkey
    foreign key (household_id)
    references public.households(id)
    on delete cascade;

alter table public.financial_accounts
  drop constraint if exists financial_accounts_name_not_blank_check,
  add constraint financial_accounts_name_not_blank_check
    check (pg_catalog.btrim(name) <> '');

alter table public.financial_accounts
  drop constraint if exists financial_accounts_reconciliation_type_check,
  add constraint financial_accounts_reconciliation_type_check
    check (reconciliation_type in ('cash', 'balance'));

alter table public.financial_accounts
  drop constraint if exists financial_accounts_id_household_key,
  add constraint financial_accounts_id_household_key
    unique (id, household_id);

create index if not exists idx_financial_accounts_household
  on public.financial_accounts(household_id);

create index if not exists idx_financial_accounts_household_active_sort
  on public.financial_accounts(household_id, is_active, sort_order);

create unique index if not exists financial_accounts_one_active_cash_per_household
  on public.financial_accounts(household_id)
  where reconciliation_type = 'cash'
    and is_active = true;

create or replace function public.touch_financial_accounts_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$function$;

drop trigger if exists trg_financial_accounts_touch_updated_at on public.financial_accounts;
create trigger trg_financial_accounts_touch_updated_at
  before update on public.financial_accounts
  for each row
  execute function public.touch_financial_accounts_updated_at();

alter table public.financial_accounts enable row level security;

revoke all privileges on table public.financial_accounts
  from public, anon, authenticated;

grant select, insert, update on table public.financial_accounts
  to authenticated;

drop policy if exists "financial_accounts_select_member" on public.financial_accounts;
create policy "financial_accounts_select_member"
  on public.financial_accounts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = financial_accounts.household_id
        and hm.user_id = (select auth.uid())
    )
  );

drop policy if exists "financial_accounts_insert_member" on public.financial_accounts;
create policy "financial_accounts_insert_member"
  on public.financial_accounts
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = financial_accounts.household_id
        and hm.user_id = (select auth.uid())
    )
  );

drop policy if exists "financial_accounts_update_member" on public.financial_accounts;
create policy "financial_accounts_update_member"
  on public.financial_accounts
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = financial_accounts.household_id
        and hm.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = financial_accounts.household_id
        and hm.user_id = (select auth.uid())
    )
  );

insert into public.financial_accounts (household_id, name, reconciliation_type, opening_balance)
select h.id, 'Efectivo', 'cash', coalesce(s.initial_balance, 0)
  from public.households as h
  left join public.settings as s
    on s.household_id = h.id;

alter table public.movements
  add column if not exists account_id uuid;

alter table public.movements
  drop constraint if exists movements_account_household_fkey,
  add constraint movements_account_household_fkey
    foreign key (account_id, household_id)
    references public.financial_accounts(id, household_id)
    on delete restrict;

create index if not exists idx_movements_account_id
  on public.movements(account_id);

update public.movements as m
   set account_id = fa.id
  from public.financial_accounts as fa
 where fa.household_id = m.household_id
   and fa.reconciliation_type = 'cash'
   and fa.is_active
   and m.method = 'efectivo';

grant update (account_id) on table public.movements
  to authenticated;

alter table public.cash_counts
  add column if not exists account_id uuid;

alter table public.cash_counts
  drop constraint if exists cash_counts_account_household_fkey,
  add constraint cash_counts_account_household_fkey
    foreign key (account_id, household_id)
    references public.financial_accounts(id, household_id)
    on delete restrict;

create index if not exists idx_cash_counts_account_id
  on public.cash_counts(account_id);

update public.cash_counts as cc
   set account_id = fa.id
  from public.financial_accounts as fa
 where fa.household_id = cc.household_id
   and fa.reconciliation_type = 'cash'
   and fa.is_active;

create or replace function public.movements_legacy_cash_account_sync()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_cash_account_id uuid;
begin
  if new.account_id is null then
    if new.method = 'efectivo' then
      select fa.id
        into v_cash_account_id
        from public.financial_accounts as fa
       where fa.household_id = new.household_id
         and fa.reconciliation_type = 'cash'
         and fa.is_active
       limit 1;
      if found then
        new.account_id := v_cash_account_id;
      end if;
    end if;
  elsif tg_op = 'UPDATE'
    and old.method = 'efectivo'
    and new.method <> 'efectivo'
    and new.account_id is not distinct from old.account_id
    and exists (
      select 1
        from public.financial_accounts as fa
       where fa.id = old.account_id
         and fa.household_id = old.household_id
         and fa.reconciliation_type = 'cash'
    ) then
    new.account_id := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_movements_legacy_cash_account_sync on public.movements;
create trigger trg_movements_legacy_cash_account_sync
  before insert or update on public.movements
  for each row
  execute function public.movements_legacy_cash_account_sync();

create or replace function public.cash_counts_legacy_account_sync()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_cash_account_id uuid;
begin
  if new.account_id is null then
    select fa.id
      into v_cash_account_id
      from public.financial_accounts as fa
     where fa.household_id = new.household_id
       and fa.reconciliation_type = 'cash'
       and fa.is_active
     limit 1;
    if found then
      new.account_id := v_cash_account_id;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_cash_counts_legacy_account_sync on public.cash_counts;
create trigger trg_cash_counts_legacy_account_sync
  before insert on public.cash_counts
  for each row
  execute function public.cash_counts_legacy_account_sync();

create or replace function public.sync_cash_account_opening_balance()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  update public.financial_accounts as fa
     set opening_balance = new.initial_balance
   where fa.household_id = new.household_id
     and fa.reconciliation_type = 'cash'
     and fa.is_active;
  return null;
end;
$function$;

drop trigger if exists trg_settings_sync_cash_account_opening_balance on public.settings;
create trigger trg_settings_sync_cash_account_opening_balance
  after insert or update of initial_balance on public.settings
  for each row
  execute function public.sync_cash_account_opening_balance();

revoke all privileges on function public.touch_financial_accounts_updated_at()
  from public, anon, service_role;
revoke all privileges on function public.movements_legacy_cash_account_sync()
  from public, anon, service_role;
revoke all privileges on function public.cash_counts_legacy_account_sync()
  from public, anon, service_role;
revoke all privileges on function public.sync_cash_account_opening_balance()
  from public, anon, service_role;