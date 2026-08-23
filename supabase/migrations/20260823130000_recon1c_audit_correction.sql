-- RECON-1C: Audit & Controlled Correction Migration

-- 1. Table movement_corrections
create table if not exists public.movement_corrections (
  id uuid not null default gen_random_uuid() primary key,
  household_id uuid not null,
  movement_id text not null,
  correction_id uuid not null,
  request_snapshot jsonb not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  reason text not null,
  registered_by_user_id uuid not null,
  created_at timestamptz not null default now(),

  constraint movement_corrections_correction_id_key
    unique (correction_id),
  constraint movement_corrections_household_fkey
    foreign key (household_id)
    references public.households(id)
    on delete cascade,
  constraint movement_corrections_user_fkey
    foreign key (registered_by_user_id)
    references auth.users(id)
    on delete restrict
);

create index if not exists idx_movement_corrections_household_movement
  on public.movement_corrections(household_id, movement_id, created_at desc);

-- 2. RLS & Grants for movement_corrections
alter table public.movement_corrections enable row level security;

drop policy if exists movement_corrections_select on public.movement_corrections;
create policy movement_corrections_select
  on public.movement_corrections
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = movement_corrections.household_id
        and hm.user_id = (select auth.uid())
    )
  );

grant select on table public.movement_corrections to authenticated;

revoke insert, update, delete on table public.movement_corrections from authenticated, anon, public;

-- 3. Update protect_movement_semantics function
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
$function$;

-- 4. RPC correct_reconciled_movement_v1
create or replace function public.correct_reconciled_movement_v1(
  p_household_id uuid,
  p_movement_id text,
  p_correction_id uuid,
  p_expected_updated_at timestamptz default null,
  p_date text default null,
  p_amount numeric default null,
  p_description text default null,
  p_method text default null,
  p_category text default null,
  p_person text default null,
  p_account_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
$function$;

-- Revoke default public execution privileges and grant to authenticated only
revoke all on function public.correct_reconciled_movement_v1(uuid, text, uuid, timestamptz, text, numeric, text, text, text, text, uuid, text) from public, anon, service_role;
grant execute on function public.correct_reconciled_movement_v1(uuid, text, uuid, timestamptz, text, numeric, text, text, text, text, uuid, text) to authenticated;
