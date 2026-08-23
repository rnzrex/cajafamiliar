-- RECON-1A: Account Reconciliation Foundation Migration

-- 1. Add updated_at column to movements with server-side trigger
alter table public.movements
  add column if not exists updated_at timestamptz not null default now();

update public.movements
  set updated_at = created_at;

create or replace function public.touch_movements_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$function$;

drop trigger if exists trg_movements_touch_updated_at on public.movements;
create trigger trg_movements_touch_updated_at
  before update on public.movements
  for each row
  execute function public.touch_movements_updated_at();

-- 2. Table account_reconciliations
create table if not exists public.account_reconciliations (
  id uuid not null default gen_random_uuid() primary key,
  household_id uuid not null,
  account_id uuid not null,
  reconciliation_type text not null,
  currency_code text not null,
  opening_balance_snapshot numeric(12, 2) not null,
  expected_balance numeric(12, 2) not null,
  actual_balance numeric(12, 2) not null,
  difference numeric(12, 2) not null,
  status text not null,
  denominations jsonb null,
  registered_by_user_id uuid not null,
  created_at timestamptz not null default now(),

  constraint account_reconciliations_reconciliation_type_check
    check (reconciliation_type in ('balance', 'cash')),
  constraint account_reconciliations_status_check
    check (status in ('matched', 'mismatch')),
  constraint account_reconciliations_household_fkey
    foreign key (household_id)
    references public.households(id)
    on delete cascade,
  constraint account_reconciliations_account_fkey
    foreign key (account_id, household_id)
    references public.financial_accounts(id, household_id)
    on delete cascade,
  constraint account_reconciliations_user_fkey
    foreign key (registered_by_user_id)
    references auth.users(id)
    on delete restrict
);

create index if not exists idx_account_reconciliations_household_account
  on public.account_reconciliations(household_id, account_id, created_at desc);

-- 3. Table account_reconciliation_movements (NO FK to movements so mismatch movement deletion is allowed)
create table if not exists public.account_reconciliation_movements (
  id uuid not null default gen_random_uuid() primary key,
  household_id uuid not null,
  reconciliation_id uuid not null,
  movement_id text not null,
  balance_contribution numeric(12, 2) not null,
  movement_updated_at_snapshot timestamptz not null,
  movement_snapshot jsonb not null,
  created_at timestamptz not null default now(),

  constraint account_reconciliation_movements_household_fkey
    foreign key (household_id)
    references public.households(id)
    on delete cascade,
  constraint account_reconciliation_movements_reconciliation_fkey
    foreign key (reconciliation_id)
    references public.account_reconciliations(id)
    on delete cascade,
  constraint account_reconciliation_movements_unique_rec_mov
    unique (reconciliation_id, movement_id)
);

create index if not exists idx_account_reconciliation_movements_rec
  on public.account_reconciliation_movements(reconciliation_id);

create index if not exists idx_account_reconciliation_movements_movement
  on public.account_reconciliation_movements(movement_id);

-- 4. Enable RLS and grants
alter table public.account_reconciliations enable row level security;
alter table public.account_reconciliation_movements enable row level security;

drop policy if exists account_reconciliations_select on public.account_reconciliations;
create policy account_reconciliations_select
  on public.account_reconciliations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = account_reconciliations.household_id
        and hm.user_id = (select auth.uid())
    )
  );

drop policy if exists account_reconciliation_movements_select on public.account_reconciliation_movements;
create policy account_reconciliation_movements_select
  on public.account_reconciliation_movements
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = account_reconciliation_movements.household_id
        and hm.user_id = (select auth.uid())
    )
  );

grant select on table public.account_reconciliations to authenticated;
grant select on table public.account_reconciliation_movements to authenticated;

revoke insert, update, delete on table public.account_reconciliations from authenticated, anon, public;
revoke insert, update, delete on table public.account_reconciliation_movements from authenticated, anon, public;

-- 5. Extend protect_movement_semantics trigger to protect matched reconciliation movements
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
      raise exception 'MOVEMENT_RECONCILED';
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
$function$;

-- 6. RPC record_account_reconciliation_v1 (Single coherent snapshot capture)
create or replace function public.record_account_reconciliation_v1(
  p_household_id uuid,
  p_reconciliation_id uuid,
  p_account_id uuid,
  p_actual_balance numeric default null,
  p_denominations jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
$function$;

-- Revoke execute explicitly from public, anon, service_role
revoke all on function public.record_account_reconciliation_v1(uuid, uuid, uuid, numeric, jsonb) from public, anon, service_role;
grant execute on function public.record_account_reconciliation_v1(uuid, uuid, uuid, numeric, jsonb) to authenticated;
