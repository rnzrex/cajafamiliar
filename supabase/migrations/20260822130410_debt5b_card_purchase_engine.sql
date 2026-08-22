-- DEBT-5B: Card Purchase Engine
-- Adds 'credit_card_purchase' to movements.movement_context
-- and creates atomic RPC record_credit_card_purchase_v1.

-- 1. Extend movement_context check constraint on public.movements
alter table public.movements
  drop constraint if exists movements_movement_context_check,
  add constraint movements_movement_context_check
    check (movement_context in ('standard', 'debt_service', 'credit_card_purchase'));

-- 2. Update protect_movement_semantics trigger function
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
    elsif new.movement_context = 'credit_card_purchase'
       and current_user <> 'postgres' then
      raise exception 'CREDIT_CARD_MOVEMENT_RPC_ONLY';
    end if;
    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE')
     and (
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


-- 3. Atomic RPC record_credit_card_purchase_v1
create or replace function public.record_credit_card_purchase_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_entry_id uuid,
  p_movement_id text,
  p_purchase_date date,
  p_amount numeric,
  p_description text,
  p_category text
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
$function$;

-- Permissions
revoke all on function public.record_credit_card_purchase_v1(uuid, uuid, uuid, text, date, numeric, text, text) from public, anon;
grant execute on function public.record_credit_card_purchase_v1(uuid, uuid, uuid, text, date, numeric, text, text) to authenticated;
