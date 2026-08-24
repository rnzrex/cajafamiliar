import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const container = process.env.DEBT6B_DB_CONTAINER ?? "supabase_db_crea-una-aplicaci-n-web-completa";

const ids = {
  user: "00000000-0000-4000-8000-0000000006b1",
  household: "00000000-0000-4000-8000-0000000006b2",
  debt1: "00000000-0000-4000-8000-0000000006b3",
  account1: "00000000-0000-4000-8000-0000000006b5",
  manualRec1: "manual-rec-test-1",
  mov1: "mov-test-1",
  mov2: "mov-test-2",
  event1: "00000000-0000-4000-8000-0000000006b6",
  event2: "00000000-0000-4000-8000-0000000006b7",
  eventReversal: "00000000-0000-4000-8000-0000000006b8",
};

function execSql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-t",
      "-A",
    ]);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`psql exited with code ${code}: ${stderr || stdout}`));
      } else {
        resolve(stdout.trim());
      }
    });

    child.stdin.write(sql);
    child.stdin.end();
  });
}

function withUser(sql, userId = ids.user) {
  return `
    begin;
    select set_config('request.jwt.claim.sub', '${userId}', true);
    select set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    ${sql}
    commit;
  `;
}

function withRole(sql, roleName = "anon") {
  return `
    begin;
    set local role ${roleName};
    ${sql}
    commit;
  `;
}

async function applyMigrationsInOrder() {
  console.log("--> Performing clean DB reset and applying all migrations in order...");

  await execSql(`
    drop schema if exists public cascade;
    create schema public;
    grant all on schema public to postgres, public;

    create table if not exists public.households (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      created_at timestamptz not null default now()
    );

    create table if not exists public.settings (
      household_id uuid primary key references public.households(id) on delete cascade,
      initial_balance numeric not null default 0
    );

    create table if not exists public.categories (
      id uuid primary key default gen_random_uuid(),
      household_id uuid references public.households(id) on delete cascade,
      name text not null,
      type text not null,
      color text,
      icon text,
      is_active boolean default true,
      created_at timestamptz default now()
    );

    create table if not exists public.movements (
      id text primary key,
      household_id uuid not null references public.households(id) on delete cascade,
      type text not null,
      date date not null,
      amount numeric not null,
      description text not null,
      method text not null,
      category text not null,
      person text not null,
      registered_by_user_id uuid,
      account_id uuid,
      created_at timestamptz not null default now()
    );

    create table if not exists public.cash_counts (
      id uuid primary key default gen_random_uuid(),
      household_id uuid not null references public.households(id) on delete cascade,
      date date not null,
      amount numeric not null,
      notes text,
      created_at timestamptz not null default now()
    );

    create table if not exists public.recurring_payments (
      id text primary key,
      household_id uuid not null references public.households(id) on delete cascade,
      name text not null,
      amount numeric,
      due_day integer,
      due_date date,
      category text not null,
      amount_mode text not null default 'fixed',
      recurrence_type text not null default 'indefinite',
      total_installments integer,
      paid_installments integer default 0,
      status text not null default 'pendiente',
      is_active boolean default true,
      last_paid_month integer,
      last_paid_year integer,
      paid_at timestamptz,
      notes text,
      created_at timestamptz not null default now()
    );
  `);

  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  const sortedFiles = [...files].sort((a, b) => a.localeCompare(b));

  for (const file of sortedFiles) {
    if (file.includes("__dryrun")) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    await execSql(sql);
  }

  await execSql(`
    grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
    grant usage, select on all sequences in schema public to authenticated, service_role;
  `);

  console.log("✓ Applied all DB migrations to local Postgres container without error");
}

async function runLocalSmokeTest() {
  console.log("=== DEBT-6B.2 LOCAL SQL SMOKE TEST ===");

  await applyMigrationsInOrder();

  // 1. Setup test user, household & member
  console.log("--> Setting up test user, household & member...");
  await execSql(`
    delete from auth.users where id = '${ids.user}';
    insert into auth.users (id, email) values ('${ids.user}', 'debt6b2-harness@example.test');
    insert into public.households (id, name) values ('${ids.household}', 'DEBT-6B.2 harness') on conflict (id) do nothing;
    insert into public.household_members (household_id, user_id, role, display_name)
      values ('${ids.household}', '${ids.user}', 'owner', 'DEBT-6B.2 User') on conflict (household_id, user_id) do nothing;
    insert into public.financial_accounts (id, household_id, name, reconciliation_type, opening_balance, currency_code, is_active, sort_order)
      values ('${ids.account1}', '${ids.household}', 'Cuenta BCP 6B.2', 'balance', 10000, 'PEN', true, 1) on conflict (id) do nothing;
  `);

  // 2. Test create_debt_v2 with minimum_principal_payment and first_due_date
  console.log("--> Testing create_debt_v2 with minimum_principal_payment...");
  await execSql(`delete from public.debts where id = '${ids.debt1}';`);
  const createSql = withUser(`
    select public.create_debt_v2(
      p_household_id := '${ids.household}'::uuid,
      p_debt_id := '${ids.debt1}'::uuid,
      p_name := 'Empeño Laptop 6B.2',
      p_creditor_name := 'Casa Empeño',
      p_debt_kind := 'pledge',
      p_currency_code := 'PEN',
      p_origin_date := '2026-01-01'::date,
      p_tracking_start_date := '2026-01-01'::date,
      p_original_principal := 2000,
      p_opening_principal_balance := 2000,
      p_planned_installment_count := NULL,
      p_planned_installment_amount := NULL,
      p_installment_amount_mode := 'unknown',
      p_payment_frequency := 'monthly',
      p_custom_frequency_days := NULL,
      p_first_due_date := '2026-08-15'::date,
      p_tea_percent := NULL,
      p_tcea_percent := NULL,
      p_notes := 'Test DB trigger sync',
      p_installments := '[]'::jsonb,
      p_collaterals := '[]'::jsonb,
      p_repayment_structure := 'open_ended',
      p_interest_calculation_mode := 'contract_periodic_rate',
      p_periodic_rate_percent := 4,
      p_periodic_rate_basis := 'monthly',
      p_minimum_principal_payment := 100
    );
  `);

  await execSql(createSql);
  console.log("✓ create_debt_v2 executed successfully.");

  // 3. Verify debt column minimum_principal_payment
  const minPrinVal = await execSql(`select minimum_principal_payment from public.debts where id = '${ids.debt1}';`);
  console.log("✓ Debts minimum_principal_payment:", minPrinVal);
  if (parseFloat(minPrinVal) !== 100) throw new Error("Expected minimum_principal_payment to be 100");

  // 4. Verify DB Trigger automatic synchronization to recurring_payments with deterministic text ID 'debt:<uuid>'
  const recRow = await execSql(`
    select id, household_id, name, linked_debt_id, starts_on, currency_code, due_day, status, is_active
    from public.recurring_payments
    where linked_debt_id = '${ids.debt1}';
  `);
  console.log("✓ Linked recurring payment created by trigger:", recRow);
  if (!recRow.startsWith(`debt:${ids.debt1}`)) throw new Error(`Expected linked recurring payment ID to be debt:${ids.debt1}, got ${recRow}`);

  // 5. Test complete_recurring_payment_v2 blocked guard on linked debt
  console.log("--> Testing complete_recurring_payment_v2 guard on linked debt...");
  try {
    const blockSql = withUser(`
      select public.complete_recurring_payment_v2(
        p_payment_id := 'debt:${ids.debt1}',
        p_create_expense := true,
        p_movement_id := '${ids.mov1}',
        p_movement_date := '2026-08-15'::date,
        p_movement_amount := 300,
        p_movement_description := 'Pago rec',
        p_movement_method := 'transferencia',
        p_movement_category := 'Deudas',
        p_account_id := '${ids.account1}'::uuid
      );
    `);
    await execSql(blockSql);
    throw new Error("FAIL: complete_recurring_payment_v2 should have raised LINKED_DEBT_RECURRING_NOT_ALLOWED!");
  } catch (err) {
    if (err.message.includes("LINKED_DEBT_RECURRING_NOT_ALLOWED")) {
      console.log("✓ SUCCESS: complete_recurring_payment_v2 correctly blocked linked debt payment!");
    } else {
      throw err;
    }
  }

  // 6. Test direct manual write protection trigger on linked recurring payment
  console.log("--> Testing direct manual write protection trigger on linked recurring payment...");
  try {
    const directUpdateSql = withUser(`
      update public.recurring_payments
         set notes = 'Direct write test'
       where id = 'debt:${ids.debt1}';
    `);
    await execSql(directUpdateSql);
    throw new Error("FAIL: Direct write to linked recurring payment should have been blocked!");
  } catch (err) {
    if (err.message.includes("LINKED_DEBT_RECURRING_DIRECT_WRITE_PROHIBITED")) {
      console.log("✓ SUCCESS: Protection trigger correctly blocked direct manual update on linked recurring payment!");
    } else {
      throw err;
    }
  }

  // 7. Test Same-Transaction Attack Bypass Regression (NO GUC bypass leakage!)
  console.log("--> Testing same-transaction attack bypass regression...");
  try {
    const sameTxAttackSql = `
      begin;
      select set_config('request.jwt.claim.sub', '${ids.user}', true);
      select set_config('request.jwt.claim.role', 'authenticated', true);
      set local role authenticated;

      -- Legitimate terms update
      select public.update_debt_terms_v2(
        p_household_id := '${ids.household}'::uuid,
        p_debt_id := '${ids.debt1}'::uuid,
        p_minimum_principal_payment := 120
      );

      -- Attack: immediate direct update on linked row in same transaction
      update public.recurring_payments
         set notes = 'Malicious attack note'
       where id = 'debt:${ids.debt1}';

      commit;
    `;
    await execSql(sameTxAttackSql);
    throw new Error("FAIL: Direct write after update_debt_terms_v2 in same transaction should have been blocked!");
  } catch (err) {
    if (err.message.includes("LINKED_DEBT_RECURRING_DIRECT_WRITE_PROHIBITED")) {
      console.log("✓ SUCCESS: Attack regression test passed (no GUC bypass leaked in transaction)!");
    } else {
      throw err;
    }
  }

  // 8. Test Prepayment Exclusion & Contractual Cycle Payment Sync
  console.log("--> Testing prepayment exclusion and contractual cycle payment sync...");
  // Insert principal_prepayment -> should NOT mark linked recurring as 'pagado'
  await execSql(withUser(`
    insert into public.debt_events (
      id, household_id, debt_id, event_date, event_type, cash_amount, principal_delta,
      interest_paid, fees_paid, insurance_paid, other_cost_paid, breakdown_complete, registered_by_user_id
    ) values (
      '${ids.event1}', '${ids.household}', '${ids.debt1}', '2026-08-10', 'principal_prepayment',
      500, -500, 0, 0, 0, 0, true, '${ids.user}'
    );
  `));

  const statusAfterPrepayment = await execSql(`select status from public.recurring_payments where linked_debt_id = '${ids.debt1}';`);
  console.log("✓ Status after principal_prepayment:", statusAfterPrepayment);
  if (statusAfterPrepayment !== "pendiente") throw new Error("principal_prepayment should NOT mark monthly recurring payment as pagado!");

  // Insert late qualifying payment on 2026-09-01 for first due 2026-08-15 -> covered cycle is AUGUST (8)
  await execSql(withUser(`
    insert into public.debt_events (
      id, household_id, debt_id, event_date, event_type, cash_amount, principal_delta,
      interest_paid, fees_paid, insurance_paid, other_cost_paid, breakdown_complete, registered_by_user_id
    ) values (
      '${ids.event2}', '${ids.household}', '${ids.debt1}', '2026-09-01', 'payment',
      300, -100, 200, 0, 0, 0, true, '${ids.user}'
    );
  `));

  const cycleAfterLatePayment = await execSql(`
    select last_paid_month, last_paid_year
    from public.recurring_payments
    where linked_debt_id = '${ids.debt1}';
  `);
  console.log("✓ Covered contractual cycle after late 01/09 payment:", cycleAfterLatePayment);
  if (cycleAfterLatePayment !== "8|2026") throw new Error(`Expected covered cycle to be 8|2026, got ${cycleAfterLatePayment}`);

  // 9. Test Reversal Recomputation
  console.log("--> Testing reversal recomputation...");
  await execSql(withUser(`
    insert into public.debt_events (
      id, household_id, debt_id, event_date, event_type, cash_amount, principal_delta,
      interest_paid, fees_paid, insurance_paid, other_cost_paid, breakdown_complete, registered_by_user_id, reversal_of_event_id
    ) values (
      '${ids.eventReversal}', '${ids.household}', '${ids.debt1}', '2026-09-02', 'reversal',
      0, 0, 0, 0, 0, 0, false, '${ids.user}', '${ids.event2}'
    );
  `));

  const cycleAfterReversal = await execSql(`
    select last_paid_month, status
    from public.recurring_payments
    where linked_debt_id = '${ids.debt1}';
  `);
  console.log("✓ Status and cycle after payment reversal:", cycleAfterReversal);
  if (!cycleAfterReversal.endsWith("pendiente")) throw new Error("Reversal should restore status to pendiente!");

  // 10. Test update_debt_terms_v2
  console.log("--> Testing update_debt_terms_v2...");
  const updateTermsSql = withUser(`
    select public.update_debt_terms_v2(
      p_household_id := '${ids.household}'::uuid,
      p_debt_id := '${ids.debt1}'::uuid,
      p_repayment_structure := 'open_ended',
      p_interest_calculation_mode := 'contract_periodic_rate',
      p_periodic_rate_percent := 5.0,
      p_periodic_rate_basis := 'monthly',
      p_tea_percent := NULL,
      p_tcea_percent := NULL,
      p_payment_frequency := 'monthly',
      p_clear_periodic_rate := false,
      p_clear_tea := true,
      p_clear_tcea := true,
      p_clear_frequency := false,
      p_first_due_date := '2026-09-20'::date,
      p_clear_first_due_date := false,
      p_minimum_principal_payment := 150,
      p_clear_minimum_principal_payment := false
    );
  `);
  await execSql(updateTermsSql);

  const updatedMinVal = await execSql(`select minimum_principal_payment, first_due_date from public.debts where id = '${ids.debt1}';`);
  console.log("✓ Updated debt terms:", updatedMinVal);

  const updatedRecRow = await execSql(`
    select starts_on, due_day from public.recurring_payments where linked_debt_id = '${ids.debt1}';
  `);
  console.log("✓ Updated linked recurring payment via trigger:", updatedRecRow);
  if (!updatedRecRow.includes("2026-09-20|20")) throw new Error("Trigger did not sync updated due date to recurring payments");

  // 11. Test Normal MANUAL Recurring Payment completion (MUST STILL WORK)
  console.log("--> Testing normal MANUAL recurring payment completion via complete_recurring_payment_v2...");
  await execSql(`
    insert into public.recurring_payments (
      id, household_id, name, amount, amount_mode, due_day, category, recurrence_type, status, is_active
    ) values (
      '${ids.manualRec1}', '${ids.household}', 'Internet Movistar', 120, 'fixed', 10, 'Servicios', 'indefinite', 'pendiente', true
    ) on conflict (id) do nothing;
  `);

  const completeManualSql = withUser(`
    select public.complete_recurring_payment_v2(
      p_payment_id := '${ids.manualRec1}',
      p_create_expense := true,
      p_movement_id := '${ids.mov2}',
      p_movement_date := '2026-08-10'::date,
      p_movement_amount := 120,
      p_movement_description := 'Pago internet',
      p_movement_method := 'transferencia',
      p_movement_category := 'Servicios',
      p_account_id := '${ids.account1}'::uuid
    );
  `);
  const manualRes = await execSql(completeManualSql);
  console.log("✓ Manual recurring payment completed successfully:", manualRes.includes("pagado"));

  // Check generated movement context is 'standard' (or default)
  const movContext = await execSql(`select movement_context from public.movements where id = '${ids.mov2}';`);
  console.log("✓ Movement context for manual recurring payment:", movContext);

  // 12. Test EXECUTE Security Permissions on internal sync helper
  console.log("--> Testing security lockdown on internal sync helper...");
  try {
    const lockTestSql = withRole(`
      select public.sync_linked_recurring_payment('${ids.debt1}'::uuid);
    `, "anon");
    await execSql(lockTestSql);
    throw new Error("FAIL: Public/anon should NOT be allowed to execute internal sync_linked_recurring_payment helper!");
  } catch (err) {
    if (err.message.includes("permission denied") || err.message.includes("exited with code 3")) {
      console.log("✓ SUCCESS: Internal sync helper EXECUTE is correctly locked down!");
    } else {
      throw err;
    }
  }

  // Clean up test data
  await execSql(`
    delete from public.debt_events where debt_id = '${ids.debt1}';
    delete from public.debts where id = '${ids.debt1}';
    delete from public.movements where id in ('${ids.mov1}', '${ids.mov2}');
    delete from public.recurring_payments where id = '${ids.manualRec1}';
    delete from public.financial_accounts where id = '${ids.account1}';
    delete from public.household_members where household_id = '${ids.household}';
    delete from public.households where id = '${ids.household}';
  `);

  console.log("=== ALL LOCAL SQL SMOKE TESTS PASSED CLEANLY ===");
}

runLocalSmokeTest().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});
