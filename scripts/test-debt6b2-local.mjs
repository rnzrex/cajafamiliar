import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const container = process.env.DEBT6B_DB_CONTAINER ?? "supabase_db_crea-una-aplicaci-n-web-completa";

const ids = {
  user: "00000000-0000-4000-8000-0000000006b1",
  household: "00000000-0000-4000-8000-0000000006b2",
  debt1: "00000000-0000-4000-8000-0000000006b3",
  account1: "00000000-0000-4000-8000-0000000006b5",
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
    ${sql}
    commit;
  `;
}

async function runLocalSmokeTest() {
  console.log("=== DEBT-6B.2 LOCAL SQL SMOKE TEST ===");

  // Apply DEBT-6B.2 migration file
  const migrationFile = join(process.cwd(), "supabase", "migrations", "20260824040000_debt6b2_next_payment_recurring.sql");
  const migrationSql = readFileSync(migrationFile, "utf8");
  try {
    await execSql(migrationSql);
    console.log("✓ Applied 20260824040000_debt6b2_next_payment_recurring.sql");
  } catch (err) {
    console.log("Migration notice/result:", err.message);
  }

  // Find existing household or create one
  const existingHousehold = await execSql(`select id from public.households limit 1;`);
  const householdId = existingHousehold || ids.household;

  if (!existingHousehold) {
    await execSql(`insert into public.households (id, name) values ('${ids.household}', 'DEBT-6B.2 harness');`);
  }

  const existingMember = await execSql(`select user_id from public.household_members where household_id = '${householdId}' limit 1;`);
  const userId = existingMember || ids.user;

  if (!existingMember) {
    await execSql(`insert into public.household_members (household_id, user_id, role, display_name) values ('${householdId}', '${userId}', 'owner', 'DEBT-6B.2 User');`);
  }

  // 2. Test create_debt_v2 with minimum_principal_payment and first_due_date
  console.log("Testing create_debt_v2 with minimum_principal_payment...");
  await execSql(`delete from public.debts where id = '${ids.debt1}';`);
  const createSql = withUser(`
    select public.create_debt_v2(
      p_household_id := '${householdId}'::uuid,
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
  `, userId);

  const createRes = await execSql(createSql);
  console.log("✓ create_debt_v2 executed successfully.");

  // 3. Verify debt column minimum_principal_payment
  const minPrinVal = await execSql(`select minimum_principal_payment from public.debts where id = '${ids.debt1}';`);
  console.log("✓ Debts minimum_principal_payment:", minPrinVal);
  if (parseFloat(minPrinVal) !== 100) throw new Error("Expected minimum_principal_payment to be 100");

  // 4. Verify DB Trigger automatic synchronization to recurring_payments
  const recId = await execSql(`
    select id
    from public.recurring_payments
    where linked_debt_id = '${ids.debt1}';
  `);
  console.log("✓ Linked recurring payment ID created by trigger:", recId);
  if (!recId) throw new Error("Expected linked recurring payment to be created by trigger");

  // 5. Test complete_recurring_payment_v2 blocked guard on linked debt
  console.log("Testing complete_recurring_payment_v2 guard on linked debt...");
  try {
    const blockSql = withUser(`
      select public.complete_recurring_payment_v2(
        p_payment_id := '${recId}',
        p_create_expense := true,
        p_movement_id := 'mov-test-1',
        p_movement_date := '2026-08-15'::date,
        p_movement_amount := 300,
        p_movement_description := 'Pago rec',
        p_movement_method := 'efectivo',
        p_movement_category := 'Deudas',
        p_account_id := '${ids.account1}'::uuid
      );
    `, userId);
    await execSql(blockSql);
    throw new Error("FAIL: complete_recurring_payment_v2 should have raised LINKED_DEBT_RECURRING_NOT_ALLOWED!");
  } catch (err) {
    if (err.message.includes("LINKED_DEBT_RECURRING_NOT_ALLOWED") || err.message.includes("No se permite completar")) {
      console.log("✓ SUCCESS: complete_recurring_payment_v2 correctly blocked linked debt payment!");
    } else {
      throw err;
    }
  }

  // 6. Test update_debt_terms_v2
  console.log("Testing update_debt_terms_v2...");
  const updateTermsSql = withUser(`
    select public.update_debt_terms_v2(
      p_household_id := '${householdId}'::uuid,
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
  `, userId);
  await execSql(updateTermsSql);

  const updatedMinVal = await execSql(`select minimum_principal_payment, first_due_date from public.debts where id = '${ids.debt1}';`);
  console.log("✓ Updated debt terms:", updatedMinVal);

  const updatedRecRow = await execSql(`
    select starts_on, due_day from public.recurring_payments where linked_debt_id = '${ids.debt1}';
  `);
  console.log("✓ Updated linked recurring payment via trigger:", updatedRecRow);
  if (!updatedRecRow.includes("2026-09-20|20")) throw new Error("Trigger did not sync updated due date to recurring payments");

  // Clean up test debt
  await execSql(`delete from public.debts where id = '${ids.debt1}';`);

  console.log("=== ALL LOCAL SQL SMOKE TESTS PASSED ===");
}

runLocalSmokeTest().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});
