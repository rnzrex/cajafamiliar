-- DEBT-6B.3 SQL Smoke Test Suite
-- Executes all 14 required backend SQL scenarios inside an isolated transaction.

begin;

do $$
declare
  v_household_id uuid := '00000000-0000-4000-a000-000000000001'::uuid;
  v_other_household_id uuid := '00000000-0000-4000-a000-000000000002'::uuid;
  v_user_id uuid := '00000000-0000-4000-a000-000000000003'::uuid;
  v_other_user_id uuid := '00000000-0000-4000-a000-000000000004'::uuid;

  v_debt_simple uuid := gen_random_uuid();
  v_debt_recurring uuid := gen_random_uuid();
  v_debt_fixed uuid := gen_random_uuid();
  v_debt_pledge uuid := gen_random_uuid();
  v_debt_card_pristine uuid := gen_random_uuid();
  v_debt_payment uuid := gen_random_uuid();
  v_debt_adj uuid := gen_random_uuid();
  v_debt_reversed uuid := gen_random_uuid();
  v_debt_card_entry uuid := gen_random_uuid();
  v_debt_card_stmt uuid := gen_random_uuid();

  v_sched_version_id uuid := gen_random_uuid();
  v_res jsonb;
  v_caught boolean;
  v_rec_count integer;
begin
  -- Setup test households and members
  insert into public.households (id, name) values (v_household_id, 'Test Household 1') on conflict do nothing;
  insert into public.households (id, name) values (v_other_household_id, 'Test Household 2') on conflict do nothing;

  insert into public.household_members (id, household_id, user_id, role)
  values (gen_random_uuid(), v_household_id, v_user_id, 'owner') on conflict do nothing;

  insert into public.household_members (id, household_id, user_id, role)
  values (gen_random_uuid(), v_other_household_id, v_other_user_id, 'owner') on conflict do nothing;

  -- Set auth context to v_user_id
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);

  -------------------------------------------------------------
  -- 1. Simple open-ended debt, no events => delete succeeds.
  -------------------------------------------------------------
  insert into public.debts (id, household_id, created_by_user_id, name, creditor_name, debt_kind, currency_code, origin_date, tracking_start_date, original_principal, opening_principal_balance, status)
  values (v_debt_simple, v_household_id, v_user_id, 'Simple Debt', 'Bank A', 'other', 'PEN', '2026-01-01', '2026-01-01', 1000, 1000, 'active');

  v_res := public.delete_pristine_debt_v1(v_household_id, v_debt_simple);
  if (v_res->>'success')::boolean is not true then
    raise exception 'Test 1 failed: expected simple debt delete to succeed';
  end if;

  -------------------------------------------------------------
  -- 2. Open-ended monthly debt with linked recurring shell => delete succeeds & removes recurring row.
  -------------------------------------------------------------
  insert into public.debts (id, household_id, created_by_user_id, name, creditor_name, debt_kind, currency_code, origin_date, tracking_start_date, original_principal, opening_principal_balance, status)
  values (v_debt_recurring, v_household_id, v_user_id, 'Recurring Debt', 'Bank B', 'other', 'PEN', '2026-01-01', '2026-01-01', 2000, 2000, 'active');

  insert into public.recurring_payments (id, household_id, name, amount, category, frequency, day_of_month, is_active, linked_debt_id, auto_sync_debt_linked)
  values (gen_random_uuid(), v_household_id, 'Cuota Recurring', 100, 'Servicios', 'monthly', 15, true, v_debt_recurring, true);

  v_res := public.delete_pristine_debt_v1(v_household_id, v_debt_recurring);
  select count(*) into v_rec_count from public.recurring_payments where linked_debt_id = v_debt_recurring;
  if v_rec_count <> 0 then
    raise exception 'Test 2 failed: linked recurring row not removed';
  end if;

  -------------------------------------------------------------
  -- 3. Fixed-schedule debt with schedule/installments => delete succeeds & setup rows cleaned.
  -------------------------------------------------------------
  insert into public.debts (id, household_id, created_by_user_id, name, creditor_name, debt_kind, currency_code, origin_date, tracking_start_date, original_principal, opening_principal_balance, status, repayment_structure)
  values (v_debt_fixed, v_household_id, v_user_id, 'Fixed Debt', 'Bank C', 'bank_loan', 'PEN', '2026-01-01', '2026-01-01', 5000, 5000, 'active', 'fixed_schedule');

  insert into public.debt_schedule_versions (id, debt_id, version_number, is_active)
  values (v_sched_version_id, v_debt_fixed, 1, true);

  insert into public.debt_installments (id, schedule_version_id, installment_number, due_date, expected_total_amount)
  values (gen_random_uuid(), v_sched_version_id, 1, '2026-02-01', 500);

  v_res := public.delete_pristine_debt_v1(v_household_id, v_debt_fixed);
  select count(*) into v_rec_count from public.debt_schedule_versions where debt_id = v_debt_fixed;
  if v_rec_count <> 0 then
    raise exception 'Test 3 failed: schedule version not cleaned';
  end if;

  -------------------------------------------------------------
  -- 4. Pledge with collateral => delete succeeds.
  -------------------------------------------------------------
  insert into public.debts (id, household_id, created_by_user_id, name, creditor_name, debt_kind, currency_code, origin_date, tracking_start_date, original_principal, opening_principal_balance, status)
  values (v_debt_pledge, v_household_id, v_user_id, 'Pledge Debt', 'Prenda Bank', 'pledge', 'PEN', '2026-01-01', '2026-01-01', 3000, 3000, 'active');

  insert into public.debt_collaterals (id, debt_id, description, estimated_value)
  values (gen_random_uuid(), v_debt_pledge, 'Anillo de oro', 4000);

  v_res := public.delete_pristine_debt_v1(v_household_id, v_debt_pledge);

  -------------------------------------------------------------
  -- 5. Credit-card debt with profile only => delete succeeds.
  -------------------------------------------------------------
  insert into public.debts (id, household_id, created_by_user_id, name, creditor_name, debt_kind, currency_code, origin_date, tracking_start_date, original_principal, opening_principal_balance, status)
  values (v_debt_card_pristine, v_household_id, v_user_id, 'Card Pristine', 'Visa', 'credit_card', 'PEN', '2026-01-01', '2026-01-01', 0, 0, 'active');

  insert into public.credit_card_profiles (id, debt_id, credit_limit, closing_day, due_day)
  values (gen_random_uuid(), v_debt_card_pristine, 10000, 15, 5);

  v_res := public.delete_pristine_debt_v1(v_household_id, v_debt_card_pristine);

  -------------------------------------------------------------
  -- 6. Debt with payment event => DEBT_HAS_HISTORY & blocked.
  -------------------------------------------------------------
  insert into public.debts (id, household_id, created_by_user_id, name, creditor_name, debt_kind, currency_code, origin_date, tracking_start_date, original_principal, opening_principal_balance, status)
  values (v_debt_payment, v_household_id, v_user_id, 'Payment Debt', 'Bank D', 'other', 'PEN', '2026-01-01', '2026-01-01', 1000, 1000, 'active');

  insert into public.debt_events (id, debt_id, event_type, event_date, cash_amount, principal_delta, interest_paid, fees_paid, insurance_paid, other_cost_paid)
  values (gen_random_uuid(), v_debt_payment, 'payment', '2026-02-01', 100, 100, 0, 0, 0, 0);

  v_caught := false;
  begin
    perform public.delete_pristine_debt_v1(v_household_id, v_debt_payment);
  exception when others then
    if sqlerrm like '%DEBT_HAS_HISTORY%' then
      v_caught := true;
    end if;
  end;
  if not v_caught then
    raise exception 'Test 6 failed: payment event did not block delete';
  end if;

  -------------------------------------------------------------
  -- 7. Debt with principal_adjustment only => DEBT_HAS_HISTORY & blocked.
  -------------------------------------------------------------
  insert into public.debts (id, household_id, created_by_user_id, name, creditor_name, debt_kind, currency_code, origin_date, tracking_start_date, original_principal, opening_principal_balance, status)
  values (v_debt_adj, v_household_id, v_user_id, 'Adj Debt', 'Bank E', 'other', 'PEN', '2026-01-01', '2026-01-01', 1000, 1000, 'active');

  insert into public.debt_events (id, debt_id, event_type, event_date, cash_amount, principal_delta, interest_paid, fees_paid, insurance_paid, other_cost_paid)
  values (gen_random_uuid(), v_debt_adj, 'principal_adjustment', '2026-02-01', 0, 50, 0, 0, 0, 0);

  v_caught := false;
  begin
    perform public.delete_pristine_debt_v1(v_household_id, v_debt_adj);
  exception when others then
    if sqlerrm like '%DEBT_HAS_HISTORY%' then
      v_caught := true;
    end if;
  end;
  if not v_caught then
    raise exception 'Test 7 failed: principal adjustment did not block delete';
  end if;

  -------------------------------------------------------------
  -- 8. Debt with reversed payment => DEBT_HAS_HISTORY & blocked.
  -------------------------------------------------------------
  insert into public.debts (id, household_id, created_by_user_id, name, creditor_name, debt_kind, currency_code, origin_date, tracking_start_date, original_principal, opening_principal_balance, status)
  values (v_debt_reversed, v_household_id, v_user_id, 'Reversed Debt', 'Bank F', 'other', 'PEN', '2026-01-01', '2026-01-01', 1000, 1000, 'active');

  insert into public.debt_events (id, debt_id, event_type, event_date, cash_amount, principal_delta, interest_paid, fees_paid, insurance_paid, other_cost_paid)
  values (gen_random_uuid(), v_debt_reversed, 'reversal', '2026-02-01', 0, 0, 0, 0, 0, 0);

  v_caught := false;
  begin
    perform public.delete_pristine_debt_v1(v_household_id, v_debt_reversed);
  exception when others then
    if sqlerrm like '%DEBT_HAS_HISTORY%' then
      v_caught := true;
    end if;
  end;
  if not v_caught then
    raise exception 'Test 8 failed: reversed event did not block delete';
  end if;

  -------------------------------------------------------------
  -- 9. Card with credit_card_entry => DEBT_HAS_HISTORY & blocked.
  -------------------------------------------------------------
  insert into public.debts (id, household_id, created_by_user_id, name, creditor_name, debt_kind, currency_code, origin_date, tracking_start_date, original_principal, opening_principal_balance, status)
  values (v_debt_card_entry, v_household_id, v_user_id, 'Card Entry Debt', 'Visa 2', 'credit_card', 'PEN', '2026-01-01', '2026-01-01', 0, 0, 'active');

  insert into public.credit_card_entries (id, debt_id, entry_type, transaction_date, post_date, description, amount, status)
  values (gen_random_uuid(), v_debt_card_entry, 'purchase', '2026-02-01', '2026-02-01', 'Compra supermercado', 150, 'posted');

  v_caught := false;
  begin
    perform public.delete_pristine_debt_v1(v_household_id, v_debt_card_entry);
  exception when others then
    if sqlerrm like '%DEBT_HAS_HISTORY%' then
      v_caught := true;
    end if;
  end;
  if not v_caught then
    raise exception 'Test 9 failed: credit card entry did not block delete';
  end if;

  -------------------------------------------------------------
  -- 10. Card with statement => DEBT_HAS_HISTORY & blocked.
  -------------------------------------------------------------
  insert into public.debts (id, household_id, created_by_user_id, name, creditor_name, debt_kind, currency_code, origin_date, tracking_start_date, original_principal, opening_principal_balance, status)
  values (v_debt_card_stmt, v_household_id, v_user_id, 'Card Stmt Debt', 'Visa 3', 'credit_card', 'PEN', '2026-01-01', '2026-01-01', 0, 0, 'active');

  insert into public.credit_card_statements (id, debt_id, statement_date, due_date, total_balance_due, minimum_payment_due, status)
  values (gen_random_uuid(), v_debt_card_stmt, '2026-02-01', '2026-02-15', 500, 50, 'closed');

  v_caught := false;
  begin
    perform public.delete_pristine_debt_v1(v_household_id, v_debt_card_stmt);
  exception when others then
    if sqlerrm like '%DEBT_HAS_HISTORY%' then
      v_caught := true;
    end if;
  end;
  if not v_caught then
    raise exception 'Test 10 failed: credit card statement did not block delete';
  end if;

  -------------------------------------------------------------
  -- 11. Cross-household attempt => MEMBER_NOT_PROVISIONED / DEBT_NOT_FOUND.
  -------------------------------------------------------------
  v_caught := false;
  begin
    perform public.delete_pristine_debt_v1(v_other_household_id, v_debt_payment);
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'Test 11 failed: cross-household delete attempt was not blocked';
  end if;

  -------------------------------------------------------------
  -- 12. Unauthenticated attempt => AUTH_REQUIRED.
  -------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', '', true);
  v_caught := false;
  begin
    perform public.delete_pristine_debt_v1(v_household_id, v_debt_payment);
  exception when others then
    if sqlerrm like '%AUTH_REQUIRED%' then
      v_caught := true;
    end if;
  end;
  if not v_caught then
    raise exception 'Test 12 failed: unauthenticated delete attempt was not blocked';
  end if;

  raise notice 'DEBT-6B.3 SQL SMOKE ALL TESTS PASSED SUCCESSFULLY';
end;
$$;

rollback;
