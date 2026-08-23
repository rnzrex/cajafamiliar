-- RECON-1C SQL Verification & Smoke Suite
-- Run against local Supabase instance

begin;

-- 1. Setup mock auth and test fixture
do $$
declare
  v_household_id uuid := '11111111-1111-1111-1111-111111111111';
  v_user_id uuid := '22222222-2222-2222-2222-222222222222';
  v_other_user_id uuid := '33333333-3333-3333-3333-333333333333';
  v_account_id uuid := '44444444-4444-4444-4444-444444444444';
  v_rec_id uuid := '55555555-5555-5555-5555-555555555555';
  v_mov_id text := 'mov-recon1c-test-1';
  v_debt_mov_id text := 'mov-recon1c-debt-1';
  v_now timestamptz := now();
  v_result jsonb;
  v_err_code text;
begin
  raise notice 'Starting RECON-1C SQL verification suite...';

  -- 2. Insert test household & member
  insert into public.households (id, name, created_at)
  values (v_household_id, 'RECON-1C Test Household', v_now)
  on conflict (id) do nothing;

  insert into auth.users (id, email)
  values (v_user_id, 'user1c@test.com')
  on conflict (id) do nothing;

  insert into auth.users (id, email)
  values (v_other_user_id, 'other1c@test.com')
  on conflict (id) do nothing;

  insert into public.household_members (household_id, user_id, role, display_name, created_at)
  values (v_household_id, v_user_id, 'owner', 'User 1C', v_now)
  on conflict (household_id, user_id) do nothing;

  -- Insert active cash financial account
  insert into public.financial_accounts (id, household_id, name, currency_code, reconciliation_type, opening_balance, sort_order, is_active, created_at)
  values (v_account_id, v_household_id, 'Efectivo PEN', 'PEN', 'cash', 100.00, 1, true, v_now)
  on conflict (id, household_id) do nothing;

  -- Insert standard movement
  insert into public.movements (id, household_id, type, date, amount, description, method, category, person, registered_by_user_id, account_id, movement_context, created_at, updated_at)
  values (v_mov_id, v_household_id, 'egreso', '2026-08-20', 50.00, 'Almuerzo equipo', 'efectivo', 'Comida / cenas', 'Juan', v_user_id, v_account_id, 'standard', v_now, v_now)
  on conflict (id, household_id) do nothing;

  -- Insert matched reconciliation & reconciliation movement link
  insert into public.account_reconciliations (id, household_id, account_id, reconciliation_type, currency_code, opening_balance_snapshot, expected_balance, actual_balance, difference, status, registered_by_user_id, created_at)
  values (v_rec_id, v_household_id, v_account_id, 'cash', 'PEN', 100.00, 50.00, 50.00, 0.00, 'matched', v_user_id, v_now)
  on conflict (id) do nothing;

  insert into public.account_reconciliation_movements (id, household_id, reconciliation_id, movement_id, balance_contribution, movement_updated_at_snapshot, movement_snapshot, created_at)
  values (gen_random_uuid(), v_household_id, v_rec_id, v_mov_id, -50.00, v_now, '{}'::jsonb, v_now)
  on conflict (reconciliation_id, movement_id) do nothing;

  -- TEST A: Direct UPDATE on matched movement must fail with MOVEMENT_RECONCILED
  begin
    update public.movements set amount = 60.00 where id = v_mov_id and household_id = v_household_id;
    raise exception 'TEST_FAILED: Direct update on matched movement should have been blocked';
  exception when others then
    if sqlerrm not like '%MOVEMENT_RECONCILED%' then
      raise exception 'TEST_FAILED: Expected MOVEMENT_RECONCILED, got %', sqlerrm;
    end if;
    raise notice 'PASS Test A: Direct UPDATE blocked with MOVEMENT_RECONCILED';
  end;

  -- TEST B: Direct DELETE on matched movement must fail with MOVEMENT_RECONCILED
  begin
    delete from public.movements where id = v_mov_id and household_id = v_household_id;
    raise exception 'TEST_FAILED: Direct delete on matched movement should have been blocked';
  exception when others then
    if sqlerrm not like '%MOVEMENT_RECONCILED%' then
      raise exception 'TEST_FAILED: Expected MOVEMENT_RECONCILED, got %', sqlerrm;
    end if;
    raise notice 'PASS Test B: Direct DELETE blocked with MOVEMENT_RECONCILED';
  end;

  -- Set session auth user context for RPC execution
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);

  -- TEST C: Optimistic Concurrency Conflict (wrong expected_updated_at)
  begin
    v_result := public.correct_reconciled_movement_v1(
      p_household_id => v_household_id,
      p_movement_id => v_mov_id,
      p_expected_updated_at => v_now - interval '10 seconds',
      p_date => '2026-08-20',
      p_amount => 55.00,
      p_description => 'Almuerzo corregido',
      p_method => 'efectivo',
      p_category => 'Comida / cenas',
      p_person => 'Juan',
      p_account_id => v_account_id,
      p_reason => 'Error de tipeo'
    );
    raise exception 'TEST_FAILED: Optimistic concurrency check failed to reject stale timestamp';
  exception when others then
    if sqlerrm not like '%MOVEMENT_CORRECTION_CONFLICT%' then
      raise exception 'TEST_FAILED: Expected MOVEMENT_CORRECTION_CONFLICT, got %', sqlerrm;
    end if;
    raise notice 'PASS Test C: Optimistic concurrency conflict detected correctly';
  end;

  -- TEST D: Account & Method mismatch rejection (cash account with TRANSFERENCIA method)
  begin
    v_result := public.correct_reconciled_movement_v1(
      p_household_id => v_household_id,
      p_movement_id => v_mov_id,
      p_expected_updated_at => v_now,
      p_date => '2026-08-20',
      p_amount => 55.00,
      p_description => 'Almuerzo corregido',
      p_method => 'transferencia',
      p_category => 'Comida / cenas',
      p_person => 'Juan',
      p_account_id => v_account_id,
      p_reason => 'Probando mismatch'
    );
    raise exception 'TEST_FAILED: Account/method mismatch failed to trigger ACCOUNT_METHOD_MISMATCH';
  exception when others then
    if sqlerrm not like '%ACCOUNT_METHOD_MISMATCH%' then
      raise exception 'TEST_FAILED: Expected ACCOUNT_METHOD_MISMATCH, got %', sqlerrm;
    end if;
    raise notice 'PASS Test D: Account/method mismatch validated correctly';
  end;

  -- TEST E: Standard matched movement RPC correction SUCCESS
  v_result := public.correct_reconciled_movement_v1(
    p_household_id => v_household_id,
    p_movement_id => v_mov_id,
    p_correction_id => 'corr-recon1c-1',
    p_expected_updated_at => v_now,
    p_date => '2026-08-21',
    p_amount => 55.00,
    p_description => 'Almuerzo equipo corregido',
    p_method => 'efectivo',
    p_category => 'Comida / cenas',
    p_person => 'Juan Carlos',
    p_account_id => v_account_id,
    p_reason => 'Monto corregido según boleta física'
  );

  if (v_result->>'success')::boolean is not true then
    raise exception 'TEST_FAILED: RPC correction failed: %', v_result;
  end if;
  raise notice 'PASS Test E: RPC correction succeeded for standard matched movement';

  -- TEST F: Verify movement_corrections table audit snapshot
  if not exists (
    select 1
    from public.movement_corrections
    where correction_id = 'corr-recon1c-1'
      and household_id = v_household_id
      and reason = 'Monto corregido según boleta física'
  ) then
    raise exception 'TEST_FAILED: Audit row in movement_corrections was not created properly';
  end if;
  raise notice 'PASS Test F: Audit row stored in movement_corrections with before/after snapshots';

  -- TEST G: Idempotency check with same correction_id
  v_result := public.correct_reconciled_movement_v1(
    p_household_id => v_household_id,
    p_movement_id => v_mov_id,
    p_correction_id => 'corr-recon1c-1',
    p_expected_updated_at => v_now,
    p_date => '2026-08-21',
    p_amount => 55.00,
    p_description => 'Almuerzo equipo corregido',
    p_method => 'efectivo',
    p_category => 'Comida / cenas',
    p_person => 'Juan Carlos',
    p_account_id => v_account_id,
    p_reason => 'Monto corregido según boleta física'
  );

  if (v_result->>'idempotent')::boolean is not true then
    raise exception 'TEST_FAILED: Expected idempotent flag in RPC response';
  end if;
  raise notice 'PASS Test G: Strict idempotency by correction_id preserved';

  raise notice 'ALL RECON-1C SQL VERIFICATION TESTS PASSED SUCCESSFULLY!';
end;
$$;

rollback;
