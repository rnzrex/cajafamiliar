import { createClient } from "@supabase/supabase-js";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";
const LOCAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

function makeUuid() {
  return "00000000-0000-4000-8000-" + Math.random().toString(16).substring(2, 14).padStart(12, "0");
}

function log(msg) {
  console.log(`[RECON-1A LOCAL SMOKE] ${msg}`);
}

function assert(condition, msg, errDetail = null) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`, errDetail ? JSON.stringify(errDetail) : "");
    throw new Error(`Assertion failed: ${msg} ${errDetail ? JSON.stringify(errDetail) : ""}`);
  }
  console.log(`[PASS] ${msg}`);
}

function applySqlFile(filePath) {
  const sql = fs.readFileSync(filePath, "utf8");
  execSync(`docker exec -i supabase_db_crea-una-aplicaci-n-web-completa psql -U postgres -d postgres`, {
    cwd: projectRoot,
    input: sql,
    stdio: ["pipe", "ignore", "inherit"],
  });
}

async function runLocalSmoke() {
  // 1. LOCAL-SAFETY GUARD
  const targetUrl = new URL(LOCAL_SUPABASE_URL);
  if (targetUrl.hostname !== "127.0.0.1" && targetUrl.hostname !== "localhost") {
    console.error(`ABORT: Target hostname ${targetUrl.hostname} is NOT local!`);
    process.exit(1);
  }

  log(`LOCAL DATABASE CONFIRMED: ${targetUrl.hostname}:${targetUrl.port}`);

  log("Resetting local Postgres public schema for clean reproducible test execution...");
  execSync(
    `docker exec -i supabase_db_crea-una-aplicaci-n-web-completa psql -U postgres -d postgres -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;"`,
    { cwd: projectRoot, stdio: "ignore" }
  );

  // 2. REPRODUCIBLE LOCAL BOOTSTRAP
  log("Applying legacy_bootstrap.sql fixture...");
  applySqlFile(path.join(projectRoot, "supabase", "test-fixtures", "legacy_bootstrap.sql"));

  log("Applying all REAL repository migrations in timestamp order...");
  const migrationsDir = path.join(projectRoot, "supabase", "migrations");
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    log(`Applying migration: ${file}`);
    applySqlFile(path.join(migrationsDir, file));
  }

  log("Granting baseline schema privileges to service_role and postgres...");
  execSync(
    `docker exec -i supabase_db_crea-una-aplicaci-n-web-completa psql -U postgres -d postgres -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres, service_role; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role; NOTIFY pgrst, 'reload schema';"`,
    { cwd: projectRoot, stdio: "ignore" }
  );

  const adminClient = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const anonClient = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  });

  // 3. AUTH & HOUSEHOLD SETUP
  const testEmail = `test.recon.${Date.now()}@local.test`;
  const testPassword = "LocalTestPassword123!";

  log(`Creating disposable auth user ${testEmail}...`);
  const { data: userData, error: userErr } = await adminClient.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  });

  assert(!userErr && userData?.user, "Auth user created in local Supabase", userErr);
  const userId = userData.user.id;

  const householdId = makeUuid();
  log(`Creating test household ${householdId}...`);
  const { error: hhErr } = await adminClient.from("households").insert({
    id: householdId,
    name: "Hogar Recon Test",
  });
  assert(!hhErr, "Household inserted", hhErr);

  const { error: memberErr } = await adminClient.from("household_members").insert({
    household_id: householdId,
    user_id: userId,
    display_name: "Recon Tester",
    role: "owner",
  });
  assert(!memberErr, "Household member attached", memberErr);

  // Sign in as authenticated user
  const { data: sessionData, error: signInErr } = await anonClient.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });
  assert(!signInErr && sessionData?.session, "User signed in to client", signInErr);

  const authClient = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
    global: {
      headers: {
        Authorization: `Bearer ${sessionData.session.access_token}`,
      },
    },
  });

  // Create second auth user OUTSIDE household
  const outsiderEmail = `outsider.recon.${Date.now()}@local.test`;
  const { data: outsiderData, error: outsiderErr } = await adminClient.auth.admin.createUser({
    email: outsiderEmail,
    password: testPassword,
    email_confirm: true,
  });
  assert(!outsiderErr && outsiderData?.user, "Outsider user created");

  const { data: outsiderSession } = await anonClient.auth.signInWithPassword({
    email: outsiderEmail,
    password: testPassword,
  });
  const outsiderClient = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
    global: {
      headers: {
        Authorization: `Bearer ${outsiderSession.session.access_token}`,
      },
    },
  });

  // 4. CREATE ACCOUNTS AND MOVEMENTS
  const balanceAccountId = makeUuid();

  log("Creating balance account and cash account...");
  const { error: acc1Err } = await adminClient.from("financial_accounts").insert({
    id: balanceAccountId,
    household_id: householdId,
    name: "Cuenta BCP Test",
    reconciliation_type: "balance",
    opening_balance: 1000,
    currency_code: "PEN",
    is_active: true,
    sort_order: 1,
  });
  assert(!acc1Err, "Balance account created", acc1Err);

  let cashAccountId;
  const { data: existingCash } = await adminClient
    .from("financial_accounts")
    .select("*")
    .eq("household_id", householdId)
    .eq("reconciliation_type", "cash")
    .eq("is_active", true)
    .maybeSingle();

  if (existingCash) {
    cashAccountId = existingCash.id;
    const { error: updateCashErr } = await adminClient
      .from("financial_accounts")
      .update({ name: "Caja Principal Test", opening_balance: 500 })
      .eq("id", cashAccountId);
    assert(!updateCashErr, "Cash account updated", updateCashErr);
  } else {
    cashAccountId = makeUuid();
    const { error: accCashErr } = await adminClient.from("financial_accounts").insert({
      id: cashAccountId,
      household_id: householdId,
      name: "Caja Principal Test",
      reconciliation_type: "cash",
      opening_balance: 500,
      currency_code: "PEN",
      is_active: true,
      sort_order: 2,
    });
    assert(!accCashErr, "Cash account created", accCashErr);
  }

  const mov1Id = makeUuid();
  const mov2Id = makeUuid();
  const movCashId = makeUuid();

  log("Inserting test movements...");
  const { error: m1Err } = await adminClient.from("movements").insert({
    id: mov1Id,
    household_id: householdId,
    type: "ingreso",
    date: "2026-08-20",
    amount: 200,
    description: "Depósito salario",
    method: "transferencia",
    category: "Otros",
    person: "Recon Tester",
    account_id: balanceAccountId,
    movement_context: "standard",
  });
  assert(!m1Err, "Movement 1 inserted", m1Err);

  const { error: m2Err } = await adminClient.from("movements").insert({
    id: mov2Id,
    household_id: householdId,
    type: "egreso",
    date: "2026-08-21",
    amount: 50,
    description: "Pago servicio",
    method: "transferencia",
    category: "Luz",
    person: "Recon Tester",
    account_id: balanceAccountId,
    movement_context: "standard",
  });
  assert(!m2Err, "Movement 2 inserted", m2Err);

  const { error: mCashErr } = await adminClient.from("movements").insert({
    id: movCashId,
    household_id: householdId,
    type: "ingreso",
    date: "2026-08-22",
    amount: 100,
    description: "Venta contado",
    method: "efectivo",
    category: "Negocio",
    person: "Recon Tester",
    account_id: cashAccountId,
    movement_context: "standard",
  });
  assert(!mCashErr, "Cash movement inserted", mCashErr);

  // 5. TEST EXPLICIT RPC SECURITY DENIALS
  log("Testing explicit RPC security revokes (anon, service_role, non-member)...");
  const dummyRecId = makeUuid();
  const { error: anonRpcErr } = await anonClient.rpc("record_account_reconciliation_v1", {
    p_household_id: householdId,
    p_reconciliation_id: dummyRecId,
    p_account_id: balanceAccountId,
    p_actual_balance: 1150,
    p_denominations: null,
  });
  assert(Boolean(anonRpcErr), "RPC call by anon denied as expected");

  const { error: serviceRoleRpcErr } = await adminClient.rpc("record_account_reconciliation_v1", {
    p_household_id: householdId,
    p_reconciliation_id: dummyRecId,
    p_account_id: balanceAccountId,
    p_actual_balance: 1150,
    p_denominations: null,
  });
  assert(Boolean(serviceRoleRpcErr), "RPC call by service_role denied as expected");

  const { error: outsiderRpcErr } = await outsiderClient.rpc("record_account_reconciliation_v1", {
    p_household_id: householdId,
    p_reconciliation_id: dummyRecId,
    p_account_id: balanceAccountId,
    p_actual_balance: 1150,
    p_denominations: null,
  });
  assert(Boolean(outsiderRpcErr), "RPC call by non-member user denied as expected");

  // 6. TEST RPC FOR BALANCE ACCOUNT (MATCHED)
  // Expected balance: 1000 (opening) + 200 (ingreso) - 50 (egreso) = 1150
  const rec1Id = makeUuid();
  log("Testing record_account_reconciliation_v1 for balance account (matched)...");

  const { data: rec1Res, error: rec1Err } = await authClient.rpc("record_account_reconciliation_v1", {
    p_household_id: householdId,
    p_reconciliation_id: rec1Id,
    p_account_id: balanceAccountId,
    p_actual_balance: 1150,
    p_denominations: null,
  });

  assert(!rec1Err, "RPC balance matched call succeeded", rec1Err);
  assert(rec1Res.success === true, "RPC response success is true");
  assert(rec1Res.status === "matched", "Reconciliation status is matched");
  assert(rec1Res.expected_balance === 1150, "Expected balance is 1150");
  assert(rec1Res.actual_balance === 1150, "Actual balance is 1150");
  assert(rec1Res.movements_count === 2, "2 movements captured in membership snapshot");

  // Verify explicit snapshot movements inserted
  const { data: snapMovs, error: snapErr } = await authClient
    .from("account_reconciliation_movements")
    .select("*")
    .eq("reconciliation_id", rec1Id);

  assert(!snapErr && snapMovs.length === 2, "2 snapshot movement records present", snapErr);

  // VERIFY sum(snapshot balance_contribution) + opening_balance_snapshot == expected_balance
  const sumContrib = snapMovs.reduce((sum, rm) => sum + Number(rm.balance_contribution), 0);
  assert(
    sumContrib + rec1Res.opening_balance_snapshot === rec1Res.expected_balance,
    `sum(balance_contribution) (${sumContrib}) + opening_balance (${rec1Res.opening_balance_snapshot}) == expected_balance (${rec1Res.expected_balance})`
  );

  // 7. TEST IDEMPOTENCY WITH POST-RECONCILIATION BACKDATED MOVEMENT
  log("Testing idempotency scenario with post-reconciliation backdated movement...");
  const movBackdatedId = makeUuid();
  const { error: backdatedErr } = await adminClient.from("movements").insert({
    id: movBackdatedId,
    household_id: householdId,
    type: "ingreso",
    date: "2026-08-19", // Backdated economic date!
    amount: 500,
    description: "Ingreso antiguo registrado tarde",
    method: "transferencia",
    category: "Otros",
    person: "Recon Tester",
    account_id: balanceAccountId,
    movement_context: "standard",
  });
  assert(!backdatedErr, "Post-reconciliation backdated movement inserted", backdatedErr);

  // Retry calling RPC with exact same reconciliation_id and payload
  const { data: rec1Retry, error: rec1RetryErr } = await authClient.rpc("record_account_reconciliation_v1", {
    p_household_id: householdId,
    p_reconciliation_id: rec1Id,
    p_account_id: balanceAccountId,
    p_actual_balance: 1150,
    p_denominations: null,
  });

  assert(!rec1RetryErr, "RPC retry call succeeded", rec1RetryErr);
  assert(rec1Retry.idempotent === true, "Idempotent flag is true on retry");
  assert(rec1Retry.movements_count === 2, "Membership snapshot remains unchanged with 2 movements (backdated movement NOT retroactively added)");

  // 8. TEST RECONCILIATION_ID_CONFLICT
  log("Testing payload conflict for same reconciliation_id...");
  const { data: conflictRes, error: conflictErr } = await authClient.rpc("record_account_reconciliation_v1", {
    p_household_id: householdId,
    p_reconciliation_id: rec1Id,
    p_account_id: balanceAccountId,
    p_actual_balance: 1200, // Conflict payload!
    p_denominations: null,
  });

  assert(Boolean(conflictErr), "Conflicting payload threw error as expected");
  assert(conflictErr.message.includes("RECONCILIATION_ID_CONFLICT"), "Error message contains RECONCILIATION_ID_CONFLICT");

  // 9. TEST RPC FOR CASH ACCOUNT WITH DENOMINATIONS
  // Expected balance: 500 (opening) + 100 (ingreso) = 600
  // Denominations: {"100": 4, "50": 4} -> Total = 400 + 200 = 600
  const recCashId = makeUuid();
  log("Testing record_account_reconciliation_v1 for cash account with denominations...");

  const { data: recCashRes, error: recCashErr } = await authClient.rpc("record_account_reconciliation_v1", {
    p_household_id: householdId,
    p_reconciliation_id: recCashId,
    p_account_id: cashAccountId,
    p_actual_balance: null,
    p_denominations: { "100": 4, "50": 4 },
  });

  assert(!recCashErr, "RPC cash matched call succeeded", recCashErr);
  assert(recCashRes.status === "matched", "Cash reconciliation status is matched");
  assert(recCashRes.expected_balance === 600, "Expected cash balance calculated server side is 600");
  assert(recCashRes.actual_balance === 600, "Actual cash balance calculated server side is 600");

  // 10. TEST INVALID DENOMINATIONS ROLLBACK
  log("Testing rollback on invalid denominations...");
  const badRecId = makeUuid();
  const { error: badDenomErr } = await authClient.rpc("record_account_reconciliation_v1", {
    p_household_id: householdId,
    p_reconciliation_id: badRecId,
    p_account_id: cashAccountId,
    p_actual_balance: null,
    p_denominations: { "100": -5 }, // Invalid negative count!
  });

  assert(Boolean(badDenomErr), "Invalid denominations rejected with error");
  assert(badDenomErr.message.includes("INVALID_DENOMINATIONS"), "Error message contains INVALID_DENOMINATIONS");

  const { data: badRecRow } = await adminClient
    .from("account_reconciliations")
    .select("*")
    .eq("id", badRecId)
    .maybeSingle();

  assert(badRecRow == null, "Transaction rolled back: no reconciliation record created");

  // 11. TEST MISMATCH RECONCILIATION & MISMATCH DELETE SURVIVAL
  const recMismatchId = makeUuid();
  const mismatchAccountId = makeUuid();

  const { error: accMismatchErr } = await adminClient.from("financial_accounts").insert({
    id: mismatchAccountId,
    household_id: householdId,
    name: "Cuenta Mismatch Test",
    reconciliation_type: "balance",
    opening_balance: 500,
    currency_code: "PEN",
    is_active: true,
    sort_order: 3,
  });
  assert(!accMismatchErr, "Mismatch account created", accMismatchErr);

  const movMismatchId = makeUuid();
  const { error: mMismatchErr } = await adminClient.from("movements").insert({
    id: movMismatchId,
    household_id: householdId,
    type: "ingreso",
    date: "2026-08-22",
    amount: 100,
    description: "Ingreso test",
    method: "transferencia",
    category: "Otros",
    person: "Recon Tester",
    account_id: mismatchAccountId,
    movement_context: "standard",
  });
  assert(!mMismatchErr, "Mismatch movement inserted", mMismatchErr);

  log("Testing mismatch reconciliation...");
  const { data: mismatchRes, error: mismatchErr } = await authClient.rpc("record_account_reconciliation_v1", {
    p_household_id: householdId,
    p_reconciliation_id: recMismatchId,
    p_account_id: mismatchAccountId,
    p_actual_balance: 500, // Expected is 600, so difference = -100 -> mismatch
    p_denominations: null,
  });

  assert(!mismatchErr, "RPC mismatch call succeeded", mismatchErr);
  assert(mismatchRes.status === "mismatch", "Reconciliation status is mismatch");
  assert(mismatchRes.difference === -100, "Difference is -100");

  // TEST MISMATCH MOVEMENT EDITABLE AND DELETABLE
  log("Testing editable movement in mismatch reconciliation (movMismatchId)...");
  const { error: updateMismatchMovErr } = await authClient
    .from("movements")
    .update({ amount: 150 })
    .eq("id", movMismatchId);

  assert(!updateMismatchMovErr, "Movement in mismatch reconciliation UPDATE succeeds", updateMismatchMovErr);

  log("Testing deletion of movement in mismatch reconciliation (movMismatchId)...");
  const { error: deleteMismatchMovErr } = await authClient
    .from("movements")
    .delete()
    .eq("id", movMismatchId);

  assert(!deleteMismatchMovErr, "Movement in mismatch reconciliation DELETE succeeds", deleteMismatchMovErr);

  // VERIFY MISMATCH SNAPSHOT SURVIVES MOVEMENT DELETION
  const { data: survivedSnapshot } = await adminClient
    .from("account_reconciliation_movements")
    .select("*")
    .eq("reconciliation_id", recMismatchId)
    .eq("movement_id", movMismatchId)
    .maybeSingle();

  assert(survivedSnapshot != null, "Mismatch reconciliation movement snapshot SURVIVES movement deletion!");

  // 12. TEST MOVEMENT PROTECTION TRIGGER (MOVEMENT_RECONCILED) ON MATCHED RECONCILIATION
  log("Testing MOVEMENT_RECONCILED protection on matched movement (mov1Id)...");
  const { error: updateMov1Err } = await authClient
    .from("movements")
    .update({ amount: 300 })
    .eq("id", mov1Id);

  assert(Boolean(updateMov1Err), "Direct UPDATE of matched movement blocked as expected");
  assert(updateMov1Err.message.includes("MOVEMENT_RECONCILED"), "Error message contains MOVEMENT_RECONCILED");

  const { error: deleteMov1Err } = await authClient
    .from("movements")
    .delete()
    .eq("id", mov1Id);

  assert(Boolean(deleteMov1Err), "Direct DELETE of matched movement blocked as expected");
  assert(deleteMov1Err.message.includes("MOVEMENT_RECONCILED"), "Error message contains MOVEMENT_RECONCILED");

  // 13. TEST DIRECT WRITE PROTECTION ON BOTH NEW TABLES (RLS/GRANTS)
  log("Testing direct write protection on account_reconciliations and account_reconciliation_movements...");
  const { error: directInsertRecErr } = await authClient.from("account_reconciliations").insert({
    id: makeUuid(),
    household_id: householdId,
    account_id: balanceAccountId,
    reconciliation_type: "balance",
    currency_code: "PEN",
    opening_balance_snapshot: 1000,
    expected_balance: 1000,
    actual_balance: 1000,
    difference: 0,
    status: "matched",
    registered_by_user_id: userId,
  });

  assert(Boolean(directInsertRecErr), "Direct INSERT on account_reconciliations denied as expected");

  const { error: directInsertRecMovErr } = await authClient.from("account_reconciliation_movements").insert({
    id: makeUuid(),
    household_id: householdId,
    reconciliation_id: rec1Id,
    movement_id: "mov-dummy",
    balance_contribution: 10,
    movement_updated_at_snapshot: new Date().toISOString(),
    movement_snapshot: {},
  });

  assert(Boolean(directInsertRecMovErr), "Direct INSERT on account_reconciliation_movements denied as expected");

  const { error: directUpdateRecErr } = await authClient
    .from("account_reconciliations")
    .update({ status: "mismatch" })
    .eq("id", rec1Id);

  assert(Boolean(directUpdateRecErr), "Direct UPDATE on account_reconciliations denied as expected");

  const { error: directDeleteRecErr } = await authClient
    .from("account_reconciliations")
    .delete()
    .eq("id", rec1Id);

  assert(Boolean(directDeleteRecErr), "Direct DELETE on account_reconciliations denied as expected");

  log("ALL LOCAL SMOKE INTEGRATION TESTS PASSED CLEANLY!");
}

runLocalSmoke().catch((err) => {
  console.error("FATAL LOCAL SMOKE ERROR:", err);
  process.exit(1);
});
