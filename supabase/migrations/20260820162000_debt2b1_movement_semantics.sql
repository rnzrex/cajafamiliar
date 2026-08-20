-- DEBT-2B.1: Movement cash-flow/economic semantics foundation.
-- No Debt payment engine is created here.

alter table public.movements
  add column movement_context text not null default 'standard';

alter table public.movements
  drop constraint if exists movements_movement_context_check,
  add constraint movements_movement_context_check
    check (movement_context in ('standard', 'debt_service'));

-- Only a future SECURITY DEFINER function owned by postgres may create a
-- debt_service movement. Manual authenticated writes remain standard.
create or replace function public.protect_movement_semantics()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    if new.movement_context = 'debt_service'
       and current_user <> 'postgres' then
      raise exception 'DEBT_SERVICE_MOVEMENT_RPC_ONLY';
    end if;
    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE')
     and exists (
    select 1
    from public.debt_events as de
    where de.movement_id = old.id
      and de.household_id = old.household_id
  ) then
    raise exception 'DEBT_MOVEMENT_PROTECTED';
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
$function$;

drop trigger if exists trg_movements_protect_semantics on public.movements;
create trigger trg_movements_protect_semantics
  before insert or update or delete
  on public.movements
  for each row
  execute function public.protect_movement_semantics();

-- The column privilege lets the trigger return the stable immutability error
-- instead of PostgreSQL stopping at column ACL evaluation first.
grant update (movement_context) on table public.movements
  to authenticated;

-- A debt event may only reference a fully classified debt-service cash
-- movement. The account may be archived: historical Movement reuse remains
-- valid after an account is archived.
create or replace function public.validate_debt_event_movement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
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
$function$;

revoke execute on function public.protect_movement_semantics()
  from public, anon, authenticated, service_role;

revoke execute on function public.validate_debt_event_movement()
  from public, anon, authenticated, service_role;

comment on column public.movements.movement_context is
  'Clasifica el contexto financiero del movimiento: standard es un movimiento normal; debt_service queda reservado para futuras RPC Debt SECURITY DEFINER. Es inmutable y no cambia la semantica de cash-flow del movimiento.';
