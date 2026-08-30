-- CAJA FAMILIAR — DOCUMENT-FIRST DEBT ONBOARDING V1
-- Additive-only release. Creates a fixed-schedule generic debt, its universal
-- financing contract, initial schedule metadata and sanitized document audit
-- record atomically. No movements, payments or historical debt events are
-- manufactured by onboarding.

create or replace function public.create_debt_from_document_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_onboarding_mode text,
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
  p_installments jsonb,
  p_repayment_structure text,
  p_interest_calculation_mode text,
  p_periodic_rate_percent numeric,
  p_periodic_rate_basis text,
  p_contract jsonb,
  p_schedule_source text,
  p_schedule_authority text,
  p_last_paid_installment integer,
  p_document_kind text,
  p_document_authority text,
  p_authority_evidence text,
  p_normalized_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_existing public.debts%rowtype;
  v_create_result jsonb;
  v_schedule public.debt_schedule_versions%rowtype;
  v_elem jsonb;
  v_contractual_number integer;
  v_max_contractual_number integer := 0;
  v_contract jsonb;
  v_metadata jsonb;
  v_job jsonb;
  v_expected_source text;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.household_members as hm
     where hm.household_id = p_household_id
       and hm.user_id = v_user_id
  ) then
    raise exception 'HOUSEHOLD_ACCESS_DENIED';
  end if;

  if p_debt_id is null
     or p_onboarding_mode not in ('NEW_DEBT', 'EXISTING_DEBT')
     or coalesce(pg_catalog.btrim(p_name), '') = ''
     or coalesce(pg_catalog.btrim(p_creditor_name), '') = ''
     or p_debt_kind not in ('family_loan', 'installment_purchase', 'mortgage', 'other')
     or p_currency_code not in ('PEN', 'USD')
     or p_tracking_start_date is null
     or p_original_principal is null or p_original_principal <= 0
     or p_opening_principal_balance is null or p_opening_principal_balance <= 0
     or p_opening_principal_balance > p_original_principal + 0.01
     or p_repayment_structure <> 'fixed_schedule'
     or p_interest_calculation_mode <> 'contract_schedule'
     or p_installments is null
     or pg_catalog.jsonb_typeof(p_installments) <> 'array'
     or pg_catalog.jsonb_array_length(p_installments) = 0
     or p_contract is null
     or pg_catalog.jsonb_typeof(p_contract) <> 'object'
     or p_schedule_source not in ('contractual', 'reconstructed', 'estimated', 'manual')
     or p_schedule_authority not in ('contractual', 'official_noncontractual', 'user_reported', 'estimated', 'unknown')
     or p_document_authority not in ('contractual', 'official_noncontractual', 'user_reported', 'estimated', 'unknown')
     or p_schedule_authority is distinct from p_document_authority
     or p_document_kind not in ('contract', 'schedule', 'refinance', 'statement', 'other')
     or p_last_paid_installment is null or p_last_paid_installment < 0
     or p_normalized_metadata is null
     or pg_catalog.jsonb_typeof(p_normalized_metadata) <> 'object'
     or p_normalized_metadata ? 'raw_document'
     or p_contract->>'contract_authority' is distinct from p_document_authority then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  v_expected_source := case p_schedule_authority
    when 'contractual' then 'contractual'
    when 'official_noncontractual' then 'reconstructed'
    when 'estimated' then 'estimated'
    when 'user_reported' then 'manual'
    else 'manual'
  end;
  if p_schedule_source <> v_expected_source then raise exception 'INVALID_DEBT_INPUT'; end if;
  if p_onboarding_mode = 'NEW_DEBT' and p_last_paid_installment <> 0 then raise exception 'INVALID_DEBT_INPUT'; end if;

  -- Same caller-supplied debt UUID makes a lost-response retry idempotent.
  select d.* into v_existing from public.debts as d where d.id = p_debt_id;
  if found then
    if v_existing.household_id is distinct from p_household_id
       or v_existing.name is distinct from pg_catalog.btrim(p_name)
       or v_existing.creditor_name is distinct from pg_catalog.btrim(p_creditor_name)
       or v_existing.debt_kind is distinct from p_debt_kind
       or v_existing.currency_code is distinct from p_currency_code
       or pg_catalog.abs(v_existing.opening_principal_balance - p_opening_principal_balance) > 0.01
       or not exists (select 1 from public.debt_financing_contracts as c where c.debt_id = p_debt_id and c.household_id = p_household_id)
       or not exists (select 1 from public.debt_schedule_versions as s where s.debt_id = p_debt_id and s.household_id = p_household_id)
       or not exists (
         select 1 from public.bank_document_import_jobs as j
          where j.household_id = p_household_id
            and j.document_schema = 'CAJA_FAMILIAR_DEBT_DOCUMENT_V2'
            and j.normalized_metadata->>'onboardingDebtId' = p_debt_id::text
       ) then
      raise exception 'DEBT_DOCUMENT_ONBOARDING_ID_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object('success', true, 'idempotentReplay', true, 'debtId', p_debt_id);
  end if;

  perform private.debt2b2_validate_universal_schedule_arithmetic(p_installments);

  for v_elem in select value from pg_catalog.jsonb_array_elements(p_installments) loop
    if pg_catalog.jsonb_typeof(v_elem) <> 'object'
       or not (v_elem ? 'installment_number')
       or not (v_elem ? 'due_date') then
      raise exception 'INVALID_INSTALLMENTS';
    end if;
    begin
      v_contractual_number := coalesce(nullif(v_elem->>'contractual_installment_number', '')::integer, (v_elem->>'installment_number')::integer);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'INVALID_INSTALLMENTS';
    end;
    if v_contractual_number < 1 then raise exception 'INVALID_INSTALLMENTS'; end if;
    v_max_contractual_number := greatest(v_max_contractual_number, v_contractual_number);
  end loop;
  if p_last_paid_installment >= v_max_contractual_number and p_onboarding_mode = 'EXISTING_DEBT' then raise exception 'INVALID_DEBT_INPUT'; end if;

  v_create_result := public.create_debt_v2(
    p_household_id,
    p_debt_id,
    pg_catalog.btrim(p_name),
    pg_catalog.btrim(p_creditor_name),
    p_debt_kind,
    p_currency_code,
    p_origin_date,
    p_tracking_start_date,
    p_original_principal,
    p_opening_principal_balance,
    p_planned_installment_count,
    p_planned_installment_amount,
    p_installment_amount_mode,
    p_payment_frequency,
    p_custom_frequency_days,
    p_first_due_date,
    p_tea_percent,
    p_tcea_percent,
    coalesce(p_notes, ''),
    p_installments,
    '[]'::jsonb,
    'fixed_schedule',
    'contract_schedule',
    p_periodic_rate_percent,
    p_periodic_rate_basis,
    null
  );

  select s.* into v_schedule
    from public.debt_schedule_versions as s
   where s.debt_id = p_debt_id
     and s.household_id = p_household_id
   order by s.version_number desc
   limit 1
   for update;
  if not found then raise exception 'INVALID_DEBT_SCHEDULE'; end if;

  perform private.debt2b2_apply_universal_schedule_metadata(v_schedule.id, p_debt_id, p_household_id, p_installments);

  for v_elem in select value from pg_catalog.jsonb_array_elements(p_installments) loop
    v_contractual_number := coalesce(nullif(v_elem->>'contractual_installment_number', '')::integer, (v_elem->>'installment_number')::integer);
    update public.debt_installments
       set contractual_installment_number = v_contractual_number,
           is_paid_before_tracking = (p_onboarding_mode = 'EXISTING_DEBT' and v_contractual_number <= p_last_paid_installment)
     where schedule_version_id = v_schedule.id
       and debt_id = p_debt_id
       and household_id = p_household_id
       and installment_number = (v_elem->>'installment_number')::integer;
  end loop;

  update public.debt_schedule_versions
     set schedule_source = p_schedule_source,
         is_authoritative = (p_schedule_authority = 'contractual'),
         authority = p_schedule_authority,
         notes = case
           when p_schedule_authority = 'official_noncontractual' then 'Cronograma inicial importado desde proforma/documento oficial no contractual.'
           else 'Cronograma inicial importado mediante onboarding documental V2.'
         end
   where id = v_schedule.id;

  v_contract := p_contract || pg_catalog.jsonb_build_object(
    'opening_principal_amount', p_opening_principal_balance,
    'repayment_structure', 'fixed_schedule',
    'contract_authority', p_document_authority
  );
  perform public.upsert_debt_financing_contract_v1(p_household_id, p_debt_id, v_contract);

  v_metadata := p_normalized_metadata || pg_catalog.jsonb_build_object(
    'onboardingDebtId', p_debt_id::text,
    'onboardingMode', p_onboarding_mode,
    'authorityEvidence', coalesce(nullif(pg_catalog.btrim(p_authority_evidence), ''), 'unknown')
  );
  v_job := public.create_debt_document_import_job_v2(
    p_household_id,
    p_debt_id,
    p_document_kind,
    p_document_authority,
    'external_ai',
    null,
    0,
    '{}'::text[],
    v_metadata
  );

  return pg_catalog.jsonb_build_object(
    'success', true,
    'idempotentReplay', false,
    'debtId', p_debt_id,
    'scheduleVersionId', v_schedule.id,
    'documentJobId', v_job->>'id'
  );
end;
$function$;

revoke all privileges on function public.create_debt_from_document_v1(uuid, uuid, text, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, jsonb, text, text, numeric, text, jsonb, text, text, integer, text, text, text, jsonb) from public, anon, service_role;
grant execute on function public.create_debt_from_document_v1(uuid, uuid, text, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, jsonb, text, text, numeric, text, jsonb, text, text, integer, text, text, text, jsonb) to authenticated;

comment on function public.create_debt_from_document_v1(uuid, uuid, text, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, jsonb, text, text, numeric, text, jsonb, text, text, integer, text, text, text, jsonb) is
  'Document-first onboarding V1. Atomically creates one generic fixed-schedule debt + universal financing contract + initial schedule provenance/metadata + sanitized V2 document audit. No cash movement or historical payment event is generated.';
