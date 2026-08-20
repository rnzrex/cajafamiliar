-- Caja Familiar - Accounts backend prerequisites
-- 1. Provisioning automático y retrocompatible de la cuenta Efectivo.
-- 2. Nueva RPC complete_recurring_payment_v2 account-aware.
-- 3. complete_recurring_payment original se conserva intacta.

-- ==================================================
-- A. PROVISIONING DE EFECTIVO
-- ==================================================

-- Backfill idempotente: crea la cuenta Efectivo cash activa únicamente para
-- households que todavía no tienen una. No altera cuentas Efectivo existentes.
insert into public.financial_accounts (household_id, name, reconciliation_type, opening_balance, is_active, sort_order)
select h.id, 'Efectivo', 'cash', coalesce(s.initial_balance, 0), true, 0
  from public.households as h
  left join public.settings as s
    on s.household_id = h.id
 where not exists (
   select 1
     from public.financial_accounts as fa
    where fa.household_id = h.id
      and fa.reconciliation_type = 'cash'
      and fa.is_active = true
 );

-- Backfill idempotente: enlaza movimientos efectivo sin cuenta a la cuenta
-- cash activa del mismo household. No toca movimientos no-cash (Yape,
-- transferencia, tarjeta) históricos sin account_id: permanecen NULL.
update public.movements as m
   set account_id = fa.id
  from public.financial_accounts as fa
 where m.account_id is null
   and m.method = 'efectivo'
   and fa.household_id = m.household_id
   and fa.reconciliation_type = 'cash'
   and fa.is_active = true;

-- Backfill idempotente: enlaza conteos de caja sin cuenta a la cuenta cash
-- activa del mismo household.
update public.cash_counts as cc
   set account_id = fa.id
  from public.financial_accounts as fa
 where cc.account_id is null
   and fa.household_id = cc.household_id
   and fa.reconciliation_type = 'cash'
   and fa.is_active = true;

-- Provee la cuenta Efectivo cuando se crea un household nuevo.
-- NO es SECURITY DEFINER: los triggers internos no son API pública.
create or replace function public.provision_default_cash_account()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
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
$function$;

drop trigger if exists trg_households_provision_default_cash_account on public.households;
create trigger trg_households_provision_default_cash_account
  after insert on public.households
  for each row
  execute function public.provision_default_cash_account();

-- La función trigger no es API pública: sin EXECUTE para clientes.
revoke all privileges on function public.provision_default_cash_account()
  from public, anon, authenticated, service_role;

-- ==================================================
-- B. complete_recurring_payment_v2 (account-aware)
-- ==================================================
-- La RPC legacy public.complete_recurring_payment se conserva exactamente
-- intacta para PWAs y clientes antiguos. v2 replica su semántica y añade
-- el parámetro p_account_id con validación de household.

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

  -- ACCOUNT-AWARE: solo cuando el pago todavía no estaba completado en este
  -- ciclo y se va a crear un movimiento nuevo. Esta validación se ejecuta
  -- DESPUÉS de los errores legacy para no alterar su precedencia: la cuenta
  -- debe existir, pertenecer al household del pago, estar activa y ser
  -- coherente con el shadow legacy `method`.
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

-- RPC v2: EXECUTE únicamente para authenticated.
revoke all privileges on function public.complete_recurring_payment_v2(text, boolean, text, date, numeric, text, text, text, uuid)
  from public, anon, service_role;

grant execute on function public.complete_recurring_payment_v2(text, boolean, text, date, numeric, text, text, text, uuid)
  to authenticated;