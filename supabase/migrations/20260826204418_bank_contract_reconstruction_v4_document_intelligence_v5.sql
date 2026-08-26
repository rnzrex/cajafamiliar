-- BANK CONTRACT RECONSTRUCTION V4 + DOCUMENT INTELLIGENCE V5
-- Additive only. Historical BANK V2/V3 migrations stay immutable.

-- ============================================================
-- 1. CONTRACT TERMS AND RECONSTRUCTION PROVENANCE
-- ============================================================

alter table public.bank_loan_profiles
  add column if not exists interest_day_count_basis text null,
  add column if not exists due_date_adjustment_rule text not null default 'unknown',
  add column if not exists installment_total_mode text not null default 'unknown',
  add column if not exists reported_balance_kind text null,
  add column if not exists reported_balance_amount numeric null;

alter table public.bank_loan_profiles
  drop constraint if exists bank_loan_profiles_interest_day_count_basis_check,
  add constraint bank_loan_profiles_interest_day_count_basis_check
    check (interest_day_count_basis is null or interest_day_count_basis in ('actual_days_360', 'actual_days_365')),
  drop constraint if exists bank_loan_profiles_due_date_adjustment_rule_check,
  add constraint bank_loan_profiles_due_date_adjustment_rule_check
    check (due_date_adjustment_rule in ('none', 'sunday_to_monday', 'weekend_to_next_business_day', 'contractual_dates', 'unknown')),
  drop constraint if exists bank_loan_profiles_installment_total_mode_check,
  add constraint bank_loan_profiles_installment_total_mode_check
    check (installment_total_mode in ('financial_installment_plus_costs', 'total_installment_including_costs', 'unknown')),
  drop constraint if exists bank_loan_profiles_reported_balance_kind_check,
  add constraint bank_loan_profiles_reported_balance_kind_check
    check (reported_balance_kind is null or reported_balance_kind in ('principal_balance', 'schedule_financial_balance', 'total_remaining_payments', 'unknown')),
  drop constraint if exists bank_loan_profiles_reported_balance_amount_check,
  add constraint bank_loan_profiles_reported_balance_amount_check
    check (reported_balance_amount is null or reported_balance_amount >= 0);

alter table public.debt_schedule_versions
  drop constraint if exists debt_schedule_versions_schedule_source_check,
  add constraint debt_schedule_versions_schedule_source_check
    check (schedule_source in ('contractual', 'reconstructed', 'estimated', 'manual'));

alter table public.debt_installments
  add column if not exists reported_balance numeric null;

alter table public.debt_installments
  drop constraint if exists debt_installments_reported_balance_non_negative_check,
  add constraint debt_installments_reported_balance_non_negative_check
    check (reported_balance is null or reported_balance >= 0);

-- ============================================================
-- 2. PRIVATE TEMPORARY DOCUMENT IMPORT STORAGE
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bank-document-imports',
  'bank-document-imports',
  false,
  20971520,
  array[
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/tab-separated-values',
    'text/plain',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "bank_document_imports_insert_member" on storage.objects;
create policy "bank_document_imports_insert_member"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'bank-document-imports'
    and split_part(name, '/', 2) = (select auth.uid())::text
    and exists (
      select 1
        from public.household_members as hm
       where hm.household_id::text = split_part(name, '/', 1)
         and hm.user_id = (select auth.uid())
    )
    and split_part(name, '/', 3) <> ''
    and split_part(name, '/', 4) <> ''
    and strpos(name, '//') = 0
  );

drop policy if exists "bank_document_imports_select_member" on storage.objects;
create policy "bank_document_imports_select_member"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'bank-document-imports'
    and split_part(name, '/', 2) = (select auth.uid())::text
    and exists (
      select 1
        from public.household_members as hm
       where hm.household_id::text = split_part(name, '/', 1)
         and hm.user_id = (select auth.uid())
    )
  );

-- Users do not need to update or delete objects. The server-side analyze
-- pipeline uses the service role only after auth and path ownership checks.

-- ============================================================
-- 3. OPERATING METADATA ONLY (NO RAW DOCUMENTS OR OCR)
-- ============================================================

create table if not exists public.bank_document_import_jobs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  created_by_user_id uuid not null,
  status text not null default 'created',
  provider text null,
  model text null,
  file_count integer not null default 0,
  storage_paths text[] not null default '{}'::text[],
  estimated_cost_usd numeric not null default 0,
  actual_cost_usd numeric null,
  input_tokens integer null,
  output_tokens integer null,
  thinking_tokens integer null,
  error_code text null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  expires_at timestamptz not null default (now() + interval '1 day')
);

alter table public.bank_document_import_jobs
  drop constraint if exists bank_document_import_jobs_status_check,
  add constraint bank_document_import_jobs_status_check
    check (status in ('created', 'uploading', 'analyzing', 'review', 'failed', 'deleted')),
  drop constraint if exists bank_document_import_jobs_file_count_check,
  add constraint bank_document_import_jobs_file_count_check
    check (file_count >= 0),
  drop constraint if exists bank_document_import_jobs_estimated_cost_check,
  add constraint bank_document_import_jobs_estimated_cost_check
    check (estimated_cost_usd >= 0),
  drop constraint if exists bank_document_import_jobs_actual_cost_check,
  add constraint bank_document_import_jobs_actual_cost_check
    check (actual_cost_usd is null or actual_cost_usd >= 0);

alter table public.bank_document_import_jobs
  drop constraint if exists bank_document_import_jobs_household_fkey,
  add constraint bank_document_import_jobs_household_fkey
    foreign key (household_id) references public.households(id) on delete cascade,
  drop constraint if exists bank_document_import_jobs_user_fkey,
  add constraint bank_document_import_jobs_user_fkey
    foreign key (created_by_user_id) references auth.users(id) on delete restrict;

create index if not exists idx_bank_document_import_jobs_household_created
  on public.bank_document_import_jobs(household_id, created_at desc);

alter table public.bank_document_import_jobs enable row level security;
revoke all privileges on table public.bank_document_import_jobs from public, anon, authenticated;
grant select on table public.bank_document_import_jobs to authenticated;

drop policy if exists "bank_document_import_jobs_select_member" on public.bank_document_import_jobs;
create policy "bank_document_import_jobs_select_member"
  on public.bank_document_import_jobs
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.household_members as hm
       where hm.household_id = bank_document_import_jobs.household_id
         and hm.user_id = (select auth.uid())
    )
  );

-- ============================================================
-- 4. ALLOW RECONSTRUCTED SCHEDULE PROVENANCE IN EXISTING RPCS
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
  if v_schedule_source not in ('contractual', 'reconstructed', 'estimated', 'manual') then
    v_schedule_source := 'manual';
  end if;
  v_is_authoritative := (v_schedule_source in ('contractual', 'reconstructed'));
  if v_schedule_source = 'reconstructed' then
    v_is_authoritative := false;
  end if;

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
       term_installments, installments_paid_before_tracking, interest_day_count_basis, due_date_adjustment_rule, installment_total_mode, reported_balance_kind, reported_balance_amount, grace_period_type, grace_period_installments, balloon_payment_amount,
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
       p_profile->>'interest_day_count_basis',
       coalesce(p_profile->>'due_date_adjustment_rule', 'unknown'),
       coalesce(p_profile->>'installment_total_mode', 'unknown'),
       p_profile->>'reported_balance_kind',
       (p_profile->>'reported_balance_amount')::numeric,
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
        expected_amount, expected_principal, expected_interest, expected_fees, expected_insurance, reported_balance,
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
        (v_elem->>'reported_balance')::numeric,
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
     or v_schedule_source not in ('contractual', 'reconstructed', 'estimated')
     or not v_complete_rows
     or not v_chronological_rows
     or (not v_complete_schedule and not v_partial_pending_schedule) then
    raise exception 'BANK_SCHEDULE_REQUIRED';
  end if;
  return new;
end;
$function$;
