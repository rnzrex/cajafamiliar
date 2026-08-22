-- DEBT-5A: Credit Card Liability Foundation.
-- Specialized credit card configuration profile (1:1 with debts)
-- and append-only credit card liability entries ledger.

-- 1. Table credit_card_profiles
create table public.credit_card_profiles (
  debt_id uuid not null primary key,
  household_id uuid not null,
  credit_limit numeric null,
  closing_day integer null,
  due_day integer null,
  last4 text null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint credit_card_profiles_credit_limit_check
    check (credit_limit is null or credit_limit > 0),
  constraint credit_card_profiles_closing_day_check
    check (closing_day is null or (closing_day >= 1 and closing_day <= 31)),
  constraint credit_card_profiles_due_day_check
    check (due_day is null or (due_day >= 1 and due_day <= 31)),
  constraint credit_card_profiles_last4_check
    check (last4 is null or last4 ~ '^[0-9]{4}$'),
  constraint credit_card_profiles_debt_household_fkey
    foreign key (debt_id, household_id)
    references public.debts(id, household_id)
    on delete cascade,
  constraint credit_card_profiles_created_by_user_fkey
    foreign key (created_by_user_id)
    references auth.users(id)
    on delete restrict,
  constraint credit_card_profiles_debt_household_key
    unique (debt_id, household_id)
);

-- Trigger to enforce that credit_card_profiles only attaches to debts with debt_kind = 'credit_card'
create or replace function public.validate_credit_card_profile_kind()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_debt_kind text;
begin
  select d.debt_kind
    into v_debt_kind
    from public.debts as d
   where d.id = new.debt_id
     and d.household_id = new.household_id;

  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;
  if v_debt_kind <> 'credit_card' then
    raise exception 'CREDIT_CARD_PROFILE_MUST_BE_CREDIT_CARD_DEBT';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_credit_card_profiles_validate_kind on public.credit_card_profiles;
create trigger trg_credit_card_profiles_validate_kind
  before insert or update
  on public.credit_card_profiles
  for each row
  execute function public.validate_credit_card_profile_kind();


-- 2. Table credit_card_entries (Append-only liability ledger)
create table public.credit_card_entries (
  id uuid not null default gen_random_uuid() primary key,
  debt_id uuid not null,
  household_id uuid not null,
  entry_date date not null,
  entry_type text not null,
  liability_delta numeric not null,
  movement_id text null,
  reversal_of_entry_id uuid null,
  description text not null default '',
  registered_by_user_id uuid not null,
  created_at timestamptz not null default now(),

  constraint credit_card_entries_type_check
    check (entry_type in ('purchase', 'payment', 'finance_charge', 'credit', 'reversal')),
  constraint credit_card_entries_purchase_sign_check
    check (entry_type not in ('purchase', 'finance_charge') or liability_delta > 0),
  constraint credit_card_entries_payment_sign_check
    check (entry_type not in ('payment', 'credit') or liability_delta < 0),
  constraint credit_card_entries_reversal_semantics_check
    check (
      (entry_type = 'reversal' and liability_delta = 0 and movement_id is null and reversal_of_entry_id is not null)
      or (entry_type <> 'reversal' and reversal_of_entry_id is null and movement_id is not null)
    ),
  constraint credit_card_entries_reversal_self_check
    check (reversal_of_entry_id is null or reversal_of_entry_id <> id),
  constraint credit_card_entries_id_debt_household_key
    unique (id, debt_id, household_id),
  constraint credit_card_entries_profile_fkey
    foreign key (debt_id, household_id)
    references public.credit_card_profiles(debt_id, household_id)
    on delete cascade,
  constraint credit_card_entries_movement_fkey
    foreign key (movement_id, household_id)
    references public.movements(id, household_id)
    on delete restrict,
  constraint credit_card_entries_reversal_fkey
    foreign key (reversal_of_entry_id, debt_id, household_id)
    references public.credit_card_entries(id, debt_id, household_id)
    on delete no action,
  constraint credit_card_entries_registered_by_user_fkey
    foreign key (registered_by_user_id)
    references auth.users(id)
    on delete restrict
);

-- Partial Unique Indexes
create unique index idx_credit_card_entries_reversal_target
  on public.credit_card_entries(reversal_of_entry_id)
  where reversal_of_entry_id is not null;

create unique index idx_credit_card_entries_movement_id
  on public.credit_card_entries(movement_id)
  where movement_id is not null;

create index idx_credit_card_entries_debt_date
  on public.credit_card_entries(household_id, debt_id, entry_date asc, created_at asc);


-- 3. RLS & Privileges
alter table public.credit_card_profiles enable row level security;
alter table public.credit_card_entries enable row level security;

revoke all on table public.credit_card_profiles from public, anon, authenticated;
revoke all on table public.credit_card_entries from public, anon, authenticated;

grant select on table public.credit_card_profiles to authenticated;
grant select on table public.credit_card_entries to authenticated;

create policy "credit_card_profiles_select_member"
  on public.credit_card_profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
     where hm.household_id = credit_card_profiles.household_id
       and hm.user_id = auth.uid()
    )
  );

create policy "credit_card_entries_select_member"
  on public.credit_card_entries
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
     where hm.household_id = credit_card_entries.household_id
       and hm.user_id = auth.uid()
    )
  );


-- 4. Backfill empty profile for any legacy debts with debt_kind = 'credit_card'
insert into public.credit_card_profiles (debt_id, household_id, created_by_user_id)
select d.id, d.household_id, d.created_by_user_id
  from public.debts as d
 where d.debt_kind = 'credit_card'
on conflict do nothing;
