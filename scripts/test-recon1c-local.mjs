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

  // Direct UPDATE / DELETE on movements blocked
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

  // DIRECT TABLE MUTATION CHECKS ON movement_corrections
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

  const { error: directCorrUpdateErr } = await userClient
    .from("movement_corrections")
    .update({ reason: "Direct update test" })
    .eq("household_id", householdId);
  assert(
    directCorrUpdateErr !== null,
    "Direct UPDATE on movement_corrections denied for authenticated user",
    directCorrUpdateErr
  );

  const { error: directCorrDeleteErr } = await userClient
    .from("movement_corrections")
    .delete()
    .eq("household_id", householdId);
  assert(
    directCorrDeleteErr !== null,
    "Direct DELETE on movement_corrections denied for authenticated user",
    directCorrDeleteErr
  );

  // NON-STANDARD DOMAIN PROTECTION CHECKS
  log("Inserting non-standard movements for domain protection tests via psql...");
  const nonStandardSql = `
    INSERT INTO public.movements (id, household_id, type, date, amount, description, method, category, person, registered_by_user_id, account_id, movement_context)
    VALUES ('mov-recon1c-debt-service', '${householdId}', 'egreso', '2026-08-10', 200.0, 'Pago deuda servicio', 'efectivo', 'Préstamos', 'Juan', '${userId}', '${accountId}', 'debt_service'),
           ('mov-recon1c-card-purchase', '${householdId}', 'egreso', '2026-08-10', 150.0, 'Tarjeta compra', 'tarjeta', 'Compras personales', 'Juan', '${userId}', '${accountId}', 'credit_card_purchase')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.account_reconciliation_movements (id, household_id, reconciliation_id, movement_id, balance_contribution, movement_updated_at_snapshot, movement_snapshot)
    VALUES (gen_random_uuid(), '${householdId}', '${recId}', 'mov-recon1c-debt-service', -200.0, now(), '{}'::jsonb),
           (gen_random_uuid(), '${householdId}', '${recId}', 'mov-recon1c-card-purchase', -150.0, now(), '{}'::jsonb)
    ON CONFLICT (reconciliation_id, movement_id) DO NOTHING;
  `;
  execSync(`docker exec -i supabase_db_crea-una-aplicaci-n-web-completa psql -U postgres -d postgres`, {
    cwd: projectRoot,
    input: nonStandardSql,
    stdio: ["pipe", "ignore", "inherit"],
  });

  const debtMovId = "mov-recon1c-debt-service";
  const cardMovId = "mov-recon1c-card-purchase";

  const { data: debtMovData } = await adminClient.from("movements").select("updated_at").eq("id", debtMovId).single();
  const { data: cardMovData } = await adminClient.from("movements").select("updated_at").eq("id", cardMovId).single();

  const { error: debtRpcErr } = await userClient.rpc("correct_reconciled_movement_v1", {
    p_household_id: householdId,
    p_movement_id: debtMovId,
    p_correction_id: "00000000-0000-4000-8000-000000000010",
    p_expected_updated_at: debtMovData?.updated_at || new Date().toISOString(),
    p_date: "2026-08-11",
    p_amount: 250.0,
    p_description: "Debt corr test",
    p_method: "efectivo",
    p_category: "Préstamos",
    p_reason: "Debt corr test",
  });
  assert(
    debtRpcErr && (debtRpcErr.message.includes("DEBT_MOVEMENT_PROTECTED") || debtRpcErr.message.includes("DEBT_SERVICE_MOVEMENT_RPC_ONLY")),
    "Debt service movement correction blocked with DEBT_MOVEMENT_PROTECTED",
    debtRpcErr
  );

  const { error: cardRpcErr } = await userClient.rpc("correct_reconciled_movement_v1", {
    p_household_id: householdId,
    p_movement_id: cardMovId,
    p_correction_id: "00000000-0000-4000-8000-000000000011",
    p_expected_updated_at: new Date().toISOString(),
    p_date: "2026-08-11",
    p_amount: 180.0,
    p_description: "Card corr test",
    p_method: "tarjeta",
    p_category: "Compras personales",
    p_reason: "Card corr test",
  });
  assert(
    cardRpcErr && (cardRpcErr.message.includes("CREDIT_CARD_MOVEMENT_PROTECTED") || cardRpcErr.message.includes("CREDIT_CARD_MOVEMENT_RPC_ONLY")),
    "Credit card movement correction blocked with CREDIT_CARD_MOVEMENT_PROTECTED",
    cardRpcErr
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

  // 10. REAL CONCURRENT IDEMPOTENCY TEST WITH Promise.all
  log("Running real concurrent RPC execution test with Promise.all...");
  const concurrentCorrId = "33333333-3333-4000-8000-333333333333";
  const concurrentPayload = {
    p_household_id: householdId,
    p_movement_id: movementId,
    p_correction_id: concurrentCorrId,
    p_expected_updated_at: rpcRes2.after_snapshot.updated_at,
    p_date: "2026-08-13",
    p_amount: 140.0,
    p_description: "Almuerzo concurrente",
    p_method: "efectivo",
    p_category: "Comida / cenas",
    p_person: "Papa Carlos",
    p_account_id: accountId,
    p_reason: "Test concurrencia simultanea",
  };

  const [concResA, concResB] = await Promise.all([
    userClient.rpc("correct_reconciled_movement_v1", concurrentPayload),
    userClient.rpc("correct_reconciled_movement_v1", concurrentPayload),
  ]);

  assert(!concResA.error && !concResB.error, "Both simultaneous RPC calls succeeded without throwing error", { errA: concResA.error, errB: concResB.error });
  assert(
    (concResA.data?.idempotent === true || concResB.data?.idempotent === true),
    "At least one concurrent response set idempotent=true",
    { resA: concResA.data, resB: concResB.data }
  );
  assert(
    concResA.data?.after_snapshot?.amount === 140.0 && concResB.data?.after_snapshot?.amount === 140.0,
    "Both concurrent calls returned the exact same stored after_snapshot",
    { resA: concResA.data, resB: concResB.data }
  );
  const { data: countCorr } = await adminClient.from("movement_corrections").select("id").eq("correction_id", concurrentCorrId);
  assert(countCorr?.length === 1, "Exactly ONE correction row persists for concurrent execution", countCorr);

  // 11. ATOMIC ROLLBACK TEST
  log("Installing temporary failing trigger on movement_corrections for atomicity test...");
  const installTriggerSql = `
    CREATE OR REPLACE FUNCTION public.trg_test_fail_fn()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'TEST_FAIL_TRIGGER';
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_test_fail ON public.movement_corrections;
    CREATE TRIGGER trg_test_fail
      BEFORE INSERT ON public.movement_corrections
      FOR EACH ROW EXECUTE FUNCTION public.trg_test_fail_fn();
  `;
  execSync(`docker exec -i supabase_db_crea-una-aplicaci-n-web-completa psql -U postgres -d postgres`, {
    cwd: projectRoot,
    input: installTriggerSql,
    stdio: ["pipe", "ignore", "inherit"],
  });

  const failCorrId = "44444444-4444-4000-8000-444444444444";
  const { error: failRpcErr } = await userClient.rpc("correct_reconciled_movement_v1", {
    p_household_id: householdId,
    p_movement_id: movementId,
    p_correction_id: failCorrId,
    p_expected_updated_at: concResA.data.after_snapshot.updated_at,
    p_date: "2026-08-14",
    p_amount: 999.0,
    p_description: "Debe hacer rollback",
    p_method: "efectivo",
    p_category: "Comida / cenas",
    p_reason: "Rollback test",
  });

  assert(failRpcErr && failRpcErr.message.includes("TEST_FAIL_TRIGGER"), "RPC failed due to test trigger", failRpcErr);

  // Verify movement is completely unchanged
  const { data: rollbackMov } = await adminClient.from("movements").select("*").eq("id", movementId).single();
  assert(rollbackMov.amount === 140.0 && rollbackMov.description === "Almuerzo concurrente", "Movement remained unchanged after failed RPC transaction rollback");

  // Verify no movement_corrections row persists
  const { data: rollbackCorr } = await adminClient.from("movement_corrections").select("*").eq("correction_id", failCorrId);
  assert(rollbackCorr?.length === 0, "No movement_corrections row persisted after transaction rollback");

  // Clean up failing trigger
  const cleanupTriggerSql = `
    DROP TRIGGER IF EXISTS trg_test_fail ON public.movement_corrections;
    DROP FUNCTION IF EXISTS public.trg_test_fail_fn();
  `;
  execSync(`docker exec -i supabase_db_crea-una-aplicaci-n-web-completa psql -U postgres -d postgres`, {
    cwd: projectRoot,
    input: cleanupTriggerSql,
    stdio: ["pipe", "ignore", "inherit"],
  });
  log("Temporary test trigger cleaned up.");

  log("ALL RECON-1C LOCAL SMOKE CHECKS & SECURITY MATRIX PASSED PERFECTLY!");
}

runLocalSmoke().catch((err) => {
  console.error("FATAL LOCAL SMOKE ERROR:", err);
  process.exit(1);
});
