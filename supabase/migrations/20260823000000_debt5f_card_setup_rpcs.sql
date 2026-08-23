-- DEBT-5F-A: Secure Credit Card Setup & Mutation RPCs.
-- Atomic credit card debt + profile creation and secure profile mutation/recovery.

-- 1. CREATE_CREDIT_CARD_DEBT_V1
create or replace function public.create_credit_card_debt_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_name text,
  p_creditor_name text,
  p_currency_code text,
  p_origin_date date,
  p_tracking_start_date date,
  p_opening_balance numeric,
  p_credit_limit numeric,
  p_closing_day integer,
  p_due_day integer,
  p_last4 text,
  p_tea_percent numeric,
  p_tcea_percent numeric,
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
$function$;

grant execute on function public.create_credit_card_debt_v1(
  uuid, uuid, text, text, text, date, date, numeric, numeric, integer, integer, text, numeric, numeric, text
) to authenticated;


-- 2. SAVE_CREDIT_CARD_PROFILE_V1
create or replace function public.save_credit_card_profile_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_credit_limit numeric,
  p_closing_day integer,
  p_due_day integer,
  p_last4 text
)
returns pg_catalog.jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
$function$;

grant execute on function public.save_credit_card_profile_v1(
  uuid, uuid, numeric, integer, integer, text
) to authenticated;
