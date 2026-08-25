-- DEBT-BANK-V2: Bank Credit Contract V2 SQL Migration (Audit Fix 1)
-- Introduces public.bank_loan_profiles, public.debt_insurance_terms,
-- schedule_source & is_authoritative in debt_schedule_versions,
-- extra_principal_amount & prepayment_effect in debt_events,
-- installment_advance event_type, updated allocation SSOT, and SECURITY DEFINER RPCs.

-- ============================================================
-- 1. PUBLIC.BANK_LOAN_PROFILES
-- ============================================================

create table if not exists public.bank_loan_profiles (
  debt_id uuid primary key,
  household_id uuid not null,
  loan_subtype text not null,
  contract_number text null,
  amortization_method text not null default 'unknown',
  disbursed_amount numeric null,
  asset_price numeric null,
  down_payment_amount numeric null,
  financed_amount numeric null,
  term_installments integer null,
  grace_period_type text not null default 'none',
  grace_period_installments integer null,
  balloon_payment_amount numeric null,
  notes text not null default '',
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bank_loan_profiles
  drop constraint if exists bank_loan_profiles_debt_household_fkey,
  add constraint bank_loan_profiles_debt_household_fkey
    foreign key (debt_id, household_id)
    references public.debts(id, household_id)
    on delete cascade;

alter table public.bank_loan_profiles
  drop constraint if exists bank_loan_profiles_created_by_user_fkey,
  add constraint bank_loan_profiles_created_by_user_fkey
    foreign key (created_by_user_id)
    references auth.users(id)
    on delete restrict;

alter table public.bank_loan_profiles
  drop constraint if exists bank_loan_profiles_loan_subtype_check,
  add constraint bank_loan_profiles_loan_subtype_check
    check (loan_subtype in ('personal', 'vehicular', 'mortgage', 'education', 'payroll', 'debt_consolidation', 'business', 'other'));

alter table public.bank_loan_profiles
  drop constraint if exists bank_loan_profiles_amortization_method_check,
  add constraint bank_loan_profiles_amortization_method_check
    check (amortization_method in ('fixed_installment', 'constant_principal', 'increasing_installment', 'decreasing_installment', 'irregular_contract', 'custom', 'unknown'));

alter table public.bank_loan_profiles
  drop constraint if exists bank_loan_profiles_disbursed_amount_check,
  add constraint bank_loan_profiles_disbursed_amount_check
    check (disbursed_amount is null or disbursed_amount >= 0);

alter table public.bank_loan_profiles
  drop constraint if exists bank_loan_profiles_asset_price_check,
  add constraint bank_loan_profiles_asset_price_check
    check (asset_price is null or asset_price >= 0);

alter table public.bank_loan_profiles
  drop constraint if exists bank_loan_profiles_down_payment_amount_check,
  add constraint bank_loan_profiles_down_payment_amount_check
    check (down_payment_amount is null or down_payment_amount >= 0);

alter table public.bank_loan_profiles
  drop constraint if exists bank_loan_profiles_financed_amount_check,
  add constraint bank_loan_profiles_financed_amount_check
    check (financed_amount is null or financed_amount >= 0);

alter table public.bank_loan_profiles
  drop constraint if exists bank_loan_profiles_term_installments_check,
  add constraint bank_loan_profiles_term_installments_check
    check (term_installments is null or term_installments > 0);

alter table public.bank_loan_profiles
  drop constraint if exists bank_loan_profiles_grace_period_type_check,
  add constraint bank_loan_profiles_grace_period_type_check
    check (grace_period_type in ('none', 'total', 'partial'));

alter table public.bank_loan_profiles
  drop constraint if exists bank_loan_profiles_grace_period_installments_check,
  add constraint bank_loan_profiles_grace_period_installments_check
    check (grace_period_installments is null or grace_period_installments >= 0);

alter table public.bank_loan_profiles
  drop constraint if exists bank_loan_profiles_balloon_payment_amount_check,
  add constraint bank_loan_profiles_balloon_payment_amount_check
    check (balloon_payment_amount is null or balloon_payment_amount >= 0);

create index if not exists idx_bank_loan_profiles_household
  on public.bank_loan_profiles(household_id);

alter table public.bank_loan_profiles enable row level security;

revoke all privileges on table public.bank_loan_profiles
  from public, anon, authenticated;

grant select on table public.bank_loan_profiles
  to authenticated;

drop policy if exists "bank_loan_profiles_select_member" on public.bank_loan_profiles;
create policy "bank_loan_profiles_select_member"
  on public.bank_loan_profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = bank_loan_profiles.household_id
        and hm.user_id = (select auth.uid())
    )
  );

drop policy if exists "bank_loan_profiles_insert_member" on public.bank_loan_profiles;
create policy "bank_loan_profiles_insert_member"
  on public.bank_loan_profiles
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = bank_loan_profiles.household_id
        and hm.user_id = (select auth.uid())
    )
    and bank_loan_profiles.created_by_user_id = (select auth.uid())
  );

drop policy if exists "bank_loan_profiles_update_member" on public.bank_loan_profiles;
create policy "bank_loan_profiles_update_member"
  on public.bank_loan_profiles
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = bank_loan_profiles.household_id
        and hm.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = bank_loan_profiles.household_id
        and hm.user_id = (select auth.uid())
    )
  );


-- ============================================================
-- 2. PUBLIC.DEBT_INSURANCE_TERMS
-- ============================================================

create table if not exists public.debt_insurance_terms (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null,
  household_id uuid not null,
  insurance_type text not null,
  label text not null,
  pricing_mode text not null default 'unknown',
  rate_percent numeric null,
  fixed_amount numeric null,
  rate_basis text null,
  is_required boolean not null default true,
  provider text null,
  policy_reference text null,
  notes text not null default '',
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.debt_insurance_terms
  drop constraint if exists debt_insurance_terms_debt_household_fkey,
  add constraint debt_insurance_terms_debt_household_fkey
    foreign key (debt_id, household_id)
    references public.debts(id, household_id)
    on delete cascade;

alter table public.debt_insurance_terms
  drop constraint if exists debt_insurance_terms_created_by_user_fkey,
  add constraint debt_insurance_terms_created_by_user_fkey
    foreign key (created_by_user_id)
    references auth.users(id)
    on delete restrict;

alter table public.debt_insurance_terms
  drop constraint if exists debt_insurance_terms_label_not_blank_check,
  add constraint debt_insurance_terms_label_not_blank_check
    check (pg_catalog.btrim(label) <> '');

alter table public.debt_insurance_terms
  drop constraint if exists debt_insurance_terms_insurance_type_check,
  add constraint debt_insurance_terms_insurance_type_check
    check (insurance_type in ('credit_life', 'vehicle', 'property', 'other'));

alter table public.debt_insurance_terms
  drop constraint if exists debt_insurance_terms_pricing_mode_check,
  add constraint debt_insurance_terms_pricing_mode_check
    check (pricing_mode in ('fixed_amount', 'percent_outstanding_balance', 'percent_original_principal', 'contract_schedule', 'unknown'));

alter table public.debt_insurance_terms
  drop constraint if exists debt_insurance_terms_rate_percent_check,
  add constraint debt_insurance_terms_rate_percent_check
    check (rate_percent is null or rate_percent >= 0);

alter table public.debt_insurance_terms
  drop constraint if exists debt_insurance_terms_fixed_amount_check,
  add constraint debt_insurance_terms_fixed_amount_check
    check (fixed_amount is null or fixed_amount >= 0);

create index if not exists idx_debt_insurance_terms_debt_household
  on public.debt_insurance_terms(debt_id, household_id);

alter table public.debt_insurance_terms enable row level security;

revoke all privileges on table public.debt_insurance_terms
  from public, anon, authenticated;

grant select on table public.debt_insurance_terms
  to authenticated;

drop policy if exists "debt_insurance_terms_select_member" on public.debt_insurance_terms;
create policy "debt_insurance_terms_select_member"
  on public.debt_insurance_terms
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debt_insurance_terms.household_id
        and hm.user_id = (select auth.uid())
    )
  );

drop policy if exists "debt_insurance_terms_insert_member" on public.debt_insurance_terms;
create policy "debt_insurance_terms_insert_member"
  on public.debt_insurance_terms
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debt_insurance_terms.household_id
        and hm.user_id = (select auth.uid())
    )
    and debt_insurance_terms.created_by_user_id = (select auth.uid())
  );

drop policy if exists "debt_insurance_terms_update_member" on public.debt_insurance_terms;
create policy "debt_insurance_terms_update_member"
  on public.debt_insurance_terms
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debt_insurance_terms.household_id
        and hm.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = debt_insurance_terms.household_id
        and hm.user_id = (select auth.uid())
    )
  );


-- ============================================================
-- 3. ALTER EXISTING DEBT TABLES
-- ============================================================

alter table public.debt_schedule_versions
  add column if not exists schedule_source text not null default 'manual',
  add column if not exists is_authoritative boolean not null default true;

alter table public.debt_schedule_versions
  drop constraint if exists debt_schedule_versions_schedule_source_check,
  add constraint debt_schedule_versions_schedule_source_check
    check (schedule_source in ('contractual', 'estimated', 'manual'));

alter table public.debt_events
  add column if not exists extra_principal_amount numeric not null default 0,
  add column if not exists prepayment_effect text null;

alter table public.debt_events
  drop constraint if exists debt_events_extra_principal_amount_non_negative_check,
  add constraint debt_events_extra_principal_amount_non_negative_check
    check (extra_principal_amount >= 0);

alter table public.debt_events
  drop constraint if exists debt_events_prepayment_effect_check,
  add constraint debt_events_prepayment_effect_check
    check (prepayment_effect is null or prepayment_effect in ('reduce_term', 'reduce_installment', 'pending_bank_schedule', 'other', 'unknown'));

alter table public.debt_events
  drop constraint if exists debt_events_event_type_check,
  add constraint debt_events_event_type_check
    check (event_type in ('payment', 'principal_prepayment', 'principal_adjustment', 'refinance', 'payoff', 'reversal', 'installment_advance'));

-- Update cash positive constraint to include installment_advance
alter table public.debt_events
  drop constraint if exists debt_events_cash_positive_for_fund_movements_check,
  add constraint debt_events_cash_positive_for_fund_movements_check
    check (event_type not in ('payment', 'principal_prepayment', 'payoff', 'installment_advance') or cash_amount > 0);

-- Update cash zero constraint
alter table public.debt_events
  drop constraint if exists debt_events_cash_zero_for_non_fund_events_check,
  add constraint debt_events_cash_zero_for_non_fund_events_check
    check (event_type in ('payment', 'principal_prepayment', 'payoff', 'installment_advance') or cash_amount = 0);

-- Update costs zero constraint
alter table public.debt_events
  drop constraint if exists debt_events_costs_zero_for_non_fund_events_check,
  add constraint debt_events_costs_zero_for_non_fund_events_check
    check (
      event_type in ('payment', 'principal_prepayment', 'payoff', 'installment_advance')
      or (
        interest_paid = 0
        and fees_paid = 0
        and insurance_paid = 0
        and other_cost_paid = 0
      )
    );

-- Update movement only constraint
alter table public.debt_events
  drop constraint if exists debt_events_movement_only_for_fund_events_check,
  add constraint debt_events_movement_only_for_fund_events_check
    check (event_type in ('payment', 'principal_prepayment', 'payoff', 'installment_advance') or movement_id is null);

-- Update breakdown false constraint
alter table public.debt_events
  drop constraint if exists debt_events_breakdown_false_for_non_fund_events_check,
  add constraint debt_events_breakdown_false_for_non_fund_events_check
    check (event_type in ('payment', 'principal_prepayment', 'payoff', 'installment_advance') or breakdown_complete = false);

-- Update principal reduction within cash constraint
alter table public.debt_events
  drop constraint if exists debt_events_principal_reduction_within_cash_check,
  add constraint debt_events_principal_reduction_within_cash_check
    check (
      event_type not in ('payment', 'principal_prepayment', 'payoff', 'installment_advance')
      or (-principal_delta) <= cash_amount
    );

-- Update breakdown matches cash constraint
alter table public.debt_events
  drop constraint if exists debt_events_breakdown_matches_cash_check,
  add constraint debt_events_breakdown_matches_cash_check
    check (
      breakdown_complete = false
      or (
        event_type in ('payment', 'principal_prepayment', 'payoff', 'installment_advance')
        and cash_amount = (-principal_delta) + interest_paid + fees_paid + insurance_paid + other_cost_paid
      )
    );


-- ============================================================
-- 4. UPDATE PRIVATE DEBT ALLOCATION SSOT
-- ============================================================

create or replace function private.debt2b2_insert_allocations(
  p_event_id uuid,
  p_debt_id uuid,
  p_household_id uuid,
  p_user_id uuid,
  p_cash_amount numeric,
  p_allocations jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_elem pg_catalog.jsonb;
  v_inst_id uuid;
  v_alloc_amt numeric;
  v_inst public.debt_installments%rowtype;
  v_total_alloc numeric := 0;
  v_current_sched public.debt_schedule_versions%rowtype;
  v_allocated_before numeric;
begin
  select s.*
    into v_current_sched
    from public.debt_schedule_versions as s
   where s.debt_id = p_debt_id
     and s.household_id = p_household_id
   order by s.version_number desc
   limit 1;

  for v_elem in
    select e.value
      from pg_catalog.jsonb_array_elements(p_allocations) as e
  loop
    v_inst_id := (v_elem->>'installment_id')::uuid;
    v_alloc_amt := (v_elem->>'allocated_amount')::numeric;

    if v_inst_id is null or v_alloc_amt is null or v_alloc_amt <= 0 then
      raise exception 'INVALID_DEBT_ALLOCATION';
    end if;

    select i.*
      into v_inst
      from public.debt_installments as i
     where i.id = v_inst_id
       and i.debt_id = p_debt_id
       and i.household_id = p_household_id;
    if not found then
      raise exception 'INVALID_DEBT_ALLOCATION';
    end if;

    if v_current_sched.id is null or v_inst.schedule_version_id <> v_current_sched.id then
      raise exception 'INVALID_DEBT_ALLOCATION';
    end if;

    -- SSOT: sum allocations from active payments AND installment advances
    select coalesce(pg_catalog.sum(a.allocated_amount), 0::numeric)
      into v_allocated_before
      from public.debt_event_installment_allocations as a
      join public.debt_events as e on e.id = a.event_id
     where a.installment_id = v_inst_id
       and a.household_id = p_household_id
       and e.event_type in ('payment', 'installment_advance')
       and not exists (
         select 1
           from public.debt_events as r
          where r.household_id = e.household_id
            and r.debt_id = e.debt_id
            and r.event_type = 'reversal'
            and r.reversal_of_event_id = e.id
       );

    if v_inst.expected_amount is not null
       and (v_allocated_before + v_alloc_amt) > v_inst.expected_amount then
      raise exception 'INVALID_DEBT_ALLOCATION';
    end if;

    insert into public.debt_event_installment_allocations (
      event_id, installment_id, debt_id, household_id, allocated_amount, created_by_user_id, created_at
    ) values (
      p_event_id, v_inst_id, p_debt_id, p_household_id, v_alloc_amt, p_user_id, now()
    );

    v_total_alloc := v_total_alloc + v_alloc_amt;
  end loop;

  if v_total_alloc > p_cash_amount then
    raise exception 'INVALID_DEBT_ALLOCATION';
  end if;
end;
$function$;


-- ============================================================
-- 5. RPC: CREATE_BANK_LOAN_V1 (ALIGNED SIGNATURE & NO PRIVATE.IF)
-- ============================================================

create or replace function public.create_bank_loan_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_name text,
  p_creditor_name text,
  p_debt_kind text,
  p_currency_code text,
  p_origin_date date,
  p_tracking_start_date date,
  p_original_principal numeric,
  p_opening_principal_balance numeric,
  p_planned_installment_count integer,
  p_planned_installment_amount numeric,
  p_installment_amount_mode text,
  p_payment_frequency text,
  p_custom_frequency_days integer,
  p_first_due_date date,
  p_tea_percent numeric,
  p_tcea_percent numeric,
  p_notes text,
  p_repayment_structure text,
  p_interest_calculation_mode text,
  p_periodic_rate_percent numeric,
  p_periodic_rate_basis text,
  p_minimum_principal_payment numeric,
  p_profile jsonb,
  p_insurances jsonb,
  p_schedule_source text,
  p_installments jsonb,
  p_collaterals jsonb
)
returns pg_catalog.jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_debt public.debts%rowtype;
  v_profile public.bank_loan_profiles%rowtype;
  v_schedule public.debt_schedule_versions%rowtype;
  v_installment public.debt_installments%rowtype;
  v_insurance public.debt_insurance_terms%rowtype;
  v_collateral public.debt_collaterals%rowtype;
  v_installments_json pg_catalog.jsonb := '[]'::pg_catalog.jsonb;
  v_insurances_json pg_catalog.jsonb := '[]'::pg_catalog.jsonb;
  v_collaterals_json pg_catalog.jsonb := '[]'::pg_catalog.jsonb;
  v_elem pg_catalog.jsonb;
  v_schedule_source text;
  v_is_authoritative boolean;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
      from public.household_members as hm
     where hm.household_id = p_household_id
       and hm.user_id = v_user_id
  ) then
    raise exception 'HOUSEHOLD_ACCESS_DENIED';
  end if;

  if p_household_id is null
     or p_debt_id is null
     or p_tracking_start_date is null
     or p_opening_principal_balance is null
     or p_name is null or pg_catalog.btrim(p_name) = ''
     or p_creditor_name is null or pg_catalog.btrim(p_creditor_name) = '' then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  v_schedule_source := coalesce(p_schedule_source, 'manual');
  if v_schedule_source not in ('contractual', 'estimated', 'manual') then
    v_schedule_source := 'manual';
  end if;
  v_is_authoritative := (v_schedule_source = 'contractual');

  -- Create Debt row
  insert into public.debts (
    id, household_id, name, creditor_name, debt_kind, currency_code,
    origin_date, tracking_start_date, original_principal, opening_principal_balance,
    planned_installment_count, planned_installment_amount, installment_amount_mode,
    payment_frequency, custom_frequency_days, first_due_date, tea_percent, tcea_percent,
    notes, status, is_archived, repayment_structure, interest_calculation_mode,
    periodic_rate_percent, periodic_rate_basis, minimum_principal_payment,
    created_by_user_id, created_at, updated_at
  ) values (
    p_debt_id, p_household_id, pg_catalog.btrim(p_name), pg_catalog.btrim(p_creditor_name),
    p_debt_kind, coalesce(p_currency_code, 'PEN'), p_origin_date, p_tracking_start_date,
    p_original_principal, p_opening_principal_balance, p_planned_installment_count,
    p_planned_installment_amount, coalesce(p_installment_amount_mode, 'unknown'),
    p_payment_frequency, p_custom_frequency_days, p_first_due_date, p_tea_percent,
    p_tcea_percent, coalesce(p_notes, ''), 'active', false,
    coalesce(p_repayment_structure, 'unknown'), coalesce(p_interest_calculation_mode, 'unknown'),
    p_periodic_rate_percent, p_periodic_rate_basis, p_minimum_principal_payment,
    v_user_id, now(), now()
  )
  returning * into v_debt;

  -- Create BankLoanProfile row if profile provided
  if p_profile is not null and pg_catalog.jsonb_typeof(p_profile) = 'object' then
    insert into public.bank_loan_profiles (
      debt_id, household_id, loan_subtype, contract_number, amortization_method,
      disbursed_amount, asset_price, down_payment_amount, financed_amount,
      term_installments, grace_period_type, grace_period_installments, balloon_payment_amount,
      notes, created_by_user_id, created_at, updated_at
    ) values (
      p_debt_id, p_household_id,
      coalesce(p_profile->>'loan_subtype', 'other'),
      p_profile->>'contract_number',
      coalesce(p_profile->>'amortization_method', 'unknown'),
      (p_profile->>'disbursed_amount')::numeric,
      (p_profile->>'asset_price')::numeric,
      (p_profile->>'down_payment_amount')::numeric,
      (p_profile->>'financed_amount')::numeric,
      (p_profile->>'term_installments')::integer,
      coalesce(p_profile->>'grace_period_type', 'none'),
      (p_profile->>'grace_period_installments')::integer,
      (p_profile->>'balloon_payment_amount')::numeric,
      coalesce(p_profile->>'notes', ''),
      v_user_id, now(), now()
    )
    returning * into v_profile;
  end if;

  -- Create Insurance terms if provided
  if p_insurances is not null and pg_catalog.jsonb_typeof(p_insurances) = 'array' then
    for v_elem in select value from pg_catalog.jsonb_array_elements(p_insurances) loop
      insert into public.debt_insurance_terms (
        debt_id, household_id, insurance_type, label, pricing_mode,
        rate_percent, fixed_amount, rate_basis, is_required, provider, policy_reference, notes,
        created_by_user_id, created_at, updated_at
      ) values (
        p_debt_id, p_household_id,
        coalesce(v_elem->>'insurance_type', 'other'),
        coalesce(v_elem->>'label', 'Seguro'),
        coalesce(v_elem->>'pricing_mode', 'unknown'),
        (v_elem->>'rate_percent')::numeric,
        (v_elem->>'fixed_amount')::numeric,
        v_elem->>'rate_basis',
        coalesce((v_elem->>'is_required')::boolean, true),
        v_elem->>'provider',
        v_elem->>'policy_reference',
        coalesce(v_elem->>'notes', ''),
        v_user_id, now(), now()
      )
      returning * into v_insurance;
      v_insurances_json := v_insurances_json || pg_catalog.to_jsonb(v_insurance);
    end loop;
  end if;

  -- Create Schedule Version 1 and Installments if provided
  if p_installments is not null and pg_catalog.jsonb_typeof(p_installments) = 'array' and pg_catalog.jsonb_array_length(p_installments) > 0 then
    insert into public.debt_schedule_versions (
      debt_id, household_id, version_number, effective_date, reason, schedule_source, is_authoritative, notes, created_by_user_id, created_at
    ) values (
      p_debt_id, p_household_id, 1, p_tracking_start_date, 'initial', v_schedule_source, v_is_authoritative, '', v_user_id, now()
    )
    returning * into v_schedule;

    for v_elem in select value from pg_catalog.jsonb_array_elements(p_installments) loop
      insert into public.debt_installments (
        schedule_version_id, debt_id, household_id, installment_number, due_date,
        expected_amount, expected_principal, expected_interest, expected_fees, expected_insurance,
        created_by_user_id, created_at
      ) values (
        v_schedule.id, p_debt_id, p_household_id,
        (v_elem->>'installment_number')::integer,
        (v_elem->>'due_date')::date,
        (v_elem->>'expected_amount')::numeric,
        (v_elem->>'expected_principal')::numeric,
        (v_elem->>'expected_interest')::numeric,
        (v_elem->>'expected_fees')::numeric,
        (v_elem->>'expected_insurance')::numeric,
        v_user_id, now()
      )
      returning * into v_installment;
      v_installments_json := v_installments_json || pg_catalog.to_jsonb(v_installment);
    end loop;
  end if;

  -- Create Collaterals if provided
  if p_collaterals is not null and pg_catalog.jsonb_typeof(p_collaterals) = 'array' then
    for v_elem in select value from pg_catalog.jsonb_array_elements(p_collaterals) loop
      insert into public.debt_collaterals (
        debt_id, household_id, description, pledged_value, estimated_value, redemption_deadline, status, notes, created_by_user_id, created_at, updated_at
      ) values (
        p_debt_id, p_household_id,
        coalesce(v_elem->>'description', 'Garantía'),
        (v_elem->>'pledged_value')::numeric,
        (v_elem->>'estimated_value')::numeric,
        (v_elem->>'redemption_deadline')::date,
        coalesce(v_elem->>'status', 'pledged'),
        coalesce(v_elem->>'notes', ''),
        v_user_id, now(), now()
      )
      returning * into v_collateral;
      v_collaterals_json := v_collaterals_json || pg_catalog.to_jsonb(v_collateral);
    end loop;
  end if;

  return pg_catalog.jsonb_build_object(
    'debt', pg_catalog.to_jsonb(v_debt),
    'profile', case when v_profile.debt_id is not null then pg_catalog.to_jsonb(v_profile) else 'null'::pg_catalog.jsonb end,
    'scheduleVersion', case when v_schedule.id is not null then pg_catalog.to_jsonb(v_schedule) else 'null'::pg_catalog.jsonb end,
    'installments', v_installments_json,
    'insurances', v_insurances_json,
    'collaterals', v_collaterals_json
  );
end;
$function$;

revoke all privileges on function public.create_bank_loan_v1(uuid, uuid, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, text, text, numeric, text, numeric, jsonb, jsonb, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_bank_loan_v1(uuid, uuid, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, text, text, numeric, text, numeric, jsonb, jsonb, text, jsonb, jsonb) to authenticated;


-- ============================================================
-- 6. RPC: RECORD_DEBT_INSTALLMENT_ADVANCE_V1 (ROBUST ENGINE)
-- ============================================================

create or replace function public.record_debt_installment_advance_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_event_id uuid,
  p_movement_id text,
  p_event_date date,
  p_cash_amount numeric,
  p_account_id uuid,
  p_description text,
  p_category text,
  p_principal_amount numeric,
  p_interest_paid numeric,
  p_fees_paid numeric,
  p_insurance_paid numeric,
  p_other_cost_paid numeric,
  p_breakdown_complete boolean,
  p_allocations jsonb
)
returns pg_catalog.jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_person text;
  v_description text;
  v_category text;
  v_movement_id text;
  v_debt public.debts%rowtype;
  v_movement public.movements%rowtype;
  v_event public.debt_events%rowtype;
  v_existing_event public.debt_events%rowtype;
  v_current_principal numeric;
  v_schedule public.debt_schedule_versions%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select hm.display_name into v_person
    from public.household_members as hm
   where hm.household_id = p_household_id and hm.user_id = v_user_id;
  if not found or v_person is null or pg_catalog.btrim(v_person) = '' then
    raise exception 'HOUSEHOLD_ACCESS_DENIED';
  end if;

  v_movement_id := pg_catalog.btrim(p_movement_id);
  v_description := pg_catalog.btrim(p_description);
  v_category := pg_catalog.btrim(p_category);

  if p_household_id is null or p_debt_id is null or p_event_id is null
     or v_movement_id is null or v_movement_id = '' or p_event_date is null
     or p_account_id is null or v_description is null or v_description = ''
     or v_category is null or v_category = '' or p_cash_amount is null
     or p_principal_amount is null or p_breakdown_complete is null
     or p_allocations is null or pg_catalog.jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'INVALID_DEBT_PAYMENT';
  end if;

  select d.* into v_debt from public.debts as d where d.id = p_debt_id and d.household_id = p_household_id for update;
  if not found then raise exception 'DEBT_NOT_FOUND'; end if;

  if v_debt.is_archived then raise exception 'DEBT_ARCHIVED'; end if;
  if v_debt.status <> 'active' then raise exception 'DEBT_NOT_ACTIVE'; end if;

  v_current_principal := private.debt2b2_current_principal(p_household_id, p_debt_id);
  if v_current_principal <= 0 then raise exception 'DEBT_ALREADY_PAID_OFF'; end if;
  if p_principal_amount > v_current_principal then raise exception 'INVALID_DEBT_PAYMENT'; end if;

  perform private.debt2b2_validate_costs(
    p_cash_amount, p_principal_amount, p_interest_paid, p_fees_paid, p_insurance_paid, p_other_cost_paid, p_breakdown_complete, 'INVALID_DEBT_PAYMENT'
  );

  perform private.debt2b2_lock_operation(v_movement_id, p_event_id);

  select e.* into v_existing_event from public.debt_events as e where e.id = p_event_id for update;
  if found then
    if v_existing_event.household_id is distinct from p_household_id
       or v_existing_event.debt_id is distinct from p_debt_id
       or v_existing_event.event_type is distinct from 'installment_advance'
       or v_existing_event.movement_id is distinct from v_movement_id
       or v_existing_event.event_date is distinct from p_event_date
       or v_existing_event.cash_amount is distinct from p_cash_amount
       or v_existing_event.principal_delta is distinct from -p_principal_amount then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;
    return private.debt2b2_fund_result(p_event_id, true);
  end if;

  -- Create Movement via helper
  v_movement := private.debt2b2_prepare_movement(
    p_household_id, v_movement_id, p_event_date, p_cash_amount, p_account_id, v_description, v_category, v_user_id, 'debt_service'
  );

  -- Create Debt Event (installment_advance)
  insert into public.debt_events (
    id, debt_id, household_id, event_date, event_type, cash_amount, principal_delta,
    interest_paid, fees_paid, insurance_paid, other_cost_paid, breakdown_complete,
    movement_id, reversal_of_event_id, description, registered_by_user_id, created_at
  ) values (
    p_event_id, p_debt_id, p_household_id, p_event_date, 'installment_advance',
    p_cash_amount, -p_principal_amount, coalesce(p_interest_paid, 0), coalesce(p_fees_paid, 0),
    coalesce(p_insurance_paid, 0), coalesce(p_other_cost_paid, 0), p_breakdown_complete,
    v_movement_id, null, v_description, v_user_id, now()
  ) returning * into v_event;

  -- Insert Allocations via SSOT helper
  select s.* into v_schedule
    from public.debt_schedule_versions as s
   where s.debt_id = p_debt_id and s.household_id = p_household_id
   order by s.version_number desc limit 1 for update;
  perform private.debt2b2_insert_allocations(
    p_household_id, p_debt_id, p_event_id,
    case when found then v_schedule.id else null end,
    p_cash_amount, p_allocations, v_user_id
  );

  perform private.debt2b2_reconcile_status(
    p_household_id, p_debt_id, v_current_principal - p_principal_amount
  );

  return private.debt2b2_fund_result(p_event_id, false);
end;
$function$;

revoke all privileges on function public.record_debt_installment_advance_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.record_debt_installment_advance_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, boolean, jsonb) to authenticated;


-- ============================================================
-- 7. RPC: RECORD_DEBT_PAYMENT_V2 (PAYMENT + EXTRA PRINCIPAL)
-- ============================================================

create or replace function public.record_debt_payment_v2(
  p_household_id uuid,
  p_debt_id uuid,
  p_event_id uuid,
  p_movement_id text,
  p_event_date date,
  p_cash_amount numeric,
  p_account_id uuid,
  p_description text,
  p_category text,
  p_principal_amount numeric,
  p_interest_paid numeric,
  p_fees_paid numeric,
  p_insurance_paid numeric,
  p_other_cost_paid numeric,
  p_extra_principal_amount numeric,
  p_prepayment_effect text,
  p_breakdown_complete boolean,
  p_allocations jsonb
)
returns pg_catalog.jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_person text;
  v_description text;
  v_category text;
  v_movement_id text;
  v_debt public.debts%rowtype;
  v_movement public.movements%rowtype;
  v_event public.debt_events%rowtype;
  v_existing_event public.debt_events%rowtype;
  v_current_principal numeric;
  v_extra_principal numeric := coalesce(p_extra_principal_amount, 0);
  v_schedule public.debt_schedule_versions%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select hm.display_name into v_person
    from public.household_members as hm
   where hm.household_id = p_household_id and hm.user_id = v_user_id;
  if not found or v_person is null or pg_catalog.btrim(v_person) = '' then
    raise exception 'HOUSEHOLD_ACCESS_DENIED';
  end if;

  v_movement_id := pg_catalog.btrim(p_movement_id);
  v_description := pg_catalog.btrim(p_description);
  v_category := pg_catalog.btrim(p_category);

  if p_household_id is null or p_debt_id is null or p_event_id is null
     or v_movement_id is null or v_movement_id = '' or p_event_date is null
     or p_account_id is null or v_description is null or v_description = ''
     or v_category is null or v_category = '' or p_cash_amount is null
     or p_principal_amount is null or p_breakdown_complete is null
     or p_allocations is null or pg_catalog.jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'INVALID_DEBT_PAYMENT';
  end if;

  select d.* into v_debt from public.debts as d where d.id = p_debt_id and d.household_id = p_household_id for update;
  if not found then raise exception 'DEBT_NOT_FOUND'; end if;

  if v_debt.is_archived then raise exception 'DEBT_ARCHIVED'; end if;
  if v_debt.status <> 'active' then raise exception 'DEBT_NOT_ACTIVE'; end if;

  v_current_principal := private.debt2b2_current_principal(p_household_id, p_debt_id);
  if v_current_principal <= 0 then raise exception 'DEBT_ALREADY_PAID_OFF'; end if;
  if (p_principal_amount + v_extra_principal) > v_current_principal then raise exception 'INVALID_DEBT_PAYMENT'; end if;

  perform private.debt2b2_validate_costs(
    p_cash_amount, p_principal_amount + v_extra_principal, p_interest_paid, p_fees_paid, p_insurance_paid, p_other_cost_paid, p_breakdown_complete, 'INVALID_DEBT_PAYMENT'
  );

  perform private.debt2b2_lock_operation(v_movement_id, p_event_id);

  select e.* into v_existing_event from public.debt_events as e where e.id = p_event_id for update;
  if found then
    return private.debt2b2_fund_result(p_event_id, true);
  end if;

  v_movement := private.debt2b2_prepare_movement(
    p_household_id, v_movement_id, p_event_date, p_cash_amount, p_account_id, v_description, v_category, v_user_id, 'debt_service'
  );

  insert into public.debt_events (
    id, debt_id, household_id, event_date, event_type, cash_amount, principal_delta,
    interest_paid, fees_paid, insurance_paid, other_cost_paid, extra_principal_amount, prepayment_effect,
    breakdown_complete, movement_id, reversal_of_event_id, description, registered_by_user_id, created_at
  ) values (
    p_event_id, p_debt_id, p_household_id, p_event_date, 'payment',
    p_cash_amount, -(p_principal_amount + v_extra_principal), coalesce(p_interest_paid, 0), coalesce(p_fees_paid, 0),
    coalesce(p_insurance_paid, 0), coalesce(p_other_cost_paid, 0), v_extra_principal, p_prepayment_effect,
    p_breakdown_complete, v_movement_id, null, v_description, v_user_id, now()
  ) returning * into v_event;

  select s.* into v_schedule
    from public.debt_schedule_versions as s
   where s.debt_id = p_debt_id and s.household_id = p_household_id
   order by s.version_number desc limit 1 for update;
  perform private.debt2b2_insert_allocations(
    p_household_id, p_debt_id, p_event_id,
    case when found then v_schedule.id else null end,
    p_cash_amount, p_allocations, v_user_id
  );

  perform private.debt2b2_reconcile_status(
    p_household_id, p_debt_id, v_current_principal - (p_principal_amount + v_extra_principal)
  );

  return private.debt2b2_fund_result(p_event_id, false);
end;
$function$;

revoke all privileges on function public.record_debt_payment_v2(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.record_debt_payment_v2(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, boolean, jsonb) to authenticated;


-- ============================================================
-- 8. UPDATE REVERSE_DEBT_EVENT_V1 TO SUPPORT INSTALLMENT_ADVANCE
-- ============================================================

create or replace function public.reverse_debt_event_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_reversal_event_id uuid,
  p_target_event_id uuid,
  p_event_date date,
  p_description text,
  p_schedule_installments jsonb,
  p_schedule_notes text
)
returns pg_catalog.jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_person text;
  v_debt public.debts%rowtype;
  v_target public.debt_events%rowtype;
  v_existing_reversal public.debt_events%rowtype;
  v_reversal_event public.debt_events%rowtype;
  v_restored_schedule public.debt_schedule_versions%rowtype;
  v_has_gen_schedule boolean;
  v_installments_json pg_catalog.jsonb := '[]'::pg_catalog.jsonb;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;

  select hm.display_name into v_person
    from public.household_members as hm
   where hm.household_id = p_household_id and hm.user_id = v_user_id;
  if not found or v_person is null or pg_catalog.btrim(v_person) = '' then
    raise exception 'HOUSEHOLD_ACCESS_DENIED';
  end if;

  if p_household_id is null or p_debt_id is null or p_reversal_event_id is null or p_target_event_id is null or p_event_date is null then
    raise exception 'INVALID_REVERSAL_INPUT';
  end if;

  select d.* into v_debt from public.debts as d where d.id = p_debt_id and d.household_id = p_household_id for update;
  if not found then raise exception 'DEBT_NOT_FOUND'; end if;
  if v_debt.is_archived then raise exception 'DEBT_ARCHIVED'; end if;

  select e.* into v_target from public.debt_events as e where e.id = p_target_event_id for update;
  if not found or v_target.household_id <> p_household_id or v_target.debt_id <> p_debt_id then
    raise exception 'REVERSAL_TARGET_NOT_FOUND';
  end if;

  if v_target.event_type not in ('payment', 'principal_prepayment', 'payoff', 'installment_advance') then
    raise exception 'REVERSAL_TARGET_INVALID';
  end if;

  perform private.debt2b2_lock_operation(v_target.movement_id, p_reversal_event_id);

  select e.* into v_existing_reversal from public.debt_events as e where e.id = p_reversal_event_id for update;
  if found then
    if v_existing_reversal.reversal_of_event_id is distinct from p_target_event_id then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;
    return private.debt2b2_reversal_result(p_reversal_event_id, true);
  end if;

  if exists (
    select 1 from public.debt_events as r
     where r.household_id = p_household_id and r.debt_id = p_debt_id
       and r.event_type = 'reversal' and r.reversal_of_event_id = p_target_event_id
  ) then
    raise exception 'TARGET_ALREADY_REVERSED';
  end if;

  insert into public.debt_events (
    id, debt_id, household_id, event_date, event_type, cash_amount, principal_delta,
    interest_paid, fees_paid, insurance_paid, other_cost_paid, breakdown_complete,
    movement_id, reversal_of_event_id, description, registered_by_user_id, created_at
  ) values (
    p_reversal_event_id, p_debt_id, p_household_id, p_event_date, 'reversal',
    0, 0, 0, 0, 0, 0, false, null, p_target_event_id, coalesce(p_description, 'Reversión'), v_user_id, now()
  ) returning * into v_reversal_event;

  perform private.debt2b2_reconcile_status(
    p_household_id, p_debt_id, private.debt2b2_current_principal(p_household_id, p_debt_id)
  );

  return private.debt2b2_reversal_result(p_reversal_event_id, false);
end;
$function$;

revoke all privileges on function public.reverse_debt_event_v1(uuid, uuid, uuid, uuid, date, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.reverse_debt_event_v1(uuid, uuid, uuid, uuid, date, text, jsonb, text) to authenticated;
