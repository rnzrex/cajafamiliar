-- DEBT-2B.2: atomic Debt payment engine.
-- Four public SECURITY DEFINER RPCs. No UI, no offline Debt operations.

alter table public.debt_schedule_versions
  drop constraint if exists debt_schedule_versions_reason_check,
  add constraint debt_schedule_versions_reason_check
    check (reason in ('initial', 'prepayment', 'rate_change', 'refinance', 'manual_adjustment', 'reversal'));

create schema if not exists private;

revoke all on schema private
  from public, anon, authenticated, service_role;

-- ============================================================
-- Internal helpers
-- ============================================================

create or replace function private.debt2b2_current_principal(
  p_household_id uuid,
  p_debt_id uuid
)
returns pg_catalog.numeric
language sql
security invoker
set search_path = ''
as $function$
  select d.opening_principal_balance
    + coalesce(
        (
          select pg_catalog.sum(e.principal_delta)
            from public.debt_events as e
           where e.household_id = p_household_id
             and e.debt_id = p_debt_id
             and e.event_type <> 'reversal'
             and not exists (
               select 1
                 from public.debt_events as r
                where r.household_id = e.household_id
                  and r.debt_id = e.debt_id
                  and r.event_type = 'reversal'
                  and r.reversal_of_event_id = e.id
             )
        ),
        0::pg_catalog.numeric
      )
    from public.debts as d
   where d.household_id = p_household_id
     and d.id = p_debt_id;
$function$;

create or replace function private.debt2b2_lock_operation(
  p_movement_id text,
  p_event_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_movement_key bigint;
  v_event_key bigint;
begin
  v_event_key := pg_catalog.hashtextextended('event:' || p_event_id::text, 0);

  if p_movement_id is null then
    perform pg_catalog.pg_advisory_xact_lock(v_event_key);
    return;
  end if;

  v_movement_key := pg_catalog.hashtextextended(p_movement_id, 0);
  if v_movement_key <= v_event_key then
    perform pg_catalog.pg_advisory_xact_lock(v_movement_key);
    perform pg_catalog.pg_advisory_xact_lock(v_event_key);
  else
    perform pg_catalog.pg_advisory_xact_lock(v_event_key);
    perform pg_catalog.pg_advisory_xact_lock(v_movement_key);
  end if;
end;
$function$;

-- ============================================================
-- Public fund operation: payment
-- ============================================================

create or replace function public.record_debt_payment_v1(
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
  v_linked_event public.debt_events%rowtype;
  v_schedule public.debt_schedule_versions%rowtype;
  v_current_principal numeric;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select hm.display_name
    into v_person
    from public.household_members as hm
   where hm.household_id = p_household_id
     and hm.user_id = v_user_id;
  if not found or v_person is null or pg_catalog.btrim(v_person) = '' then
    raise exception 'HOUSEHOLD_ACCESS_DENIED';
  end if;

  v_movement_id := pg_catalog.btrim(p_movement_id);
  v_description := pg_catalog.btrim(p_description);
  v_category := pg_catalog.btrim(p_category);
  if p_household_id is null
     or p_debt_id is null
     or p_event_id is null
     or v_movement_id is null
     or v_movement_id = ''
     or p_event_date is null
     or p_account_id is null
     or v_description is null
     or v_description = ''
     or v_category is null
     or v_category = ''
     or p_cash_amount is null
     or p_principal_amount is null
     or p_breakdown_complete is null
     or p_allocations is null
     or pg_catalog.jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'INVALID_DEBT_PAYMENT';
  end if;

  select d.*
    into v_debt
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id
   for update;
  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;

  perform private.debt2b2_lock_operation(v_movement_id, p_event_id);

  select m.*
    into v_movement
   from public.movements as m
    where m.id = v_movement_id
      and m.household_id = p_household_id
    for update;

  select e.*
    into v_existing_event
    from public.debt_events as e
   where e.id = p_event_id
   for update;

  if found then
    if v_existing_event.household_id is distinct from p_household_id
       or v_existing_event.debt_id is distinct from p_debt_id
       or v_existing_event.event_type is distinct from 'payment'
       or v_existing_event.movement_id is distinct from v_movement_id
       or v_existing_event.event_date is distinct from p_event_date
       or v_existing_event.cash_amount is distinct from p_cash_amount
       or v_existing_event.principal_delta is distinct from -p_principal_amount
       or v_existing_event.interest_paid is distinct from p_interest_paid
       or v_existing_event.fees_paid is distinct from p_fees_paid
       or v_existing_event.insurance_paid is distinct from p_insurance_paid
       or v_existing_event.other_cost_paid is distinct from p_other_cost_paid
       or v_existing_event.breakdown_complete is distinct from p_breakdown_complete then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;
    return private.debt2b2_fund_result(p_event_id, true);
  end if;

  if v_debt.is_archived then
    raise exception 'DEBT_ARCHIVED';
  end if;
  if v_debt.status = 'refinanced' then
    raise exception 'DEBT_NOT_ACTIVE';
  end if;

  v_current_principal := private.debt2b2_current_principal(p_household_id, p_debt_id);
  if v_current_principal <= 0 then
    raise exception 'DEBT_ALREADY_PAID_OFF';
  end if;
  if p_principal_amount < 0 then
    raise exception 'INVALID_DEBT_PAYMENT';
  end if;
  if p_principal_amount > v_current_principal then
    raise exception 'DEBT_PRINCIPAL_EXCEEDED';
  end if;

  perform private.debt2b2_validate_costs(
    p_cash_amount,
    p_principal_amount,
    p_interest_paid,
    p_fees_paid,
    p_insurance_paid,
    p_other_cost_paid,
    p_breakdown_complete,
    'INVALID_DEBT_PAYMENT'
  );

  select e.*
    into v_linked_event
    from public.debt_events as e
   where e.movement_id = v_movement_id
     and e.event_type in ('payment', 'principal_prepayment', 'payoff')
     and not exists (
       select 1
         from public.debt_events as r
        where r.debt_id = e.debt_id
          and r.household_id = e.household_id
          and r.event_type = 'reversal'
          and r.reversal_of_event_id = e.id
     )
   order by e.created_at, e.id
   limit 1
   for update;
  if found then
    raise exception 'DEBT_MOVEMENT_ALREADY_LINKED';
  end if;

  v_movement := private.debt2b2_prepare_movement(
    p_household_id,
    v_movement_id,
    p_event_date,
    p_cash_amount,
    p_account_id,
    v_description,
    v_category,
    v_user_id,
    v_person
  );

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
    'payment',
    p_cash_amount,
    -p_principal_amount,
    p_interest_paid,
    p_fees_paid,
    p_insurance_paid,
    p_other_cost_paid,
    p_breakdown_complete,
    v_movement_id,
    null,
    v_description,
    v_user_id
  )
  returning * into v_event;

  select s.*
    into v_schedule
    from public.debt_schedule_versions as s
   where s.debt_id = p_debt_id
     and s.household_id = p_household_id
   order by s.version_number desc
   limit 1
   for update;

  perform private.debt2b2_insert_allocations(
    p_household_id,
    p_debt_id,
    p_event_id,
    case when found then v_schedule.id else null end,
    p_cash_amount,
    p_allocations,
    v_user_id
  );

  perform private.debt2b2_reconcile_status(
    p_household_id,
    p_debt_id,
    v_current_principal - p_principal_amount
  );

  return private.debt2b2_fund_result(p_event_id, false);
end;
$function$;

-- ============================================================
-- Public operation: reversal
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
  v_target public.debt_events%rowtype;
  v_existing_event public.debt_events%rowtype;
  v_target_schedule public.debt_schedule_versions%rowtype;
  v_event public.debt_events%rowtype;
  v_debt public.debts%rowtype;
  v_description text;
  v_target_has_schedule boolean := false;
  v_current_principal numeric;
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

  v_description := pg_catalog.btrim(p_description);
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

  select d.*
    into v_debt
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id
   for update;
  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;

  select e.*
    into v_target
    from public.debt_events as e
   where e.id = p_target_event_id
     and e.debt_id = p_debt_id
     and e.household_id = p_household_id;
  if not found then
    raise exception 'DEBT_EVENT_NOT_FOUND';
  end if;

  perform private.debt2b2_lock_operation(v_target.movement_id, p_reversal_event_id);

  select e.*
    into v_target
    from public.debt_events as e
   where e.id = p_target_event_id
     and e.debt_id = p_debt_id
     and e.household_id = p_household_id
   for update;

  select e.*
    into v_existing_event
    from public.debt_events as e
   where e.id = p_reversal_event_id
   for update;

  if found then
    if v_existing_event.household_id is distinct from p_household_id
       or v_existing_event.debt_id is distinct from p_debt_id
       or v_existing_event.event_type is distinct from 'reversal'
       or v_existing_event.reversal_of_event_id is distinct from p_target_event_id
       or v_existing_event.event_date is distinct from p_event_date
       or v_existing_event.cash_amount is distinct from 0::numeric
       or v_existing_event.principal_delta is distinct from 0::numeric
       or v_existing_event.interest_paid is distinct from 0::numeric
       or v_existing_event.fees_paid is distinct from 0::numeric
       or v_existing_event.insurance_paid is distinct from 0::numeric
       or v_existing_event.other_cost_paid is distinct from 0::numeric
       or v_existing_event.breakdown_complete is distinct from false
       or v_existing_event.movement_id is not null then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;
    return private.debt2b2_reversal_result(p_reversal_event_id, true);
  end if;

  if v_target.event_type not in ('payment', 'principal_prepayment', 'payoff') then
    raise exception 'DEBT_EVENT_TYPE_UNSUPPORTED';
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
  if p_event_date < v_target.event_date then
    raise exception 'INVALID_DEBT_REVERSAL';
  end if;

  select s.*
    into v_target_schedule
    from public.debt_schedule_versions as s
   where s.debt_id = p_debt_id
     and s.household_id = p_household_id
     and s.trigger_event_id = p_target_event_id
   order by s.version_number desc
   limit 1
   for update;
  v_target_has_schedule := found;

  if v_target_has_schedule and pg_catalog.jsonb_array_length(p_schedule_installments) = 0 then
    raise exception 'DEBT_REVERSAL_SCHEDULE_REQUIRED';
  end if;
  if not v_target_has_schedule and pg_catalog.jsonb_array_length(p_schedule_installments) > 0 then
    raise exception 'DEBT_REVERSAL_SCHEDULE_NOT_ALLOWED';
  end if;

  if v_target.movement_id is not null then
    perform 1
      from public.movements as m
     where m.id = v_target.movement_id
       and m.household_id = p_household_id
     for update;
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
    p_reversal_event_id,
    p_debt_id,
    p_household_id,
    p_event_date,
    'reversal',
    0,
    0,
    0,
    0,
    0,
    0,
    false,
    null,
    p_target_event_id,
    v_description,
    v_user_id
  )
  returning * into v_event;

  if v_target_has_schedule then
    perform private.debt2b2_create_schedule(
      p_household_id,
      p_debt_id,
      p_reversal_event_id,
      p_event_date,
      'reversal',
      p_schedule_notes,
      p_schedule_installments,
      v_user_id
    );
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

create or replace function private.debt2b2_validate_costs(
  p_cash_amount numeric,
  p_principal_amount numeric,
  p_interest_paid numeric,
  p_fees_paid numeric,
  p_insurance_paid numeric,
  p_other_cost_paid numeric,
  p_breakdown_complete boolean,
  p_error_code text
)
returns pg_catalog.numeric
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_economic_expense numeric;
  v_known_costs numeric;
begin
  if p_cash_amount is null
     or p_cash_amount <= 0
     or p_principal_amount is null
     or p_principal_amount < 0
     or p_principal_amount > p_cash_amount
     or p_cash_amount <> pg_catalog.round(p_cash_amount, 2)
     or p_cash_amount > 9999999999.99::numeric
     or p_interest_paid is null
     or p_interest_paid < 0
     or p_fees_paid is null
     or p_fees_paid < 0
     or p_insurance_paid is null
     or p_insurance_paid < 0
     or p_other_cost_paid is null
     or p_other_cost_paid < 0
     or p_breakdown_complete is null then
    raise exception '%', p_error_code;
  end if;

  v_economic_expense := p_cash_amount - p_principal_amount;
  v_known_costs := p_interest_paid + p_fees_paid + p_insurance_paid + p_other_cost_paid;

  if v_known_costs > v_economic_expense then
    raise exception '%', p_error_code;
  end if;
  if p_breakdown_complete and v_known_costs <> v_economic_expense then
    raise exception '%', p_error_code;
  end if;

  return v_economic_expense;
end;
$function$;

create or replace function private.debt2b2_prepare_movement(
  p_household_id uuid,
  p_movement_id text,
  p_event_date date,
  p_cash_amount numeric,
  p_account_id uuid,
  p_description text,
  p_category text,
  p_user_id uuid,
  p_person text
)
returns public.movements
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_movement public.movements%rowtype;
  v_account_type text;
  v_expected_method text;
begin
  select m.*
    into v_movement
    from public.movements as m
   where m.id = p_movement_id
   for update;

  if found then
    if v_movement.household_id is distinct from p_household_id then
      raise exception 'DEBT_MOVEMENT_CONFLICT';
    end if;

    select fa.reconciliation_type
      into v_account_type
      from public.financial_accounts as fa
     where fa.id = v_movement.account_id
       and fa.household_id = p_household_id;

    if not found then
      raise exception 'DEBT_MOVEMENT_CONFLICT';
    end if;

    v_expected_method := case when v_account_type = 'cash' then 'efectivo' else 'transferencia' end;

    if v_movement.type is distinct from 'egreso'
       or v_movement.movement_context is distinct from 'debt_service'
       or v_movement.date is distinct from p_event_date
       or v_movement.amount is distinct from p_cash_amount
       or v_movement.account_id is distinct from p_account_id
       or v_movement.description is distinct from p_description
       or v_movement.category is distinct from p_category
       or v_movement.method is distinct from v_expected_method then
      raise exception 'DEBT_MOVEMENT_CONFLICT';
    end if;

    return v_movement;
  end if;

  if p_account_id is null then
    raise exception 'ACCOUNT_NOT_AVAILABLE';
  end if;

  select fa.reconciliation_type
    into v_account_type
    from public.financial_accounts as fa
   where fa.id = p_account_id
     and fa.household_id = p_household_id
     and fa.is_active = true;

  if not found then
    raise exception 'ACCOUNT_NOT_AVAILABLE';
  end if;

  v_expected_method := case when v_account_type = 'cash' then 'efectivo' else 'transferencia' end;

  insert into public.movements (
    id,
    household_id,
    type,
    date,
    amount,
    description,
    method,
    category,
    person,
    registered_by_user_id,
    account_id,
    movement_context
  ) values (
    p_movement_id,
    p_household_id,
    'egreso',
    p_event_date,
    p_cash_amount,
    p_description,
    v_expected_method,
    p_category,
    p_person,
    p_user_id,
    p_account_id,
    'debt_service'
  )
  returning * into v_movement;

  return v_movement;
end;
$function$;

create or replace function private.debt2b2_create_schedule(
  p_household_id uuid,
  p_debt_id uuid,
  p_trigger_event_id uuid,
  p_event_date date,
  p_reason text,
  p_notes text,
  p_schedule_installments jsonb,
  p_user_id uuid
)
returns public.debt_schedule_versions
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_schedule public.debt_schedule_versions%rowtype;
  v_elem jsonb;
  v_count integer;
  v_installment_number integer;
  v_due_date date;
  v_expected_amount numeric;
  v_expected_principal numeric;
  v_expected_interest numeric;
  v_expected_fees numeric;
  v_expected_insurance numeric;
begin
  if p_schedule_installments is null
     or pg_catalog.jsonb_typeof(p_schedule_installments) <> 'array'
     or pg_catalog.jsonb_array_length(p_schedule_installments) = 0
     or p_reason not in ('prepayment', 'reversal') then
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
       or v_elem->'due_date' = 'null'::pg_catalog.jsonb then
      raise exception 'INVALID_DEBT_SCHEDULE';
    end if;

    if v_elem->>'installment_number' !~ '^[0-9]+$' then
      raise exception 'INVALID_DEBT_SCHEDULE';
    end if;
    begin
      v_installment_number := (v_elem->>'installment_number')::integer;
    exception
      when numeric_value_out_of_range or invalid_text_representation then
        raise exception 'INVALID_DEBT_SCHEDULE';
    end;
    if v_installment_number < 1 then
      raise exception 'INVALID_DEBT_SCHEDULE';
    end if;

    if v_elem->>'due_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'INVALID_DEBT_SCHEDULE';
    end if;
    begin
      v_due_date := (v_elem->>'due_date')::date;
    exception
      when invalid_text_representation or datetime_field_overflow then
        raise exception 'INVALID_DEBT_SCHEDULE';
    end;

    v_expected_amount := null;
    if v_elem ? 'expected_amount'
       and v_elem->'expected_amount' <> 'null'::pg_catalog.jsonb then
      if pg_catalog.jsonb_typeof(v_elem->'expected_amount') <> 'number' then
        raise exception 'INVALID_DEBT_SCHEDULE';
      end if;
      begin
        v_expected_amount := (v_elem->>'expected_amount')::numeric;
      exception
        when numeric_value_out_of_range or invalid_text_representation then
          raise exception 'INVALID_DEBT_SCHEDULE';
      end;
      if v_expected_amount <= 0 then
        raise exception 'INVALID_DEBT_SCHEDULE';
      end if;
    end if;

    v_expected_principal := null;
    if v_elem ? 'expected_principal'
       and v_elem->'expected_principal' <> 'null'::pg_catalog.jsonb then
      if pg_catalog.jsonb_typeof(v_elem->'expected_principal') <> 'number' then
        raise exception 'INVALID_DEBT_SCHEDULE';
      end if;
      begin
        v_expected_principal := (v_elem->>'expected_principal')::numeric;
      exception
        when numeric_value_out_of_range or invalid_text_representation then
          raise exception 'INVALID_DEBT_SCHEDULE';
      end;
      if v_expected_principal < 0 then
        raise exception 'INVALID_DEBT_SCHEDULE';
      end if;
    end if;

    v_expected_interest := null;
    if v_elem ? 'expected_interest'
       and v_elem->'expected_interest' <> 'null'::pg_catalog.jsonb then
      if pg_catalog.jsonb_typeof(v_elem->'expected_interest') <> 'number' then
        raise exception 'INVALID_DEBT_SCHEDULE';
      end if;
      begin
        v_expected_interest := (v_elem->>'expected_interest')::numeric;
      exception
        when numeric_value_out_of_range or invalid_text_representation then
          raise exception 'INVALID_DEBT_SCHEDULE';
      end;
      if v_expected_interest < 0 then
        raise exception 'INVALID_DEBT_SCHEDULE';
      end if;
    end if;

    v_expected_fees := null;
    if v_elem ? 'expected_fees'
       and v_elem->'expected_fees' <> 'null'::pg_catalog.jsonb then
      if pg_catalog.jsonb_typeof(v_elem->'expected_fees') <> 'number' then
        raise exception 'INVALID_DEBT_SCHEDULE';
      end if;
      begin
        v_expected_fees := (v_elem->>'expected_fees')::numeric;
      exception
        when numeric_value_out_of_range or invalid_text_representation then
          raise exception 'INVALID_DEBT_SCHEDULE';
      end;
      if v_expected_fees < 0 then
        raise exception 'INVALID_DEBT_SCHEDULE';
      end if;
    end if;

    v_expected_insurance := null;
    if v_elem ? 'expected_insurance'
       and v_elem->'expected_insurance' <> 'null'::pg_catalog.jsonb then
      if pg_catalog.jsonb_typeof(v_elem->'expected_insurance') <> 'number' then
        raise exception 'INVALID_DEBT_SCHEDULE';
      end if;
      begin
        v_expected_insurance := (v_elem->>'expected_insurance')::numeric;
      exception
        when numeric_value_out_of_range or invalid_text_representation then
          raise exception 'INVALID_DEBT_SCHEDULE';
      end;
      if v_expected_insurance < 0 then
        raise exception 'INVALID_DEBT_SCHEDULE';
      end if;
    end if;

    if v_expected_amount is not null
       and coalesce(v_expected_principal, 0::numeric)
           + coalesce(v_expected_interest, 0::numeric)
           + coalesce(v_expected_fees, 0::numeric)
           + coalesce(v_expected_insurance, 0::numeric)
           > v_expected_amount then
      raise exception 'INVALID_DEBT_SCHEDULE';
    end if;
  end loop;

  if (
    select pg_catalog.count(distinct (e.value->>'installment_number')::integer)
      from pg_catalog.jsonb_array_elements(p_schedule_installments) as e
  ) <> v_count
  or (
    select pg_catalog.max((e.value->>'installment_number')::integer)
      from pg_catalog.jsonb_array_elements(p_schedule_installments) as e
  ) <> v_count then
    raise exception 'INVALID_DEBT_SCHEDULE';
  end if;

  insert into public.debt_schedule_versions (
    debt_id,
    household_id,
    version_number,
    effective_date,
    reason,
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
    p_trigger_event_id,
    coalesce(p_notes, ''),
    p_user_id
    from public.debt_schedule_versions as s
   where s.debt_id = p_debt_id
     and s.household_id = p_household_id
  returning * into v_schedule;

  for v_elem in
    select e.value
      from pg_catalog.jsonb_array_elements(p_schedule_installments) as e
  loop
    v_installment_number := (v_elem->>'installment_number')::integer;
    v_due_date := (v_elem->>'due_date')::date;
    v_expected_amount := case when v_elem ? 'expected_amount' and v_elem->'expected_amount' <> 'null'::pg_catalog.jsonb then (v_elem->>'expected_amount')::numeric else null end;
    v_expected_principal := case when v_elem ? 'expected_principal' and v_elem->'expected_principal' <> 'null'::pg_catalog.jsonb then (v_elem->>'expected_principal')::numeric else null end;
    v_expected_interest := case when v_elem ? 'expected_interest' and v_elem->'expected_interest' <> 'null'::pg_catalog.jsonb then (v_elem->>'expected_interest')::numeric else null end;
    v_expected_fees := case when v_elem ? 'expected_fees' and v_elem->'expected_fees' <> 'null'::pg_catalog.jsonb then (v_elem->>'expected_fees')::numeric else null end;
    v_expected_insurance := case when v_elem ? 'expected_insurance' and v_elem->'expected_insurance' <> 'null'::pg_catalog.jsonb then (v_elem->>'expected_insurance')::numeric else null end;

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
    ) values (
      v_schedule.id,
      p_debt_id,
      p_household_id,
      v_installment_number,
      v_due_date,
      v_expected_amount,
      v_expected_principal,
      v_expected_interest,
      v_expected_fees,
      v_expected_insurance,
      p_user_id
    );
  end loop;

  return v_schedule;
end;
$function$;

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
  if p_allocations is null or pg_catalog.jsonb_typeof(p_allocations) <> 'array' then
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
       and e.event_type = 'payment'
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

create or replace function private.debt2b2_reconcile_status(
  p_household_id uuid,
  p_debt_id uuid,
  p_current_principal numeric
)
returns public.debts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_debt public.debts%rowtype;
begin
  update public.debts as d
     set status = case when p_current_principal > 0 then 'active' else 'paid_off' end
   where d.id = p_debt_id
     and d.household_id = p_household_id
  returning * into v_debt;

  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;
  return v_debt;
end;
$function$;

create or replace function private.debt2b2_fund_result(
  p_event_id uuid,
  p_idempotent_replay boolean
)
returns pg_catalog.jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_event public.debt_events%rowtype;
  v_debt public.debts%rowtype;
  v_movement public.movements%rowtype;
  v_schedule public.debt_schedule_versions%rowtype;
  v_allocations jsonb := '[]'::jsonb;
  v_installments jsonb := '[]'::jsonb;
begin
  select e.* into v_event from public.debt_events as e where e.id = p_event_id;
  if not found then
    raise exception 'DEBT_EVENT_NOT_FOUND';
  end if;

  select d.*
    into v_debt
    from public.debts as d
   where d.id = v_event.debt_id
     and d.household_id = v_event.household_id;
  select m.*
    into v_movement
    from public.movements as m
   where m.id = v_event.movement_id
     and m.household_id = v_event.household_id;
  select s.*
    into v_schedule
    from public.debt_schedule_versions as s
   where s.trigger_event_id = v_event.id
     and s.debt_id = v_event.debt_id
     and s.household_id = v_event.household_id
   order by s.version_number desc
   limit 1;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by a.created_at, a.id), '[]'::jsonb)
    into v_allocations
    from public.debt_event_installment_allocations as a
   where a.event_id = v_event.id
     and a.debt_id = v_event.debt_id
     and a.household_id = v_event.household_id;

  if v_schedule.id is not null then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) order by i.installment_number), '[]'::jsonb)
      into v_installments
      from public.debt_installments as i
     where i.schedule_version_id = v_schedule.id
       and i.debt_id = v_event.debt_id
       and i.household_id = v_event.household_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'idempotentReplay', p_idempotent_replay,
    'debt', pg_catalog.to_jsonb(v_debt),
    'movement', pg_catalog.to_jsonb(v_movement),
    'event', pg_catalog.to_jsonb(v_event),
    'allocations', v_allocations,
    'scheduleVersion', case when v_schedule.id is null then 'null'::jsonb else pg_catalog.to_jsonb(v_schedule) end,
    'installments', v_installments
  );
end;
$function$;

create or replace function private.debt2b2_reversal_result(
  p_event_id uuid,
  p_idempotent_replay boolean
)
returns pg_catalog.jsonb
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
  select e.* into v_event from public.debt_events as e where e.id = p_event_id;
  if not found then
    raise exception 'DEBT_EVENT_NOT_FOUND';
  end if;

  select d.*
    into v_debt
    from public.debts as d
   where d.id = v_event.debt_id
     and d.household_id = v_event.household_id;
  select s.*
    into v_schedule
    from public.debt_schedule_versions as s
   where s.trigger_event_id = v_event.id
     and s.debt_id = v_event.debt_id
     and s.household_id = v_event.household_id
   order by s.version_number desc
   limit 1;

  if v_schedule.id is not null then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) order by i.installment_number), '[]'::jsonb)
      into v_installments
      from public.debt_installments as i
     where i.schedule_version_id = v_schedule.id
       and i.debt_id = v_event.debt_id
       and i.household_id = v_event.household_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'idempotentReplay', p_idempotent_replay,
    'debt', pg_catalog.to_jsonb(v_debt),
    'event', pg_catalog.to_jsonb(v_event),
    'scheduleVersion', case when v_schedule.id is null then 'null'::jsonb else pg_catalog.to_jsonb(v_schedule) end,
    'installments', v_installments
  );
end;
$function$;

-- ============================================================
-- Public fund operation: principal prepayment
-- ============================================================

create or replace function public.record_debt_prepayment_v1(
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
  v_description text;
  v_category text;
  v_movement_id text;
  v_debt public.debts%rowtype;
  v_movement public.movements%rowtype;
  v_event public.debt_events%rowtype;
  v_existing_event public.debt_events%rowtype;
  v_linked_event public.debt_events%rowtype;
  v_schedule public.debt_schedule_versions%rowtype;
  v_current_principal numeric;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select hm.display_name
    into v_person
    from public.household_members as hm
   where hm.household_id = p_household_id
     and hm.user_id = v_user_id;
  if not found or v_person is null or pg_catalog.btrim(v_person) = '' then
    raise exception 'HOUSEHOLD_ACCESS_DENIED';
  end if;

  v_movement_id := pg_catalog.btrim(p_movement_id);
  v_description := pg_catalog.btrim(p_description);
  v_category := pg_catalog.btrim(p_category);
  if p_household_id is null
     or p_debt_id is null
     or p_event_id is null
     or v_movement_id is null
     or v_movement_id = ''
     or p_event_date is null
     or p_account_id is null
     or v_description is null
     or v_description = ''
     or v_category is null
     or v_category = ''
     or p_cash_amount is null
     or p_principal_amount is null
     or p_breakdown_complete is null
     or p_schedule_installments is null
     or pg_catalog.jsonb_typeof(p_schedule_installments) <> 'array' then
    raise exception 'INVALID_DEBT_PREPAYMENT';
  end if;

  select d.*
    into v_debt
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id
   for update;
  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;

  perform private.debt2b2_lock_operation(v_movement_id, p_event_id);

  select m.*
    into v_movement
   from public.movements as m
    where m.id = v_movement_id
      and m.household_id = p_household_id
    for update;

  select e.*
    into v_existing_event
    from public.debt_events as e
   where e.id = p_event_id
   for update;

  if found then
    if v_existing_event.household_id is distinct from p_household_id
       or v_existing_event.debt_id is distinct from p_debt_id
       or v_existing_event.event_type is distinct from 'principal_prepayment'
       or v_existing_event.movement_id is distinct from v_movement_id
       or v_existing_event.event_date is distinct from p_event_date
       or v_existing_event.cash_amount is distinct from p_cash_amount
       or v_existing_event.principal_delta is distinct from -p_principal_amount
       or v_existing_event.interest_paid is distinct from p_interest_paid
       or v_existing_event.fees_paid is distinct from p_fees_paid
       or v_existing_event.insurance_paid is distinct from p_insurance_paid
       or v_existing_event.other_cost_paid is distinct from p_other_cost_paid
       or v_existing_event.breakdown_complete is distinct from p_breakdown_complete then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;
    return private.debt2b2_fund_result(p_event_id, true);
  end if;

  if v_debt.is_archived then
    raise exception 'DEBT_ARCHIVED';
  end if;
  if v_debt.status = 'refinanced' then
    raise exception 'DEBT_NOT_ACTIVE';
  end if;

  v_current_principal := private.debt2b2_current_principal(p_household_id, p_debt_id);
  if v_current_principal <= 0 then
    raise exception 'DEBT_ALREADY_PAID_OFF';
  end if;
  if p_principal_amount <= 0 then
    raise exception 'INVALID_DEBT_PREPAYMENT';
  end if;
  if p_principal_amount = v_current_principal then
    raise exception 'DEBT_PREPAYMENT_WOULD_PAY_OFF';
  end if;
  if p_principal_amount > v_current_principal then
    raise exception 'DEBT_PRINCIPAL_EXCEEDED';
  end if;

  perform private.debt2b2_validate_costs(
    p_cash_amount,
    p_principal_amount,
    p_interest_paid,
    p_fees_paid,
    p_insurance_paid,
    p_other_cost_paid,
    p_breakdown_complete,
    'INVALID_DEBT_PREPAYMENT'
  );

  select e.*
    into v_linked_event
    from public.debt_events as e
   where e.movement_id = v_movement_id
     and e.event_type in ('payment', 'principal_prepayment', 'payoff')
     and not exists (
       select 1
         from public.debt_events as r
        where r.debt_id = e.debt_id
          and r.household_id = e.household_id
          and r.event_type = 'reversal'
          and r.reversal_of_event_id = e.id
     )
   order by e.created_at, e.id
   limit 1
   for update;
  if found then
    raise exception 'DEBT_MOVEMENT_ALREADY_LINKED';
  end if;

  v_movement := private.debt2b2_prepare_movement(
    p_household_id,
    v_movement_id,
    p_event_date,
    p_cash_amount,
    p_account_id,
    v_description,
    v_category,
    v_user_id,
    v_person
  );

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
    'principal_prepayment',
    p_cash_amount,
    -p_principal_amount,
    p_interest_paid,
    p_fees_paid,
    p_insurance_paid,
    p_other_cost_paid,
    p_breakdown_complete,
    v_movement_id,
    null,
    v_description,
    v_user_id
  )
  returning * into v_event;

  if pg_catalog.jsonb_array_length(p_schedule_installments) > 0 then
    v_schedule := private.debt2b2_create_schedule(
      p_household_id,
      p_debt_id,
      p_event_id,
      p_event_date,
      'prepayment',
      p_schedule_notes,
      p_schedule_installments,
      v_user_id
    );
  end if;

  perform private.debt2b2_reconcile_status(
    p_household_id,
    p_debt_id,
    v_current_principal - p_principal_amount
  );

  return private.debt2b2_fund_result(p_event_id, false);
end;
$function$;

-- ============================================================
-- Public fund operation: payoff
-- ============================================================

create or replace function public.record_debt_payoff_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_event_id uuid,
  p_movement_id text,
  p_event_date date,
  p_cash_amount numeric,
  p_account_id uuid,
  p_description text,
  p_category text,
  p_interest_paid numeric,
  p_fees_paid numeric,
  p_insurance_paid numeric,
  p_other_cost_paid numeric,
  p_breakdown_complete boolean
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
  v_linked_event public.debt_events%rowtype;
  v_current_principal numeric;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select hm.display_name
    into v_person
    from public.household_members as hm
   where hm.household_id = p_household_id
     and hm.user_id = v_user_id;
  if not found or v_person is null or pg_catalog.btrim(v_person) = '' then
    raise exception 'HOUSEHOLD_ACCESS_DENIED';
  end if;

  v_movement_id := pg_catalog.btrim(p_movement_id);
  v_description := pg_catalog.btrim(p_description);
  v_category := pg_catalog.btrim(p_category);
  if p_household_id is null
     or p_debt_id is null
     or p_event_id is null
     or v_movement_id is null
     or v_movement_id = ''
     or p_event_date is null
     or p_account_id is null
     or v_description is null
     or v_description = ''
     or v_category is null
     or v_category = ''
     or p_cash_amount is null
     or p_breakdown_complete is null then
    raise exception 'INVALID_DEBT_PAYOFF';
  end if;

  select d.*
    into v_debt
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id
   for update;
  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;

  perform private.debt2b2_lock_operation(v_movement_id, p_event_id);

  select m.*
    into v_movement
   from public.movements as m
    where m.id = v_movement_id
      and m.household_id = p_household_id
    for update;

  select e.*
    into v_existing_event
    from public.debt_events as e
   where e.id = p_event_id
   for update;

  if found then
    if v_existing_event.household_id is distinct from p_household_id
       or v_existing_event.debt_id is distinct from p_debt_id
       or v_existing_event.event_type is distinct from 'payoff'
       or v_existing_event.movement_id is distinct from v_movement_id
       or v_existing_event.event_date is distinct from p_event_date
       or v_existing_event.cash_amount is distinct from p_cash_amount
       or v_existing_event.interest_paid is distinct from p_interest_paid
       or v_existing_event.fees_paid is distinct from p_fees_paid
       or v_existing_event.insurance_paid is distinct from p_insurance_paid
       or v_existing_event.other_cost_paid is distinct from p_other_cost_paid
       or v_existing_event.breakdown_complete is distinct from p_breakdown_complete then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;
    return private.debt2b2_fund_result(p_event_id, true);
  end if;

  if v_debt.is_archived then
    raise exception 'DEBT_ARCHIVED';
  end if;
  if v_debt.status = 'refinanced' then
    raise exception 'DEBT_NOT_ACTIVE';
  end if;

  v_current_principal := private.debt2b2_current_principal(p_household_id, p_debt_id);
  if v_current_principal <= 0 then
    raise exception 'DEBT_ALREADY_PAID_OFF';
  end if;
  if p_cash_amount < v_current_principal then
    raise exception 'INVALID_DEBT_PAYOFF';
  end if;

  perform private.debt2b2_validate_costs(
    p_cash_amount,
    v_current_principal,
    p_interest_paid,
    p_fees_paid,
    p_insurance_paid,
    p_other_cost_paid,
    p_breakdown_complete,
    'INVALID_DEBT_PAYOFF'
  );

  select e.*
    into v_linked_event
    from public.debt_events as e
   where e.movement_id = v_movement_id
     and e.event_type in ('payment', 'principal_prepayment', 'payoff')
     and not exists (
       select 1
         from public.debt_events as r
        where r.debt_id = e.debt_id
          and r.household_id = e.household_id
          and r.event_type = 'reversal'
          and r.reversal_of_event_id = e.id
     )
   order by e.created_at, e.id
   limit 1
   for update;
  if found then
    raise exception 'DEBT_MOVEMENT_ALREADY_LINKED';
  end if;

  v_movement := private.debt2b2_prepare_movement(
    p_household_id,
    v_movement_id,
    p_event_date,
    p_cash_amount,
    p_account_id,
    v_description,
    v_category,
    v_user_id,
    v_person
  );

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
    'payoff',
    p_cash_amount,
    -v_current_principal,
    p_interest_paid,
    p_fees_paid,
    p_insurance_paid,
    p_other_cost_paid,
    p_breakdown_complete,
    v_movement_id,
    null,
    v_description,
    v_user_id
  )
  returning * into v_event;

  perform private.debt2b2_reconcile_status(
    p_household_id,
    p_debt_id,
    0::numeric
  );

  return private.debt2b2_fund_result(p_event_id, false);
end;
$function$;

-- ============================================================
-- Function ACL and design comments
-- ============================================================

revoke all privileges on function public.record_debt_payment_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, boolean, jsonb)
  from public, anon, service_role;
grant execute on function public.record_debt_payment_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, boolean, jsonb)
  to authenticated;

revoke all privileges on function public.record_debt_prepayment_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, boolean, jsonb, text)
  from public, anon, service_role;
grant execute on function public.record_debt_prepayment_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, boolean, jsonb, text)
  to authenticated;

revoke all privileges on function public.record_debt_payoff_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, boolean)
  from public, anon, service_role;
grant execute on function public.record_debt_payoff_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, boolean)
  to authenticated;

revoke all privileges on function public.reverse_debt_event_v1(uuid, uuid, uuid, uuid, date, text, jsonb, text)
  from public, anon, service_role;
grant execute on function public.reverse_debt_event_v1(uuid, uuid, uuid, uuid, date, text, jsonb, text)
  to authenticated;

revoke execute on function private.debt2b2_current_principal(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.debt2b2_lock_operation(text, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.debt2b2_validate_costs(numeric, numeric, numeric, numeric, numeric, numeric, boolean, text)
  from public, anon, authenticated, service_role;
revoke execute on function private.debt2b2_prepare_movement(uuid, text, date, numeric, uuid, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function private.debt2b2_create_schedule(uuid, uuid, uuid, date, text, text, jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.debt2b2_insert_allocations(uuid, uuid, uuid, uuid, numeric, jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.debt2b2_reconcile_status(uuid, uuid, numeric)
  from public, anon, authenticated, service_role;
revoke execute on function private.debt2b2_fund_result(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function private.debt2b2_reversal_result(uuid, boolean)
  from public, anon, authenticated, service_role;

comment on function public.record_debt_payment_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, boolean, jsonb) is
  'DEBT-2B.2: atomic authenticated Debt payment. The server derives principal_delta, Movement method, person, registered_by_user_id, effective principal, allocations and status. p_event_id is the idempotency key; Debt and Movement are locked before any write.';

comment on function public.record_debt_prepayment_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, boolean, jsonb, text) is
  'DEBT-2B.2: atomic authenticated principal prepayment. The server derives principal_delta and appends an optional prepayment schedule version. A prepayment equal to current principal must use payoff.';

comment on function public.record_debt_payoff_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, boolean) is
  'DEBT-2B.2: atomic authenticated payoff. The server locks the Debt, calculates current principal, writes principal_delta = -current_principal and reconciles paid_off status.';

comment on function public.reverse_debt_event_v1(uuid, uuid, uuid, uuid, date, text, jsonb, text) is
  'DEBT-2B.2: atomic Debt classification reversal. It writes only a zero-financial-effect reversal event, never changes or compensates the original Movement, and appends a recalculated reversal schedule when required.';

comment on table public.debt_events is
  'DEBT-2B.2 reversals correct Debt classification only. The original Movement and its cash fact remain immutable; cash corrections are outside this gate.';
