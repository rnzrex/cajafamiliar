import { spawn } from "node:child_process";

const container = process.env.DOCUMENT_FIRST_DB_CONTAINER ?? "supabase_db_caja-familiar";
const migrationVersion = "20260831073542";
const ids = {
  user: "00000000-0000-4000-8000-000000002501",
  household: "00000000-0000-4000-8000-000000002502",
  debt: "00000000-0000-4000-8000-000000002503",
  rollbackDebt: "00000000-0000-4000-8000-000000002504",
};

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function jsonSql(value) {
  return `${sqlString(JSON.stringify(value))}::jsonb`;
}

async function runSql(sql) {
  return new Promise((resolve) => {
    const child = spawn(
      "docker",
      ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At"],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ stdout, stderr: error.message, ok: false }));
    child.on("close", (code) => resolve({ stdout, stderr, ok: code === 0 }));
    child.stdin.end(sql);
  });
}

async function scalar(sql, label) {
  const result = await runSql(sql);
  if (!result.ok) throw new Error(`${label} failed:\n${result.stderr}`);
  return result.stdout.trim();
}

async function expectSqlError(sql, expectedCode, label) {
  const result = await runSql(sql);
  if (result.ok) throw new Error(`${label}: expected SQL failure ${expectedCode}`);
  const output = `${result.stdout}\n${result.stderr}`;
  if (!output.includes(expectedCode)) throw new Error(`${label}: expected ${expectedCode}, received:\n${output}`);
}

function withAuth(sql) {
  return `begin; set local request.jwt.claim.sub = ${sqlString(ids.user)}; set local request.jwt.claim.role = 'authenticated'; set local role authenticated; ${sql} commit;`;
}

function isoDate(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

function addMonths(year, monthIndex, amount) {
  const total = year * 12 + monthIndex + amount;
  return [Math.floor(total / 12), total % 12];
}

function elapsedDays(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

function acceptanceSchedule() {
  const rows = [{
    installment_number: 1,
    contractual_installment_number: 1,
    due_date: isoDate(2027, 0, 10),
    expected_amount: 8500,
    expected_principal: 8500,
    expected_interest: 0,
    expected_fees: 0,
    expected_insurance: 0,
    expected_taxes: 0,
    reported_balance: 76500,
    row_role: "down_payment",
    phase: "down_payment",
    evidence: { source: "sanitized_acceptance_fixture" },
  }];

  for (let index = 0; index < 8; index += 1) {
    const [year, month] = addMonths(2027, 0, index + 1);
    rows.push({
      installment_number: index + 2,
      contractual_installment_number: index + 2,
      due_date: isoDate(year, month, 10),
      expected_amount: 1062.5,
      expected_principal: 1062.5,
      expected_interest: 0,
      expected_fees: 0,
      expected_insurance: 0,
      expected_taxes: 0,
      reported_balance: roundCurrency(76500 - 1062.5 * (index + 1)),
      row_role: "installment",
      phase: "introductory_zero_interest",
      evidence: { source: "sanitized_acceptance_fixture", feeRule: "contract_schedule_only" },
    });
  }

  const feeSchedule = [
    155.06, 160.42,
    ...Array.from({ length: 53 }, () => 155.17),
    ...Array.from({ length: 62 }, () => 72.86),
    116.86, 29.08, 3.71,
  ];
  let outstandingPrincipal = 68000;
  let previousDueDate = isoDate(2027, 8, 10);
  for (let index = 0; index < 120; index += 1) {
    const [year, month] = addMonths(2027, 0, index + 9);
    const dueDate = isoDate(year, month, 10);
    const periodDays = elapsedDays(previousDueDate, dueDate);
    const interest = roundCurrency(outstandingPrincipal * 0.23 * periodDays / 360);
    const fee = feeSchedule[index];
    const total = index === 119 ? 1601.16 : 1600.36;
    const principal = roundCurrency(total - interest - fee);
    outstandingPrincipal = roundCurrency(outstandingPrincipal - principal);
    rows.push({
      installment_number: index + 10,
      contractual_installment_number: index + 10,
      due_date: dueDate,
      expected_amount: total,
      expected_principal: principal,
      expected_interest: interest,
      expected_fees: fee,
      expected_insurance: 0,
      expected_taxes: 0,
      reported_balance: outstandingPrincipal,
      row_role: "installment",
      phase: "tna_actual_days_360",
      evidence: { source: "sanitized_acceptance_fixture", periodDays, feeRule: "contract_schedule_only" },
    });
    previousDueDate = dueDate;
  }
  if (rows.length !== 129) throw new Error(`Acceptance fixture has ${rows.length} rows, expected 129`);
  return rows;
}

function contractPayload(openingPrincipal) {
  return {
    contract_authority: "official_noncontractual",
    principal_basis: "asset_price_including_down_payment",
    asset_price: 85000,
    down_payment_amount: 8500,
    scheduled_principal_amount: 85000,
    financed_principal_amount: 76500,
    opening_principal_amount: openingPrincipal,
    repayment_structure: "fixed_schedule",
    amortization_method: "irregular_contract",
    installment_amount_mode: "variable",
    payment_frequency: "monthly",
    custom_frequency_days: null,
    first_due_date: "2027-01-10",
    interest_rate_type: "nominal_annual_simple",
    interest_rate_percent: 23,
    interest_rate_basis: "actual_days_360",
    day_count_basis: "actual_days_360",
    fee_rule_type: "contract_schedule_only",
    fee_rule: {},
    prepayment_terms: {},
    authority_notes: "Fixture sintético no contractual.",
  };
}

function normalizedMetadata() {
  return {
    schema: "CAJA_FAMILIAR_DEBT_DOCUMENT_V2",
    source: "sanitized_acceptance_fixture",
    authority: "official_noncontractual",
    authorityEvidence: "official_schedule",
    reconciliation: { status: "exact" },
    rowCount: 129,
    warnings: [],
  };
}

function createDocumentDebtSql(debtId, contract, metadata, schedule) {
  return `select public.create_debt_from_document_v1(
    ${sqlString(ids.household)}, ${sqlString(debtId)}, 'EXISTING_DEBT', 'Fixture documental', 'Acreedor fixture', 'mortgage', 'PEN',
    '2026-01-01', '2026-08-31', 76500, 69062.50, 129, 1062.50, 'variable', 'monthly', null, '2027-01-10',
    null, null, 'PG17 sanitized smoke', ${jsonSql(schedule)}, 'fixed_schedule', 'contract_schedule', null, null,
    ${jsonSql(contract)}, 'reconstructed', 'official_noncontractual', 8, 'schedule', 'official_noncontractual', 'official_schedule',
    ${jsonSql(metadata)}, 'CONSECUTIVE_FULLY_PAID'
  );`;
}

const cleanupSql = `
  delete from public.bank_document_import_jobs where household_id = ${sqlString(ids.household)};
  delete from public.debt_financing_contracts where household_id = ${sqlString(ids.household)};
  delete from public.debt_installment_carried_allocations where household_id = ${sqlString(ids.household)};
  delete from public.debt_event_installment_allocations where household_id = ${sqlString(ids.household)};
  delete from public.debt_installments where household_id = ${sqlString(ids.household)};
  delete from public.debt_schedule_versions where household_id = ${sqlString(ids.household)};
  delete from public.debt_events where household_id = ${sqlString(ids.household)};
  delete from public.movements where household_id = ${sqlString(ids.household)};
  delete from public.debts where household_id = ${sqlString(ids.household)};
  delete from public.financial_accounts where household_id = ${sqlString(ids.household)};
  delete from public.household_members where household_id = ${sqlString(ids.household)};
  delete from public.households where id = ${sqlString(ids.household)};
  delete from auth.users where id = ${sqlString(ids.user)};
`;

console.log(`=== DOCUMENT-FIRST PRODUCTION RPC RUNTIME SMOKE (${container}) ===`);
let cleanupNeeded = false;
try {
  const serverVersion = await scalar("select current_setting('server_version_num');", "PostgreSQL version");
  if (Number(serverVersion) < 170000) throw new Error(`PostgreSQL 17 required; received ${serverVersion}`);

  await scalar(cleanupSql, "pre-test cleanup");
  cleanupNeeded = true;
  await scalar(`
    insert into auth.users (id, email) values (${sqlString(ids.user)}, 'document-first-runtime@example.test');
    insert into public.households (id, name) values (${sqlString(ids.household)}, 'Document-First runtime smoke');
    insert into public.household_members (household_id, user_id, role, display_name)
      values (${sqlString(ids.household)}, ${sqlString(ids.user)}, 'owner', 'Smoke User');
  `, "fixture setup");
  const migrationApplied = await scalar(`select count(*) from supabase_migrations.schema_migrations where version = ${sqlString(migrationVersion)};`, "migration history");
  if (migrationApplied !== "1") throw new Error(`Migration ${migrationVersion} is not applied locally`);

  const functionDefinition = await scalar(`select pg_catalog.pg_get_functiondef(${sqlString("public.create_debt_v1(uuid,uuid,text,text,text,text,date,date,numeric,numeric,integer,numeric,text,text,integer,date,numeric,numeric,text,jsonb,jsonb,text,text,numeric,text)")}::regprocedure);`, "RPC definition");
  const correctedCast = "(v_elem->>'installment_number')::pg_catalog.int4";
  const invalidCast = "(v_elem->>'installment_number')::pg_catalog.integer";
  if (!functionDefinition.includes(correctedCast) || functionDefinition.includes(invalidCast)) throw new Error("create_debt_v1 does not contain only the corrected int4 cast");

  const schedule = acceptanceSchedule();
  const openingPrincipal = 69062.50;
  const contract = contractPayload(openingPrincipal);
  await scalar(withAuth(createDocumentDebtSql(ids.debt, contract, normalizedMetadata(), schedule)), "129-row document onboarding");

  const acceptance = await scalar(`select
    (select count(*) from public.debts where id = ${sqlString(ids.debt)}) || '|' ||
    (select count(*) from public.debt_schedule_versions where debt_id = ${sqlString(ids.debt)}) || '|' ||
    (select count(*) from public.debt_installments where debt_id = ${sqlString(ids.debt)}) || '|' ||
    (select count(*) from public.debt_financing_contracts where debt_id = ${sqlString(ids.debt)}) || '|' ||
    (select count(*) from public.bank_document_import_jobs where household_id = ${sqlString(ids.household)} and normalized_metadata->>'onboardingDebtId' = ${sqlString(ids.debt)}) || '|' ||
    (select opening_principal_balance::numeric(12,2)::text from public.debts where id = ${sqlString(ids.debt)}) || '|' ||
    (select count(*) from public.debt_installments where debt_id = ${sqlString(ids.debt)} and is_paid_before_tracking) || '|' ||
    (select count(*) from public.debt_installments where debt_id = ${sqlString(ids.debt)} and not is_paid_before_tracking) || '|' ||
    (select count(*) from public.debt_events where debt_id = ${sqlString(ids.debt)}) || '|' ||
    (select count(*) from public.movements where household_id = ${sqlString(ids.household)}) || '|' ||
    (select count(*) from public.debt_event_installment_allocations where debt_id = ${sqlString(ids.debt)});`, "acceptance assertions");
  if (acceptance !== "1|1|129|1|1|69062.50|8|121|0|0|0") throw new Error(`129-row acceptance mismatch: ${acceptance}`);

  const rowState = await scalar(`select is_paid_before_tracking::text from public.debt_installments where debt_id = ${sqlString(ids.debt)} order by contractual_installment_number limit 9;`, "paid-before state");
  if (rowState !== "true\ntrue\ntrue\ntrue\ntrue\ntrue\ntrue\ntrue\nfalse") throw new Error(`Expected rows 1..8 paid and row 9 unpaid, received:\n${rowState}`);

  const invalidContract = { ...contract, principal_basis: "invalid_fixture_basis" };
  await expectSqlError(withAuth(createDocumentDebtSql(ids.rollbackDebt, invalidContract, normalizedMetadata(), schedule)), "INVALID_DEBT_INPUT", "rollback failure");
  const rollbackState = await scalar(`select
    (select count(*) from public.debts where id = ${sqlString(ids.rollbackDebt)}) || '|' ||
    (select count(*) from public.debt_schedule_versions where debt_id = ${sqlString(ids.rollbackDebt)}) || '|' ||
    (select count(*) from public.debt_installments where debt_id = ${sqlString(ids.rollbackDebt)}) || '|' ||
    (select count(*) from public.debt_financing_contracts where debt_id = ${sqlString(ids.rollbackDebt)}) || '|' ||
    (select count(*) from public.bank_document_import_jobs where household_id = ${sqlString(ids.household)} and normalized_metadata->>'onboardingDebtId' = ${sqlString(ids.rollbackDebt)});`, "rollback assertions");
  if (rollbackState !== "0|0|0|0|0") throw new Error(`Rollback left partial data: ${rollbackState}`);

  console.log(JSON.stringify({
    container,
    serverVersion,
    migrationVersion,
    passed: true,
    acceptance: "129 rows, asset PEN 85000, down payment PEN 8500, financed PEN 76500, scheduled PEN 85000, opening PEN 69062.50, lastPaid=8",
    zeroFinancialEffects: "0 debt events, 0 movements, 0 allocations",
    rollback: "invalid contract rejected with no partial rows",
  }, null, 2));
} finally {
  if (cleanupNeeded) {
    const cleanup = await scalar(cleanupSql, "post-test cleanup").catch((error) => { throw error; });
    void cleanup;
  }
}
