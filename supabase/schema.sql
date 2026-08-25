


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";





SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."debt_schedule_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "debt_id" "uuid" NOT NULL,
    "household_id" "uuid" NOT NULL,
    "version_number" integer NOT NULL,
    "effective_date" "date" NOT NULL,
    "reason" "text" NOT NULL,
    "trigger_event_id" "uuid",
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "created_by_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "schedule_source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "is_authoritative" boolean DEFAULT true NOT NULL,
    CONSTRAINT "debt_schedule_versions_reason_check" CHECK (("reason" = ANY (ARRAY['initial'::"text", 'prepayment'::"text", 'rate_change'::"text", 'refinance'::"text", 'manual_adjustment'::"text", 'reversal'::"text"]))),
    CONSTRAINT "debt_schedule_versions_schedule_source_check" CHECK (("schedule_source" = ANY (ARRAY['contractual'::"text", 'estimated'::"text", 'manual'::"text"]))),
    CONSTRAINT "debt_schedule_versions_version_positive_check" CHECK (("version_number" > 0))
);


ALTER TABLE "public"."debt_schedule_versions" OWNER TO "postgres";


COMMENT ON TABLE "public"."debt_schedule_versions" IS 'Cronogramas versionados (append-only): nunca se sobrescriben. La versión vigente es la de mayor version_number. Si un evento que originó un cambio de cronograma es revertido, DEBT-2 debe crear en la misma operación una NUEVA versión superior que represente el cronograma restaurado/corregido. Nunca se reactiva ni modifica una versión antigua: MAX(version_number) sigue siendo la SSOT. Sin implementar todavía.';



CREATE OR REPLACE FUNCTION "private"."debt2b2_create_schedule"("p_household_id" "uuid", "p_debt_id" "uuid", "p_trigger_event_id" "uuid", "p_event_date" "date", "p_reason" "text", "p_notes" "text", "p_schedule_installments" "jsonb", "p_user_id" "uuid") RETURNS "public"."debt_schedule_versions"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
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
$_$;


ALTER FUNCTION "private"."debt2b2_create_schedule"("p_household_id" "uuid", "p_debt_id" "uuid", "p_trigger_event_id" "uuid", "p_event_date" "date", "p_reason" "text", "p_notes" "text", "p_schedule_installments" "jsonb", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."debt2b2_current_principal"("p_household_id" "uuid", "p_debt_id" "uuid") RETURNS numeric
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "private"."debt2b2_current_principal"("p_household_id" "uuid", "p_debt_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."debt2b2_fund_result"("p_event_id" "uuid", "p_idempotent_replay" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "private"."debt2b2_fund_result"("p_event_id" "uuid", "p_idempotent_replay" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."debt2b2_insert_allocations"("p_event_id" "uuid", "p_debt_id" "uuid", "p_household_id" "uuid", "p_user_id" "uuid", "p_cash_amount" numeric, "p_allocations" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_elem pg_catalog.jsonb;
  v_inst_id uuid;
  v_alloc_amt numeric;
  v_inst public.debt_installments%rowtype;
  v_total_alloc numeric := 0;
  v_current_sched public.debt_schedule_versions%rowtype;
  v_allocated_before numeric;
begin
  select s.*
    into v_current_sched
    from public.debt_schedule_versions as s
   where s.debt_id = p_debt_id
     and s.household_id = p_household_id
   order by s.version_number desc
   limit 1;

  for v_elem in
    select e.value
      from pg_catalog.jsonb_array_elements(p_allocations) as e
  loop
    v_inst_id := (v_elem->>'installment_id')::uuid;
    v_alloc_amt := (v_elem->>'allocated_amount')::numeric;

    if v_inst_id is null or v_alloc_amt is null or v_alloc_amt <= 0 then
      raise exception 'INVALID_DEBT_ALLOCATION';
    end if;

    select i.*
      into v_inst
      from public.debt_installments as i
     where i.id = v_inst_id
       and i.debt_id = p_debt_id
       and i.household_id = p_household_id;
    if not found then
      raise exception 'INVALID_DEBT_ALLOCATION';
    end if;

    if v_current_sched.id is null or v_inst.schedule_version_id <> v_current_sched.id then
      raise exception 'INVALID_DEBT_ALLOCATION';
    end if;

    -- SSOT: sum allocations from active payments AND installment advances
    select coalesce(pg_catalog.sum(a.allocated_amount), 0::numeric)
      into v_allocated_before
      from public.debt_event_installment_allocations as a
      join public.debt_events as e on e.id = a.event_id
     where a.installment_id = v_inst_id
       and a.household_id = p_household_id
       and e.event_type in ('payment', 'installment_advance')
       and not exists (
         select 1
           from public.debt_events as r
          where r.household_id = e.household_id
            and r.debt_id = e.debt_id
            and r.event_type = 'reversal'
            and r.reversal_of_event_id = e.id
       );

    if v_inst.expected_amount is not null
       and (v_allocated_before + v_alloc_amt) > v_inst.expected_amount then
      raise exception 'INVALID_DEBT_ALLOCATION';
    end if;

    insert into public.debt_event_installment_allocations (
      event_id, installment_id, debt_id, household_id, allocated_amount, created_by_user_id, created_at
    ) values (
      p_event_id, v_inst_id, p_debt_id, p_household_id, v_alloc_amt, p_user_id, now()
    );

    v_total_alloc := v_total_alloc + v_alloc_amt;
  end loop;

  if v_total_alloc > p_cash_amount then
    raise exception 'INVALID_DEBT_ALLOCATION';
  end if;
end;
$$;


ALTER FUNCTION "private"."debt2b2_insert_allocations"("p_event_id" "uuid", "p_debt_id" "uuid", "p_household_id" "uuid", "p_user_id" "uuid", "p_cash_amount" numeric, "p_allocations" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."debt2b2_insert_allocations"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_schedule_version_id" "uuid", "p_cash_amount" numeric, "p_allocations" "jsonb", "p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "private"."debt2b2_insert_allocations"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_schedule_version_id" "uuid", "p_cash_amount" numeric, "p_allocations" "jsonb", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."debt2b2_lock_operation"("p_movement_id" "text", "p_event_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "private"."debt2b2_lock_operation"("p_movement_id" "text", "p_event_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."movements" (
    "id" "text" NOT NULL,
    "household_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "date" "date" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "description" "text" NOT NULL,
    "method" "text" NOT NULL,
    "category" "text" NOT NULL,
    "person" "text" NOT NULL,
    "registered_by_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "account_id" "uuid",
    "movement_context" "text" DEFAULT 'standard'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "movements_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "movements_method_check" CHECK (("method" = ANY (ARRAY['efectivo'::"text", 'Yape'::"text", 'transferencia'::"text", 'tarjeta'::"text"]))),
    CONSTRAINT "movements_movement_context_check" CHECK (("movement_context" = ANY (ARRAY['standard'::"text", 'debt_service'::"text", 'credit_card_purchase'::"text", 'credit_card_payment'::"text", 'credit_card_fee'::"text", 'credit_card_credit'::"text"]))),
    CONSTRAINT "movements_type_check" CHECK (("type" = ANY (ARRAY['ingreso'::"text", 'egreso'::"text"])))
);


ALTER TABLE "public"."movements" OWNER TO "postgres";


COMMENT ON COLUMN "public"."movements"."movement_context" IS 'Clasifica el contexto financiero del movimiento: standard es un movimiento normal; debt_service queda reservado para futuras RPC Debt SECURITY DEFINER. Es inmutable y no cambia la semantica de cash-flow del movimiento.';



CREATE OR REPLACE FUNCTION "private"."debt2b2_prepare_movement"("p_household_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_user_id" "uuid", "p_person" "text") RETURNS "public"."movements"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "private"."debt2b2_prepare_movement"("p_household_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_user_id" "uuid", "p_person" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."debts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "household_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "creditor_name" "text" NOT NULL,
    "debt_kind" "text" NOT NULL,
    "currency_code" "text" DEFAULT 'PEN'::"text" NOT NULL,
    "origin_date" "date",
    "tracking_start_date" "date" NOT NULL,
    "original_principal" numeric,
    "opening_principal_balance" numeric NOT NULL,
    "planned_installment_count" integer,
    "planned_installment_amount" numeric,
    "installment_amount_mode" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "payment_frequency" "text",
    "custom_frequency_days" integer,
    "first_due_date" "date",
    "tea_percent" numeric,
    "tcea_percent" numeric,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "created_by_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "repayment_structure" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "interest_calculation_mode" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "periodic_rate_percent" numeric,
    "periodic_rate_basis" "text",
    "minimum_principal_payment" numeric,
    CONSTRAINT "debts_creditor_name_not_blank_check" CHECK (("btrim"("creditor_name") <> ''::"text")),
    CONSTRAINT "debts_currency_code_format_check" CHECK (("currency_code" ~ '^[A-Z]{3}$'::"text")),
    CONSTRAINT "debts_custom_frequency_days_only_custom_check" CHECK (((("payment_frequency" = 'custom'::"text") AND ("custom_frequency_days" IS NOT NULL)) OR (("payment_frequency" IS DISTINCT FROM 'custom'::"text") AND ("custom_frequency_days" IS NULL)))),
    CONSTRAINT "debts_custom_frequency_days_positive_check" CHECK ((("custom_frequency_days" IS NULL) OR ("custom_frequency_days" > 0))),
    CONSTRAINT "debts_debt_kind_check" CHECK (("debt_kind" = ANY (ARRAY['bank_loan'::"text", 'family_loan'::"text", 'installment_purchase'::"text", 'mortgage'::"text", 'pledge'::"text", 'credit_card'::"text", 'other'::"text"]))),
    CONSTRAINT "debts_installment_amount_mode_check" CHECK (("installment_amount_mode" = ANY (ARRAY['fixed'::"text", 'variable'::"text", 'unknown'::"text"]))),
    CONSTRAINT "debts_interest_calculation_mode_check" CHECK (("interest_calculation_mode" = ANY (ARRAY['contract_schedule'::"text", 'contract_periodic_rate'::"text", 'tea_estimate'::"text", 'manual'::"text", 'unknown'::"text"]))),
    CONSTRAINT "debts_minimum_principal_payment_check" CHECK ((("minimum_principal_payment" IS NULL) OR ("minimum_principal_payment" > (0)::numeric))),
    CONSTRAINT "debts_mode_rate_coherence_check" CHECK (((("interest_calculation_mode" <> 'contract_periodic_rate'::"text") OR (("periodic_rate_percent" IS NOT NULL) AND ("periodic_rate_percent" > (0)::numeric) AND ("periodic_rate_basis" IS NOT NULL))) AND (("interest_calculation_mode" <> 'tea_estimate'::"text") OR (("tea_percent" IS NOT NULL) AND ("tea_percent" > (0)::numeric))))),
    CONSTRAINT "debts_name_not_blank_check" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "debts_opening_principal_balance_non_negative_check" CHECK (("opening_principal_balance" >= (0)::numeric)),
    CONSTRAINT "debts_origin_before_tracking_check" CHECK ((("origin_date" IS NULL) OR ("origin_date" <= "tracking_start_date"))),
    CONSTRAINT "debts_original_principal_positive_check" CHECK ((("original_principal" IS NULL) OR ("original_principal" > (0)::numeric))),
    CONSTRAINT "debts_payment_frequency_check" CHECK ((("payment_frequency" IS NULL) OR ("payment_frequency" = ANY (ARRAY['monthly'::"text", 'biweekly'::"text", 'weekly'::"text", 'custom'::"text"])))),
    CONSTRAINT "debts_periodic_rate_basis_check" CHECK ((("periodic_rate_basis" IS NULL) OR ("periodic_rate_basis" = ANY (ARRAY['monthly'::"text", 'biweekly'::"text", 'weekly'::"text", 'daily'::"text"])))),
    CONSTRAINT "debts_periodic_rate_percent_positive_check" CHECK ((("periodic_rate_percent" IS NULL) OR ("periodic_rate_percent" >= (0)::numeric))),
    CONSTRAINT "debts_planned_installment_amount_positive_check" CHECK ((("planned_installment_amount" IS NULL) OR ("planned_installment_amount" > (0)::numeric))),
    CONSTRAINT "debts_planned_installment_count_positive_check" CHECK ((("planned_installment_count" IS NULL) OR ("planned_installment_count" > 0))),
    CONSTRAINT "debts_repayment_structure_check" CHECK (("repayment_structure" = ANY (ARRAY['fixed_schedule'::"text", 'open_ended'::"text", 'unknown'::"text"]))),
    CONSTRAINT "debts_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'paid_off'::"text", 'refinanced'::"text"]))),
    CONSTRAINT "debts_tcea_percent_non_negative_check" CHECK ((("tcea_percent" IS NULL) OR ("tcea_percent" >= (0)::numeric))),
    CONSTRAINT "debts_tea_percent_non_negative_check" CHECK ((("tea_percent" IS NULL) OR ("tea_percent" >= (0)::numeric)))
);


ALTER TABLE "public"."debts" OWNER TO "postgres";


COMMENT ON COLUMN "public"."debts"."debt_kind" IS 'credit_card está reservado para DEBT-5 y no implica funcionalidad de tarjetas en esta migración.';



COMMENT ON COLUMN "public"."debts"."tracking_start_date" IS 'Inicio del seguimiento. Forma parte del baseline financiero bloqueado por protect_debt_financial_baseline.';



COMMENT ON COLUMN "public"."debts"."opening_principal_balance" IS 'Saldo de principal al comenzar el seguimiento (baseline). No es un saldo mutable: queda bloqueado al existir el primer event.';



CREATE OR REPLACE FUNCTION "private"."debt2b2_reconcile_status"("p_household_id" "uuid", "p_debt_id" "uuid", "p_current_principal" numeric) RETURNS "public"."debts"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "private"."debt2b2_reconcile_status"("p_household_id" "uuid", "p_debt_id" "uuid", "p_current_principal" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."debt2b2_reversal_result"("p_event_id" "uuid", "p_idempotent_replay" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "private"."debt2b2_reversal_result"("p_event_id" "uuid", "p_idempotent_replay" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."debt2b2_validate_costs"("p_cash_amount" numeric, "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean, "p_error_code" "text") RETURNS numeric
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "private"."debt2b2_validate_costs"("p_cash_amount" numeric, "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean, "p_error_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cash_counts_legacy_account_sync"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_cash_account_id uuid;
begin
  if new.account_id is null then
    select fa.id
      into v_cash_account_id
      from public.financial_accounts as fa
     where fa.household_id = new.household_id
       and fa.reconciliation_type = 'cash'
       and fa.is_active
     limit 1;
    if found then
      new.account_id := v_cash_account_id;
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."cash_counts_legacy_account_sync"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."close_credit_card_statement_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_statement_id" "uuid", "p_statement_date" "date", "p_due_date" "date", "p_minimum_payment_amount" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_person text;
  v_debt public.debts%rowtype;
  v_profile public.credit_card_profiles%rowtype;
  v_existing_statement public.credit_card_statements%rowtype;
  v_statement_balance numeric;
  v_closing_entry_id uuid;
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
     or p_statement_id is null
     or p_statement_date is null
     or p_due_date is null
     or p_due_date < p_statement_date
     or (p_minimum_payment_amount is not null and p_minimum_payment_amount < 0) then
    raise exception 'INVALID_CREDIT_CARD_STATEMENT';
  end if;

  -- Lock debt & credit_card_profile
  select d.*
    into v_debt
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id
   for update;
  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;
  if v_debt.debt_kind <> 'credit_card' then
    raise exception 'DEBT_NOT_CREDIT_CARD';
  end if;

  select ccp.*
    into v_profile
    from public.credit_card_profiles as ccp
   where ccp.debt_id = p_debt_id
     and ccp.household_id = p_household_id
   for update;
  if not found then
    raise exception 'CREDIT_CARD_PROFILE_NOT_FOUND';
  end if;

  -- Check idempotency by statement_id or unique cycle (debt_id, statement_date) including minimum_payment_amount
  select s.*
    into v_existing_statement
    from public.credit_card_statements as s
   where s.id = p_statement_id
      or (s.debt_id = p_debt_id and s.statement_date = p_statement_date)
   for update;

  if found then
    if v_existing_statement.id is distinct from p_statement_id
       or v_existing_statement.household_id is distinct from p_household_id
       or v_existing_statement.debt_id is distinct from p_debt_id
       or v_existing_statement.statement_date is distinct from p_statement_date
       or v_existing_statement.due_date is distinct from p_due_date
       or v_existing_statement.minimum_payment_amount is distinct from p_minimum_payment_amount then
      raise exception 'CREDIT_CARD_STATEMENT_CONFLICT';
    end if;

    return pg_catalog.jsonb_build_object(
      'success', true,
      'statement_id', v_existing_statement.id,
      'statement_balance', v_existing_statement.statement_balance,
      'minimum_payment_amount', v_existing_statement.minimum_payment_amount,
      'idempotent', true
    );
  end if;

  -- Calculate statement balance from effective entries AS OF p_statement_date
  -- Only reversals that occurred on or before p_statement_date invalidate target entries as of that cut date!
  with effective_entries as (
    select cce.id, cce.liability_delta
      from public.credit_card_entries as cce
     where cce.debt_id = p_debt_id
       and cce.household_id = p_household_id
       and cce.entry_date <= p_statement_date
       and cce.entry_type <> 'reversal'
       and not exists (
         select 1
           from public.credit_card_entries as r
          where r.debt_id = cce.debt_id
            and r.household_id = cce.household_id
            and r.entry_type = 'reversal'
            and r.reversal_of_entry_id = cce.id
            and r.entry_date <= p_statement_date
       )
     order by cce.entry_date desc, cce.created_at desc, cce.id desc
  )
  select
    coalesce(v_debt.opening_principal_balance, 0) + coalesce(sum(liability_delta), 0),
    (select id from effective_entries limit 1)
    into v_statement_balance, v_closing_entry_id
    from effective_entries;

  insert into public.credit_card_statements (
    id,
    debt_id,
    household_id,
    statement_date,
    due_date,
    statement_balance,
    minimum_payment_amount,
    closing_entry_id,
    created_by_user_id,
    created_at,
    updated_at
  ) values (
    p_statement_id,
    p_debt_id,
    p_household_id,
    p_statement_date,
    p_due_date,
    v_statement_balance,
    p_minimum_payment_amount,
    v_closing_entry_id,
    v_user_id,
    now(),
    now()
  );

  return pg_catalog.jsonb_build_object(
    'success', true,
    'statement_id', p_statement_id,
    'statement_balance', v_statement_balance,
    'minimum_payment_amount', p_minimum_payment_amount,
    'idempotent', false
  );
end;
$$;


ALTER FUNCTION "public"."close_credit_card_statement_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_statement_id" "uuid", "p_statement_date" "date", "p_due_date" "date", "p_minimum_payment_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_recurring_payment"("p_payment_id" "text", "p_create_expense" boolean, "p_movement_id" "text", "p_movement_date" "date", "p_movement_amount" numeric, "p_movement_description" "text", "p_movement_method" "text", "p_movement_category" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_payment public.recurring_payments%rowtype;
  v_movement public.movements%rowtype;
  v_display_name text;
  v_cycle_date date;
  v_cycle_month integer;
  v_cycle_year integer;
  v_has_movement boolean := false;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_create_expense is null then
    raise exception 'INVALID_MOVEMENT';
  end if;

  select rp.*
    into v_payment
    from public.recurring_payments as rp
   where rp.id = p_payment_id
   for update;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  select hm.display_name
    into v_display_name
    from public.household_members as hm
   where hm.household_id = v_payment.household_id
     and hm.user_id = v_user_id
   limit 1;

  if not found then
    raise exception 'MEMBER_NOT_PROVISIONED';
  end if;

  if v_display_name is null or pg_catalog.btrim(v_display_name) = '' then
    raise exception 'MEMBER_NOT_PROVISIONED';
  end if;

  v_cycle_date := (pg_catalog.now() at time zone 'America/Lima')::date;
  v_cycle_month := extract(month from v_cycle_date)::integer;
  v_cycle_year := extract(year from v_cycle_date)::integer;

  if (
    v_payment.recurrence_type = 'one_time'
    and v_payment.status = 'pagado'
  ) or (
    v_payment.recurrence_type in ('indefinite', 'fixed')
    and v_payment.last_paid_month = v_cycle_month
    and v_payment.last_paid_year = v_cycle_year
  ) then
    if p_create_expense then
      if p_movement_id is not null and pg_catalog.btrim(p_movement_id) <> '' then
        select m.*
          into v_movement
          from public.movements as m
         where m.id = p_movement_id
           and m.household_id = v_payment.household_id
           and m.type = 'egreso'
           and m.registered_by_user_id = v_user_id
           and m.date is not distinct from p_movement_date
           and m.amount is not distinct from cast(p_movement_amount as numeric(12, 2))
           and m.description is not distinct from p_movement_description
           and m.method is not distinct from p_movement_method
           and m.category is not distinct from p_movement_category
           and m.person is not distinct from v_display_name;

        if found then
          v_has_movement := true;
        else
          raise exception 'PAYMENT_ALREADY_PAID';
        end if;
      else
        raise exception 'PAYMENT_ALREADY_PAID';
      end if;
    end if;

    return pg_catalog.jsonb_build_object(
      'payment', pg_catalog.to_jsonb(v_payment),
      'movement', case when v_has_movement then pg_catalog.to_jsonb(v_movement) else 'null'::jsonb end
    );
  end if;

  if not v_payment.is_active then
    raise exception 'PAYMENT_INACTIVE';
  end if;

  if p_create_expense and (
    p_movement_id is null
    or pg_catalog.btrim(p_movement_id) = ''
    or p_movement_date is null
    or p_movement_amount is null
    or p_movement_amount <= 0
    or p_movement_description is null
    or pg_catalog.btrim(p_movement_description) = ''
    or p_movement_method is null
    or p_movement_method not in ('efectivo', 'Yape', 'transferencia', 'tarjeta')
    or p_movement_category is null
    or pg_catalog.btrim(p_movement_category) = ''
  ) then
    raise exception 'INVALID_MOVEMENT';
  end if;

  if p_create_expense then
    if exists (
      select 1
        from public.movements as m
       where m.id = p_movement_id
         and m.household_id = v_payment.household_id
    ) then
      raise exception 'INVALID_MOVEMENT';
    end if;

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
      created_at
    ) values (
      p_movement_id,
      v_payment.household_id,
      'egreso',
      p_movement_date,
      p_movement_amount,
      p_movement_description,
      p_movement_method,
      p_movement_category,
      v_display_name,
      v_user_id,
      pg_catalog.now()
    )
    returning * into v_movement;

    v_has_movement := true;
  end if;

  update public.recurring_payments as rp
     set status = 'pagado',
         paid_at = pg_catalog.now(),
         last_paid_month = v_cycle_month,
         last_paid_year = v_cycle_year,
         paid_installments = case when rp.recurrence_type = 'fixed' then rp.paid_installments + 1 else rp.paid_installments end,
         is_active = case
           when rp.recurrence_type = 'one_time' then false
           when rp.recurrence_type = 'fixed'
             and rp.total_installments is not null
             and rp.paid_installments + 1 >= rp.total_installments then false
           else true
         end
   where rp.id = v_payment.id
   returning * into v_payment;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  return pg_catalog.jsonb_build_object(
    'payment', pg_catalog.to_jsonb(v_payment),
    'movement', case when v_has_movement then pg_catalog.to_jsonb(v_movement) else 'null'::jsonb end
  );
end;
$$;


ALTER FUNCTION "public"."complete_recurring_payment"("p_payment_id" "text", "p_create_expense" boolean, "p_movement_id" "text", "p_movement_date" "date", "p_movement_amount" numeric, "p_movement_description" "text", "p_movement_method" "text", "p_movement_category" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_recurring_payment_v2"("p_payment_id" "text", "p_create_expense" boolean, "p_movement_id" "text", "p_movement_date" "date", "p_movement_amount" numeric, "p_movement_description" "text", "p_movement_method" "text", "p_movement_category" "text", "p_account_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_payment public.recurring_payments%rowtype;
  v_movement public.movements%rowtype;
  v_account public.financial_accounts%rowtype;
  v_display_name text;
  v_cycle_date date;
  v_cycle_month integer;
  v_cycle_year integer;
  v_has_movement boolean := false;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_create_expense is null then
    raise exception 'INVALID_MOVEMENT';
  end if;

  select rp.*
    into v_payment
    from public.recurring_payments as rp
   where rp.id = p_payment_id
   for update;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  if v_payment.linked_debt_id is not null then
    raise exception 'LINKED_DEBT_RECURRING_NOT_ALLOWED';
  end if;

  select hm.display_name
    into v_display_name
    from public.household_members as hm
   where hm.household_id = v_payment.household_id
     and hm.user_id = v_user_id
   limit 1;

  if not found then
    raise exception 'MEMBER_NOT_PROVISIONED';
  end if;

  if v_display_name is null or pg_catalog.btrim(v_display_name) = '' then
    raise exception 'MEMBER_NOT_PROVISIONED';
  end if;

  v_cycle_date := (pg_catalog.now() at time zone 'America/Lima')::date;
  v_cycle_month := extract(month from v_cycle_date)::integer;
  v_cycle_year := extract(year from v_cycle_date)::integer;

  if (
    v_payment.recurrence_type = 'one_time'
    and v_payment.status = 'pagado'
  ) or (
    v_payment.recurrence_type in ('indefinite', 'fixed')
    and v_payment.last_paid_month = v_cycle_month
    and v_payment.last_paid_year = v_cycle_year
  ) then
    if p_create_expense then
      if p_movement_id is not null and pg_catalog.btrim(p_movement_id) <> '' then
        select m.*
          into v_movement
          from public.movements as m
         where m.id = p_movement_id
           and m.household_id = v_payment.household_id
           and m.type = 'egreso'
           and m.registered_by_user_id = v_user_id
           and m.date is not distinct from p_movement_date
           and m.amount is not distinct from cast(p_movement_amount as numeric(12, 2))
           and m.description is not distinct from p_movement_description
           and m.method is not distinct from p_movement_method
           and m.category is not distinct from p_movement_category
           and m.person is not distinct from v_display_name
           and (
             p_account_id is null
             or m.account_id is not distinct from p_account_id
           );

        if found then
          v_has_movement := true;
        else
          raise exception 'PAYMENT_ALREADY_PAID';
        end if;
      else
        raise exception 'PAYMENT_ALREADY_PAID';
      end if;
    end if;

    return pg_catalog.jsonb_build_object(
      'payment', pg_catalog.to_jsonb(v_payment),
      'movement', case when v_has_movement then pg_catalog.to_jsonb(v_movement) else 'null'::jsonb end
    );
  end if;

  if not v_payment.is_active then
    raise exception 'PAYMENT_INACTIVE';
  end if;

  if p_create_expense and (
    p_movement_id is null
    or pg_catalog.btrim(p_movement_id) = ''
    or p_movement_date is null
    or p_movement_amount is null
    or p_movement_amount <= 0
    or p_movement_description is null
    or pg_catalog.btrim(p_movement_description) = ''
    or p_movement_method is null
    or p_movement_method not in ('efectivo', 'Yape', 'transferencia', 'tarjeta')
    or p_movement_category is null
    or pg_catalog.btrim(p_movement_category) = ''
  ) then
    raise exception 'INVALID_MOVEMENT';
  end if;

  if p_create_expense and p_account_id is not null then
    select fa.*
      into v_account
      from public.financial_accounts as fa
     where fa.id = p_account_id
       and fa.household_id = v_payment.household_id
       and fa.is_active = true;

    if not found then
      raise exception 'ACCOUNT_NOT_AVAILABLE';
    end if;

    if v_account.reconciliation_type = 'cash'
       and p_movement_method is distinct from 'efectivo' then
      raise exception 'ACCOUNT_METHOD_MISMATCH';
    end if;

    if v_account.reconciliation_type = 'balance'
       and p_movement_method = 'efectivo' then
      raise exception 'ACCOUNT_METHOD_MISMATCH';
    end if;
  end if;

  if p_create_expense then
    if exists (
      select 1
        from public.movements as m
       where m.id = p_movement_id
         and m.household_id = v_payment.household_id
    ) then
      raise exception 'INVALID_MOVEMENT';
    end if;

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
      created_at
    ) values (
      p_movement_id,
      v_payment.household_id,
      'egreso',
      p_movement_date,
      p_movement_amount,
      p_movement_description,
      p_movement_method,
      p_movement_category,
      v_display_name,
      v_user_id,
      p_account_id,
      pg_catalog.now()
    )
    returning * into v_movement;

    v_has_movement := true;
  end if;

  update public.recurring_payments as rp
     set status = 'pagado',
         paid_at = pg_catalog.now(),
         last_paid_month = v_cycle_month,
         last_paid_year = v_cycle_year,
         paid_installments = case when rp.recurrence_type = 'fixed' then rp.paid_installments + 1 else rp.paid_installments end,
         is_active = case
           when rp.recurrence_type = 'one_time' then false
           when rp.recurrence_type = 'fixed'
             and rp.total_installments is not null
             and rp.paid_installments + 1 >= rp.total_installments then false
           else true
         end
   where rp.id = v_payment.id
   returning * into v_payment;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  return pg_catalog.jsonb_build_object(
    'payment', pg_catalog.to_jsonb(v_payment),
    'movement', case when v_has_movement then pg_catalog.to_jsonb(v_movement) else 'null'::jsonb end
  );
end;
$$;


ALTER FUNCTION "public"."complete_recurring_payment_v2"("p_payment_id" "text", "p_create_expense" boolean, "p_movement_id" "text", "p_movement_date" "date", "p_movement_amount" numeric, "p_movement_description" "text", "p_movement_method" "text", "p_movement_category" "text", "p_account_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."correct_reconciled_movement_v1"("p_household_id" "uuid", "p_movement_id" "text", "p_correction_id" "uuid", "p_expected_updated_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_date" "text" DEFAULT NULL::"text", "p_amount" numeric DEFAULT NULL::numeric, "p_description" "text" DEFAULT NULL::"text", "p_method" "text" DEFAULT NULL::"text", "p_category" "text" DEFAULT NULL::"text", "p_person" "text" DEFAULT NULL::"text", "p_account_id" "uuid" DEFAULT NULL::"uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_existing_corr public.movement_corrections%rowtype;
  v_movement public.movements%rowtype;
  v_updated_movement public.movements%rowtype;
  v_account public.financial_accounts%rowtype;
  v_before_snapshot jsonb;
  v_request_snapshot jsonb;
  v_now timestamptz;
  v_correction_row public.movement_corrections%rowtype;
begin
  -- 1. Authentication check
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  -- 2. Household membership check
  if not exists (
    select 1
    from public.household_members as hm
    where hm.household_id = p_household_id
      and hm.user_id = v_user_id
  ) then
    raise exception 'NOT_HOUSEHOLD_MEMBER';
  end if;

  -- 3. Mandatory correction_id check & concurrency lock
  if p_correction_id is null then
    raise exception 'INVALID_CORRECTION_ID';
  end if;

  -- Transaction-scoped advisory lock for strict concurrency serialization on correction_id
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_correction_id::text));

  -- Build canonical request snapshot for idempotency verification
  v_request_snapshot := jsonb_build_object(
    'movement_id', p_movement_id,
    'expected_updated_at', p_expected_updated_at,
    'date', p_date,
    'amount', p_amount,
    'description', trim(p_description),
    'method', trim(p_method),
    'category', trim(p_category),
    'person', trim(p_person),
    'account_id', p_account_id,
    'reason', trim(p_reason)
  );

  -- Strict Idempotency & Conflict check by correction_id
  select *
    into v_existing_corr
    from public.movement_corrections
   where correction_id = p_correction_id;

  if found then
    if v_existing_corr.household_id <> p_household_id
       or v_existing_corr.movement_id <> p_movement_id
       or v_existing_corr.request_snapshot <> v_request_snapshot then
      raise exception 'MOVEMENT_CORRECTION_ID_CONFLICT';
    end if;

    return jsonb_build_object(
      'success', true,
      'idempotent', true,
      'correction_id', v_existing_corr.correction_id,
      'after_snapshot', v_existing_corr.after_snapshot,
      'correction', to_jsonb(v_existing_corr)
    );
  end if;

  -- 4. Lock movement
  select m.*
    into v_movement
    from public.movements as m
   where m.id = p_movement_id
     and m.household_id = p_household_id
   for update;

  if not found then
    raise exception 'MOVEMENT_NOT_FOUND';
  end if;

  -- 5. Domain protection validation (Standard movements only)
  if v_movement.movement_context <> 'standard' then
    if v_movement.movement_context = 'debt_service' then
      raise exception 'DEBT_MOVEMENT_PROTECTED';
    else
      raise exception 'CREDIT_CARD_MOVEMENT_PROTECTED';
    end if;
  end if;

  -- 6. Reconciled matched membership validation
  if not exists (
    select 1
    from public.account_reconciliation_movements as arm
    join public.account_reconciliations as ar on ar.id = arm.reconciliation_id
    where arm.movement_id = p_movement_id
      and arm.household_id = p_household_id
      and ar.status = 'matched'
  ) then
    raise exception 'MOVEMENT_NOT_RECONCILED';
  end if;

  -- 7. Optimistic Concurrency check
  if p_expected_updated_at is null or v_movement.updated_at <> p_expected_updated_at then
    raise exception 'MOVEMENT_CORRECTION_CONFLICT';
  end if;

  -- 8. Basic field validation
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'INVALID_REASON';
  end if;

  if p_date is null or trim(p_date) = '' then
    raise exception 'INVALID_DATE';
  end if;

  if p_description is null or trim(p_description) = '' then
    raise exception 'INVALID_DESCRIPTION';
  end if;

  if p_method is null or trim(p_method) = '' then
    raise exception 'INVALID_METHOD';
  end if;

  if p_category is null or trim(p_category) = '' then
    raise exception 'INVALID_CATEGORY';
  end if;

  -- 9. Account & Method validation
  if p_account_id is not null then
    select fa.*
      into v_account
      from public.financial_accounts as fa
     where fa.id = p_account_id
       and fa.household_id = p_household_id
       and fa.is_active = true;

    if not found then
      raise exception 'ACCOUNT_NOT_AVAILABLE';
    end if;

    if v_account.reconciliation_type = 'cash'
       and p_method <> 'efectivo' then
      raise exception 'ACCOUNT_METHOD_MISMATCH';
    end if;

    if v_account.reconciliation_type = 'balance'
       and p_method = 'efectivo' then
      raise exception 'ACCOUNT_METHOD_MISMATCH';
    end if;
  end if;

  -- 10. Atomic execution: set session config, update movement, log correction snapshot
  perform pg_catalog.set_config('app.allow_reconciled_correction', 'true', true);

  v_before_snapshot := to_jsonb(v_movement);
  v_now := pg_catalog.now();

  update public.movements
     set date = p_date::date,
         amount = p_amount,
         description = trim(p_description),
         method = trim(p_method),
         category = trim(p_category),
         person = coalesce(trim(p_person), v_movement.person),
         account_id = p_account_id,
         updated_at = v_now
   where id = p_movement_id
     and household_id = p_household_id
  returning * into v_updated_movement;

  insert into public.movement_corrections (
    household_id,
    movement_id,
    correction_id,
    request_snapshot,
    before_snapshot,
    after_snapshot,
    reason,
    registered_by_user_id,
    created_at
  ) values (
    p_household_id,
    p_movement_id,
    p_correction_id,
    v_request_snapshot,
    v_before_snapshot,
    to_jsonb(v_updated_movement),
    trim(p_reason),
    v_user_id,
    v_now
  )
  returning * into v_correction_row;

  return jsonb_build_object(
    'success', true,
    'movement', to_jsonb(v_updated_movement),
    'after_snapshot', to_jsonb(v_updated_movement),
    'correction', to_jsonb(v_correction_row)
  );
end;
$$;


ALTER FUNCTION "public"."correct_reconciled_movement_v1"("p_household_id" "uuid", "p_movement_id" "text", "p_correction_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_date" "text", "p_amount" numeric, "p_description" "text", "p_method" "text", "p_category" "text", "p_person" "text", "p_account_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_bank_loan_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_debt_kind" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_original_principal" numeric, "p_opening_principal_balance" numeric, "p_planned_installment_count" integer, "p_planned_installment_amount" numeric, "p_installment_amount_mode" "text", "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_first_due_date" "date", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text", "p_minimum_principal_payment" numeric, "p_profile" "jsonb", "p_insurances" "jsonb", "p_schedule_source" "text", "p_installments" "jsonb", "p_collaterals" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

  if p_household_id is null
     or p_debt_id is null
     or p_tracking_start_date is null
     or p_opening_principal_balance is null
     or p_name is null or pg_catalog.btrim(p_name) = ''
     or p_creditor_name is null or pg_catalog.btrim(p_creditor_name) = '' then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  v_schedule_source := coalesce(p_schedule_source, 'manual');
  if v_schedule_source not in ('contractual', 'estimated', 'manual') then
    v_schedule_source := 'manual';
  end if;
  v_is_authoritative := (v_schedule_source = 'contractual');

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
      term_installments, grace_period_type, grace_period_installments, balloon_payment_amount,
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
    insert into public.debt_schedule_versions (
      debt_id, household_id, version_number, effective_date, reason, schedule_source, is_authoritative, notes, created_by_user_id, created_at
    ) values (
      p_debt_id, p_household_id, 1, p_tracking_start_date, 'initial', v_schedule_source, v_is_authoritative, '', v_user_id, now()
    )
    returning * into v_schedule;

    for v_elem in select value from pg_catalog.jsonb_array_elements(p_installments) loop
      insert into public.debt_installments (
        schedule_version_id, debt_id, household_id, installment_number, due_date,
        expected_amount, expected_principal, expected_interest, expected_fees, expected_insurance,
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
$$;


ALTER FUNCTION "public"."create_bank_loan_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_debt_kind" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_original_principal" numeric, "p_opening_principal_balance" numeric, "p_planned_installment_count" integer, "p_planned_installment_amount" numeric, "p_installment_amount_mode" "text", "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_first_due_date" "date", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text", "p_minimum_principal_payment" numeric, "p_profile" "jsonb", "p_insurances" "jsonb", "p_schedule_source" "text", "p_installments" "jsonb", "p_collaterals" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_credit_card_debt_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_opening_balance" numeric, "p_credit_limit" numeric, "p_closing_day" integer, "p_due_day" integer, "p_last4" "text", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_user_id uuid := auth.uid();
  v_debt public.debts%rowtype;
  v_profile public.credit_card_profiles%rowtype;
  v_debt_json pg_catalog.jsonb;
  v_profile_json pg_catalog.jsonb;
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

  if p_household_id is null
     or p_debt_id is null
     or p_tracking_start_date is null
     or p_opening_balance is null
     or p_opening_balance < 0
     or p_currency_code is null or pg_catalog.btrim(p_currency_code) = ''
     or p_name is null or pg_catalog.btrim(p_name) = ''
     or p_creditor_name is null or pg_catalog.btrim(p_creditor_name) = '' then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  if p_credit_limit is not null and p_credit_limit <= 0 then
    raise exception 'INVALID_CREDIT_CARD_PROFILE';
  end if;

  if p_closing_day is not null and (p_closing_day < 1 or p_closing_day > 31) then
    raise exception 'INVALID_CREDIT_CARD_PROFILE';
  end if;

  if p_due_day is not null and (p_due_day < 1 or p_due_day > 31) then
    raise exception 'INVALID_CREDIT_CARD_PROFILE';
  end if;

  if p_last4 is not null and not (p_last4 ~ '^[0-9]{4}$') then
    raise exception 'INVALID_CREDIT_CARD_PROFILE';
  end if;

  if exists (
    select 1
      from public.debts as d
     where d.id = p_debt_id
  ) then
    raise exception 'DEBT_ALREADY_EXISTS';
  end if;

  -- 1. Insert Debt row (kind = 'credit_card')
  insert into public.debts (
    id,
    household_id,
    name,
    creditor_name,
    debt_kind,
    currency_code,
    origin_date,
    tracking_start_date,
    original_principal,
    opening_principal_balance,
    planned_installment_count,
    planned_installment_amount,
    installment_amount_mode,
    payment_frequency,
    custom_frequency_days,
    first_due_date,
    tea_percent,
    tcea_percent,
    notes,
    status,
    is_archived,
    created_by_user_id,
    created_at,
    updated_at
  ) values (
    p_debt_id,
    p_household_id,
    pg_catalog.btrim(p_name),
    pg_catalog.btrim(p_creditor_name),
    'credit_card',
    p_currency_code,
    p_origin_date,
    p_tracking_start_date,
    null,
    p_opening_balance,
    null,
    null,
    'variable',
    'monthly',
    null,
    null,
    p_tea_percent,
    p_tcea_percent,
    coalesce(p_notes, ''),
    'active',
    false,
    v_user_id,
    now(),
    now()
  )
  returning * into v_debt;

  -- 2. Insert CreditCardProfile row
  insert into public.credit_card_profiles (
    debt_id,
    household_id,
    credit_limit,
    closing_day,
    due_day,
    last4,
    created_by_user_id,
    created_at,
    updated_at
  ) values (
    p_debt_id,
    p_household_id,
    p_credit_limit,
    p_closing_day,
    p_due_day,
    p_last4,
    v_user_id,
    now(),
    now()
  )
  returning * into v_profile;

  v_debt_json := pg_catalog.to_jsonb(v_debt);
  v_profile_json := pg_catalog.to_jsonb(v_profile);

  return pg_catalog.jsonb_build_object(
    'debt', v_debt_json,
    'profile', v_profile_json
  );
end;
$_$;


ALTER FUNCTION "public"."create_credit_card_debt_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_opening_balance" numeric, "p_credit_limit" numeric, "p_closing_day" integer, "p_due_day" integer, "p_last4" "text", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_debt_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_debt_kind" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_original_principal" numeric, "p_opening_principal_balance" numeric, "p_planned_installment_count" integer, "p_planned_installment_amount" numeric, "p_installment_amount_mode" "text", "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_first_due_date" "date", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text", "p_installments" "jsonb", "p_collaterals" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.create_debt_v1(
    p_household_id, p_debt_id, p_name, p_creditor_name, p_debt_kind, p_currency_code,
    p_origin_date, p_tracking_start_date, p_original_principal, p_opening_principal_balance,
    p_planned_installment_count, p_planned_installment_amount, p_installment_amount_mode,
    p_payment_frequency, p_custom_frequency_days, p_first_due_date, p_tea_percent, p_tcea_percent,
    p_notes, p_installments, p_collaterals,
    'unknown', 'unknown', null, null
  );
$$;


ALTER FUNCTION "public"."create_debt_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_debt_kind" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_original_principal" numeric, "p_opening_principal_balance" numeric, "p_planned_installment_count" integer, "p_planned_installment_amount" numeric, "p_installment_amount_mode" "text", "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_first_due_date" "date", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text", "p_installments" "jsonb", "p_collaterals" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_debt_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_debt_kind" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_original_principal" numeric, "p_opening_principal_balance" numeric, "p_planned_installment_count" integer, "p_planned_installment_amount" numeric, "p_installment_amount_mode" "text", "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_first_due_date" "date", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text", "p_installments" "jsonb", "p_collaterals" "jsonb") IS 'DEBT-2A: onboarding transaccional de una obligación. Una sola RPC atómica crea Debt + cronograma inicial opcional (ScheduleVersion v1 reason=initial, solo si p_installments no está vacío) + installments numerados 1..N + collaterals con status pledged. El servidor controla status/is_archived/created_by_user_id: nunca se aceptan del cliente. No escribe debt_events ni movements. Cualquier error revierte TODO (rollback total). Errores estables: AUTH_REQUIRED, HOUSEHOLD_ACCESS_DENIED, INVALID_DEBT_INPUT, DEBT_ALREADY_EXISTS (p_debt_id duplicado, el frontend puede resolverlo recargando por id), INVALID_INSTALLMENTS, INVALID_COLLATERALS. Campos nullable (expected_* de installments; pledged_value, estimated_value, redemption_deadline de collaterals): ausentes o JSON null se convierten a SQL NULL; nunca se inventan ceros ni fechas. DEBT-2B será responsable de payments, partial/multi-installment allocations, prepayments, payoff, reversals, movement integration y concurrency/current principal safety (nuevas RPC atómicas DebtEvent + Movement + Allocation + locking), nunca como UPDATE directo sobre las tablas.';



CREATE OR REPLACE FUNCTION "public"."create_debt_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_debt_kind" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_original_principal" numeric, "p_opening_principal_balance" numeric, "p_planned_installment_count" integer, "p_planned_installment_amount" numeric, "p_installment_amount_mode" "text", "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_first_due_date" "date", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text", "p_installments" "jsonb", "p_collaterals" "jsonb", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
$_$;


ALTER FUNCTION "public"."create_debt_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_debt_kind" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_original_principal" numeric, "p_opening_principal_balance" numeric, "p_planned_installment_count" integer, "p_planned_installment_amount" numeric, "p_installment_amount_mode" "text", "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_first_due_date" "date", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text", "p_installments" "jsonb", "p_collaterals" "jsonb", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_debt_v2"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_debt_kind" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_original_principal" numeric, "p_opening_principal_balance" numeric, "p_planned_installment_count" integer, "p_planned_installment_amount" numeric, "p_installment_amount_mode" "text", "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_first_due_date" "date", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text", "p_installments" "jsonb", "p_collaterals" "jsonb", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text", "p_minimum_principal_payment" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_res jsonb;
  v_debt public.debts%rowtype;
begin
  if p_minimum_principal_payment is not null and p_minimum_principal_payment <= 0 then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  v_res := public.create_debt_v1(
    p_household_id, p_debt_id, p_name, p_creditor_name, p_debt_kind, p_currency_code,
    p_origin_date, p_tracking_start_date, p_original_principal, p_opening_principal_balance,
    p_planned_installment_count, p_planned_installment_amount, p_installment_amount_mode,
    p_payment_frequency, p_custom_frequency_days, p_first_due_date, p_tea_percent, p_tcea_percent,
    p_notes, p_installments, p_collaterals,
    p_repayment_structure, p_interest_calculation_mode, p_periodic_rate_percent, p_periodic_rate_basis
  );

  if p_minimum_principal_payment is not null then
    update public.debts
       set minimum_principal_payment = p_minimum_principal_payment
     where id = p_debt_id
       and household_id = p_household_id
     returning * into v_debt;

    v_res := jsonb_set(v_res, '{debt}', pg_catalog.to_jsonb(v_debt));
  end if;

  perform public.sync_linked_recurring_payment(p_debt_id);

  return v_res;
end;
$$;


ALTER FUNCTION "public"."create_debt_v2"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_debt_kind" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_original_principal" numeric, "p_opening_principal_balance" numeric, "p_planned_installment_count" integer, "p_planned_installment_amount" numeric, "p_installment_amount_mode" "text", "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_first_due_date" "date", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text", "p_installments" "jsonb", "p_collaterals" "jsonb", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text", "p_minimum_principal_payment" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_debt_v2"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_debt_kind" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_original_principal" numeric, "p_opening_principal_balance" numeric, "p_planned_installment_count" integer, "p_planned_installment_amount" numeric, "p_installment_amount_mode" "text", "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_first_due_date" "date", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text", "p_installments" "jsonb", "p_collaterals" "jsonb", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text", "p_minimum_principal_payment" numeric) IS 'DEBT-6B.2: Permite registrar una nueva deuda especificando abono mínimo a capital y sincronización automática con pagos recurrentes.';



CREATE OR REPLACE FUNCTION "public"."delete_pristine_debt_v1"("p_household_id" "uuid", "p_debt_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_debt public.debts%rowtype;
  v_member public.household_members%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select hm.*
    into v_member
    from public.household_members as hm
   where hm.household_id = p_household_id
     and hm.user_id = v_user_id;

  if not found then
    raise exception 'MEMBER_NOT_PROVISIONED';
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

  -- History Protection Check: block if ANY financial/domain history exists
  if exists (
    select 1
      from public.debt_events as e
     where e.debt_id = p_debt_id
       and e.household_id = p_household_id
  ) or exists (
    select 1
      from public.credit_card_entries as cce
     where cce.debt_id = p_debt_id
       and cce.household_id = p_household_id
  ) or exists (
    select 1
      from public.credit_card_statements as ccs
     where ccs.debt_id = p_debt_id
       and ccs.household_id = p_household_id
  ) then
    raise exception 'DEBT_HAS_HISTORY';
  end if;

  -- Clean up setup-only dependent records
  delete from public.debt_installments
   where household_id = p_household_id
     and schedule_version_id in (
       select id from public.debt_schedule_versions where debt_id = p_debt_id and household_id = p_household_id
     );

  delete from public.debt_schedule_versions
   where debt_id = p_debt_id
     and household_id = p_household_id;

  delete from public.debt_collaterals
   where debt_id = p_debt_id
     and household_id = p_household_id;

  delete from public.recurring_payments
   where linked_debt_id = p_debt_id
     and household_id = p_household_id;

  delete from public.credit_card_profiles
   where debt_id = p_debt_id
     and household_id = p_household_id;

  delete from public.debts
   where id = p_debt_id
     and household_id = p_household_id;

  return pg_catalog.jsonb_build_object(
    'success', true,
    'debt_id', p_debt_id::text,
    'deleted', true
  );
end;
$$;


ALTER FUNCTION "public"."delete_pristine_debt_v1"("p_household_id" "uuid", "p_debt_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."delete_pristine_debt_v1"("p_household_id" "uuid", "p_debt_id" "uuid") IS 'DEBT-6B.3: Permite eliminar permanentemente una deuda o tarjeta solo si no tiene registros de historial financiero (eventos, consumos o estados de cuenta).';



CREATE OR REPLACE FUNCTION "public"."get_push_subscription_status"("p_household_id" "uuid", "p_endpoint" "text", "p_app_origin" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_household_id is null or p_endpoint is null or pg_catalog.btrim(p_endpoint) = ''
     or p_app_origin is null or pg_catalog.btrim(p_app_origin) = '' then
    raise exception 'INVALID_PUSH_SUBSCRIPTION';
  end if;

  if not exists (
    select 1
    from public.household_members as hm
    where hm.household_id = p_household_id
      and hm.user_id = v_user_id
  ) then
    raise exception 'MEMBER_NOT_PROVISIONED';
  end if;

  return coalesce(
    (
      select ps.is_active
      from public.push_subscriptions as ps
      where ps.user_id = v_user_id
        and ps.household_id = p_household_id
        and ps.endpoint = pg_catalog.btrim(p_endpoint)
        and ps.app_origin = pg_catalog.btrim(p_app_origin)
      limit 1
    ),
    false
  );
end;
$$;


ALTER FUNCTION "public"."get_push_subscription_status"("p_household_id" "uuid", "p_endpoint" "text", "p_app_origin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."movements_legacy_cash_account_sync"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_cash_account_id uuid;
begin
  if new.account_id is null then
    if new.method = 'efectivo' then
      select fa.id
        into v_cash_account_id
        from public.financial_accounts as fa
       where fa.household_id = new.household_id
         and fa.reconciliation_type = 'cash'
         and fa.is_active
       limit 1;
      if found then
        new.account_id := v_cash_account_id;
      end if;
    end if;
  elsif tg_op = 'UPDATE'
    and old.method = 'efectivo'
    and new.method <> 'efectivo'
    and new.account_id is not distinct from old.account_id
    and exists (
      select 1
        from public.financial_accounts as fa
       where fa.id = old.account_id
         and fa.household_id = old.household_id
         and fa.reconciliation_type = 'cash'
    ) then
    new.account_id := null;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."movements_legacy_cash_account_sync"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_debt_collateral_identity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.id is distinct from old.id
    or new.debt_id is distinct from old.debt_id
    or new.household_id is distinct from old.household_id
    or new.created_by_user_id is distinct from old.created_by_user_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'DEBT_COLLATERAL_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."protect_debt_collateral_identity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_debt_financial_baseline"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if (
    new.opening_principal_balance is distinct from old.opening_principal_balance
    or new.tracking_start_date is distinct from old.tracking_start_date
  )
  and exists (
    select 1
    from public.debt_events as de
    where de.debt_id = new.id
      and de.household_id = new.household_id
  ) then
    raise exception 'DEBT_BASELINE_LOCKED';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."protect_debt_financial_baseline"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_debt_identity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.id is distinct from old.id
    or new.household_id is distinct from old.household_id
    or new.created_by_user_id is distinct from old.created_by_user_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'DEBT_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."protect_debt_identity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_movement_semantics"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'INSERT' then
    if new.movement_context = 'debt_service'
       and current_user <> 'postgres' then
      raise exception 'DEBT_SERVICE_MOVEMENT_RPC_ONLY';

    elsif new.movement_context in (
      'credit_card_purchase',
      'credit_card_payment',
      'credit_card_fee',
      'credit_card_credit'
    )
       and current_user <> 'postgres' then
      raise exception 'CREDIT_CARD_MOVEMENT_RPC_ONLY';
    end if;

    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    if (
      exists (
        select 1
        from public.debt_events as de
        where de.movement_id = old.id
          and de.household_id = old.household_id
      )
      or exists (
        select 1
        from public.credit_card_entries as cce
        where cce.movement_id = old.id
          and cce.household_id = old.household_id
      )
    ) then
      raise exception 'DEBT_MOVEMENT_PROTECTED';
    end if;

    if exists (
      select 1
      from public.account_reconciliation_movements as arm
      join public.account_reconciliations as ar on ar.id = arm.reconciliation_id
      where arm.movement_id = old.id
        and arm.household_id = old.household_id
        and ar.status = 'matched'
    ) then
      -- Allow UPDATE only if specifically invoked via correct_reconciled_movement_v1 RPC
      if tg_op = 'UPDATE' and pg_catalog.current_setting('app.allow_reconciled_correction', true) = 'true' then
        -- Proceed with controlled update
        null;
      else
        raise exception 'MOVEMENT_RECONCILED';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE'
     and new.movement_context is distinct from old.movement_context then
    raise exception 'MOVEMENT_CONTEXT_IMMUTABLE';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."protect_movement_semantics"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."provision_default_cash_account"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1
      from public.financial_accounts as fa
     where fa.household_id = new.id
       and fa.reconciliation_type = 'cash'
       and fa.is_active = true
  ) then
    insert into public.financial_accounts (
      household_id,
      name,
      reconciliation_type,
      opening_balance,
      is_active,
      sort_order
    ) values (
      new.id,
      'Efectivo',
      'cash',
      coalesce(
        (
          select s.initial_balance
            from public.settings as s
           where s.household_id = new.id
           limit 1
        ),
        0
      ),
      true,
      0
    );
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."provision_default_cash_account"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_account_reconciliation_v1"("p_household_id" "uuid", "p_reconciliation_id" "uuid", "p_account_id" "uuid", "p_actual_balance" numeric DEFAULT NULL::numeric, "p_denominations" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_account public.financial_accounts%rowtype;
  v_calculated_actual_balance numeric(12, 2);
  v_opening_balance numeric(12, 2);
  v_currency_code text;
  v_reconciliation_type text;
  v_movement_sum numeric(12, 2);
  v_expected_balance numeric(12, 2);
  v_actual_balance numeric(12, 2);
  v_difference numeric(12, 2);
  v_status text;
  v_existing_rec public.account_reconciliations%rowtype;
  v_existing_mov_count integer;
  v_inserted_mov_count integer;
begin
  -- 1. Authentication and household membership check
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.household_members as hm
    where hm.household_id = p_household_id
      and hm.user_id = v_user_id
  ) then
    raise exception 'NOT_HOUSEHOLD_MEMBER';
  end if;

  -- 2. Lock and validate target financial account
  select fa.*
    into v_account
    from public.financial_accounts as fa
   where fa.id = p_account_id
     and fa.household_id = p_household_id
   for update;

  if not found then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;

  if not v_account.is_active then
    raise exception 'ACCOUNT_NOT_ACTIVE';
  end if;

  v_opening_balance := v_account.opening_balance;
  v_currency_code := v_account.currency_code;
  v_reconciliation_type := v_account.reconciliation_type;

  -- 3. Validate and calculate actual balance based on account reconciliation_type
  if v_reconciliation_type = 'balance' then
    if p_actual_balance is null then
      raise exception 'ACTUAL_BALANCE_REQUIRED';
    end if;
    if p_denominations is not null then
      raise exception 'DENOMINATIONS_NOT_ALLOWED_FOR_BALANCE_ACCOUNT';
    end if;
    v_actual_balance := p_actual_balance;

  elsif v_reconciliation_type = 'cash' then
    if p_denominations is null then
      raise exception 'DENOMINATIONS_REQUIRED_FOR_CASH_ACCOUNT';
    end if;

    if jsonb_typeof(p_denominations) = 'object' then
      select coalesce(sum((key::numeric) * (value::text::numeric)), 0)
        into v_calculated_actual_balance
        from jsonb_each(p_denominations);

      if exists (
        select 1
          from jsonb_each(p_denominations)
         where key::numeric <= 0
            or (value::text::numeric) < 0
            or (value::text::numeric) <> floor(value::text::numeric)
      ) then
        raise exception 'INVALID_DENOMINATIONS';
      end if;

    elsif jsonb_typeof(p_denominations) = 'array' then
      select coalesce(sum(((elem->>'denomination')::numeric) * ((elem->>'count')::numeric)), 0)
        into v_calculated_actual_balance
        from jsonb_array_elements(p_denominations) as elem;

      if exists (
        select 1
          from jsonb_array_elements(p_denominations) as elem
         where (elem->>'denomination')::numeric <= 0
            or (elem->>'count')::numeric < 0
            or (elem->>'count')::numeric <> floor((elem->>'count')::numeric)
      ) then
        raise exception 'INVALID_DENOMINATIONS';
      end if;
    else
      raise exception 'INVALID_DENOMINATIONS_FORMAT';
    end if;

    v_actual_balance := v_calculated_actual_balance;
  else
    raise exception 'UNSUPPORTED_RECONCILIATION_TYPE';
  end if;

  -- 4. Single-scan: Capture eligible movements set & effective contribution into temp table ONCE
  create temp table _temp_rec_movements on commit drop as
  select
    m.id as movement_id,
    case
      when exists (
        select 1
          from public.credit_card_entries as c
          join public.credit_card_entries as r on r.reversal_of_entry_id = c.id and r.household_id = p_household_id
         where c.movement_id = m.id
           and c.household_id = p_household_id
      ) then 0
      when m.type = 'ingreso' then m.amount
      else -m.amount
    end as balance_contribution,
    m.updated_at as movement_updated_at_snapshot,
    pg_catalog.to_jsonb(m.*) as movement_snapshot
  from public.movements as m
  where m.household_id = p_household_id
    and (
      (v_reconciliation_type = 'balance' and m.account_id = p_account_id)
      or
      (v_reconciliation_type = 'cash' and (m.account_id = p_account_id or (m.account_id is null and m.method = 'efectivo')))
    );

  -- Calculate expected balance directly from captured snapshot
  select coalesce(sum(balance_contribution), 0)
    into v_movement_sum
    from _temp_rec_movements;

  v_expected_balance := v_opening_balance + v_movement_sum;
  v_difference := v_actual_balance - v_expected_balance;

  if abs(v_difference) <= 0.005 then
    v_status := 'matched';
  else
    v_status := 'mismatch';
  end if;

  -- 5. Strict Idempotency Check by reconciliation_id
  select r.*
    into v_existing_rec
    from public.account_reconciliations as r
   where r.id = p_reconciliation_id
   for update;

  if found then
    if v_existing_rec.household_id is distinct from p_household_id
       or v_existing_rec.account_id is distinct from p_account_id
       or v_existing_rec.reconciliation_type is distinct from v_reconciliation_type
       or v_existing_rec.currency_code is distinct from v_currency_code
       or v_existing_rec.actual_balance is distinct from v_actual_balance then
      raise exception 'RECONCILIATION_ID_CONFLICT';
    end if;

    if v_reconciliation_type = 'cash' and v_existing_rec.denominations is distinct from p_denominations then
      raise exception 'RECONCILIATION_ID_CONFLICT';
    end if;

    select count(*)
      into v_existing_mov_count
      from public.account_reconciliation_movements
     where reconciliation_id = v_existing_rec.id;

    return pg_catalog.jsonb_build_object(
      'success', true,
      'reconciliation_id', v_existing_rec.id,
      'status', v_existing_rec.status,
      'opening_balance_snapshot', v_existing_rec.opening_balance_snapshot,
      'expected_balance', v_existing_rec.expected_balance,
      'actual_balance', v_existing_rec.actual_balance,
      'difference', v_existing_rec.difference,
      'movements_count', v_existing_mov_count,
      'idempotent', true
    );
  end if;

  -- 6. Insert account_reconciliations snapshot
  insert into public.account_reconciliations (
    id,
    household_id,
    account_id,
    reconciliation_type,
    currency_code,
    opening_balance_snapshot,
    expected_balance,
    actual_balance,
    difference,
    status,
    denominations,
    registered_by_user_id,
    created_at
  ) values (
    p_reconciliation_id,
    p_household_id,
    p_account_id,
    v_reconciliation_type,
    v_currency_code,
    v_opening_balance,
    v_expected_balance,
    v_actual_balance,
    v_difference,
    v_status,
    case when v_reconciliation_type = 'cash' then p_denominations else null end,
    v_user_id,
    now()
  );

  -- 7. Insert explicit movement membership snapshots directly from captured snapshot
  insert into public.account_reconciliation_movements (
    household_id,
    reconciliation_id,
    movement_id,
    balance_contribution,
    movement_updated_at_snapshot,
    movement_snapshot,
    created_at
  )
  select
    p_household_id,
    p_reconciliation_id,
    movement_id,
    balance_contribution,
    movement_updated_at_snapshot,
    movement_snapshot,
    now()
  from _temp_rec_movements;

  get diagnostics v_inserted_mov_count = row_count;

  return pg_catalog.jsonb_build_object(
    'success', true,
    'reconciliation_id', p_reconciliation_id,
    'status', v_status,
    'opening_balance_snapshot', v_opening_balance,
    'expected_balance', v_expected_balance,
    'actual_balance', v_actual_balance,
    'difference', v_difference,
    'movements_count', v_inserted_mov_count,
    'idempotent', false
  );
end;
$$;


ALTER FUNCTION "public"."record_account_reconciliation_v1"("p_household_id" "uuid", "p_reconciliation_id" "uuid", "p_account_id" "uuid", "p_actual_balance" numeric, "p_denominations" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_credit_card_credit_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_entry_id" "uuid", "p_movement_id" "text", "p_target_entry_id" "uuid", "p_credit_date" "date", "p_amount" numeric, "p_description" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_person text;
  v_description text;
  v_movement_id text;
  v_debt public.debts%rowtype;
  v_profile public.credit_card_profiles%rowtype;
  v_target_entry public.credit_card_entries%rowtype;
  v_target_movement public.movements%rowtype;
  v_existing_entry public.credit_card_entries%rowtype;
  v_existing_movement public.movements%rowtype;
  v_linked_entry public.credit_card_entries%rowtype;
  v_target_reversal public.credit_card_entries%rowtype;
  v_existing_credits_sum numeric := 0;
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

  if p_household_id is null
     or p_debt_id is null
     or p_entry_id is null
     or p_target_entry_id is null
     or v_movement_id is null
     or v_movement_id = ''
     or p_credit_date is null
     or p_amount is null
     or p_amount <= 0
     or v_description is null
     or v_description = '' then
    raise exception 'INVALID_CREDIT_CARD_CREDIT';
  end if;

  if p_entry_id = p_target_entry_id then
    raise exception 'CREDIT_CARD_CREDIT_TARGET_INVALID';
  end if;

  -- Lock debt row & validate status, archiving, kind
  select d.*
    into v_debt
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id
   for update;
  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;
  if v_debt.debt_kind <> 'credit_card' then
    raise exception 'DEBT_NOT_CREDIT_CARD';
  end if;
  if v_debt.is_archived then
    raise exception 'DEBT_ARCHIVED';
  end if;
  if v_debt.status <> 'active' then
    raise exception 'DEBT_NOT_ACTIVE';
  end if;

  -- Lock credit card profile row
  select ccp.*
    into v_profile
    from public.credit_card_profiles as ccp
   where ccp.debt_id = p_debt_id
     and ccp.household_id = p_household_id
   for update;
  if not found then
    raise exception 'CREDIT_CARD_PROFILE_NOT_FOUND';
  end if;

  -- Lock target entry row & validate debt/household match and entry_type
  select e.*
    into v_target_entry
    from public.credit_card_entries as e
   where e.id = p_target_entry_id
     and e.debt_id = p_debt_id
     and e.household_id = p_household_id
   for update;

  if not found then
    raise exception 'TARGET_ENTRY_NOT_FOUND';
  end if;

  if v_target_entry.entry_type not in ('purchase', 'finance_charge') then
    raise exception 'CREDIT_CARD_CREDIT_TARGET_INVALID';
  end if;

  -- Check if target entry was reversed by a reversal entry
  select e.*
    into v_target_reversal
    from public.credit_card_entries as e
   where e.reversal_of_entry_id = p_target_entry_id
     and e.household_id = p_household_id
   for update;

  if found then
    raise exception 'CREDIT_CARD_CREDIT_TARGET_INVALID';
  end if;

  -- Lock target movement to verify context & derive category
  if v_target_entry.movement_id is null then
    raise exception 'TARGET_ENTRY_NOT_FOUND';
  end if;

  select m.*
    into v_target_movement
    from public.movements as m
   where m.id = v_target_entry.movement_id
     and m.household_id = p_household_id
   for update;

  if not found then
    raise exception 'TARGET_ENTRY_NOT_FOUND';
  end if;

  if v_target_entry.entry_type = 'purchase' and v_target_movement.movement_context <> 'credit_card_purchase' then
    raise exception 'CREDIT_CARD_CREDIT_TARGET_INVALID';
  end if;
  if v_target_entry.entry_type = 'finance_charge' and v_target_movement.movement_context <> 'credit_card_fee' then
    raise exception 'CREDIT_CARD_CREDIT_TARGET_INVALID';
  end if;

  -- Calculate existing effective credits sum against target entry
  select coalesce(sum(abs(c.liability_delta)), 0)
    into v_existing_credits_sum
    from public.credit_card_entries as c
   where c.credit_of_entry_id = p_target_entry_id
     and c.household_id = p_household_id
     and c.id <> p_entry_id
     and not exists (
       select 1
         from public.credit_card_entries as r
        where r.reversal_of_entry_id = c.id
          and r.household_id = p_household_id
     );

  if (v_existing_credits_sum + p_amount) > abs(v_target_entry.liability_delta) then
    raise exception 'CREDIT_CARD_REFUND_EXCEEDS_TARGET';
  end if;

  -- Check idempotency by entry_id
  select e.*
    into v_existing_entry
    from public.credit_card_entries as e
   where e.id = p_entry_id
   for update;

  if found then
    if v_existing_entry.household_id is distinct from p_household_id
       or v_existing_entry.debt_id is distinct from p_debt_id
       or v_existing_entry.entry_type is distinct from 'credit'
       or v_existing_entry.movement_id is distinct from v_movement_id
       or v_existing_entry.credit_of_entry_id is distinct from p_target_entry_id
       or v_existing_entry.entry_date is distinct from p_credit_date
       or v_existing_entry.liability_delta is distinct from -p_amount
       or v_existing_entry.description is distinct from v_description then
      raise exception 'CREDIT_CARD_ENTRY_ID_CONFLICT';
    end if;

    -- Verify associated movement payload
    if v_existing_entry.movement_id is not null then
      select m.*
        into v_existing_movement
        from public.movements as m
       where m.id = v_existing_entry.movement_id
         and m.household_id = p_household_id
       for update;

      if found then
        if v_existing_movement.type is distinct from 'egreso'
           or v_existing_movement.amount is distinct from p_amount
           or v_existing_movement.date is distinct from p_credit_date
           or v_existing_movement.movement_context is distinct from 'credit_card_credit'
           or v_existing_movement.method is distinct from 'tarjeta'
           or v_existing_movement.category is distinct from v_target_movement.category
           or v_existing_movement.description is distinct from v_description
           or v_existing_movement.account_id is not null then
          raise exception 'CREDIT_CARD_ENTRY_ID_CONFLICT';
        end if;
      end if;
    end if;

    return pg_catalog.jsonb_build_object(
      'success', true,
      'entry_id', v_existing_entry.id,
      'movement_id', v_existing_entry.movement_id,
      'idempotent', true
    );
  end if;

  -- Check if movement_id is already linked to another entry
  select e.*
    into v_linked_entry
    from public.credit_card_entries as e
   where e.movement_id = v_movement_id
     and e.household_id = p_household_id
   for update;
  if found then
    raise exception 'CREDIT_CARD_MOVEMENT_ALREADY_LINKED';
  end if;

  -- Lock or create movement
  select m.*
    into v_existing_movement
    from public.movements as m
   where m.id = v_movement_id
     and m.household_id = p_household_id
   for update;

  if found then
    if v_existing_movement.type is distinct from 'egreso'
       or v_existing_movement.amount is distinct from p_amount
       or v_existing_movement.date is distinct from p_credit_date
       or v_existing_movement.movement_context is distinct from 'credit_card_credit'
       or v_existing_movement.method is distinct from 'tarjeta'
       or v_existing_movement.category is distinct from v_target_movement.category
       or v_existing_movement.description is distinct from v_description
       or v_existing_movement.account_id is not null then
      raise exception 'CREDIT_CARD_ENTRY_ID_CONFLICT';
    end if;
  else
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
      movement_context,
      created_at
    ) values (
      v_movement_id,
      p_household_id,
      'egreso',
      p_credit_date,
      p_amount,
      v_description,
      'tarjeta',
      v_target_movement.category,
      v_person,
      v_user_id,
      null,
      'credit_card_credit',
      now()
    );
  end if;

  -- Create credit card entry with negative liability_delta (-p_amount)
  insert into public.credit_card_entries (
    id,
    debt_id,
    household_id,
    entry_date,
    entry_type,
    liability_delta,
    movement_id,
    credit_of_entry_id,
    reversal_of_entry_id,
    description,
    registered_by_user_id,
    created_at
  ) values (
    p_entry_id,
    p_debt_id,
    p_household_id,
    p_credit_date,
    'credit',
    -p_amount,
    v_movement_id,
    p_target_entry_id,
    null,
    v_description,
    v_user_id,
    now()
  );

  return pg_catalog.jsonb_build_object(
    'success', true,
    'entry_id', p_entry_id,
    'movement_id', v_movement_id,
    'idempotent', false
  );
end;
$$;


ALTER FUNCTION "public"."record_credit_card_credit_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_entry_id" "uuid", "p_movement_id" "text", "p_target_entry_id" "uuid", "p_credit_date" "date", "p_amount" numeric, "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_credit_card_fee_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_entry_id" "uuid", "p_movement_id" "text", "p_fee_date" "date", "p_amount" numeric, "p_description" "text", "p_category" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_person text;
  v_description text;
  v_category text;
  v_movement_id text;
  v_debt public.debts%rowtype;
  v_profile public.credit_card_profiles%rowtype;
  v_existing_entry public.credit_card_entries%rowtype;
  v_existing_movement public.movements%rowtype;
  v_linked_entry public.credit_card_entries%rowtype;
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
     or p_entry_id is null
     or v_movement_id is null
     or v_movement_id = ''
     or p_fee_date is null
     or p_amount is null
     or p_amount <= 0
     or v_description is null
     or v_description = ''
     or v_category is null
     or v_category = '' then
    raise exception 'INVALID_CREDIT_CARD_FEE';
  end if;

  -- Lock debt row & validate status, archiving, kind
  select d.*
    into v_debt
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id
   for update;
  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;
  if v_debt.debt_kind <> 'credit_card' then
    raise exception 'DEBT_NOT_CREDIT_CARD';
  end if;
  if v_debt.is_archived then
    raise exception 'DEBT_ARCHIVED';
  end if;
  if v_debt.status <> 'active' then
    raise exception 'DEBT_NOT_ACTIVE';
  end if;

  -- Lock credit card profile row
  select ccp.*
    into v_profile
    from public.credit_card_profiles as ccp
   where ccp.debt_id = p_debt_id
     and ccp.household_id = p_household_id
   for update;
  if not found then
    raise exception 'CREDIT_CARD_PROFILE_NOT_FOUND';
  end if;

  -- Check idempotency by entry_id
  select e.*
    into v_existing_entry
    from public.credit_card_entries as e
   where e.id = p_entry_id
   for update;

  if found then
    if v_existing_entry.household_id is distinct from p_household_id
       or v_existing_entry.debt_id is distinct from p_debt_id
       or v_existing_entry.entry_type is distinct from 'finance_charge'
       or v_existing_entry.movement_id is distinct from v_movement_id
       or v_existing_entry.entry_date is distinct from p_fee_date
       or v_existing_entry.liability_delta is distinct from p_amount
       or v_existing_entry.description is distinct from v_description then
      raise exception 'CREDIT_CARD_ENTRY_ID_CONFLICT';
    end if;

    -- Verify associated movement payload
    if v_existing_entry.movement_id is not null then
      select m.*
        into v_existing_movement
        from public.movements as m
       where m.id = v_existing_entry.movement_id
         and m.household_id = p_household_id
       for update;

      if found then
        if v_existing_movement.type is distinct from 'egreso'
           or v_existing_movement.amount is distinct from p_amount
           or v_existing_movement.date is distinct from p_fee_date
           or v_existing_movement.movement_context is distinct from 'credit_card_fee'
           or v_existing_movement.method is distinct from 'tarjeta'
           or v_existing_movement.description is distinct from v_description
           or v_existing_movement.account_id is not null then
          raise exception 'CREDIT_CARD_ENTRY_ID_CONFLICT';
        end if;
      end if;
    end if;

    return pg_catalog.jsonb_build_object(
      'success', true,
      'entry_id', v_existing_entry.id,
      'movement_id', v_existing_entry.movement_id,
      'idempotent', true
    );
  end if;

  -- Check if movement_id is already linked to another entry
  select e.*
    into v_linked_entry
    from public.credit_card_entries as e
   where e.movement_id = v_movement_id
     and e.household_id = p_household_id
   for update;
  if found then
    raise exception 'CREDIT_CARD_MOVEMENT_ALREADY_LINKED';
  end if;

  -- Lock or create movement
  select m.*
    into v_existing_movement
    from public.movements as m
   where m.id = v_movement_id
     and m.household_id = p_household_id
   for update;

  if found then
    if v_existing_movement.type is distinct from 'egreso'
       or v_existing_movement.amount is distinct from p_amount
       or v_existing_movement.date is distinct from p_fee_date
       or v_existing_movement.movement_context is distinct from 'credit_card_fee'
       or v_existing_movement.method is distinct from 'tarjeta'
       or v_existing_movement.description is distinct from v_description
       or v_existing_movement.account_id is not null then
      raise exception 'CREDIT_CARD_ENTRY_ID_CONFLICT';
    end if;
  else
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
      movement_context,
      created_at
    ) values (
      v_movement_id,
      p_household_id,
      'egreso',
      p_fee_date,
      p_amount,
      v_description,
      'tarjeta',
      v_category,
      v_person,
      v_user_id,
      null,
      'credit_card_fee',
      now()
    );
  end if;

  -- Create credit card entry with positive liability_delta (+p_amount)
  insert into public.credit_card_entries (
    id,
    debt_id,
    household_id,
    entry_date,
    entry_type,
    liability_delta,
    movement_id,
    reversal_of_entry_id,
    description,
    registered_by_user_id,
    created_at
  ) values (
    p_entry_id,
    p_debt_id,
    p_household_id,
    p_fee_date,
    'finance_charge',
    p_amount,
    v_movement_id,
    null,
    v_description,
    v_user_id,
    now()
  );

  return pg_catalog.jsonb_build_object(
    'success', true,
    'entry_id', p_entry_id,
    'movement_id', v_movement_id,
    'idempotent', false
  );
end;
$$;


ALTER FUNCTION "public"."record_credit_card_fee_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_entry_id" "uuid", "p_movement_id" "text", "p_fee_date" "date", "p_amount" numeric, "p_description" "text", "p_category" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_credit_card_payment_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_entry_id" "uuid", "p_movement_id" "text", "p_payment_date" "date", "p_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_person text;
  v_description text;
  v_category text;
  v_movement_id text;
  v_method text;
  v_debt public.debts%rowtype;
  v_profile public.credit_card_profiles%rowtype;
  v_account public.financial_accounts%rowtype;
  v_existing_entry public.credit_card_entries%rowtype;
  v_existing_movement public.movements%rowtype;
  v_linked_entry public.credit_card_entries%rowtype;
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
     or p_entry_id is null
     or v_movement_id is null
     or v_movement_id = ''
     or p_payment_date is null
     or p_amount is null
     or p_amount <= 0
     or p_account_id is null
     or v_description is null
     or v_description = ''
     or v_category is null
     or v_category = '' then
    raise exception 'INVALID_CREDIT_CARD_PAYMENT';
  end if;

  -- Lock debt row & validate status, archiving, kind
  select d.*
    into v_debt
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id
   for update;
  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;
  if v_debt.debt_kind <> 'credit_card' then
    raise exception 'DEBT_NOT_CREDIT_CARD';
  end if;
  if v_debt.is_archived then
    raise exception 'DEBT_ARCHIVED';
  end if;
  if v_debt.status <> 'active' then
    raise exception 'DEBT_NOT_ACTIVE';
  end if;

  -- Lock credit card profile row
  select ccp.*
    into v_profile
    from public.credit_card_profiles as ccp
   where ccp.debt_id = p_debt_id
     and ccp.household_id = p_household_id
   for update;
  if not found then
    raise exception 'CREDIT_CARD_PROFILE_NOT_FOUND';
  end if;

  -- Lock payment account row & validate active status and STRICT CURRENCY MATCH
  select fa.*
    into v_account
    from public.financial_accounts as fa
   where fa.id = p_account_id
     and fa.household_id = p_household_id
   for update;
  if not found then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;
  if not v_account.is_active then
    raise exception 'ACCOUNT_INACTIVE';
  end if;
  if v_account.currency_code is distinct from v_debt.currency_code then
    raise exception 'ACCOUNT_CURRENCY_MISMATCH';
  end if;

  -- Derive movement method deterministically from financial account reconciliation_type
  if v_account.reconciliation_type = 'cash' then
    v_method := 'efectivo';
  elsif v_account.reconciliation_type = 'balance' then
    v_method := 'transferencia';
  else
    raise exception 'ACCOUNT_TYPE_UNSUPPORTED';
  end if;

  -- Check idempotency by entry_id
  select e.*
    into v_existing_entry
    from public.credit_card_entries as e
   where e.id = p_entry_id
   for update;

  if found then
    if v_existing_entry.household_id is distinct from p_household_id
       or v_existing_entry.debt_id is distinct from p_debt_id
       or v_existing_entry.entry_type is distinct from 'payment'
       or v_existing_entry.movement_id is distinct from v_movement_id
       or v_existing_entry.entry_date is distinct from p_payment_date
       or v_existing_entry.liability_delta is distinct from -p_amount then
      raise exception 'CREDIT_CARD_ENTRY_ID_CONFLICT';
    end if;

    -- Verify associated movement payload (including account_id and method)
    if v_existing_entry.movement_id is not null then
      select m.*
        into v_existing_movement
        from public.movements as m
       where m.id = v_existing_entry.movement_id
         and m.household_id = p_household_id
       for update;

      if found then
        if v_existing_movement.type is distinct from 'egreso'
           or v_existing_movement.amount is distinct from p_amount
           or v_existing_movement.date is distinct from p_payment_date
           or v_existing_movement.movement_context is distinct from 'credit_card_payment'
           or v_existing_movement.account_id is distinct from p_account_id
           or v_existing_movement.method is distinct from v_method then
          raise exception 'CREDIT_CARD_ENTRY_ID_CONFLICT';
        end if;
      end if;
    end if;

    return pg_catalog.jsonb_build_object(
      'success', true,
      'entry_id', v_existing_entry.id,
      'movement_id', v_existing_entry.movement_id,
      'idempotent', true
    );
  end if;

  -- Check if movement_id is already linked to another entry
  select e.*
    into v_linked_entry
    from public.credit_card_entries as e
   where e.movement_id = v_movement_id
     and e.household_id = p_household_id
   for update;
  if found then
    raise exception 'CREDIT_CARD_MOVEMENT_ALREADY_LINKED';
  end if;

  -- Lock or create movement
  select m.*
    into v_existing_movement
    from public.movements as m
   where m.id = v_movement_id
     and m.household_id = p_household_id
   for update;

  if found then
    if v_existing_movement.type is distinct from 'egreso'
       or v_existing_movement.amount is distinct from p_amount
       or v_existing_movement.date is distinct from p_payment_date
       or v_existing_movement.movement_context is distinct from 'credit_card_payment'
       or v_existing_movement.account_id is distinct from p_account_id
       or v_existing_movement.method is distinct from v_method then
      raise exception 'CREDIT_CARD_ENTRY_ID_CONFLICT';
    end if;
  else
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
      movement_context,
      created_at
    ) values (
      v_movement_id,
      p_household_id,
      'egreso',
      p_payment_date,
      p_amount,
      v_description,
      v_method,
      v_category,
      v_person,
      v_user_id,
      p_account_id,
      'credit_card_payment',
      now()
    );
  end if;

  -- Create credit card entry with negative liability_delta (-p_amount)
  insert into public.credit_card_entries (
    id,
    debt_id,
    household_id,
    entry_date,
    entry_type,
    liability_delta,
    movement_id,
    reversal_of_entry_id,
    description,
    registered_by_user_id,
    created_at
  ) values (
    p_entry_id,
    p_debt_id,
    p_household_id,
    p_payment_date,
    'payment',
    -p_amount,
    v_movement_id,
    null,
    v_description,
    v_user_id,
    now()
  );

  return pg_catalog.jsonb_build_object(
    'success', true,
    'entry_id', p_entry_id,
    'movement_id', v_movement_id,
    'idempotent', false
  );
end;
$$;


ALTER FUNCTION "public"."record_credit_card_payment_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_entry_id" "uuid", "p_movement_id" "text", "p_payment_date" "date", "p_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_credit_card_purchase_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_entry_id" "uuid", "p_movement_id" "text", "p_purchase_date" "date", "p_amount" numeric, "p_description" "text", "p_category" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_person text;
  v_description text;
  v_category text;
  v_movement_id text;
  v_debt public.debts%rowtype;
  v_profile public.credit_card_profiles%rowtype;
  v_existing_entry public.credit_card_entries%rowtype;
  v_existing_movement public.movements%rowtype;
  v_linked_entry public.credit_card_entries%rowtype;
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
     or p_entry_id is null
     or v_movement_id is null
     or v_movement_id = ''
     or p_purchase_date is null
     or p_amount is null
     or p_amount <= 0
     or v_description is null
     or v_description = ''
     or v_category is null
     or v_category = '' then
    raise exception 'INVALID_CREDIT_CARD_PURCHASE';
  end if;

  -- Lock debt row
  select d.*
    into v_debt
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id
   for update;
  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;
  if v_debt.debt_kind <> 'credit_card' then
    raise exception 'DEBT_NOT_CREDIT_CARD';
  end if;
  if v_debt.is_archived then
    raise exception 'DEBT_ARCHIVED';
  end if;
  if v_debt.status <> 'active' then
    raise exception 'DEBT_NOT_ACTIVE';
  end if;

  -- Lock credit card profile row
  select ccp.*
    into v_profile
    from public.credit_card_profiles as ccp
   where ccp.debt_id = p_debt_id
     and ccp.household_id = p_household_id
   for update;
  if not found then
    raise exception 'CREDIT_CARD_PROFILE_NOT_FOUND';
  end if;

  -- Check idempotency by entry_id
  select e.*
    into v_existing_entry
    from public.credit_card_entries as e
   where e.id = p_entry_id
   for update;

  if found then
    if v_existing_entry.household_id is distinct from p_household_id
       or v_existing_entry.debt_id is distinct from p_debt_id
       or v_existing_entry.entry_type is distinct from 'purchase'
       or v_existing_entry.movement_id is distinct from v_movement_id
       or v_existing_entry.entry_date is distinct from p_purchase_date
       or v_existing_entry.liability_delta is distinct from p_amount then
      raise exception 'CREDIT_CARD_ENTRY_ID_CONFLICT';
    end if;

    return pg_catalog.jsonb_build_object(
      'success', true,
      'entry_id', v_existing_entry.id,
      'movement_id', v_existing_entry.movement_id,
      'idempotent', true
    );
  end if;

  -- Check if movement_id is already linked to another entry
  select e.*
    into v_linked_entry
    from public.credit_card_entries as e
   where e.movement_id = v_movement_id
     and e.household_id = p_household_id
   for update;
  if found then
    raise exception 'CREDIT_CARD_MOVEMENT_ALREADY_LINKED';
  end if;

  -- Lock or create movement
  select m.*
    into v_existing_movement
    from public.movements as m
   where m.id = v_movement_id
     and m.household_id = p_household_id
   for update;

  if found then
    if v_existing_movement.type is distinct from 'egreso'
       or v_existing_movement.amount is distinct from p_amount
       or v_existing_movement.date is distinct from p_purchase_date
       or v_existing_movement.movement_context is distinct from 'credit_card_purchase'
       or v_existing_movement.account_id is not null then
      raise exception 'CREDIT_CARD_ENTRY_ID_CONFLICT';
    end if;
  else
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
      movement_context,
      created_at
    ) values (
      v_movement_id,
      p_household_id,
      'egreso',
      p_purchase_date,
      p_amount,
      v_description,
      'tarjeta',
      v_category,
      v_person,
      v_user_id,
      null,
      'credit_card_purchase',
      now()
    );
  end if;

  -- Create credit card entry
  insert into public.credit_card_entries (
    id,
    debt_id,
    household_id,
    entry_date,
    entry_type,
    liability_delta,
    movement_id,
    reversal_of_entry_id,
    description,
    registered_by_user_id,
    created_at
  ) values (
    p_entry_id,
    p_debt_id,
    p_household_id,
    p_purchase_date,
    'purchase',
    p_amount,
    v_movement_id,
    null,
    v_description,
    v_user_id,
    now()
  );

  return pg_catalog.jsonb_build_object(
    'success', true,
    'entry_id', p_entry_id,
    'movement_id', v_movement_id,
    'idempotent', false
  );
end;
$$;


ALTER FUNCTION "public"."record_credit_card_purchase_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_entry_id" "uuid", "p_movement_id" "text", "p_purchase_date" "date", "p_amount" numeric, "p_description" "text", "p_category" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_debt_installment_advance_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean, "p_allocations" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  v_current_principal numeric;
  v_schedule public.debt_schedule_versions%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select hm.display_name into v_person
    from public.household_members as hm
   where hm.household_id = p_household_id and hm.user_id = v_user_id;
  if not found or v_person is null or pg_catalog.btrim(v_person) = '' then
    raise exception 'HOUSEHOLD_ACCESS_DENIED';
  end if;

  v_movement_id := pg_catalog.btrim(p_movement_id);
  v_description := pg_catalog.btrim(p_description);
  v_category := pg_catalog.btrim(p_category);

  if p_household_id is null or p_debt_id is null or p_event_id is null
     or v_movement_id is null or v_movement_id = '' or p_event_date is null
     or p_account_id is null or v_description is null or v_description = ''
     or v_category is null or v_category = '' or p_cash_amount is null
     or p_principal_amount is null or p_breakdown_complete is null
     or p_allocations is null or pg_catalog.jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'INVALID_DEBT_PAYMENT';
  end if;

  select d.* into v_debt from public.debts as d where d.id = p_debt_id and d.household_id = p_household_id for update;
  if not found then raise exception 'DEBT_NOT_FOUND'; end if;

  if v_debt.is_archived then raise exception 'DEBT_ARCHIVED'; end if;
  if v_debt.status <> 'active' then raise exception 'DEBT_NOT_ACTIVE'; end if;

  v_current_principal := private.debt2b2_current_principal(p_household_id, p_debt_id);
  if v_current_principal <= 0 then raise exception 'DEBT_ALREADY_PAID_OFF'; end if;
  if p_principal_amount > v_current_principal then raise exception 'INVALID_DEBT_PAYMENT'; end if;

  perform private.debt2b2_validate_costs(
    p_cash_amount, p_principal_amount, p_interest_paid, p_fees_paid, p_insurance_paid, p_other_cost_paid, p_breakdown_complete, 'INVALID_DEBT_PAYMENT'
  );

  perform private.debt2b2_lock_operation(v_movement_id, p_event_id);

  select e.* into v_existing_event from public.debt_events as e where e.id = p_event_id for update;
  if found then
    if v_existing_event.household_id is distinct from p_household_id
       or v_existing_event.debt_id is distinct from p_debt_id
       or v_existing_event.event_type is distinct from 'installment_advance'
       or v_existing_event.movement_id is distinct from v_movement_id
       or v_existing_event.event_date is distinct from p_event_date
       or v_existing_event.cash_amount is distinct from p_cash_amount
       or v_existing_event.principal_delta is distinct from -p_principal_amount then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;
    return private.debt2b2_fund_result(p_event_id, true);
  end if;

  -- Create Movement via helper
  v_movement := private.debt2b2_prepare_movement(
    p_household_id, v_movement_id, p_event_date, p_cash_amount, p_account_id, v_description, v_category, v_user_id, 'debt_service'
  );

  -- Create Debt Event (installment_advance)
  insert into public.debt_events (
    id, debt_id, household_id, event_date, event_type, cash_amount, principal_delta,
    interest_paid, fees_paid, insurance_paid, other_cost_paid, breakdown_complete,
    movement_id, reversal_of_event_id, description, registered_by_user_id, created_at
  ) values (
    p_event_id, p_debt_id, p_household_id, p_event_date, 'installment_advance',
    p_cash_amount, -p_principal_amount, coalesce(p_interest_paid, 0), coalesce(p_fees_paid, 0),
    coalesce(p_insurance_paid, 0), coalesce(p_other_cost_paid, 0), p_breakdown_complete,
    v_movement_id, null, v_description, v_user_id, now()
  ) returning * into v_event;

  -- Insert Allocations via SSOT helper
  select s.* into v_schedule
    from public.debt_schedule_versions as s
   where s.debt_id = p_debt_id and s.household_id = p_household_id
   order by s.version_number desc limit 1 for update;
  perform private.debt2b2_insert_allocations(
    p_household_id, p_debt_id, p_event_id,
    case when found then v_schedule.id else null end,
    p_cash_amount, p_allocations, v_user_id
  );

  perform private.debt2b2_reconcile_status(
    p_household_id, p_debt_id, v_current_principal - p_principal_amount
  );

  return private.debt2b2_fund_result(p_event_id, false);
end;
$$;


ALTER FUNCTION "public"."record_debt_installment_advance_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean, "p_allocations" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_debt_payment_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean, "p_allocations" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."record_debt_payment_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean, "p_allocations" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."record_debt_payment_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean, "p_allocations" "jsonb") IS 'DEBT-2B.2: atomic authenticated Debt payment. The server derives principal_delta, Movement method, person, registered_by_user_id, effective principal, allocations and status. p_event_id is the idempotency key; Debt and Movement are locked before any write.';



CREATE OR REPLACE FUNCTION "public"."record_debt_payment_v2"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_extra_principal_amount" numeric, "p_prepayment_effect" "text", "p_breakdown_complete" boolean, "p_allocations" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  v_current_principal numeric;
  v_extra_principal numeric := coalesce(p_extra_principal_amount, 0);
  v_schedule public.debt_schedule_versions%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select hm.display_name into v_person
    from public.household_members as hm
   where hm.household_id = p_household_id and hm.user_id = v_user_id;
  if not found or v_person is null or pg_catalog.btrim(v_person) = '' then
    raise exception 'HOUSEHOLD_ACCESS_DENIED';
  end if;

  v_movement_id := pg_catalog.btrim(p_movement_id);
  v_description := pg_catalog.btrim(p_description);
  v_category := pg_catalog.btrim(p_category);

  if p_household_id is null or p_debt_id is null or p_event_id is null
     or v_movement_id is null or v_movement_id = '' or p_event_date is null
     or p_account_id is null or v_description is null or v_description = ''
     or v_category is null or v_category = '' or p_cash_amount is null
     or p_principal_amount is null or p_breakdown_complete is null
     or p_allocations is null or pg_catalog.jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'INVALID_DEBT_PAYMENT';
  end if;

  select d.* into v_debt from public.debts as d where d.id = p_debt_id and d.household_id = p_household_id for update;
  if not found then raise exception 'DEBT_NOT_FOUND'; end if;

  if v_debt.is_archived then raise exception 'DEBT_ARCHIVED'; end if;
  if v_debt.status <> 'active' then raise exception 'DEBT_NOT_ACTIVE'; end if;

  v_current_principal := private.debt2b2_current_principal(p_household_id, p_debt_id);
  if v_current_principal <= 0 then raise exception 'DEBT_ALREADY_PAID_OFF'; end if;
  if (p_principal_amount + v_extra_principal) > v_current_principal then raise exception 'INVALID_DEBT_PAYMENT'; end if;

  perform private.debt2b2_validate_costs(
    p_cash_amount, p_principal_amount + v_extra_principal, p_interest_paid, p_fees_paid, p_insurance_paid, p_other_cost_paid, p_breakdown_complete, 'INVALID_DEBT_PAYMENT'
  );

  perform private.debt2b2_lock_operation(v_movement_id, p_event_id);

  select e.* into v_existing_event from public.debt_events as e where e.id = p_event_id for update;
  if found then
    return private.debt2b2_fund_result(p_event_id, true);
  end if;

  v_movement := private.debt2b2_prepare_movement(
    p_household_id, v_movement_id, p_event_date, p_cash_amount, p_account_id, v_description, v_category, v_user_id, 'debt_service'
  );

  insert into public.debt_events (
    id, debt_id, household_id, event_date, event_type, cash_amount, principal_delta,
    interest_paid, fees_paid, insurance_paid, other_cost_paid, extra_principal_amount, prepayment_effect,
    breakdown_complete, movement_id, reversal_of_event_id, description, registered_by_user_id, created_at
  ) values (
    p_event_id, p_debt_id, p_household_id, p_event_date, 'payment',
    p_cash_amount, -(p_principal_amount + v_extra_principal), coalesce(p_interest_paid, 0), coalesce(p_fees_paid, 0),
    coalesce(p_insurance_paid, 0), coalesce(p_other_cost_paid, 0), v_extra_principal, p_prepayment_effect,
    p_breakdown_complete, v_movement_id, null, v_description, v_user_id, now()
  ) returning * into v_event;

  select s.* into v_schedule
    from public.debt_schedule_versions as s
   where s.debt_id = p_debt_id and s.household_id = p_household_id
   order by s.version_number desc limit 1 for update;
  perform private.debt2b2_insert_allocations(
    p_household_id, p_debt_id, p_event_id,
    case when found then v_schedule.id else null end,
    p_cash_amount, p_allocations, v_user_id
  );

  perform private.debt2b2_reconcile_status(
    p_household_id, p_debt_id, v_current_principal - (p_principal_amount + v_extra_principal)
  );

  return private.debt2b2_fund_result(p_event_id, false);
end;
$$;


ALTER FUNCTION "public"."record_debt_payment_v2"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_extra_principal_amount" numeric, "p_prepayment_effect" "text", "p_breakdown_complete" boolean, "p_allocations" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_debt_payoff_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."record_debt_payoff_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."record_debt_payoff_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean) IS 'DEBT-2B.2: atomic authenticated payoff. The server locks the Debt, calculates current principal, writes principal_delta = -current_principal and reconciles paid_off status.';



CREATE OR REPLACE FUNCTION "public"."record_debt_prepayment_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean, "p_schedule_installments" "jsonb", "p_schedule_notes" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."record_debt_prepayment_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean, "p_schedule_installments" "jsonb", "p_schedule_notes" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."record_debt_prepayment_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean, "p_schedule_installments" "jsonb", "p_schedule_notes" "text") IS 'DEBT-2B.2: atomic authenticated principal prepayment. The server derives principal_delta and appends an optional prepayment schedule version. A prepayment equal to current principal must use payoff.';



CREATE OR REPLACE FUNCTION "public"."register_push_subscription"("p_household_id" "uuid", "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_app_origin" "text", "p_expires_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_subscription public.push_subscriptions%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_household_id is null
     or p_endpoint is null or pg_catalog.btrim(p_endpoint) = ''
     or p_p256dh is null or pg_catalog.btrim(p_p256dh) = ''
     or p_auth is null or pg_catalog.btrim(p_auth) = ''
     or p_app_origin is null or pg_catalog.btrim(p_app_origin) = '' then
    raise exception 'INVALID_PUSH_SUBSCRIPTION';
  end if;

  if not exists (
    select 1
    from public.household_members as hm
    where hm.household_id = p_household_id
      and hm.user_id = v_user_id
      and hm.display_name is not null
      and pg_catalog.btrim(hm.display_name) <> ''
  ) then
    raise exception 'MEMBER_NOT_PROVISIONED';
  end if;

  insert into public.push_subscriptions (
    user_id,
    household_id,
    endpoint,
    p256dh,
    auth,
    app_origin,
    is_active,
    expires_at,
    last_failure_at,
    updated_at
  ) values (
    v_user_id,
    p_household_id,
    pg_catalog.btrim(p_endpoint),
    pg_catalog.btrim(p_p256dh),
    pg_catalog.btrim(p_auth),
    pg_catalog.btrim(p_app_origin),
    true,
    p_expires_at,
    null,
    pg_catalog.now()
  )
  on conflict (endpoint)
  do update set
    user_id = excluded.user_id,
    household_id = excluded.household_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    app_origin = excluded.app_origin,
    is_active = true,
    expires_at = excluded.expires_at,
    last_failure_at = null,
    updated_at = pg_catalog.now()
  returning * into v_subscription;

  return pg_catalog.jsonb_build_object(
    'id', v_subscription.id,
    'is_active', v_subscription.is_active,
    'app_origin', v_subscription.app_origin
  );
end;
$$;


ALTER FUNCTION "public"."register_push_subscription"("p_household_id" "uuid", "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_app_origin" "text", "p_expires_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reverse_credit_card_entry_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_reversal_entry_id" "uuid", "p_target_entry_id" "uuid", "p_reversal_date" "date", "p_description" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_person text;
  v_description text;
  v_debt public.debts%rowtype;
  v_profile public.credit_card_profiles%rowtype;
  v_target_entry public.credit_card_entries%rowtype;
  v_existing_reversal public.credit_card_entries%rowtype;
  v_prior_reversal public.credit_card_entries%rowtype;
  v_active_credit public.credit_card_entries%rowtype;
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

  v_description := pg_catalog.btrim(p_description);

  if p_household_id is null
     or p_debt_id is null
     or p_reversal_entry_id is null
     or p_target_entry_id is null
     or p_reversal_date is null
     or v_description is null
     or v_description = '' then
    raise exception 'INVALID_CREDIT_CARD_REVERSAL';
  end if;

  if p_reversal_entry_id = p_target_entry_id then
    raise exception 'REVERSAL_TARGET_INVALID';
  end if;

  -- Lock debt row
  select d.*
    into v_debt
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id
   for update;
  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;
  if v_debt.debt_kind <> 'credit_card' then
    raise exception 'DEBT_NOT_CREDIT_CARD';
  end if;
  if v_debt.is_archived then
    raise exception 'DEBT_ARCHIVED';
  end if;
  if v_debt.status <> 'active' then
    raise exception 'DEBT_NOT_ACTIVE';
  end if;

  -- Lock credit card profile row
  select ccp.*
    into v_profile
    from public.credit_card_profiles as ccp
   where ccp.debt_id = p_debt_id
     and ccp.household_id = p_household_id
   for update;
  if not found then
    raise exception 'CREDIT_CARD_PROFILE_NOT_FOUND';
  end if;

  -- Lock target entry row & validate debt/household match and entry_type
  select e.*
    into v_target_entry
    from public.credit_card_entries as e
   where e.id = p_target_entry_id
     and e.debt_id = p_debt_id
     and e.household_id = p_household_id
   for update;

  if not found then
    raise exception 'TARGET_ENTRY_NOT_FOUND';
  end if;

  if v_target_entry.entry_type = 'reversal' then
    raise exception 'REVERSAL_TARGET_INVALID';
  end if;

  -- Check if target entry has active/effective credit entries pointing to it
  select e.*
    into v_active_credit
    from public.credit_card_entries as e
   where e.credit_of_entry_id = p_target_entry_id
     and e.household_id = p_household_id
     and not exists (
       select 1
         from public.credit_card_entries as r
        where r.reversal_of_entry_id = e.id
          and r.household_id = p_household_id
     )
   for update;

  if found then
    raise exception 'CREDIT_CARD_TARGET_HAS_EFFECTIVE_CREDITS';
  end if;

  -- Check idempotency by p_reversal_entry_id
  select e.*
    into v_existing_reversal
    from public.credit_card_entries as e
   where e.id = p_reversal_entry_id
   for update;

  if found then
    if v_existing_reversal.household_id is distinct from p_household_id
       or v_existing_reversal.debt_id is distinct from p_debt_id
       or v_existing_reversal.entry_type is distinct from 'reversal'
       or v_existing_reversal.reversal_of_entry_id is distinct from p_target_entry_id
       or v_existing_reversal.entry_date is distinct from p_reversal_date
       or v_existing_reversal.liability_delta is distinct from 0
       or v_existing_reversal.description is distinct from v_description then
      raise exception 'CREDIT_CARD_ENTRY_ID_CONFLICT';
    end if;

    return pg_catalog.jsonb_build_object(
      'success', true,
      'entry_id', v_existing_reversal.id,
      'reversal_of_entry_id', v_existing_reversal.reversal_of_entry_id,
      'idempotent', true
    );
  end if;

  -- Check if target entry was ALREADY reversed by another entry
  select e.*
    into v_prior_reversal
    from public.credit_card_entries as e
   where e.reversal_of_entry_id = p_target_entry_id
     and e.household_id = p_household_id
   for update;

  if found then
    raise exception 'TARGET_ALREADY_REVERSED';
  end if;

  -- Create append-only reversal entry (liability_delta = 0, movement_id = NULL)
  insert into public.credit_card_entries (
    id,
    debt_id,
    household_id,
    entry_date,
    entry_type,
    liability_delta,
    movement_id,
    credit_of_entry_id,
    reversal_of_entry_id,
    description,
    registered_by_user_id,
    created_at
  ) values (
    p_reversal_entry_id,
    p_debt_id,
    p_household_id,
    p_reversal_date,
    'reversal',
    0,
    null,
    null,
    p_target_entry_id,
    v_description,
    v_user_id,
    now()
  );

  return pg_catalog.jsonb_build_object(
    'success', true,
    'entry_id', p_reversal_entry_id,
    'reversal_of_entry_id', p_target_entry_id,
    'idempotent', false
  );
end;
$$;


ALTER FUNCTION "public"."reverse_credit_card_entry_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_reversal_entry_id" "uuid", "p_target_entry_id" "uuid", "p_reversal_date" "date", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reverse_debt_event_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_reversal_event_id" "uuid", "p_target_event_id" "uuid", "p_event_date" "date", "p_description" "text", "p_schedule_installments" "jsonb", "p_schedule_notes" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_person text;
  v_debt public.debts%rowtype;
  v_target public.debt_events%rowtype;
  v_existing_reversal public.debt_events%rowtype;
  v_reversal_event public.debt_events%rowtype;
  v_restored_schedule public.debt_schedule_versions%rowtype;
  v_has_gen_schedule boolean;
  v_installments_json pg_catalog.jsonb := '[]'::pg_catalog.jsonb;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;

  select hm.display_name into v_person
    from public.household_members as hm
   where hm.household_id = p_household_id and hm.user_id = v_user_id;
  if not found or v_person is null or pg_catalog.btrim(v_person) = '' then
    raise exception 'HOUSEHOLD_ACCESS_DENIED';
  end if;

  if p_household_id is null or p_debt_id is null or p_reversal_event_id is null or p_target_event_id is null or p_event_date is null then
    raise exception 'INVALID_REVERSAL_INPUT';
  end if;

  select d.* into v_debt from public.debts as d where d.id = p_debt_id and d.household_id = p_household_id for update;
  if not found then raise exception 'DEBT_NOT_FOUND'; end if;
  if v_debt.is_archived then raise exception 'DEBT_ARCHIVED'; end if;

  select e.* into v_target from public.debt_events as e where e.id = p_target_event_id for update;
  if not found or v_target.household_id <> p_household_id or v_target.debt_id <> p_debt_id then
    raise exception 'REVERSAL_TARGET_NOT_FOUND';
  end if;

  if v_target.event_type not in ('payment', 'principal_prepayment', 'payoff', 'installment_advance') then
    raise exception 'REVERSAL_TARGET_INVALID';
  end if;

  perform private.debt2b2_lock_operation(v_target.movement_id, p_reversal_event_id);

  select e.* into v_existing_reversal from public.debt_events as e where e.id = p_reversal_event_id for update;
  if found then
    if v_existing_reversal.reversal_of_event_id is distinct from p_target_event_id then
      raise exception 'DEBT_EVENT_ID_CONFLICT';
    end if;
    return private.debt2b2_reversal_result(p_reversal_event_id, true);
  end if;

  if exists (
    select 1 from public.debt_events as r
     where r.household_id = p_household_id and r.debt_id = p_debt_id
       and r.event_type = 'reversal' and r.reversal_of_event_id = p_target_event_id
  ) then
    raise exception 'TARGET_ALREADY_REVERSED';
  end if;

  insert into public.debt_events (
    id, debt_id, household_id, event_date, event_type, cash_amount, principal_delta,
    interest_paid, fees_paid, insurance_paid, other_cost_paid, breakdown_complete,
    movement_id, reversal_of_event_id, description, registered_by_user_id, created_at
  ) values (
    p_reversal_event_id, p_debt_id, p_household_id, p_event_date, 'reversal',
    0, 0, 0, 0, 0, 0, false, null, p_target_event_id, coalesce(p_description, 'Reversión'), v_user_id, now()
  ) returning * into v_reversal_event;

  perform private.debt2b2_reconcile_status(
    p_household_id, p_debt_id, private.debt2b2_current_principal(p_household_id, p_debt_id)
  );

  return private.debt2b2_reversal_result(p_reversal_event_id, false);
end;
$$;


ALTER FUNCTION "public"."reverse_debt_event_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_reversal_event_id" "uuid", "p_target_event_id" "uuid", "p_event_date" "date", "p_description" "text", "p_schedule_installments" "jsonb", "p_schedule_notes" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reverse_debt_event_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_reversal_event_id" "uuid", "p_target_event_id" "uuid", "p_event_date" "date", "p_description" "text", "p_schedule_installments" "jsonb", "p_schedule_notes" "text") IS 'DEBT-2B.2: atomic Debt classification reversal. It writes only a zero-financial-effect reversal event, never changes or compensates the original Movement, and appends a recalculated reversal schedule when required.';



CREATE OR REPLACE FUNCTION "public"."save_credit_card_profile_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_credit_limit" numeric, "p_closing_day" integer, "p_due_day" integer, "p_last4" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_user_id uuid := auth.uid();
  v_debt_kind text;
  v_profile public.credit_card_profiles%rowtype;
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

  if p_household_id is null or p_debt_id is null then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  select d.debt_kind
    into v_debt_kind
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id;

  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;

  if v_debt_kind <> 'credit_card' then
    raise exception 'DEBT_NOT_CREDIT_CARD';
  end if;

  if p_credit_limit is not null and p_credit_limit <= 0 then
    raise exception 'INVALID_CREDIT_CARD_PROFILE';
  end if;

  if p_closing_day is not null and (p_closing_day < 1 or p_closing_day > 31) then
    raise exception 'INVALID_CREDIT_CARD_PROFILE';
  end if;

  if p_due_day is not null and (p_due_day < 1 or p_due_day > 31) then
    raise exception 'INVALID_CREDIT_CARD_PROFILE';
  end if;

  if p_last4 is not null and not (p_last4 ~ '^[0-9]{4}$') then
    raise exception 'INVALID_CREDIT_CARD_PROFILE';
  end if;

  insert into public.credit_card_profiles (
    debt_id,
    household_id,
    credit_limit,
    closing_day,
    due_day,
    last4,
    created_by_user_id,
    created_at,
    updated_at
  ) values (
    p_debt_id,
    p_household_id,
    p_credit_limit,
    p_closing_day,
    p_due_day,
    p_last4,
    v_user_id,
    now(),
    now()
  )
  on conflict (debt_id, household_id) do update
  set credit_limit = excluded.credit_limit,
      closing_day = excluded.closing_day,
      due_day = excluded.due_day,
      last4 = excluded.last4,
      updated_at = now()
  returning * into v_profile;

  return pg_catalog.to_jsonb(v_profile);
end;
$_$;


ALTER FUNCTION "public"."save_credit_card_profile_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_credit_limit" numeric, "p_closing_day" integer, "p_due_day" integer, "p_last4" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_debt_archived_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_is_archived" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_debt public.debts%rowtype;
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

  if p_is_archived is null then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  select d.*
    into v_debt
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id;

  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;

  update public.debts as d
     set is_archived = p_is_archived
   where d.id = p_debt_id
     and d.household_id = p_household_id
   returning * into v_debt;

  return pg_catalog.to_jsonb(v_debt);
end;
$$;


ALTER FUNCTION "public"."set_debt_archived_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_is_archived" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."set_debt_archived_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_is_archived" boolean) IS 'DEBT-2A: archivo lógico de la deuda cambiando únicamente is_archived (updated_at lo actualiza el trigger existente). Nunca DELETE: el histórico financiero permanece.';



CREATE OR REPLACE FUNCTION "public"."sync_cash_account_opening_balance"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  update public.financial_accounts as fa
     set opening_balance = new.initial_balance
   where fa.household_id = new.household_id
     and fa.reconciliation_type = 'cash'
     and fa.is_active;
  return null;
end;
$$;


ALTER FUNCTION "public"."sync_cash_account_opening_balance"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_linked_recurring_payment"("p_debt_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_debt public.debts%rowtype;
  v_should_be_active boolean := false;
  v_due_day integer;
  v_payment_count integer := 0;
  v_covered_date date;
  v_now_date date := (pg_catalog.now() at time zone 'America/Lima')::date;
  v_now_month integer := extract(month from v_now_date)::integer;
  v_now_year integer := extract(year from v_now_date)::integer;
  v_covered_month integer;
  v_covered_year integer;
  v_is_paid boolean := false;
  v_rec_id text;
begin
  select d.*
    into v_debt
    from public.debts as d
   where d.id = p_debt_id;

  if not found then
    update public.recurring_payments
       set is_active = false
     where linked_debt_id = p_debt_id;
    return;
  end if;

  v_rec_id := 'debt:' || p_debt_id::text;

  v_should_be_active := (
    v_debt.debt_kind <> 'credit_card'
    and v_debt.status = 'active'
    and not coalesce(v_debt.is_archived, false)
    and v_debt.repayment_structure = 'open_ended'
    and v_debt.payment_frequency = 'monthly'
    and v_debt.first_due_date is not null
  );

  if not v_should_be_active then
    update public.recurring_payments
       set is_active = false
     where linked_debt_id = p_debt_id;
    return;
  end if;

  v_due_day := extract(day from v_debt.first_due_date)::integer;
  if v_due_day < 1 then v_due_day := 1; end if;
  if v_due_day > 31 then v_due_day := 31; end if;

  -- Count effective qualifying regular payment events (event_type = 'payment' and not reversed)
  select count(*)
    into v_payment_count
    from public.debt_events as e
   where e.debt_id = p_debt_id
     and e.event_type = 'payment'
     and not exists (
       select 1
         from public.debt_events as r
        where r.reversal_of_event_id = e.id
     );

  if v_payment_count > 0 then
    -- Derive covered contractual cycle: first_due_date + (v_payment_count - 1) months
    v_covered_date := v_debt.first_due_date + ((v_payment_count - 1) || ' month')::interval;
    v_covered_month := extract(month from v_covered_date)::integer;
    v_covered_year := extract(year from v_covered_date)::integer;

    if (v_covered_year > v_now_year) or (v_covered_year = v_now_year and v_covered_month >= v_now_month) then
      v_is_paid := true;
    end if;
  end if;

  insert into public.recurring_payments (
    id,
    household_id,
    name,
    amount,
    amount_mode,
    due_day,
    due_date,
    category,
    status,
    recurrence_type,
    total_installments,
    paid_installments,
    is_active,
    last_paid_month,
    last_paid_year,
    paid_at,
    linked_debt_id,
    starts_on,
    currency_code
  ) values (
    v_rec_id,
    v_debt.household_id,
    'Deuda: ' || v_debt.name,
    null,
    'variable',
    v_due_day,
    null,
    'Deudas',
    case when v_is_paid then 'pagado' else 'pendiente' end,
    'indefinite',
    null,
    0,
    true,
    v_covered_month,
    v_covered_year,
    case when v_is_paid then pg_catalog.now() else null end,
    v_debt.id,
    v_debt.first_due_date,
    coalesce(v_debt.currency_code, 'PEN')
  )
  on conflict (linked_debt_id) where linked_debt_id is not null do update set
    household_id = excluded.household_id,
    name = excluded.name,
    amount = null,
    amount_mode = 'variable',
    due_day = excluded.due_day,
    due_date = null,
    category = 'Deudas',
    status = excluded.status,
    recurrence_type = 'indefinite',
    is_active = true,
    last_paid_month = excluded.last_paid_month,
    last_paid_year = excluded.last_paid_year,
    paid_at = excluded.paid_at,
    starts_on = excluded.starts_on,
    currency_code = excluded.currency_code;
end;
$$;


ALTER FUNCTION "public"."sync_linked_recurring_payment"("p_debt_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_financial_accounts_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_financial_accounts_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_movements_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_movements_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_protect_debt_linked_recurring"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  -- Allow internal SECURITY DEFINER sync path (running as trusted DB owner) or nested triggers
  if current_user in ('postgres', 'supabase_admin') or pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' and new.linked_debt_id is not null then
    raise exception 'LINKED_DEBT_RECURRING_DIRECT_WRITE_PROHIBITED';
  end if;

  if tg_op = 'UPDATE' and (old.linked_debt_id is not null or new.linked_debt_id is not null) then
    raise exception 'LINKED_DEBT_RECURRING_DIRECT_WRITE_PROHIBITED';
  end if;

  if tg_op = 'DELETE' and old.linked_debt_id is not null then
    raise exception 'LINKED_DEBT_RECURRING_DIRECT_WRITE_PROHIBITED';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;


ALTER FUNCTION "public"."trg_protect_debt_linked_recurring"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_sync_debt_events_recurring"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_linked_recurring_payment(old.debt_id);
  else
    perform public.sync_linked_recurring_payment(new.debt_id);
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."trg_sync_debt_events_recurring"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_sync_debt_recurring"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_linked_recurring_payment(old.id);
  else
    perform public.sync_linked_recurring_payment(new.id);
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."trg_sync_debt_recurring"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unregister_push_subscription"("p_household_id" "uuid", "p_endpoint" "text", "p_app_origin" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_household_id is null or p_endpoint is null or pg_catalog.btrim(p_endpoint) = ''
     or p_app_origin is null or pg_catalog.btrim(p_app_origin) = '' then
    raise exception 'INVALID_PUSH_SUBSCRIPTION';
  end if;

  if not exists (
    select 1
    from public.household_members as hm
    where hm.household_id = p_household_id
      and hm.user_id = v_user_id
  ) then
    raise exception 'MEMBER_NOT_PROVISIONED';
  end if;

  update public.push_subscriptions
     set is_active = false,
         updated_at = pg_catalog.now()
   where user_id = v_user_id
     and household_id = p_household_id
     and endpoint = pg_catalog.btrim(p_endpoint)
     and app_origin = pg_catalog.btrim(p_app_origin);

  return found;
end;
$$;


ALTER FUNCTION "public"."unregister_push_subscription"("p_household_id" "uuid", "p_endpoint" "text", "p_app_origin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_debt_metadata_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_notes" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_debt public.debts%rowtype;
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

  if p_name is null or pg_catalog.btrim(p_name) = ''
     or p_creditor_name is null or pg_catalog.btrim(p_creditor_name) = '' then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  select d.*
    into v_debt
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id;

  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;

  update public.debts as d
     set name = pg_catalog.btrim(p_name),
         creditor_name = pg_catalog.btrim(p_creditor_name),
         notes = coalesce(p_notes, '')
   where d.id = p_debt_id
     and d.household_id = p_household_id
   returning * into v_debt;

  return pg_catalog.to_jsonb(v_debt);
end;
$$;


ALTER FUNCTION "public"."update_debt_metadata_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_notes" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_debt_metadata_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_notes" "text") IS 'DEBT-2A: edita ÚNICAMENTE metadata descriptiva (name, creditor_name, notes). No cambia términos financieros: opening_principal_balance, tracking_start_date, debt_kind, currency_code, cronograma, tasas y frecuencia permanecen inmutables vía API; su modificación requerirá operaciones/versionado posteriores (DEBT-2B+), nunca un UPDATE silencioso.';



CREATE OR REPLACE FUNCTION "public"."update_debt_terms_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_repayment_structure" "text" DEFAULT NULL::"text", "p_interest_calculation_mode" "text" DEFAULT NULL::"text", "p_periodic_rate_percent" numeric DEFAULT NULL::numeric, "p_periodic_rate_basis" "text" DEFAULT NULL::"text", "p_tea_percent" numeric DEFAULT NULL::numeric, "p_tcea_percent" numeric DEFAULT NULL::numeric, "p_payment_frequency" "text" DEFAULT NULL::"text", "p_custom_frequency_days" integer DEFAULT NULL::integer, "p_clear_periodic_rate" boolean DEFAULT false, "p_clear_tea" boolean DEFAULT false, "p_clear_tcea" boolean DEFAULT false, "p_clear_frequency" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."update_debt_terms_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_clear_periodic_rate" boolean, "p_clear_tea" boolean, "p_clear_tcea" boolean, "p_clear_frequency" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_debt_terms_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_clear_periodic_rate" boolean, "p_clear_tea" boolean, "p_clear_tcea" boolean, "p_clear_frequency" boolean) IS 'DEBT-6B: Permite actualizar o limpiar los términos financieros y estructura de pago de una deuda activa (repayment_structure, interest_calculation_mode, periodic_rate_percent, periodic_rate_basis, tea_percent, tcea_percent, payment_frequency, custom_frequency_days).';



CREATE OR REPLACE FUNCTION "public"."update_debt_terms_v2"("p_household_id" "uuid", "p_debt_id" "uuid", "p_repayment_structure" "text" DEFAULT NULL::"text", "p_interest_calculation_mode" "text" DEFAULT NULL::"text", "p_periodic_rate_percent" numeric DEFAULT NULL::numeric, "p_periodic_rate_basis" "text" DEFAULT NULL::"text", "p_tea_percent" numeric DEFAULT NULL::numeric, "p_tcea_percent" numeric DEFAULT NULL::numeric, "p_payment_frequency" "text" DEFAULT NULL::"text", "p_custom_frequency_days" integer DEFAULT NULL::integer, "p_clear_periodic_rate" boolean DEFAULT false, "p_clear_tea" boolean DEFAULT false, "p_clear_tcea" boolean DEFAULT false, "p_clear_frequency" boolean DEFAULT false, "p_first_due_date" "date" DEFAULT NULL::"date", "p_clear_first_due_date" boolean DEFAULT false, "p_minimum_principal_payment" numeric DEFAULT NULL::numeric, "p_clear_minimum_principal_payment" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_debt public.debts%rowtype;
  v_new_first_due_date date;
  v_new_minimum_principal numeric;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_minimum_principal_payment is not null and p_minimum_principal_payment <= 0 then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  -- Call existing v1 helper logic
  perform public.update_debt_terms_v1(
    p_household_id, p_debt_id, p_repayment_structure, p_interest_calculation_mode,
    p_periodic_rate_percent, p_periodic_rate_basis, p_tea_percent, p_tcea_percent,
    p_payment_frequency, p_custom_frequency_days,
    p_clear_periodic_rate, p_clear_tea, p_clear_tcea, p_clear_frequency
  );

  select d.*
    into v_debt
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id;

  v_new_first_due_date := case
    when coalesce(p_clear_first_due_date, false) then null
    when p_first_due_date is not null then p_first_due_date
    else v_debt.first_due_date
  end;

  v_new_minimum_principal := case
    when coalesce(p_clear_minimum_principal_payment, false) then null
    when p_minimum_principal_payment is not null then p_minimum_principal_payment
    else v_debt.minimum_principal_payment
  end;

  update public.debts as d
     set first_due_date = v_new_first_due_date,
         minimum_principal_payment = v_new_minimum_principal,
         updated_at = now()
   where d.id = p_debt_id
     and d.household_id = p_household_id
   returning * into v_debt;

  perform public.sync_linked_recurring_payment(p_debt_id);

  return pg_catalog.to_jsonb(v_debt);
end;
$$;


ALTER FUNCTION "public"."update_debt_terms_v2"("p_household_id" "uuid", "p_debt_id" "uuid", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_clear_periodic_rate" boolean, "p_clear_tea" boolean, "p_clear_tcea" boolean, "p_clear_frequency" boolean, "p_first_due_date" "date", "p_clear_first_due_date" boolean, "p_minimum_principal_payment" numeric, "p_clear_minimum_principal_payment" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_debt_terms_v2"("p_household_id" "uuid", "p_debt_id" "uuid", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_clear_periodic_rate" boolean, "p_clear_tea" boolean, "p_clear_tcea" boolean, "p_clear_frequency" boolean, "p_first_due_date" "date", "p_clear_first_due_date" boolean, "p_minimum_principal_payment" numeric, "p_clear_minimum_principal_payment" boolean) IS 'DEBT-6B.2: Actualiza términos de deuda incluyendo día/fecha de vencimiento y abono mínimo obligatorio a capital.';



CREATE OR REPLACE FUNCTION "public"."validate_credit_card_profile_kind"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_debt_kind text;
begin
  select d.debt_kind
    into v_debt_kind
    from public.debts as d
   where d.id = new.debt_id
     and d.household_id = new.household_id;

  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;
  if v_debt_kind <> 'credit_card' then
    raise exception 'CREDIT_CARD_PROFILE_MUST_BE_CREDIT_CARD_DEBT';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."validate_credit_card_profile_kind"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_debt_event_movement"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_movement public.movements%rowtype;
  v_reconciliation_type text;
begin
  if new.movement_id is null then
    return new;
  end if;

  select m.*
    into v_movement
    from public.movements as m
   where m.id = new.movement_id
     and m.household_id = new.household_id;

  if not found then
    raise exception 'DEBT_MOVEMENT_NOT_FOUND';
  end if;
  if v_movement.type <> 'egreso' then
    raise exception 'DEBT_MOVEMENT_MUST_BE_EXPENSE';
  end if;
  if v_movement.amount <> new.cash_amount then
    raise exception 'DEBT_MOVEMENT_AMOUNT_MISMATCH';
  end if;
  if v_movement.date is distinct from new.event_date then
    raise exception 'DEBT_MOVEMENT_DATE_MISMATCH';
  end if;
  if v_movement.movement_context is distinct from 'debt_service' then
    raise exception 'DEBT_MOVEMENT_CONTEXT_REQUIRED';
  end if;
  if v_movement.account_id is null then
    raise exception 'DEBT_MOVEMENT_ACCOUNT_REQUIRED';
  end if;

  select fa.reconciliation_type
    into v_reconciliation_type
    from public.financial_accounts as fa
   where fa.id = v_movement.account_id
     and fa.household_id = new.household_id;

  if not found then
    raise exception 'DEBT_MOVEMENT_ACCOUNT_NOT_FOUND';
  end if;
  if v_reconciliation_type = 'cash'
     and v_movement.method is distinct from 'efectivo' then
    raise exception 'DEBT_MOVEMENT_ACCOUNT_METHOD_MISMATCH';
  end if;
  if v_reconciliation_type = 'balance'
     and v_movement.method is distinct from 'transferencia' then
    raise exception 'DEBT_MOVEMENT_ACCOUNT_METHOD_MISMATCH';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."validate_debt_event_movement"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_debt_event_reversal"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_target_type text;
begin
  if new.event_type = 'reversal' then
    select de.event_type
      into v_target_type
      from public.debt_events as de
     where de.id = new.reversal_of_event_id
       and de.debt_id = new.debt_id
       and de.household_id = new.household_id;
    if not found then
      raise exception 'DEBT_REVERSAL_TARGET_NOT_FOUND';
    end if;
    if v_target_type = 'reversal' then
      raise exception 'DEBT_REVERSAL_OF_REVERSAL_NOT_ALLOWED';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."validate_debt_event_reversal"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_debt_installment_allocation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
  if v_event_type <> 'payment' then
    raise exception 'DEBT_EVENT_NOT_ALLOCATABLE';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."validate_debt_installment_allocation"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."account_reconciliation_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "household_id" "uuid" NOT NULL,
    "reconciliation_id" "uuid" NOT NULL,
    "movement_id" "text" NOT NULL,
    "balance_contribution" numeric(12,2) NOT NULL,
    "movement_updated_at_snapshot" timestamp with time zone NOT NULL,
    "movement_snapshot" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."account_reconciliation_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."account_reconciliations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "household_id" "uuid" NOT NULL,
    "account_id" "uuid" NOT NULL,
    "reconciliation_type" "text" NOT NULL,
    "currency_code" "text" NOT NULL,
    "opening_balance_snapshot" numeric(12,2) NOT NULL,
    "expected_balance" numeric(12,2) NOT NULL,
    "actual_balance" numeric(12,2) NOT NULL,
    "difference" numeric(12,2) NOT NULL,
    "status" "text" NOT NULL,
    "denominations" "jsonb",
    "registered_by_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "account_reconciliations_reconciliation_type_check" CHECK (("reconciliation_type" = ANY (ARRAY['balance'::"text", 'cash'::"text"]))),
    CONSTRAINT "account_reconciliations_status_check" CHECK (("status" = ANY (ARRAY['matched'::"text", 'mismatch'::"text"])))
);


ALTER TABLE "public"."account_reconciliations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_loan_profiles" (
    "debt_id" "uuid" NOT NULL,
    "household_id" "uuid" NOT NULL,
    "loan_subtype" "text" NOT NULL,
    "contract_number" "text",
    "amortization_method" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "disbursed_amount" numeric,
    "asset_price" numeric,
    "down_payment_amount" numeric,
    "financed_amount" numeric,
    "term_installments" integer,
    "grace_period_type" "text" DEFAULT 'none'::"text" NOT NULL,
    "grace_period_installments" integer,
    "balloon_payment_amount" numeric,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "created_by_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bank_loan_profiles_amortization_method_check" CHECK (("amortization_method" = ANY (ARRAY['fixed_installment'::"text", 'constant_principal'::"text", 'increasing_installment'::"text", 'decreasing_installment'::"text", 'irregular_contract'::"text", 'custom'::"text", 'unknown'::"text"]))),
    CONSTRAINT "bank_loan_profiles_asset_price_check" CHECK ((("asset_price" IS NULL) OR ("asset_price" >= (0)::numeric))),
    CONSTRAINT "bank_loan_profiles_balloon_payment_amount_check" CHECK ((("balloon_payment_amount" IS NULL) OR ("balloon_payment_amount" >= (0)::numeric))),
    CONSTRAINT "bank_loan_profiles_disbursed_amount_check" CHECK ((("disbursed_amount" IS NULL) OR ("disbursed_amount" >= (0)::numeric))),
    CONSTRAINT "bank_loan_profiles_down_payment_amount_check" CHECK ((("down_payment_amount" IS NULL) OR ("down_payment_amount" >= (0)::numeric))),
    CONSTRAINT "bank_loan_profiles_financed_amount_check" CHECK ((("financed_amount" IS NULL) OR ("financed_amount" >= (0)::numeric))),
    CONSTRAINT "bank_loan_profiles_grace_period_installments_check" CHECK ((("grace_period_installments" IS NULL) OR ("grace_period_installments" >= 0))),
    CONSTRAINT "bank_loan_profiles_grace_period_type_check" CHECK (("grace_period_type" = ANY (ARRAY['none'::"text", 'total'::"text", 'partial'::"text"]))),
    CONSTRAINT "bank_loan_profiles_loan_subtype_check" CHECK (("loan_subtype" = ANY (ARRAY['personal'::"text", 'vehicular'::"text", 'mortgage'::"text", 'education'::"text", 'payroll'::"text", 'debt_consolidation'::"text", 'business'::"text", 'other'::"text"]))),
    CONSTRAINT "bank_loan_profiles_term_installments_check" CHECK ((("term_installments" IS NULL) OR ("term_installments" > 0)))
);


ALTER TABLE "public"."bank_loan_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cash_counts" (
    "id" "text" NOT NULL,
    "household_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "denominations" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "total" numeric(12,2) DEFAULT 0 NOT NULL,
    "expected" numeric(12,2) DEFAULT 0 NOT NULL,
    "difference" numeric(12,2) DEFAULT 0 NOT NULL,
    "account_id" "uuid"
);


ALTER TABLE "public"."cash_counts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" "text" NOT NULL,
    "household_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "color" "text",
    "icon" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "categories_type_check" CHECK (("type" = ANY (ARRAY['ingreso'::"text", 'egreso'::"text", 'ambos'::"text"])))
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credit_card_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "debt_id" "uuid" NOT NULL,
    "household_id" "uuid" NOT NULL,
    "entry_date" "date" NOT NULL,
    "entry_type" "text" NOT NULL,
    "liability_delta" numeric NOT NULL,
    "movement_id" "text",
    "reversal_of_entry_id" "uuid",
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "registered_by_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "credit_of_entry_id" "uuid",
    CONSTRAINT "chk_credit_card_entries_credit_of_entry" CHECK (((("entry_type" = 'credit'::"text") AND ("credit_of_entry_id" IS NOT NULL) AND ("credit_of_entry_id" <> "id")) OR (("entry_type" <> 'credit'::"text") AND ("credit_of_entry_id" IS NULL)))),
    CONSTRAINT "credit_card_entries_payment_sign_check" CHECK ((("entry_type" <> ALL (ARRAY['payment'::"text", 'credit'::"text"])) OR ("liability_delta" < (0)::numeric))),
    CONSTRAINT "credit_card_entries_purchase_sign_check" CHECK ((("entry_type" <> ALL (ARRAY['purchase'::"text", 'finance_charge'::"text"])) OR ("liability_delta" > (0)::numeric))),
    CONSTRAINT "credit_card_entries_reversal_self_check" CHECK ((("reversal_of_entry_id" IS NULL) OR ("reversal_of_entry_id" <> "id"))),
    CONSTRAINT "credit_card_entries_reversal_semantics_check" CHECK (((("entry_type" = 'reversal'::"text") AND ("liability_delta" = (0)::numeric) AND ("movement_id" IS NULL) AND ("reversal_of_entry_id" IS NOT NULL)) OR (("entry_type" <> 'reversal'::"text") AND ("reversal_of_entry_id" IS NULL) AND ("movement_id" IS NOT NULL)))),
    CONSTRAINT "credit_card_entries_type_check" CHECK (("entry_type" = ANY (ARRAY['purchase'::"text", 'payment'::"text", 'finance_charge'::"text", 'credit'::"text", 'reversal'::"text"])))
);


ALTER TABLE "public"."credit_card_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credit_card_profiles" (
    "debt_id" "uuid" NOT NULL,
    "household_id" "uuid" NOT NULL,
    "credit_limit" numeric,
    "closing_day" integer,
    "due_day" integer,
    "last4" "text",
    "created_by_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "credit_card_profiles_closing_day_check" CHECK ((("closing_day" IS NULL) OR (("closing_day" >= 1) AND ("closing_day" <= 31)))),
    CONSTRAINT "credit_card_profiles_credit_limit_check" CHECK ((("credit_limit" IS NULL) OR ("credit_limit" > (0)::numeric))),
    CONSTRAINT "credit_card_profiles_due_day_check" CHECK ((("due_day" IS NULL) OR (("due_day" >= 1) AND ("due_day" <= 31)))),
    CONSTRAINT "credit_card_profiles_last4_check" CHECK ((("last4" IS NULL) OR ("last4" ~ '^[0-9]{4}$'::"text")))
);


ALTER TABLE "public"."credit_card_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credit_card_statements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "debt_id" "uuid" NOT NULL,
    "household_id" "uuid" NOT NULL,
    "statement_date" "date" NOT NULL,
    "due_date" "date" NOT NULL,
    "statement_balance" numeric NOT NULL,
    "minimum_payment_amount" numeric,
    "closing_entry_id" "uuid",
    "created_by_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "credit_card_statements_dates_check" CHECK (("due_date" >= "statement_date"))
);


ALTER TABLE "public"."credit_card_statements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."debt_collaterals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "debt_id" "uuid" NOT NULL,
    "household_id" "uuid" NOT NULL,
    "description" "text" NOT NULL,
    "pledged_value" numeric,
    "estimated_value" numeric,
    "redemption_deadline" "date",
    "status" "text" DEFAULT 'pledged'::"text" NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "created_by_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "debt_collaterals_description_not_blank_check" CHECK (("btrim"("description") <> ''::"text")),
    CONSTRAINT "debt_collaterals_estimated_value_non_negative_check" CHECK ((("estimated_value" IS NULL) OR ("estimated_value" >= (0)::numeric))),
    CONSTRAINT "debt_collaterals_pledged_value_non_negative_check" CHECK ((("pledged_value" IS NULL) OR ("pledged_value" >= (0)::numeric))),
    CONSTRAINT "debt_collaterals_status_check" CHECK (("status" = ANY (ARRAY['pledged'::"text", 'released'::"text", 'forfeited'::"text"])))
);


ALTER TABLE "public"."debt_collaterals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."debt_event_installment_allocations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "installment_id" "uuid" NOT NULL,
    "debt_id" "uuid" NOT NULL,
    "household_id" "uuid" NOT NULL,
    "allocated_amount" numeric NOT NULL,
    "created_by_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "debt_event_installment_allocations_allocated_amount_positive_ch" CHECK (("allocated_amount" > (0)::numeric))
);


ALTER TABLE "public"."debt_event_installment_allocations" OWNER TO "postgres";


COMMENT ON TABLE "public"."debt_event_installment_allocations" IS 'Allocation: solo eventos payment son asignables a cuotas. Principal prepayment y payoff NO marcan cuotas como pagadas automáticamente. El control de SUM(allocated_amount) <= event.cash_amount será responsabilidad de la operación atómica DEBT-2. Las allocations de un payment posteriormente revertido permanecen históricamente almacenadas; al calcular el estado de una cuota se consideran únicamente allocations de payments efectivos (no revertidos). No se borran allocations ni se crean reversals de allocation.';



CREATE TABLE IF NOT EXISTS "public"."debt_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "debt_id" "uuid" NOT NULL,
    "household_id" "uuid" NOT NULL,
    "event_date" "date" NOT NULL,
    "event_type" "text" NOT NULL,
    "cash_amount" numeric DEFAULT 0 NOT NULL,
    "principal_delta" numeric DEFAULT 0 NOT NULL,
    "interest_paid" numeric DEFAULT 0 NOT NULL,
    "fees_paid" numeric DEFAULT 0 NOT NULL,
    "insurance_paid" numeric DEFAULT 0 NOT NULL,
    "other_cost_paid" numeric DEFAULT 0 NOT NULL,
    "breakdown_complete" boolean DEFAULT false NOT NULL,
    "movement_id" "text",
    "reversal_of_event_id" "uuid",
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "registered_by_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "extra_principal_amount" numeric DEFAULT 0 NOT NULL,
    "prepayment_effect" "text",
    CONSTRAINT "debt_events_breakdown_false_for_non_fund_events_check" CHECK ((("event_type" = ANY (ARRAY['payment'::"text", 'principal_prepayment'::"text", 'payoff'::"text", 'installment_advance'::"text"])) OR ("breakdown_complete" = false))),
    CONSTRAINT "debt_events_breakdown_matches_cash_check" CHECK ((("breakdown_complete" = false) OR (("event_type" = ANY (ARRAY['payment'::"text", 'principal_prepayment'::"text", 'payoff'::"text", 'installment_advance'::"text"])) AND ("cash_amount" = (((((- "principal_delta") + "interest_paid") + "fees_paid") + "insurance_paid") + "other_cost_paid"))))),
    CONSTRAINT "debt_events_cash_amount_non_negative_check" CHECK (("cash_amount" >= (0)::numeric)),
    CONSTRAINT "debt_events_cash_positive_for_fund_movements_check" CHECK ((("event_type" <> ALL (ARRAY['payment'::"text", 'principal_prepayment'::"text", 'payoff'::"text", 'installment_advance'::"text"])) OR ("cash_amount" > (0)::numeric))),
    CONSTRAINT "debt_events_cash_zero_for_non_fund_events_check" CHECK ((("event_type" = ANY (ARRAY['payment'::"text", 'principal_prepayment'::"text", 'payoff'::"text", 'installment_advance'::"text"])) OR ("cash_amount" = (0)::numeric))),
    CONSTRAINT "debt_events_costs_zero_for_non_fund_events_check" CHECK ((("event_type" = ANY (ARRAY['payment'::"text", 'principal_prepayment'::"text", 'payoff'::"text", 'installment_advance'::"text"])) OR (("interest_paid" = (0)::numeric) AND ("fees_paid" = (0)::numeric) AND ("insurance_paid" = (0)::numeric) AND ("other_cost_paid" = (0)::numeric)))),
    CONSTRAINT "debt_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['payment'::"text", 'principal_prepayment'::"text", 'principal_adjustment'::"text", 'refinance'::"text", 'payoff'::"text", 'reversal'::"text", 'installment_advance'::"text"]))),
    CONSTRAINT "debt_events_extra_principal_amount_non_negative_check" CHECK (("extra_principal_amount" >= (0)::numeric)),
    CONSTRAINT "debt_events_fees_paid_non_negative_check" CHECK (("fees_paid" >= (0)::numeric)),
    CONSTRAINT "debt_events_insurance_paid_non_negative_check" CHECK (("insurance_paid" >= (0)::numeric)),
    CONSTRAINT "debt_events_interest_paid_non_negative_check" CHECK (("interest_paid" >= (0)::numeric)),
    CONSTRAINT "debt_events_movement_only_for_fund_events_check" CHECK ((("event_type" = ANY (ARRAY['payment'::"text", 'principal_prepayment'::"text", 'payoff'::"text", 'installment_advance'::"text"])) OR ("movement_id" IS NULL))),
    CONSTRAINT "debt_events_other_cost_paid_non_negative_check" CHECK (("other_cost_paid" >= (0)::numeric)),
    CONSTRAINT "debt_events_payment_principal_delta_non_positive_check" CHECK ((("event_type" <> 'payment'::"text") OR ("principal_delta" <= (0)::numeric))),
    CONSTRAINT "debt_events_payoff_principal_delta_non_positive_check" CHECK ((("event_type" <> 'payoff'::"text") OR ("principal_delta" <= (0)::numeric))),
    CONSTRAINT "debt_events_prepayment_effect_check" CHECK ((("prepayment_effect" IS NULL) OR ("prepayment_effect" = ANY (ARRAY['reduce_term'::"text", 'reduce_installment'::"text", 'pending_bank_schedule'::"text", 'other'::"text", 'unknown'::"text"])))),
    CONSTRAINT "debt_events_prepayment_negative_delta_check" CHECK ((("event_type" <> 'principal_prepayment'::"text") OR ("principal_delta" < (0)::numeric))),
    CONSTRAINT "debt_events_principal_reduction_within_cash_check" CHECK ((("event_type" <> ALL (ARRAY['payment'::"text", 'principal_prepayment'::"text", 'payoff'::"text", 'installment_advance'::"text"])) OR ((- "principal_delta") <= "cash_amount"))),
    CONSTRAINT "debt_events_reversal_not_self_target_check" CHECK ((("event_type" <> 'reversal'::"text") OR ("reversal_of_event_id" <> "id"))),
    CONSTRAINT "debt_events_reversal_requires_target_check" CHECK ((("event_type" <> 'reversal'::"text") OR ("reversal_of_event_id" IS NOT NULL))),
    CONSTRAINT "debt_events_reversal_target_only_for_reversal_check" CHECK ((("event_type" = 'reversal'::"text") OR ("reversal_of_event_id" IS NULL))),
    CONSTRAINT "debt_events_reversal_zero_financial_effect_check" CHECK ((("event_type" <> 'reversal'::"text") OR (("cash_amount" = (0)::numeric) AND ("principal_delta" = (0)::numeric) AND ("interest_paid" = (0)::numeric) AND ("fees_paid" = (0)::numeric) AND ("insurance_paid" = (0)::numeric) AND ("other_cost_paid" = (0)::numeric))))
);


ALTER TABLE "public"."debt_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."debt_events" IS 'DEBT-2B.2 reversals correct Debt classification only. The original Movement and its cash fact remain immutable; cash corrections are outside this gate.';



COMMENT ON COLUMN "public"."debt_events"."principal_delta" IS 'Contrato: principal_delta < 0 reduce el principal pendiente; > 0 lo incrementa; = 0 no lo altera. Saldo = opening_principal_balance + SUM(principal_delta) de eventos efectivos no revertidos (los reversals no se suman). DEBT-2 deberá impedir que una operación normal deje current_principal < 0; la constraint cross-row se implementará en DEBT-2 por requerir operación transaccional/concurrencia.';



COMMENT ON COLUMN "public"."debt_events"."movement_id" IS 'Movimiento financiero opcional en DEBT-1A. La creación atómica movimiento + pago llegará en DEBT-2. Un mismo movement_id solo puede pertenecer a un evento efectivo a la vez; revertido el evento anterior, el movimiento puede reutilizarse en un evento correctivo. La garantía concurrente de un solo evento efectivo por movimiento (considerando solo eventos no revertidos) se implementa atómicamente en DEBT-2. El reversal no lleva movement_id: el vínculo histórico queda en el evento original.';



COMMENT ON COLUMN "public"."debt_events"."reversal_of_event_id" IS 'Un reversal invalida lógicamente el evento objetivo. Los cálculos financieros deben considerar únicamente eventos no-reversal que no hayan sido objetivo de un reversal. El reversal en sí no se suma financieramente.';



CREATE TABLE IF NOT EXISTS "public"."debt_installments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "schedule_version_id" "uuid" NOT NULL,
    "debt_id" "uuid" NOT NULL,
    "household_id" "uuid" NOT NULL,
    "installment_number" integer NOT NULL,
    "due_date" "date" NOT NULL,
    "expected_amount" numeric,
    "expected_principal" numeric,
    "expected_interest" numeric,
    "expected_fees" numeric,
    "expected_insurance" numeric,
    "created_by_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "debt_installments_expected_amount_positive_check" CHECK ((("expected_amount" IS NULL) OR ("expected_amount" > (0)::numeric))),
    CONSTRAINT "debt_installments_expected_components_within_amount_check" CHECK ((("expected_amount" IS NULL) OR ((((COALESCE("expected_principal", (0)::numeric) + COALESCE("expected_interest", (0)::numeric)) + COALESCE("expected_fees", (0)::numeric)) + COALESCE("expected_insurance", (0)::numeric)) <= "expected_amount"))),
    CONSTRAINT "debt_installments_expected_fees_non_negative_check" CHECK ((("expected_fees" IS NULL) OR ("expected_fees" >= (0)::numeric))),
    CONSTRAINT "debt_installments_expected_insurance_non_negative_check" CHECK ((("expected_insurance" IS NULL) OR ("expected_insurance" >= (0)::numeric))),
    CONSTRAINT "debt_installments_expected_interest_non_negative_check" CHECK ((("expected_interest" IS NULL) OR ("expected_interest" >= (0)::numeric))),
    CONSTRAINT "debt_installments_expected_principal_non_negative_check" CHECK ((("expected_principal" IS NULL) OR ("expected_principal" >= (0)::numeric))),
    CONSTRAINT "debt_installments_number_positive_check" CHECK (("installment_number" > 0))
);


ALTER TABLE "public"."debt_installments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."debt_installments"."expected_amount" IS 'El estado de cada cuota (pagada/pendiente) NO se almacena: se deriva de debt_event_installment_allocations y eventos.';



CREATE TABLE IF NOT EXISTS "public"."debt_insurance_terms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "debt_id" "uuid" NOT NULL,
    "household_id" "uuid" NOT NULL,
    "insurance_type" "text" NOT NULL,
    "label" "text" NOT NULL,
    "pricing_mode" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "rate_percent" numeric,
    "fixed_amount" numeric,
    "rate_basis" "text",
    "is_required" boolean DEFAULT true NOT NULL,
    "provider" "text",
    "policy_reference" "text",
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "created_by_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "debt_insurance_terms_fixed_amount_check" CHECK ((("fixed_amount" IS NULL) OR ("fixed_amount" >= (0)::numeric))),
    CONSTRAINT "debt_insurance_terms_insurance_type_check" CHECK (("insurance_type" = ANY (ARRAY['credit_life'::"text", 'vehicle'::"text", 'property'::"text", 'other'::"text"]))),
    CONSTRAINT "debt_insurance_terms_label_not_blank_check" CHECK (("btrim"("label") <> ''::"text")),
    CONSTRAINT "debt_insurance_terms_pricing_mode_check" CHECK (("pricing_mode" = ANY (ARRAY['fixed_amount'::"text", 'percent_outstanding_balance'::"text", 'percent_original_principal'::"text", 'contract_schedule'::"text", 'unknown'::"text"]))),
    CONSTRAINT "debt_insurance_terms_rate_percent_check" CHECK ((("rate_percent" IS NULL) OR ("rate_percent" >= (0)::numeric)))
);


ALTER TABLE "public"."debt_insurance_terms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."financial_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "household_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "reconciliation_type" "text" NOT NULL,
    "opening_balance" numeric(12,2) DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "currency_code" "text" DEFAULT 'PEN'::"text" NOT NULL,
    CONSTRAINT "financial_accounts_currency_code_check" CHECK (("currency_code" = ANY (ARRAY['PEN'::"text", 'USD'::"text"]))),
    CONSTRAINT "financial_accounts_name_not_blank_check" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "financial_accounts_reconciliation_type_check" CHECK (("reconciliation_type" = ANY (ARRAY['cash'::"text", 'balance'::"text"])))
);


ALTER TABLE "public"."financial_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."household_members" (
    "household_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "display_name" "text",
    CONSTRAINT "household_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."household_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."households" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."households" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."movement_corrections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "household_id" "uuid" NOT NULL,
    "movement_id" "text" NOT NULL,
    "correction_id" "uuid" NOT NULL,
    "request_snapshot" "jsonb" NOT NULL,
    "before_snapshot" "jsonb" NOT NULL,
    "after_snapshot" "jsonb" NOT NULL,
    "reason" "text" NOT NULL,
    "registered_by_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."movement_corrections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_notification_deliveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subscription_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "household_id" "uuid" NOT NULL,
    "notification_date" "date" NOT NULL,
    "notification_type" "text" NOT NULL,
    "status" "text" DEFAULT 'claimed'::"text" NOT NULL,
    "error_code" "text",
    "claimed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "push_notification_deliveries_status_check" CHECK (("status" = ANY (ARRAY['claimed'::"text", 'sent'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."push_notification_deliveries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "household_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "app_origin" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "expires_at" timestamp with time zone,
    "last_success_at" timestamp with time zone,
    "last_failure_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "push_subscriptions_app_origin_not_blank_check" CHECK (("btrim"("app_origin") <> ''::"text")),
    CONSTRAINT "push_subscriptions_auth_not_blank_check" CHECK (("btrim"("auth") <> ''::"text")),
    CONSTRAINT "push_subscriptions_endpoint_not_blank_check" CHECK (("btrim"("endpoint") <> ''::"text")),
    CONSTRAINT "push_subscriptions_p256dh_not_blank_check" CHECK (("btrim"("p256dh") <> ''::"text"))
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recurring_payments" (
    "id" "text" NOT NULL,
    "household_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "amount" numeric(12,2),
    "amount_mode" "text" DEFAULT 'fixed'::"text" NOT NULL,
    "due_day" integer,
    "due_date" "date",
    "category" "text" NOT NULL,
    "status" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "recurrence_type" "text" DEFAULT 'indefinite'::"text" NOT NULL,
    "total_installments" integer,
    "paid_installments" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "last_paid_month" integer,
    "last_paid_year" integer,
    "paid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "linked_debt_id" "uuid",
    "starts_on" "date",
    "currency_code" "text" DEFAULT 'PEN'::"text" NOT NULL,
    CONSTRAINT "recurring_payments_amount_mode_check" CHECK (((("amount_mode" = 'fixed'::"text") AND ("amount" IS NOT NULL) AND ("amount" > (0)::numeric)) OR (("amount_mode" = 'variable'::"text") AND (("amount" IS NULL) OR ("amount" > (0)::numeric))))),
    CONSTRAINT "recurring_payments_amount_mode_values_check" CHECK (("amount_mode" = ANY (ARRAY['fixed'::"text", 'variable'::"text"]))),
    CONSTRAINT "recurring_payments_amount_positive_or_null_check" CHECK ((("amount" IS NULL) OR ("amount" > (0)::numeric))),
    CONSTRAINT "recurring_payments_due_day_check" CHECK ((("due_day" IS NULL) OR (("due_day" >= 1) AND ("due_day" <= 31)))),
    CONSTRAINT "recurring_payments_installments_check" CHECK (((("recurrence_type" = 'fixed'::"text") AND ("total_installments" IS NOT NULL) AND ("total_installments" > 0)) OR (("recurrence_type" = ANY (ARRAY['indefinite'::"text", 'one_time'::"text"])) AND ("total_installments" IS NULL)))),
    CONSTRAINT "recurring_payments_last_paid_month_check" CHECK ((("last_paid_month" IS NULL) OR (("last_paid_month" >= 1) AND ("last_paid_month" <= 12)))),
    CONSTRAINT "recurring_payments_last_paid_year_check" CHECK ((("last_paid_year" IS NULL) OR ("last_paid_year" >= 2000))),
    CONSTRAINT "recurring_payments_paid_installments_check" CHECK (("paid_installments" >= 0)),
    CONSTRAINT "recurring_payments_recurrence_type_check" CHECK (("recurrence_type" = ANY (ARRAY['indefinite'::"text", 'fixed'::"text", 'one_time'::"text"]))),
    CONSTRAINT "recurring_payments_schedule_check" CHECK (((("recurrence_type" = 'one_time'::"text") AND ("due_date" IS NOT NULL) AND ("due_day" IS NULL)) OR (("recurrence_type" = ANY (ARRAY['indefinite'::"text", 'fixed'::"text"])) AND ("due_day" IS NOT NULL) AND (("due_day" >= 1) AND ("due_day" <= 31)) AND ("due_date" IS NULL)))),
    CONSTRAINT "recurring_payments_status_check" CHECK (("status" = ANY (ARRAY['pendiente'::"text", 'pagado'::"text"])))
);


ALTER TABLE "public"."recurring_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."settings" (
    "household_id" "uuid" NOT NULL,
    "initial_balance" numeric(12,2) DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."settings" OWNER TO "postgres";


ALTER TABLE ONLY "public"."account_reconciliation_movements"
    ADD CONSTRAINT "account_reconciliation_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."account_reconciliation_movements"
    ADD CONSTRAINT "account_reconciliation_movements_unique_rec_mov" UNIQUE ("reconciliation_id", "movement_id");



ALTER TABLE ONLY "public"."account_reconciliations"
    ADD CONSTRAINT "account_reconciliations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_loan_profiles"
    ADD CONSTRAINT "bank_loan_profiles_pkey" PRIMARY KEY ("debt_id");



ALTER TABLE ONLY "public"."cash_counts"
    ADD CONSTRAINT "cash_counts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credit_card_entries"
    ADD CONSTRAINT "credit_card_entries_id_debt_household_key" UNIQUE ("id", "debt_id", "household_id");



ALTER TABLE ONLY "public"."credit_card_entries"
    ADD CONSTRAINT "credit_card_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credit_card_profiles"
    ADD CONSTRAINT "credit_card_profiles_debt_household_key" UNIQUE ("debt_id", "household_id");



ALTER TABLE ONLY "public"."credit_card_profiles"
    ADD CONSTRAINT "credit_card_profiles_pkey" PRIMARY KEY ("debt_id");



ALTER TABLE ONLY "public"."credit_card_statements"
    ADD CONSTRAINT "credit_card_statements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credit_card_statements"
    ADD CONSTRAINT "credit_card_statements_unique_cycle" UNIQUE ("debt_id", "statement_date");



ALTER TABLE ONLY "public"."debt_collaterals"
    ADD CONSTRAINT "debt_collaterals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."debt_event_installment_allocations"
    ADD CONSTRAINT "debt_event_installment_allocations_event_installment_key" UNIQUE ("event_id", "installment_id");



ALTER TABLE ONLY "public"."debt_event_installment_allocations"
    ADD CONSTRAINT "debt_event_installment_allocations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."debt_events"
    ADD CONSTRAINT "debt_events_id_debt_household_key" UNIQUE ("id", "debt_id", "household_id");



ALTER TABLE ONLY "public"."debt_events"
    ADD CONSTRAINT "debt_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."debt_installments"
    ADD CONSTRAINT "debt_installments_id_debt_household_key" UNIQUE ("id", "debt_id", "household_id");



ALTER TABLE ONLY "public"."debt_installments"
    ADD CONSTRAINT "debt_installments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."debt_installments"
    ADD CONSTRAINT "debt_installments_schedule_version_number_key" UNIQUE ("schedule_version_id", "installment_number");



ALTER TABLE ONLY "public"."debt_insurance_terms"
    ADD CONSTRAINT "debt_insurance_terms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."debt_schedule_versions"
    ADD CONSTRAINT "debt_schedule_versions_debt_version_key" UNIQUE ("debt_id", "version_number");



ALTER TABLE ONLY "public"."debt_schedule_versions"
    ADD CONSTRAINT "debt_schedule_versions_id_debt_household_key" UNIQUE ("id", "debt_id", "household_id");



ALTER TABLE ONLY "public"."debt_schedule_versions"
    ADD CONSTRAINT "debt_schedule_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."debts"
    ADD CONSTRAINT "debts_id_household_key" UNIQUE ("id", "household_id");



ALTER TABLE ONLY "public"."debts"
    ADD CONSTRAINT "debts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."financial_accounts"
    ADD CONSTRAINT "financial_accounts_id_household_key" UNIQUE ("id", "household_id");



ALTER TABLE ONLY "public"."financial_accounts"
    ADD CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."household_members"
    ADD CONSTRAINT "household_members_pkey" PRIMARY KEY ("household_id", "user_id");



ALTER TABLE ONLY "public"."households"
    ADD CONSTRAINT "households_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."movement_corrections"
    ADD CONSTRAINT "movement_corrections_correction_id_key" UNIQUE ("correction_id");



ALTER TABLE ONLY "public"."movement_corrections"
    ADD CONSTRAINT "movement_corrections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."movements"
    ADD CONSTRAINT "movements_id_household_key" UNIQUE ("id", "household_id");



ALTER TABLE ONLY "public"."movements"
    ADD CONSTRAINT "movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_notification_deliveries"
    ADD CONSTRAINT "push_notification_deliveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_notification_deliveries"
    ADD CONSTRAINT "push_notification_deliveries_subscription_day_type_unique" UNIQUE ("subscription_id", "notification_date", "notification_type");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE ("endpoint");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recurring_payments"
    ADD CONSTRAINT "recurring_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."settings"
    ADD CONSTRAINT "settings_pkey" PRIMARY KEY ("household_id");



CREATE UNIQUE INDEX "debt_events_reversal_of_event_key" ON "public"."debt_events" USING "btree" ("reversal_of_event_id") WHERE ("reversal_of_event_id" IS NOT NULL);



CREATE UNIQUE INDEX "financial_accounts_one_active_cash_per_household" ON "public"."financial_accounts" USING "btree" ("household_id") WHERE (("reconciliation_type" = 'cash'::"text") AND ("is_active" = true));



CREATE INDEX "idx_account_reconciliation_movements_movement" ON "public"."account_reconciliation_movements" USING "btree" ("movement_id");



CREATE INDEX "idx_account_reconciliation_movements_rec" ON "public"."account_reconciliation_movements" USING "btree" ("reconciliation_id");



CREATE INDEX "idx_account_reconciliations_household_account" ON "public"."account_reconciliations" USING "btree" ("household_id", "account_id", "created_at" DESC);



CREATE INDEX "idx_bank_loan_profiles_household" ON "public"."bank_loan_profiles" USING "btree" ("household_id");



CREATE INDEX "idx_cash_counts_account_household" ON "public"."cash_counts" USING "btree" ("account_id", "household_id");



CREATE INDEX "idx_credit_card_entries_credit_target" ON "public"."credit_card_entries" USING "btree" ("credit_of_entry_id") WHERE ("credit_of_entry_id" IS NOT NULL);



CREATE INDEX "idx_credit_card_entries_debt_date" ON "public"."credit_card_entries" USING "btree" ("household_id", "debt_id", "entry_date", "created_at");



CREATE UNIQUE INDEX "idx_credit_card_entries_movement_id" ON "public"."credit_card_entries" USING "btree" ("movement_id") WHERE ("movement_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_credit_card_entries_reversal_target" ON "public"."credit_card_entries" USING "btree" ("reversal_of_entry_id") WHERE ("reversal_of_entry_id" IS NOT NULL);



CREATE INDEX "idx_debt_collaterals_debt" ON "public"."debt_collaterals" USING "btree" ("debt_id");



CREATE INDEX "idx_debt_event_installment_allocations_installment" ON "public"."debt_event_installment_allocations" USING "btree" ("installment_id");



CREATE INDEX "idx_debt_events_debt_household_date" ON "public"."debt_events" USING "btree" ("debt_id", "household_id", "event_date");



CREATE INDEX "idx_debt_events_movement_id" ON "public"."debt_events" USING "btree" ("movement_id") WHERE ("movement_id" IS NOT NULL);



CREATE INDEX "idx_debt_installments_debt_due_date" ON "public"."debt_installments" USING "btree" ("debt_id", "due_date");



CREATE INDEX "idx_debt_installments_household_due_date" ON "public"."debt_installments" USING "btree" ("household_id", "due_date");



CREATE INDEX "idx_debt_insurance_terms_debt_household" ON "public"."debt_insurance_terms" USING "btree" ("debt_id", "household_id");



CREATE INDEX "idx_debts_household_status_archived" ON "public"."debts" USING "btree" ("household_id", "status", "is_archived");



CREATE INDEX "idx_financial_accounts_household" ON "public"."financial_accounts" USING "btree" ("household_id");



CREATE INDEX "idx_financial_accounts_household_active_sort" ON "public"."financial_accounts" USING "btree" ("household_id", "is_active", "sort_order");



CREATE INDEX "idx_household_members_user_id" ON "public"."household_members" USING "btree" ("user_id");



CREATE INDEX "idx_movement_corrections_household_movement" ON "public"."movement_corrections" USING "btree" ("household_id", "movement_id", "created_at" DESC);



CREATE INDEX "idx_movements_account_household" ON "public"."movements" USING "btree" ("account_id", "household_id");



CREATE INDEX "idx_movements_registered_by_user" ON "public"."movements" USING "btree" ("household_id", "registered_by_user_id");



CREATE INDEX "idx_push_notification_deliveries_date_type" ON "public"."push_notification_deliveries" USING "btree" ("notification_date", "notification_type");



CREATE INDEX "idx_push_subscriptions_active_household" ON "public"."push_subscriptions" USING "btree" ("household_id", "app_origin") WHERE ("is_active" = true);



CREATE INDEX "idx_push_subscriptions_user" ON "public"."push_subscriptions" USING "btree" ("user_id");



CREATE INDEX "idx_recurring_payments_linked_debt" ON "public"."recurring_payments" USING "btree" ("linked_debt_id");



CREATE UNIQUE INDEX "idx_recurring_payments_unique_linked_debt" ON "public"."recurring_payments" USING "btree" ("linked_debt_id") WHERE ("linked_debt_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "trg_cash_counts_legacy_account_sync" BEFORE INSERT ON "public"."cash_counts" FOR EACH ROW EXECUTE FUNCTION "public"."cash_counts_legacy_account_sync"();



CREATE OR REPLACE TRIGGER "trg_credit_card_profiles_validate_kind" BEFORE INSERT OR UPDATE ON "public"."credit_card_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."validate_credit_card_profile_kind"();



CREATE OR REPLACE TRIGGER "trg_debt_collaterals_protect_identity" BEFORE UPDATE ON "public"."debt_collaterals" FOR EACH ROW EXECUTE FUNCTION "public"."protect_debt_collateral_identity"();



CREATE OR REPLACE TRIGGER "trg_debt_collaterals_touch_updated_at" BEFORE UPDATE ON "public"."debt_collaterals" FOR EACH ROW EXECUTE FUNCTION "public"."touch_financial_accounts_updated_at"();



CREATE OR REPLACE TRIGGER "trg_debt_event_installment_allocations_validate_event" BEFORE INSERT ON "public"."debt_event_installment_allocations" FOR EACH ROW EXECUTE FUNCTION "public"."validate_debt_installment_allocation"();



CREATE OR REPLACE TRIGGER "trg_debt_events_validate_movement" BEFORE INSERT ON "public"."debt_events" FOR EACH ROW EXECUTE FUNCTION "public"."validate_debt_event_movement"();



CREATE OR REPLACE TRIGGER "trg_debt_events_validate_reversal" BEFORE INSERT ON "public"."debt_events" FOR EACH ROW EXECUTE FUNCTION "public"."validate_debt_event_reversal"();



CREATE OR REPLACE TRIGGER "trg_debts_protect_financial_baseline" BEFORE UPDATE OF "opening_principal_balance", "tracking_start_date" ON "public"."debts" FOR EACH ROW EXECUTE FUNCTION "public"."protect_debt_financial_baseline"();



CREATE OR REPLACE TRIGGER "trg_debts_protect_identity" BEFORE UPDATE ON "public"."debts" FOR EACH ROW EXECUTE FUNCTION "public"."protect_debt_identity"();



CREATE OR REPLACE TRIGGER "trg_debts_touch_updated_at" BEFORE UPDATE ON "public"."debts" FOR EACH ROW EXECUTE FUNCTION "public"."touch_financial_accounts_updated_at"();



CREATE OR REPLACE TRIGGER "trg_financial_accounts_touch_updated_at" BEFORE UPDATE ON "public"."financial_accounts" FOR EACH ROW EXECUTE FUNCTION "public"."touch_financial_accounts_updated_at"();



CREATE OR REPLACE TRIGGER "trg_households_provision_default_cash_account" AFTER INSERT ON "public"."households" FOR EACH ROW EXECUTE FUNCTION "public"."provision_default_cash_account"();



CREATE OR REPLACE TRIGGER "trg_movements_legacy_cash_account_sync" BEFORE INSERT OR UPDATE ON "public"."movements" FOR EACH ROW EXECUTE FUNCTION "public"."movements_legacy_cash_account_sync"();



CREATE OR REPLACE TRIGGER "trg_movements_protect_semantics" BEFORE INSERT OR DELETE OR UPDATE ON "public"."movements" FOR EACH ROW EXECUTE FUNCTION "public"."protect_movement_semantics"();



CREATE OR REPLACE TRIGGER "trg_movements_touch_updated_at" BEFORE UPDATE ON "public"."movements" FOR EACH ROW EXECUTE FUNCTION "public"."touch_movements_updated_at"();



CREATE OR REPLACE TRIGGER "trg_protect_debt_linked_recurring_trigger" BEFORE INSERT OR DELETE OR UPDATE ON "public"."recurring_payments" FOR EACH ROW EXECUTE FUNCTION "public"."trg_protect_debt_linked_recurring"();



CREATE OR REPLACE TRIGGER "trg_settings_sync_cash_account_opening_balance" AFTER INSERT OR UPDATE OF "initial_balance" ON "public"."settings" FOR EACH ROW EXECUTE FUNCTION "public"."sync_cash_account_opening_balance"();



CREATE OR REPLACE TRIGGER "trg_sync_debt_events_recurring_trigger" AFTER INSERT OR DELETE OR UPDATE ON "public"."debt_events" FOR EACH ROW EXECUTE FUNCTION "public"."trg_sync_debt_events_recurring"();



CREATE OR REPLACE TRIGGER "trg_sync_debt_recurring_trigger" AFTER INSERT OR UPDATE ON "public"."debts" FOR EACH ROW EXECUTE FUNCTION "public"."trg_sync_debt_recurring"();



ALTER TABLE ONLY "public"."account_reconciliation_movements"
    ADD CONSTRAINT "account_reconciliation_movements_household_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."account_reconciliation_movements"
    ADD CONSTRAINT "account_reconciliation_movements_reconciliation_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."account_reconciliations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."account_reconciliations"
    ADD CONSTRAINT "account_reconciliations_account_fkey" FOREIGN KEY ("account_id", "household_id") REFERENCES "public"."financial_accounts"("id", "household_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."account_reconciliations"
    ADD CONSTRAINT "account_reconciliations_household_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."account_reconciliations"
    ADD CONSTRAINT "account_reconciliations_user_fkey" FOREIGN KEY ("registered_by_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bank_loan_profiles"
    ADD CONSTRAINT "bank_loan_profiles_created_by_user_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bank_loan_profiles"
    ADD CONSTRAINT "bank_loan_profiles_debt_household_fkey" FOREIGN KEY ("debt_id", "household_id") REFERENCES "public"."debts"("id", "household_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_counts"
    ADD CONSTRAINT "cash_counts_account_household_fkey" FOREIGN KEY ("account_id", "household_id") REFERENCES "public"."financial_accounts"("id", "household_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cash_counts"
    ADD CONSTRAINT "cash_counts_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."credit_card_entries"
    ADD CONSTRAINT "credit_card_entries_movement_fkey" FOREIGN KEY ("movement_id", "household_id") REFERENCES "public"."movements"("id", "household_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."credit_card_entries"
    ADD CONSTRAINT "credit_card_entries_profile_fkey" FOREIGN KEY ("debt_id", "household_id") REFERENCES "public"."credit_card_profiles"("debt_id", "household_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."credit_card_entries"
    ADD CONSTRAINT "credit_card_entries_registered_by_user_fkey" FOREIGN KEY ("registered_by_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."credit_card_entries"
    ADD CONSTRAINT "credit_card_entries_reversal_fkey" FOREIGN KEY ("reversal_of_entry_id", "debt_id", "household_id") REFERENCES "public"."credit_card_entries"("id", "debt_id", "household_id");



ALTER TABLE ONLY "public"."credit_card_profiles"
    ADD CONSTRAINT "credit_card_profiles_created_by_user_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."credit_card_profiles"
    ADD CONSTRAINT "credit_card_profiles_debt_household_fkey" FOREIGN KEY ("debt_id", "household_id") REFERENCES "public"."debts"("id", "household_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."credit_card_statements"
    ADD CONSTRAINT "credit_card_statements_closing_entry_id_fkey" FOREIGN KEY ("closing_entry_id") REFERENCES "public"."credit_card_entries"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."credit_card_statements"
    ADD CONSTRAINT "credit_card_statements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."credit_card_statements"
    ADD CONSTRAINT "credit_card_statements_debt_household_fkey" FOREIGN KEY ("debt_id", "household_id") REFERENCES "public"."debts"("id", "household_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."credit_card_statements"
    ADD CONSTRAINT "credit_card_statements_debt_id_fkey" FOREIGN KEY ("debt_id") REFERENCES "public"."debts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."credit_card_statements"
    ADD CONSTRAINT "credit_card_statements_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."credit_card_statements"
    ADD CONSTRAINT "credit_card_statements_profile_fkey" FOREIGN KEY ("debt_id", "household_id") REFERENCES "public"."credit_card_profiles"("debt_id", "household_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."debt_collaterals"
    ADD CONSTRAINT "debt_collaterals_created_by_user_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."debt_collaterals"
    ADD CONSTRAINT "debt_collaterals_debt_household_fkey" FOREIGN KEY ("debt_id", "household_id") REFERENCES "public"."debts"("id", "household_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."debt_event_installment_allocations"
    ADD CONSTRAINT "debt_event_installment_allocations_created_by_user_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."debt_event_installment_allocations"
    ADD CONSTRAINT "debt_event_installment_allocations_event_debt_household_fkey" FOREIGN KEY ("event_id", "debt_id", "household_id") REFERENCES "public"."debt_events"("id", "debt_id", "household_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."debt_event_installment_allocations"
    ADD CONSTRAINT "debt_event_installment_allocations_installment_debt_household_f" FOREIGN KEY ("installment_id", "debt_id", "household_id") REFERENCES "public"."debt_installments"("id", "debt_id", "household_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."debt_events"
    ADD CONSTRAINT "debt_events_debt_household_fkey" FOREIGN KEY ("debt_id", "household_id") REFERENCES "public"."debts"("id", "household_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."debt_events"
    ADD CONSTRAINT "debt_events_movement_household_fkey" FOREIGN KEY ("movement_id", "household_id") REFERENCES "public"."movements"("id", "household_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."debt_events"
    ADD CONSTRAINT "debt_events_registered_by_user_fkey" FOREIGN KEY ("registered_by_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."debt_events"
    ADD CONSTRAINT "debt_events_reversal_household_fkey" FOREIGN KEY ("reversal_of_event_id", "debt_id", "household_id") REFERENCES "public"."debt_events"("id", "debt_id", "household_id");



ALTER TABLE ONLY "public"."debt_installments"
    ADD CONSTRAINT "debt_installments_created_by_user_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."debt_installments"
    ADD CONSTRAINT "debt_installments_schedule_debt_household_fkey" FOREIGN KEY ("schedule_version_id", "debt_id", "household_id") REFERENCES "public"."debt_schedule_versions"("id", "debt_id", "household_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."debt_insurance_terms"
    ADD CONSTRAINT "debt_insurance_terms_created_by_user_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."debt_insurance_terms"
    ADD CONSTRAINT "debt_insurance_terms_debt_household_fkey" FOREIGN KEY ("debt_id", "household_id") REFERENCES "public"."debts"("id", "household_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."debt_schedule_versions"
    ADD CONSTRAINT "debt_schedule_versions_created_by_user_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."debt_schedule_versions"
    ADD CONSTRAINT "debt_schedule_versions_debt_household_fkey" FOREIGN KEY ("debt_id", "household_id") REFERENCES "public"."debts"("id", "household_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."debt_schedule_versions"
    ADD CONSTRAINT "debt_schedule_versions_trigger_event_household_fkey" FOREIGN KEY ("trigger_event_id", "debt_id", "household_id") REFERENCES "public"."debt_events"("id", "debt_id", "household_id");



ALTER TABLE ONLY "public"."debts"
    ADD CONSTRAINT "debts_created_by_user_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."debts"
    ADD CONSTRAINT "debts_household_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."financial_accounts"
    ADD CONSTRAINT "financial_accounts_household_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."credit_card_entries"
    ADD CONSTRAINT "fk_credit_card_entries_credit_of_entry" FOREIGN KEY ("credit_of_entry_id", "debt_id", "household_id") REFERENCES "public"."credit_card_entries"("id", "debt_id", "household_id");



ALTER TABLE ONLY "public"."household_members"
    ADD CONSTRAINT "household_members_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."household_members"
    ADD CONSTRAINT "household_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."movement_corrections"
    ADD CONSTRAINT "movement_corrections_household_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."movement_corrections"
    ADD CONSTRAINT "movement_corrections_user_fkey" FOREIGN KEY ("registered_by_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."movements"
    ADD CONSTRAINT "movements_account_household_fkey" FOREIGN KEY ("account_id", "household_id") REFERENCES "public"."financial_accounts"("id", "household_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."movements"
    ADD CONSTRAINT "movements_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."movements"
    ADD CONSTRAINT "movements_registered_by_user_fk" FOREIGN KEY ("registered_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."movements"
    ADD CONSTRAINT "movements_registered_by_user_id_fkey" FOREIGN KEY ("registered_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."push_notification_deliveries"
    ADD CONSTRAINT "push_notification_deliveries_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_notification_deliveries"
    ADD CONSTRAINT "push_notification_deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."push_subscriptions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_notification_deliveries"
    ADD CONSTRAINT "push_notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_member_fk" FOREIGN KEY ("household_id", "user_id") REFERENCES "public"."household_members"("household_id", "user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recurring_payments"
    ADD CONSTRAINT "recurring_payments_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recurring_payments"
    ADD CONSTRAINT "recurring_payments_linked_debt_id_fkey" FOREIGN KEY ("linked_debt_id") REFERENCES "public"."debts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."settings"
    ADD CONSTRAINT "settings_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE CASCADE;



ALTER TABLE "public"."account_reconciliation_movements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "account_reconciliation_movements_select" ON "public"."account_reconciliation_movements" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "account_reconciliation_movements"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."account_reconciliations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "account_reconciliations_select" ON "public"."account_reconciliations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "account_reconciliations"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."bank_loan_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bank_loan_profiles_insert_member" ON "public"."bank_loan_profiles" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "bank_loan_profiles"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND ("created_by_user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "bank_loan_profiles_select_member" ON "public"."bank_loan_profiles" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "bank_loan_profiles"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "bank_loan_profiles_update_member" ON "public"."bank_loan_profiles" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "bank_loan_profiles"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "bank_loan_profiles"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."cash_counts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cash_counts_insert_member" ON "public"."cash_counts" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "cash_counts"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "cash_counts_select_member" ON "public"."cash_counts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "cash_counts"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "categories_delete_member" ON "public"."categories" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "categories"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "categories_insert_member" ON "public"."categories" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "categories"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "categories_select_member" ON "public"."categories" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "categories"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "categories_update_member" ON "public"."categories" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "categories"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "categories"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."credit_card_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "credit_card_entries_select_member" ON "public"."credit_card_entries" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "credit_card_entries"."household_id") AND ("hm"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."credit_card_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "credit_card_profiles_select_member" ON "public"."credit_card_profiles" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "credit_card_profiles"."household_id") AND ("hm"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."credit_card_statements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "credit_card_statements_select_member" ON "public"."credit_card_statements" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "credit_card_statements"."household_id") AND ("hm"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."debt_collaterals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "debt_collaterals_insert_member" ON "public"."debt_collaterals" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debt_collaterals"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND ("created_by_user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "debt_collaterals_select_member" ON "public"."debt_collaterals" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debt_collaterals"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "debt_collaterals_update_member" ON "public"."debt_collaterals" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debt_collaterals"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debt_collaterals"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."debt_event_installment_allocations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "debt_event_installment_allocations_insert_member" ON "public"."debt_event_installment_allocations" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debt_event_installment_allocations"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND ("created_by_user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "debt_event_installment_allocations_select_member" ON "public"."debt_event_installment_allocations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debt_event_installment_allocations"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."debt_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "debt_events_insert_member" ON "public"."debt_events" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debt_events"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND ("registered_by_user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "debt_events_select_member" ON "public"."debt_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debt_events"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."debt_installments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "debt_installments_insert_member" ON "public"."debt_installments" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debt_installments"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND ("created_by_user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "debt_installments_select_member" ON "public"."debt_installments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debt_installments"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."debt_insurance_terms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "debt_insurance_terms_insert_member" ON "public"."debt_insurance_terms" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debt_insurance_terms"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND ("created_by_user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "debt_insurance_terms_select_member" ON "public"."debt_insurance_terms" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debt_insurance_terms"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "debt_insurance_terms_update_member" ON "public"."debt_insurance_terms" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debt_insurance_terms"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debt_insurance_terms"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."debt_schedule_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "debt_schedule_versions_insert_member" ON "public"."debt_schedule_versions" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debt_schedule_versions"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND ("created_by_user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "debt_schedule_versions_select_member" ON "public"."debt_schedule_versions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debt_schedule_versions"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."debts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "debts_insert_member" ON "public"."debts" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debts"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND ("created_by_user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "debts_select_member" ON "public"."debts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debts"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "debts_update_member" ON "public"."debts" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debts"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "debts"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."financial_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "financial_accounts_insert_member" ON "public"."financial_accounts" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "financial_accounts"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "financial_accounts_select_member" ON "public"."financial_accounts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "financial_accounts"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "financial_accounts_update_member" ON "public"."financial_accounts" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "financial_accounts"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "financial_accounts"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."household_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "household_members_select_self" ON "public"."household_members" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."households" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "households_select_member" ON "public"."households" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "households"."id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."movement_corrections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "movement_corrections_select" ON "public"."movement_corrections" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "movement_corrections"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."movements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "movements_delete_member" ON "public"."movements" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "movements"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "movements_insert_member" ON "public"."movements" FOR INSERT TO "authenticated" WITH CHECK ((("registered_by_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "movements"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("hm"."display_name" IS NOT NULL) AND ("btrim"("hm"."display_name") <> ''::"text") AND ("hm"."display_name" = "movements"."person"))))));



CREATE POLICY "movements_select_member" ON "public"."movements" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "movements"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "movements_update_member" ON "public"."movements" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "movements"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "movements"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."push_notification_deliveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "push_subscriptions_select_own_member" ON "public"."push_subscriptions" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "push_subscriptions"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



ALTER TABLE "public"."recurring_payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recurring_payments_insert_member" ON "public"."recurring_payments" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "recurring_payments"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "recurring_payments_select_member" ON "public"."recurring_payments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "recurring_payments"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "recurring_payments_update_member" ON "public"."recurring_payments" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "recurring_payments"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "recurring_payments"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "settings_insert_member" ON "public"."settings" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "settings"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "settings_select_member" ON "public"."settings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "settings"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "settings_update_member" ON "public"."settings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "settings"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."household_members" "hm"
  WHERE (("hm"."household_id" = "settings"."household_id") AND ("hm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";




























































































































































GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."debt_schedule_versions" TO "service_role";
GRANT SELECT ON TABLE "public"."debt_schedule_versions" TO "authenticated";



REVOKE ALL ON FUNCTION "private"."debt2b2_create_schedule"("p_household_id" "uuid", "p_debt_id" "uuid", "p_trigger_event_id" "uuid", "p_event_date" "date", "p_reason" "text", "p_notes" "text", "p_schedule_installments" "jsonb", "p_user_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."debt2b2_current_principal"("p_household_id" "uuid", "p_debt_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."debt2b2_fund_result"("p_event_id" "uuid", "p_idempotent_replay" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."debt2b2_insert_allocations"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_schedule_version_id" "uuid", "p_cash_amount" numeric, "p_allocations" "jsonb", "p_user_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."debt2b2_lock_operation"("p_movement_id" "text", "p_event_id" "uuid") FROM PUBLIC;



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."movements" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."movements" TO "authenticated";



GRANT UPDATE("type") ON TABLE "public"."movements" TO "authenticated";



GRANT UPDATE("date") ON TABLE "public"."movements" TO "authenticated";



GRANT UPDATE("amount") ON TABLE "public"."movements" TO "authenticated";



GRANT UPDATE("description") ON TABLE "public"."movements" TO "authenticated";



GRANT UPDATE("method") ON TABLE "public"."movements" TO "authenticated";



GRANT UPDATE("category") ON TABLE "public"."movements" TO "authenticated";



GRANT UPDATE("account_id") ON TABLE "public"."movements" TO "authenticated";



GRANT UPDATE("movement_context") ON TABLE "public"."movements" TO "authenticated";



REVOKE ALL ON FUNCTION "private"."debt2b2_prepare_movement"("p_household_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_user_id" "uuid", "p_person" "text") FROM PUBLIC;



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."debts" TO "service_role";
GRANT SELECT ON TABLE "public"."debts" TO "authenticated";



REVOKE ALL ON FUNCTION "private"."debt2b2_reconcile_status"("p_household_id" "uuid", "p_debt_id" "uuid", "p_current_principal" numeric) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."debt2b2_reversal_result"("p_event_id" "uuid", "p_idempotent_replay" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."debt2b2_validate_costs"("p_cash_amount" numeric, "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean, "p_error_code" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."cash_counts_legacy_account_sync"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."close_credit_card_statement_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_statement_id" "uuid", "p_statement_date" "date", "p_due_date" "date", "p_minimum_payment_amount" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."close_credit_card_statement_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_statement_id" "uuid", "p_statement_date" "date", "p_due_date" "date", "p_minimum_payment_amount" numeric) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."complete_recurring_payment"("p_payment_id" "text", "p_create_expense" boolean, "p_movement_id" "text", "p_movement_date" "date", "p_movement_amount" numeric, "p_movement_description" "text", "p_movement_method" "text", "p_movement_category" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_recurring_payment"("p_payment_id" "text", "p_create_expense" boolean, "p_movement_id" "text", "p_movement_date" "date", "p_movement_amount" numeric, "p_movement_description" "text", "p_movement_method" "text", "p_movement_category" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."complete_recurring_payment_v2"("p_payment_id" "text", "p_create_expense" boolean, "p_movement_id" "text", "p_movement_date" "date", "p_movement_amount" numeric, "p_movement_description" "text", "p_movement_method" "text", "p_movement_category" "text", "p_account_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_recurring_payment_v2"("p_payment_id" "text", "p_create_expense" boolean, "p_movement_id" "text", "p_movement_date" "date", "p_movement_amount" numeric, "p_movement_description" "text", "p_movement_method" "text", "p_movement_category" "text", "p_account_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."correct_reconciled_movement_v1"("p_household_id" "uuid", "p_movement_id" "text", "p_correction_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_date" "text", "p_amount" numeric, "p_description" "text", "p_method" "text", "p_category" "text", "p_person" "text", "p_account_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."correct_reconciled_movement_v1"("p_household_id" "uuid", "p_movement_id" "text", "p_correction_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_date" "text", "p_amount" numeric, "p_description" "text", "p_method" "text", "p_category" "text", "p_person" "text", "p_account_id" "uuid", "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_bank_loan_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_debt_kind" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_original_principal" numeric, "p_opening_principal_balance" numeric, "p_planned_installment_count" integer, "p_planned_installment_amount" numeric, "p_installment_amount_mode" "text", "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_first_due_date" "date", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text", "p_minimum_principal_payment" numeric, "p_profile" "jsonb", "p_insurances" "jsonb", "p_schedule_source" "text", "p_installments" "jsonb", "p_collaterals" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_bank_loan_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_debt_kind" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_original_principal" numeric, "p_opening_principal_balance" numeric, "p_planned_installment_count" integer, "p_planned_installment_amount" numeric, "p_installment_amount_mode" "text", "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_first_due_date" "date", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text", "p_minimum_principal_payment" numeric, "p_profile" "jsonb", "p_insurances" "jsonb", "p_schedule_source" "text", "p_installments" "jsonb", "p_collaterals" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_credit_card_debt_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_opening_balance" numeric, "p_credit_limit" numeric, "p_closing_day" integer, "p_due_day" integer, "p_last4" "text", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_credit_card_debt_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_opening_balance" numeric, "p_credit_limit" numeric, "p_closing_day" integer, "p_due_day" integer, "p_last4" "text", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_debt_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_debt_kind" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_original_principal" numeric, "p_opening_principal_balance" numeric, "p_planned_installment_count" integer, "p_planned_installment_amount" numeric, "p_installment_amount_mode" "text", "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_first_due_date" "date", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text", "p_installments" "jsonb", "p_collaterals" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_debt_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_debt_kind" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_original_principal" numeric, "p_opening_principal_balance" numeric, "p_planned_installment_count" integer, "p_planned_installment_amount" numeric, "p_installment_amount_mode" "text", "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_first_due_date" "date", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text", "p_installments" "jsonb", "p_collaterals" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_debt_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_debt_kind" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_original_principal" numeric, "p_opening_principal_balance" numeric, "p_planned_installment_count" integer, "p_planned_installment_amount" numeric, "p_installment_amount_mode" "text", "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_first_due_date" "date", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text", "p_installments" "jsonb", "p_collaterals" "jsonb", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_debt_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_debt_kind" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_original_principal" numeric, "p_opening_principal_balance" numeric, "p_planned_installment_count" integer, "p_planned_installment_amount" numeric, "p_installment_amount_mode" "text", "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_first_due_date" "date", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text", "p_installments" "jsonb", "p_collaterals" "jsonb", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_debt_v2"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_debt_kind" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_original_principal" numeric, "p_opening_principal_balance" numeric, "p_planned_installment_count" integer, "p_planned_installment_amount" numeric, "p_installment_amount_mode" "text", "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_first_due_date" "date", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text", "p_installments" "jsonb", "p_collaterals" "jsonb", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text", "p_minimum_principal_payment" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_debt_v2"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_debt_kind" "text", "p_currency_code" "text", "p_origin_date" "date", "p_tracking_start_date" "date", "p_original_principal" numeric, "p_opening_principal_balance" numeric, "p_planned_installment_count" integer, "p_planned_installment_amount" numeric, "p_installment_amount_mode" "text", "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_first_due_date" "date", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_notes" "text", "p_installments" "jsonb", "p_collaterals" "jsonb", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text", "p_minimum_principal_payment" numeric) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_pristine_debt_v1"("p_household_id" "uuid", "p_debt_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_pristine_debt_v1"("p_household_id" "uuid", "p_debt_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_push_subscription_status"("p_household_id" "uuid", "p_endpoint" "text", "p_app_origin" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_push_subscription_status"("p_household_id" "uuid", "p_endpoint" "text", "p_app_origin" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."movements_legacy_cash_account_sync"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."protect_debt_collateral_identity"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."protect_debt_financial_baseline"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."protect_debt_identity"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."protect_movement_semantics"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."provision_default_cash_account"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."record_account_reconciliation_v1"("p_household_id" "uuid", "p_reconciliation_id" "uuid", "p_account_id" "uuid", "p_actual_balance" numeric, "p_denominations" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_account_reconciliation_v1"("p_household_id" "uuid", "p_reconciliation_id" "uuid", "p_account_id" "uuid", "p_actual_balance" numeric, "p_denominations" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."record_credit_card_credit_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_entry_id" "uuid", "p_movement_id" "text", "p_target_entry_id" "uuid", "p_credit_date" "date", "p_amount" numeric, "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_credit_card_credit_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_entry_id" "uuid", "p_movement_id" "text", "p_target_entry_id" "uuid", "p_credit_date" "date", "p_amount" numeric, "p_description" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."record_credit_card_fee_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_entry_id" "uuid", "p_movement_id" "text", "p_fee_date" "date", "p_amount" numeric, "p_description" "text", "p_category" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_credit_card_fee_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_entry_id" "uuid", "p_movement_id" "text", "p_fee_date" "date", "p_amount" numeric, "p_description" "text", "p_category" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."record_credit_card_payment_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_entry_id" "uuid", "p_movement_id" "text", "p_payment_date" "date", "p_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_credit_card_payment_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_entry_id" "uuid", "p_movement_id" "text", "p_payment_date" "date", "p_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."record_credit_card_purchase_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_entry_id" "uuid", "p_movement_id" "text", "p_purchase_date" "date", "p_amount" numeric, "p_description" "text", "p_category" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_credit_card_purchase_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_entry_id" "uuid", "p_movement_id" "text", "p_purchase_date" "date", "p_amount" numeric, "p_description" "text", "p_category" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."record_debt_installment_advance_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean, "p_allocations" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_debt_installment_advance_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean, "p_allocations" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."record_debt_payment_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean, "p_allocations" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_debt_payment_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean, "p_allocations" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."record_debt_payment_v2"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_extra_principal_amount" numeric, "p_prepayment_effect" "text", "p_breakdown_complete" boolean, "p_allocations" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_debt_payment_v2"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_extra_principal_amount" numeric, "p_prepayment_effect" "text", "p_breakdown_complete" boolean, "p_allocations" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."record_debt_payoff_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_debt_payoff_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."record_debt_prepayment_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean, "p_schedule_installments" "jsonb", "p_schedule_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_debt_prepayment_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_event_id" "uuid", "p_movement_id" "text", "p_event_date" "date", "p_cash_amount" numeric, "p_account_id" "uuid", "p_description" "text", "p_category" "text", "p_principal_amount" numeric, "p_interest_paid" numeric, "p_fees_paid" numeric, "p_insurance_paid" numeric, "p_other_cost_paid" numeric, "p_breakdown_complete" boolean, "p_schedule_installments" "jsonb", "p_schedule_notes" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."register_push_subscription"("p_household_id" "uuid", "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_app_origin" "text", "p_expires_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_push_subscription"("p_household_id" "uuid", "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_app_origin" "text", "p_expires_at" timestamp with time zone) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reverse_credit_card_entry_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_reversal_entry_id" "uuid", "p_target_entry_id" "uuid", "p_reversal_date" "date", "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reverse_credit_card_entry_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_reversal_entry_id" "uuid", "p_target_entry_id" "uuid", "p_reversal_date" "date", "p_description" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reverse_debt_event_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_reversal_event_id" "uuid", "p_target_event_id" "uuid", "p_event_date" "date", "p_description" "text", "p_schedule_installments" "jsonb", "p_schedule_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reverse_debt_event_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_reversal_event_id" "uuid", "p_target_event_id" "uuid", "p_event_date" "date", "p_description" "text", "p_schedule_installments" "jsonb", "p_schedule_notes" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_credit_card_profile_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_credit_limit" numeric, "p_closing_day" integer, "p_due_day" integer, "p_last4" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_credit_card_profile_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_credit_limit" numeric, "p_closing_day" integer, "p_due_day" integer, "p_last4" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_debt_archived_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_is_archived" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_debt_archived_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_is_archived" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."sync_cash_account_opening_balance"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."sync_linked_recurring_payment"("p_debt_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."touch_financial_accounts_updated_at"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."trg_protect_debt_linked_recurring"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."trg_sync_debt_events_recurring"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."trg_sync_debt_recurring"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."unregister_push_subscription"("p_household_id" "uuid", "p_endpoint" "text", "p_app_origin" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."unregister_push_subscription"("p_household_id" "uuid", "p_endpoint" "text", "p_app_origin" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_debt_metadata_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_debt_metadata_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_name" "text", "p_creditor_name" "text", "p_notes" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_debt_terms_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_clear_periodic_rate" boolean, "p_clear_tea" boolean, "p_clear_tcea" boolean, "p_clear_frequency" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_debt_terms_v1"("p_household_id" "uuid", "p_debt_id" "uuid", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_clear_periodic_rate" boolean, "p_clear_tea" boolean, "p_clear_tcea" boolean, "p_clear_frequency" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_debt_terms_v2"("p_household_id" "uuid", "p_debt_id" "uuid", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_clear_periodic_rate" boolean, "p_clear_tea" boolean, "p_clear_tcea" boolean, "p_clear_frequency" boolean, "p_first_due_date" "date", "p_clear_first_due_date" boolean, "p_minimum_principal_payment" numeric, "p_clear_minimum_principal_payment" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_debt_terms_v2"("p_household_id" "uuid", "p_debt_id" "uuid", "p_repayment_structure" "text", "p_interest_calculation_mode" "text", "p_periodic_rate_percent" numeric, "p_periodic_rate_basis" "text", "p_tea_percent" numeric, "p_tcea_percent" numeric, "p_payment_frequency" "text", "p_custom_frequency_days" integer, "p_clear_periodic_rate" boolean, "p_clear_tea" boolean, "p_clear_tcea" boolean, "p_clear_frequency" boolean, "p_first_due_date" "date", "p_clear_first_due_date" boolean, "p_minimum_principal_payment" numeric, "p_clear_minimum_principal_payment" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."validate_debt_event_movement"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."validate_debt_event_reversal"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."validate_debt_installment_allocation"() FROM PUBLIC;


















GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."account_reconciliation_movements" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."account_reconciliation_movements" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."account_reconciliation_movements" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."account_reconciliations" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."account_reconciliations" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."account_reconciliations" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bank_loan_profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."bank_loan_profiles" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cash_counts" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."cash_counts" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."categories" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."categories" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."credit_card_entries" TO "service_role";
GRANT SELECT ON TABLE "public"."credit_card_entries" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."credit_card_profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."credit_card_profiles" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."credit_card_statements" TO "service_role";
GRANT SELECT ON TABLE "public"."credit_card_statements" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."debt_collaterals" TO "service_role";
GRANT SELECT ON TABLE "public"."debt_collaterals" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."debt_event_installment_allocations" TO "service_role";
GRANT SELECT ON TABLE "public"."debt_event_installment_allocations" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."debt_events" TO "service_role";
GRANT SELECT ON TABLE "public"."debt_events" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."debt_installments" TO "service_role";
GRANT SELECT ON TABLE "public"."debt_installments" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."debt_insurance_terms" TO "service_role";
GRANT SELECT ON TABLE "public"."debt_insurance_terms" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."financial_accounts" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."financial_accounts" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."household_members" TO "service_role";
GRANT SELECT ON TABLE "public"."household_members" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."households" TO "service_role";
GRANT SELECT ON TABLE "public"."households" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."movement_corrections" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."movement_corrections" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."movement_corrections" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."push_notification_deliveries" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."recurring_payments" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."recurring_payments" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."settings" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."settings" TO "authenticated";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";































