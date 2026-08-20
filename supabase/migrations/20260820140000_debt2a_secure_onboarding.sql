-- ============================================================
-- DEBT-2A Secure Debt Onboarding Backend
-- Primera escritura real del dominio Deudas, únicamente vía RPC.
--
-- Principio de seguridad:
--   * Las 6 tablas Debt conservan EXCLUSIVAMENTE SELECT para
--     authenticated (creado en DEBT-1A). No se agrega ningún
--     grant directo de INSERT/UPDATE/DELETE.
--   * Las escrituras de este gate se ejecutan SOLO mediante las
--     3 RPC SECURITY DEFINER definidas aquí.
--   * Cada RPC valida auth.uid() y la pertenencia del usuario al
--     household (public.household_members) antes de escribir.
--
-- Alcance DEBT-2A: crear deuda, cronograma inicial opcional,
-- garantías iniciales opcionales, edición de metadata segura y
-- archivo/reactivación. NO pagos, NO prepagos, NO payoff, NO
-- reversal, NO movements, NO debt_events (DEBT-2B).
--
-- Contrato de errores estables:
--   AUTH_REQUIRED, HOUSEHOLD_ACCESS_DENIED, DEBT_NOT_FOUND,
--   DEBT_ALREADY_EXISTS, INVALID_DEBT_INPUT, INVALID_INSTALLMENTS,
--   INVALID_COLLATERALS.
--
-- Campos nullable recibidos como JSON: "ausente" y "JSON null"
-- son equivalentes y se convierten a SQL NULL. Nunca se convierte
-- NULL a cero ni se inventan valores.
-- ============================================================

-- ============================================================
-- 1. CREATE_DEBT_V1
--    Onboarding transaccional de una obligación y su
--    cronograma/garantías iniciales.
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
  v_installments_json pg_catalog.jsonb := '[]'::pg_catalog.jsonb;
  v_collaterals_json pg_catalog.jsonb := '[]'::pg_catalog.jsonb;
  v_installment_count integer;
  v_elem pg_catalog.jsonb;
  v_installment_no integer;
  v_due_date pg_catalog.date;
  v_expected_amount pg_catalog.numeric;
  v_expected_principal pg_catalog.numeric;
  v_expected_interest pg_catalog.numeric;
  v_expected_fees pg_catalog.numeric;
  v_expected_insurance pg_catalog.numeric;
  v_pledged_value pg_catalog.numeric;
  v_estimated_value pg_catalog.numeric;
  v_redemption_deadline pg_catalog.date;
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

  if p_installments is null or pg_catalog.jsonb_typeof(p_installments) <> 'array' then
    raise exception 'INVALID_INSTALLMENTS';
  end if;

  if p_collaterals is null or pg_catalog.jsonb_typeof(p_collaterals) <> 'array' then
    raise exception 'INVALID_COLLATERALS';
  end if;

  v_installment_count := pg_catalog.jsonb_array_length(p_installments);

  if v_installment_count > 0 then
    if p_planned_installment_count is not null
       and v_installment_count <> p_planned_installment_count then
      raise exception 'INVALID_INSTALLMENTS';
    end if;

    -- =========================================================
    -- A) Validación estricta ELEMENTO POR ELEMENTO.
    --    Los casts a integer/date/numeric ocurren aquí, dentro de
    --    BEGIN/EXCEPTION, de modo que un valor imposible de castear
    --    (p.ej. installment_number = "9999999999999999999999999")
    --    produce INVALID_INSTALLMENTS y NUNCA un SQLSTATE crudo.
    --==========================================================
    for v_elem in
      select e.value
        from pg_catalog.jsonb_array_elements(p_installments) as e
    loop
      if pg_catalog.jsonb_typeof(v_elem) <> 'object'
         or not (v_elem ? 'installment_number')
         or v_elem->'installment_number' = 'null'::pg_catalog.jsonb
         or not (v_elem ? 'due_date')
         or v_elem->'due_date' = 'null'::pg_catalog.jsonb then
        raise exception 'INVALID_INSTALLMENTS';
      end if;

      -- installment_number: representación decimal positiva que
      -- quepa en integer.
      if v_elem->>'installment_number' !~ '^[0-9]+$' then
        raise exception 'INVALID_INSTALLMENTS';
      end if;
      begin
        v_installment_no := (v_elem->>'installment_number')::integer;
      exception
        when numeric_value_out_of_range or invalid_text_representation then
          raise exception 'INVALID_INSTALLMENTS';
      end;
      if v_installment_no < 1 then
        raise exception 'INVALID_INSTALLMENTS';
      end if;

      -- due_date: fecha real.
      if v_elem->>'due_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'INVALID_INSTALLMENTS';
      end if;
      begin
        v_due_date := (v_elem->>'due_date')::pg_catalog.date;
      exception
        when invalid_text_representation or datetime_field_overflow then
          raise exception 'INVALID_INSTALLMENTS';
      end;

      -- Campos nullable: ausente o JSON null => SQL NULL.
      -- Solo se validan/castean cuando existen con valor real.
      v_expected_amount := null;
      if v_elem ? 'expected_amount'
         and v_elem->'expected_amount' <> 'null'::pg_catalog.jsonb then
        if pg_catalog.jsonb_typeof(v_elem->'expected_amount') <> 'number' then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
        begin
          v_expected_amount := (v_elem->>'expected_amount')::pg_catalog.numeric;
        exception
          when numeric_value_out_of_range or invalid_text_representation then
            raise exception 'INVALID_INSTALLMENTS';
        end;
        if v_expected_amount <= 0 then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
      end if;

      v_expected_principal := null;
      if v_elem ? 'expected_principal'
         and v_elem->'expected_principal' <> 'null'::pg_catalog.jsonb then
        if pg_catalog.jsonb_typeof(v_elem->'expected_principal') <> 'number' then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
        v_expected_principal := (v_elem->>'expected_principal')::pg_catalog.numeric;
        if v_expected_principal < 0 then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
      end if;

      v_expected_interest := null;
      if v_elem ? 'expected_interest'
         and v_elem->'expected_interest' <> 'null'::pg_catalog.jsonb then
        if pg_catalog.jsonb_typeof(v_elem->'expected_interest') <> 'number' then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
        v_expected_interest := (v_elem->>'expected_interest')::pg_catalog.numeric;
        if v_expected_interest < 0 then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
      end if;

      v_expected_fees := null;
      if v_elem ? 'expected_fees'
         and v_elem->'expected_fees' <> 'null'::pg_catalog.jsonb then
        if pg_catalog.jsonb_typeof(v_elem->'expected_fees') <> 'number' then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
        v_expected_fees := (v_elem->>'expected_fees')::pg_catalog.numeric;
        if v_expected_fees < 0 then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
      end if;

      v_expected_insurance := null;
      if v_elem ? 'expected_insurance'
         and v_elem->'expected_insurance' <> 'null'::pg_catalog.jsonb then
        if pg_catalog.jsonb_typeof(v_elem->'expected_insurance') <> 'number' then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
        v_expected_insurance := (v_elem->>'expected_insurance')::pg_catalog.numeric;
        if v_expected_insurance < 0 then
          raise exception 'INVALID_INSTALLMENTS';
        end if;
      end if;

      -- Componentes dentro del monto esperado (misma regla que la CHECK del schema).
      if v_expected_amount is not null
         and coalesce(v_expected_principal, 0::pg_catalog.numeric)
             + coalesce(v_expected_interest, 0::pg_catalog.numeric)
             + coalesce(v_expected_fees, 0::pg_catalog.numeric)
             + coalesce(v_expected_insurance, 0::pg_catalog.numeric)
             > v_expected_amount then
        raise exception 'INVALID_INSTALLMENTS';
      end if;
    end loop;

    -- =====================================================
    -- B) Verificaciones de conjunto. Los casts tipados son
    --    seguros: el loop anterior garantizó que TODOS los
    --    installment_number son integer válidos.
    --======================================================
    -- Sin números de cuota duplicados.
    if (
      select pg_catalog.count(distinct (e.value->>'installment_number')::integer)
        from pg_catalog.jsonb_array_elements(p_installments) as e
    ) <> v_installment_count then
      raise exception 'INVALID_INSTALLMENTS';
    end if;

    -- Secuencia 1..N sin huecos: el mayor número debe ser exactamente N.
    if (
      select pg_catalog.max((e.value->>'installment_number')::integer)
        from pg_catalog.jsonb_array_elements(p_installments) as e
    ) <> v_installment_count then
      raise exception 'INVALID_INSTALLMENTS';
    end if;
  end if;

  -- Debt: id/household/creator nunca vienen del cliente.
  -- status = 'active', is_archived = false, created_by = auth.uid().
  -- Los CHECK/NOT NULL del schema son la última defensa; si el
  -- INSERT raíz falla por un invariante simple del payload, se
  -- mapea a INVALID_DEBT_INPUT. Un p_debt_id duplicado se mapea
  -- explícitamente a DEBT_ALREADY_EXISTS (reintento reconocible).
  begin
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
      created_by_user_id
    ) values (
      p_debt_id,
      p_household_id,
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
      'active',
      false,
      v_user_id
    )
    returning * into v_debt;
  exception
    when check_violation or not_null_violation or numeric_value_out_of_range then
      raise exception 'INVALID_DEBT_INPUT';
    when unique_violation then
      raise exception 'DEBT_ALREADY_EXISTS';
  end;

  if v_installment_count > 0 then
    insert into public.debt_schedule_versions (
      debt_id,
      household_id,
      version_number,
      effective_date,
      reason,
      trigger_event_id,
      notes,
      created_by_user_id
    ) values (
      p_debt_id,
      p_household_id,
      1,
      p_tracking_start_date,
      'initial',
      null,
      '',
      v_user_id
    )
    returning * into v_schedule;

    for v_elem in
      select e.value
        from pg_catalog.jsonb_array_elements(p_installments) as e
    loop
      v_due_date := (v_elem->>'due_date')::pg_catalog.date;
      v_expected_amount := null;
      v_expected_principal := null;
      v_expected_interest := null;
      v_expected_fees := null;
      v_expected_insurance := null;

      if v_elem ? 'expected_amount'
         and v_elem->'expected_amount' <> 'null'::pg_catalog.jsonb then
        v_expected_amount := (v_elem->>'expected_amount')::pg_catalog.numeric;
      end if;
      if v_elem ? 'expected_principal'
         and v_elem->'expected_principal' <> 'null'::pg_catalog.jsonb then
        v_expected_principal := (v_elem->>'expected_principal')::pg_catalog.numeric;
      end if;
      if v_elem ? 'expected_interest'
         and v_elem->'expected_interest' <> 'null'::pg_catalog.jsonb then
        v_expected_interest := (v_elem->>'expected_interest')::pg_catalog.numeric;
      end if;
      if v_elem ? 'expected_fees'
         and v_elem->'expected_fees' <> 'null'::pg_catalog.jsonb then
        v_expected_fees := (v_elem->>'expected_fees')::pg_catalog.numeric;
      end if;
      if v_elem ? 'expected_insurance'
         and v_elem->'expected_insurance' <> 'null'::pg_catalog.jsonb then
        v_expected_insurance := (v_elem->>'expected_insurance')::pg_catalog.numeric;
      end if;

      -- Payload ya validado: un CHECK/NOT NULL residual del payload
      -- se mapea estrechamente a INVALID_INSTALLMENTS. Los errores
      -- internos (foreign keys, invariantes de programación) NO se
      -- capturan: deben seguir siendo visibles.
      begin
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
          (v_elem->>'installment_number')::integer,
          v_due_date,
          v_expected_amount,
          v_expected_principal,
          v_expected_interest,
          v_expected_fees,
          v_expected_insurance,
          v_user_id
        )
        returning * into v_installment;
      exception
        when check_violation or not_null_violation or numeric_value_out_of_range then
          raise exception 'INVALID_INSTALLMENTS';
      end;

      v_installments_json := v_installments_json || pg_catalog.to_jsonb(v_installment);
    end loop;
  end if;

  -- Garantías iniciales: status siempre 'pledged', creador siempre auth.uid().
  for v_elem in
    select e.value
      from pg_catalog.jsonb_array_elements(p_collaterals) as e
  loop
    if pg_catalog.jsonb_typeof(v_elem) <> 'object'
       or not (v_elem ? 'description')
       or v_elem->'description' = 'null'::pg_catalog.jsonb
       or v_elem->>'description' is null
       or pg_catalog.btrim(v_elem->>'description') = '' then
      raise exception 'INVALID_COLLATERALS';
    end if;

    -- Campos nullable: ausente o JSON null => SQL NULL.
    v_pledged_value := null;
    v_estimated_value := null;
    v_redemption_deadline := null;

    if v_elem ? 'pledged_value'
       and v_elem->'pledged_value' <> 'null'::pg_catalog.jsonb then
      if pg_catalog.jsonb_typeof(v_elem->'pledged_value') <> 'number' then
        raise exception 'INVALID_COLLATERALS';
      end if;
      v_pledged_value := (v_elem->>'pledged_value')::pg_catalog.numeric;
      if v_pledged_value < 0 then
        raise exception 'INVALID_COLLATERALS';
      end if;
    end if;

    if v_elem ? 'estimated_value'
       and v_elem->'estimated_value' <> 'null'::pg_catalog.jsonb then
      if pg_catalog.jsonb_typeof(v_elem->'estimated_value') <> 'number' then
        raise exception 'INVALID_COLLATERALS';
      end if;
      v_estimated_value := (v_elem->>'estimated_value')::pg_catalog.numeric;
      if v_estimated_value < 0 then
        raise exception 'INVALID_COLLATERALS';
      end if;
    end if;

    if v_elem ? 'redemption_deadline'
       and v_elem->'redemption_deadline' <> 'null'::pg_catalog.jsonb then
      if v_elem->>'redemption_deadline' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'INVALID_COLLATERALS';
      end if;
      begin
        v_redemption_deadline := (v_elem->>'redemption_deadline')::pg_catalog.date;
      exception
        when invalid_text_representation or datetime_field_overflow then
          raise exception 'INVALID_COLLATERALS';
      end;
    end if;

    -- Payload ya validado: mapeo estrecho de invariantes simples.
    begin
      insert into public.debt_collaterals (
        debt_id,
        household_id,
        description,
        pledged_value,
        estimated_value,
        redemption_deadline,
        status,
        notes,
        created_by_user_id
      ) values (
        p_debt_id,
        p_household_id,
        pg_catalog.btrim(v_elem->>'description'),
        v_pledged_value,
        v_estimated_value,
        v_redemption_deadline,
        'pledged',
        '',
        v_user_id
      )
      returning * into v_collateral;
    exception
      when check_violation or not_null_violation or numeric_value_out_of_range then
        raise exception 'INVALID_COLLATERALS';
    end;

    v_collaterals_json := v_collaterals_json || pg_catalog.to_jsonb(v_collateral);
  end loop;

  return pg_catalog.jsonb_build_object(
    'debt', pg_catalog.to_jsonb(v_debt),
    'scheduleVersion',
      case when v_schedule.id is null then 'null'::pg_catalog.jsonb else pg_catalog.to_jsonb(v_schedule) end,
    'installments', v_installments_json,
    'collaterals', v_collaterals_json
  );
end;
$function$;

-- ============================================================
-- 2. UPDATE_DEBT_METADATA_V1
--    Solo metadata descriptiva: name, creditor_name, notes.
--    Nunca cambia términos financieros (DEBT-2B+).
-- ============================================================

create or replace function public.update_debt_metadata_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_name text,
  p_creditor_name text,
  p_notes text
)
returns pg_catalog.jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
$function$;

-- ============================================================
-- 3. SET_DEBT_ARCHIVED_V1
--    Archivo lógico: únicamente is_archived. Nunca DELETE.
-- ============================================================

create or replace function public.set_debt_archived_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_is_archived boolean
)
returns pg_catalog.jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
$function$;

-- ============================================================
-- 4. PRIVILEGIOS
--    authenticated: EXECUTE únicamente sobre las 3 RPC.
--    anon / public / service_role: sin EXECUTE.
--    Las tablas Debt conservan SELECT-only para authenticated;
--    este gate no agrega ningún grant de escritura directo.
-- ============================================================

revoke all privileges on function public.create_debt_v1(uuid, uuid, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, jsonb, jsonb)
  from public, anon, service_role;

grant execute on function public.create_debt_v1(uuid, uuid, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, jsonb, jsonb)
  to authenticated;

revoke all privileges on function public.update_debt_metadata_v1(uuid, uuid, text, text, text)
  from public, anon, service_role;

grant execute on function public.update_debt_metadata_v1(uuid, uuid, text, text, text)
  to authenticated;

revoke all privileges on function public.set_debt_archived_v1(uuid, uuid, boolean)
  from public, anon, service_role;

grant execute on function public.set_debt_archived_v1(uuid, uuid, boolean)
  to authenticated;

-- ============================================================
-- 5. COMENTARIOS
--    EXACTAMENTE UNO por función (create_debt_v1 combina toda la
--    documentación del onboarding y de DEBT-2B).
-- ============================================================

comment on function public.create_debt_v1(uuid, uuid, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, jsonb, jsonb) is
  'DEBT-2A: onboarding transaccional de una obligación. Una sola RPC atómica crea Debt + cronograma inicial opcional (ScheduleVersion v1 reason=initial, solo si p_installments no está vacío) + installments numerados 1..N + collaterals con status pledged. El servidor controla status/is_archived/created_by_user_id: nunca se aceptan del cliente. No escribe debt_events ni movements. Cualquier error revierte TODO (rollback total). Errores estables: AUTH_REQUIRED, HOUSEHOLD_ACCESS_DENIED, INVALID_DEBT_INPUT, DEBT_ALREADY_EXISTS (p_debt_id duplicado, el frontend puede resolverlo recargando por id), INVALID_INSTALLMENTS, INVALID_COLLATERALS. Campos nullable (expected_* de installments; pledged_value, estimated_value, redemption_deadline de collaterals): ausentes o JSON null se convierten a SQL NULL; nunca se inventan ceros ni fechas. DEBT-2B será responsable de payments, partial/multi-installment allocations, prepayments, payoff, reversals, movement integration y concurrency/current principal safety (nuevas RPC atómicas DebtEvent + Movement + Allocation + locking), nunca como UPDATE directo sobre las tablas.';

comment on function public.update_debt_metadata_v1(uuid, uuid, text, text, text) is
  'DEBT-2A: edita ÚNICAMENTE metadata descriptiva (name, creditor_name, notes). No cambia términos financieros: opening_principal_balance, tracking_start_date, debt_kind, currency_code, cronograma, tasas y frecuencia permanecen inmutables vía API; su modificación requerirá operaciones/versionado posteriores (DEBT-2B+), nunca un UPDATE silencioso.';

comment on function public.set_debt_archived_v1(uuid, uuid, boolean) is
  'DEBT-2A: archivo lógico de la deuda cambiando únicamente is_archived (updated_at lo actualiza el trigger existente). Nunca DELETE: el histórico financiero permanece.';