-- DEBT-1A Financial Debt Foundation
-- Dominio Control de Deudas: foundation SQL.
-- Solo schema. Sin frontend, sin RPC, sin escrituras habilitadas a cliente.

-- ============================================================
-- 1. PUBLIC.DEBTS
-- ============================================================

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  name text not null,
  creditor_name text not null,
  debt_kind text not null,
  currency_code text not null default 'PEN',
  origin_date date null,
  tracking_start_date date not null,
  original_principal numeric null,
  opening_principal_balance numeric not null,
  planned_installment_count integer null,
  planned_installment_amount numeric null,
  installment_amount_mode text not null default 'unknown',
  payment_frequency text null,
  custom_frequency_days integer null,
  first_due_date date null,
  tea_percent numeric null,
  tcea_percent numeric null,
  notes text not null default '',
  status text not null default 'active',
  is_archived boolean not null default false,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.debts
  drop constraint if exists debts_household_fkey,
  add constraint debts_household_fkey
    foreign key (household_id)
    references public.households(id)
    on delete cascade;

alter table public.debts
  drop constraint if exists debts_created_by_user_fkey,
  add constraint debts_created_by_user_fkey
    foreign key (created_by_user_id)
    references auth.users(id)
    on delete restrict;

alter table public.debts
  drop constraint if exists debts_id_household_key,
  add constraint debts_id_household_key
    unique (id, household_id);

alter table public.debts
  drop constraint if exists debts_name_not_blank_check,
  add constraint debts_name_not_blank_check
    check (pg_catalog.btrim(name) <> '');

alter table public.debts
  drop constraint if exists debts_creditor_name_not_blank_check,
  add constraint debts_creditor_name_not_blank_check
    check (pg_catalog.btrim(creditor_name) <> '');

alter table public.debts
  drop constraint if exists debts_currency_code_format_check,
  add constraint debts_currency_code_format_check
    check (currency_code ~ '^[A-Z]{3}$');

alter table public.debts
  drop constraint if exists debts_debt_kind_check,
  add constraint debts_debt_kind_check
    check (debt_kind in ('bank_loan', 'family_loan', 'installment_purchase', 'mortgage', 'pledge', 'credit_card', 'other'));

alter table public.debts
  drop constraint if exists debts_status_check,
  add constraint debts_status_check
    check (status in ('active', 'paid_off', 'refinanced'));

alter table public.debts
  drop constraint if exists debts_installment_amount_mode_check,
  add constraint debts_installment_amount_mode_check
    check (installment_amount_mode in ('fixed', 'variable', 'unknown'));

alter table public.debts
  drop constraint if exists debts_payment_frequency_check,
  add constraint debts_payment_frequency_check
    check (payment_frequency is null or payment_frequency in ('monthly', 'biweekly', 'weekly', 'custom'));

alter table public.debts
  drop constraint if exists debts_custom_frequency_days_positive_check,
  add constraint debts_custom_frequency_days_positive_check
    check (custom_frequency_days is null or custom_frequency_days > 0);

alter table public.debts
  drop constraint if exists debts_custom_frequency_days_only_custom_check,
  add constraint debts_custom_frequency_days_only_custom_check
    check (
      (
        payment_frequency = 'custom'
        and custom_frequency_days is not null
      )
      or
      (
        payment_frequency is distinct from 'custom'
        and custom_frequency_days is null
      )
    );

alter table public.debts
  drop constraint if exists debts_original_principal_positive_check,
  add constraint debts_original_principal_positive_check
    check (original_principal is null or original_principal > 0);

alter table public.debts
  drop constraint if exists debts_opening_principal_balance_non_negative_check,
  add constraint debts_opening_principal_balance_non_negative_check
    check (opening_principal_balance >= 0);

alter table public.debts
  drop constraint if exists debts_planned_installment_count_positive_check,
  add constraint debts_planned_installment_count_positive_check
    check (planned_installment_count is null or planned_installment_count > 0);

alter table public.debts
  drop constraint if exists debts_planned_installment_amount_positive_check,
  add constraint debts_planned_installment_amount_positive_check
    check (planned_installment_amount is null or planned_installment_amount > 0);

alter table public.debts
  drop constraint if exists debts_tea_percent_non_negative_check,
  add constraint debts_tea_percent_non_negative_check
    check (tea_percent is null or tea_percent >= 0);

alter table public.debts
  drop constraint if exists debts_tcea_percent_non_negative_check,
  add constraint debts_tcea_percent_non_negative_check
    check (tcea_percent is null or tcea_percent >= 0);

alter table public.debts
  drop constraint if exists debts_origin_before_tracking_check,
  add constraint debts_origin_before_tracking_check
    check (origin_date is null or origin_date <= tracking_start_date);

create index if not exists idx_debts_household_status_archived
  on public.debts(household_id, status, is_archived);

alter table public.debts enable row level security;

revoke all privileges on table public.debts
  from public, anon, authenticated;

grant select on table public.debts
  to authenticated;

drop policy if exists "debts_select_member" on public.debts;
create policy "debts_select_member"
  on public.debts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debts.household_id
        and hm.user_id = (select auth.uid())
    )
  );

drop policy if exists "debts_insert_member" on public.debts;
create policy "debts_insert_member"
  on public.debts
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debts.household_id
        and hm.user_id = (select auth.uid())
    )
    and debts.created_by_user_id = (select auth.uid())
  );

drop policy if exists "debts_update_member" on public.debts;
create policy "debts_update_member"
  on public.debts
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debts.household_id
        and hm.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debts.household_id
        and hm.user_id = (select auth.uid())
    )
  );

-- ============================================================
-- 2. LINK MOVEMENT HOUSEHOLD-SAFE (requerido por debt_events)
-- ============================================================

alter table public.movements
  drop constraint if exists movements_id_household_key,
  add constraint movements_id_household_key
    unique (id, household_id);

-- ============================================================
-- 3. PUBLIC.DEBT_EVENTS
-- ============================================================

create table if not exists public.debt_events (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null,
  household_id uuid not null,
  event_date date not null,
  event_type text not null,
  cash_amount numeric not null default 0,
  principal_delta numeric not null default 0,
  interest_paid numeric not null default 0,
  fees_paid numeric not null default 0,
  insurance_paid numeric not null default 0,
  other_cost_paid numeric not null default 0,
  breakdown_complete boolean not null default false,
  movement_id text null,
  reversal_of_event_id uuid null,
  description text not null default '',
  registered_by_user_id uuid not null,
  created_at timestamptz not null default now()
);

alter table public.debt_events
  drop constraint if exists debt_events_id_debt_household_key,
  add constraint debt_events_id_debt_household_key
    unique (id, debt_id, household_id);

alter table public.debt_events
  drop constraint if exists debt_events_debt_household_fkey,
  add constraint debt_events_debt_household_fkey
    foreign key (debt_id, household_id)
    references public.debts(id, household_id)
    on delete cascade;

alter table public.debt_events
  drop constraint if exists debt_events_registered_by_user_fkey,
  add constraint debt_events_registered_by_user_fkey
    foreign key (registered_by_user_id)
    references auth.users(id)
    on delete restrict;

alter table public.debt_events
  drop constraint if exists debt_events_movement_household_fkey,
  add constraint debt_events_movement_household_fkey
    foreign key (movement_id, household_id)
    references public.movements(id, household_id)
    on delete restrict;

alter table public.debt_events
  drop constraint if exists debt_events_reversal_household_fkey,
  add constraint debt_events_reversal_household_fkey
    foreign key (reversal_of_event_id, debt_id, household_id)
    references public.debt_events(id, debt_id, household_id)
    on delete no action;

alter table public.debt_events
  drop constraint if exists debt_events_event_type_check,
  add constraint debt_events_event_type_check
    check (event_type in ('payment', 'principal_prepayment', 'principal_adjustment', 'refinance', 'payoff', 'reversal'));

alter table public.debt_events
  drop constraint if exists debt_events_cash_amount_non_negative_check,
  add constraint debt_events_cash_amount_non_negative_check
    check (cash_amount >= 0);

alter table public.debt_events
  drop constraint if exists debt_events_interest_paid_non_negative_check,
  add constraint debt_events_interest_paid_non_negative_check
    check (interest_paid >= 0);

alter table public.debt_events
  drop constraint if exists debt_events_fees_paid_non_negative_check,
  add constraint debt_events_fees_paid_non_negative_check
    check (fees_paid >= 0);

alter table public.debt_events
  drop constraint if exists debt_events_insurance_paid_non_negative_check,
  add constraint debt_events_insurance_paid_non_negative_check
    check (insurance_paid >= 0);

alter table public.debt_events
  drop constraint if exists debt_events_other_cost_paid_non_negative_check,
  add constraint debt_events_other_cost_paid_non_negative_check
    check (other_cost_paid >= 0);

alter table public.debt_events
  drop constraint if exists debt_events_cash_positive_for_fund_movements_check,
  add constraint debt_events_cash_positive_for_fund_movements_check
    check (event_type not in ('payment', 'principal_prepayment', 'payoff') or cash_amount > 0);

alter table public.debt_events
  drop constraint if exists debt_events_prepayment_negative_delta_check,
  add constraint debt_events_prepayment_negative_delta_check
    check (event_type <> 'principal_prepayment' or principal_delta < 0);

alter table public.debt_events
  drop constraint if exists debt_events_reversal_requires_target_check,
  add constraint debt_events_reversal_requires_target_check
    check (event_type <> 'reversal' or reversal_of_event_id is not null);

alter table public.debt_events
  drop constraint if exists debt_events_reversal_target_only_for_reversal_check,
  add constraint debt_events_reversal_target_only_for_reversal_check
    check (event_type = 'reversal' or reversal_of_event_id is null);

alter table public.debt_events
  drop constraint if exists debt_events_reversal_zero_financial_effect_check,
  add constraint debt_events_reversal_zero_financial_effect_check
    check (
      event_type <> 'reversal'
      or (
        cash_amount = 0
        and principal_delta = 0
        and interest_paid = 0
        and fees_paid = 0
        and insurance_paid = 0
        and other_cost_paid = 0
      )
    );

alter table public.debt_events
  drop constraint if exists debt_events_reversal_not_self_target_check,
  add constraint debt_events_reversal_not_self_target_check
    check (event_type <> 'reversal' or reversal_of_event_id <> id);

alter table public.debt_events
  drop constraint if exists debt_events_cash_zero_for_non_fund_events_check,
  add constraint debt_events_cash_zero_for_non_fund_events_check
    check (event_type in ('payment', 'principal_prepayment', 'payoff') or cash_amount = 0);

alter table public.debt_events
  drop constraint if exists debt_events_costs_zero_for_non_fund_events_check,
  add constraint debt_events_costs_zero_for_non_fund_events_check
    check (
      event_type in ('payment', 'principal_prepayment', 'payoff')
      or (
        interest_paid = 0
        and fees_paid = 0
        and insurance_paid = 0
        and other_cost_paid = 0
      )
    );

alter table public.debt_events
  drop constraint if exists debt_events_movement_only_for_fund_events_check,
  add constraint debt_events_movement_only_for_fund_events_check
    check (event_type in ('payment', 'principal_prepayment', 'payoff') or movement_id is null);

alter table public.debt_events
  drop constraint if exists debt_events_breakdown_false_for_non_fund_events_check,
  add constraint debt_events_breakdown_false_for_non_fund_events_check
    check (event_type in ('payment', 'principal_prepayment', 'payoff') or breakdown_complete = false);

alter table public.debt_events
  drop constraint if exists debt_events_payment_principal_delta_non_positive_check,
  add constraint debt_events_payment_principal_delta_non_positive_check
    check (event_type <> 'payment' or principal_delta <= 0);

alter table public.debt_events
  drop constraint if exists debt_events_payoff_principal_delta_non_positive_check,
  add constraint debt_events_payoff_principal_delta_non_positive_check
    check (event_type <> 'payoff' or principal_delta <= 0);

alter table public.debt_events
  drop constraint if exists debt_events_principal_reduction_within_cash_check,
  add constraint debt_events_principal_reduction_within_cash_check
    check (
      event_type not in ('payment', 'principal_prepayment', 'payoff')
      or (-principal_delta) <= cash_amount
    );

alter table public.debt_events
  drop constraint if exists debt_events_breakdown_matches_cash_check,
  add constraint debt_events_breakdown_matches_cash_check
    check (
      breakdown_complete = false
      or (
        event_type in ('payment', 'principal_prepayment', 'payoff')
        and cash_amount = (-principal_delta) + interest_paid + fees_paid + insurance_paid + other_cost_paid
      )
    );

create index if not exists idx_debt_events_movement_id
  on public.debt_events(movement_id)
  where movement_id is not null;

create unique index if not exists debt_events_reversal_of_event_key
  on public.debt_events(reversal_of_event_id)
  where reversal_of_event_id is not null;

create index if not exists idx_debt_events_debt_household_date
  on public.debt_events(debt_id, household_id, event_date);

alter table public.debt_events enable row level security;

revoke all privileges on table public.debt_events
  from public, anon, authenticated;

grant select on table public.debt_events
  to authenticated;

drop policy if exists "debt_events_select_member" on public.debt_events;
create policy "debt_events_select_member"
  on public.debt_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debt_events.household_id
        and hm.user_id = (select auth.uid())
    )
  );

drop policy if exists "debt_events_insert_member" on public.debt_events;
create policy "debt_events_insert_member"
  on public.debt_events
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debt_events.household_id
        and hm.user_id = (select auth.uid())
    )
    and debt_events.registered_by_user_id = (select auth.uid())
  );

-- ============================================================
-- 4. PUBLIC.DEBT_SCHEDULE_VERSIONS
-- ============================================================

create table if not exists public.debt_schedule_versions (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null,
  household_id uuid not null,
  version_number integer not null,
  effective_date date not null,
  reason text not null,
  trigger_event_id uuid null,
  notes text not null default '',
  created_by_user_id uuid not null,
  created_at timestamptz not null default now()
);

alter table public.debt_schedule_versions
  drop constraint if exists debt_schedule_versions_id_debt_household_key,
  add constraint debt_schedule_versions_id_debt_household_key
    unique (id, debt_id, household_id);

alter table public.debt_schedule_versions
  drop constraint if exists debt_schedule_versions_debt_version_key,
  add constraint debt_schedule_versions_debt_version_key
    unique (debt_id, version_number);

alter table public.debt_schedule_versions
  drop constraint if exists debt_schedule_versions_version_positive_check,
  add constraint debt_schedule_versions_version_positive_check
    check (version_number > 0);

alter table public.debt_schedule_versions
  drop constraint if exists debt_schedule_versions_reason_check,
  add constraint debt_schedule_versions_reason_check
    check (reason in ('initial', 'prepayment', 'rate_change', 'refinance', 'manual_adjustment'));

alter table public.debt_schedule_versions
  drop constraint if exists debt_schedule_versions_debt_household_fkey,
  add constraint debt_schedule_versions_debt_household_fkey
    foreign key (debt_id, household_id)
    references public.debts(id, household_id)
    on delete cascade;

alter table public.debt_schedule_versions
  drop constraint if exists debt_schedule_versions_trigger_event_household_fkey,
  add constraint debt_schedule_versions_trigger_event_household_fkey
    foreign key (trigger_event_id, debt_id, household_id)
    references public.debt_events(id, debt_id, household_id)
    on delete no action;

alter table public.debt_schedule_versions
  drop constraint if exists debt_schedule_versions_created_by_user_fkey,
  add constraint debt_schedule_versions_created_by_user_fkey
    foreign key (created_by_user_id)
    references auth.users(id)
    on delete restrict;

alter table public.debt_schedule_versions enable row level security;

revoke all privileges on table public.debt_schedule_versions
  from public, anon, authenticated;

grant select on table public.debt_schedule_versions
  to authenticated;

drop policy if exists "debt_schedule_versions_select_member" on public.debt_schedule_versions;
create policy "debt_schedule_versions_select_member"
  on public.debt_schedule_versions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debt_schedule_versions.household_id
        and hm.user_id = (select auth.uid())
    )
  );

drop policy if exists "debt_schedule_versions_insert_member" on public.debt_schedule_versions;
create policy "debt_schedule_versions_insert_member"
  on public.debt_schedule_versions
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debt_schedule_versions.household_id
        and hm.user_id = (select auth.uid())
    )
    and debt_schedule_versions.created_by_user_id = (select auth.uid())
  );

-- ============================================================
-- 5. PUBLIC.DEBT_INSTALLMENTS
-- ============================================================

create table if not exists public.debt_installments (
  id uuid primary key default gen_random_uuid(),
  schedule_version_id uuid not null,
  debt_id uuid not null,
  household_id uuid not null,
  installment_number integer not null,
  due_date date not null,
  expected_amount numeric null,
  expected_principal numeric null,
  expected_interest numeric null,
  expected_fees numeric null,
  expected_insurance numeric null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now()
);

alter table public.debt_installments
  drop constraint if exists debt_installments_id_debt_household_key,
  add constraint debt_installments_id_debt_household_key
    unique (id, debt_id, household_id);

alter table public.debt_installments
  drop constraint if exists debt_installments_schedule_version_number_key,
  add constraint debt_installments_schedule_version_number_key
    unique (schedule_version_id, installment_number);

alter table public.debt_installments
  drop constraint if exists debt_installments_number_positive_check,
  add constraint debt_installments_number_positive_check
    check (installment_number > 0);

alter table public.debt_installments
  drop constraint if exists debt_installments_expected_amount_positive_check,
  add constraint debt_installments_expected_amount_positive_check
    check (expected_amount is null or expected_amount > 0);

alter table public.debt_installments
  drop constraint if exists debt_installments_expected_principal_non_negative_check,
  add constraint debt_installments_expected_principal_non_negative_check
    check (expected_principal is null or expected_principal >= 0);

alter table public.debt_installments
  drop constraint if exists debt_installments_expected_interest_non_negative_check,
  add constraint debt_installments_expected_interest_non_negative_check
    check (expected_interest is null or expected_interest >= 0);

alter table public.debt_installments
  drop constraint if exists debt_installments_expected_fees_non_negative_check,
  add constraint debt_installments_expected_fees_non_negative_check
    check (expected_fees is null or expected_fees >= 0);

alter table public.debt_installments
  drop constraint if exists debt_installments_expected_insurance_non_negative_check,
  add constraint debt_installments_expected_insurance_non_negative_check
    check (expected_insurance is null or expected_insurance >= 0);

alter table public.debt_installments
  drop constraint if exists debt_installments_expected_components_within_amount_check,
  add constraint debt_installments_expected_components_within_amount_check
    check (
      expected_amount is null
      or coalesce(expected_principal, 0)
         + coalesce(expected_interest, 0)
         + coalesce(expected_fees, 0)
         + coalesce(expected_insurance, 0)
         <= expected_amount
    );

alter table public.debt_installments
  drop constraint if exists debt_installments_schedule_debt_household_fkey,
  add constraint debt_installments_schedule_debt_household_fkey
    foreign key (schedule_version_id, debt_id, household_id)
    references public.debt_schedule_versions(id, debt_id, household_id)
    on delete cascade;

alter table public.debt_installments
  drop constraint if exists debt_installments_created_by_user_fkey,
  add constraint debt_installments_created_by_user_fkey
    foreign key (created_by_user_id)
    references auth.users(id)
    on delete restrict;

create index if not exists idx_debt_installments_debt_due_date
  on public.debt_installments(debt_id, due_date);

create index if not exists idx_debt_installments_household_due_date
  on public.debt_installments(household_id, due_date);

alter table public.debt_installments enable row level security;

revoke all privileges on table public.debt_installments
  from public, anon, authenticated;

grant select on table public.debt_installments
  to authenticated;

drop policy if exists "debt_installments_select_member" on public.debt_installments;
create policy "debt_installments_select_member"
  on public.debt_installments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debt_installments.household_id
        and hm.user_id = (select auth.uid())
    )
  );

drop policy if exists "debt_installments_insert_member" on public.debt_installments;
create policy "debt_installments_insert_member"
  on public.debt_installments
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debt_installments.household_id
        and hm.user_id = (select auth.uid())
    )
    and debt_installments.created_by_user_id = (select auth.uid())
  );

-- ============================================================
-- 6. PUBLIC.DEBT_EVENT_INSTALLMENT_ALLOCATIONS
-- ============================================================

create table if not exists public.debt_event_installment_allocations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  installment_id uuid not null,
  debt_id uuid not null,
  household_id uuid not null,
  allocated_amount numeric not null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now()
);

alter table public.debt_event_installment_allocations
  drop constraint if exists debt_event_installment_allocations_allocated_amount_positive_check,
  add constraint debt_event_installment_allocations_allocated_amount_positive_check
    check (allocated_amount > 0);

alter table public.debt_event_installment_allocations
  drop constraint if exists debt_event_installment_allocations_event_installment_key,
  add constraint debt_event_installment_allocations_event_installment_key
    unique (event_id, installment_id);

alter table public.debt_event_installment_allocations
  drop constraint if exists debt_event_installment_allocations_event_debt_household_fkey,
  add constraint debt_event_installment_allocations_event_debt_household_fkey
    foreign key (event_id, debt_id, household_id)
    references public.debt_events(id, debt_id, household_id)
    on delete cascade;

alter table public.debt_event_installment_allocations
  drop constraint if exists debt_event_installment_allocations_installment_debt_household_fkey,
  add constraint debt_event_installment_allocations_installment_debt_household_fkey
    foreign key (installment_id, debt_id, household_id)
    references public.debt_installments(id, debt_id, household_id)
    on delete cascade;

alter table public.debt_event_installment_allocations
  drop constraint if exists debt_event_installment_allocations_created_by_user_fkey,
  add constraint debt_event_installment_allocations_created_by_user_fkey
    foreign key (created_by_user_id)
    references auth.users(id)
    on delete restrict;

create index if not exists idx_debt_event_installment_allocations_installment
  on public.debt_event_installment_allocations(installment_id);

alter table public.debt_event_installment_allocations enable row level security;

revoke all privileges on table public.debt_event_installment_allocations
  from public, anon, authenticated;

grant select on table public.debt_event_installment_allocations
  to authenticated;

drop policy if exists "debt_event_installment_allocations_select_member" on public.debt_event_installment_allocations;
create policy "debt_event_installment_allocations_select_member"
  on public.debt_event_installment_allocations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debt_event_installment_allocations.household_id
        and hm.user_id = (select auth.uid())
    )
  );

drop policy if exists "debt_event_installment_allocations_insert_member" on public.debt_event_installment_allocations;
create policy "debt_event_installment_allocations_insert_member"
  on public.debt_event_installment_allocations
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debt_event_installment_allocations.household_id
        and hm.user_id = (select auth.uid())
    )
    and debt_event_installment_allocations.created_by_user_id = (select auth.uid())
  );

-- ============================================================
-- 7. PUBLIC.DEBT_COLLATERALS
-- ============================================================

create table if not exists public.debt_collaterals (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null,
  household_id uuid not null,
  description text not null,
  pledged_value numeric null,
  estimated_value numeric null,
  redemption_deadline date null,
  status text not null default 'pledged',
  notes text not null default '',
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.debt_collaterals
  drop constraint if exists debt_collaterals_debt_household_fkey,
  add constraint debt_collaterals_debt_household_fkey
    foreign key (debt_id, household_id)
    references public.debts(id, household_id)
    on delete cascade;

alter table public.debt_collaterals
  drop constraint if exists debt_collaterals_created_by_user_fkey,
  add constraint debt_collaterals_created_by_user_fkey
    foreign key (created_by_user_id)
    references auth.users(id)
    on delete restrict;

alter table public.debt_collaterals
  drop constraint if exists debt_collaterals_description_not_blank_check,
  add constraint debt_collaterals_description_not_blank_check
    check (pg_catalog.btrim(description) <> '');

alter table public.debt_collaterals
  drop constraint if exists debt_collaterals_pledged_value_non_negative_check,
  add constraint debt_collaterals_pledged_value_non_negative_check
    check (pledged_value is null or pledged_value >= 0);

alter table public.debt_collaterals
  drop constraint if exists debt_collaterals_estimated_value_non_negative_check,
  add constraint debt_collaterals_estimated_value_non_negative_check
    check (estimated_value is null or estimated_value >= 0);

alter table public.debt_collaterals
  drop constraint if exists debt_collaterals_status_check,
  add constraint debt_collaterals_status_check
    check (status in ('pledged', 'released', 'forfeited'));

create index if not exists idx_debt_collaterals_debt
  on public.debt_collaterals(debt_id);

alter table public.debt_collaterals enable row level security;

revoke all privileges on table public.debt_collaterals
  from public, anon, authenticated;

grant select on table public.debt_collaterals
  to authenticated;

drop policy if exists "debt_collaterals_select_member" on public.debt_collaterals;
create policy "debt_collaterals_select_member"
  on public.debt_collaterals
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debt_collaterals.household_id
        and hm.user_id = (select auth.uid())
    )
  );

drop policy if exists "debt_collaterals_insert_member" on public.debt_collaterals;
create policy "debt_collaterals_insert_member"
  on public.debt_collaterals
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debt_collaterals.household_id
        and hm.user_id = (select auth.uid())
    )
    and debt_collaterals.created_by_user_id = (select auth.uid())
  );

drop policy if exists "debt_collaterals_update_member" on public.debt_collaterals;
create policy "debt_collaterals_update_member"
  on public.debt_collaterals
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debt_collaterals.household_id
        and hm.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debt_collaterals.household_id
        and hm.user_id = (select auth.uid())
    )
  );

-- ============================================================
-- 8. TRIGGERS
-- ============================================================

-- Baseline financiera: opening_principal_balance y tracking_start_date
-- quedan bloqueados una vez existe el primer debt_event de la deuda.
create or replace function public.protect_debt_financial_baseline()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if (
    new.opening_principal_balance is distinct from old.opening_principal_balance
    or new.tracking_start_date is distinct from old.tracking_start_date
  )
  and exists (
    select 1
    from public.debt_events as de
    where de.debt_id = new.id
      and de.household_id = new.household_id
  ) then
    raise exception 'DEBT_BASELINE_LOCKED';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_debts_protect_financial_baseline on public.debts;
create trigger trg_debts_protect_financial_baseline
  before update of opening_principal_balance, tracking_start_date
  on public.debts
  for each row
  execute function public.protect_debt_financial_baseline();

-- Un reversal invalida lógicamente el evento objetivo.
-- Valida que el target sea del mismo debt/household y no sea a su vez un reversal.
create or replace function public.validate_debt_event_reversal()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_target_type text;
begin
  if new.event_type = 'reversal' then
    select de.event_type
      into v_target_type
      from public.debt_events as de
     where de.id = new.reversal_of_event_id
       and de.debt_id = new.debt_id
       and de.household_id = new.household_id;
    if not found then
      raise exception 'DEBT_REVERSAL_TARGET_NOT_FOUND';
    end if;
    if v_target_type = 'reversal' then
      raise exception 'DEBT_REVERSAL_OF_REVERSAL_NOT_ALLOWED';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_debt_events_validate_reversal on public.debt_events;
create trigger trg_debt_events_validate_reversal
  before insert on public.debt_events
  for each row
  execute function public.validate_debt_event_reversal();

-- Movimiento vinculado: el flujo real de efectivo se representa con el
-- balance del movement (account_id). NO se valida method (legacy sin lógica financiera).
create or replace function public.validate_debt_event_movement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_movement public.movements%rowtype;
begin
  if new.movement_id is null then
    return new;
  end if;
  select m
    into v_movement
    from public.movements as m
   where m.id = new.movement_id
     and m.household_id = new.household_id;
  if not found then
    raise exception 'DEBT_MOVEMENT_NOT_FOUND';
  end if;
  if v_movement.type <> 'egreso' then
    raise exception 'DEBT_MOVEMENT_MUST_BE_EXPENSE';
  end if;
  if v_movement.amount <> new.cash_amount then
    raise exception 'DEBT_MOVEMENT_AMOUNT_MISMATCH';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_debt_events_validate_movement on public.debt_events;
create trigger trg_debt_events_validate_movement
  before insert on public.debt_events
  for each row
  execute function public.validate_debt_event_movement();

-- Identidades inmutables en las tablas mutables.
create or replace function public.protect_debt_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.id is distinct from old.id
    or new.household_id is distinct from old.household_id
    or new.created_by_user_id is distinct from old.created_by_user_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'DEBT_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_debts_protect_identity on public.debts;
create trigger trg_debts_protect_identity
  before update on public.debts
  for each row
  execute function public.protect_debt_identity();

create or replace function public.protect_debt_collateral_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.id is distinct from old.id
    or new.debt_id is distinct from old.debt_id
    or new.household_id is distinct from old.household_id
    or new.created_by_user_id is distinct from old.created_by_user_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'DEBT_COLLATERAL_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_debt_collaterals_protect_identity on public.debt_collaterals;
create trigger trg_debt_collaterals_protect_identity
  before update on public.debt_collaterals
  for each row
  execute function public.protect_debt_collateral_identity();

-- Allocations: únicamente eventos payment son asignables a cuotas.
-- El control de SUM(allocated_amount) <= event.cash_amount se hará
-- atómicamente en DEBT-2 con la RPC de pago (evita problemas de concurrencia).
create or replace function public.validate_debt_installment_allocation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_event_type text;
begin
  select de.event_type
    into v_event_type
    from public.debt_events as de
   where de.id = new.event_id
     and de.debt_id = new.debt_id
     and de.household_id = new.household_id;
  if not found then
    raise exception 'DEBT_EVENT_NOT_FOUND';
  end if;
  if v_event_type <> 'payment' then
    raise exception 'DEBT_EVENT_NOT_ALLOCATABLE';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_debt_event_installment_allocations_validate_event on public.debt_event_installment_allocations;
create trigger trg_debt_event_installment_allocations_validate_event
  before insert on public.debt_event_installment_allocations
  for each row
  execute function public.validate_debt_installment_allocation();

-- updated_at automático: reutiliza la función SSOT existente
-- public.touch_financial_accounts_updated_at() (semántica genérica: new.updated_at := now()).
drop trigger if exists trg_debts_touch_updated_at on public.debts;
create trigger trg_debts_touch_updated_at
  before update on public.debts
  for each row
  execute function public.touch_financial_accounts_updated_at();

drop trigger if exists trg_debt_collaterals_touch_updated_at on public.debt_collaterals;
create trigger trg_debt_collaterals_touch_updated_at
  before update on public.debt_collaterals
  for each row
  execute function public.touch_financial_accounts_updated_at();

-- ============================================================
-- 9. FUNCIONES SIN EJECUCIÓN CLIENTE
-- ============================================================

revoke execute on function public.protect_debt_financial_baseline()
  from public, anon, authenticated, service_role;

revoke execute on function public.validate_debt_event_reversal()
  from public, anon, authenticated, service_role;

revoke execute on function public.validate_debt_event_movement()
  from public, anon, authenticated, service_role;

revoke execute on function public.protect_debt_identity()
  from public, anon, authenticated, service_role;

revoke execute on function public.protect_debt_collateral_identity()
  from public, anon, authenticated, service_role;

revoke execute on function public.validate_debt_installment_allocation()
  from public, anon, authenticated, service_role;

-- ============================================================
-- 10. COMENTARIOS DE DISEÑO
-- ============================================================

comment on column public.debts.opening_principal_balance is
  'Saldo de principal al comenzar el seguimiento (baseline). No es un saldo mutable: queda bloqueado al existir el primer event.';

comment on column public.debts.tracking_start_date is
  'Inicio del seguimiento. Forma parte del baseline financiero bloqueado por protect_debt_financial_baseline.';

comment on column public.debt_events.principal_delta is
  'Contrato: principal_delta < 0 reduce el principal pendiente; > 0 lo incrementa; = 0 no lo altera. Saldo = opening_principal_balance + SUM(principal_delta) de eventos efectivos no revertidos (los reversals no se suman). DEBT-2 deberá impedir que una operación normal deje current_principal < 0; la constraint cross-row se implementará en DEBT-2 por requerir operación transaccional/concurrencia.';

comment on column public.debt_events.reversal_of_event_id is
  'Un reversal invalida lógicamente el evento objetivo. Los cálculos financieros deben considerar únicamente eventos no-reversal que no hayan sido objetivo de un reversal. El reversal en sí no se suma financieramente.';

comment on table public.debt_schedule_versions is
  'Cronogramas versionados (append-only): nunca se sobrescriben. La versión vigente es la de mayor version_number. Si un evento que originó un cambio de cronograma es revertido, DEBT-2 debe crear en la misma operación una NUEVA versión superior que represente el cronograma restaurado/corregido. Nunca se reactiva ni modifica una versión antigua: MAX(version_number) sigue siendo la SSOT. Sin implementar todavía.';

comment on table public.debt_event_installment_allocations is
  'Allocation: solo eventos payment son asignables a cuotas. Principal prepayment y payoff NO marcan cuotas como pagadas automáticamente. El control de SUM(allocated_amount) <= event.cash_amount será responsabilidad de la operación atómica DEBT-2. Las allocations de un payment posteriormente revertido permanecen históricamente almacenadas; al calcular el estado de una cuota se consideran únicamente allocations de payments efectivos (no revertidos). No se borran allocations ni se crean reversals de allocation.';

comment on column public.debt_installments.expected_amount is
  'El estado de cada cuota (pagada/pendiente) NO se almacena: se deriva de debt_event_installment_allocations y eventos.';

comment on column public.debt_events.movement_id is
  'Movimiento financiero opcional en DEBT-1A. La creación atómica movimiento + pago llegará en DEBT-2. Un mismo movement_id solo puede pertenecer a un evento efectivo a la vez; revertido el evento anterior, el movimiento puede reutilizarse en un evento correctivo. La garantía concurrente de un solo evento efectivo por movimiento (considerando solo eventos no revertidos) se implementa atómicamente en DEBT-2. El reversal no lleva movement_id: el vínculo histórico queda en el evento original.';

comment on column public.debts.debt_kind is
  'credit_card está reservado para DEBT-5 y no implica funcionalidad de tarjetas en esta migración.';