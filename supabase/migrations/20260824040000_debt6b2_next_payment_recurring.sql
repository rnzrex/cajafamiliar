-- DEBT-6B.2 Next Payment & Linked Recurring Debt Foundation
-- Schema expansion, versioned RPCs (create_debt_v2, update_debt_terms_v2), linked recurring synchronization & start-date support.

-- ============================================================
-- 1. SCHEMAS & CONSTRAINTS
-- ============================================================

-- Add minimum_principal_payment to debts
alter table public.debts
  add column if not exists minimum_principal_payment numeric null;

alter table public.debts
  drop constraint if exists debts_minimum_principal_payment_check,
  add constraint debts_minimum_principal_payment_check
    check (minimum_principal_payment is null or minimum_principal_payment > 0);

-- Ensure recurring_payments.id is text type
alter table public.recurring_payments
  alter column id type text using id::text;

-- Extend recurring_payments with link and start-date fields
alter table public.recurring_payments
  add column if not exists linked_debt_id uuid null references public.debts(id) on delete cascade,
  add column if not exists starts_on date null,
  add column if not exists currency_code text not null default 'PEN';

create unique index if not exists idx_recurring_payments_unique_linked_debt
  on public.recurring_payments (linked_debt_id)
  where linked_debt_id is not null;

create index if not exists idx_recurring_payments_linked_debt
  on public.recurring_payments (linked_debt_id);

-- ============================================================
-- 2. LINKED RECURRING SYNC FUNCTION & TRIGGERS
-- ============================================================

create or replace function public.sync_linked_recurring_payment(p_debt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_debt public.debts%rowtype;
  v_should_be_active boolean := false;
  v_due_day integer;
  v_latest_event_date date;
  v_latest_event_created timestamptz;
  v_now_date date := (pg_catalog.now() at time zone 'America/Lima')::date;
  v_now_month integer := extract(month from v_now_date)::integer;
  v_now_year integer := extract(year from v_now_date)::integer;
  v_event_month integer;
  v_event_year integer;
  v_is_paid boolean := false;
  v_rec_id text;
begin
  -- Set transaction-local flag for authorized internal debt sync
  perform set_config('app.internal_sync', 'true', true);

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

  -- Find latest effective qualifying payment (payment or payoff not reversed)
  select e.event_date, e.created_at
    into v_latest_event_date, v_latest_event_created
    from public.debt_events as e
   where e.debt_id = p_debt_id
     and e.event_type in ('payment', 'payoff')
     and not exists (
       select 1
         from public.debt_events as r
        where r.reversal_of_event_id = e.id
     )
   order by e.event_date desc, e.created_at desc, e.id desc
   limit 1;

  if v_latest_event_date is not null then
    v_event_month := extract(month from (v_latest_event_date at time zone 'America/Lima'))::integer;
    v_event_year := extract(year from (v_latest_event_date at time zone 'America/Lima'))::integer;

    if (v_event_year > v_now_year) or (v_event_year = v_now_year and v_event_month >= v_now_month) then
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
    case when v_is_paid then v_event_month else null end,
    case when v_is_paid then v_event_year else null end,
    case when v_is_paid then v_latest_event_created else null end,
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
$function$;

create or replace function public.trg_sync_debt_recurring()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    perform public.sync_linked_recurring_payment(old.id);
  else
    perform public.sync_linked_recurring_payment(new.id);
  end if;
  return null;
end;
$function$;

drop trigger if exists trg_sync_debt_recurring_trigger on public.debts;
create trigger trg_sync_debt_recurring_trigger
  after insert or update on public.debts
  for each row
  execute function public.trg_sync_debt_recurring();

create or replace function public.trg_sync_debt_events_recurring()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    perform public.sync_linked_recurring_payment(old.debt_id);
  else
    perform public.sync_linked_recurring_payment(new.debt_id);
  end if;
  return null;
end;
$function$;

drop trigger if exists trg_sync_debt_events_recurring_trigger on public.debt_events;
create trigger trg_sync_debt_events_recurring_trigger
  after insert or update or delete on public.debt_events
  for each row
  execute function public.trg_sync_debt_events_recurring();

-- Protection trigger for manual writes to debt-linked recurring payments
create or replace function public.trg_protect_debt_linked_recurring()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if current_setting('app.internal_sync', true) = 'true' or pg_trigger_depth() > 1 then
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
$function$;

drop trigger if exists trg_protect_debt_linked_recurring_trigger on public.recurring_payments;
create trigger trg_protect_debt_linked_recurring_trigger
  before insert or update or delete on public.recurring_payments
  for each row
  execute function public.trg_protect_debt_linked_recurring();

-- ============================================================
-- 3. CREATE_DEBT_V2 (26-ARGUMENT RPC)
-- ============================================================

create or replace function public.create_debt_v2(
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
  p_periodic_rate_basis text,
  p_minimum_principal_payment numeric default null
)
returns pg_catalog.jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
$function$;

-- ============================================================
-- 4. UPDATE_DEBT_TERMS_V2 (SECURE TERMS UPDATE RPC)
-- ============================================================

create or replace function public.update_debt_terms_v2(
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
  p_clear_frequency boolean default false,
  p_first_due_date date default null,
  p_clear_first_due_date boolean default false,
  p_minimum_principal_payment numeric default null,
  p_clear_minimum_principal_payment boolean default false
)
returns pg_catalog.jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
$function$;

-- ============================================================
-- 5. COMPLETE_RECURRING_PAYMENT_V2 (RESTORED STABLE SEMANTICS + LINKED GUARD)
-- ============================================================

create or replace function public.complete_recurring_payment_v2(
  p_payment_id text,
  p_create_expense boolean,
  p_movement_id text,
  p_movement_date date,
  p_movement_amount numeric,
  p_movement_description text,
  p_movement_method text,
  p_movement_category text,
  p_account_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
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
$function$;

-- ============================================================
-- 6. SECURITY & PERMISSIONS
-- ============================================================

-- Internal sync helpers & triggers: REVOKE ALL EXECUTE
revoke all privileges on function public.sync_linked_recurring_payment(uuid)
  from public, anon, authenticated, service_role;

revoke all privileges on function public.trg_sync_debt_recurring()
  from public, anon, authenticated, service_role;

revoke all privileges on function public.trg_sync_debt_events_recurring()
  from public, anon, authenticated, service_role;

revoke all privileges on function public.trg_protect_debt_linked_recurring()
  from public, anon, authenticated, service_role;

-- Public versioned RPCs: AUTHENTICATED ONLY
revoke all privileges on function public.create_debt_v2(uuid, uuid, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, jsonb, jsonb, text, text, numeric, text, numeric)
  from public, anon, service_role;

grant execute on function public.create_debt_v2(uuid, uuid, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, jsonb, jsonb, text, text, numeric, text, numeric)
  to authenticated;

revoke all privileges on function public.update_debt_terms_v2(uuid, uuid, text, text, numeric, text, numeric, numeric, text, integer, boolean, boolean, boolean, boolean, date, boolean, numeric, boolean)
  from public, anon, service_role;

grant execute on function public.update_debt_terms_v2(uuid, uuid, text, text, numeric, text, numeric, numeric, text, integer, boolean, boolean, boolean, boolean, date, boolean, numeric, boolean)
  to authenticated;

revoke all privileges on function public.complete_recurring_payment_v2(text, boolean, text, date, numeric, text, text, text, uuid)
  from public, anon, service_role;

grant execute on function public.complete_recurring_payment_v2(text, boolean, text, date, numeric, text, text, text, uuid)
  to authenticated;

comment on function public.create_debt_v2(uuid, uuid, text, text, text, text, date, date, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, jsonb, jsonb, text, text, numeric, text, numeric) is
  'DEBT-6B.2: Permite registrar una nueva deuda especificando abono mínimo a capital y sincronización automática con pagos recurrentes.';

comment on function public.update_debt_terms_v2(uuid, uuid, text, text, numeric, text, numeric, numeric, text, integer, boolean, boolean, boolean, boolean, date, boolean, numeric, boolean) is
  'DEBT-6B.2: Actualiza términos de deuda incluyendo día/fecha de vencimiento y abono mínimo obligatorio a capital.';
