import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = process.env.UNIVERSAL_DEBT_DB_CONTAINER ?? "universal_debt_contract_engine_v1";
const database = process.env.UNIVERSAL_DEBT_DB_NAME ?? "postgres";
const databaseUser = process.env.UNIVERSAL_DEBT_DB_USER ?? "supabase_admin";
const runSuffix = randomBytes(4).toString("hex");
const id = (sequence) => `00000000-0000-4000-8000-${runSuffix}${String(sequence).padStart(4, "0")}`;
const movementId = (label) => `${label}-${runSuffix}`;
const ids = {
  user: id(1), household: id(2), account: id(3), source: id(4), sourceEvent: id(5),
  sourceMovement: movementId("universal-source-payment"), scheduleEvent: id(6), link: id(7), target: id(8), reversalEvent: id(9),
  contributionSource: id(10), contributionLink: id(11), contributionTarget: id(12), contributionEvent: id(13),
  contributionMovement: movementId("universal-contribution"), costsMovement: movementId("universal-refinance-costs"),
  lifecycleSource: id(14), lifecyclePrepaymentEvent: id(15), lifecyclePrepaymentMovement: movementId("universal-lifecycle-prepayment"),
  lifecyclePaymentEvent: id(16), lifecyclePaymentMovement: movementId("universal-lifecycle-payment"), lifecycleExtraEvent: id(17), lifecycleExtraMovement: movementId("universal-lifecycle-extra"),
  lifecycleScheduleEvent: id(18), lifecyclePartialEvent: id(19), lifecyclePartialMovement: movementId("universal-lifecycle-partial"), lifecyclePartialReversal: id(20),
  lifecycleAdvanceEvent: id(21), lifecycleAdvanceMovement: movementId("universal-lifecycle-advance"), taxSource: id(22), taxScheduleEvent: id(23), taxPrepaymentEvent: id(24), taxPrepaymentMovement: movementId("universal-tax-prepayment"),
};

async function rawSql(sql) {
  const result = await execFileAsync("docker", ["exec", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", databaseUser, "-d", database, "-At", "-F", "|", "-c", sql], { maxBuffer: 4 * 1024 * 1024 });
  return result.stdout.trim();
}

function asUser(sql) {
  return `begin; set local request.jwt.claim.sub = '${ids.user}'; set local request.jwt.claim.role = 'authenticated'; set local role authenticated; ${sql} commit;`;
}

async function sql(sql) { return rawSql(asUser(sql)); }

async function expectFailure(sql, expected) {
  try {
    await rawSql(asUser(sql));
  } catch (error) {
    const output = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;
    if (!output.includes(expected)) throw new Error(`Expected ${expected}, got ${output}`);
    return;
  }
  throw new Error(`Expected SQL failure ${expected}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

await rawSql(`
  insert into auth.users (id, aud, role, email, confirmed_at)
  values ('${ids.user}', 'authenticated', 'authenticated', 'universal-local-${runSuffix}@example.invalid', now())
  on conflict (id) do nothing;
  insert into public.households (id, name) values ('${ids.household}', 'Universal local household') on conflict (id) do nothing;
  insert into public.household_members (household_id, user_id, role, display_name)
  values ('${ids.household}', '${ids.user}', 'owner', 'Local tester') on conflict (household_id, user_id) do nothing;
  insert into public.financial_accounts (id, household_id, name, reconciliation_type, opening_balance, is_active, sort_order, currency_code)
  values ('${ids.account}', '${ids.household}', 'Cuenta local', 'balance', 10000, true, 1, 'PEN') on conflict (id) do nothing;
`);

await sql(`
  select public.create_debt_v2(
    '${ids.household}', '${ids.source}', 'Compra directa local', 'Proveedor local', 'installment_purchase', 'PEN',
    '2027-01-01', '2027-01-01', 1000, 1000, 10, 120, 'fixed', 'monthly', null, '2027-02-01',
    null, null, 'fixture sin PII', '[]'::jsonb, '[]'::jsonb, 'fixed_schedule', 'unknown', null, null, null
  );
`);

const contract = JSON.stringify({
  contract_authority: "user_reported", principal_basis: "asset_price_including_down_payment",
  asset_price: 1200, down_payment_amount: 200, scheduled_principal_amount: 1200,
  financed_principal_amount: 1000, opening_principal_amount: 1000, repayment_structure: "fixed_schedule",
  amortization_method: "fixed_installment", installment_amount_mode: "fixed", payment_frequency: "monthly",
  first_due_date: "2027-02-01", interest_rate_type: "nominal_annual_simple", interest_rate_percent: 23,
  interest_rate_basis: "actual_days_360", day_count_basis: "actual_days_360", fee_rule_type: "unknown",
  fee_rule: {}, prepayment_terms: {}, authority_notes: "Reporte del usuario, no confirmado por contrato.",
}).replaceAll("'", "''");
await sql(`select public.upsert_debt_financing_contract_v1('${ids.household}', '${ids.source}', '${contract}'::jsonb);`);
await sql(`select public.create_debt_document_import_job_v2('${ids.household}', '${ids.source}', 'schedule', 'official_noncontractual', 'external_ai', 'mock', 1, '{}'::text[], '{"schema":"CAJA_FAMILIAR_DEBT_DOCUMENT_V2","contains_raw_document":false}'::jsonb);`);

await sql(`
  select public.create_debt_v2(
    '${ids.household}', '${ids.lifecycleSource}', 'Universal fixed lifecycle', 'Proveedor universal', 'other', 'PEN',
    '2027-01-01', '2027-01-01', 1000, 1000, 3, 200, 'fixed', 'monthly', null, '2027-03-01',
    null, null, 'fixture de ciclo universal', '[]'::jsonb, '[]'::jsonb, 'fixed_schedule', 'unknown', null, null, null
  );
`);
const lifecycleContract = JSON.stringify({
  contract_authority: "user_reported", principal_basis: "financed_principal_only",
  financed_principal_amount: 1000, opening_principal_amount: 1000, repayment_structure: "fixed_schedule",
  amortization_method: "fixed_installment", installment_amount_mode: "fixed", payment_frequency: "monthly",
  first_due_date: "2027-03-01", interest_rate_type: "nominal_annual_simple", interest_rate_percent: 23,
  interest_rate_basis: "actual_days_360", day_count_basis: "actual_days_360", fee_rule_type: "unknown",
  fee_rule: {}, prepayment_terms: {}, authority_notes: "Contrato universal reportado para smoke local.",
}).replaceAll("'", "''");
await sql(`select public.upsert_debt_financing_contract_v1('${ids.household}', '${ids.lifecycleSource}', '${lifecycleContract}'::jsonb);`);

const pendingPrepayment = await sql(`select public.record_debt_prepayment_universal_v1(
  '${ids.household}', '${ids.lifecycleSource}', '${ids.lifecyclePrepaymentEvent}', '${ids.lifecyclePrepaymentMovement}',
  '2027-01-10', 100, '${ids.account}', 'Abono anticipado universal', 'Pago de deuda', 100, 0, 0, 0, 0,
  'pending_bank_schedule', true, '[]'::jsonb, null, null
);`);
if (!pendingPrepayment.includes('"idempotentReplay": false')) throw new Error(`standalone prepayment: ${pendingPrepayment}`);
assertEqual(await rawSql(`select round(private.debt2b2_current_principal('${ids.household}', '${ids.lifecycleSource}'), 2)`), "900.00", "principal after standalone prepayment");
assertEqual(await rawSql(`select event_type || '|' || principal_delta::text from public.debt_events where id='${ids.lifecyclePrepaymentEvent}'`), "principal_prepayment|-100", "prepayment event");
const pendingReplay = await sql(`select public.record_debt_prepayment_universal_v1(
  '${ids.household}', '${ids.lifecycleSource}', '${ids.lifecyclePrepaymentEvent}', '${ids.lifecyclePrepaymentMovement}',
  '2027-01-10', 100, '${ids.account}', 'Abono anticipado universal', 'Pago de deuda', 100, 0, 0, 0, 0,
  'pending_bank_schedule', true, '[]'::jsonb, null, null
);`);
if (!pendingReplay.includes('"idempotentReplay": true')) throw new Error(`prepayment idempotency: ${pendingReplay}`);

await sql(`select public.record_debt_payment_universal_v1(
  '${ids.household}', '${ids.lifecycleSource}', '${ids.lifecyclePaymentEvent}', '${ids.lifecyclePaymentMovement}',
  '2027-01-20', 100, '${ids.account}', 'Pago universal', 'Pago de deuda', 100, 0, 0, 0, 0, 0,
  null, true, '[]'::jsonb, '[]'::jsonb, null, null
);`);
await sql(`select public.record_debt_payment_universal_v1(
  '${ids.household}', '${ids.lifecycleSource}', '${ids.lifecycleExtraEvent}', '${ids.lifecycleExtraMovement}',
  '2027-01-25', 150, '${ids.account}', 'Pago con abono extra', 'Pago de deuda', 100, 0, 0, 0, 0, 50,
  'reduce_term', true, '[]'::jsonb, '[]'::jsonb, null, null
);`);
assertEqual(await rawSql(`select round(private.debt2b2_current_principal('${ids.household}', '${ids.lifecycleSource}'), 2)`), "650.00", "principal after payment and extra");

const lifecycleSchedule = JSON.stringify([
  { installment_number: 1, contractual_installment_number: 1, due_date: "2027-03-01", expected_amount: 200, expected_principal: 200, expected_interest: 0, expected_fees: 0, expected_insurance: 0, expected_taxes: 0, row_role: "installment", phase: "post_prepayment", evidence: { source: "local-smoke" } },
  { installment_number: 2, contractual_installment_number: 2, due_date: "2027-04-01", expected_amount: 210, expected_principal: 200, expected_interest: 0, expected_fees: 0, expected_insurance: 0, expected_taxes: 10, row_role: "installment", phase: "post_prepayment", evidence: { source: "local-smoke" } },
  { installment_number: 3, contractual_installment_number: 3, due_date: "2027-05-01", expected_amount: 250, expected_principal: 250, expected_interest: 0, expected_fees: 0, expected_insurance: 0, expected_taxes: 0, row_role: "installment", phase: "post_prepayment", evidence: { source: "local-smoke" } },
]).replaceAll("'", "''");
await sql(`select public.import_debt_schedule_universal_v2('${ids.household}', '${ids.lifecycleSource}', '${ids.lifecycleScheduleEvent}', '2027-02-01', '${lifecycleSchedule}'::jsonb, 'contractual', 'Cronograma universal contractual con impuesto explícito');`);
assertEqual(await rawSql(`select authority || '|' || schedule_source from public.debt_schedule_versions where trigger_event_id='${ids.lifecycleScheduleEvent}'`), "contractual|contractual", "universal schedule authority");
assertEqual(await rawSql(`select expected_taxes::text from public.debt_installments where debt_id='${ids.lifecycleSource}' and installment_number=2`), "10", "positive tax persisted");

const firstLifecycleInstallment = await rawSql(`select id::text from public.debt_installments where debt_id='${ids.lifecycleSource}' and installment_number=1 order by created_at desc limit 1`);
const firstLifecycleAllocation = JSON.stringify([{ installment_id: firstLifecycleInstallment, allocated_amount: 100 }]).replaceAll("'", "''");
await sql(`select public.record_debt_payment_universal_v1(
  '${ids.household}', '${ids.lifecycleSource}', '${ids.lifecyclePartialEvent}', '${ids.lifecyclePartialMovement}',
  '2027-02-10', 100, '${ids.account}', 'Pago parcial universal', 'Pago de deuda', 100, 0, 0, 0, 0, 0,
  null, true, '${firstLifecycleAllocation}'::jsonb, '[]'::jsonb, null, null
);`);
assertEqual(await rawSql(`select round(private.debt2b2_current_principal('${ids.household}', '${ids.lifecycleSource}'), 2)`), "550.00", "principal after partial allocation");
assertEqual(await rawSql(`select round(allocated_amount, 2) from public.debt_event_installment_allocations where event_id='${ids.lifecyclePartialEvent}'`), "100.00", "partial allocation amount");
await sql(`select public.reverse_debt_event_v1('${ids.household}', '${ids.lifecycleSource}', '${ids.lifecyclePartialReversal}', '${ids.lifecyclePartialEvent}', '2027-02-11', 'Reversión del pago parcial', '[]'::jsonb, '');`);
assertEqual(await rawSql(`select round(private.debt2b2_current_principal('${ids.household}', '${ids.lifecycleSource}'), 2)`), "650.00", "principal after partial reversal");

const advanceAllocation = JSON.stringify([{ installment_id: firstLifecycleInstallment, allocated_amount: 200 }]).replaceAll("'", "''");
await sql(`select public.record_debt_installment_advance_universal_v1(
  '${ids.household}', '${ids.lifecycleSource}', '${ids.lifecycleAdvanceEvent}', '${ids.lifecycleAdvanceMovement}',
  '2027-02-12', 200, '${ids.account}', 'Adelanto universal', 'Pago de deuda', 200, 0, 0, 0, 0, true, '${advanceAllocation}'::jsonb
);`);
assertEqual(await rawSql(`select round(private.debt2b2_current_principal('${ids.household}', '${ids.lifecycleSource}'), 2)`), "450.00", "principal after installment advance");

await sql(`select public.create_debt_v2(
  '${ids.household}', '${ids.taxSource}', 'Universal tax schedule', 'Proveedor fiscal', 'other', 'PEN',
  '2027-01-01', '2027-01-01', 1000, 1000, 1, 1100, 'fixed', 'monthly', null, '2027-03-01',
  null, null, 'tax fixture', '[]'::jsonb, '[]'::jsonb, 'fixed_schedule', 'unknown', null, null, null
);`);
const taxSchedule = JSON.stringify([{ installment_number: 1, contractual_installment_number: 1, due_date: "2027-03-01", expected_amount: 1100, expected_principal: 1000, expected_interest: 0, expected_fees: 0, expected_insurance: 0, expected_taxes: 100, row_role: "installment", phase: "contractual", evidence: { source: "local-smoke" } }]).replaceAll("'", "''");
await sql(`select public.import_debt_schedule_universal_v2('${ids.household}', '${ids.taxSource}', '${ids.taxScheduleEvent}', '2027-02-01', '${taxSchedule}'::jsonb, 'contractual', 'Impuesto positivo');`);
assertEqual(await rawSql(`select expected_taxes::text from public.debt_installments where debt_id='${ids.taxSource}'`), "100", "tax-only component persisted");
const taxPrepaymentSchedule = JSON.stringify([{ installment_number: 1, contractual_installment_number: 1, due_date: "2027-04-01", expected_amount: 1000, expected_principal: 900, expected_interest: 0, expected_fees: 0, expected_insurance: 0, expected_taxes: 100, row_role: "installment", phase: "post_prepayment", evidence: { source: "local-smoke" } }]).replaceAll("'", "''");
await sql(`select public.record_debt_prepayment_universal_v1(
  '${ids.household}', '${ids.taxSource}', '${ids.taxPrepaymentEvent}', '${ids.taxPrepaymentMovement}',
  '2027-02-02', 100, '${ids.account}', 'Prepago con impuesto', 'Pago de deuda', 100, 0, 0, 0, 0,
  'other', true, '${taxPrepaymentSchedule}'::jsonb, 'Cronograma posterior con impuesto', 'contractual'
);`);
assertEqual(await rawSql(`select round(private.debt2b2_current_principal('${ids.household}', '${ids.taxSource}'), 2)`), "900.00", "principal after tax prepayment");
assertEqual(await rawSql(`select schedule_source || '|' || authority from public.debt_schedule_versions where trigger_event_id='${ids.taxPrepaymentEvent}'`), "contractual|contractual", "tax prepayment schedule authority");
assertEqual(await rawSql(`select expected_taxes::text from public.debt_installments where debt_id='${ids.taxSource}' order by created_at desc limit 1`), "100", "tax prepayment component persisted");

const postPaymentSchedule = JSON.stringify([{ installment_number: 1, contractual_installment_number: 1, due_date: "2027-03-01", expected_amount: 850, expected_principal: 850, expected_interest: 0, expected_fees: 0, expected_insurance: 0, expected_taxes: 0, row_role: "installment", phase: "post_payment", evidence: { source: "local-smoke" } }]).replaceAll("'", "''");
await sql(`select public.record_debt_payment_universal_v1('${ids.household}', '${ids.source}', '${ids.scheduleEvent}', '${ids.sourceMovement}', '2027-02-01', 150, '${ids.account}', 'Pago universal', 'Pago de deuda', 100, 0, 0, 0, 0, 50, 'reduce_term', true, '[]'::jsonb, '${postPaymentSchedule}'::jsonb, 'Cronograma posterior', 'contractual');`);

assertEqual(await rawSql(`select repayment_structure || '|' || contract_authority from public.debt_financing_contracts where debt_id='${ids.source}'`), "fixed_schedule|user_reported", "generic contract");
assertEqual(await rawSql(`select authority || '|' || schedule_source from public.debt_schedule_versions where debt_id='${ids.source}' order by version_number desc limit 1`), "contractual|contractual", "schedule authority");
assertEqual(await rawSql(`select round(private.debt2b2_current_principal('${ids.household}', '${ids.source}'), 2)`), "850.00", "principal after universal payment");
assertEqual(await rawSql(`select document_schema || '|' || document_authority from public.bank_document_import_jobs where household_id='${ids.household}' order by created_at desc limit 1`), "CAJA_FAMILIAR_DEBT_DOCUMENT_V2|official_noncontractual", "document V2 metadata");
assertEqual(await rawSql(`select phase || '|' || row_role || '|' || (evidence->>'source') from public.debt_installments where debt_id='${ids.source}' order by installment_number desc limit 1`), "post_payment|installment|local-smoke", "schedule row metadata");

const targetContract = JSON.stringify({ contract_authority: "contractual", principal_basis: "financed_principal_only", repayment_structure: "open_ended", installment_amount_mode: "variable", interest_rate_type: "unknown", day_count_basis: "unknown", fee_rule_type: "unknown" }).replaceAll("'", "''");
await sql(`select public.refinance_debt_v1(
  '${ids.household}', '${ids.link}', '${ids.source}', '${ids.sourceEvent}', '${ids.target}', '2027-02-02',
  'Nueva obligación', 'Nuevo acreedor', 'other', 'PEN', 850, 850, null, null, 'variable', null, null, null, null, null,
  'Transferencia sin movimiento', 850, 0, 850, '[]'::jsonb, null, '${targetContract}'::jsonb, null, null, null, null, 0, null, null, null, null, 'sin aporte propio'
);`);
assertEqual(await rawSql(`select status || '|' || round(settled_principal_amount, 2) from public.debt_refinancing_links where id='${ids.link}'`), "active|850.00", "refinance link");
assertEqual(await rawSql(`select status || '|' || round(opening_principal_balance, 2) from public.debts where id='${ids.source}'`), "refinanced|1000.00", "source liability status");
assertEqual(await rawSql(`select round(private.debt2b2_current_principal('${ids.household}', '${ids.source}'), 2)`), "0.00", "source settled through liability transfer");
assertEqual(await rawSql(`select status from public.debts where id='${ids.target}'`), "active", "target liability status");
assertEqual(await rawSql(`select count(*) from public.debts where household_id='${ids.household}' and id <> '${ids.source}' and status='active' and is_archived=false`), "3", "portfolio excludes refinanced source");

const refinanceReplay = await sql(`select public.refinance_debt_v1(
  '${ids.household}', '${ids.link}', '${ids.source}', '${ids.sourceEvent}', '${ids.target}', '2027-02-02',
  'Nueva obligación', 'Nuevo acreedor', 'other', 'PEN', 850, 850, null, null, 'variable', null, null, null, null, null,
  'Transferencia sin movimiento', 850, 0, 850, '[]'::jsonb, null, '${targetContract}'::jsonb, null, null, null, null, 0, null, null, null, null, 'sin aporte propio'
);`);
if (!refinanceReplay.includes('"idempotentReplay": true')) throw new Error(`refinance idempotency: ${refinanceReplay}`);
await expectFailure(`select public.reverse_debt_refinancing_v1('00000000-0000-4000-8000-000000002099', '${ids.link}', '${ids.reversalEvent}', '2027-02-03', 'Ataque cross-household');`, "HOUSEHOLD_ACCESS_DENIED");

await sql(`select public.reverse_debt_refinancing_v1('${ids.household}', '${ids.link}', '${ids.reversalEvent}', '2027-02-03', 'Reversión local');`);
assertEqual(await rawSql(`select status from public.debt_refinancing_links where id='${ids.link}'`), "reversed", "refinance reversal status");
assertEqual(await rawSql(`select status from public.debts where id='${ids.source}'`), "active", "source after safe reversal");
assertEqual(await rawSql(`select is_archived::text from public.debts where id='${ids.target}'`), "true", "target archived after safe reversal");
assertEqual(await rawSql(`select round(private.debt2b2_current_principal('${ids.household}', '${ids.source}'), 2)`), "850.00", "source principal restored after reversal");

await sql(`select public.create_debt_v2('${ids.household}', '${ids.contributionSource}', 'Compra con aporte', 'Acreedor A', 'other', 'PEN', '2027-01-01', '2027-01-01', 1000, 1000, null, null, 'unknown', null, null, null, null, null, '', '[]'::jsonb, '[]'::jsonb, 'open_ended', 'unknown', null, null, null);`);
await sql(`select public.refinance_debt_v1(
  '${ids.household}', '${ids.contributionLink}', '${ids.contributionSource}', '${ids.contributionEvent}', '${ids.contributionTarget}', '2027-02-04',
  'Deuda nueva con aporte', 'Acreedor B', 'other', 'PEN', 1000, 1000, null, null, 'variable', null, null, null, null, null,
  '', 900, 100, 1000, '[]'::jsonb, null, '${targetContract}'::jsonb, '${ids.contributionMovement}', '${ids.account}', 'Aporte propio', 'Pago de deuda', 25, '${ids.costsMovement}', '${ids.account}', 'Costos de cierre', 'Costo financiero', 'aporte y costos locales'
);`);
assertEqual(await rawSql(`select movement_context || '|' || type from public.movements where id='${ids.contributionMovement}'`), "debt_service|egreso", "real contribution movement");
assertEqual(await rawSql(`select movement_context || '|' || type || '|' || amount::text from public.movements where id='${ids.costsMovement}'`), "debt_service|egreso|25.00", "real refinance costs movement");
assertEqual(await rawSql(`select round(refinance_costs_amount, 2) || '|' || refinance_costs_movement_id from public.debt_refinancing_links where id='${ids.contributionLink}'`), `25.00|${ids.costsMovement}`, "refinance costs lineage");
await expectFailure(`select public.reverse_debt_refinancing_v1('${ids.household}', '${ids.contributionLink}', '${ids.contributionEvent}', '2027-02-05', 'Debe bloquearse');`, "DEBT_REFINANCE_REVERSAL_HAS_DEPENDENCIES");

  console.log(JSON.stringify({ container, database, passed: true, cases: ["standalone non-bank prepayment pending schedule", "prepayment idempotent replay", "non-bank payments and extra principal", "contractual schedule replacement with positive taxes", "partial allocation and reversal", "installment advance", "tax-only component persistence", "contractual prepayment schedule with positive taxes", "universal payment with schedule and row metadata", "authority/document V2", "cash-neutral refinance", "idempotent replay", "cross-household rejection", "portfolio excludes refinanced source", "safe reversal", "contribution and closing-cost movements", "contribution dependency guard"] }, null, 2));
