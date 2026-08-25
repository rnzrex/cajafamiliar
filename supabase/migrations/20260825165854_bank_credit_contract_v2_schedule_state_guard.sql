-- BANK CREDIT CONTRACT V2: schedule state guards after payment/prepayment.
-- Existing BANK V2 migrations remain immutable. The V3 payment RPC is replaced
-- here so the server rejects a bank fixed-schedule contract with an ambiguous
-- future schedule, while legacy prepayment callers keep using V2 unchanged.

create or replace function public.record_debt_payment_v3(
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
  p_allocations jsonb,
  p_schedule_installments jsonb,
  p_schedule_notes text,
  p_schedule_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
  v_schedule public.debt_schedule_versions%rowtype;
  v_extra numeric := coalesce(p_extra_principal_amount, 0);
  v_schedule_count integer;
  v_is_replay boolean;
  v_debt_kind text;
  v_repayment_structure text;
begin
  v_schedule_count := case
    when p_schedule_installments is null then -1
    when pg_catalog.jsonb_typeof(p_schedule_installments) <> 'array' then -1
    else pg_catalog.jsonb_array_length(p_schedule_installments)
  end;

  if p_schedule_installments is null
     or v_schedule_count < 0
     or (v_schedule_count = 0 and (p_schedule_source is not null or coalesce(pg_catalog.btrim(p_schedule_notes), '') <> ''))
     or (v_schedule_count > 0 and p_schedule_source not in ('contractual', 'estimated'))
     or v_extra < 0
     or (v_extra > 0 and p_prepayment_effect is null)
     or (v_extra = 0 and p_prepayment_effect is not null)
     or (p_prepayment_effect = 'pending_bank_schedule' and (v_extra <= 0 or v_schedule_count > 0))
     or (v_schedule_count > 0 and p_prepayment_effect = 'pending_bank_schedule') then
    raise exception 'INVALID_DEBT_PAYMENT';
  end if;

  -- Lock the debt before validating the contract state. The delegated V2 RPC
  -- uses the same transaction, so the guard and financial event are atomic.
  select d.debt_kind, d.repayment_structure
    into v_debt_kind, v_repayment_structure
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id
   for update;

  if v_debt_kind = 'bank_loan' and v_repayment_structure = 'fixed_schedule'
     and v_extra > 0
     and v_schedule_count = 0
     and p_prepayment_effect is distinct from 'pending_bank_schedule' then
    raise exception 'INVALID_DEBT_PAYMENT';
  end if;

  if v_schedule_count > 0 or p_prepayment_effect = 'pending_bank_schedule' then
    if v_debt_kind is not null and v_debt_kind <> 'bank_loan' then
      raise exception 'DEBT_NOT_BANK_LOAN';
    end if;
  end if;

  if v_schedule_count > 0 then
    perform private.debt2b2_validate_schedule_v3(
      p_event_date,
      'prepayment',
      p_schedule_installments
    );
  end if;

  v_result := public.record_debt_payment_v2(
    p_household_id,
    p_debt_id,
    p_event_id,
    p_movement_id,
    p_event_date,
    p_cash_amount,
    p_account_id,
    p_description,
    p_category,
    p_principal_amount,
    p_interest_paid,
    p_fees_paid,
    p_insurance_paid,
    p_other_cost_paid,
    p_extra_principal_amount,
    p_prepayment_effect,
    p_breakdown_complete,
    p_allocations
  );

  v_is_replay := coalesce((v_result->>'idempotentReplay')::boolean, false);

  if v_is_replay then
    select s.* into v_schedule
      from public.debt_schedule_versions as s
     where s.trigger_event_id = p_event_id
       and s.debt_id = p_debt_id
       and s.household_id = p_household_id
     order by s.version_number desc
     limit 1;

    if v_schedule_count = 0 then
      if v_schedule.id is not null then
        raise exception 'DEBT_EVENT_ID_CONFLICT';
      end if;
    elsif v_schedule.id is null
       or private.debt2b2_canonical_schedule(p_schedule_installments)
            is distinct from private.debt2b2_persisted_schedule(v_schedule.id)
       or v_schedule.notes is distinct from coalesce(p_schedule_notes, '')
       or v_schedule.schedule_source is distinct from p_schedule_source then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;

    return v_result;
  end if;

  if v_schedule_count > 0 then
    if v_result->'debt'->>'status' <> 'active' then
      raise exception 'INVALID_DEBT_SCHEDULE';
    end if;

    perform private.debt2b2_create_schedule_v3(
      p_household_id,
      p_debt_id,
      p_event_id,
      p_event_date,
      'prepayment',
      p_schedule_notes,
      p_schedule_installments,
      v_user_id,
      p_schedule_source
    );

    return private.debt2b2_fund_result(p_event_id, false);
  end if;

  return v_result;
end;
$function$;

revoke all privileges on function public.record_debt_payment_v3(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, boolean, jsonb, jsonb, text, text)
  from public, anon, service_role;
grant execute on function public.record_debt_payment_v3(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, boolean, jsonb, jsonb, text, text)
  to authenticated;

-- V3 is the bank-aware prepayment boundary. Non-bank debts deliberately keep
-- the exact V2 behavior, while bank fixed schedules must either carry a full
-- new schedule or explicitly enter pending_bank_schedule.
create or replace function public.record_debt_prepayment_v3(
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
  p_prepayment_effect text,
  p_breakdown_complete boolean,
  p_schedule_installments jsonb,
  p_schedule_notes text,
  p_schedule_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_schedule_count integer;
  v_debt_kind text;
  v_repayment_structure text;
begin
  v_schedule_count := case
    when p_schedule_installments is null then -1
    when pg_catalog.jsonb_typeof(p_schedule_installments) <> 'array' then -1
    else pg_catalog.jsonb_array_length(p_schedule_installments)
  end;

  select d.debt_kind, d.repayment_structure
    into v_debt_kind, v_repayment_structure
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id
   for update;

  if v_debt_kind = 'bank_loan' and v_repayment_structure = 'fixed_schedule' then
    if v_schedule_count < 0
       or (v_schedule_count = 0 and p_prepayment_effect is distinct from 'pending_bank_schedule')
       or (v_schedule_count = 0 and (p_schedule_source is not null or coalesce(pg_catalog.btrim(p_schedule_notes), '') <> ''))
       or (v_schedule_count > 0 and p_prepayment_effect = 'pending_bank_schedule')
       or (v_schedule_count > 0 and p_schedule_source not in ('contractual', 'estimated')) then
      raise exception 'INVALID_DEBT_PREPAYMENT';
    end if;

    if v_schedule_count > 0 then
      perform private.debt2b2_validate_schedule_v3(
        p_event_date,
        'prepayment',
        p_schedule_installments
      );
    end if;
  end if;

  -- V2 remains the persistence implementation for legacy and non-bank debt;
  -- this call is still inside the same RPC transaction as the guard above.
  v_result := public.record_debt_prepayment_v2(
    p_household_id,
    p_debt_id,
    p_event_id,
    p_movement_id,
    p_event_date,
    p_cash_amount,
    p_account_id,
    p_description,
    p_category,
    p_principal_amount,
    p_interest_paid,
    p_fees_paid,
    p_insurance_paid,
    p_other_cost_paid,
    p_prepayment_effect,
    p_breakdown_complete,
    p_schedule_installments,
    p_schedule_notes,
    p_schedule_source
  );

  return v_result;
end;
$function$;

revoke all privileges on function public.record_debt_prepayment_v3(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, text, boolean, jsonb, text, text)
  from public, anon, service_role;
grant execute on function public.record_debt_prepayment_v3(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, text, boolean, jsonb, text, text)
  to authenticated;
