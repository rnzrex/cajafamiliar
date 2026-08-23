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

  // Setup Auth user
  const testEmail = `test.recon1c.${Date.now()}@local.test`;
  const testPassword = "LocalTestPassword123!";

  log(`Creating auth user ${testEmail}...`);
  const { data: userData, error: userErr } = await adminClient.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  });

  assert(!userErr && userData?.user, "Auth user created", userErr);
  const userId = userData.user.id;

  const userClient = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { error: signInErr } = await userClient.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });
  assert(!signInErr, "Authenticated user login successful", signInErr);

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

  // Movement
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

  assert(!movErr && insertedMov, "Movement created", movErr);

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

  // Direct update should be blocked
  const { error: directUpdateErr } = await userClient
    .from("movements")
    .update({ amount: 150 })
    .eq("id", movementId);
  assert(
    directUpdateErr && directUpdateErr.message.includes("MOVEMENT_RECONCILED"),
    "Direct UPDATE on matched movement blocked with MOVEMENT_RECONCILED",
    directUpdateErr
  );

  // Direct delete should be blocked
  const { error: directDeleteErr } = await userClient
    .from("movements")
    .delete()
    .eq("id", movementId);
  assert(
    directDeleteErr && directDeleteErr.message.includes("MOVEMENT_RECONCILED"),
    "Direct DELETE on matched movement blocked with MOVEMENT_RECONCILED",
    directDeleteErr
  );

  // RPC Correction call
  const { data: rpcRes, error: rpcErr } = await userClient.rpc("correct_reconciled_movement_v1", {
    p_household_id: householdId,
    p_movement_id: movementId,
    p_correction_id: "corr-smoke-1",
    p_expected_updated_at: insertedMov.updated_at,
    p_date: "2026-08-11",
    p_amount: 120.0,
    p_description: "Almuerzo corregido",
    p_method: "efectivo",
    p_category: "Comida / cenas",
    p_person: "Papa Carlos",
    p_account_id: accountId,
    p_reason: "Boleta corregida",
  });

  assert(!rpcErr && rpcRes?.success, "RPC correct_reconciled_movement_v1 executed successfully", rpcErr);

  // Check movement_corrections table contains audit record
  const { data: auditData, error: auditErr } = await userClient
    .from("movement_corrections")
    .select("*")
    .eq("correction_id", "corr-smoke-1")
    .single();

  assert(!auditErr && auditData && auditData.reason === "Boleta corregida", "Audit row created in movement_corrections", auditErr);

  // Idempotency check
  const { data: idemRes, error: idemErr } = await userClient.rpc("correct_reconciled_movement_v1", {
    p_household_id: householdId,
    p_movement_id: movementId,
    p_correction_id: "corr-smoke-1",
    p_expected_updated_at: insertedMov.updated_at,
    p_date: "2026-08-11",
    p_amount: 120.0,
    p_description: "Almuerzo corregido",
    p_method: "efectivo",
    p_category: "Comida / cenas",
    p_person: "Papa Carlos",
    p_account_id: accountId,
    p_reason: "Boleta corregida",
  });
  assert(!idemErr && idemRes?.idempotent === true, "Idempotent RPC call returned existing correction without error", idemErr);

  log("ALL RECON-1C LOCAL SMOKE CHECKS PASSED PERFECTLY!");
}

runLocalSmoke().catch((err) => {
  console.error("FATAL LOCAL SMOKE ERROR:", err);
  process.exit(1);
});
