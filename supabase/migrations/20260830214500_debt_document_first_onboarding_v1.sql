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
  p_normalized_metadata jsonb,
  p_history_mode text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_existing public.debts%rowtype;
  v_existing_fingerprint jsonb;
  v_create_result jsonb;
  v_schedule public.debt_schedule_versions%rowtype;
  v_elem jsonb;
  v_contractual_number integer;
  v_installment_number integer;
  v_expected_installment_number integer := 0;
  v_previous_contractual_number integer;
  v_max_contractual_number integer := 0;
  v_contract jsonb;
  v_sanitized_installments jsonb := '[]'::jsonb;
  v_metadata jsonb;
  v_fingerprint jsonb;
  v_job jsonb;
  v_expected_source text;
  v_history_mode text;
  v_safe_authority_evidence text;
  v_row_role text;
  v_field text;
  v_numeric_value numeric;
  v_expected_amount numeric;
  v_expected_principal numeric;
  v_expected_interest numeric;
  v_expected_fees numeric;
  v_expected_insurance numeric;
  v_expected_taxes numeric;
  v_reported_balance numeric;
  v_due_date date;
  v_down_payment_count integer := 0;
  v_down_payment_number integer;
  v_warning_count integer := 0;
  v_source_row_number integer;
begin
  v_history_mode := coalesce(
    p_history_mode,
    case when p_onboarding_mode = 'NEW_DEBT' then 'NO_ROWS_PAID' else 'CONSECUTIVE_FULLY_PAID' end
  );
  v_safe_authority_evidence := case lower(pg_catalog.btrim(coalesce(p_authority_evidence, '')))
    when 'signed_contract' then 'signed_contract'
    when 'official_schedule' then 'official_schedule'
    when 'proforma_non_binding' then 'proforma_non_binding'
    when 'user_statement' then 'user_statement'
    else 'unknown'
  end;

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
     or v_history_mode not in ('NO_ROWS_PAID', 'DOWN_PAYMENT_ONLY', 'CONSECUTIVE_FULLY_PAID')
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
     or p_normalized_metadata::text ~* '"raw[_]?document"[[:space:]]*:'
     or p_contract::text ~* '"raw[_]?document"[[:space:]]*:'
     or p_contract->>'contract_authority' is distinct from p_document_authority then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  if (p_onboarding_mode = 'NEW_DEBT' and (v_history_mode <> 'NO_ROWS_PAID' or p_last_paid_installment <> 0))
     or (p_onboarding_mode = 'EXISTING_DEBT' and v_history_mode = 'NO_ROWS_PAID') then
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

  -- Serialize retries for the caller-supplied id before checking or inserting
  -- the debt. This closes the concurrent same-UUID race around the unique id.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_debt_id::text, 0));

  perform private.debt2b2_validate_universal_schedule_arithmetic(p_installments);

  -- Validate and canonicalize every persisted row before the idempotency check.
  -- The allow-list drops arbitrary AI/user evidence instead of persisting raw
  -- document text or untrusted PII in installment metadata.
  for v_elem in select value from pg_catalog.jsonb_array_elements(p_installments) loop
    v_expected_installment_number := v_expected_installment_number + 1;
    if pg_catalog.jsonb_typeof(v_elem) <> 'object'
       or not (v_elem ? 'installment_number')
       or pg_catalog.jsonb_typeof(v_elem->'installment_number') <> 'number'
       or v_elem->>'installment_number' !~ '^[1-9][0-9]*$'
       or not (v_elem ? 'due_date')
       or v_elem->'due_date' = 'null'::jsonb
       or v_elem->>'due_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'INVALID_INSTALLMENTS';
    end if;

    begin
      v_installment_number := (v_elem->>'installment_number')::integer;
      v_due_date := (v_elem->>'due_date')::date;
    exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
      raise exception 'INVALID_INSTALLMENTS';
    end;
    if v_installment_number <> v_expected_installment_number then raise exception 'INVALID_INSTALLMENTS'; end if;

    if v_elem ? 'contractual_installment_number' and v_elem->'contractual_installment_number' <> 'null'::jsonb then
      if pg_catalog.jsonb_typeof(v_elem->'contractual_installment_number') <> 'number'
         or v_elem->>'contractual_installment_number' !~ '^[1-9][0-9]*$' then
        raise exception 'INVALID_INSTALLMENTS';
      end if;
      begin
        v_contractual_number := (v_elem->>'contractual_installment_number')::integer;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'INVALID_INSTALLMENTS';
      end;
    else
      v_contractual_number := v_installment_number;
    end if;
    if v_contractual_number < 1
       or (v_previous_contractual_number is not null and v_contractual_number <= v_previous_contractual_number) then
      raise exception 'INVALID_INSTALLMENTS';
    end if;
    v_previous_contractual_number := v_contractual_number;
    v_max_contractual_number := greatest(v_max_contractual_number, v_contractual_number);

    v_row_role := coalesce(nullif(v_elem->>'row_role', ''), 'installment');
    if v_row_role not in ('down_payment', 'installment', 'unknown') then
      raise exception 'INVALID_INSTALLMENTS';
    end if;
    if v_row_role = 'down_payment' then
      v_down_payment_count := v_down_payment_count + 1;
      v_down_payment_number := v_contractual_number;
    end if;

    v_expected_amount := null;
    v_expected_principal := null;
    v_expected_interest := null;
    v_expected_fees := null;
    v_expected_insurance := null;
    v_expected_taxes := null;
    v_reported_balance := null;
    for v_field in select unnest(array['expected_amount', 'expected_principal', 'expected_interest', 'expected_fees', 'expected_insurance', 'expected_taxes', 'reported_balance']) loop
      if v_elem ? v_field and v_elem->v_field <> 'null'::jsonb then
        if pg_catalog.jsonb_typeof(v_elem->v_field) <> 'number' then raise exception 'INVALID_INSTALLMENTS'; end if;
        begin
          v_numeric_value := (v_elem->>v_field)::numeric;
        exception when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'INVALID_INSTALLMENTS';
        end;
        if v_numeric_value < 0 or (v_field = 'expected_amount' and v_numeric_value <= 0) then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
      else
        v_numeric_value := null;
      end if;
      case v_field
        when 'expected_amount' then v_expected_amount := v_numeric_value;
        when 'expected_principal' then v_expected_principal := v_numeric_value;
        when 'expected_interest' then v_expected_interest := v_numeric_value;
        when 'expected_fees' then v_expected_fees := v_numeric_value;
        when 'expected_insurance' then v_expected_insurance := v_numeric_value;
        when 'expected_taxes' then v_expected_taxes := v_numeric_value;
        when 'reported_balance' then v_reported_balance := v_numeric_value;
      end case;
    end loop;

    v_source_row_number := null;
    if pg_catalog.jsonb_typeof(v_elem->'evidence') = 'object'
       and (v_elem->'evidence' ? 'sourceRowNumber')
       and (v_elem->'evidence'->'sourceRowNumber') <> 'null'::jsonb
       and pg_catalog.jsonb_typeof(v_elem->'evidence'->'sourceRowNumber') = 'number'
       and v_elem->'evidence'->>'sourceRowNumber' ~ '^[1-9][0-9]*$' then
      begin
        v_source_row_number := (v_elem->'evidence'->>'sourceRowNumber')::integer;
      exception when invalid_text_representation or numeric_value_out_of_range then
        v_source_row_number := null;
      end;
    end if;

    v_sanitized_installments := v_sanitized_installments || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'installment_number', v_installment_number,
        'contractual_installment_number', v_contractual_number,
        'due_date', v_due_date,
        'expected_amount', v_expected_amount,
        'expected_principal', v_expected_principal,
        'expected_interest', v_expected_interest,
        'expected_fees', v_expected_fees,
        'expected_insurance', v_expected_insurance,
        'expected_taxes', v_expected_taxes,
        'reported_balance', v_reported_balance,
        'row_role', v_row_role,
        'phase', null,
        'evidence', pg_catalog.jsonb_build_object('sourceRowNumber', v_source_row_number)
      )
    );
  end loop;

  if p_last_paid_installment >= v_max_contractual_number
     and p_onboarding_mode = 'EXISTING_DEBT' then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  if v_history_mode = 'DOWN_PAYMENT_ONLY' then
    if p_onboarding_mode <> 'EXISTING_DEBT'
       or p_last_paid_installment <> 1
       or v_down_payment_count <> 1
       or v_down_payment_number <> 1 then
      raise exception 'INVALID_DEBT_INPUT';
    end if;
  elsif v_history_mode = 'CONSECUTIVE_FULLY_PAID' then
    if p_onboarding_mode <> 'EXISTING_DEBT' or p_last_paid_installment < 1 then
      raise exception 'INVALID_DEBT_INPUT';
    end if;
    for v_installment_number in 1..p_last_paid_installment loop
      if not exists (
        select 1
          from pg_catalog.jsonb_array_elements(v_sanitized_installments) as item(value)
         where (item.value->>'contractual_installment_number')::integer = v_installment_number
      ) then
        raise exception 'INVALID_DEBT_INPUT';
      end if;
    end loop;
  end if;

  v_contract := pg_catalog.jsonb_build_object(
    'contract_authority', p_contract->'contract_authority',
    'principal_basis', p_contract->'principal_basis',
    'asset_price', p_contract->'asset_price',
    'down_payment_amount', p_contract->'down_payment_amount',
    'scheduled_principal_amount', p_contract->'scheduled_principal_amount',
    'financed_principal_amount', p_contract->'financed_principal_amount',
    'opening_principal_amount', p_opening_principal_balance,
    'repayment_structure', 'fixed_schedule',
    'amortization_method', p_contract->'amortization_method',
    'installment_amount_mode', p_contract->'installment_amount_mode',
    'payment_frequency', p_contract->'payment_frequency',
    'custom_frequency_days', p_contract->'custom_frequency_days',
    'first_due_date', p_contract->'first_due_date',
    'interest_rate_type', p_contract->'interest_rate_type',
    'interest_rate_percent', p_contract->'interest_rate_percent',
    'interest_rate_basis', p_contract->'interest_rate_basis',
    'day_count_basis', p_contract->'day_count_basis',
    'fee_rule_type', p_contract->'fee_rule_type',
    'fee_rule', case when pg_catalog.jsonb_typeof(p_contract->'fee_rule') = 'object' then p_contract->'fee_rule' else '{}'::jsonb end,
    'prepayment_terms', case when pg_catalog.jsonb_typeof(p_contract->'prepayment_terms') = 'object' then p_contract->'prepayment_terms' else '{}'::jsonb end,
    'authority_notes', case when p_document_authority = 'official_noncontractual' then 'Documento oficial no contractual importado y confirmado por el usuario.' else 'Documento importado y confirmado por el usuario.' end
  );

  v_fingerprint := pg_catalog.jsonb_build_object(
    'onboardingMode', p_onboarding_mode,
    'historyMode', v_history_mode,
    'name', pg_catalog.btrim(p_name),
    'creditorName', pg_catalog.btrim(p_creditor_name),
    'debtKind', p_debt_kind,
    'currencyCode', p_currency_code,
    'originDate', p_origin_date,
    'trackingStartDate', p_tracking_start_date,
    'originalPrincipal', p_original_principal,
    'openingPrincipalBalance', p_opening_principal_balance,
    'plannedInstallmentCount', p_planned_installment_count,
    'plannedInstallmentAmount', p_planned_installment_amount,
    'installmentAmountMode', p_installment_amount_mode,
    'paymentFrequency', p_payment_frequency,
    'customFrequencyDays', p_custom_frequency_days,
    'firstDueDate', p_first_due_date,
    'teaPercent', p_tea_percent,
    'tceaPercent', p_tcea_percent,
    'notes', coalesce(p_notes, ''),
    'repaymentStructure', p_repayment_structure,
    'interestCalculationMode', p_interest_calculation_mode,
    'periodicRatePercent', p_periodic_rate_percent,
    'periodicRateBasis', p_periodic_rate_basis,
    'contract', v_contract,
    'scheduleSource', p_schedule_source,
    'scheduleAuthority', p_schedule_authority,
    'lastPaidInstallment', p_last_paid_installment,
    'documentKind', p_document_kind,
    'documentAuthority', p_document_authority,
    'authorityEvidence', v_safe_authority_evidence,
    'schedule', v_sanitized_installments
  );

  select d.* into v_existing
    from public.debts as d
   where d.id = p_debt_id
   for update;
  if found then
    select j.normalized_metadata->'onboardingFingerprint'
      into v_existing_fingerprint
      from public.bank_document_import_jobs as j
     where j.household_id = p_household_id
       and j.document_schema = 'CAJA_FAMILIAR_DEBT_DOCUMENT_V2'
       and j.normalized_metadata->>'onboardingDebtId' = p_debt_id::text
     order by j.created_at desc
     limit 1;
    if v_existing.household_id is distinct from p_household_id
       or v_existing_fingerprint is null
       or v_existing_fingerprint is distinct from v_fingerprint then
      raise exception 'DEBT_DOCUMENT_ONBOARDING_ID_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object('success', true, 'idempotentReplay', true, 'debtId', p_debt_id);
  end if;

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
    v_sanitized_installments,
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

  perform private.debt2b2_apply_universal_schedule_metadata(v_schedule.id, p_debt_id, p_household_id, v_sanitized_installments);

  for v_elem in select value from pg_catalog.jsonb_array_elements(v_sanitized_installments) loop
    v_contractual_number := (v_elem->>'contractual_installment_number')::integer;
    update public.debt_installments
       set contractual_installment_number = v_contractual_number,
           is_paid_before_tracking = (v_history_mode <> 'NO_ROWS_PAID' and v_contractual_number <= p_last_paid_installment)
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

  v_metadata := pg_catalog.jsonb_build_object(
    'schema', 'CAJA_FAMILIAR_DEBT_DOCUMENT_V2',
    'source', 'document_first_onboarding_v1',
    'authority', p_document_authority,
    'authorityEvidence', v_safe_authority_evidence,
    'isAuthoritative', (p_document_authority = 'contractual'),
    'rowCount', pg_catalog.jsonb_array_length(v_sanitized_installments),
    'onboardingDebtId', p_debt_id::text,
    'onboardingMode', p_onboarding_mode,
    'historyMode', v_history_mode,
    'lastPaidInstallment', p_last_paid_installment,
    'reconciliationStatus', case
      when p_normalized_metadata->'reconciliation'->>'status' in ('exact', 'within_tolerance', 'inconsistent', 'insufficient_data') then p_normalized_metadata->'reconciliation'->>'status'
      else 'unknown'
    end,
    'principalSemantics', pg_catalog.jsonb_build_object(
      'assetPrice', p_contract->'asset_price',
      'downPaymentAmount', p_contract->'down_payment_amount',
      'financedPrincipalAmount', p_contract->'financed_principal_amount',
      'scheduledPrincipalAmount', p_contract->'scheduled_principal_amount',
      'principalBasis', p_contract->'principal_basis'
    ),
    'warningsCount', case
      when pg_catalog.jsonb_typeof(p_normalized_metadata->'warnings') = 'array' then pg_catalog.jsonb_array_length(p_normalized_metadata->'warnings')
      else 0
    end,
    'onboardingFingerprint', v_fingerprint
  );

  perform public.upsert_debt_financing_contract_v1(p_household_id, p_debt_id, v_contract);

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

revoke all privileges on function public.create_debt_from_document_v1(uuid, uuid, text, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, jsonb, text, text, numeric, text, jsonb, text, text, integer, text, text, text, jsonb, text) from public, anon, service_role;
grant execute on function public.create_debt_from_document_v1(uuid, uuid, text, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, jsonb, text, text, numeric, text, jsonb, text, text, integer, text, text, text, jsonb, text) to authenticated;

comment on function public.create_debt_from_document_v1(uuid, uuid, text, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, jsonb, text, text, numeric, text, jsonb, text, text, integer, text, text, text, jsonb, text) is
  'Document-first onboarding V1. Atomically creates one generic fixed-schedule debt + universal financing contract + initial schedule provenance/metadata + sanitized V2 document audit. No cash movement or historical payment event is generated. History is explicitly NONE, DOWN_PAYMENT_ONLY, or CONSECUTIVE_FULLY_PAID; retries compare a canonical full fingerprint.';
