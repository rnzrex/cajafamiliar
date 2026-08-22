-- DEBT-5D: Fees, Credits & Reversals Engine
-- Implements record_credit_card_fee_v1, record_credit_card_credit_v1, and reverse_credit_card_entry_v1 RPCs.

-- 1. Extend public.credit_card_entries schema with credit_of_entry_id
alter table public.credit_card_entries
  add column if not exists credit_of_entry_id uuid null;

-- Add FK for household/card isolation
alter table public.credit_card_entries
  drop constraint if exists fk_credit_card_entries_credit_of_entry;

alter table public.credit_card_entries
  add constraint fk_credit_card_entries_credit_of_entry
  foreign key (credit_of_entry_id, debt_id, household_id)
  references public.credit_card_entries(id, debt_id, household_id);

-- Check constraint for credit_of_entry_id
alter table public.credit_card_entries
  drop constraint if exists chk_credit_card_entries_credit_of_entry;

alter table public.credit_card_entries
  add constraint chk_credit_card_entries_credit_of_entry
  check (
    (entry_type = 'credit' and credit_of_entry_id is not null and credit_of_entry_id <> id)
    or (entry_type <> 'credit' and credit_of_entry_id is null)
  );

-- Index for credit_of_entry_id lookups
create index if not exists idx_credit_card_entries_credit_target
  on public.credit_card_entries(credit_of_entry_id)
  where credit_of_entry_id is not null;

-- Update movements movement_context check constraint to include credit_card_credit
alter table public.movements
  drop constraint if exists movements_movement_context_check;

alter table public.movements
  add constraint movements_movement_context_check
  check (movement_context in ('standard', 'debt_service', 'credit_card_purchase', 'credit_card_payment', 'credit_card_fee', 'credit_card_credit'));

-- Update protect_movement_semantics trigger function
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


-- 2. Atomic RPC record_credit_card_fee_v1
create or replace function public.record_credit_card_fee_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_entry_id uuid,
  p_movement_id text,
  p_fee_date date,
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
$function$;

-- Permissions
revoke all on function public.record_credit_card_fee_v1(uuid, uuid, uuid, text, date, numeric, text, text) from public, anon;
grant execute on function public.record_credit_card_fee_v1(uuid, uuid, uuid, text, date, numeric, text, text) to authenticated;


-- 3. Atomic RPC record_credit_card_credit_v1
create or replace function public.record_credit_card_credit_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_entry_id uuid,
  p_movement_id text,
  p_target_entry_id uuid,
  p_credit_date date,
  p_amount numeric,
  p_description text
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
$function$;

-- Permissions
revoke all on function public.record_credit_card_credit_v1(uuid, uuid, uuid, text, uuid, date, numeric, text) from public, anon;
grant execute on function public.record_credit_card_credit_v1(uuid, uuid, uuid, text, uuid, date, numeric, text) to authenticated;


-- 4. Atomic RPC reverse_credit_card_entry_v1 (Append-Only Reversal Engine)
create or replace function public.reverse_credit_card_entry_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_reversal_entry_id uuid,
  p_target_entry_id uuid,
  p_reversal_date date,
  p_description text
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
$function$;

-- Permissions
revoke all on function public.reverse_credit_card_entry_v1(uuid, uuid, uuid, uuid, date, text) from public, anon;
grant execute on function public.reverse_credit_card_entry_v1(uuid, uuid, uuid, uuid, date, text) to authenticated;
