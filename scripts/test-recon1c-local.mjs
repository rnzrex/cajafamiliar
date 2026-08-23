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

function log(msg) {
  console.log(`[RECON-1C LOCAL SMOKE] ${msg}`);
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
  const targetUrl = new URL(LOCAL_SUPABASE_URL);
  if (targetUrl.hostname !== "127.0.0.1" && targetUrl.hostname !== "localhost") {
    console.error(`ABORT: Target hostname ${targetUrl.hostname} is NOT local!`);
    process.exit(1);
  }

  log(`LOCAL DATABASE CONFIRMED: ${targetUrl.hostname}:${targetUrl.port}`);

  log("Resetting local Postgres public and private schemas for clean reproducible test execution...");
  execSync(
    `docker exec -i supabase_db_crea-una-aplicaci-n-web-completa psql -U postgres -d postgres -c "DROP SCHEMA IF EXISTS public, private CASCADE; CREATE SCHEMA public; CREATE SCHEMA private; GRANT ALL ON SCHEMA public TO postgres, public; GRANT ALL ON SCHEMA private TO postgres, public;"`,
    { cwd: projectRoot, stdio: "ignore" }
  );

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

  log("Granting baseline schema privileges...");
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

  // 1. Setup Auth users & Household
  const testEmail = `test.recon1c.${Date.now()}@local.test`;
  const outsiderEmail = `outsider.recon1c.${Date.now()}@local.test`;
  const testPassword = "LocalTestPassword123!";

  log(`Creating auth user ${testEmail}...`);
  const { data: userData, error: userErr } = await adminClient.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  });
  assert(!userErr && userData?.user, "Auth user created", userErr);
  const userId = userData.user.id;

  const { data: outsiderData, error: outsiderErr } = await adminClient.auth.admin.createUser({
    email: outsiderEmail,
    password: testPassword,
    email_confirm: true,
  });
  assert(!outsiderErr && outsiderData?.user, "Outsider user created", outsiderErr);
  const outsiderId = outsiderData.user.id;

  const userClient = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { error: signInErr } = await userClient.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });
  assert(!signInErr, "Authenticated user login successful", signInErr);

  const outsiderClient = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { error: outsiderSignInErr } = await outsiderClient.auth.signInWithPassword({
    email: outsiderEmail,
    password: testPassword,
  });
  assert(!outsiderSignInErr, "Outsider login successful", outsiderSignInErr);

  // Household setup
  const householdId = "00000000-0000-4000-8000-000000001c00";
  await adminClient.from("households").insert({ id: householdId, name: "Household RECON-1C" });
  await adminClient.from("household_members").insert({
    household_id: householdId,
    user_id: userId,
    role: "owner",
    display_name: "Member 1C",
  });

  // Financial account
  let accountId = "00000000-0000-4000-8000-000000001c01";
  const { data: existingCash } = await adminClient
    .from("financial_accounts")
    .select("*")
    .eq("household_id", householdId)
    .eq("reconciliation_type", "cash")
    .maybeSingle();

  if (existingCash) {
    accountId = existingCash.id;
  } else {
    const { error: accErr } = await adminClient.from("financial_accounts").insert({
      id: accountId,
      household_id: householdId,
      name: "Efectivo PEN",
      currency_code: "PEN",
      reconciliation_type: "cash",
      opening_balance: 0,
      sort_order: 1,
      is_active: true,
    });
    assert(!accErr, "Financial account created", accErr);
  }

  // Standard Movement
  const movementId = "mov-recon1c-smoke-1";
  const { data: insertedMov, error: movErr } = await adminClient
    .from("movements")
    .insert({
      id: movementId,
      household_id: householdId,
      type: "egreso",
      date: "2026-08-10",
      amount: 100.0,
      description: "Almuerzo original",
      method: "efectivo",
      category: "Comida / cenas",
      person: "Papa",
      registered_by_user_id: userId,
      account_id: accountId,
      movement_context: "standard",
    })
    .select("*")
    .single();
  assert(!movErr && insertedMov, "Standard Movement created", movErr);

  // Reconciliation
  const recId = "00000000-0000-4000-8000-000000001c02";
  await adminClient.from("account_reconciliations").insert({
    id: recId,
    household_id: householdId,
    account_id: accountId,
    reconciliation_type: "cash",
    currency_code: "PEN",
    opening_balance_snapshot: 0,
    expected_balance: 1625.10,
    actual_balance: 1625.10,
    difference: 0,
    status: "matched",
    registered_by_user_id: userId,
  });

  await adminClient.from("account_reconciliation_movements").insert({
    household_id: householdId,
    reconciliation_id: recId,
    movement_id: movementId,
    balance_contribution: -100.0,
    movement_updated_at_snapshot: insertedMov.updated_at,
    movement_snapshot: insertedMov,
  });

  // Direct UPDATE / DELETE blocked
  const { error: directUpdateErr } = await userClient
    .from("movements")
    .update({ amount: 150 })
    .eq("id", movementId);
  assert(
    directUpdateErr && directUpdateErr.message.includes("MOVEMENT_RECONCILED"),
    "Direct UPDATE on matched movement blocked with MOVEMENT_RECONCILED",
    directUpdateErr
  );

  const { error: directDeleteErr } = await userClient
    .from("movements")
    .delete()
    .eq("id", movementId);
  assert(
    directDeleteErr && directDeleteErr.message.includes("MOVEMENT_RECONCILED"),
    "Direct DELETE on matched movement blocked with MOVEMENT_RECONCILED",
    directDeleteErr
  );

  // Direct INSERT/UPDATE/DELETE on movement_corrections table denied for authenticated
  const { error: directCorrInsertErr } = await userClient
    .from("movement_corrections")
    .insert({
      household_id: householdId,
      movement_id: movementId,
      correction_id: "00000000-0000-4000-8000-000000009999",
      request_snapshot: {},
      before_snapshot: {},
      after_snapshot: {},
      reason: "Direct insert test",
      registered_by_user_id: userId,
    });
  assert(
    directCorrInsertErr !== null,
    "Direct INSERT on movement_corrections denied for authenticated user",
    directCorrInsertErr
  );

  // SECURITY MATRIX CHECKS
  // 1. Anon call denied
  const { error: anonRpcErr } = await anonClient.rpc("correct_reconciled_movement_v1", {
    p_household_id: householdId,
    p_movement_id: movementId,
    p_correction_id: "00000000-0000-4000-8000-000000000001",
    p_expected_updated_at: insertedMov.updated_at,
    p_date: "2026-08-11",
    p_amount: 120.0,
    p_description: "Anon test",
    p_method: "efectivo",
    p_category: "Comida / cenas",
    p_reason: "Anon test",
  });
  assert(anonRpcErr !== null, "Anon RPC call denied with permission error", anonRpcErr);

  // 2. Service_role call denied
  const { error: serviceRoleRpcErr } = await adminClient.rpc("correct_reconciled_movement_v1", {
    p_household_id: householdId,
    p_movement_id: movementId,
    p_correction_id: "00000000-0000-4000-8000-000000000002",
    p_expected_updated_at: insertedMov.updated_at,
    p_date: "2026-08-11",
    p_amount: 120.0,
    p_description: "Service role test",
    p_method: "efectivo",
    p_category: "Comida / cenas",
    p_reason: "Service role test",
  });
  assert(serviceRoleRpcErr !== null, "Service_role RPC call denied with permission error", serviceRoleRpcErr);

  // 3. Outside household user denied
  const { error: outsiderRpcErr } = await outsiderClient.rpc("correct_reconciled_movement_v1", {
    p_household_id: householdId,
    p_movement_id: movementId,
    p_correction_id: "00000000-0000-4000-8000-000000000003",
    p_expected_updated_at: insertedMov.updated_at,
    p_date: "2026-08-11",
    p_amount: 120.0,
    p_description: "Outsider test",
    p_method: "efectivo",
    p_category: "Comida / cenas",
    p_reason: "Outsider test",
  });
  assert(
    outsiderRpcErr && outsiderRpcErr.message.includes("NOT_HOUSEHOLD_MEMBER"),
    "Outside household user denied with NOT_HOUSEHOLD_MEMBER",
    outsiderRpcErr
  );

  // 4. Null / Missing correction ID rejected
  const { error: nullCorrErr } = await userClient.rpc("correct_reconciled_movement_v1", {
    p_household_id: householdId,
    p_movement_id: movementId,
    p_correction_id: null,
    p_expected_updated_at: insertedMov.updated_at,
    p_date: "2026-08-11",
    p_amount: 120.0,
    p_description: "Null corr test",
    p_method: "efectivo",
    p_category: "Comida / cenas",
    p_reason: "Null corr test",
  });
  assert(
    nullCorrErr && nullCorrErr.message.includes("INVALID_CORRECTION_ID"),
    "Missing/null correction ID rejected with INVALID_CORRECTION_ID",
    nullCorrErr
  );

  // 5. SUCCESSFUL FIRST CORRECTION EXECUTION
  const corr1Id = "11111111-1111-4000-8000-111111111111";
  const { data: rpcRes1, error: rpcErr1 } = await userClient.rpc("correct_reconciled_movement_v1", {
    p_household_id: householdId,
    p_movement_id: movementId,
    p_correction_id: corr1Id,
    p_expected_updated_at: insertedMov.updated_at,
    p_date: "2026-08-11",
    p_amount: 120.0,
    p_description: "Almuerzo 1era correccion",
    p_method: "efectivo",
    p_category: "Comida / cenas",
    p_person: "Papa Carlos",
    p_account_id: accountId,
    p_reason: "Boleta corregida v1",
  });
  assert(!rpcErr1 && rpcRes1?.success, "Authenticated member RPC correction 1 succeeded", rpcErr1);
  const firstAfterSnapshot = rpcRes1.after_snapshot;

  // 6. Identical retry with same corr1Id -> returns stored first after_snapshot & idempotent=true
  const { data: idemRes, error: idemErr } = await userClient.rpc("correct_reconciled_movement_v1", {
    p_household_id: householdId,
    p_movement_id: movementId,
    p_correction_id: corr1Id,
    p_expected_updated_at: insertedMov.updated_at,
    p_date: "2026-08-11",
    p_amount: 120.0,
    p_description: "Almuerzo 1era correccion",
    p_method: "efectivo",
    p_category: "Comida / cenas",
    p_person: "Papa Carlos",
    p_account_id: accountId,
    p_reason: "Boleta corregida v1",
  });
  assert(
    !idemErr && idemRes?.idempotent === true && idemRes.after_snapshot.description === "Almuerzo 1era correccion",
    "Identical retry returned stored snapshot and idempotent=true",
    idemErr
  );

  // 7. Incompatible retry with same corr1Id (different amount) -> MOVEMENT_CORRECTION_ID_CONFLICT
  const { error: incompErr } = await userClient.rpc("correct_reconciled_movement_v1", {
    p_household_id: householdId,
    p_movement_id: movementId,
    p_correction_id: corr1Id,
    p_expected_updated_at: insertedMov.updated_at,
    p_date: "2026-08-11",
    p_amount: 999.0, // DIFFERENT AMOUNT
    p_description: "Almuerzo 1era correccion",
    p_method: "efectivo",
    p_category: "Comida / cenas",
    p_person: "Papa Carlos",
    p_account_id: accountId,
    p_reason: "Boleta corregida v1",
  });
  assert(
    incompErr && incompErr.message.includes("MOVEMENT_CORRECTION_ID_CONFLICT"),
    "Incompatible payload with same ID rejected with MOVEMENT_CORRECTION_ID_CONFLICT",
    incompErr
  );

  // 8. Second correction with corr2Id
  const corr2Id = "22222222-2222-4000-8000-222222222222";
  const { data: rpcRes2, error: rpcErr2 } = await userClient.rpc("correct_reconciled_movement_v1", {
    p_household_id: householdId,
    p_movement_id: movementId,
    p_correction_id: corr2Id,
    p_expected_updated_at: firstAfterSnapshot.updated_at,
    p_date: "2026-08-12",
    p_amount: 130.0,
    p_description: "Almuerzo 2da correccion",
    p_method: "efectivo",
    p_category: "Comida / cenas",
    p_person: "Papa Carlos",
    p_account_id: accountId,
    p_reason: "Factura corregida v2",
  });
  assert(!rpcErr2 && rpcRes2?.success, "Second RPC correction 2 succeeded", rpcErr2);

  // 9. Retrying FIRST correction ID (corr1Id) after second correction MUST return FIRST stored snapshot (not second!)
  const { data: histRes, error: histErr } = await userClient.rpc("correct_reconciled_movement_v1", {
    p_household_id: householdId,
    p_movement_id: movementId,
    p_correction_id: corr1Id,
    p_expected_updated_at: insertedMov.updated_at,
    p_date: "2026-08-11",
    p_amount: 120.0,
    p_description: "Almuerzo 1era correccion",
    p_method: "efectivo",
    p_category: "Comida / cenas",
    p_person: "Papa Carlos",
    p_account_id: accountId,
    p_reason: "Boleta corregida v1",
  });
  assert(
    !histErr && histRes?.after_snapshot.description === "Almuerzo 1era correccion",
    "Historical retry returned FIRST stored after_snapshot despite later 2nd correction",
    histErr
  );

  log("ALL RECON-1C LOCAL SMOKE CHECKS & SECURITY MATRIX PASSED PERFECTLY!");
}

runLocalSmoke().catch((err) => {
  console.error("FATAL LOCAL SMOKE ERROR:", err);
  process.exit(1);
});
