import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = process.env.DEBT6B_DB_CONTAINER ?? "supabase_db_crea-una-aplicaci-n-web-completa";

const ids = {
  user: "00000000-0000-4000-8000-0000000006b1",
  household: "00000000-0000-4000-8000-0000000006b2",
  debt: "00000000-0000-4000-8000-0000000006b3",
};

async function execSql(sql) {
  const { stdout, stderr } = await execFileAsync("docker", [
    "exec",
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
    "-c",
    sql,
  ]);

  if (stderr && stderr.trim().length > 0 && !stderr.includes("NOTICE")) {
    console.warn("psql stderr:", stderr);
  }
  return stdout.trim();
}

function withUser(sql, userId = ids.user) {
  return `
    select set_config('request.jwt.claim.sub', '${userId}', true);
    select set_config('request.jwt.claim.role', 'authenticated', true);
    ${sql}
  `;
}

async function runSmokeTest() {
  console.log("--- Running DEBT-6B SQL Smoke Harness ---");

  try {
    // 1. Cleanup harness data
    await execSql(`
      delete from public.debt_collaterals where household_id = '${ids.household}';
      delete from public.debts where household_id = '${ids.household}';
      delete from public.household_members where household_id = '${ids.household}';
      delete from public.households where id = '${ids.household}';
      delete from auth.users where id = '${ids.user}';

      insert into auth.users (id, email) values ('${ids.user}', 'debt6b-harness@example.test');
      insert into public.households (id, name) values ('${ids.household}', 'DEBT-6B harness');
      insert into public.household_members (household_id, user_id, role, display_name)
        values ('${ids.household}', '${ids.user}', 'owner', 'DEBT-6B User');
    `);
    console.log("✓ Test environment initialized");

    // 2. Test create_debt_v1 with open_ended and contract_periodic_rate
    const createResultJson = await execSql(withUser(`
      select public.create_debt_v1(
        '${ids.household}', '${ids.debt}', 'Empeño Laptop Lenovo', 'Casa de Empeño',
        'pledge', 'PEN', '2026-01-01', '2026-01-01', 5000, 5000,
        null, null, 'unknown', null, null, null,
        null, 72.4, 'Laptop Lenovo i7', '[]'::jsonb, '[]'::jsonb,
        'open_ended', 'contract_periodic_rate', 4.0, 'monthly'
      );
    `));
    const rawJsonStr = createResultJson.split("\n").map(s => s.trim()).filter(Boolean).pop();
    const parsedCreate = JSON.parse(rawJsonStr);
    if (parsedCreate.debt.repayment_structure !== "open_ended") {
      throw new Error("create_debt_v1 failed to store open_ended repayment_structure");
    }
    if (parsedCreate.debt.interest_calculation_mode !== "contract_periodic_rate") {
      throw new Error("create_debt_v1 failed to store contract_periodic_rate interest_calculation_mode");
    }
    console.log("✓ create_debt_v1 successfully created open-ended debt with flexible interest terms");

    // 3. Test update_debt_terms_v1 RPC
    const updateResultJson = await execSql(withUser(`
      select public.update_debt_terms_v1(
        '${ids.household}', '${ids.debt}',
        'open_ended', 'tea_estimate', null, null,
        60.1, 72.4, null, null
      );
    `));
    const rawUpdateStr = updateResultJson.split("\n").map(s => s.trim()).filter(Boolean).pop();
    const parsedUpdate = JSON.parse(rawUpdateStr);
    if (parsedUpdate.interest_calculation_mode !== "tea_estimate" || Number(parsedUpdate.tea_percent) !== 60.1) {
      throw new Error("update_debt_terms_v1 failed to update interest_calculation_mode and tea_percent");
    }
    console.log("✓ update_debt_terms_v1 successfully updated terms");

    // 4. Test check constraints (reject invalid repayment_structure)
    let rejected = false;
    try {
      await execSql(withUser(`
        select public.update_debt_terms_v1(
          '${ids.household}', '${ids.debt}',
          'invalid_structure', null, null, null, null, null, null, null
        );
      `));
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error("update_debt_terms_v1 allowed invalid repayment_structure!");
    }
    console.log("✓ Invalid repayment_structure correctly rejected by domain check constraint");

    console.log("--- DEBT-6B SQL Smoke Test Completed Successfully ---");
  } catch (err) {
    console.error("❌ SQL Smoke Test Failed:", err);
    process.exit(1);
  }
}

runSmokeTest();
