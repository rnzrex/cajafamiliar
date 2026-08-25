import { createClient } from "@supabase/supabase-js";
import { execFileSync, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function resolveDbContainer() {
  const configuredContainer = process.env.DEBT5FA_DB_CONTAINER ?? process.env.DEBT_DB_CONTAINER;
  if (configuredContainer?.trim()) return configuredContainer.trim();

  const supabaseConfig = fs.readFileSync(path.join(projectRoot, "supabase", "config.toml"), "utf8");
  const projectId = supabaseConfig.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
  const runningContainers = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
  const projectContainer = projectId ? `supabase_db_${projectId}` : null;

  if (projectContainer && runningContainers.includes(projectContainer)) return projectContainer;

  const candidates = runningContainers.filter((name) => name.startsWith("supabase_db_"));
  if (candidates.length === 1) return candidates[0];

  throw new Error(
    `Could not resolve the local Supabase Postgres container. Expected ${projectContainer ?? "a project-scoped container"}; found: ${candidates.join(", ") || "none"}. Set DEBT5FA_DB_CONTAINER to override.`
  );
}

const dbContainer = resolveDbContainer();

const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";
const LOCAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

function makeUuid() {
  return "00000000-0000-4000-8000-" + Math.random().toString(16).substring(2, 14).padStart(12, "0");
}

function log(msg) {
  console.log(`[DEBT-5F-A LOCAL SMOKE] ${msg}`);
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
  execSync(`docker exec -i ${dbContainer} psql -U postgres -d postgres`, {
    cwd: projectRoot,
    input: sql,
    stdio: ["pipe", "ignore", "inherit"],
  });
}

async function runLocalSmoke() {
  // 1. LOCAL-SAFETY GUARD
  const targetUrl = new URL(LOCAL_SUPABASE_URL);
  if (
    targetUrl.hostname !== "127.0.0.1" &&
    targetUrl.hostname !== "localhost"
  ) {
    console.error(`ABORT: Target hostname ${targetUrl.hostname} is NOT local!`);
    process.exit(1);
  }

  log(`LOCAL DATABASE CONFIRMED: ${targetUrl.hostname}:${targetUrl.port}`);

  log("Resetting local Postgres public schema for clean reproducible test execution...");
  execSync(
    `docker exec -i ${dbContainer} psql -U postgres -d postgres -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;"`,
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
    `docker exec -i ${dbContainer} psql -U postgres -d postgres -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres, service_role; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role; NOTIFY pgrst, 'reload schema';"`,
    { cwd: projectRoot, stdio: "ignore" }
  );

  const adminClient = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const anonClient = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  });

  // 3. REAL AUTHENTICATED TEST USER
  const testEmail = `test.user.${Date.now()}@local.test`;
  const testPassword = "LocalTestPassword123!";

  log(`Creating disposable auth user ${testEmail}...`);
  const { data: userData, error: userErr } = await adminClient.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  });
  assert(!userErr && userData.user, "Auth user created cleanly");
  const testUserId = userData.user.id;

  // Sign in as test user
  const anonSignInClient = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data: signInData, error: signInErr } = await anonSignInClient.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });
  assert(!signInErr && signInData.session?.access_token, "Signed in as authenticated test user");

  const accessToken = signInData.session.access_token;
  const authClient = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  // Create Household A and add test user as member
  const householdAId = makeUuid();
  const { error: hAErr } = await adminClient.from("households").insert({
    id: householdAId,
    name: "Household A",
  });
  assert(!hAErr, "Household A created", hAErr);

  const { error: memAErr } = await adminClient.from("household_members").insert({
    household_id: householdAId,
    user_id: testUserId,
    role: "owner",
  });
  assert(!memAErr, "Test user added as member of Household A");

function buildCreateCardArgs(hhId, overrides = {}) {
  return {
    p_household_id: hhId,
    p_debt_id: overrides.debtId ?? makeUuid(),
    p_name: overrides.name ?? "Test Card",
    p_creditor_name: overrides.creditorName ?? "BCP",
    p_currency_code: overrides.currencyCode ?? "PEN",
    p_origin_date: overrides.originDate ?? "2026-08-01",
    p_tracking_start_date: overrides.trackingStartDate ?? "2026-08-01",
    p_opening_balance: overrides.openingBalance ?? 0,
    p_credit_limit: overrides.creditLimit ?? null,
    p_closing_day: overrides.closingDay ?? null,
    p_due_day: overrides.dueDay ?? null,
    p_last4: overrides.last4 ?? null,
    p_tea_percent: overrides.teaPercent ?? null,
    p_tcea_percent: overrides.tceaPercent ?? null,
    p_notes: overrides.notes ?? "",
  };
}

  // 4. CREATE RPC — HAPPY PATH
  log("Testing happy path create_credit_card_debt_v1...");
  const debt1Id = makeUuid();
  const { data: createRes, error: createErr } = await authClient.rpc(
    "create_credit_card_debt_v1",
    buildCreateCardArgs(householdAId, {
      debtId: debt1Id,
      name: "Visa Infinite BCP",
      creditorName: "BCP",
      currencyCode: "USD",
      originDate: "2026-08-01",
      trackingStartDate: "2026-08-01",
      openingBalance: 0,
      creditLimit: 10000,
      closingDay: 20,
      dueDay: 5,
      last4: "9999",
      teaPercent: 30,
      tceaPercent: 38,
      notes: "Happy path card",
    })
  );

  assert(!createErr && createRes?.debt && createRes?.profile, "create_credit_card_debt_v1 happy path RPC succeeded", createErr);

  const { data: debtRows } = await adminClient.from("debts").select("*").eq("id", debt1Id);
  assert(debtRows?.length === 1 && debtRows[0].debt_kind === "credit_card", "Exactly 1 debt row created with kind credit_card");

  const { data: profileRows } = await adminClient.from("credit_card_profiles").select("*").eq("debt_id", debt1Id);
  assert(profileRows?.length === 1 && profileRows[0].household_id === householdAId, "Exactly 1 profile row created for household A");

  const { count: movCount } = await adminClient.from("movements").select("*", { count: "exact", head: true }).eq("household_id", householdAId);
  assert(movCount === 0, "Zero movements created during card setup");

  const { count: entCount } = await adminClient.from("credit_card_entries").select("*", { count: "exact", head: true }).eq("debt_id", debt1Id);
  assert(entCount === 0, "Zero card entries created during card setup");

  const { count: stmCount } = await adminClient.from("credit_card_statements").select("*", { count: "exact", head: true }).eq("debt_id", debt1Id);
  assert(stmCount === 0, "Zero statements created during card setup");

  const { count: schedCount } = await adminClient.from("debt_schedule_versions").select("*", { count: "exact", head: true }).eq("debt_id", debt1Id);
  assert(schedCount === 0, "Zero schedule versions created for card debt");

  const { count: instCount } = await adminClient.from("debt_installments").select("*", { count: "exact", head: true }).eq("debt_id", debt1Id);
  assert(instCount === 0, "Zero installments created for card debt");

  const { count: colCount } = await adminClient.from("debt_collaterals").select("*", { count: "exact", head: true }).eq("debt_id", debt1Id);
  assert(colCount === 0, "Zero collaterals created for card debt");

  // 5. CREATE RPC — NULL FACTS
  log("Testing create_credit_card_debt_v1 with NULL optional profile facts...");
  const debtNullId = makeUuid();
  const { data: nullRes, error: nullErr } = await authClient.rpc(
    "create_credit_card_debt_v1",
    buildCreateCardArgs(householdAId, {
      debtId: debtNullId,
      name: "Amex Green",
      creditorName: "Interbank",
      currencyCode: "PEN",
    })
  );

  assert(!nullErr && nullRes?.debt, "create_credit_card_debt_v1 with NULL facts succeeded");

  const { data: nullProfRows } = await adminClient.from("credit_card_profiles").select("*").eq("debt_id", debtNullId);
  assert(
    nullProfRows?.[0]?.credit_limit === null &&
      nullProfRows?.[0]?.closing_day === null &&
      nullProfRows?.[0]?.due_day === null &&
      nullProfRows?.[0]?.last4 === null,
    "All unknown profile fields stored as exact SQL NULL"
  );

  // 6. CREATE RPC — ATOMIC ROLLBACK
  log("Testing atomic rollback with invalid closing_day = 35...");
  const debtInvalid1Id = makeUuid();
  const { error: invalidErr1 } = await authClient.rpc(
    "create_credit_card_debt_v1",
    buildCreateCardArgs(householdAId, {
      debtId: debtInvalid1Id,
      creditLimit: 1000,
      closingDay: 35,
      dueDay: 5,
      last4: "1234",
    })
  );
  assert(invalidErr1 && invalidErr1.message.includes("INVALID_CREDIT_CARD_PROFILE"), "Invalid closing_day rejected with INVALID_CREDIT_CARD_PROFILE", invalidErr1);

  const { data: checkRollbackDebts } = await adminClient.from("debts").select("*").eq("id", debtInvalid1Id);
  const { data: checkRollbackProfs } = await adminClient.from("credit_card_profiles").select("*").eq("debt_id", debtInvalid1Id);
  assert(checkRollbackDebts?.length === 0 && checkRollbackProfs?.length === 0, "Atomic rollback verified: 0 debt rows and 0 profile rows remain");

  // 7. CREATE RPC — ACCESS CONTROL
  log("Testing access control against unauthorized household B...");
  const householdBId = makeUuid();
  await adminClient.from("households").insert({ id: householdBId, name: "Household B" });

  const debtOtherHhId = makeUuid();
  const { error: accessErr } = await authClient.rpc(
    "create_credit_card_debt_v1",
    buildCreateCardArgs(householdBId, {
      debtId: debtOtherHhId,
    })
  );

  assert(accessErr && accessErr.message.includes("HOUSEHOLD_ACCESS_DENIED"), "Cross-household creation rejected with HOUSEHOLD_ACCESS_DENIED");

  // 8. FUNCTION EXECUTE PRIVILEGES
  log("Testing EXECUTE privileges (ANON, AUTHENTICATED, SERVICE_ROLE)...");
  const { error: anonCreateErr } = await anonClient.rpc(
    "create_credit_card_debt_v1",
    buildCreateCardArgs(householdAId)
  );
  assert(anonCreateErr, "ANON call to create_credit_card_debt_v1 DENIED");

  const { error: anonSaveErr } = await anonClient.rpc("save_credit_card_profile_v1", {
    p_household_id: householdAId,
    p_debt_id: debt1Id,
    p_credit_limit: 5000,
    p_closing_day: null,
    p_due_day: null,
    p_last4: null,
  });
  assert(anonSaveErr, "ANON call to save_credit_card_profile_v1 DENIED");

  const { error: srvCreateErr } = await adminClient.rpc(
    "create_credit_card_debt_v1",
    buildCreateCardArgs(householdAId)
  );
  assert(srvCreateErr, "SERVICE_ROLE call to create_credit_card_debt_v1 DENIED");

  const { error: srvSaveErr } = await adminClient.rpc("save_credit_card_profile_v1", {
    p_household_id: householdAId,
    p_debt_id: debt1Id,
    p_credit_limit: 5000,
    p_closing_day: null,
    p_due_day: null,
    p_last4: null,
  });
  assert(srvSaveErr, "SERVICE_ROLE call to save_credit_card_profile_v1 DENIED");

  // 9. DIRECT TABLE WRITE RESTRICTIONS
  log("Testing direct table write restrictions for AUTHENTICATED user...");
  const { error: dirInsertProfErr } = await authClient.from("credit_card_profiles").insert({
    debt_id: makeUuid(),
    household_id: householdAId,
  });
  assert(dirInsertProfErr, "Direct INSERT to credit_card_profiles DENIED");

  const { error: dirUpdateProfErr } = await authClient.from("credit_card_profiles").update({ credit_limit: 99999 }).eq("debt_id", debt1Id);
  assert(dirUpdateProfErr, "Direct UPDATE to credit_card_profiles DENIED");

  const { error: dirDeleteProfErr } = await authClient.from("credit_card_profiles").delete().eq("debt_id", debt1Id);
  assert(dirDeleteProfErr, "Direct DELETE to credit_card_profiles DENIED");

  const { error: dirInsertEntErr } = await authClient.from("credit_card_entries").insert({
    id: makeUuid(),
    debt_id: debt1Id,
    entry_date: "2026-08-01",
    entry_type: "purchase",
    liability_delta: 100,
    description: "Hacked entry",
  });
  assert(dirInsertEntErr, "Direct INSERT to credit_card_entries DENIED");

  const { error: dirUpdateEntErr } = await authClient.from("credit_card_entries").update({ description: "Hacked update" }).eq("debt_id", debt1Id);
  assert(dirUpdateEntErr, "Direct UPDATE to credit_card_entries DENIED");

  const { error: dirDeleteEntErr } = await authClient.from("credit_card_entries").delete().eq("debt_id", debt1Id);
  assert(dirDeleteEntErr, "Direct DELETE to credit_card_entries DENIED");

  const { error: dirInsertStmErr } = await authClient.from("credit_card_statements").insert({
    id: makeUuid(),
    debt_id: debt1Id,
    statement_date: "2026-08-20",
    due_date: "2026-09-05",
    statement_balance: 100,
  });
  assert(dirInsertStmErr, "Direct INSERT to credit_card_statements DENIED");

  const { error: dirUpdateStmErr } = await authClient.from("credit_card_statements").update({ statement_balance: 9999 }).eq("debt_id", debt1Id);
  assert(dirUpdateStmErr, "Direct UPDATE to credit_card_statements DENIED");

  const { error: dirDeleteStmErr } = await authClient.from("credit_card_statements").delete().eq("debt_id", debt1Id);
  assert(dirDeleteStmErr, "Direct DELETE to credit_card_statements DENIED");

  // 10. PROFILE SAVE — UPDATE
  log("Testing save_credit_card_profile_v1 update...");
  const { data: updateProfRes, error: updateProfErr } = await authClient.rpc("save_credit_card_profile_v1", {
    p_household_id: householdAId,
    p_debt_id: debt1Id,
    p_credit_limit: 15000,
    p_closing_day: 25,
    p_due_day: 10,
    p_last4: "8888",
  });
  assert(!updateProfErr && updateProfRes?.debt_id === debt1Id, "save_credit_card_profile_v1 update succeeded");

  const { data: updatedProfRows } = await adminClient.from("credit_card_profiles").select("*").eq("debt_id", debt1Id);
  assert(
    updatedProfRows?.[0]?.credit_limit === 15000 &&
      updatedProfRows?.[0]?.closing_day === 25 &&
      updatedProfRows?.[0]?.due_day === 10 &&
      updatedProfRows?.[0]?.last4 === "8888",
    "Profile updated with exact new values"
  );

  // 11. PROFILE SAVE — NULL RESTORE
  log("Testing save_credit_card_profile_v1 null restore...");
  await authClient.rpc("save_credit_card_profile_v1", {
    p_household_id: householdAId,
    p_debt_id: debt1Id,
    p_credit_limit: null,
    p_closing_day: null,
    p_due_day: null,
    p_last4: null,
  });

  const { data: restoredNullProfRows } = await adminClient.from("credit_card_profiles").select("*").eq("debt_id", debt1Id);
  assert(
    restoredNullProfRows?.[0]?.credit_limit === null &&
      restoredNullProfRows?.[0]?.closing_day === null &&
      restoredNullProfRows?.[0]?.due_day === null &&
      restoredNullProfRows?.[0]?.last4 === null,
    "Profile updated fields restored to exact SQL NULL"
  );

  // 12. PROFILE RECOVERY
  log("Testing profile recovery for existing card debt without profile...");
  const orphanedDebtId = makeUuid();
  const { error: insOrphanErr } = await adminClient.from("debts").insert({
    id: orphanedDebtId,
    household_id: householdAId,
    name: "Orphaned Visa",
    creditor_name: "BCP",
    debt_kind: "credit_card",
    currency_code: "PEN",
    origin_date: "2026-08-01",
    tracking_start_date: "2026-08-01",
    opening_principal_balance: 0,
    status: "active",
    is_archived: false,
    created_by_user_id: testUserId,
  });
  assert(!insOrphanErr, "Orphaned debt inserted", insOrphanErr);

  const { data: recoveryRes, error: recoveryErr } = await authClient.rpc("save_credit_card_profile_v1", {
    p_household_id: householdAId,
    p_debt_id: orphanedDebtId,
    p_credit_limit: 8000,
    p_closing_day: 15,
    p_due_day: 2,
    p_last4: "7777",
  });
  if (recoveryErr) {
    console.error("recoveryErr:", recoveryErr);
  }
  assert(!recoveryErr && recoveryRes?.debt_id === orphanedDebtId, "save_credit_card_profile_v1 recovered orphaned card profile", recoveryErr);

  const { data: recProfRows } = await adminClient.from("credit_card_profiles").select("*").eq("debt_id", orphanedDebtId);
  assert(recProfRows?.length === 1 && recProfRows[0].credit_limit === 8000, "Exactly 1 profile inserted for orphaned card debt");

  // 13. PROFILE SAVE — WRONG KIND
  log("Testing save_credit_card_profile_v1 against non-card debt...");
  const loanDebtId = makeUuid();
  const { error: insLoanErr } = await adminClient.from("debts").insert({
    id: loanDebtId,
    household_id: householdAId,
    name: "Personal Loan",
    creditor_name: "BBVA",
    debt_kind: "family_loan",
    currency_code: "PEN",
    origin_date: "2026-08-01",
    tracking_start_date: "2026-08-01",
    opening_principal_balance: 5000,
    status: "active",
    is_archived: false,
    created_by_user_id: testUserId,
  });
  assert(!insLoanErr, "Personal loan debt inserted", insLoanErr);

  const { error: wrongKindErr } = await authClient.rpc("save_credit_card_profile_v1", {
    p_household_id: householdAId,
    p_debt_id: loanDebtId,
    p_credit_limit: 5000,
    p_closing_day: null,
    p_due_day: null,
    p_last4: null,
  });
  assert(wrongKindErr && wrongKindErr.message.includes("DEBT_NOT_CREDIT_CARD"), "Non-card debt profile save rejected with DEBT_NOT_CREDIT_CARD");

  const { data: loanProfRows } = await adminClient.from("credit_card_profiles").select("*").eq("debt_id", loanDebtId);
  assert(loanProfRows?.length === 0, "Zero profile rows created for non-card debt");

  log(`Cleaning up disposable test user ${testUserId}...`);
  const { error: delUserErr } = await adminClient.auth.admin.deleteUser(testUserId);
  if (delUserErr) {
    log(`Cleanup notice: disposable test user deletion returned: ${delUserErr.message}`);
  } else {
    log("Disposable test user deleted cleanly.");
  }

  log("ALL LOCAL SQL SMOKE ASSERTIONS PASSED CLEANLY!");
}

runLocalSmoke().catch((err) => {
  console.error("Local smoke test failed:", err);
  process.exit(1);
});
