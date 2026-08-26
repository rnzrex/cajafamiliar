-- BANK LOAN ONBOARDING V3: existing-loan baseline, contractual numbering,
-- total fixed insurance semantics, and spreadsheet schedule import support.
-- Additive only: historical BANK V2 migrations are intentionally untouched.

alter table public.bank_loan_profiles
  add column if not exists installments_paid_before_tracking integer;

alter table public.bank_loan_profiles
  alter column installments_paid_before_tracking set default 0;

update public.bank_loan_profiles
   set installments_paid_before_tracking = 0
 where installments_paid_before_tracking is null;

alter table public.bank_loan_profiles
  alter column installments_paid_before_tracking set not null;

alter table public.bank_loan_profiles
  drop constraint if exists bank_loan_profiles_installments_paid_before_tracking_non_negati,
  drop constraint if exists bank_loan_profiles_paid_before_tracking_nonneg_check,
  add constraint bank_loan_profiles_paid_before_tracking_nonneg_check
    check (installments_paid_before_tracking >= 0),
  drop constraint if exists bank_loan_profiles_installments_paid_before_tracking_term_check,
  add constraint bank_loan_profiles_installments_paid_before_tracking_term_check
    check (term_installments is null or installments_paid_before_tracking <= term_installments);

alter table public.debt_installments
  add column if not exists is_paid_before_tracking boolean;

alter table public.debt_installments
  alter column is_paid_before_tracking set default false;

update public.debt_installments
   set is_paid_before_tracking = false
 where is_paid_before_tracking is null;

alter table public.debt_installments
  alter column is_paid_before_tracking set not null;

alter table public.debt_installments
  add column if not exists contractual_installment_number integer;

update public.debt_installments
   set contractual_installment_number = installment_number
 where contractual_installment_number is null;

alter table public.debt_installments
  drop constraint if exists debt_installments_contractual_number_positive_check,
  add constraint debt_installments_contractual_number_positive_check
    check (contractual_installment_number is null or contractual_installment_number > 0);

create index if not exists idx_debt_installments_debt_pretracking
  on public.debt_installments (debt_id, is_paid_before_tracking, installment_number);

-- Normalize metadata for any schedule helper that omits the new optional
-- contractual number. A later schedule version can never inherit baseline flags.
create or replace function public.normalize_debt_installment_tracking_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_has_prior_schedule boolean;
begin
  if new.contractual_installment_number is null then
    new.contractual_installment_number := new.installment_number;
  end if;

  select exists (
    select 1
      from public.debt_schedule_versions as s
     where s.debt_id = new.debt_id
       and s.household_id = new.household_id
       and s.id <> new.schedule_version_id
  ) into v_has_prior_schedule;

  if v_has_prior_schedule then
    new.is_paid_before_tracking := false;
  end if;

  return new;
end;
$function$;

revoke all privileges on function public.normalize_debt_installment_tracking_metadata()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_debt_installments_tracking_metadata
  on public.debt_installments;
create trigger trg_debt_installments_tracking_metadata
  before insert on public.debt_installments
  for each row
  execute function public.normalize_debt_installment_tracking_metadata();

-- The allocation helper is the server-side SSOT for payments and advances.
-- Baseline rows are metadata-only and must not accept a Caja Familiar allocation.
create or replace function private.debt2b2_insert_allocations(
  p_household_id uuid,
  p_debt_id uuid,
  p_event_id uuid,
  p_schedule_version_id uuid,
  p_cash_amount numeric,
  p_allocations jsonb,
  p_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_elem jsonb;
  v_installment public.debt_installments%rowtype;
  v_installment_id uuid;
  v_allocated_amount numeric;
  v_allocated_before numeric;
  v_total numeric := 0;
  v_seen_installments uuid[] := '{}'::uuid[];
begin
  if p_allocations is null
     or pg_catalog.jsonb_typeof(p_allocations) <> 'array'
     or p_cash_amount is null
     or p_cash_amount <= 0 then
    raise exception 'INVALID_DEBT_ALLOCATIONS';
  end if;

  if pg_catalog.jsonb_array_length(p_allocations) = 0 then
    return;
  end if;

  if p_schedule_version_id is null then
    raise exception 'INVALID_DEBT_ALLOCATIONS';
  end if;

  for v_elem in
    select e.value
      from pg_catalog.jsonb_array_elements(p_allocations) as e
  loop
    if pg_catalog.jsonb_typeof(v_elem) <> 'object'
       or not (v_elem ? 'installment_id')
       or v_elem->'installment_id' = 'null'::pg_catalog.jsonb
       or not (v_elem ? 'allocated_amount')
       or v_elem->'allocated_amount' = 'null'::pg_catalog.jsonb
       or pg_catalog.jsonb_typeof(v_elem->'allocated_amount') <> 'number' then
      raise exception 'INVALID_DEBT_ALLOCATIONS';
    end if;

    begin
      v_installment_id := (v_elem->>'installment_id')::uuid;
      v_allocated_amount := (v_elem->>'allocated_amount')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'INVALID_DEBT_ALLOCATIONS';
    end;

    if v_allocated_amount <= 0
       or v_installment_id = any(v_seen_installments) then
      raise exception 'INVALID_DEBT_ALLOCATIONS';
    end if;
    v_seen_installments := pg_catalog.array_append(v_seen_installments, v_installment_id);

    select i.*
      into v_installment
      from public.debt_installments as i
     where i.id = v_installment_id
       and i.debt_id = p_debt_id
       and i.household_id = p_household_id
       and i.schedule_version_id = p_schedule_version_id
     for update;

    if not found then
      raise exception 'INVALID_DEBT_ALLOCATIONS';
    end if;

    if coalesce(v_installment.is_paid_before_tracking, false) then
      raise exception 'INVALID_DEBT_ALLOCATION';
    end if;

    select coalesce(pg_catalog.sum(a.allocated_amount), 0::numeric)
      into v_allocated_before
      from public.debt_event_installment_allocations as a
      join public.debt_events as e
        on e.id = a.event_id
       and e.debt_id = a.debt_id
       and e.household_id = a.household_id
     where a.installment_id = v_installment_id
       and a.debt_id = p_debt_id
       and a.household_id = p_household_id
       and e.event_type in ('payment', 'installment_advance')
       and not exists (
         select 1
           from public.debt_events as r
          where r.debt_id = e.debt_id
            and r.household_id = e.household_id
            and r.event_type = 'reversal'
            and r.reversal_of_event_id = e.id
       );

    v_total := v_total + v_allocated_amount;
    if v_total > p_cash_amount then
      raise exception 'INVALID_DEBT_ALLOCATIONS';
    end if;
    if v_installment.expected_amount is not null
       and v_allocated_before + v_allocated_amount > v_installment.expected_amount then
      raise exception 'INVALID_DEBT_ALLOCATIONS';
    end if;

    insert into public.debt_event_installment_allocations (
      event_id,
      installment_id,
      debt_id,
      household_id,
      allocated_amount,
      created_by_user_id
    ) values (
      p_event_id,
      v_installment_id,
      p_debt_id,
      p_household_id,
      v_allocated_amount,
      p_user_id
    );
  end loop;
end;
$function$;

-- Defense in depth for direct allocation inserts. RPCs already route through
-- debt2b2_insert_allocations, while this trigger protects the table itself.
create or replace function public.validate_debt_installment_allocation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_event_type text;
  v_is_paid_before_tracking boolean;
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

  select i.is_paid_before_tracking
    into v_is_paid_before_tracking
    from public.debt_installments as i
   where i.id = new.installment_id
     and i.debt_id = new.debt_id
     and i.household_id = new.household_id;

  if not found or coalesce(v_is_paid_before_tracking, false) then
    raise exception 'INVALID_DEBT_ALLOCATION';
  end if;

  if v_event_type not in ('payment', 'installment_advance') then
    raise exception 'DEBT_EVENT_NOT_ALLOCATABLE';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_debt_event_installment_allocations_validate_event
  on public.debt_event_installment_allocations;
create trigger trg_debt_event_installment_allocations_validate_event
  before insert on public.debt_event_installment_allocations
  for each row
  execute function public.validate_debt_installment_allocation();

-- Keep the same public signature, SECURITY DEFINER contract, authorization,
-- idempotency behavior, result shape, and authenticated grant as BANK V2.
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
  v_baseline integer := 0;
  v_initial_schedule_starts_at_one boolean := false;
  v_contractual_installment_number integer;
  v_is_paid_before_tracking boolean;
  v_profile_term integer;
begin
  if p_profile is not null and pg_catalog.jsonb_typeof(p_profile) = 'object' and p_profile ? 'installments_paid_before_tracking' then
    if p_profile->>'installments_paid_before_tracking' !~ '^[0-9]+$' then
      raise exception 'INVALID_DEBT_INPUT';
    end if;
    v_baseline := (p_profile->>'installments_paid_before_tracking')::integer;
  end if;

  v_profile_term := p_planned_installment_count;
  if p_profile is not null and pg_catalog.jsonb_typeof(p_profile) = 'object'
     and p_profile->>'term_installments' is not null then
    if p_profile->>'term_installments' !~ '^[0-9]+$' then
      raise exception 'INVALID_DEBT_INPUT';
    end if;
    v_profile_term := (p_profile->>'term_installments')::integer;
  end if;

  if v_baseline < 0
     or (v_profile_term is not null and v_baseline > v_profile_term) then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

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
       term_installments, installments_paid_before_tracking, grace_period_type, grace_period_installments, balloon_payment_amount,
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
       v_baseline,
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
    select coalesce(pg_catalog.min(coalesce(nullif(e.value->>'contractual_installment_number', '')::integer, (e.value->>'installment_number')::integer)) = 1, false)
      into v_initial_schedule_starts_at_one
      from pg_catalog.jsonb_array_elements(p_installments) as e;

    insert into public.debt_schedule_versions (
      debt_id, household_id, version_number, effective_date, reason, schedule_source, is_authoritative, notes, created_by_user_id, created_at
    ) values (
      p_debt_id, p_household_id, 1, p_tracking_start_date, 'initial', v_schedule_source, v_is_authoritative, '', v_user_id, now()
    )
    returning * into v_schedule;

    for v_elem in select value from pg_catalog.jsonb_array_elements(p_installments) loop
      v_contractual_installment_number := coalesce(nullif(v_elem->>'contractual_installment_number', '')::integer, (v_elem->>'installment_number')::integer);
      v_is_paid_before_tracking := v_initial_schedule_starts_at_one
        and v_contractual_installment_number <= v_baseline;

      insert into public.debt_installments (
        schedule_version_id, debt_id, household_id, installment_number, due_date,
        expected_amount, expected_principal, expected_interest, expected_fees, expected_insurance,
        contractual_installment_number, is_paid_before_tracking,
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
        v_contractual_installment_number, v_is_paid_before_tracking,
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

-- BANK V2 historically required a complete internal schedule. V3 also accepts
-- an initial pending-only import (for example contractual 6..18), while still
-- requiring internal numbering 1..N and preserving the strict later-version
-- lifecycle validators.
create or replace function private.require_bank_loan_schedule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_schedule_id uuid;
  v_schedule_source text;
  v_schedule_version integer;
  v_schedule_count integer;
  v_first_installment integer;
  v_last_installment integer;
  v_distinct_installments integer;
  v_first_contractual integer;
  v_last_contractual integer;
  v_distinct_contractual integer;
  v_planned_installment_count integer;
  v_complete_rows boolean;
  v_chronological_rows boolean;
  v_contractual_contiguous boolean;
  v_complete_schedule boolean;
  v_partial_pending_schedule boolean;
  v_installments_paid_before_tracking integer := 0;
begin
  select pg_catalog.count(*)
    into v_schedule_count
    from public.debt_schedule_versions as s
   where s.debt_id = new.debt_id
     and s.household_id = new.household_id;

  select s.id, s.schedule_source, s.version_number
    into v_schedule_id, v_schedule_source, v_schedule_version
    from public.debt_schedule_versions as s
   where s.debt_id = new.debt_id
     and s.household_id = new.household_id
   order by s.version_number desc
   limit 1;

  select d.planned_installment_count
    into v_planned_installment_count
    from public.debts as d
   where d.id = new.debt_id
     and d.household_id = new.household_id;

  select coalesce(p.installments_paid_before_tracking, 0)
    into v_installments_paid_before_tracking
    from public.bank_loan_profiles as p
   where p.debt_id = new.debt_id
     and p.household_id = new.household_id;

  select
    min(i.installment_number),
    max(i.installment_number),
    pg_catalog.count(distinct i.installment_number),
    min(i.contractual_installment_number),
    max(i.contractual_installment_number),
    pg_catalog.count(distinct i.contractual_installment_number),
    coalesce(pg_catalog.bool_and(
      i.expected_amount is not null
      and i.expected_principal is not null
      and i.expected_interest is not null
      and i.expected_fees is not null
      and i.expected_insurance is not null
    ), false),
    coalesce(pg_catalog.max(i.contractual_installment_number) - pg_catalog.min(i.contractual_installment_number) + 1 = pg_catalog.count(distinct i.contractual_installment_number), false)
    into v_first_installment, v_last_installment, v_distinct_installments,
         v_first_contractual, v_last_contractual, v_distinct_contractual,
         v_complete_rows, v_contractual_contiguous
    from public.debt_installments as i
   where i.schedule_version_id = v_schedule_id
     and i.debt_id = new.debt_id
     and i.household_id = new.household_id;

  select not exists (
    select 1
      from (
        select i.due_date,
               pg_catalog.lag(i.due_date) over (order by i.installment_number) as previous_due_date
          from public.debt_installments as i
         where i.schedule_version_id = v_schedule_id
           and i.debt_id = new.debt_id
           and i.household_id = new.household_id
      ) as ordered_rows
     where ordered_rows.previous_due_date is not null
       and ordered_rows.due_date <= ordered_rows.previous_due_date
  ) into v_chronological_rows;

  v_complete_schedule := coalesce(
    v_planned_installment_count is not null
    and v_distinct_installments = v_planned_installment_count
    and v_first_installment = 1
    and v_last_installment = v_distinct_installments
    and v_first_contractual = 1
    and v_last_contractual = v_planned_installment_count
    and v_distinct_contractual = v_planned_installment_count
    and v_contractual_contiguous,
    false
  );

  v_partial_pending_schedule := coalesce(
    v_schedule_version = 1
    and v_schedule_source = 'contractual'
    and v_planned_installment_count is not null
    and v_first_installment = 1
    and v_last_installment = v_distinct_installments
    and v_first_contractual > 1
    and v_first_contractual = v_installments_paid_before_tracking + 1
    and v_last_contractual = v_planned_installment_count
    and v_distinct_contractual = v_distinct_installments
    and v_contractual_contiguous
    and v_distinct_installments = v_planned_installment_count - v_first_contractual + 1,
    false
  );

  if v_schedule_count = 0
     or v_schedule_source not in ('contractual', 'estimated')
     or not v_complete_rows
     or not v_chronological_rows
     or (not v_complete_schedule and not v_partial_pending_schedule) then
    raise exception 'BANK_SCHEDULE_REQUIRED';
  end if;
  return new;
end;
$function$;


revoke all privileges on function private.debt2b2_insert_allocations(uuid, uuid, uuid, uuid, numeric, jsonb, uuid)
  from public, anon, authenticated, service_role;

revoke all privileges on function public.create_bank_loan_v1(uuid, uuid, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, text, text, numeric, text, numeric, jsonb, jsonb, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_bank_loan_v1(uuid, uuid, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, text, text, numeric, text, numeric, jsonb, jsonb, text, jsonb, jsonb)
  to authenticated;
