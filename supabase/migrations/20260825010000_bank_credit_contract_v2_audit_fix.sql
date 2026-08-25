-- BANK CREDIT CONTRACT V2: Audit Fix 2
-- Only evolves the new Bank V2 feature. Existing production migrations remain unchanged.

-- The Audit Fix 1 migration accidentally created a six-argument overload. The
-- historical seven-argument helper is the allocation SSOT used by DEBT-2B.2.
drop function if exists private.debt2b2_insert_allocations(uuid, uuid, uuid, uuid, numeric, jsonb);

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

-- A stable representation lets replay checks ignore allocation ordering while
-- still rejecting any changed installment or amount.
create or replace function private.debt2b2_canonical_allocations(p_allocations jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'installment_id', x.installment_id::text,
        'allocated_amount', x.allocated_amount
      ) order by x.installment_id::text
    ),
    '[]'::jsonb
  )
    from (
      select
        (value->>'installment_id')::uuid as installment_id,
        (value->>'allocated_amount')::numeric as allocated_amount
        from pg_catalog.jsonb_array_elements(p_allocations) as item(value)
    ) as x;
$function$;

-- Schedule creation is versioned rather than mutating a prior version. The
-- explicit metadata arguments are required for contractual vs estimated flow.
create or replace function private.debt2b2_create_schedule_v2(
  p_household_id uuid,
  p_debt_id uuid,
  p_trigger_event_id uuid,
  p_event_date date,
  p_reason text,
  p_notes text,
  p_schedule_installments jsonb,
  p_user_id uuid,
  p_schedule_source text,
  p_is_authoritative boolean
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
  v_source text := coalesce(p_schedule_source, 'manual');
  v_authoritative boolean := coalesce(p_is_authoritative, false);
begin
  if p_schedule_installments is null
     or pg_catalog.jsonb_typeof(p_schedule_installments) <> 'array'
     or pg_catalog.jsonb_array_length(p_schedule_installments) = 0
     or p_reason not in ('prepayment', 'reversal')
     or p_event_date is null
     or v_source not in ('contractual', 'estimated', 'manual') then
    raise exception 'INVALID_DEBT_SCHEDULE';
  end if;

  if v_source = 'contractual' and not v_authoritative then
    raise exception 'INVALID_DEBT_SCHEDULE';
  end if;
  if v_source = 'estimated' and v_authoritative then
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
    if v_elem ? 'expected_amount' and v_elem->'expected_amount' <> 'null'::pg_catalog.jsonb then
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
    if v_elem ? 'expected_principal' and v_elem->'expected_principal' <> 'null'::pg_catalog.jsonb then
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
    if v_elem ? 'expected_interest' and v_elem->'expected_interest' <> 'null'::pg_catalog.jsonb then
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
    if v_elem ? 'expected_fees' and v_elem->'expected_fees' <> 'null'::pg_catalog.jsonb then
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
    if v_elem ? 'expected_insurance' and v_elem->'expected_insurance' <> 'null'::pg_catalog.jsonb then
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
         + coalesce(v_expected_insurance, 0::numeric) > v_expected_amount then
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
    debt_id, household_id, version_number, effective_date, reason,
    schedule_source, is_authoritative, trigger_event_id, notes,
    created_by_user_id
  )
  select
    p_debt_id,
    p_household_id,
    coalesce(pg_catalog.max(s.version_number), 0) + 1,
    p_event_date,
    p_reason,
    v_source,
    v_authoritative,
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
      schedule_version_id, debt_id, household_id, installment_number, due_date,
      expected_amount, expected_principal, expected_interest, expected_fees,
      expected_insurance, created_by_user_id
    ) values (
      v_schedule.id, p_debt_id, p_household_id, v_installment_number, v_due_date,
      v_expected_amount, v_expected_principal, v_expected_interest, v_expected_fees,
      v_expected_insurance, p_user_id
    );
  end loop;

  return v_schedule;
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
  v_source text := 'manual';
  v_authoritative boolean := true;
  v_schedule public.debt_schedule_versions%rowtype;
begin
  select s.schedule_source, s.is_authoritative
    into v_source, v_authoritative
    from public.debt_schedule_versions as s
   where s.debt_id = p_debt_id
     and s.household_id = p_household_id
   order by s.version_number desc
   limit 1;

  v_schedule := private.debt2b2_create_schedule_v2(
    p_household_id,
    p_debt_id,
    p_trigger_event_id,
    p_event_date,
    p_reason,
    p_notes,
    p_schedule_installments,
    p_user_id,
    coalesce(v_source, 'manual'),
    coalesce(v_authoritative, true)
  );
  return v_schedule;
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
  if p_person is null or pg_catalog.btrim(p_person) = '' then
    raise exception 'HOUSEHOLD_ACCESS_DENIED';
  end if;

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
       or v_movement.person is distinct from p_person
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
    id, household_id, type, date, amount, description, method, category,
    person, registered_by_user_id, account_id, movement_context
  ) values (
    p_movement_id, p_household_id, 'egreso', p_event_date, p_cash_amount,
    p_description, v_expected_method, p_category, p_person, p_user_id,
    p_account_id, 'debt_service'
  )
  returning * into v_movement;

  return v_movement;
end;
$function$;

create or replace function private.debt2b2_validate_advance_allocations(
  p_household_id uuid,
  p_debt_id uuid,
  p_schedule_version_id uuid,
  p_event_date date,
  p_cash_amount numeric,
  p_principal_amount numeric,
  p_interest_paid numeric,
  p_fees_paid numeric,
  p_insurance_paid numeric,
  p_other_cost_paid numeric,
  p_allocations jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_elem jsonb;
  v_installment_id uuid;
  v_amount numeric;
  v_seen uuid[] := '{}'::uuid[];
  v_count integer;
  v_distinct_count integer;
  v_first_number integer;
  v_last_number integer;
  v_earliest_unpaid integer;
  v_cash numeric;
  v_principal numeric;
  v_interest numeric;
  v_fees numeric;
  v_insurance numeric;
  v_expected_amount numeric;
begin
  if p_schedule_version_id is null
     or p_allocations is null
     or pg_catalog.jsonb_typeof(p_allocations) <> 'array'
     or pg_catalog.jsonb_array_length(p_allocations) = 0 then
    raise exception 'INVALID_DEBT_ALLOCATIONS';
  end if;

  for v_elem in
    select e.value
      from pg_catalog.jsonb_array_elements(p_allocations) as e
  loop
    if pg_catalog.jsonb_typeof(v_elem) <> 'object'
       or not (v_elem ? 'installment_id')
       or not (v_elem ? 'allocated_amount')
       or pg_catalog.jsonb_typeof(v_elem->'allocated_amount') <> 'number' then
      raise exception 'INVALID_DEBT_ALLOCATIONS';
    end if;
    begin
      v_installment_id := (v_elem->>'installment_id')::uuid;
      v_amount := (v_elem->>'allocated_amount')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'INVALID_DEBT_ALLOCATIONS';
    end;
    if v_amount <= 0 or v_installment_id = any(v_seen) then
      raise exception 'INVALID_DEBT_ALLOCATIONS';
    end if;
    v_seen := pg_catalog.array_append(v_seen, v_installment_id);
  end loop;

  select
    pg_catalog.count(*),
    pg_catalog.count(distinct i.id),
    coalesce(pg_catalog.sum(i.expected_amount), 0::numeric),
    coalesce(pg_catalog.sum(i.expected_principal), 0::numeric),
    coalesce(pg_catalog.sum(i.expected_interest), 0::numeric),
    coalesce(pg_catalog.sum(i.expected_fees), 0::numeric),
    coalesce(pg_catalog.sum(i.expected_insurance), 0::numeric),
    min(i.installment_number),
    max(i.installment_number)
    into v_count, v_distinct_count, v_expected_amount, v_principal,
         v_interest, v_fees, v_insurance, v_first_number, v_last_number
    from pg_catalog.jsonb_array_elements(p_allocations) as e
    join public.debt_installments as i
      on i.id = (e.value->>'installment_id')::uuid
     and i.debt_id = p_debt_id
     and i.household_id = p_household_id
     and i.schedule_version_id = p_schedule_version_id
     and i.due_date > p_event_date;

  if v_count <> pg_catalog.jsonb_array_length(p_allocations)
     or v_distinct_count <> v_count
     or v_first_number is null
     or v_last_number - v_first_number + 1 <> v_count then
    raise exception 'INVALID_DEBT_ALLOCATIONS';
  end if;

  select coalesce(min(i.installment_number), null)
    into v_earliest_unpaid
    from public.debt_installments as i
   where i.debt_id = p_debt_id
     and i.household_id = p_household_id
     and i.schedule_version_id = p_schedule_version_id
     and i.due_date > p_event_date
     and i.expected_amount is not null
     and i.expected_amount > coalesce((
       select pg_catalog.sum(a.allocated_amount)
         from public.debt_event_installment_allocations as a
         join public.debt_events as e2
           on e2.id = a.event_id
          and e2.debt_id = a.debt_id
          and e2.household_id = a.household_id
        where a.installment_id = i.id
          and a.debt_id = p_debt_id
          and a.household_id = p_household_id
          and e2.event_type in ('payment', 'installment_advance')
          and not exists (
            select 1
              from public.debt_events as r
             where r.debt_id = e2.debt_id
               and r.household_id = e2.household_id
               and r.event_type = 'reversal'
               and r.reversal_of_event_id = e2.id
          )
     ), 0::numeric);

  if v_earliest_unpaid is null or v_first_number <> v_earliest_unpaid then
    raise exception 'INVALID_DEBT_ALLOCATIONS';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_allocations) as e
      join public.debt_installments as i
        on i.id = (e.value->>'installment_id')::uuid
       and i.debt_id = p_debt_id
       and i.household_id = p_household_id
       and i.schedule_version_id = p_schedule_version_id
      where coalesce((
        select pg_catalog.sum(a.allocated_amount)
          from public.debt_event_installment_allocations as a
          join public.debt_events as e2
            on e2.id = a.event_id
           and e2.debt_id = a.debt_id
           and e2.household_id = a.household_id
         where a.installment_id = i.id
           and a.debt_id = p_debt_id
           and a.household_id = p_household_id
           and e2.event_type in ('payment', 'installment_advance')
           and not exists (
             select 1
               from public.debt_events as r
              where r.debt_id = e2.debt_id
                and r.household_id = e2.household_id
                and r.event_type = 'reversal'
                and r.reversal_of_event_id = e2.id
           )
      ), 0::numeric) <> 0
  ) then
    raise exception 'INVALID_DEBT_ALLOCATIONS';
  end if;

  select coalesce(pg_catalog.sum((e.value->>'allocated_amount')::numeric), 0::numeric)
    into v_cash
    from pg_catalog.jsonb_array_elements(p_allocations) as e;

  if v_cash <> p_cash_amount
     or v_principal <> p_principal_amount
     or v_interest <> p_interest_paid
     or v_fees <> p_fees_paid
     or v_insurance <> p_insurance_paid
     or p_other_cost_paid <> 0
     or v_expected_amount <> p_cash_amount then
    raise exception 'INVALID_DEBT_ALLOCATIONS';
  end if;
end;
$function$;

create or replace function private.debt2b2_event_allocations(
  p_event_id uuid,
  p_debt_id uuid,
  p_household_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'installment_id', a.installment_id::text,
        'allocated_amount', a.allocated_amount
      ) order by a.installment_id::text
    ),
    '[]'::jsonb
  )
    from public.debt_event_installment_allocations as a
   where a.event_id = p_event_id
     and a.debt_id = p_debt_id
     and a.household_id = p_household_id;
$function$;

create or replace function private.debt2b2_canonical_schedule(p_schedule_installments jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'installment_number', x.installment_number,
        'due_date', x.due_date,
        'expected_amount', x.expected_amount,
        'expected_principal', x.expected_principal,
        'expected_interest', x.expected_interest,
        'expected_fees', x.expected_fees,
        'expected_insurance', x.expected_insurance
      ) order by x.installment_number
    ),
    '[]'::jsonb
  )
    from (
      select
        (value->>'installment_number')::integer as installment_number,
        (value->>'due_date')::date::text as due_date,
        case when value ? 'expected_amount' and value->'expected_amount' <> 'null'::jsonb then (value->>'expected_amount')::numeric else null end as expected_amount,
        case when value ? 'expected_principal' and value->'expected_principal' <> 'null'::jsonb then (value->>'expected_principal')::numeric else null end as expected_principal,
        case when value ? 'expected_interest' and value->'expected_interest' <> 'null'::jsonb then (value->>'expected_interest')::numeric else null end as expected_interest,
        case when value ? 'expected_fees' and value->'expected_fees' <> 'null'::jsonb then (value->>'expected_fees')::numeric else null end as expected_fees,
        case when value ? 'expected_insurance' and value->'expected_insurance' <> 'null'::jsonb then (value->>'expected_insurance')::numeric else null end as expected_insurance
        from pg_catalog.jsonb_array_elements(p_schedule_installments) as item(value)
    ) as x;
$function$;

create or replace function private.debt2b2_persisted_schedule(p_schedule_version_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'installment_number', i.installment_number,
        'due_date', i.due_date::text,
        'expected_amount', i.expected_amount,
        'expected_principal', i.expected_principal,
        'expected_interest', i.expected_interest,
        'expected_fees', i.expected_fees,
        'expected_insurance', i.expected_insurance
      ) order by i.installment_number
    ),
    '[]'::jsonb
  )
    from public.debt_installments as i
   where i.schedule_version_id = p_schedule_version_id;
$function$;

-- Payment V2 keeps the one-movement/one-event contract and treats the full
-- request payload as the idempotency key. A reused event id with any changed
-- field is a conflict, never a silent success.
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
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_person text;
  v_description text := pg_catalog.btrim(p_description);
  v_category text := pg_catalog.btrim(p_category);
  v_movement_id text := pg_catalog.btrim(p_movement_id);
  v_debt public.debts%rowtype;
  v_movement public.movements%rowtype;
  v_existing_event public.debt_events%rowtype;
  v_linked_event public.debt_events%rowtype;
  v_schedule public.debt_schedule_versions%rowtype;
  v_current_principal numeric;
  v_extra_principal numeric := coalesce(p_extra_principal_amount, 0);
  v_total_principal numeric;
  v_has_schedule boolean := false;
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
     or pg_catalog.jsonb_typeof(p_allocations) <> 'array'
     or p_principal_amount < 0
     or v_extra_principal < 0
     or (
       p_prepayment_effect is not null
       and p_prepayment_effect not in ('reduce_term', 'reduce_installment', 'pending_bank_schedule', 'other', 'unknown')
     ) then
    raise exception 'INVALID_DEBT_PAYMENT';
  end if;

  perform private.debt2b2_lock_operation(v_movement_id, p_event_id);

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
       or v_existing_event.principal_delta is distinct from -(p_principal_amount + v_extra_principal)
       or v_existing_event.interest_paid is distinct from p_interest_paid
       or v_existing_event.fees_paid is distinct from p_fees_paid
       or v_existing_event.insurance_paid is distinct from p_insurance_paid
       or v_existing_event.other_cost_paid is distinct from p_other_cost_paid
       or v_existing_event.extra_principal_amount is distinct from v_extra_principal
       or v_existing_event.prepayment_effect is distinct from p_prepayment_effect
       or v_existing_event.breakdown_complete is distinct from p_breakdown_complete
       or v_existing_event.description is distinct from v_description then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;

    select m.*
      into v_movement
      from public.movements as m
     where m.id = v_movement_id
       and m.household_id = p_household_id
     for update;
    if not found then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;
    v_movement := private.debt2b2_prepare_movement(
      p_household_id, v_movement_id, p_event_date, p_cash_amount,
      p_account_id, v_description, v_category, v_user_id, v_person
    );

    if private.debt2b2_canonical_allocations(p_allocations)
       is distinct from private.debt2b2_event_allocations(p_event_id, p_debt_id, p_household_id) then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;
    return private.debt2b2_fund_result(p_event_id, true);
  end if;

  if v_debt.is_archived then
    raise exception 'DEBT_ARCHIVED';
  end if;
  if v_debt.status <> 'active' then
    raise exception 'DEBT_NOT_ACTIVE';
  end if;

  v_total_principal := p_principal_amount + v_extra_principal;
  v_current_principal := private.debt2b2_current_principal(p_household_id, p_debt_id);
  if v_current_principal <= 0 then
    raise exception 'DEBT_ALREADY_PAID_OFF';
  end if;
  if v_total_principal < 0 or v_total_principal > v_current_principal then
    raise exception 'DEBT_PRINCIPAL_EXCEEDED';
  end if;

  perform private.debt2b2_validate_costs(
    p_cash_amount,
    v_total_principal,
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
     and e.household_id = p_household_id
     and e.debt_id = p_debt_id
     and e.event_type in ('payment', 'principal_prepayment', 'payoff', 'installment_advance')
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
    p_household_id, v_movement_id, p_event_date, p_cash_amount,
    p_account_id, v_description, v_category, v_user_id, v_person
  );

  insert into public.debt_events (
    id, debt_id, household_id, event_date, event_type, cash_amount,
    principal_delta, interest_paid, fees_paid, insurance_paid, other_cost_paid,
    extra_principal_amount, prepayment_effect, breakdown_complete, movement_id,
    reversal_of_event_id, description, registered_by_user_id
  ) values (
    p_event_id, p_debt_id, p_household_id, p_event_date, 'payment', p_cash_amount,
    -v_total_principal, p_interest_paid, p_fees_paid, p_insurance_paid,
    p_other_cost_paid, v_extra_principal, p_prepayment_effect, p_breakdown_complete,
    v_movement_id, null, v_description, v_user_id
  );

  select s.*
    into v_schedule
    from public.debt_schedule_versions as s
   where s.debt_id = p_debt_id
     and s.household_id = p_household_id
   order by s.version_number desc
   limit 1
   for update;
  v_has_schedule := found;

  perform private.debt2b2_insert_allocations(
    p_household_id,
    p_debt_id,
    p_event_id,
    case when v_has_schedule then v_schedule.id else null end,
    p_cash_amount,
    p_allocations,
    v_user_id
  );

  perform private.debt2b2_reconcile_status(
    p_household_id,
    p_debt_id,
    v_current_principal - v_total_principal
  );

  return private.debt2b2_fund_result(p_event_id, false);
end;
$function$;

revoke all privileges on function public.record_debt_payment_v2(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, boolean, jsonb)
  from public, anon, service_role;
grant execute on function public.record_debt_payment_v2(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, boolean, jsonb)
  to authenticated;

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
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_person text;
  v_description text := pg_catalog.btrim(p_description);
  v_category text := pg_catalog.btrim(p_category);
  v_movement_id text := pg_catalog.btrim(p_movement_id);
  v_debt public.debts%rowtype;
  v_movement public.movements%rowtype;
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
     or pg_catalog.jsonb_typeof(p_allocations) <> 'array'
     or pg_catalog.jsonb_array_length(p_allocations) = 0 then
    raise exception 'INVALID_DEBT_PAYMENT';
  end if;

  perform private.debt2b2_lock_operation(v_movement_id, p_event_id);

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
    into v_existing_event
    from public.debt_events as e
   where e.id = p_event_id
   for update;

  if found then
    if v_existing_event.household_id is distinct from p_household_id
       or v_existing_event.debt_id is distinct from p_debt_id
       or v_existing_event.event_type is distinct from 'installment_advance'
       or v_existing_event.movement_id is distinct from v_movement_id
       or v_existing_event.event_date is distinct from p_event_date
       or v_existing_event.cash_amount is distinct from p_cash_amount
       or v_existing_event.principal_delta is distinct from -p_principal_amount
       or v_existing_event.interest_paid is distinct from p_interest_paid
       or v_existing_event.fees_paid is distinct from p_fees_paid
       or v_existing_event.insurance_paid is distinct from p_insurance_paid
       or v_existing_event.other_cost_paid is distinct from p_other_cost_paid
       or v_existing_event.breakdown_complete is distinct from p_breakdown_complete
       or v_existing_event.description is distinct from v_description then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;

    select m.*
      into v_movement
      from public.movements as m
     where m.id = v_movement_id
       and m.household_id = p_household_id
     for update;
    if not found then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;
    v_movement := private.debt2b2_prepare_movement(
      p_household_id, v_movement_id, p_event_date, p_cash_amount,
      p_account_id, v_description, v_category, v_user_id, v_person
    );
    if private.debt2b2_canonical_allocations(p_allocations)
       is distinct from private.debt2b2_event_allocations(p_event_id, p_debt_id, p_household_id) then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;
    return private.debt2b2_fund_result(p_event_id, true);
  end if;

  if v_debt.is_archived then
    raise exception 'DEBT_ARCHIVED';
  end if;
  if v_debt.status <> 'active' then
    raise exception 'DEBT_NOT_ACTIVE';
  end if;

  v_current_principal := private.debt2b2_current_principal(p_household_id, p_debt_id);
  if v_current_principal <= 0 then
    raise exception 'DEBT_ALREADY_PAID_OFF';
  end if;
  if p_principal_amount <= 0 or p_principal_amount > v_current_principal then
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
     and e.household_id = p_household_id
     and e.debt_id = p_debt_id
     and e.event_type in ('payment', 'principal_prepayment', 'payoff', 'installment_advance')
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

  select s.*
    into v_schedule
    from public.debt_schedule_versions as s
   where s.debt_id = p_debt_id
     and s.household_id = p_household_id
   order by s.version_number desc
   limit 1
   for update;
  if not found then
    raise exception 'INVALID_DEBT_ALLOCATIONS';
  end if;

  perform private.debt2b2_validate_advance_allocations(
    p_household_id,
    p_debt_id,
    v_schedule.id,
    p_event_date,
    p_cash_amount,
    p_principal_amount,
    p_interest_paid,
    p_fees_paid,
    p_insurance_paid,
    p_other_cost_paid,
    p_allocations
  );

  v_movement := private.debt2b2_prepare_movement(
    p_household_id, v_movement_id, p_event_date, p_cash_amount,
    p_account_id, v_description, v_category, v_user_id, v_person
  );

  insert into public.debt_events (
    id, debt_id, household_id, event_date, event_type, cash_amount,
    principal_delta, interest_paid, fees_paid, insurance_paid, other_cost_paid,
    breakdown_complete, movement_id, reversal_of_event_id, description,
    registered_by_user_id
  ) values (
    p_event_id, p_debt_id, p_household_id, p_event_date, 'installment_advance',
    p_cash_amount, -p_principal_amount, p_interest_paid, p_fees_paid,
    p_insurance_paid, p_other_cost_paid, p_breakdown_complete, v_movement_id,
    null, v_description, v_user_id
  );

  perform private.debt2b2_insert_allocations(
    p_household_id,
    p_debt_id,
    p_event_id,
    v_schedule.id,
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

revoke all privileges on function public.record_debt_installment_advance_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, boolean, jsonb)
  from public, anon, service_role;
grant execute on function public.record_debt_installment_advance_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, boolean, jsonb)
  to authenticated;

create or replace function public.record_debt_prepayment_v2(
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
  v_user_id uuid := auth.uid();
  v_person text;
  v_description text := pg_catalog.btrim(p_description);
  v_category text := pg_catalog.btrim(p_category);
  v_movement_id text := pg_catalog.btrim(p_movement_id);
  v_debt public.debts%rowtype;
  v_movement public.movements%rowtype;
  v_existing_event public.debt_events%rowtype;
  v_linked_event public.debt_events%rowtype;
  v_schedule public.debt_schedule_versions%rowtype;
  v_current_principal numeric;
  v_source text;
  v_authoritative boolean;
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
     or pg_catalog.jsonb_typeof(p_schedule_installments) <> 'array'
     or (
       p_prepayment_effect is not null
       and p_prepayment_effect not in ('reduce_term', 'reduce_installment', 'pending_bank_schedule', 'other', 'unknown')
     )
     or (
       p_schedule_source is not null
       and p_schedule_source not in ('contractual', 'estimated', 'manual')
     ) then
    raise exception 'INVALID_DEBT_PREPAYMENT';
  end if;

  perform private.debt2b2_lock_operation(v_movement_id, p_event_id);

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
       or v_existing_event.prepayment_effect is distinct from p_prepayment_effect
       or v_existing_event.breakdown_complete is distinct from p_breakdown_complete
       or v_existing_event.description is distinct from v_description then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;

    select m.*
      into v_movement
      from public.movements as m
     where m.id = v_movement_id
       and m.household_id = p_household_id
     for update;
    if not found then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;
    v_movement := private.debt2b2_prepare_movement(
      p_household_id, v_movement_id, p_event_date, p_cash_amount,
      p_account_id, v_description, v_category, v_user_id, v_person
    );

    select s.*
      into v_schedule
      from public.debt_schedule_versions as s
     where s.trigger_event_id = p_event_id
       and s.debt_id = p_debt_id
       and s.household_id = p_household_id
     order by s.version_number desc
     limit 1;
    if pg_catalog.jsonb_array_length(p_schedule_installments) = 0 then
      if found then
        raise exception 'DEBT_EVENT_ID_CONFLICT';
      end if;
    elsif not found
       or private.debt2b2_canonical_schedule(p_schedule_installments)
          is distinct from private.debt2b2_persisted_schedule(v_schedule.id)
       or v_schedule.notes is distinct from coalesce(p_schedule_notes, '')
       or (
         p_schedule_source is not null
         and v_schedule.schedule_source is distinct from p_schedule_source
       ) then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;

    return private.debt2b2_fund_result(p_event_id, true);
  end if;

  if v_debt.is_archived then
    raise exception 'DEBT_ARCHIVED';
  end if;
  if v_debt.status <> 'active' then
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
     and e.household_id = p_household_id
     and e.debt_id = p_debt_id
     and e.event_type in ('payment', 'principal_prepayment', 'payoff', 'installment_advance')
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
    p_household_id, v_movement_id, p_event_date, p_cash_amount,
    p_account_id, v_description, v_category, v_user_id, v_person
  );

  insert into public.debt_events (
    id, debt_id, household_id, event_date, event_type, cash_amount,
    principal_delta, interest_paid, fees_paid, insurance_paid, other_cost_paid,
    prepayment_effect, breakdown_complete, movement_id, reversal_of_event_id,
    description, registered_by_user_id
  ) values (
    p_event_id, p_debt_id, p_household_id, p_event_date, 'principal_prepayment',
    p_cash_amount, -p_principal_amount, p_interest_paid, p_fees_paid,
    p_insurance_paid, p_other_cost_paid, p_prepayment_effect, p_breakdown_complete,
    v_movement_id, null, v_description, v_user_id
  );

  if pg_catalog.jsonb_array_length(p_schedule_installments) > 0 then
    select s.schedule_source, s.is_authoritative
      into v_source, v_authoritative
      from public.debt_schedule_versions as s
     where s.debt_id = p_debt_id
       and s.household_id = p_household_id
     order by s.version_number desc
     limit 1;

    v_source := coalesce(p_schedule_source, v_source, 'manual');
    v_authoritative := case
      when v_source = 'contractual' then true
      when v_source = 'estimated' then false
      when p_schedule_source is not null then false
      else coalesce(v_authoritative, true)
    end;

    perform private.debt2b2_create_schedule_v2(
      p_household_id,
      p_debt_id,
      p_event_id,
      p_event_date,
      'prepayment',
      p_schedule_notes,
      p_schedule_installments,
      v_user_id,
      v_source,
      v_authoritative
    );
  elsif p_schedule_source is not null then
    raise exception 'INVALID_DEBT_SCHEDULE';
  end if;

  perform private.debt2b2_reconcile_status(
    p_household_id,
    p_debt_id,
    v_current_principal - p_principal_amount
  );

  return private.debt2b2_fund_result(p_event_id, false);
end;
$function$;

revoke all privileges on function public.record_debt_prepayment_v2(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, text, boolean, jsonb, text, text)
  from public, anon, service_role;
grant execute on function public.record_debt_prepayment_v2(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, text, boolean, jsonb, text, text)
  to authenticated;

-- Reversal is restored to the DEBT-2B.2 semantics: it reverses the target
-- event, recreates the prior schedule when the target created one, and keeps
-- the target's event/movement history intact.
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

  select hm.display_name
    into v_person
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

  perform private.debt2b2_lock_operation(null, p_reversal_event_id);

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

  select e.*
    into v_existing_reversal
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

    select s.*
      into v_existing_schedule
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
    select s.*
      into v_previous_schedule
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

    perform private.debt2b2_create_schedule_v2(
      p_household_id,
      p_debt_id,
      p_reversal_event_id,
      p_event_date,
      'reversal',
      p_schedule_notes,
      p_schedule_installments,
      v_user_id,
      v_previous_schedule.schedule_source,
      v_previous_schedule.is_authoritative
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

revoke all privileges on function public.reverse_debt_event_v1(uuid, uuid, uuid, uuid, date, text, jsonb, text)
  from public, anon, service_role;
grant execute on function public.reverse_debt_event_v1(uuid, uuid, uuid, uuid, date, text, jsonb, text)
  to authenticated;

-- A BANK V2 profile is valid only together with the schedule selected in the
-- form. Deferred execution allows create_bank_loan_v1 to insert the profile
-- and its initial schedule in either order within one transaction.
create or replace function private.require_bank_loan_schedule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_schedule_id uuid;
  v_schedule_source text;
  v_schedule_count integer;
  v_first_installment integer;
  v_last_installment integer;
  v_distinct_installments integer;
  v_planned_installment_count integer;
  v_complete_rows boolean;
  v_chronological_rows boolean;
begin
  select pg_catalog.count(*)
    into v_schedule_count
    from public.debt_schedule_versions as s
   where s.debt_id = new.debt_id
     and s.household_id = new.household_id;

  select s.id, s.schedule_source
    into v_schedule_id, v_schedule_source
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

  select
    min(i.installment_number),
    max(i.installment_number),
    pg_catalog.count(distinct i.installment_number),
    coalesce(pg_catalog.bool_and(
      i.expected_amount is not null
      and i.expected_principal is not null
      and i.expected_interest is not null
      and i.expected_fees is not null
      and i.expected_insurance is not null
    ), false)
    into v_first_installment, v_last_installment, v_distinct_installments, v_complete_rows
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

  if v_schedule_count = 0
     or v_schedule_source not in ('contractual', 'estimated')
     or v_planned_installment_count is null
     or v_planned_installment_count <> v_distinct_installments
     or v_first_installment is null
     or v_first_installment <> 1
     or v_last_installment <> v_distinct_installments
     or not v_complete_rows
     or not v_chronological_rows then
    raise exception 'BANK_SCHEDULE_REQUIRED';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_bank_loan_profile_schedule_required on public.bank_loan_profiles;
create constraint trigger trg_bank_loan_profile_schedule_required
  after insert or update on public.bank_loan_profiles
  deferrable initially deferred
  for each row
  execute function private.require_bank_loan_schedule();

revoke all privileges on function private.require_bank_loan_schedule()
  from public, anon, authenticated, service_role;

create or replace function private.require_bank_loan_profile()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT'
     and new.debt_kind = 'bank_loan'
     and not exists (
       select 1
         from public.bank_loan_profiles as p
        where p.debt_id = new.id
          and p.household_id = new.household_id
     ) then
    raise exception 'BANK_PROFILE_REQUIRED';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_bank_loan_profile_required on public.debts;
create constraint trigger trg_bank_loan_profile_required
  after insert or update on public.debts
  deferrable initially deferred
  for each row
  execute function private.require_bank_loan_profile();

revoke all privileges on function private.require_bank_loan_profile()
  from public, anon, authenticated, service_role;

-- Payoff remains a V1 public contract, but its replay path must use the same
-- complete movement/event comparison as the V2 operations.
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
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_person text;
  v_description text := pg_catalog.btrim(p_description);
  v_category text := pg_catalog.btrim(p_category);
  v_movement_id text := pg_catalog.btrim(p_movement_id);
  v_debt public.debts%rowtype;
  v_movement public.movements%rowtype;
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

  perform private.debt2b2_lock_operation(v_movement_id, p_event_id);

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
       or v_existing_event.breakdown_complete is distinct from p_breakdown_complete
       or v_existing_event.description is distinct from v_description then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;

    select m.*
      into v_movement
      from public.movements as m
     where m.id = v_movement_id
       and m.household_id = p_household_id
     for update;
    if not found then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;
    v_movement := private.debt2b2_prepare_movement(
      p_household_id, v_movement_id, p_event_date, p_cash_amount,
      p_account_id, v_description, v_category, v_user_id, v_person
    );
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
     and e.household_id = p_household_id
     and e.debt_id = p_debt_id
     and e.event_type in ('payment', 'principal_prepayment', 'payoff', 'installment_advance')
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
    p_household_id, v_movement_id, p_event_date, p_cash_amount,
    p_account_id, v_description, v_category, v_user_id, v_person
  );

  insert into public.debt_events (
    id, debt_id, household_id, event_date, event_type, cash_amount,
    principal_delta, interest_paid, fees_paid, insurance_paid, other_cost_paid,
    breakdown_complete, movement_id, reversal_of_event_id, description,
    registered_by_user_id
  ) values (
    p_event_id, p_debt_id, p_household_id, p_event_date, 'payoff', p_cash_amount,
    -v_current_principal, p_interest_paid, p_fees_paid, p_insurance_paid,
    p_other_cost_paid, p_breakdown_complete, v_movement_id, null,
    v_description, v_user_id
  );

  perform private.debt2b2_reconcile_status(p_household_id, p_debt_id, 0::numeric);
  return private.debt2b2_fund_result(p_event_id, false);
end;
$function$;

revoke all privileges on function public.record_debt_payoff_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, boolean)
  from public, anon, service_role;
grant execute on function public.record_debt_payoff_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, boolean)
  to authenticated;
