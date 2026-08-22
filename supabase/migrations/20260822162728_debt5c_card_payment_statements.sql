-- DEBT-5C: Card Payment Engine & Statements (Hardened)
-- Adds currency_code to financial_accounts, extends movement_context check constraint,
-- creates credit_card_statements table with RLS, and implements atomic RPCs
-- record_credit_card_payment_v1 & close_credit_card_statement_v1.

-- 0. Currency Safety Foundation for financial_accounts
alter table public.financial_accounts
  add column if not exists currency_code text not null default 'PEN';

alter table public.financial_accounts
  drop constraint if exists financial_accounts_currency_code_check,
  add constraint financial_accounts_currency_code_check
    check (currency_code in ('PEN', 'USD'));


-- 1. Extend movement_context check constraint on public.movements
alter table public.movements
  drop constraint if exists movements_movement_context_check,
  add constraint movements_movement_context_check
    check (movement_context in ('standard', 'debt_service', 'credit_card_purchase', 'credit_card_payment', 'credit_card_fee'));


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
    elsif new.movement_context in ('credit_card_purchase', 'credit_card_payment', 'credit_card_fee')
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


-- 3. Table public.credit_card_statements
create table if not exists public.credit_card_statements (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.debts(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  statement_date date not null,
  due_date date not null,
  statement_balance numeric not null,
  minimum_payment_amount numeric null,
  closing_entry_id uuid null references public.credit_card_entries(id) on delete set null,
  created_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_card_statements_debt_household_fkey
    foreign key (debt_id, household_id)
    references public.debts(id, household_id)
    on delete cascade,
  constraint credit_card_statements_profile_fkey
    foreign key (debt_id, household_id)
    references public.credit_card_profiles(debt_id, household_id)
    on delete cascade,
  constraint credit_card_statements_dates_check
    check (due_date >= statement_date),
  constraint credit_card_statements_unique_cycle
    unique (debt_id, statement_date)
);

-- RLS & Grants on credit_card_statements
alter table public.credit_card_statements enable row level security;

drop policy if exists credit_card_statements_select_member on public.credit_card_statements;
create policy credit_card_statements_select_member
  on public.credit_card_statements
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
     where hm.household_id = credit_card_statements.household_id
       and hm.user_id = auth.uid()
    )
  );

revoke all on public.credit_card_statements from public, anon, authenticated;
grant select on public.credit_card_statements to authenticated;


-- 4. Atomic RPC record_credit_card_payment_v1 (Strict Currency Isolation & Movement Idempotency)
create or replace function public.record_credit_card_payment_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_entry_id uuid,
  p_movement_id text,
  p_payment_date date,
  p_amount numeric,
  p_account_id uuid,
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
$function$;

-- Permissions
revoke all on function public.record_credit_card_payment_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text) from public, anon;
grant execute on function public.record_credit_card_payment_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text) to authenticated;


-- 5. Atomic RPC close_credit_card_statement_v1 (Historical Reversal As-Of Fix & Minimum Payment Idempotency)
create or replace function public.close_credit_card_statement_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_statement_id uuid,
  p_statement_date date,
  p_due_date date,
  p_minimum_payment_amount numeric default null
)
returns pg_catalog.jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
$function$;

-- Permissions
revoke all on function public.close_credit_card_statement_v1(uuid, uuid, uuid, date, date, numeric) from public, anon;
grant execute on function public.close_credit_card_statement_v1(uuid, uuid, uuid, date, date, numeric) to authenticated;
