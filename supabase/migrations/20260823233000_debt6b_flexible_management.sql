-- DEBT-6B Flexible Debt Management, Progress & Assisted Interest Foundation
-- Schema expansion & RPC updates for flexible repayment structures and interest terms.

-- ============================================================
-- 1. COLUMNAS & CHECKS EN PUBLIC.DEBTS
-- ============================================================

alter table public.debts
  add column if not exists repayment_structure text not null default 'unknown',
  add column if not exists interest_calculation_mode text not null default 'unknown',
  add column if not exists periodic_rate_percent numeric null,
  add column if not exists periodic_rate_basis text null;

alter table public.debts
  drop constraint if exists debts_repayment_structure_check,
  add constraint debts_repayment_structure_check
    check (repayment_structure in ('fixed_schedule', 'open_ended', 'unknown'));

alter table public.debts
  drop constraint if exists debts_interest_calculation_mode_check,
  add constraint debts_interest_calculation_mode_check
    check (interest_calculation_mode in ('contract_schedule', 'contract_periodic_rate', 'tea_estimate', 'manual', 'unknown'));

alter table public.debts
  drop constraint if exists debts_periodic_rate_percent_positive_check,
  add constraint debts_periodic_rate_percent_positive_check
    check (periodic_rate_percent is null or periodic_rate_percent >= 0);

alter table public.debts
  drop constraint if exists debts_periodic_rate_basis_check,
  add constraint debts_periodic_rate_basis_check
    check (periodic_rate_basis is null or periodic_rate_basis in ('monthly', 'biweekly', 'weekly', 'daily'));

alter table public.debts
  drop constraint if exists debts_mode_rate_coherence_check,
  add constraint debts_mode_rate_coherence_check
    check (
      (interest_calculation_mode <> 'contract_periodic_rate' or (periodic_rate_percent is not null and periodic_rate_percent > 0 and periodic_rate_basis is not null))
      and
      (interest_calculation_mode <> 'tea_estimate' or (tea_percent is not null and tea_percent > 0))
    );

-- ============================================================
-- 2. CREATE_DEBT_V1 (EXTENDED 25-ARGUMENT IMPLEMENTATION)
-- ============================================================

create or replace function public.create_debt_v1(
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
  p_installments jsonb,
  p_collaterals jsonb,
  p_repayment_structure text,
  p_interest_calculation_mode text,
  p_periodic_rate_percent numeric,
  p_periodic_rate_basis text
)
returns pg_catalog.jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_debt public.debts%rowtype;
  v_schedule public.debt_schedule_versions%rowtype;
  v_installment public.debt_installments%rowtype;
  v_collateral public.debt_collaterals%rowtype;
  v_elem jsonb;
  v_installment_no integer;
  v_due_date date;
  v_expected_amount numeric;
  v_expected_principal numeric;
  v_expected_interest numeric;
  v_expected_fees numeric;
  v_expected_insurance numeric;
  v_installments_json jsonb := '[]'::jsonb;
  v_collaterals_json jsonb := '[]'::jsonb;
  v_repayment_structure text := coalesce(p_repayment_structure, 'unknown');
  v_interest_calc_mode text := coalesce(p_interest_calculation_mode, 'unknown');
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

  if exists (
    select 1
      from public.debts as d
     where d.id = p_debt_id
  ) then
    raise exception 'DEBT_ALREADY_EXISTS';
  end if;

  if p_name is null or pg_catalog.btrim(p_name) = ''
     or p_creditor_name is null or pg_catalog.btrim(p_creditor_name) = ''
     or p_tracking_start_date is null
     or p_opening_principal_balance is null or p_opening_principal_balance <= 0 then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  if p_currency_code is not null and p_currency_code !~ '^[A-Z]{3}$' then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  if v_repayment_structure not in ('fixed_schedule', 'open_ended', 'unknown') then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  if v_interest_calc_mode not in ('contract_schedule', 'contract_periodic_rate', 'tea_estimate', 'manual', 'unknown') then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  if v_interest_calc_mode = 'contract_periodic_rate' and (p_periodic_rate_percent is null or p_periodic_rate_percent <= 0 or p_periodic_rate_basis is null) then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  if v_interest_calc_mode = 'tea_estimate' and (p_tea_percent is null or p_tea_percent <= 0) then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  if p_periodic_rate_basis is not null and p_periodic_rate_basis not in ('monthly', 'biweekly', 'weekly', 'daily') then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  if p_periodic_rate_percent is not null and p_periodic_rate_percent < 0 then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  begin
    insert into public.debts (
      id, household_id, name, creditor_name, debt_kind, currency_code,
      origin_date, tracking_start_date, original_principal, opening_principal_balance,
      planned_installment_count, planned_installment_amount, installment_amount_mode,
      payment_frequency, custom_frequency_days, first_due_date, tea_percent, tcea_percent,
      notes, status, is_archived, created_by_user_id,
      repayment_structure, interest_calculation_mode, periodic_rate_percent, periodic_rate_basis
    ) values (
      p_debt_id, p_household_id, pg_catalog.btrim(p_name), pg_catalog.btrim(p_creditor_name),
      p_debt_kind, coalesce(p_currency_code, 'PEN'),
      p_origin_date, p_tracking_start_date, p_original_principal, p_opening_principal_balance,
      p_planned_installment_count, p_planned_installment_amount,
      coalesce(p_installment_amount_mode, 'unknown'),
      p_payment_frequency, p_custom_frequency_days, p_first_due_date,
      p_tea_percent, p_tcea_percent, coalesce(p_notes, ''),
      'active', false, v_user_id,
      v_repayment_structure, v_interest_calc_mode, p_periodic_rate_percent, p_periodic_rate_basis
    ) returning * into v_debt;
  exception
    when check_violation or foreign_key_violation or not_null_violation or numeric_value_out_of_range then
      raise exception 'INVALID_DEBT_INPUT';
  end;

  -- B-1) Cronograma inicial
  if p_installments is not null
     and pg_catalog.jsonb_typeof(p_installments) = 'array'
     and pg_catalog.jsonb_array_length(p_installments) > 0 then

    begin
      insert into public.debt_schedule_versions (
        debt_id, household_id, version_number, effective_date, reason,
        notes, created_by_user_id
      ) values (
        p_debt_id, p_household_id, 1, p_tracking_start_date, 'initial',
        'Versión inicial del cronograma', v_user_id
      ) returning * into v_schedule;
    exception
      when check_violation or foreign_key_violation or not_null_violation then
        raise exception 'INVALID_INSTALLMENTS';
    end;

    for v_elem in select * from pg_catalog.jsonb_array_elements(p_installments) loop
      if pg_catalog.jsonb_typeof(v_elem) <> 'object' then
        raise exception 'INVALID_INSTALLMENTS';
      end if;

      if not (v_elem ? 'installment_number') or not (v_elem ? 'due_date') then
        raise exception 'INVALID_INSTALLMENTS';
      end if;

      begin
        v_installment_no := (v_elem->>'installment_number')::pg_catalog.integer;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'INVALID_INSTALLMENTS';
      end;
      if v_installment_no < 1 then
        raise exception 'INVALID_INSTALLMENTS';
      end if;

      if v_elem->>'due_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'INVALID_INSTALLMENTS';
      end if;
      begin
        v_due_date := (v_elem->>'due_date')::pg_catalog.date;
      exception
        when invalid_text_representation or datetime_field_overflow then
          raise exception 'INVALID_INSTALLMENTS';
      end;

      v_expected_amount := null;
      if v_elem ? 'expected_amount' and v_elem->'expected_amount' <> 'null'::pg_catalog.jsonb then
        if pg_catalog.jsonb_typeof(v_elem->'expected_amount') <> 'number' then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
        v_expected_amount := (v_elem->>'expected_amount')::pg_catalog.numeric;
        if v_expected_amount <= 0 then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
      end if;

      v_expected_principal := null;
      if v_elem ? 'expected_principal' and v_elem->'expected_principal' <> 'null'::pg_catalog.jsonb then
        if pg_catalog.jsonb_typeof(v_elem->'expected_principal') <> 'number' then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
        v_expected_principal := (v_elem->>'expected_principal')::pg_catalog.numeric;
        if v_expected_principal < 0 then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
      end if;

      v_expected_interest := null;
      if v_elem ? 'expected_interest' and v_elem->'expected_interest' <> 'null'::pg_catalog.jsonb then
        if pg_catalog.jsonb_typeof(v_elem->'expected_interest') <> 'number' then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
        v_expected_interest := (v_elem->>'expected_interest')::pg_catalog.numeric;
        if v_expected_interest < 0 then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
      end if;

      v_expected_fees := null;
      if v_elem ? 'expected_fees' and v_elem->'expected_fees' <> 'null'::pg_catalog.jsonb then
        if pg_catalog.jsonb_typeof(v_elem->'expected_fees') <> 'number' then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
        v_expected_fees := (v_elem->>'expected_fees')::pg_catalog.numeric;
        if v_expected_fees < 0 then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
      end if;

      v_expected_insurance := null;
      if v_elem ? 'expected_insurance' and v_elem->'expected_insurance' <> 'null'::pg_catalog.jsonb then
        if pg_catalog.jsonb_typeof(v_elem->'expected_insurance') <> 'number' then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
        v_expected_insurance := (v_elem->>'expected_insurance')::pg_catalog.numeric;
        if v_expected_insurance < 0 then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
      end if;

      if v_expected_amount is not null
         and coalesce(v_expected_principal, 0::pg_catalog.numeric)
             + coalesce(v_expected_interest, 0::pg_catalog.numeric)
             + coalesce(v_expected_fees, 0::pg_catalog.numeric)
             + coalesce(v_expected_insurance, 0::pg_catalog.numeric)
             > v_expected_amount then
        raise exception 'INVALID_INSTALLMENTS';
      end if;

      begin
        insert into public.debt_installments (
          schedule_version_id, debt_id, household_id, installment_number,
          due_date, expected_amount, expected_principal, expected_interest,
          expected_fees, expected_insurance, created_by_user_id
        ) values (
          v_schedule.id, p_debt_id, p_household_id, v_installment_no,
          v_due_date, v_expected_amount, v_expected_principal, v_expected_interest,
          v_expected_fees, v_expected_insurance, v_user_id
        ) returning * into v_installment;
      exception
        when check_violation or foreign_key_violation or unique_violation or numeric_value_out_of_range then
          raise exception 'INVALID_INSTALLMENTS';
      end;

      v_installments_json := v_installments_json || pg_catalog.to_jsonb(v_installment);
    end loop;
  end if;

  -- B-2) Garantías iniciales
  if p_collaterals is not null
     and pg_catalog.jsonb_typeof(p_collaterals) = 'array'
     and pg_catalog.jsonb_array_length(p_collaterals) > 0 then

    for v_elem in select * from pg_catalog.jsonb_array_elements(p_collaterals) loop
      if pg_catalog.jsonb_typeof(v_elem) <> 'object' then
        raise exception 'INVALID_COLLATERALS';
      end if;

      if not (v_elem ? 'description')
         or v_elem->>'description' is null
         or pg_catalog.btrim(v_elem->>'description') = '' then
        raise exception 'INVALID_COLLATERALS';
      end if;

      begin
        insert into public.debt_collaterals (
          debt_id, household_id, description, pledged_value, estimated_value,
          redemption_deadline, status, notes, created_by_user_id
        ) values (
          p_debt_id, p_household_id, pg_catalog.btrim(v_elem->>'description'),
          case when v_elem ? 'pledged_value' and v_elem->'pledged_value' <> 'null'::pg_catalog.jsonb then (v_elem->>'pledged_value')::pg_catalog.numeric else null end,
          case when v_elem ? 'estimated_value' and v_elem->'estimated_value' <> 'null'::pg_catalog.jsonb then (v_elem->>'estimated_value')::pg_catalog.numeric else null end,
          case when v_elem ? 'redemption_deadline' and v_elem->'redemption_deadline' <> 'null'::pg_catalog.jsonb then (v_elem->>'redemption_deadline')::pg_catalog.date else null end,
          'pledged', '', v_user_id
        ) returning * into v_collateral;
      exception
        when check_violation or not_null_violation or numeric_value_out_of_range then
          raise exception 'INVALID_COLLATERALS';
      end;

      v_collaterals_json := v_collaterals_json || pg_catalog.to_jsonb(v_collateral);
    end loop;
  end if;

  return pg_catalog.jsonb_build_object(
    'debt', pg_catalog.to_jsonb(v_debt),
    'scheduleVersion', case when v_schedule.id is null then 'null'::pg_catalog.jsonb else pg_catalog.to_jsonb(v_schedule) end,
    'installments', v_installments_json,
    'collaterals', v_collaterals_json
  );
end;
$function$;

-- ============================================================
-- 2B. CREATE_DEBT_V1 (LEGACY 21-ARGUMENT BACKWARD COMPATIBLE WRAPPER)
-- ============================================================

create or replace function public.create_debt_v1(
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
  p_installments jsonb,
  p_collaterals jsonb
)
returns pg_catalog.jsonb
language sql
security definer
set search_path = ''
as $$
  select public.create_debt_v1(
    p_household_id, p_debt_id, p_name, p_creditor_name, p_debt_kind, p_currency_code,
    p_origin_date, p_tracking_start_date, p_original_principal, p_opening_principal_balance,
    p_planned_installment_count, p_planned_installment_amount, p_installment_amount_mode,
    p_payment_frequency, p_custom_frequency_days, p_first_due_date, p_tea_percent, p_tcea_percent,
    p_notes, p_installments, p_collaterals,
    'unknown', 'unknown', null, null
  );
$$;

-- ============================================================
-- 3. UPDATE_DEBT_TERMS_V1 (SECURE TERMS UPDATE RPC WITH EXPLICIT CLEAR FLAGS)
-- ============================================================

create or replace function public.update_debt_terms_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_repayment_structure text default null,
  p_interest_calculation_mode text default null,
  p_periodic_rate_percent numeric default null,
  p_periodic_rate_basis text default null,
  p_tea_percent numeric default null,
  p_tcea_percent numeric default null,
  p_payment_frequency text default null,
  p_custom_frequency_days integer default null,
  p_clear_periodic_rate boolean default false,
  p_clear_tea boolean default false,
  p_clear_tcea boolean default false,
  p_clear_frequency boolean default false
)
returns pg_catalog.jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_debt public.debts%rowtype;
  v_new_mode text;
  v_new_periodic_percent numeric;
  v_new_periodic_basis text;
  v_new_tea numeric;
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

  select d.*
    into v_debt
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id;

  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;

  if p_repayment_structure is not null and p_repayment_structure not in ('fixed_schedule', 'open_ended', 'unknown') then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  if p_interest_calculation_mode is not null and p_interest_calculation_mode not in ('contract_schedule', 'contract_periodic_rate', 'tea_estimate', 'manual', 'unknown') then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  if p_periodic_rate_percent is not null and p_periodic_rate_percent < 0 then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  if p_periodic_rate_basis is not null and p_periodic_rate_basis not in ('monthly', 'biweekly', 'weekly', 'daily') then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  if p_payment_frequency is not null and p_payment_frequency not in ('monthly', 'biweekly', 'weekly', 'custom') then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  if p_custom_frequency_days is not null and p_custom_frequency_days <= 0 then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  v_new_mode := coalesce(p_interest_calculation_mode, v_debt.interest_calculation_mode);
  v_new_periodic_percent := case
    when coalesce(p_clear_periodic_rate, false) then null
    when p_periodic_rate_percent is not null then p_periodic_rate_percent
    else v_debt.periodic_rate_percent
  end;
  v_new_periodic_basis := case
    when coalesce(p_clear_periodic_rate, false) then null
    when p_periodic_rate_basis is not null then p_periodic_rate_basis
    else v_debt.periodic_rate_basis
  end;
  v_new_tea := case
    when coalesce(p_clear_tea, false) then null
    when p_tea_percent is not null then p_tea_percent
    else v_debt.tea_percent
  end;

  if v_new_mode = 'contract_periodic_rate' and (v_new_periodic_percent is null or v_new_periodic_percent <= 0 or v_new_periodic_basis is null) then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  if v_new_mode = 'tea_estimate' and (v_new_tea is null or v_new_tea <= 0) then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  update public.debts as d
     set repayment_structure = coalesce(p_repayment_structure, d.repayment_structure),
         interest_calculation_mode = v_new_mode,
         periodic_rate_percent = v_new_periodic_percent,
         periodic_rate_basis = v_new_periodic_basis,
         tea_percent = v_new_tea,
         tcea_percent = case
           when coalesce(p_clear_tcea, false) then null
           when p_tcea_percent is not null then p_tcea_percent
           else d.tcea_percent
         end,
         payment_frequency = case
           when coalesce(p_clear_frequency, false) then null
           when p_payment_frequency is not null then p_payment_frequency
           else d.payment_frequency
         end,
         custom_frequency_days = case
           when coalesce(p_clear_frequency, false) then null
           when p_custom_frequency_days is not null then p_custom_frequency_days
           else d.custom_frequency_days
         end,
         updated_at = now()
   where d.id = p_debt_id
     and d.household_id = p_household_id
   returning * into v_debt;

  return pg_catalog.to_jsonb(v_debt);
end;
$function$;

-- ============================================================
-- 4. PRIVILEGIOS Y SEGURIDAD
-- ============================================================

-- Revoke & Grant for legacy 21-argument create_debt_v1
revoke all privileges on function public.create_debt_v1(uuid, uuid, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, jsonb, jsonb)
  from public, anon, service_role;

grant execute on function public.create_debt_v1(uuid, uuid, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, jsonb, jsonb)
  to authenticated;

-- Revoke & Grant for extended 25-argument create_debt_v1
revoke all privileges on function public.create_debt_v1(uuid, uuid, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, jsonb, jsonb, text, text, numeric, text)
  from public, anon, service_role;

grant execute on function public.create_debt_v1(uuid, uuid, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, jsonb, jsonb, text, text, numeric, text)
  to authenticated;

-- Revoke & Grant for update_debt_terms_v1
revoke all privileges on function public.update_debt_terms_v1(uuid, uuid, text, text, numeric, text, numeric, numeric, text, integer, boolean, boolean, boolean, boolean)
  from public, anon, service_role;

grant execute on function public.update_debt_terms_v1(uuid, uuid, text, text, numeric, text, numeric, numeric, text, integer, boolean, boolean, boolean, boolean)
  to authenticated;

comment on function public.update_debt_terms_v1(uuid, uuid, text, text, numeric, text, numeric, numeric, text, integer, boolean, boolean, boolean, boolean) is
  'DEBT-6B: Permite actualizar o limpiar los términos financieros y estructura de pago de una deuda activa (repayment_structure, interest_calculation_mode, periodic_rate_percent, periodic_rate_basis, tea_percent, tcea_percent, payment_frequency, custom_frequency_days).';
