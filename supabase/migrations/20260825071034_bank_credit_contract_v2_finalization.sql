-- BANK CREDIT CONTRACT V2: Audit Fix 3 / finalization
-- This migration adds only versioned, append-only lifecycle operations. The
-- historical BANK V2 and Audit Fix 2 migrations remain immutable.

-- Strict validator for schedules introduced by the finalization RPCs. BANK
-- schedules are complete rows: an amount and every known cost component must
-- be present, non-negative, and reconcile within one cent.
create or replace function private.debt2b2_validate_schedule_v3(
  p_event_date date,
  p_reason text,
  p_schedule_installments jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_elem jsonb;
  v_count integer;
  v_installment_number integer;
  v_previous_number integer;
  v_due_date date;
  v_previous_due_date date;
  v_expected_amount numeric;
  v_expected_principal numeric;
  v_expected_interest numeric;
  v_expected_fees numeric;
  v_expected_insurance numeric;
begin
  if p_event_date is null
     or p_reason not in ('prepayment', 'rate_change', 'manual_adjustment', 'reversal')
     or p_schedule_installments is null
     or pg_catalog.jsonb_typeof(p_schedule_installments) <> 'array'
     or pg_catalog.jsonb_array_length(p_schedule_installments) = 0 then
    raise exception 'INVALID_DEBT_SCHEDULE';
  end if;

  v_count := pg_catalog.jsonb_array_length(p_schedule_installments);

  for v_elem in
    select e.value
      from pg_catalog.jsonb_array_elements(p_schedule_installments) as e
  loop
    if pg_catalog.jsonb_typeof(v_elem) <> 'object'
       or not (v_elem ? 'installment_number')
       or v_elem->'installment_number' = 'null'::pg_catalog.jsonb
       or not (v_elem ? 'due_date')
       or v_elem->'due_date' = 'null'::pg_catalog.jsonb
       or not (v_elem ? 'expected_amount')
       or v_elem->'expected_amount' = 'null'::pg_catalog.jsonb
       or not (v_elem ? 'expected_principal')
       or v_elem->'expected_principal' = 'null'::pg_catalog.jsonb
       or not (v_elem ? 'expected_interest')
       or v_elem->'expected_interest' = 'null'::pg_catalog.jsonb
       or not (v_elem ? 'expected_fees')
       or v_elem->'expected_fees' = 'null'::pg_catalog.jsonb
       or not (v_elem ? 'expected_insurance')
       or v_elem->'expected_insurance' = 'null'::pg_catalog.jsonb
       or pg_catalog.jsonb_typeof(v_elem->'expected_amount') <> 'number'
       or pg_catalog.jsonb_typeof(v_elem->'expected_principal') <> 'number'
       or pg_catalog.jsonb_typeof(v_elem->'expected_interest') <> 'number'
       or pg_catalog.jsonb_typeof(v_elem->'expected_fees') <> 'number'
       or pg_catalog.jsonb_typeof(v_elem->'expected_insurance') <> 'number' then
      raise exception 'INVALID_DEBT_SCHEDULE';
    end if;

    if v_elem->>'installment_number' !~ '^[0-9]+$'
       or v_elem->>'due_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'INVALID_DEBT_SCHEDULE';
    end if;

    begin
      v_installment_number := (v_elem->>'installment_number')::integer;
      v_due_date := (v_elem->>'due_date')::date;
      v_expected_amount := (v_elem->>'expected_amount')::numeric;
      v_expected_principal := (v_elem->>'expected_principal')::numeric;
      v_expected_interest := (v_elem->>'expected_interest')::numeric;
      v_expected_fees := (v_elem->>'expected_fees')::numeric;
      v_expected_insurance := (v_elem->>'expected_insurance')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
        raise exception 'INVALID_DEBT_SCHEDULE';
    end;

    if v_installment_number < 1
       or (v_previous_number is not null and v_installment_number <> v_previous_number + 1)
       or v_due_date <= p_event_date
       or (v_previous_due_date is not null and v_due_date <= v_previous_due_date)
       or v_expected_amount <= 0
       or v_expected_principal < 0
       or v_expected_interest < 0
       or v_expected_fees < 0
       or v_expected_insurance < 0
       or pg_catalog.abs(
            pg_catalog.round(
              v_expected_principal + v_expected_interest + v_expected_fees + v_expected_insurance,
              2
            ) - pg_catalog.round(v_expected_amount, 2)
          ) > 0.01 then
      raise exception 'INVALID_DEBT_SCHEDULE';
    end if;

    v_previous_number := v_installment_number;
    v_previous_due_date := v_due_date;
  end loop;

  if v_previous_number <> v_count then
    raise exception 'INVALID_DEBT_SCHEDULE';
  end if;
end;
$function$;

revoke all privileges on function private.debt2b2_validate_schedule_v3(date, text, jsonb)
  from public, anon, authenticated, service_role;

-- Schedule versions are append-only. The debt row is locked by every public
-- caller before this helper is reached, so MAX(version_number)+1 is serialized.
create or replace function private.debt2b2_create_schedule_v3(
  p_household_id uuid,
  p_debt_id uuid,
  p_trigger_event_id uuid,
  p_event_date date,
  p_reason text,
  p_notes text,
  p_schedule_installments jsonb,
  p_user_id uuid,
  p_schedule_source text
)
returns public.debt_schedule_versions
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_schedule public.debt_schedule_versions%rowtype;
  v_authoritative boolean;
begin
  if p_household_id is null
     or p_debt_id is null
     or p_trigger_event_id is null
     or p_user_id is null
     or p_schedule_source not in ('contractual', 'estimated') then
    raise exception 'INVALID_DEBT_SCHEDULE';
  end if;

  perform private.debt2b2_validate_schedule_v3(
    p_event_date,
    p_reason,
    p_schedule_installments
  );

  v_authoritative := p_schedule_source = 'contractual';

  insert into public.debt_schedule_versions (
    debt_id,
    household_id,
    version_number,
    effective_date,
    reason,
    schedule_source,
    is_authoritative,
    trigger_event_id,
    notes,
    created_by_user_id
  )
  select
    p_debt_id,
    p_household_id,
    coalesce(pg_catalog.max(s.version_number), 0) + 1,
    p_event_date,
    p_reason,
    p_schedule_source,
    v_authoritative,
    p_trigger_event_id,
    coalesce(p_notes, ''),
    p_user_id
    from public.debt_schedule_versions as s
   where s.debt_id = p_debt_id
     and s.household_id = p_household_id
  returning * into v_schedule;

  insert into public.debt_installments (
    schedule_version_id,
    debt_id,
    household_id,
    installment_number,
    due_date,
    expected_amount,
    expected_principal,
    expected_interest,
    expected_fees,
    expected_insurance,
    created_by_user_id
  )
  select
    v_schedule.id,
    p_debt_id,
    p_household_id,
    (e.value->>'installment_number')::integer,
    (e.value->>'due_date')::date,
    (e.value->>'expected_amount')::numeric,
    (e.value->>'expected_principal')::numeric,
    (e.value->>'expected_interest')::numeric,
    (e.value->>'expected_fees')::numeric,
    (e.value->>'expected_insurance')::numeric,
    p_user_id
    from pg_catalog.jsonb_array_elements(p_schedule_installments) as e;

  return v_schedule;
end;
$function$;

revoke all privileges on function private.debt2b2_create_schedule_v3(uuid, uuid, uuid, date, text, text, jsonb, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function private.debt2b2_schedule_result(
  p_event_id uuid,
  p_idempotent_replay boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_event public.debt_events%rowtype;
  v_debt public.debts%rowtype;
  v_schedule public.debt_schedule_versions%rowtype;
  v_installments jsonb := '[]'::jsonb;
begin
  select e.* into v_event
    from public.debt_events as e
   where e.id = p_event_id;
  if not found then
    raise exception 'DEBT_EVENT_NOT_FOUND';
  end if;

  select d.* into v_debt
    from public.debts as d
   where d.id = v_event.debt_id
     and d.household_id = v_event.household_id;

  select s.* into v_schedule
    from public.debt_schedule_versions as s
   where s.trigger_event_id = v_event.id
     and s.debt_id = v_event.debt_id
     and s.household_id = v_event.household_id
   order by s.version_number desc
   limit 1;

  if v_schedule.id is null then
    raise exception 'DEBT_SCHEDULE_NOT_FOUND';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) order by i.installment_number),
    '[]'::jsonb
  ) into v_installments
    from public.debt_installments as i
   where i.schedule_version_id = v_schedule.id
     and i.debt_id = v_event.debt_id
     and i.household_id = v_event.household_id;

  return pg_catalog.jsonb_build_object(
    'idempotentReplay', p_idempotent_replay,
    'debt', pg_catalog.to_jsonb(v_debt),
    'event', pg_catalog.to_jsonb(v_event),
    'scheduleVersion', pg_catalog.to_jsonb(v_schedule),
    'installments', v_installments
  );
end;
$function$;

revoke all privileges on function private.debt2b2_schedule_result(uuid, boolean)
  from public, anon, authenticated, service_role;

-- Payment V3 preserves V2's one-movement/one-event contract. The optional
-- schedule is created in this same transaction, never through prepayment V2,
-- so a failed schedule cannot leave a financial event behind.
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

  if v_schedule_count > 0 or p_prepayment_effect = 'pending_bank_schedule' then
    select d.debt_kind into v_debt_kind
      from public.debts as d
     where d.id = p_debt_id
       and d.household_id = p_household_id;
    if found and v_debt_kind <> 'bank_loan' then
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

-- Same-debt reprogramming is a non-financial audit event. A refinance/new
-- contract is deliberately not represented by this RPC: it needs a new debt
-- baseline and cannot be faked by changing the current schedule in place.
create or replace function public.update_debt_contractual_schedule_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_event_id uuid,
  p_event_date date,
  p_reason text,
  p_schedule_installments jsonb,
  p_schedule_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_person text;
  v_debt public.debts%rowtype;
  v_existing_event public.debt_events%rowtype;
  v_schedule public.debt_schedule_versions%rowtype;
  v_description text;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select hm.display_name into v_person
    from public.household_members as hm
   where hm.household_id = p_household_id
     and hm.user_id = v_user_id;
  if not found or v_person is null or pg_catalog.btrim(v_person) = '' then
    raise exception 'HOUSEHOLD_ACCESS_DENIED';
  end if;

  if p_household_id is null
     or p_debt_id is null
     or p_event_id is null
     or p_event_date is null
     or p_reason not in ('rate_change', 'manual_adjustment')
     or p_schedule_installments is null
     or pg_catalog.jsonb_typeof(p_schedule_installments) <> 'array'
     or pg_catalog.jsonb_array_length(p_schedule_installments) = 0 then
    raise exception 'INVALID_DEBT_SCHEDULE';
  end if;

  perform private.debt2b2_validate_schedule_v3(
    p_event_date,
    p_reason,
    p_schedule_installments
  );

  perform private.debt2b2_lock_operation(null, p_event_id);

  select d.* into v_debt
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id
   for update;
  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;
  if v_debt.debt_kind <> 'bank_loan' then
    raise exception 'DEBT_NOT_BANK_LOAN';
  end if;
  if v_debt.is_archived then
    raise exception 'DEBT_ARCHIVED';
  end if;
  if v_debt.status <> 'active' then
    raise exception 'DEBT_NOT_ACTIVE';
  end if;

  v_description := 'Actualización de cronograma contractual (' || p_reason || ')';

  select e.* into v_existing_event
    from public.debt_events as e
   where e.id = p_event_id
   for update;

  if found then
    if v_existing_event.household_id is distinct from p_household_id
       or v_existing_event.debt_id is distinct from p_debt_id
       or v_existing_event.event_type is distinct from 'principal_adjustment'
       or v_existing_event.event_date is distinct from p_event_date
       or v_existing_event.cash_amount is distinct from 0::numeric
       or v_existing_event.principal_delta is distinct from 0::numeric
       or v_existing_event.interest_paid is distinct from 0::numeric
       or v_existing_event.fees_paid is distinct from 0::numeric
       or v_existing_event.insurance_paid is distinct from 0::numeric
       or v_existing_event.other_cost_paid is distinct from 0::numeric
       or v_existing_event.breakdown_complete is distinct from false
       or v_existing_event.movement_id is not null
       or v_existing_event.description is distinct from v_description then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;

    select s.* into v_schedule
      from public.debt_schedule_versions as s
     where s.trigger_event_id = p_event_id
       and s.debt_id = p_debt_id
       and s.household_id = p_household_id
     order by s.version_number desc
     limit 1;
    if v_schedule.id is null
       or private.debt2b2_canonical_schedule(p_schedule_installments)
            is distinct from private.debt2b2_persisted_schedule(v_schedule.id)
       or v_schedule.notes is distinct from coalesce(p_schedule_notes, '')
       or v_schedule.schedule_source is distinct from 'contractual'
       or not v_schedule.is_authoritative then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;

    return private.debt2b2_schedule_result(p_event_id, true);
  end if;

  insert into public.debt_events (
    id,
    debt_id,
    household_id,
    event_date,
    event_type,
    cash_amount,
    principal_delta,
    interest_paid,
    fees_paid,
    insurance_paid,
    other_cost_paid,
    breakdown_complete,
    movement_id,
    reversal_of_event_id,
    description,
    registered_by_user_id
  ) values (
    p_event_id,
    p_debt_id,
    p_household_id,
    p_event_date,
    'principal_adjustment',
    0,
    0,
    0,
    0,
    0,
    0,
    false,
    null,
    null,
    v_description,
    v_user_id
  );

  perform private.debt2b2_create_schedule_v3(
    p_household_id,
    p_debt_id,
    p_event_id,
    p_event_date,
    p_reason,
    p_schedule_notes,
    p_schedule_installments,
    v_user_id,
    'contractual'
  );

  return private.debt2b2_schedule_result(p_event_id, false);
end;
$function$;

revoke all privileges on function public.update_debt_contractual_schedule_v1(uuid, uuid, uuid, date, text, jsonb, text)
  from public, anon, service_role;
grant execute on function public.update_debt_contractual_schedule_v1(uuid, uuid, uuid, date, text, jsonb, text)
  to authenticated;

-- Reversal locking must cover the target movement and reversal event. The
-- target is located before the advisory lock, then re-read with FOR UPDATE so
-- concurrent reversal/payment attempts share the same lock ordering.
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
returns jsonb
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
  v_existing_schedule public.debt_schedule_versions%rowtype;
  v_target_schedule public.debt_schedule_versions%rowtype;
  v_previous_schedule public.debt_schedule_versions%rowtype;
  v_target_has_schedule boolean := false;
  v_reversal public.debt_events%rowtype;
  v_description text := pg_catalog.btrim(p_description);
  v_current_principal numeric;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select hm.display_name into v_person
    from public.household_members as hm
   where hm.household_id = p_household_id
     and hm.user_id = v_user_id;
  if not found or v_person is null or pg_catalog.btrim(v_person) = '' then
    raise exception 'HOUSEHOLD_ACCESS_DENIED';
  end if;

  if p_household_id is null
     or p_debt_id is null
     or p_reversal_event_id is null
     or p_target_event_id is null
     or p_event_date is null
     or v_description is null
     or v_description = ''
     or p_schedule_installments is null
     or pg_catalog.jsonb_typeof(p_schedule_installments) <> 'array' then
    raise exception 'INVALID_DEBT_REVERSAL';
  end if;

  -- Locate target first, lock both advisory keys, then re-read the target.
  select e.* into v_target
    from public.debt_events as e
   where e.id = p_target_event_id
     and e.debt_id = p_debt_id
     and e.household_id = p_household_id;
  if not found then
    raise exception 'DEBT_EVENT_NOT_FOUND';
  end if;

  perform private.debt2b2_lock_operation(v_target.movement_id, p_reversal_event_id);

  select d.* into v_debt
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id
   for update;
  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;

  select e.* into v_target
    from public.debt_events as e
   where e.id = p_target_event_id
     and e.debt_id = p_debt_id
     and e.household_id = p_household_id
   for update;
  if not found then
    raise exception 'DEBT_EVENT_NOT_FOUND';
  end if;
  if v_target.event_type not in ('payment', 'principal_prepayment', 'payoff', 'installment_advance') then
    raise exception 'DEBT_EVENT_TYPE_UNSUPPORTED';
  end if;
  if p_event_date < v_target.event_date then
    raise exception 'INVALID_DEBT_REVERSAL';
  end if;

  select s.* into v_target_schedule
    from public.debt_schedule_versions as s
   where s.debt_id = p_debt_id
     and s.household_id = p_household_id
     and s.trigger_event_id = p_target_event_id
   order by s.version_number desc
   limit 1
   for update;
  v_target_has_schedule := found;

  select e.* into v_existing_reversal
    from public.debt_events as e
   where e.id = p_reversal_event_id
   for update;

  if found then
    if v_existing_reversal.household_id is distinct from p_household_id
       or v_existing_reversal.debt_id is distinct from p_debt_id
       or v_existing_reversal.event_type is distinct from 'reversal'
       or v_existing_reversal.reversal_of_event_id is distinct from p_target_event_id
       or v_existing_reversal.event_date is distinct from p_event_date
       or v_existing_reversal.cash_amount is distinct from 0::numeric
       or v_existing_reversal.principal_delta is distinct from 0::numeric
       or v_existing_reversal.interest_paid is distinct from 0::numeric
       or v_existing_reversal.fees_paid is distinct from 0::numeric
       or v_existing_reversal.insurance_paid is distinct from 0::numeric
       or v_existing_reversal.other_cost_paid is distinct from 0::numeric
       or v_existing_reversal.breakdown_complete is distinct from false
       or v_existing_reversal.movement_id is not null
       or v_existing_reversal.description is distinct from v_description then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;

    select s.* into v_existing_schedule
      from public.debt_schedule_versions as s
     where s.trigger_event_id = p_reversal_event_id
       and s.debt_id = p_debt_id
       and s.household_id = p_household_id
     order by s.version_number desc
     limit 1;

    if v_target_has_schedule then
      if not found
         or pg_catalog.jsonb_array_length(p_schedule_installments) = 0
         or private.debt2b2_canonical_schedule(p_schedule_installments)
              is distinct from private.debt2b2_persisted_schedule(v_existing_schedule.id)
         or v_existing_schedule.notes is distinct from coalesce(p_schedule_notes, '') then
        raise exception 'DEBT_EVENT_ID_CONFLICT';
      end if;
    elsif pg_catalog.jsonb_array_length(p_schedule_installments) <> 0
       or coalesce(p_schedule_notes, '') <> '' then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;

    return private.debt2b2_reversal_result(p_reversal_event_id, true);
  end if;

  if v_debt.is_archived then
    raise exception 'DEBT_ARCHIVED';
  end if;
  if v_debt.status = 'refinanced' then
    raise exception 'DEBT_NOT_ACTIVE';
  end if;
  if exists (
    select 1
      from public.debt_events as r
     where r.debt_id = p_debt_id
       and r.household_id = p_household_id
       and r.event_type = 'reversal'
       and r.reversal_of_event_id = p_target_event_id
  ) then
    raise exception 'DEBT_EVENT_ALREADY_REVERSED';
  end if;

  if v_target_has_schedule and pg_catalog.jsonb_array_length(p_schedule_installments) = 0 then
    raise exception 'DEBT_REVERSAL_SCHEDULE_REQUIRED';
  end if;
  if not v_target_has_schedule and pg_catalog.jsonb_array_length(p_schedule_installments) > 0 then
    raise exception 'DEBT_REVERSAL_SCHEDULE_NOT_ALLOWED';
  end if;
  if not v_target_has_schedule and coalesce(p_schedule_notes, '') <> '' then
    raise exception 'DEBT_REVERSAL_SCHEDULE_NOT_ALLOWED';
  end if;

  if v_target.movement_id is not null then
    perform 1
      from public.movements as m
     where m.id = v_target.movement_id
       and m.household_id = p_household_id
     for update;
    if not found then
      raise exception 'DEBT_MOVEMENT_CONFLICT';
    end if;
  end if;

  insert into public.debt_events (
    id, debt_id, household_id, event_date, event_type, cash_amount,
    principal_delta, interest_paid, fees_paid, insurance_paid, other_cost_paid,
    breakdown_complete, movement_id, reversal_of_event_id, description,
    registered_by_user_id
  ) values (
    p_reversal_event_id, p_debt_id, p_household_id, p_event_date, 'reversal',
    0, 0, 0, 0, 0, 0, false, null, p_target_event_id, v_description, v_user_id
  ) returning * into v_reversal;

  if v_target_has_schedule then
    select s.* into v_previous_schedule
      from public.debt_schedule_versions as s
     where s.debt_id = p_debt_id
       and s.household_id = p_household_id
       and s.version_number < v_target_schedule.version_number
     order by s.version_number desc
     limit 1
     for update;
    if not found then
      raise exception 'DEBT_REVERSAL_SCHEDULE_NOT_FOUND';
    end if;

    perform private.debt2b2_validate_schedule_v3(
      p_event_date,
      'reversal',
      p_schedule_installments
    );
    if private.debt2b2_canonical_schedule(p_schedule_installments)
         is distinct from private.debt2b2_persisted_schedule(v_previous_schedule.id)
       then
      raise exception 'DEBT_REVERSAL_SCHEDULE_CONFLICT';
    end if;

    if coalesce(v_previous_schedule.schedule_source, 'manual') = 'manual' then
      -- Preserve the source/authority metadata of legacy manual schedules.
      perform private.debt2b2_create_schedule_v2(
        p_household_id,
        p_debt_id,
        p_reversal_event_id,
        p_event_date,
        'reversal',
        p_schedule_notes,
        p_schedule_installments,
        v_user_id,
        'manual',
        v_previous_schedule.is_authoritative
      );
    else
      perform private.debt2b2_create_schedule_v3(
        p_household_id,
        p_debt_id,
        p_reversal_event_id,
        p_event_date,
        'reversal',
        p_schedule_notes,
        p_schedule_installments,
        v_user_id,
        v_previous_schedule.schedule_source
      );
    end if;
  end if;

  v_current_principal := private.debt2b2_current_principal(p_household_id, p_debt_id);
  perform private.debt2b2_reconcile_status(
    p_household_id,
    p_debt_id,
    v_current_principal
  );

  return private.debt2b2_reversal_result(p_reversal_event_id, false);
end;
$function$;

revoke all privileges on function public.reverse_debt_event_v1(uuid, uuid, uuid, uuid, date, text, jsonb, text)
  from public, anon, service_role;
grant execute on function public.reverse_debt_event_v1(uuid, uuid, uuid, uuid, date, text, jsonb, text)
  to authenticated;
