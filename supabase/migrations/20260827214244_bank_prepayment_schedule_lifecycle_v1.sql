-- BANK PREPAYMENT RECALCULATION V1: official post-prepayment schedule
-- lifecycle. Forward-only additive fix; historical migrations remain immutable.

-- Reversal-created schedule rows carry obligation coverage through immutable
-- source allocation lineage. The original economic allocations remain in
-- debt_event_installment_allocations; this table is only a normalized
-- obligation read/validation projection for a newly cloned installment row.
alter table public.debt_event_installment_allocations
  drop constraint if exists debt_event_installment_allocations_id_debt_household_key,
  add constraint debt_event_installment_allocations_id_debt_household_key
  unique (id, debt_id, household_id);

create table public.debt_installment_carried_allocations (
  id uuid primary key default gen_random_uuid(),
  restored_installment_id uuid not null,
  source_event_id uuid not null,
  source_allocation_id uuid not null,
  debt_id uuid not null,
  household_id uuid not null,
  allocated_amount numeric not null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint debt_installment_carried_allocations_amount_positive_check
    check (allocated_amount > 0),
  constraint debt_installment_carried_allocations_source_unique
    unique (restored_installment_id, source_allocation_id),
  constraint debt_installment_carried_allocations_installment_fkey
    foreign key (restored_installment_id, debt_id, household_id)
    references public.debt_installments(id, debt_id, household_id)
    on delete restrict,
  constraint debt_installment_carried_allocations_event_fkey
    foreign key (source_event_id, debt_id, household_id)
    references public.debt_events(id, debt_id, household_id)
    on delete restrict,
  constraint debt_installment_carried_allocations_source_allocation_fkey
    foreign key (source_allocation_id, debt_id, household_id)
    references public.debt_event_installment_allocations(id, debt_id, household_id)
    on delete restrict,
  constraint debt_installment_carried_allocations_created_by_user_fkey
    foreign key (created_by_user_id)
    references auth.users(id)
    on delete restrict
);

create index idx_debt_installment_carried_allocations_restored_installment
  on public.debt_installment_carried_allocations (restored_installment_id);
create index idx_debt_installment_carried_allocations_source_event
  on public.debt_installment_carried_allocations (source_event_id);

alter table public.debt_installment_carried_allocations enable row level security;
revoke all privileges on table public.debt_installment_carried_allocations
  from public, anon, authenticated, service_role;
grant select on table public.debt_installment_carried_allocations to authenticated;

create policy debt_installment_carried_allocations_select_member
  on public.debt_installment_carried_allocations
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.household_members as hm
       where hm.household_id = debt_installment_carried_allocations.household_id
         and hm.user_id = (select auth.uid())
    )
  );

-- Carried coverage is never authoritative by itself. Resolve it through the
-- original allocation and event every time so a later source-event reversal
-- immediately removes that contribution without deleting append-only rows.
create or replace function private.debt2b2_effective_carried_amount(
  p_household_id uuid,
  p_debt_id uuid,
  p_installment_id uuid
)
returns numeric
language sql
security invoker
set search_path = ''
as $function$
  select coalesce(pg_catalog.sum(c.allocated_amount), 0::numeric)
    from public.debt_installment_carried_allocations as c
    join public.debt_event_installment_allocations as a
      on a.id = c.source_allocation_id
     and a.event_id = c.source_event_id
     and a.debt_id = c.debt_id
     and a.household_id = c.household_id
    join public.debt_events as e
      on e.id = c.source_event_id
     and e.debt_id = c.debt_id
     and e.household_id = c.household_id
   where c.restored_installment_id = p_installment_id
     and c.debt_id = p_debt_id
     and c.household_id = p_household_id
     and e.event_type in ('payment', 'installment_advance')
     and not exists (
       select 1
         from public.debt_events as r
        where r.debt_id = e.debt_id
          and r.household_id = e.household_id
          and r.event_type = 'reversal'
          and r.reversal_of_event_id = e.id
     );
$function$;

revoke all privileges on function private.debt2b2_effective_carried_amount(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.debt2b2_carried_allocations_for_schedule(
  p_household_id uuid,
  p_debt_id uuid,
  p_schedule_version_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) order by c.created_at, c.id),
    '[]'::jsonb
  )
    from public.debt_installment_carried_allocations as c
    join public.debt_installments as i
      on i.id = c.restored_installment_id
     and i.debt_id = c.debt_id
     and i.household_id = c.household_id
   where c.debt_id = p_debt_id
     and c.household_id = p_household_id
     and i.schedule_version_id = p_schedule_version_id;
$function$;

revoke all privileges on function private.debt2b2_carried_allocations_for_schedule(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

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
  v_has_contractual_number boolean := false;
  v_has_missing_contractual_number boolean := false;
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
    if v_contractual_number is null then
      v_has_missing_contractual_number := true;
    else
      v_has_contractual_number := true;
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
      or (p_reason <> 'reversal' and v_due_date <= p_event_date)
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
  if v_has_contractual_number and v_has_missing_contractual_number then
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
  v_has_contractual_number boolean := false;
  v_has_missing_contractual_number boolean := false;
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
    if v_contractual_number is null then
      v_has_missing_contractual_number := true;
    else
      v_has_contractual_number := true;
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
  if v_has_contractual_number and v_has_missing_contractual_number then
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
    coalesce(v_authoritative, true)
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

-- A schedule version is a dependency only while the event lineage that
-- generated it is effective. Keep this helper before every public RPC that
-- uses it, including the official prepayment target guard below. Unknown or
-- orphaned triggers remain effective conservatively.
create or replace function private.debt2b2_is_effective_schedule_trigger(
  p_household_id uuid,
  p_debt_id uuid,
  p_trigger_event_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_trigger public.debt_events%rowtype;
  v_parent public.debt_events%rowtype;
begin
  if p_trigger_event_id is null then
    return true;
  end if;

  select e.*
    into v_trigger
    from public.debt_events as e
   where e.id = p_trigger_event_id
     and e.debt_id = p_debt_id
     and e.household_id = p_household_id;
  if not found then
    return true;
  end if;

  if v_trigger.event_type = 'reversal' then
    if v_trigger.reversal_of_event_id is null then
      return true;
    end if;

    select e.*
      into v_parent
      from public.debt_events as e
     where e.id = v_trigger.reversal_of_event_id
       and e.debt_id = p_debt_id
       and e.household_id = p_household_id;
    if not found then
      return true;
    end if;

    -- A reversal schedule is an undo branch, not a new dependency root,
    -- once its parent is demonstrably reversed (including this trigger).
    return not exists (
      select 1
        from public.debt_events as parent_reversal
       where parent_reversal.debt_id = p_debt_id
         and parent_reversal.household_id = p_household_id
         and parent_reversal.event_type = 'reversal'
         and parent_reversal.reversal_of_event_id = v_parent.id
    );
  end if;

  return not exists (
    select 1
      from public.debt_events as reversal
     where reversal.debt_id = p_debt_id
       and reversal.household_id = p_household_id
       and reversal.event_type = 'reversal'
       and reversal.reversal_of_event_id = v_trigger.id
  );
end;
$function$;

revoke all privileges on function private.debt2b2_is_effective_schedule_trigger(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- Every strict post-operation schedule represents the complete remaining
-- principal. Validate its principal total against the live event ledger; this
-- helper only rejects mismatches and never mutates financial state.
create or replace function private.debt2b2_validate_schedule_principal_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_schedule_installments jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_schedule_principal numeric;
  v_current_principal numeric;
begin
  if p_schedule_installments is null
     or pg_catalog.jsonb_typeof(p_schedule_installments) <> 'array'
     or pg_catalog.jsonb_array_length(p_schedule_installments) = 0
     or exists (
       select 1
         from pg_catalog.jsonb_array_elements(p_schedule_installments) as item(value)
        where item.value->'expected_principal' is null
           or item.value->'expected_principal' = 'null'::pg_catalog.jsonb
           or pg_catalog.jsonb_typeof(item.value->'expected_principal') <> 'number'
     ) then
    raise exception 'INVALID_DEBT_SCHEDULE';
  end if;

  select coalesce(pg_catalog.sum((item.value->>'expected_principal')::numeric), 0::numeric)
    into v_schedule_principal
    from pg_catalog.jsonb_array_elements(p_schedule_installments) as item(value);

  v_current_principal := private.debt2b2_current_principal(p_household_id, p_debt_id);
  if pg_catalog.abs(
       pg_catalog.round(v_schedule_principal, 2)
       - pg_catalog.round(coalesce(v_current_principal, 0::numeric), 2)
     ) > 0.01 then
    raise exception 'DEBT_PREPAYMENT_SCHEDULE_NOT_CURRENT';
  end if;
end;
$function$;

revoke all privileges on function private.debt2b2_validate_schedule_principal_v1(uuid, uuid, jsonb)
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
  v_latest_later_event public.debt_events%rowtype;
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
  if v_debt.repayment_structure <> 'fixed_schedule' then
    raise exception 'DEBT_REPAYMENT_STRUCTURE_UNSUPPORTED';
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

  -- A stale tab must not attach an official schedule to an old prepayment
  -- after a later effective prepayment has already changed the debt state.
  -- Event ordering is deliberately stable: business date, creation time, id.
  if exists (
    select 1
      from public.debt_events as later_event
     where later_event.debt_id = p_debt_id
       and later_event.household_id = p_household_id
       and later_event.id is distinct from p_prepayment_event_id
        and (
         later_event.event_type = 'principal_prepayment'
         or (later_event.event_type = 'payment' and coalesce(later_event.extra_principal_amount, 0) > 0)
       )
       and not exists (
         select 1
           from public.debt_events as reversal
          where reversal.debt_id = later_event.debt_id
            and reversal.household_id = later_event.household_id
            and reversal.event_type = 'reversal'
            and reversal.reversal_of_event_id = later_event.id
       )
       and (
         later_event.event_date > v_event.event_date
         or (
           later_event.event_date = v_event.event_date
           and (
             later_event.created_at > v_event.created_at
             or (later_event.created_at = v_event.created_at and later_event.id > v_event.id)
           )
          )
        )
    ) then
    raise exception 'DEBT_PREPAYMENT_SCHEDULE_TARGET_STALE';
  end if;

  -- A later contractual schedule caused by another trigger is also a newer
  -- contractual state. Keep the same-target replay above before this guard:
  -- an exact replay remains idempotent even when a later version exists.
  if exists (
    select 1
      from public.debt_schedule_versions as later_schedule
      left join public.debt_events as trigger_event
        on trigger_event.id = later_schedule.trigger_event_id
       and trigger_event.debt_id = later_schedule.debt_id
       and trigger_event.household_id = later_schedule.household_id
     where later_schedule.debt_id = p_debt_id
       and later_schedule.household_id = p_household_id
       and later_schedule.schedule_source = 'contractual'
       and later_schedule.trigger_event_id is distinct from p_prepayment_event_id
       and (
         (
           trigger_event.id is not null
           and (
             trigger_event.event_date > v_event.event_date
             or (
               trigger_event.event_date = v_event.event_date
               and (
                 trigger_event.created_at > v_event.created_at
                 or (trigger_event.created_at = v_event.created_at and trigger_event.id > v_event.id)
               )
             )
           )
         )
         or (
           trigger_event.id is null
           and (
             later_schedule.effective_date > v_event.event_date
             or (
               later_schedule.effective_date = v_event.event_date
               and later_schedule.created_at > v_event.created_at
             )
           )
          )
        )
        and private.debt2b2_is_effective_schedule_trigger(
          p_household_id,
          p_debt_id,
          later_schedule.trigger_event_id
        )
    ) then
     raise exception 'DEBT_PREPAYMENT_SCHEDULE_TARGET_STALE';
   end if;

  -- Regular payments and installment advances do not make the target stale by
  -- themselves, but the bank document must be dated no earlier than the last
  -- effective one. Principal reconciliation below remains the authority when
  -- events share a DATE or the document date is otherwise ambiguous.
  select later_event.*
    into v_latest_later_event
    from public.debt_events as later_event
   where later_event.debt_id = p_debt_id
     and later_event.household_id = p_household_id
     and later_event.event_type in ('payment', 'installment_advance', 'principal_prepayment', 'payoff')
     and (
       later_event.event_date > v_event.event_date
       or (
         later_event.event_date = v_event.event_date
         and (
           later_event.created_at > v_event.created_at
           or (later_event.created_at = v_event.created_at and later_event.id > v_event.id)
         )
       )
     )
     and not exists (
       select 1
         from public.debt_events as reversal
        where reversal.debt_id = later_event.debt_id
          and reversal.household_id = later_event.household_id
          and reversal.event_type = 'reversal'
          and reversal.reversal_of_event_id = later_event.id
     )
   order by later_event.event_date desc, later_event.created_at desc, later_event.id desc
   limit 1;

  if found
     and v_latest_later_event.event_type in ('payment', 'installment_advance')
     and p_effective_date < v_latest_later_event.event_date then
    raise exception 'DEBT_PREPAYMENT_SCHEDULE_NOT_CURRENT';
  end if;

  -- The official upload is schedule-only, but it must still represent the
  -- complete live principal after all effective financial activity.
  perform private.debt2b2_validate_schedule_principal_v1(
    p_household_id,
    p_debt_id,
    p_schedule_installments
  );

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

-- Restore a schedule from the locked baseline instead of trusting the
-- client-provided replay payload as the source of row state. The payload is
-- still canonical-checked by reverse_debt_event_v1; this helper copies the
-- persisted baseline fields and carries only effective, pre-target direct
-- allocations. No allocation, movement, or economic ledger row is created.
create or replace function private.debt2b2_restore_schedule_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_reversal_event_id uuid,
  p_target_event_id uuid,
  p_event_date date,
  p_notes text,
  p_baseline_schedule_id uuid,
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
  v_target public.debt_events%rowtype;
  v_baseline public.debt_schedule_versions%rowtype;
  v_baseline_installment public.debt_installments%rowtype;
  v_restored_installment_id uuid;
begin
  select s.*
    into v_baseline
    from public.debt_schedule_versions as s
   where s.id = p_baseline_schedule_id
     and s.debt_id = p_debt_id
     and s.household_id = p_household_id
   for update;
  if not found then
    raise exception 'DEBT_REVERSAL_SCHEDULE_NOT_FOUND';
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
    'reversal',
    coalesce(p_schedule_source, v_baseline.schedule_source, 'manual'),
    coalesce(p_is_authoritative, v_baseline.is_authoritative, false),
    p_reversal_event_id,
    coalesce(p_notes, ''),
    p_user_id
    from public.debt_schedule_versions as s
   where s.debt_id = p_debt_id
     and s.household_id = p_household_id
  returning * into v_schedule;

  for v_baseline_installment in
    select i.*
      from public.debt_installments as i
     where i.schedule_version_id = v_baseline.id
       and i.debt_id = p_debt_id
       and i.household_id = p_household_id
     order by i.installment_number
  loop
    insert into public.debt_installments (
      schedule_version_id, debt_id, household_id, installment_number,
      contractual_installment_number, is_paid_before_tracking, due_date,
      expected_amount, expected_principal, expected_interest, expected_fees,
      expected_insurance, reported_balance,
      created_by_user_id
    ) values (
      v_schedule.id,
      p_debt_id,
      p_household_id,
      v_baseline_installment.installment_number,
      coalesce(v_baseline_installment.contractual_installment_number, v_baseline_installment.installment_number),
      coalesce(v_baseline_installment.is_paid_before_tracking, false),
      v_baseline_installment.due_date,
      v_baseline_installment.expected_amount,
      v_baseline_installment.expected_principal,
      v_baseline_installment.expected_interest,
      v_baseline_installment.expected_fees,
      v_baseline_installment.expected_insurance,
      v_baseline_installment.reported_balance,
      p_user_id
    ) returning id into v_restored_installment_id;

    -- Flatten inherited lineage plus direct allocations on the baseline.
    -- The original allocation row is the identity and amount authority, so a
    -- nested restore cannot turn one source allocation into E0:80.
    insert into public.debt_installment_carried_allocations (
      restored_installment_id,
      source_event_id,
      source_allocation_id,
      debt_id,
      household_id,
      allocated_amount,
      created_by_user_id
    )
    select
      v_restored_installment_id,
      sources.source_event_id,
      sources.source_allocation_id,
      p_debt_id,
      p_household_id,
      max(sources.allocated_amount),
      p_user_id
      from (
        select
          a.event_id as source_event_id,
          a.id as source_allocation_id,
          max(a.allocated_amount) as allocated_amount
          from public.debt_installment_carried_allocations as inherited
          join public.debt_event_installment_allocations as a
            on a.id = inherited.source_allocation_id
           and a.event_id = inherited.source_event_id
           and a.debt_id = inherited.debt_id
           and a.household_id = inherited.household_id
          join public.debt_events as e
            on e.id = a.event_id
           and e.debt_id = a.debt_id
           and e.household_id = a.household_id
         where inherited.restored_installment_id = v_baseline_installment.id
           and inherited.debt_id = p_debt_id
           and inherited.household_id = p_household_id
           and e.event_type in ('payment', 'installment_advance')
           and (
             e.event_date < v_target.event_date
             or (e.event_date = v_target.event_date and e.created_at < v_target.created_at)
             or (e.event_date = v_target.event_date and e.created_at = v_target.created_at and e.id < v_target.id)
           )
           and not exists (
             select 1
               from public.debt_events as r
              where r.debt_id = e.debt_id
                and r.household_id = e.household_id
                and r.event_type = 'reversal'
                and r.reversal_of_event_id = e.id
           )
         group by a.event_id, a.id

        union all

        select
          a.event_id as source_event_id,
          a.id as source_allocation_id,
          max(a.allocated_amount) as allocated_amount
          from public.debt_event_installment_allocations as a
          join public.debt_events as e
            on e.id = a.event_id
           and e.debt_id = a.debt_id
           and e.household_id = a.household_id
         where a.installment_id = v_baseline_installment.id
           and a.debt_id = p_debt_id
           and a.household_id = p_household_id
           and e.event_type in ('payment', 'installment_advance')
           and (
             e.event_date < v_target.event_date
             or (e.event_date = v_target.event_date and e.created_at < v_target.created_at)
             or (e.event_date = v_target.event_date and e.created_at = v_target.created_at and e.id < v_target.id)
           )
           and not exists (
             select 1
               from public.debt_events as r
              where r.debt_id = e.debt_id
                and r.household_id = e.household_id
                and r.event_type = 'reversal'
                and r.reversal_of_event_id = e.id
           )
         group by a.event_id, a.id
      ) as sources
     group by sources.source_event_id, sources.source_allocation_id;

    -- The V3 metadata trigger intentionally clears pretracking flags on
    -- ordinary later versions. A restoration is the explicit exception: its
    -- persisted baseline state is restored immediately after insertion.
    update public.debt_installments
       set is_paid_before_tracking = coalesce(v_baseline_installment.is_paid_before_tracking, false)
     where id = v_restored_installment_id
       and debt_id = p_debt_id
       and household_id = p_household_id;
  end loop;

  return v_schedule;
end;
$function$;

revoke all privileges on function private.debt2b2_restore_schedule_v1(uuid, uuid, uuid, uuid, date, text, uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;

-- Return carried lineage alongside operation rows so an authoritative sync can
-- adopt a restored schedule without waiting for a second refresh.
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
    'installments', v_installments,
    'carriedAllocations', private.debt2b2_carried_allocations_for_schedule(
      v_event.household_id,
      v_event.debt_id,
      v_schedule.id
    )
  );
end;
$function$;

revoke all privileges on function private.debt2b2_schedule_result(uuid, boolean)
  from public, anon, authenticated, service_role;

create or replace function private.debt2b2_fund_result(
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
    'installments', v_installments,
    'carriedAllocations', private.debt2b2_carried_allocations_for_schedule(
      v_event.household_id,
      v_event.debt_id,
      v_schedule.id
    )
  );
end;
$function$;

revoke all privileges on function private.debt2b2_fund_result(uuid, boolean)
  from public, anon, authenticated, service_role;

create or replace function private.debt2b2_reversal_result(
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
    'installments', v_installments,
    'carriedAllocations', private.debt2b2_carried_allocations_for_schedule(
      v_event.household_id,
      v_event.debt_id,
      v_schedule.id
    )
  );
end;
$function$;

revoke all privileges on function private.debt2b2_reversal_result(uuid, boolean)
  from public, anon, authenticated, service_role;

-- Final Audit 4 fix: reverse against the schedule before the first target-triggered version.
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
  v_first_target_schedule_version integer;
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

  -- A schedule-generating event is a dependency root. Reversals are LIFO:
  -- later effective financial events and later unrelated schedule versions
  -- must be reversed/handled before this target. Exact replay stays above
  -- this guard so a previously completed reversal remains idempotent.
  if v_target_has_schedule and exists (
    select 1
      from public.debt_events as later_event
     where later_event.debt_id = p_debt_id
       and later_event.household_id = p_household_id
       and later_event.event_type in ('payment', 'principal_prepayment', 'payoff', 'installment_advance')
       and (
         later_event.event_date > v_target.event_date
         or (later_event.event_date = v_target.event_date and later_event.created_at > v_target.created_at)
         or (later_event.event_date = v_target.event_date and later_event.created_at = v_target.created_at and later_event.id > v_target.id)
       )
       and not exists (
         select 1
           from public.debt_events as later_reversal
          where later_reversal.debt_id = p_debt_id
            and later_reversal.household_id = p_household_id
            and later_reversal.event_type = 'reversal'
            and later_reversal.reversal_of_event_id = later_event.id
       )
  ) then
    raise exception 'DEBT_REVERSAL_HAS_LATER_DEPENDENCIES';
  end if;

  if v_target_has_schedule and exists (
    select 1
      from public.debt_schedule_versions as later_schedule
     where later_schedule.debt_id = p_debt_id
       and later_schedule.household_id = p_household_id
       and later_schedule.version_number > v_target_schedule.version_number
       and later_schedule.trigger_event_id is distinct from p_target_event_id
       and private.debt2b2_is_effective_schedule_trigger(
         p_household_id,
         p_debt_id,
         later_schedule.trigger_event_id
       )
  ) then
    raise exception 'DEBT_REVERSAL_HAS_LATER_DEPENDENCIES';
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
    select pg_catalog.min(s.version_number)
      into v_first_target_schedule_version
      from public.debt_schedule_versions as s
     where s.debt_id = p_debt_id
       and s.household_id = p_household_id
       and s.trigger_event_id = p_target_event_id;

    select s.* into v_previous_schedule
      from public.debt_schedule_versions as s
     where s.debt_id = p_debt_id
       and s.household_id = p_household_id
       and s.version_number < v_first_target_schedule_version
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

    -- Restore the exact baseline metadata as well as its rows. The baseline
    -- may be contractual, reconstructed, estimated, or legacy manual. The
    -- dedicated restore writer also carries effective baseline coverage and
    -- preserves pretracking state without duplicating financial rows.
    perform private.debt2b2_restore_schedule_v1(
      p_household_id,
      p_debt_id,
      p_reversal_event_id,
      p_target_event_id,
      p_event_date,
      p_schedule_notes,
      v_previous_schedule.id,
      v_user_id,
      coalesce(v_previous_schedule.schedule_source, 'manual'),
      coalesce(v_previous_schedule.is_authoritative, false)
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

-- Restored rows have carried coverage but no duplicated allocation rows. Keep
-- the allocation SSOT and its overage guard aware of both sources.
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

    select
      private.debt2b2_effective_carried_amount(p_household_id, p_debt_id, v_installment_id)
      + coalesce(pg_catalog.sum(a.allocated_amount), 0::numeric)
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

revoke all privileges on function private.debt2b2_insert_allocations(uuid, uuid, uuid, uuid, numeric, jsonb, uuid)
  from public, anon, authenticated, service_role;

-- Installment advances use the same carried-plus-direct coverage when
-- locating the first unpaid installment and when rejecting a second advance.
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
     and i.due_date > p_event_date
     and not coalesce(i.is_paid_before_tracking, false);

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
     and not coalesce(i.is_paid_before_tracking, false)
     and i.expected_amount is not null
       and i.expected_amount > private.debt2b2_effective_carried_amount(p_household_id, p_debt_id, i.id) + coalesce((
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
       where private.debt2b2_effective_carried_amount(p_household_id, p_debt_id, i.id) + coalesce((
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

revoke all privileges on function private.debt2b2_validate_advance_allocations(uuid, uuid, uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, jsonb)
  from public, anon, authenticated, service_role;

-- Re-define the two BANK V3 operation boundaries after the shared lifecycle
-- helpers. New operations validate the complete resulting principal before
-- persisting a supplied schedule; exact replays return after the persisted
-- payload comparison and never compare an old schedule with today's balance.
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
  -- uses the same transaction, so all new-operation checks are atomic.
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

    -- V2 has already recorded the event and movement in this transaction, so
    -- current_principal is the principal after this payment/extra principal.
    perform private.debt2b2_validate_schedule_principal_v1(
      p_household_id,
      p_debt_id,
      p_schedule_installments
    );

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
  v_is_replay boolean;
  v_debt_kind text;
  v_repayment_structure text;
  v_result_schedule_source text;
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

  -- V2 owns the financial persistence. Its replay path compares the exact
  -- persisted event/schedule payload before this wrapper can inspect balance.
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

  v_is_replay := coalesce((v_result->>'idempotentReplay')::boolean, false);
  if v_is_replay then
    return v_result;
  end if;

  if v_schedule_count > 0 then
    v_result_schedule_source := v_result->'scheduleVersion'->>'schedule_source';
    if coalesce(v_result_schedule_source, p_schedule_source) in ('contractual', 'estimated') then
      -- V2 has already recorded the prepayment, so this is the resulting live
      -- principal. Any mismatch rolls back the complete V2 transaction.
      perform private.debt2b2_validate_schedule_principal_v1(
        p_household_id,
        p_debt_id,
        p_schedule_installments
      );
    end if;
  end if;

  return v_result;
end;
$function$;

revoke all privileges on function public.record_debt_prepayment_v3(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, text, boolean, jsonb, text, text)
  from public, anon, service_role;
grant execute on function public.record_debt_prepayment_v3(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, text, boolean, jsonb, text, text)
  to authenticated;
