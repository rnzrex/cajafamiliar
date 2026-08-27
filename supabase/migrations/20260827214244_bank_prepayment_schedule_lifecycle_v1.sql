-- BANK PREPAYMENT RECALCULATION V1: official post-prepayment schedule
-- lifecycle. Forward-only additive fix; historical migrations remain immutable.

-- Strict BANK schedule validation now accepts the optional contractual number
-- and reported balance while keeping the internal number contiguous.
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
  v_contractual_number integer;
  v_previous_contractual_number integer;
  v_due_date date;
  v_previous_due_date date;
  v_expected_amount numeric;
  v_expected_principal numeric;
  v_expected_interest numeric;
  v_expected_fees numeric;
  v_expected_insurance numeric;
  v_reported_balance numeric;
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

    v_contractual_number := null;
    if v_elem ? 'contractual_installment_number'
       and v_elem->'contractual_installment_number' <> 'null'::pg_catalog.jsonb then
      if pg_catalog.jsonb_typeof(v_elem->'contractual_installment_number') <> 'number'
         or v_elem->>'contractual_installment_number' !~ '^[0-9]+$' then
        raise exception 'INVALID_DEBT_SCHEDULE';
      end if;
      begin
        v_contractual_number := (v_elem->>'contractual_installment_number')::integer;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'INVALID_DEBT_SCHEDULE';
      end;
    end if;

    v_reported_balance := null;
    if v_elem ? 'reported_balance'
       and v_elem->'reported_balance' <> 'null'::pg_catalog.jsonb then
      if pg_catalog.jsonb_typeof(v_elem->'reported_balance') <> 'number' then
        raise exception 'INVALID_DEBT_SCHEDULE';
      end if;
      begin
        v_reported_balance := (v_elem->>'reported_balance')::numeric;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'INVALID_DEBT_SCHEDULE';
      end;
    end if;

    if v_installment_number < 1
       or (v_previous_number is not null and v_installment_number <> v_previous_number + 1)
       or v_due_date <= p_event_date
       or (v_previous_due_date is not null and v_due_date <= v_previous_due_date)
       or v_expected_amount <= 0
       or v_expected_principal < 0
       or v_expected_interest < 0
       or v_expected_fees < 0
       or v_expected_insurance < 0
       or (v_contractual_number is not null and (v_contractual_number < 1 or (v_previous_contractual_number is not null and v_contractual_number <= v_previous_contractual_number)))
       or (v_reported_balance is not null and v_reported_balance < 0)
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
    if v_contractual_number is not null then
      v_previous_contractual_number := v_contractual_number;
    end if;
  end loop;

  if v_previous_number <> v_count then
    raise exception 'INVALID_DEBT_SCHEDULE';
  end if;
end;
$function$;

revoke all privileges on function private.debt2b2_validate_schedule_v3(date, text, jsonb)
  from public, anon, authenticated, service_role;

-- Shared append-only writer. The relaxed path preserves legacy manual/reversal
-- behavior, while contractual/estimated and explicit strict callers receive
-- the complete BANK validator above and always persist lifecycle metadata.
create or replace function private.debt2b2_create_schedule_lifecycle_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_trigger_event_id uuid,
  p_event_date date,
  p_reason text,
  p_notes text,
  p_schedule_installments jsonb,
  p_user_id uuid,
  p_schedule_source text,
  p_is_authoritative boolean,
  p_strict boolean
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
  v_previous_contractual_number integer;
  v_contractual_number integer;
  v_due_date date;
  v_expected_amount numeric;
  v_expected_principal numeric;
  v_expected_interest numeric;
  v_expected_fees numeric;
  v_expected_insurance numeric;
  v_reported_balance numeric;
  v_source text := coalesce(p_schedule_source, 'manual');
  v_authoritative boolean := coalesce(p_is_authoritative, false);
  v_strict boolean := coalesce(p_strict, false) or v_source in ('contractual', 'estimated');
begin
  if p_schedule_installments is null
     or pg_catalog.jsonb_typeof(p_schedule_installments) <> 'array'
     or pg_catalog.jsonb_array_length(p_schedule_installments) = 0
     or p_event_date is null
     or p_reason not in ('prepayment', 'rate_change', 'manual_adjustment', 'reversal')
     or v_source not in ('contractual', 'reconstructed', 'estimated', 'manual') then
    raise exception 'INVALID_DEBT_SCHEDULE';
  end if;

  if (v_source = 'contractual' and not v_authoritative)
     or (v_source in ('estimated', 'reconstructed', 'manual') and v_authoritative and v_source <> 'manual') then
    raise exception 'INVALID_DEBT_SCHEDULE';
  end if;

  if v_strict then
    perform private.debt2b2_validate_schedule_v3(
      p_event_date,
      p_reason,
      p_schedule_installments
    );
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
       or v_elem->>'installment_number' !~ '^[0-9]+$'
       or v_elem->>'due_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'INVALID_DEBT_SCHEDULE';
    end if;

    begin
      v_installment_number := (v_elem->>'installment_number')::integer;
      v_due_date := (v_elem->>'due_date')::date;
    exception
      when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
        raise exception 'INVALID_DEBT_SCHEDULE';
    end;
    if v_installment_number < 1 then
      raise exception 'INVALID_DEBT_SCHEDULE';
    end if;

    v_contractual_number := null;
    if v_elem ? 'contractual_installment_number'
       and v_elem->'contractual_installment_number' <> 'null'::pg_catalog.jsonb then
      if pg_catalog.jsonb_typeof(v_elem->'contractual_installment_number') <> 'number'
         or v_elem->>'contractual_installment_number' !~ '^[0-9]+$' then
        raise exception 'INVALID_DEBT_SCHEDULE';
      end if;
      begin
        v_contractual_number := (v_elem->>'contractual_installment_number')::integer;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'INVALID_DEBT_SCHEDULE';
      end;
      if v_contractual_number < 1
         or (v_previous_contractual_number is not null and v_contractual_number <= v_previous_contractual_number) then
        raise exception 'INVALID_DEBT_SCHEDULE';
      end if;
      v_previous_contractual_number := v_contractual_number;
    end if;

    v_expected_amount := null;
    if v_elem ? 'expected_amount' and v_elem->'expected_amount' <> 'null'::pg_catalog.jsonb then
      if pg_catalog.jsonb_typeof(v_elem->'expected_amount') <> 'number' then
        raise exception 'INVALID_DEBT_SCHEDULE';
      end if;
      begin
        v_expected_amount := (v_elem->>'expected_amount')::numeric;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
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
        when invalid_text_representation or numeric_value_out_of_range then
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
        when invalid_text_representation or numeric_value_out_of_range then
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
        when invalid_text_representation or numeric_value_out_of_range then
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
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'INVALID_DEBT_SCHEDULE';
      end;
      if v_expected_insurance < 0 then
        raise exception 'INVALID_DEBT_SCHEDULE';
      end if;
    end if;

    v_reported_balance := null;
    if v_elem ? 'reported_balance' and v_elem->'reported_balance' <> 'null'::pg_catalog.jsonb then
      if pg_catalog.jsonb_typeof(v_elem->'reported_balance') <> 'number' then
        raise exception 'INVALID_DEBT_SCHEDULE';
      end if;
      begin
        v_reported_balance := (v_elem->>'reported_balance')::numeric;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'INVALID_DEBT_SCHEDULE';
      end;
      if v_reported_balance < 0 then
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
    v_contractual_number := coalesce(nullif(v_elem->>'contractual_installment_number', '')::integer, v_installment_number);
    v_expected_amount := case when v_elem ? 'expected_amount' and v_elem->'expected_amount' <> 'null'::pg_catalog.jsonb then (v_elem->>'expected_amount')::numeric else null end;
    v_expected_principal := case when v_elem ? 'expected_principal' and v_elem->'expected_principal' <> 'null'::pg_catalog.jsonb then (v_elem->>'expected_principal')::numeric else null end;
    v_expected_interest := case when v_elem ? 'expected_interest' and v_elem->'expected_interest' <> 'null'::pg_catalog.jsonb then (v_elem->>'expected_interest')::numeric else null end;
    v_expected_fees := case when v_elem ? 'expected_fees' and v_elem->'expected_fees' <> 'null'::pg_catalog.jsonb then (v_elem->>'expected_fees')::numeric else null end;
    v_expected_insurance := case when v_elem ? 'expected_insurance' and v_elem->'expected_insurance' <> 'null'::pg_catalog.jsonb then (v_elem->>'expected_insurance')::numeric else null end;
    v_reported_balance := case when v_elem ? 'reported_balance' and v_elem->'reported_balance' <> 'null'::pg_catalog.jsonb then (v_elem->>'reported_balance')::numeric else null end;

    insert into public.debt_installments (
      schedule_version_id, debt_id, household_id, installment_number,
      contractual_installment_number, is_paid_before_tracking, due_date,
      expected_amount, expected_principal, expected_interest, expected_fees,
      expected_insurance, reported_balance, created_by_user_id
    ) values (
      v_schedule.id, p_debt_id, p_household_id, v_installment_number,
      v_contractual_number, false, v_due_date, v_expected_amount,
      v_expected_principal, v_expected_interest, v_expected_fees,
      v_expected_insurance, v_reported_balance, p_user_id
    );
  end loop;

  return v_schedule;
end;
$function$;

revoke all privileges on function private.debt2b2_create_schedule_lifecycle_v1(uuid, uuid, uuid, date, text, text, jsonb, uuid, text, boolean, boolean)
  from public, anon, authenticated, service_role;

-- Preserve the historical signatures used by prepayment, reversal, and
-- payment code while routing all new rows through the metadata-aware writer.
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
begin
  return private.debt2b2_create_schedule_lifecycle_v1(
    p_household_id,
    p_debt_id,
    p_trigger_event_id,
    p_event_date,
    p_reason,
    p_notes,
    p_schedule_installments,
    p_user_id,
    p_schedule_source,
    p_is_authoritative,
    false
  );
end;
$function$;

revoke all privileges on function private.debt2b2_create_schedule_v2(uuid, uuid, uuid, date, text, text, jsonb, uuid, text, boolean)
  from public, anon, authenticated, service_role;

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
begin
  if p_household_id is null
     or p_debt_id is null
     or p_trigger_event_id is null
     or p_user_id is null
     or p_schedule_source not in ('contractual', 'estimated') then
    raise exception 'INVALID_DEBT_SCHEDULE';
  end if;

  return private.debt2b2_create_schedule_lifecycle_v1(
    p_household_id,
    p_debt_id,
    p_trigger_event_id,
    p_event_date,
    p_reason,
    p_notes,
    p_schedule_installments,
    p_user_id,
    p_schedule_source,
    p_schedule_source = 'contractual',
    true
  );
end;
$function$;

revoke all privileges on function private.debt2b2_create_schedule_v3(uuid, uuid, uuid, date, text, text, jsonb, uuid, text)
  from public, anon, authenticated, service_role;

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
begin
  select s.schedule_source, s.is_authoritative
    into v_source, v_authoritative
    from public.debt_schedule_versions as s
   where s.debt_id = p_debt_id
     and s.household_id = p_household_id
   order by s.version_number desc
   limit 1;

  return private.debt2b2_create_schedule_v2(
    p_household_id,
    p_debt_id,
    p_trigger_event_id,
    p_event_date,
    p_reason,
    p_notes,
    p_schedule_installments,
    p_user_id,
    coalesce(v_source, 'manual'),
    coalesce(v_authoritative, false)
  );
end;
$function$;

revoke all privileges on function private.debt2b2_create_schedule(uuid, uuid, uuid, date, text, text, jsonb, uuid)
  from public, anon, authenticated, service_role;

-- Replay canonicalization includes all persisted schedule metadata. Omitted
-- contractual numbers intentionally canonicalize to the internal number,
-- matching the insert fallback and the onboarding trigger.
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
        'contractual_installment_number', x.contractual_installment_number,
        'due_date', x.due_date,
        'expected_amount', x.expected_amount,
        'expected_principal', x.expected_principal,
        'expected_interest', x.expected_interest,
        'expected_fees', x.expected_fees,
        'expected_insurance', x.expected_insurance,
        'reported_balance', x.reported_balance
      ) order by x.installment_number
    ),
    '[]'::jsonb
  )
    from (
      select
        (value->>'installment_number')::integer as installment_number,
        coalesce(nullif(value->>'contractual_installment_number', '')::integer, (value->>'installment_number')::integer) as contractual_installment_number,
        (value->>'due_date')::date::text as due_date,
        case when value ? 'expected_amount' and value->'expected_amount' <> 'null'::jsonb then (value->>'expected_amount')::numeric else null end as expected_amount,
        case when value ? 'expected_principal' and value->'expected_principal' <> 'null'::jsonb then (value->>'expected_principal')::numeric else null end as expected_principal,
        case when value ? 'expected_interest' and value->'expected_interest' <> 'null'::jsonb then (value->>'expected_interest')::numeric else null end as expected_interest,
        case when value ? 'expected_fees' and value->'expected_fees' <> 'null'::jsonb then (value->>'expected_fees')::numeric else null end as expected_fees,
        case when value ? 'expected_insurance' and value->'expected_insurance' <> 'null'::jsonb then (value->>'expected_insurance')::numeric else null end as expected_insurance,
        case when value ? 'reported_balance' and value->'reported_balance' <> 'null'::jsonb then (value->>'reported_balance')::numeric else null end as reported_balance
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
        'contractual_installment_number', coalesce(i.contractual_installment_number, i.installment_number),
        'due_date', i.due_date::text,
        'expected_amount', i.expected_amount,
        'expected_principal', i.expected_principal,
        'expected_interest', i.expected_interest,
        'expected_fees', i.expected_fees,
        'expected_insurance', i.expected_insurance,
        'reported_balance', i.reported_balance
      ) order by i.installment_number
    ),
    '[]'::jsonb
  )
    from public.debt_installments as i
   where i.schedule_version_id = p_schedule_version_id;
$function$;

-- Only the two public RPCs may use the private schedule writers.
revoke all privileges on function private.debt2b2_canonical_schedule(jsonb)
  from public, anon, authenticated, service_role;
revoke all privileges on function private.debt2b2_persisted_schedule(uuid)
  from public, anon, authenticated, service_role;

-- Official bank schedule replacement. This RPC has no movement or principal
-- mutation path: it attaches a contractual schedule to the original
-- prepayment event and leaves the financial ledger untouched.
create or replace function public.update_bank_prepayment_schedule_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_prepayment_event_id uuid,
  p_effective_date date,
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
  v_event public.debt_events%rowtype;
  v_contractual_schedule public.debt_schedule_versions%rowtype;
  v_schedule_count integer;
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
     or p_prepayment_event_id is null
     or p_effective_date is null
     or p_schedule_installments is null
     or pg_catalog.jsonb_typeof(p_schedule_installments) <> 'array'
     or pg_catalog.jsonb_array_length(p_schedule_installments) = 0 then
    raise exception 'INVALID_DEBT_SCHEDULE';
  end if;

  perform private.debt2b2_lock_operation(null, p_prepayment_event_id);

  select d.*
    into v_debt
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

  select e.*
    into v_event
    from public.debt_events as e
   where e.id = p_prepayment_event_id
     and e.debt_id = p_debt_id
     and e.household_id = p_household_id
   for update;
  if not found then
    raise exception 'DEBT_EVENT_NOT_FOUND';
  end if;
  if not (
    v_event.event_type = 'principal_prepayment'
    or (v_event.event_type = 'payment' and coalesce(v_event.extra_principal_amount, 0) > 0)
  ) then
    raise exception 'DEBT_EVENT_TYPE_UNSUPPORTED';
  end if;
  if exists (
    select 1
      from public.debt_events as reversal
     where reversal.debt_id = p_debt_id
       and reversal.household_id = p_household_id
       and reversal.event_type = 'reversal'
       and reversal.reversal_of_event_id = p_prepayment_event_id
  ) then
    raise exception 'DEBT_EVENT_ALREADY_REVERSED';
  end if;
  if p_effective_date < v_event.event_date then
    raise exception 'INVALID_DEBT_SCHEDULE';
  end if;

  perform private.debt2b2_validate_schedule_v3(
    p_effective_date,
    'prepayment',
    p_schedule_installments
  );

  select s.*
    into v_contractual_schedule
    from public.debt_schedule_versions as s
   where s.debt_id = p_debt_id
     and s.household_id = p_household_id
     and s.trigger_event_id = p_prepayment_event_id
     and s.schedule_source = 'contractual'
   order by s.version_number desc
   limit 1;

  if found then
    if v_contractual_schedule.effective_date is distinct from p_effective_date
       or v_contractual_schedule.notes is distinct from coalesce(p_schedule_notes, '')
       or not coalesce(v_contractual_schedule.is_authoritative, false)
       or private.debt2b2_canonical_schedule(p_schedule_installments)
            is distinct from private.debt2b2_persisted_schedule(v_contractual_schedule.id) then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;
    return private.debt2b2_schedule_result(p_prepayment_event_id, true);
  end if;

  select pg_catalog.count(*)
    into v_schedule_count
    from public.debt_schedule_versions as s
   where s.debt_id = p_debt_id
     and s.household_id = p_household_id
     and s.trigger_event_id = p_prepayment_event_id;
  if v_schedule_count > 0
     and exists (
       select 1
         from public.debt_schedule_versions as s
        where s.debt_id = p_debt_id
          and s.household_id = p_household_id
          and s.trigger_event_id = p_prepayment_event_id
          and s.schedule_source <> 'estimated'
     ) then
    raise exception 'DEBT_EVENT_ID_CONFLICT';
  end if;

  perform private.debt2b2_create_schedule_v3(
    p_household_id,
    p_debt_id,
    p_prepayment_event_id,
    p_effective_date,
    'prepayment',
    p_schedule_notes,
    p_schedule_installments,
    v_user_id,
    'contractual'
  );

  return private.debt2b2_schedule_result(p_prepayment_event_id, false);
end;
$function$;

revoke all privileges on function public.update_bank_prepayment_schedule_v1(uuid, uuid, uuid, date, jsonb, text)
  from public, anon, service_role;
grant execute on function public.update_bank_prepayment_schedule_v1(uuid, uuid, uuid, date, jsonb, text)
  to authenticated;
