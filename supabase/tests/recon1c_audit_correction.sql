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
  v_corr_id1 uuid := '66666666-6666-6666-6666-666666666666';
  v_corr_id2 uuid := '77777777-7777-7777-7777-777777777777';
  v_mov_id text := 'mov-recon1c-test-1';
  v_now timestamptz := now();
  v_result jsonb;
  v_first_updated_at timestamptz;
  v_second_updated_at timestamptz;
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

  -- Set session auth user context for authenticated user
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);

  -- TEST C: Null / Missing correction ID must fail with INVALID_CORRECTION_ID
  begin
    v_result := public.correct_reconciled_movement_v1(
      p_household_id => v_household_id,
      p_movement_id => v_mov_id,
      p_correction_id => null,
      p_expected_updated_at => v_now,
      p_date => '2026-08-20',
      p_amount => 55.00,
      p_description => 'Almuerzo corregido',
      p_method => 'efectivo',
      p_category => 'Comida / cenas',
      p_person => 'Juan',
      p_account_id => v_account_id,
      p_reason => 'Sin ID'
    );
    raise exception 'TEST_FAILED: Null correction ID should have failed';
  exception when others then
    if sqlerrm not like '%INVALID_CORRECTION_ID%' then
      raise exception 'TEST_FAILED: Expected INVALID_CORRECTION_ID, got %', sqlerrm;
    end if;
    raise notice 'PASS Test C: Null correction ID rejected correctly';
  end;

  -- TEST D: Standard matched movement RPC correction 1 SUCCESS
  v_result := public.correct_reconciled_movement_v1(
    p_household_id => v_household_id,
    p_movement_id => v_mov_id,
    p_correction_id => v_corr_id1,
    p_expected_updated_at => v_now,
    p_date => '2026-08-21',
    p_amount => 55.00,
    p_description => 'Almuerzo equipo 1era correccion',
    p_method => 'efectivo',
    p_category => 'Comida / cenas',
    p_person => 'Juan Carlos',
    p_account_id => v_account_id,
    p_reason => 'Primera correccion boleta'
  );

  if (v_result->>'success')::boolean is not true then
    raise exception 'TEST_FAILED: RPC correction 1 failed: %', v_result;
  end if;
  v_first_updated_at := (v_result->'after_snapshot'->>'updated_at')::timestamptz;
  raise notice 'PASS Test D: First RPC correction succeeded';

  -- TEST E: Identical retry with v_corr_id1 returns stored first snapshot and idempotent = true
  v_result := public.correct_reconciled_movement_v1(
    p_household_id => v_household_id,
    p_movement_id => v_mov_id,
    p_correction_id => v_corr_id1,
    p_expected_updated_at => v_now,
    p_date => '2026-08-21',
    p_amount => 55.00,
    p_description => 'Almuerzo equipo 1era correccion',
    p_method => 'efectivo',
    p_category => 'Comida / cenas',
    p_person => 'Juan Carlos',
    p_account_id => v_account_id,
    p_reason => 'Primera correccion boleta'
  );

  if (v_result->>'idempotent')::boolean is not true or (v_result->'after_snapshot'->>'description') <> 'Almuerzo equipo 1era correccion' then
    raise exception 'TEST_FAILED: Identical retry did not return exact stored first after_snapshot';
  end if;
  raise notice 'PASS Test E: Identical retry returned stored snapshot and idempotent=true';

  -- TEST F: Incompatible retry with v_corr_id1 (different amount) returns MOVEMENT_CORRECTION_ID_CONFLICT
  begin
    v_result := public.correct_reconciled_movement_v1(
      p_household_id => v_household_id,
      p_movement_id => v_mov_id,
      p_correction_id => v_corr_id1,
      p_expected_updated_at => v_now,
      p_date => '2026-08-21',
      p_amount => 999.00, -- DIFFERENT AMOUNT
      p_description => 'Almuerzo equipo 1era correccion',
      p_method => 'efectivo',
      p_category => 'Comida / cenas',
      p_person => 'Juan Carlos',
      p_account_id => v_account_id,
      p_reason => 'Primera correccion boleta'
    );
    raise exception 'TEST_FAILED: Incompatible retry should have raised MOVEMENT_CORRECTION_ID_CONFLICT';
  exception when others then
    if sqlerrm not like '%MOVEMENT_CORRECTION_ID_CONFLICT%' then
      raise exception 'TEST_FAILED: Expected MOVEMENT_CORRECTION_ID_CONFLICT, got %', sqlerrm;
    end if;
    raise notice 'PASS Test F: Incompatible retry with same ID rejected with MOVEMENT_CORRECTION_ID_CONFLICT';
  end;

  -- TEST G: Second correction on movement with v_corr_id2 (using updated_at from first correction)
  v_result := public.correct_reconciled_movement_v1(
    p_household_id => v_household_id,
    p_movement_id => v_mov_id,
    p_correction_id => v_corr_id2,
    p_expected_updated_at => v_first_updated_at,
    p_date => '2026-08-22',
    p_amount => 65.00,
    p_description => 'Almuerzo equipo 2da correccion',
    p_method => 'efectivo',
    p_category => 'Comida / cenas',
    p_person => 'Juan Carlos',
    p_account_id => v_account_id,
    p_reason => 'Segunda correccion factura'
  );

  if (v_result->>'success')::boolean is not true then
    raise exception 'TEST_FAILED: Second RPC correction failed';
  end if;
  v_second_updated_at := (v_result->'after_snapshot'->>'updated_at')::timestamptz;
  raise notice 'PASS Test G: Second RPC correction succeeded';

  -- TEST H: Retrying FIRST correction ID (v_corr_id1) now MUST return FIRST stored after_snapshot, NOT second state!
  v_result := public.correct_reconciled_movement_v1(
    p_household_id => v_household_id,
    p_movement_id => v_mov_id,
    p_correction_id => v_corr_id1,
    p_expected_updated_at => v_now,
    p_date => '2026-08-21',
    p_amount => 55.00,
    p_description => 'Almuerzo equipo 1era correccion',
    p_method => 'efectivo',
    p_category => 'Comida / cenas',
    p_person => 'Juan Carlos',
    p_account_id => v_account_id,
    p_reason => 'Primera correccion boleta'
  );

  if (v_result->'after_snapshot'->>'description') <> 'Almuerzo equipo 1era correccion' or (v_result->'after_snapshot'->>'amount')::numeric <> 55.00 then
    raise exception 'TEST_FAILED: Retrying first correction returned latest state instead of historical first stored after_snapshot!';
  end if;
  raise notice 'PASS Test H: Historical retry returned original first snapshot despite later 2nd correction';

  -- TEST I: Security check — Outside household member RPC call rejected
  perform set_config('request.jwt.claim.sub', v_other_user_id::text, true);
  begin
    v_result := public.correct_reconciled_movement_v1(
      p_household_id => v_household_id,
      p_movement_id => v_mov_id,
      p_correction_id => gen_random_uuid(),
      p_expected_updated_at => v_second_updated_at,
      p_date => '2026-08-22',
      p_amount => 70.00,
      p_description => 'Intento outsider',
      p_method => 'efectivo',
      p_category => 'Comida / cenas',
      p_person => 'Juan Carlos',
      p_account_id => v_account_id,
      p_reason => 'Hack attempt'
    );
    raise exception 'TEST_FAILED: Outside member call should have been rejected with NOT_HOUSEHOLD_MEMBER';
  exception when others then
    if sqlerrm not like '%NOT_HOUSEHOLD_MEMBER%' then
      raise exception 'TEST_FAILED: Expected NOT_HOUSEHOLD_MEMBER, got %', sqlerrm;
    end if;
    raise notice 'PASS Test I: Outside household member rejected with NOT_HOUSEHOLD_MEMBER';
  end;

  raise notice 'ALL RECON-1C SQL VERIFICATION TESTS PASSED SUCCESSFULLY!';
end;
$$;

rollback;
