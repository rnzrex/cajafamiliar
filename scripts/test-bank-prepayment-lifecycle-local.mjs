import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = process.env.BANK_PREPAYMENT_DB_CONTAINER ?? "supabase_db_caja-familiar";
const ids = {
  user: "00000000-0000-4000-8000-000000000901",
  household: "00000000-0000-4000-8000-000000000902",
  account: "00000000-0000-4000-8000-000000000903",
  debt: "00000000-0000-4000-8000-000000000904",
  prepaymentEvent: "00000000-0000-4000-8000-000000000905",
  mixedEvent: "00000000-0000-4000-8000-000000000908",
  fallbackEvent: "00000000-0000-4000-8000-000000000909",
  pendingDebt: "00000000-0000-4000-8000-000000000906",
  pendingEvent: "00000000-0000-4000-8000-000000000907",
  openDebt: "00000000-0000-4000-8000-000000000910",
  openEvent: "00000000-0000-4000-8000-000000000911",
  laterScheduleEvent: "00000000-0000-4000-8000-000000000912",
  stalePrepaymentDebt: "00000000-0000-4000-8000-000000000913",
  stalePrepaymentP1: "00000000-0000-4000-8000-000000000914",
  stalePrepaymentP2: "00000000-0000-4000-8000-000000000915",
  staleScheduleDebt: "00000000-0000-4000-8000-000000000916",
  staleScheduleP1: "00000000-0000-4000-8000-000000000917",
  staleScheduleEvent: "00000000-0000-4000-8000-000000000918",
  reversalEstimatedDebt: "00000000-0000-4000-8000-000000000919",
  reversalEstimatedP1: "00000000-0000-4000-8000-000000000920",
  reversalEstimatedR: "00000000-0000-4000-8000-000000000921",
  reversalOfficialDebt: "00000000-0000-4000-8000-000000000922",
  reversalOfficialP1: "00000000-0000-4000-8000-000000000923",
  reversalOfficialR: "00000000-0000-4000-8000-000000000924",
  reversalCriticalDebt: "00000000-0000-4000-8000-000000000925",
  reversalCriticalP1: "00000000-0000-4000-8000-000000000926",
  reversalCriticalR: "00000000-0000-4000-8000-000000000927",
  reversalPendingDebt: "00000000-0000-4000-8000-000000000928",
  reversalPendingP1: "00000000-0000-4000-8000-000000000929",
  reversalPendingR: "00000000-0000-4000-8000-000000000930",
  reversalLaterDebt: "00000000-0000-4000-8000-000000000931",
  reversalLaterP1: "00000000-0000-4000-8000-000000000932",
  reversalLaterR: "00000000-0000-4000-8000-000000000933",
  lateReversalDebt: "00000000-0000-4000-8000-000000000934",
  lateReversalP1: "00000000-0000-4000-8000-000000000935",
  lateReversalR: "00000000-0000-4000-8000-000000000936",
  dependencyPaymentDebt: "00000000-0000-4000-8000-000000000937",
  dependencyPaymentP1: "00000000-0000-4000-8000-000000000938",
  dependencyPaymentP2: "00000000-0000-4000-8000-000000000939",
  dependencyPaymentR: "00000000-0000-4000-8000-000000000940",
  dependencyPrepaymentDebt: "00000000-0000-4000-8000-000000000941",
  dependencyPrepaymentP1: "00000000-0000-4000-8000-000000000942",
  dependencyPrepaymentP2: "00000000-0000-4000-8000-000000000943",
  dependencyPrepaymentR: "00000000-0000-4000-8000-000000000944",
  dependencyAdvanceDebt: "00000000-0000-4000-8000-000000000945",
  dependencyAdvanceP1: "00000000-0000-4000-8000-000000000946",
  dependencyAdvanceA2: "00000000-0000-4000-8000-000000000947",
  dependencyAdvanceR: "00000000-0000-4000-8000-000000000948",
  dependencyScheduleDebt: "00000000-0000-4000-8000-000000000949",
  dependencyScheduleP1: "00000000-0000-4000-8000-000000000950",
  dependencyScheduleS2: "00000000-0000-4000-8000-000000000951",
  dependencyScheduleR: "00000000-0000-4000-8000-000000000952",
  dependencyReversedDebt: "00000000-0000-4000-8000-000000000953",
  dependencyReversedP1: "00000000-0000-4000-8000-000000000954",
  dependencyReversedP2: "00000000-0000-4000-8000-000000000955",
  dependencyReversedR2: "00000000-0000-4000-8000-000000000956",
  dependencyReversedR1: "00000000-0000-4000-8000-000000000957",
  dependencyReversedP3: "00000000-0000-4000-8000-000000000958",
  nestedLifecycleDebt: "00000000-0000-4000-8000-000000000959",
  nestedLifecycleP1: "00000000-0000-4000-8000-000000000960",
  nestedLifecycleP2: "00000000-0000-4000-8000-000000000961",
  nestedLifecycleR2: "00000000-0000-4000-8000-000000000962",
  nestedLifecycleR1: "00000000-0000-4000-8000-000000000963",
  nestedMetadataDebt: "00000000-0000-4000-8000-000000000964",
  nestedMetadataP1: "00000000-0000-4000-8000-000000000965",
  nestedMetadataP2: "00000000-0000-4000-8000-000000000966",
  nestedMetadataR2: "00000000-0000-4000-8000-000000000967",
  nestedMetadataR1: "00000000-0000-4000-8000-000000000968",
  carriedFullDebt: "00000000-0000-4000-8000-000000000969",
  carriedFullPayment: "00000000-0000-4000-8000-000000000970",
  carriedFullP1: "00000000-0000-4000-8000-000000000971",
  carriedFullR1: "00000000-0000-4000-8000-000000000972",
  carriedPartialDebt: "00000000-0000-4000-8000-000000000973",
  carriedPartialPayment: "00000000-0000-4000-8000-000000000974",
  carriedPartialP1: "00000000-0000-4000-8000-000000000975",
  carriedPartialR1: "00000000-0000-4000-8000-000000000976",
  carriedRevertedDebt: "00000000-0000-4000-8000-000000000977",
  carriedRevertedPayment: "00000000-0000-4000-8000-000000000978",
  carriedRevertedPaymentR: "00000000-0000-4000-8000-000000000979",
  carriedRevertedP1: "00000000-0000-4000-8000-000000000980",
  carriedRevertedR1: "00000000-0000-4000-8000-000000000981",
};

function runSql(sql) {
  return execFileAsync(
    "docker",
    ["exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At", "-F", "|", "-c", sql],
    { maxBuffer: 4 * 1024 * 1024 }
  );
}

async function execSql(sql) {
  return (await runSql(sql)).stdout.trim();
}

function withUser(sql) {
  return `begin; select set_config('request.jwt.claim.sub', '${ids.user}', true); select set_config('request.jwt.claim.role', 'authenticated', true); set local role authenticated; ${sql} commit;`;
}

function scheduleRows(contractualStart, count, reportedBalanceStart = null, amount = 100, principal = 80, interest = 20) {
  return JSON.stringify(Array.from({ length: count }, (_, index) => ({
    installment_number: index + 1,
    contractual_installment_number: contractualStart + index,
    due_date: new Date(Date.UTC(2026, 8 + index, 1)).toISOString().slice(0, 10),
    expected_amount: amount,
    expected_principal: principal,
    expected_interest: interest,
    expected_fees: 0,
    expected_insurance: 0,
    ...(reportedBalanceStart == null ? {} : { reported_balance: reportedBalanceStart - index }),
  })));
}

function scheduleRowsWithoutContractual(count = 2) {
  return JSON.stringify(Array.from({ length: count }, (_, index) => ({
    installment_number: index + 1,
    due_date: new Date(Date.UTC(2026, 8 + index, 1)).toISOString().slice(0, 10),
    expected_amount: 100,
    expected_principal: 80,
    expected_interest: 20,
    expected_fees: 0,
    expected_insurance: 0,
  })));
}

function createBaselineLoanSql(debtId, name, {
  trackingStartDate = '2026-08-27',
  firstDueDate = '2026-09-01',
  schedule = scheduleRows(1, 2),
  termInstallments = 2,
  installmentsPaidBeforeTracking = 0,
} = {}) {
  return `select public.create_bank_loan_v1(
    '${ids.household}', '${debtId}', '${name}', 'Banco lifecycle', 'bank_loan', 'PEN',
    '2026-01-01', '${trackingStartDate}', 1000, 1000, ${termInstallments}, 100, 'fixed', 'monthly', null, '${firstDueDate}',
    0, null, '', 'fixed_schedule', 'contract_schedule', null, null,
    jsonb_build_object('loan_subtype', 'personal', 'amortization_method', 'fixed_installment', 'financed_amount', 1000, 'term_installments', ${termInstallments}, 'installments_paid_before_tracking', ${installmentsPaidBeforeTracking}),
    '[]'::jsonb, 'contractual', '${schedule}'::jsonb, '[]'::jsonb
  );`;
}

function recordPrepaymentSql({ debtId, eventId, movementId, eventDate = '2026-08-27', effect, schedule, notes, source }) {
  const notesSql = notes == null ? 'null' : `'${notes}'`;
  const sourceSql = source == null ? 'null' : `'${source}'`;
  return `select public.record_debt_prepayment_v3(
    '${ids.household}', '${debtId}', '${eventId}', '${movementId}',
    '${eventDate}', 100, '${ids.account}', 'Prepago reversal smoke', 'Pago de deuda',
    100, 0, 0, 0, 0, '${effect}', true,
    '${schedule}'::jsonb, ${notesSql}, ${sourceSql}
  );`;
}

function reverseDebtSql({ debtId, reversalEventId, targetEventId, eventDate = '2026-08-28', schedule, description = 'Reversión reversal smoke', notes = null }) {
  const notesSql = notes == null ? 'null' : `'${notes}'`;
  return `select (public.reverse_debt_event_v1(
    '${ids.household}', '${debtId}', '${reversalEventId}', '${targetEventId}',
    '${eventDate}', '${description}', '${schedule}'::jsonb, ${notesSql}
  )->>'idempotentReplay');`;
}

function recordPaymentSql({ debtId, eventId, movementId, eventDate = '2026-08-29', cashAmount = 10, principalAmount = 10, interestAmount = 0, allocations = "'[]'::jsonb" }) {
  return `select public.record_debt_payment_v3(
    '${ids.household}', '${debtId}', '${eventId}', '${movementId}',
    '${eventDate}', ${cashAmount}, '${ids.account}', 'Pago posterior reversal smoke', 'Pago de deuda',
    ${principalAmount}, ${interestAmount}, 0, 0, 0, 0, null, true, ${allocations}, '[]'::jsonb, null, null
  );`;
}

function recordAdvanceSql({ debtId, eventId, eventDate = '2026-08-29' }) {
  return `select public.record_debt_installment_advance_v1(
    '${ids.household}', '${debtId}', '${eventId}', 'advance-${eventId}',
    '${eventDate}', 100, '${ids.account}', 'Adelanto posterior reversal smoke', 'Pago de deuda',
    80, 20, 0, 0, 0, true,
    jsonb_build_array(jsonb_build_object(
      'installment_id', (select i.id from public.debt_installments as i where i.debt_id = '${debtId}' order by i.installment_number limit 1),
      'allocated_amount', 100
    ))
  );`;
}

function mutationFingerprintSql(debtId) {
  return `select (select count(*) from public.debt_events where debt_id = '${debtId}') || '|' || (select count(*) from public.debt_schedule_versions where debt_id = '${debtId}') || '|' || (select count(*) from public.movements where household_id = '${ids.household}' and description like '%reversal smoke%');`;
}

function currentScheduleIdSql(debtId) {
  return `(select s.id from public.debt_schedule_versions as s where s.debt_id = '${debtId}' order by s.version_number desc limit 1)`;
}

async function expectSqlError(sql, expected) {
  try {
    await runSql(sql);
  } catch (error) {
    const output = `${error.stdout ?? ""}\n${error.stderr ?? error.message}`;
    if (!output.includes(expected)) throw new Error(`Expected ${expected}, received:\n${output}`);
    return;
  }
  throw new Error(`Expected SQL error ${expected}, but operation succeeded.`);
}

const cleanupSql = `
  delete from public.debt_event_installment_allocations where household_id = '${ids.household}';
  delete from public.debt_installments where household_id = '${ids.household}';
  delete from public.debt_schedule_versions where household_id = '${ids.household}';
  delete from public.debt_insurance_terms where household_id = '${ids.household}';
  delete from public.bank_loan_profiles where household_id = '${ids.household}';
  delete from public.debt_events where household_id = '${ids.household}';
  delete from public.movements where household_id = '${ids.household}';
  delete from public.debts where household_id = '${ids.household}';
  delete from public.financial_accounts where household_id = '${ids.household}';
  delete from public.household_members where household_id = '${ids.household}';
  delete from public.households where id = '${ids.household}';
  delete from auth.users where id = '${ids.user}';
`;

const lateBaselineSchedule = JSON.stringify([
  { installment_number: 1, contractual_installment_number: 1, due_date: '2026-08-01', expected_amount: 100, expected_principal: 80, expected_interest: 20, expected_fees: 0, expected_insurance: 0 },
  { installment_number: 2, contractual_installment_number: 2, due_date: '2026-09-01', expected_amount: 100, expected_principal: 80, expected_interest: 20, expected_fees: 0, expected_insurance: 0 },
]);

console.log("=== RUNNING LOCAL SQL SMOKE SUITE FOR BANK PREPAYMENT LIFECYCLE V1 ===");

try {
  await execSql("select 1");
  const schemaCheck = await execSql(`
    select
      (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'debt_installments' and column_name in ('contractual_installment_number', 'reported_balance', 'is_paid_before_tracking', 'carried_allocated_amount')) || '|' ||
      (select count(*) from information_schema.routines where routine_schema = 'public' and routine_name = 'update_bank_prepayment_schedule_v1');
  `);
  if (schemaCheck !== "4|1") throw new Error(`Lifecycle schema/RPC check failed: ${schemaCheck}`);

  await execSql(cleanupSql);
  await execSql(`
    insert into auth.users (id, email) values ('${ids.user}', 'bank-prepayment-v1@example.test');
    insert into public.households (id, name) values ('${ids.household}', 'BANK prepayment lifecycle harness');
    insert into public.household_members (household_id, user_id, role, display_name) values ('${ids.household}', '${ids.user}', 'owner', 'BANK prepayment');
    insert into public.financial_accounts (id, household_id, name, reconciliation_type, opening_balance, is_active, sort_order)
      values ('${ids.account}', '${ids.household}', 'Cuenta lifecycle', 'balance', 0, true, 10);
  `);

  console.log("1. Creating a local bank loan baseline...");
  await execSql(withUser(`
    select public.create_bank_loan_v1(
      '${ids.household}', '${ids.debt}', 'Crédito lifecycle', 'Banco lifecycle', 'bank_loan', 'PEN',
      '2026-01-01', '2026-08-27', 1000, 1000, 10, 100, 'fixed', 'monthly', null, '2026-09-01',
      0, null, '', 'fixed_schedule', 'contract_schedule', null, null, null,
      jsonb_build_object('loan_subtype', 'personal', 'amortization_method', 'fixed_installment', 'financed_amount', 1000, 'term_installments', 10),
      '[]'::jsonb, 'contractual',
      '${scheduleRows(1, 10)}'::jsonb,
      '[]'::jsonb
    );
  `));

  console.log("2. Recording an estimated post-prepayment schedule through V3...");
  await execSql(withUser(`
    select public.record_debt_prepayment_v3(
      '${ids.household}', '${ids.debt}', '${ids.prepaymentEvent}', 'bank-prepayment-v1-movement',
      '2026-08-27', 100, '${ids.account}', 'Prepago lifecycle', 'Pago de deuda',
      100, 0, 0, 0, 0, 'reduce_term', true,
      '${scheduleRows(7, 10)}'::jsonb,
      'Estimación local', 'estimated'
    );
  `));
  const estimatedMetadata = await execSql(`
    select s.schedule_source || '|' || s.is_authoritative::text || '|' ||
      (select string_agg(installment_number::text, ',' order by installment_number) from public.debt_installments where schedule_version_id = s.id) || '|' ||
      (select string_agg(contractual_installment_number::text, ',' order by installment_number) from public.debt_installments where schedule_version_id = s.id) || '|' ||
      coalesce((select string_agg(reported_balance::text, ',' order by installment_number) from public.debt_installments where schedule_version_id = s.id), 'NULL') || '|' ||
      (select bool_and(not is_paid_before_tracking)::text from public.debt_installments where schedule_version_id = s.id)
      from public.debt_schedule_versions as s
     where s.trigger_event_id = '${ids.prepaymentEvent}';
  `);
  if (estimatedMetadata !== "estimated|false|1,2,3,4,5,6,7,8,9,10|7,8,9,10,11,12,13,14,15,16|NULL|true") throw new Error(`Estimated metadata was not preserved: ${estimatedMetadata}`);

  const beforeOfficial = await execSql(`select (select count(*) from public.debt_events where debt_id = '${ids.debt}') || '|' || (select count(*) from public.movements where household_id = '${ids.household}') || '|' || (select opening_principal_balance + coalesce((select sum(principal_delta) from public.debt_events where debt_id = '${ids.debt}'), 0) from public.debts where id = '${ids.debt}');`);
  console.log("3. Replacing the estimate with one official contractual schedule...");
  await execSql(withUser(`
    select public.update_bank_prepayment_schedule_v1(
      '${ids.household}', '${ids.debt}', '${ids.prepaymentEvent}', '2026-08-27',
      '${scheduleRows(7, 10, 450)}'::jsonb,
      'Cronograma oficial local'
    );
  `));
  const officialMetadata = await execSql(`
    select s.schedule_source || '|' || s.is_authoritative::text || '|' || s.reason || '|' || (s.trigger_event_id = '${ids.prepaymentEvent}')::text || '|' ||
      (select min(contractual_installment_number)::text || '-' || max(contractual_installment_number)::text from public.debt_installments where schedule_version_id = s.id) || '|' ||
      (select string_agg(reported_balance::text, ',' order by installment_number) from public.debt_installments where schedule_version_id = s.id) || '|' ||
      (select bool_and(not is_paid_before_tracking)::text from public.debt_installments where schedule_version_id = s.id)
      from public.debt_schedule_versions as s
     where s.trigger_event_id = '${ids.prepaymentEvent}'
     order by s.version_number desc limit 1;
  `);
  if (officialMetadata !== "contractual|true|prepayment|true|7-16|450,449,448,447,446,445,444,443,442,441|true") throw new Error(`Official metadata was not preserved: ${officialMetadata}`);
  const history = await execSql(`select string_agg(schedule_source, ',' order by version_number) from public.debt_schedule_versions where trigger_event_id = '${ids.prepaymentEvent}';`);
  if (history !== "estimated,contractual") throw new Error(`Estimated schedule was not preserved: ${history}`);

  console.log("4. Verifying contractual-number fallback and mixed-number rejection...");
  await execSql(withUser(`
    insert into public.debt_events (
      id, household_id, debt_id, event_date, event_type, cash_amount, principal_delta,
      interest_paid, fees_paid, insurance_paid, other_cost_paid, breakdown_complete, registered_by_user_id
    ) values
      ('${ids.mixedEvent}', '${ids.household}', '${ids.debt}', '2026-08-27', 'principal_prepayment', 100, -100, 0, 0, 0, 0, true, '${ids.user}'),
      ('${ids.fallbackEvent}', '${ids.household}', '${ids.debt}', '2026-08-27', 'principal_prepayment', 100, -100, 0, 0, 0, 0, true, '${ids.user}');
  `));
  const mixedRows = JSON.stringify([
    { installment_number: 1, contractual_installment_number: 7, due_date: "2026-09-01", expected_amount: 100, expected_principal: 80, expected_interest: 20, expected_fees: 0, expected_insurance: 0 },
    { installment_number: 2, contractual_installment_number: null, due_date: "2026-10-01", expected_amount: 100, expected_principal: 80, expected_interest: 20, expected_fees: 0, expected_insurance: 0 },
  ]);
  await expectSqlError(withUser(`
    select public.update_bank_prepayment_schedule_v1(
      '${ids.household}', '${ids.debt}', '${ids.mixedEvent}', '2026-08-27',
      '${mixedRows}'::jsonb, 'Mixed numbering must fail'
    );
  `), "INVALID_DEBT_SCHEDULE");
  await execSql(withUser(`
    select public.update_bank_prepayment_schedule_v1(
      '${ids.household}', '${ids.debt}', '${ids.fallbackEvent}', '2026-08-27',
      '${scheduleRowsWithoutContractual()}'::jsonb, 'Fallback numbering local'
    );
  `));
  const fallbackNumbers = await execSql(`
    select string_agg(i.contractual_installment_number::text, ',' order by i.installment_number)
      from public.debt_installments as i
      join public.debt_schedule_versions as s on s.id = i.schedule_version_id
     where s.trigger_event_id = '${ids.fallbackEvent}';
  `);
  if (fallbackNumbers !== "1,2") throw new Error(`Absent contractual numbers did not fall back to internal numbers: ${fallbackNumbers}`);

  console.log("5. Verifying idempotent replay, no extra event/movement, and conflict protection...");
  const replay = await execSql(withUser(`
    select (public.update_bank_prepayment_schedule_v1(
      '${ids.household}', '${ids.debt}', '${ids.prepaymentEvent}', '2026-08-27',
      '${scheduleRows(7, 10, 450)}'::jsonb,
      'Cronograma oficial local'
    )->>'idempotentReplay');
  `));
  if (replay !== "true") throw new Error(`Expected idempotent replay, received: ${replay}`);
  const afterOfficial = await execSql(`select (select count(*) from public.debt_events where debt_id = '${ids.debt}') || '|' || (select count(*) from public.movements where household_id = '${ids.household}') || '|' || (select opening_principal_balance + coalesce((select sum(principal_delta) from public.debt_events where debt_id = '${ids.debt}'), 0) from public.debts where id = '${ids.debt}');`);
  if (afterOfficial !== beforeOfficial) throw new Error(`Official schedule changed financial state: ${beforeOfficial} -> ${afterOfficial}`);
  await expectSqlError(withUser(`
    select public.update_bank_prepayment_schedule_v1(
      '${ids.household}', '${ids.debt}', '${ids.prepaymentEvent}', '2026-08-27',
      '${scheduleRows(8, 10, 450)}'::jsonb,
      'Cronograma oficial local'
    );
  `), "DEBT_EVENT_ID_CONFLICT");
  await expectSqlError(withUser(`
    select public.update_bank_prepayment_schedule_v1(
      '${ids.household}', '${ids.debt}', '${ids.prepaymentEvent}', '2026-08-27',
      '${scheduleRows(7, 10, 451)}'::jsonb,
      'Cronograma oficial local'
    );
  `), "DEBT_EVENT_ID_CONFLICT");

  console.log("6. Verifying exact official replay remains idempotent after a later contractual schedule...");
  await execSql(withUser(`
    select public.update_debt_contractual_schedule_v1(
      '${ids.household}', '${ids.debt}', '${ids.laterScheduleEvent}', '2026-08-29',
      'manual_adjustment', '${scheduleRows(20, 2)}'::jsonb, 'Cronograma contractual posterior'
    );
  `));
  const latestBeforeReplay = await execSql(`select reason || '|' || version_number::text from public.debt_schedule_versions where debt_id = '${ids.debt}' order by version_number desc limit 1;`);
  const replayAfterLaterSchedule = await execSql(withUser(`
    select (public.update_bank_prepayment_schedule_v1(
      '${ids.household}', '${ids.debt}', '${ids.prepaymentEvent}', '2026-08-27',
      '${scheduleRows(7, 10, 450)}'::jsonb,
      'Cronograma oficial local'
    )->>'idempotentReplay');
  `));
  if (replayAfterLaterSchedule !== "true") throw new Error(`Exact replay was blocked by a later schedule: ${replayAfterLaterSchedule}`);
  const latestAfterReplay = await execSql(`select reason || '|' || version_number::text from public.debt_schedule_versions where debt_id = '${ids.debt}' order by version_number desc limit 1;`);
  if (latestAfterReplay !== latestBeforeReplay) throw new Error(`Exact replay changed the later current schedule: ${latestBeforeReplay} -> ${latestAfterReplay}`);

  console.log("7. Pending prepayment transitions to an official schedule without a synthetic event...");
  await execSql(withUser(`
    select public.create_bank_loan_v1(
      '${ids.household}', '${ids.pendingDebt}', 'Crédito pending', 'Banco lifecycle', 'bank_loan', 'PEN',
      '2026-01-01', '2026-08-27', 1000, 1000, 2, 100, 'fixed', 'monthly', null, '2026-09-01',
      0, null, '', 'fixed_schedule', 'contract_schedule', null, null, null,
      jsonb_build_object('loan_subtype', 'personal', 'amortization_method', 'fixed_installment', 'financed_amount', 1000, 'term_installments', 2),
      '[]'::jsonb, 'contractual', '${scheduleRows(1, 2)}'::jsonb, '[]'::jsonb
    );
    select public.record_debt_prepayment_v3(
      '${ids.household}', '${ids.pendingDebt}', '${ids.pendingEvent}', 'bank-prepayment-v1-pending-movement',
      '2026-08-27', 100, '${ids.account}', 'Prepago pending', 'Pago de deuda',
      100, 0, 0, 0, 0, 'pending_bank_schedule', true,
      '[]'::jsonb, null, null
    );
  `));
  const pendingBefore = await execSql(`select count(*) || '|' || (select prepayment_effect from public.debt_events where id = '${ids.pendingEvent}') from public.debt_schedule_versions where debt_id = '${ids.pendingDebt}' and trigger_event_id = '${ids.pendingEvent}';`);
  if (pendingBefore !== "0|pending_bank_schedule") throw new Error(`Pending state was not preserved: ${pendingBefore}`);
  await execSql(withUser(`
    select public.update_bank_prepayment_schedule_v1(
      '${ids.household}', '${ids.pendingDebt}', '${ids.pendingEvent}', '2026-08-27',
      '${scheduleRows(2, 1, 900)}'::jsonb,
      'Cronograma oficial pending local'
    );
  `));
  const pendingAfter = await execSql(`select s.schedule_source || '|' || s.is_authoritative::text || '|' || s.reason || '|' || (s.trigger_event_id = '${ids.pendingEvent}')::text from public.debt_schedule_versions as s where s.debt_id = '${ids.pendingDebt}' order by s.version_number desc limit 1;`);
  if (pendingAfter !== "contractual|true|prepayment|true") throw new Error(`Pending official transition failed: ${pendingAfter}`);
  const pendingEventCount = await execSql(`select (select count(*) from public.debt_events where debt_id = '${ids.pendingDebt}' and event_type = 'principal_adjustment') || '|' || (select count(*) from public.debt_events where id = '${ids.pendingEvent}');`);
  if (pendingEventCount !== "0|1") throw new Error(`Pending transition created an unexpected event: ${pendingEventCount}`);

  console.log("8. Rejecting a stale official target after a later effective prepayment...");
  await execSql(withUser(`
    select public.create_bank_loan_v1(
      '${ids.household}', '${ids.stalePrepaymentDebt}', 'Crédito stale prepayment', 'Banco lifecycle', 'bank_loan', 'PEN',
      '2026-01-01', '2026-08-27', 1000, 1000, 2, 100, 'fixed', 'monthly', null, '2026-09-01',
      0, null, '', 'fixed_schedule', 'contract_schedule', null, null, null,
      jsonb_build_object('loan_subtype', 'personal', 'amortization_method', 'fixed_installment', 'financed_amount', 1000, 'term_installments', 2),
      '[]'::jsonb, 'contractual', '${scheduleRows(1, 2)}'::jsonb, '[]'::jsonb
    );
    select public.record_debt_prepayment_v3(
      '${ids.household}', '${ids.stalePrepaymentDebt}', '${ids.stalePrepaymentP1}', 'bank-prepayment-v1-stale-p1',
      '2026-08-27', 100, '${ids.account}', 'Prepago stale P1', 'Pago de deuda',
      100, 0, 0, 0, 0, 'reduce_term', true,
      '${scheduleRows(7, 2)}'::jsonb, 'Estimación stale P1', 'estimated'
    );
    select public.record_debt_prepayment_v3(
      '${ids.household}', '${ids.stalePrepaymentDebt}', '${ids.stalePrepaymentP2}', 'bank-prepayment-v1-stale-p2',
      '2026-08-28', 50, '${ids.account}', 'Prepago stale P2', 'Pago de deuda',
      50, 0, 0, 0, 0, 'pending_bank_schedule', true,
      '[]'::jsonb, null, null
    );
  `));
  const stalePrepaymentBefore = await execSql(`select count(*)::text from public.debt_schedule_versions where debt_id = '${ids.stalePrepaymentDebt}';`);
  await expectSqlError(withUser(`
    select public.update_bank_prepayment_schedule_v1(
      '${ids.household}', '${ids.stalePrepaymentDebt}', '${ids.stalePrepaymentP1}', '2026-08-27',
      '${scheduleRows(7, 2, 900)}'::jsonb, 'Stale P1 must fail'
    );
  `), "DEBT_PREPAYMENT_SCHEDULE_TARGET_STALE");
  const stalePrepaymentAfter = await execSql(`select count(*)::text || '|' || (select prepayment_effect from public.debt_events where id = '${ids.stalePrepaymentP2}') || '|' || (select count(*)::text from public.debt_schedule_versions where debt_id = '${ids.stalePrepaymentDebt}' and trigger_event_id = '${ids.stalePrepaymentP1}' and schedule_source = 'contractual');`);
  if (stalePrepaymentAfter !== `${stalePrepaymentBefore}|pending_bank_schedule|0`) throw new Error(`Stale prepayment changed current state: ${stalePrepaymentBefore} -> ${stalePrepaymentAfter}`);

  console.log("9. Rejecting a stale official target after a later contractual schedule...");
  await execSql(withUser(`
    select public.create_bank_loan_v1(
      '${ids.household}', '${ids.staleScheduleDebt}', 'Crédito stale schedule', 'Banco lifecycle', 'bank_loan', 'PEN',
      '2026-01-01', '2026-08-27', 1000, 1000, 2, 100, 'fixed', 'monthly', null, '2026-09-01',
      0, null, '', 'fixed_schedule', 'contract_schedule', null, null, null,
      jsonb_build_object('loan_subtype', 'personal', 'amortization_method', 'fixed_installment', 'financed_amount', 1000, 'term_installments', 2),
      '[]'::jsonb, 'contractual', '${scheduleRows(1, 2)}'::jsonb, '[]'::jsonb
    );
    select public.record_debt_prepayment_v3(
      '${ids.household}', '${ids.staleScheduleDebt}', '${ids.staleScheduleP1}', 'bank-prepayment-v1-stale-schedule-p1',
      '2026-08-27', 100, '${ids.account}', 'Prepago stale schedule P1', 'Pago de deuda',
      100, 0, 0, 0, 0, 'pending_bank_schedule', true,
      '[]'::jsonb, null, null
    );
    select public.update_debt_contractual_schedule_v1(
      '${ids.household}', '${ids.staleScheduleDebt}', '${ids.staleScheduleEvent}', '2026-08-29',
      'manual_adjustment', '${scheduleRows(3, 2)}'::jsonb, 'Cronograma posterior stale test'
    );
  `));
  const staleScheduleBefore = await execSql(`select count(*)::text from public.debt_schedule_versions where debt_id = '${ids.staleScheduleDebt}';`);
  await expectSqlError(withUser(`
    select public.update_bank_prepayment_schedule_v1(
      '${ids.household}', '${ids.staleScheduleDebt}', '${ids.staleScheduleP1}', '2026-08-27',
      '${scheduleRows(1, 2, 900)}'::jsonb, 'Stale later schedule must fail'
    );
  `), "DEBT_PREPAYMENT_SCHEDULE_TARGET_STALE");
  const staleScheduleAfter = await execSql(`select count(*)::text || '|' || (select reason from public.debt_schedule_versions where debt_id = '${ids.staleScheduleDebt}' order by version_number desc limit 1) || '|' || (select count(*)::text from public.debt_schedule_versions where debt_id = '${ids.staleScheduleDebt}' and trigger_event_id = '${ids.staleScheduleP1}' and schedule_source = 'contractual');`);
  if (staleScheduleAfter !== `${staleScheduleBefore}|manual_adjustment|0`) throw new Error(`Stale later schedule changed current state: ${staleScheduleBefore} -> ${staleScheduleAfter}`);

  console.log("10. Verifying the fixed-schedule guard for open-ended bank loans...");
  await execSql(withUser(`
    select public.create_bank_loan_v1(
      '${ids.household}', '${ids.openDebt}', 'Crédito abierto', 'Banco lifecycle', 'bank_loan', 'PEN',
      '2026-01-01', '2026-08-27', 1000, 1000, null, null, 'unknown', 'monthly', null, null,
      null, null, 'Open-ended guard fixture', 'open_ended', 'unknown', null, null, null,
      null, '[]'::jsonb, 'manual', '[]'::jsonb, '[]'::jsonb
    );
    insert into public.debt_events (
      id, household_id, debt_id, event_date, event_type, cash_amount, principal_delta,
      interest_paid, fees_paid, insurance_paid, other_cost_paid, breakdown_complete, registered_by_user_id
    ) values (
      '${ids.openEvent}', '${ids.household}', '${ids.openDebt}', '2026-08-27', 'principal_prepayment',
      100, -100, 0, 0, 0, 0, true, '${ids.user}'
    );
  `));
  await expectSqlError(withUser(`
    select public.update_bank_prepayment_schedule_v1(
      '${ids.household}', '${ids.openDebt}', '${ids.openEvent}', '2026-08-27',
      '${scheduleRows(1, 1)}'::jsonb, 'Open-ended must fail'
    );
  `), "DEBT_REPAYMENT_STRUCTURE_UNSUPPORTED");

  console.log("11. Reversing an estimated-only prepayment to the original contractual baseline...");
  await execSql(withUser(`
    ${createBaselineLoanSql(ids.reversalEstimatedDebt, "Crédito reversal estimated")}
    ${recordPrepaymentSql({
      debtId: ids.reversalEstimatedDebt,
      eventId: ids.reversalEstimatedP1,
      movementId: "bank-prepayment-v1-reversal-estimated",
      effect: "reduce_term",
      schedule: scheduleRows(7, 2),
      notes: "Estimación reversal",
      source: "estimated",
    })}
  `));
  await execSql(withUser(reverseDebtSql({
    debtId: ids.reversalEstimatedDebt,
    reversalEventId: ids.reversalEstimatedR,
    targetEventId: ids.reversalEstimatedP1,
    schedule: scheduleRows(1, 2),
  })));
  const estimatedReversalFingerprint = await execSql(`
    select s.version_number::text || '|' || s.schedule_source || '|' || s.is_authoritative::text || '|' ||
      (s.trigger_event_id = '${ids.reversalEstimatedR}')::text || '|' ||
      (select min(contractual_installment_number)::text || '-' || max(contractual_installment_number)::text from public.debt_installments where schedule_version_id = s.id) || '|' ||
      (select string_agg(expected_principal::text, ',' order by installment_number) from public.debt_installments where schedule_version_id = s.id)
      from public.debt_schedule_versions as s
     where s.debt_id = '${ids.reversalEstimatedDebt}'
     order by s.version_number desc limit 1;
  `);
  if (estimatedReversalFingerprint !== "3|contractual|true|true|1-2|80,80") throw new Error(`Estimated-only reversal did not restore V1: ${estimatedReversalFingerprint}`);
  const estimatedReversalEffect = await execSql(`
    select
      (select count(*) from public.debt_events as target where target.id = '${ids.reversalEstimatedP1}' and not exists (select 1 from public.debt_events as reversal where reversal.reversal_of_event_id = target.id)) || '|' ||
      (select ((d.opening_principal_balance + coalesce((select sum(case when exists (select 1 from public.debt_events as reversal where reversal.reversal_of_event_id = e.id) then 0::numeric else e.principal_delta end) from public.debt_events as e where e.debt_id = d.id), 0)) = d.opening_principal_balance)::text from public.debts as d where d.id = '${ids.reversalEstimatedDebt}');
  `);
  if (estimatedReversalEffect !== "0|true") throw new Error(`Estimated-only reversal did not restore effective principal: ${estimatedReversalEffect}`);
  const estimatedReplayBefore = await execSql(`select (select count(*) from public.debt_events where debt_id = '${ids.reversalEstimatedDebt}') || '|' || (select count(*) from public.debt_schedule_versions where debt_id = '${ids.reversalEstimatedDebt}');`);
  const estimatedReplay = await execSql(withUser(reverseDebtSql({
    debtId: ids.reversalEstimatedDebt,
    reversalEventId: ids.reversalEstimatedR,
    targetEventId: ids.reversalEstimatedP1,
    schedule: scheduleRows(1, 2),
  })));
  const estimatedReplayAfter = await execSql(`select (select count(*) from public.debt_events where debt_id = '${ids.reversalEstimatedDebt}') || '|' || (select count(*) from public.debt_schedule_versions where debt_id = '${ids.reversalEstimatedDebt}');`);
  if (estimatedReplay !== "true" || estimatedReplayAfter !== estimatedReplayBefore) throw new Error(`Reversal replay was not idempotent: ${estimatedReplay} ${estimatedReplayBefore} -> ${estimatedReplayAfter}`);
  await expectSqlError(withUser(reverseDebtSql({
    debtId: ids.reversalEstimatedDebt,
    reversalEventId: ids.reversalEstimatedR,
    targetEventId: ids.reversalEstimatedP1,
    schedule: scheduleRows(1, 2, 900),
  })), "DEBT_EVENT_ID_CONFLICT");

  console.log("12. Reversing an official-only prepayment to the original contractual baseline...");
  await execSql(withUser(`
    ${createBaselineLoanSql(ids.reversalOfficialDebt, "Crédito reversal official")}
    ${recordPrepaymentSql({
      debtId: ids.reversalOfficialDebt,
      eventId: ids.reversalOfficialP1,
      movementId: "bank-prepayment-v1-reversal-official",
      effect: "other",
      schedule: scheduleRows(7, 2, 900),
      notes: "Cronograma oficial reversal",
      source: "contractual",
    })}
  `));
  await execSql(withUser(reverseDebtSql({
    debtId: ids.reversalOfficialDebt,
    reversalEventId: ids.reversalOfficialR,
    targetEventId: ids.reversalOfficialP1,
    schedule: scheduleRows(1, 2),
  })));
  const officialReversalFingerprint = await execSql(`
    select s.version_number::text || '|' || s.schedule_source || '|' || s.is_authoritative::text || '|' ||
      (s.trigger_event_id = '${ids.reversalOfficialR}')::text || '|' ||
      (select min(contractual_installment_number)::text || '-' || max(contractual_installment_number)::text from public.debt_installments where schedule_version_id = s.id)
      from public.debt_schedule_versions as s
     where s.debt_id = '${ids.reversalOfficialDebt}'
     order by s.version_number desc limit 1;
  `);
  if (officialReversalFingerprint !== "3|contractual|true|true|1-2") throw new Error(`Official-only reversal did not restore V1: ${officialReversalFingerprint}`);

  console.log("13. Reversing estimated -> official while skipping every schedule generated by the same prepayment...");
  await execSql(withUser(`
    ${createBaselineLoanSql(ids.reversalCriticalDebt, "Crédito reversal critical")}
    ${recordPrepaymentSql({
      debtId: ids.reversalCriticalDebt,
      eventId: ids.reversalCriticalP1,
      movementId: "bank-prepayment-v1-reversal-critical",
      effect: "reduce_term",
      schedule: scheduleRows(7, 2),
      notes: "Estimación critical",
      source: "estimated",
    })}
    select public.update_bank_prepayment_schedule_v1(
      '${ids.household}', '${ids.reversalCriticalDebt}', '${ids.reversalCriticalP1}', '2026-08-27',
      '${scheduleRows(7, 2, 900)}'::jsonb, 'Cronograma oficial critical'
    );
  `));
  const criticalBeforeReversal = await execSql(`select (select count(*) from public.movements where household_id = '${ids.household}') || '|' || (select count(*) from public.debt_schedule_versions where debt_id = '${ids.reversalCriticalDebt}');`);
  await execSql(withUser(reverseDebtSql({
    debtId: ids.reversalCriticalDebt,
    reversalEventId: ids.reversalCriticalR,
    targetEventId: ids.reversalCriticalP1,
    schedule: scheduleRows(1, 2),
  })));
  const criticalAfterReversal = await execSql(`
    select s.version_number::text || '|' || s.schedule_source || '|' || s.is_authoritative::text || '|' ||
      (s.trigger_event_id = '${ids.reversalCriticalR}')::text || '|' ||
      (select min(contractual_installment_number)::text || '-' || max(contractual_installment_number)::text from public.debt_installments where schedule_version_id = s.id) || '|' ||
      (select count(*) from public.movements where household_id = '${ids.household}') || '|' ||
      (select string_agg(schedule_source, ',' order by version_number) from public.debt_schedule_versions where debt_id = '${ids.reversalCriticalDebt}')
      from public.debt_schedule_versions as s
     where s.debt_id = '${ids.reversalCriticalDebt}'
     order by s.version_number desc limit 1;
  `);
  const [criticalMovementCount, criticalScheduleCount] = criticalBeforeReversal.split('|');
  if (criticalAfterReversal !== `4|contractual|true|true|1-2|${criticalMovementCount}|contractual,estimated,contractual,contractual`) throw new Error(`Estimated -> official reversal did not restore V1 or preserve history: ${criticalAfterReversal}`);
  const criticalReversalEffect = await execSql(`
    select
      (select count(*) from public.debt_events as target where target.id = '${ids.reversalCriticalP1}' and not exists (select 1 from public.debt_events as reversal where reversal.reversal_of_event_id = target.id)) || '|' ||
      (select ((d.opening_principal_balance + coalesce((select sum(case when exists (select 1 from public.debt_events as reversal where reversal.reversal_of_event_id = e.id) then 0::numeric else e.principal_delta end) from public.debt_events as e where e.debt_id = d.id), 0)) = d.opening_principal_balance)::text from public.debts as d where d.id = '${ids.reversalCriticalDebt}');
  `);
  if (criticalReversalEffect !== "0|true") throw new Error(`Critical reversal did not make P1 ineffective: ${criticalReversalEffect}`);
  const criticalReplayBefore = await execSql(`select (select count(*) from public.debt_events where debt_id = '${ids.reversalCriticalDebt}') || '|' || (select count(*) from public.debt_schedule_versions where debt_id = '${ids.reversalCriticalDebt}');`);
  const criticalReplay = await execSql(withUser(reverseDebtSql({
    debtId: ids.reversalCriticalDebt,
    reversalEventId: ids.reversalCriticalR,
    targetEventId: ids.reversalCriticalP1,
    schedule: scheduleRows(1, 2),
  })));
  const criticalReplayAfter = await execSql(`select (select count(*) from public.debt_events where debt_id = '${ids.reversalCriticalDebt}') || '|' || (select count(*) from public.debt_schedule_versions where debt_id = '${ids.reversalCriticalDebt}');`);
  if (criticalReplay !== "true" || criticalReplayAfter !== criticalReplayBefore) throw new Error(`Critical reversal replay was not idempotent: ${criticalReplay} ${criticalReplayBefore} -> ${criticalReplayAfter}`);

  console.log("14. Preserving pending prepayment reversal behavior without synthetic schedule restoration...");
  await execSql(withUser(`
    ${createBaselineLoanSql(ids.reversalPendingDebt, "Crédito reversal pending")}
    ${recordPrepaymentSql({
      debtId: ids.reversalPendingDebt,
      eventId: ids.reversalPendingP1,
      movementId: "bank-prepayment-v1-reversal-pending",
      effect: "pending_bank_schedule",
      schedule: "[]",
      notes: null,
      source: null,
    })}
  `));
  await execSql(withUser(reverseDebtSql({
    debtId: ids.reversalPendingDebt,
    reversalEventId: ids.reversalPendingR,
    targetEventId: ids.reversalPendingP1,
    schedule: "[]",
  })));
  const pendingReversalState = await execSql(`
    select
      (select count(*) from public.debt_schedule_versions where debt_id = '${ids.reversalPendingDebt}' and trigger_event_id = '${ids.reversalPendingR}') || '|' ||
      (select max(version_number)::text || '|' || max(schedule_source) from public.debt_schedule_versions where debt_id = '${ids.reversalPendingDebt}') || '|' ||
      (select count(*) from public.debt_events as target where target.id = '${ids.reversalPendingP1}' and not exists (select 1 from public.debt_events as reversal where reversal.reversal_of_event_id = target.id));
  `);
  if (pendingReversalState !== "0|1|contractual|0") throw new Error(`Pending reversal changed schedule state unexpectedly: ${pendingReversalState}`);

  console.log("15. Reversing a pending prepayment after its later official schedule...");
  await execSql(withUser(`
    ${createBaselineLoanSql(ids.reversalLaterDebt, "Crédito reversal later official")}
    ${recordPrepaymentSql({
      debtId: ids.reversalLaterDebt,
      eventId: ids.reversalLaterP1,
      movementId: "bank-prepayment-v1-reversal-later",
      effect: "pending_bank_schedule",
      schedule: "[]",
      notes: null,
      source: null,
    })}
    select public.update_bank_prepayment_schedule_v1(
      '${ids.household}', '${ids.reversalLaterDebt}', '${ids.reversalLaterP1}', '2026-08-27',
      '${scheduleRows(7, 2, 900)}'::jsonb, 'Cronograma posterior reversal'
    );
  `));
  await execSql(withUser(reverseDebtSql({
    debtId: ids.reversalLaterDebt,
    reversalEventId: ids.reversalLaterR,
    targetEventId: ids.reversalLaterP1,
    schedule: scheduleRows(1, 2),
  })));
  const laterReversalFingerprint = await execSql(`
    select s.version_number::text || '|' || s.schedule_source || '|' || s.is_authoritative::text || '|' ||
      (s.trigger_event_id = '${ids.reversalLaterR}')::text || '|' ||
      (select min(contractual_installment_number)::text || '-' || max(contractual_installment_number)::text from public.debt_installments where schedule_version_id = s.id)
      from public.debt_schedule_versions as s
     where s.debt_id = '${ids.reversalLaterDebt}'
     order by s.version_number desc limit 1;
  `);
  if (laterReversalFingerprint !== "3|contractual|true|true|1-2") throw new Error(`Pending -> official reversal did not restore V1: ${laterReversalFingerprint}`);

  console.log("16. Allowing a late reversal to restore baseline due dates before the reversal event...");
  await execSql(withUser(`
    ${createBaselineLoanSql(ids.lateReversalDebt, "Crédito reversal late", {
      trackingStartDate: '2026-01-01',
      firstDueDate: '2026-08-01',
      schedule: lateBaselineSchedule,
    })}
    ${recordPrepaymentSql({
      debtId: ids.lateReversalDebt,
      eventId: ids.lateReversalP1,
      movementId: "bank-prepayment-v1-reversal-late",
      effect: "reduce_term",
      schedule: scheduleRows(7, 2),
      notes: "Estimación reversal late",
      source: "estimated",
    })}
  `));
  await execSql(withUser(reverseDebtSql({
    debtId: ids.lateReversalDebt,
    reversalEventId: ids.lateReversalR,
    targetEventId: ids.lateReversalP1,
    eventDate: '2026-08-28',
    schedule: lateBaselineSchedule,
  })));
  const lateReversalFingerprint = await execSql(`
    select s.effective_date::text || '|' ||
      (select string_agg(due_date::text, ',' order by installment_number)
         from public.debt_installments where schedule_version_id = s.id)
      from public.debt_schedule_versions as s
     where s.debt_id = '${ids.lateReversalDebt}'
     order by s.version_number desc limit 1;
  `);
  if (lateReversalFingerprint !== "2026-08-28|2026-08-01,2026-09-01") throw new Error(`Late reversal did not preserve the baseline due dates: ${lateReversalFingerprint}`);

  console.log("17. Blocking reversal when a later effective regular payment exists without mutating state...");
  await execSql(withUser(`
    ${createBaselineLoanSql(ids.dependencyPaymentDebt, "Crédito dependency payment")}
    ${recordPrepaymentSql({
      debtId: ids.dependencyPaymentDebt,
      eventId: ids.dependencyPaymentP1,
      movementId: "bank-prepayment-v1-dependency-payment-p1",
      effect: "reduce_term",
      schedule: scheduleRows(7, 2),
      notes: "Dependency payment P1",
      source: "estimated",
    })}
    ${recordPaymentSql({ debtId: ids.dependencyPaymentDebt, eventId: ids.dependencyPaymentP2, movementId: "bank-prepayment-v1-dependency-payment-p2" })}
  `));
  const paymentDependencyBefore = await execSql(mutationFingerprintSql(ids.dependencyPaymentDebt));
  await expectSqlError(withUser(reverseDebtSql({
    debtId: ids.dependencyPaymentDebt,
    reversalEventId: ids.dependencyPaymentR,
    targetEventId: ids.dependencyPaymentP1,
    schedule: scheduleRows(1, 2),
  })), "DEBT_REVERSAL_HAS_LATER_DEPENDENCIES");
  const paymentDependencyAfter = await execSql(mutationFingerprintSql(ids.dependencyPaymentDebt));
  if (paymentDependencyAfter !== paymentDependencyBefore) throw new Error(`Later payment blocker mutated state: ${paymentDependencyBefore} -> ${paymentDependencyAfter}`);

  console.log("18. Blocking reversal when a later effective prepayment exists without mutating state...");
  await execSql(withUser(`
    ${createBaselineLoanSql(ids.dependencyPrepaymentDebt, "Crédito dependency prepayment")}
    ${recordPrepaymentSql({
      debtId: ids.dependencyPrepaymentDebt,
      eventId: ids.dependencyPrepaymentP1,
      movementId: "bank-prepayment-v1-dependency-prepayment-p1",
      effect: "reduce_term",
      schedule: scheduleRows(7, 2),
      notes: "Dependency prepayment P1",
      source: "estimated",
    })}
    ${recordPrepaymentSql({
      debtId: ids.dependencyPrepaymentDebt,
      eventId: ids.dependencyPrepaymentP2,
      movementId: "bank-prepayment-v1-dependency-prepayment-p2",
      eventDate: '2026-08-29',
      effect: "pending_bank_schedule",
      schedule: "[]",
      notes: null,
      source: null,
    })}
  `));
  const prepaymentDependencyBefore = await execSql(mutationFingerprintSql(ids.dependencyPrepaymentDebt));
  await expectSqlError(withUser(reverseDebtSql({
    debtId: ids.dependencyPrepaymentDebt,
    reversalEventId: ids.dependencyPrepaymentR,
    targetEventId: ids.dependencyPrepaymentP1,
    schedule: scheduleRows(1, 2),
  })), "DEBT_REVERSAL_HAS_LATER_DEPENDENCIES");
  const prepaymentDependencyAfter = await execSql(mutationFingerprintSql(ids.dependencyPrepaymentDebt));
  if (prepaymentDependencyAfter !== prepaymentDependencyBefore) throw new Error(`Later prepayment blocker mutated state: ${prepaymentDependencyBefore} -> ${prepaymentDependencyAfter}`);

  console.log("19. Blocking reversal when a later installment advance exists without mutating state...");
  await execSql(withUser(`
    ${createBaselineLoanSql(ids.dependencyAdvanceDebt, "Crédito dependency advance")}
    ${recordPrepaymentSql({
      debtId: ids.dependencyAdvanceDebt,
      eventId: ids.dependencyAdvanceP1,
      movementId: "bank-prepayment-v1-dependency-advance-p1",
      effect: "reduce_term",
      schedule: scheduleRows(7, 2),
      notes: "Dependency advance P1",
      source: "estimated",
    })}
    ${recordAdvanceSql({ debtId: ids.dependencyAdvanceDebt, eventId: ids.dependencyAdvanceA2 })}
  `));
  const advanceDependencyBefore = await execSql(mutationFingerprintSql(ids.dependencyAdvanceDebt));
  await expectSqlError(withUser(reverseDebtSql({
    debtId: ids.dependencyAdvanceDebt,
    reversalEventId: ids.dependencyAdvanceR,
    targetEventId: ids.dependencyAdvanceP1,
    schedule: scheduleRows(1, 2),
  })), "DEBT_REVERSAL_HAS_LATER_DEPENDENCIES");
  const advanceDependencyAfter = await execSql(mutationFingerprintSql(ids.dependencyAdvanceDebt));
  if (advanceDependencyAfter !== advanceDependencyBefore) throw new Error(`Later installment advance blocker mutated state: ${advanceDependencyBefore} -> ${advanceDependencyAfter}`);

  console.log("20. Blocking reversal when a later schedule has a different trigger...");
  await execSql(withUser(`
    ${createBaselineLoanSql(ids.dependencyScheduleDebt, "Crédito dependency schedule")}
    ${recordPrepaymentSql({
      debtId: ids.dependencyScheduleDebt,
      eventId: ids.dependencyScheduleP1,
      movementId: "bank-prepayment-v1-dependency-schedule-p1",
      effect: "reduce_term",
      schedule: scheduleRows(7, 2),
      notes: "Dependency schedule P1",
      source: "estimated",
    })}
    select public.update_debt_contractual_schedule_v1(
      '${ids.household}', '${ids.dependencyScheduleDebt}', '${ids.dependencyScheduleS2}', '2026-08-29',
      'manual_adjustment', '${scheduleRows(20, 2)}'::jsonb, 'Dependency later schedule'
    );
  `));
  const scheduleDependencyBefore = await execSql(mutationFingerprintSql(ids.dependencyScheduleDebt));
  await expectSqlError(withUser(reverseDebtSql({
    debtId: ids.dependencyScheduleDebt,
    reversalEventId: ids.dependencyScheduleR,
    targetEventId: ids.dependencyScheduleP1,
    schedule: scheduleRows(1, 2),
  })), "DEBT_REVERSAL_HAS_LATER_DEPENDENCIES");
  const scheduleDependencyAfter = await execSql(mutationFingerprintSql(ids.dependencyScheduleDebt));
  if (scheduleDependencyAfter !== scheduleDependencyBefore) throw new Error(`Later schedule blocker mutated state: ${scheduleDependencyBefore} -> ${scheduleDependencyAfter}`);

  console.log("21. Reversing the later event first, then allowing the original scheduled event reversal...");
  await execSql(withUser(`
    ${createBaselineLoanSql(ids.dependencyReversedDebt, "Crédito dependency reversed")}
    ${recordPrepaymentSql({
      debtId: ids.dependencyReversedDebt,
      eventId: ids.dependencyReversedP1,
      movementId: "bank-prepayment-v1-dependency-reversed-p1",
      effect: "reduce_term",
      schedule: scheduleRows(7, 2),
      notes: "Dependency reversed P1",
      source: "estimated",
    })}
    ${recordPaymentSql({ debtId: ids.dependencyReversedDebt, eventId: ids.dependencyReversedP2, movementId: "bank-prepayment-v1-dependency-reversed-p2" })}
  `));
  await execSql(withUser(reverseDebtSql({
    debtId: ids.dependencyReversedDebt,
    reversalEventId: ids.dependencyReversedR2,
    targetEventId: ids.dependencyReversedP2,
    eventDate: '2026-08-30',
    schedule: "[]",
  })));
  await execSql(withUser(reverseDebtSql({
    debtId: ids.dependencyReversedDebt,
    reversalEventId: ids.dependencyReversedR1,
    targetEventId: ids.dependencyReversedP1,
    eventDate: '2026-08-31',
    schedule: scheduleRows(1, 2),
  })));
  await execSql(withUser(recordPaymentSql({
    debtId: ids.dependencyReversedDebt,
    eventId: ids.dependencyReversedP3,
    movementId: "bank-prepayment-v1-dependency-reversed-p3",
    eventDate: '2026-09-02',
  })));
  const replayAfterLaterActivityBefore = await execSql(mutationFingerprintSql(ids.dependencyReversedDebt));
  const replayAfterLaterActivity = await execSql(withUser(reverseDebtSql({
    debtId: ids.dependencyReversedDebt,
    reversalEventId: ids.dependencyReversedR1,
    targetEventId: ids.dependencyReversedP1,
    eventDate: '2026-08-31',
    schedule: scheduleRows(1, 2),
  })));
  const replayAfterLaterActivityAfter = await execSql(mutationFingerprintSql(ids.dependencyReversedDebt));
  if (replayAfterLaterActivity !== "true" || replayAfterLaterActivityAfter !== replayAfterLaterActivityBefore) throw new Error(`Reversal replay was blocked or mutated after later activity: ${replayAfterLaterActivity} ${replayAfterLaterActivityBefore} -> ${replayAfterLaterActivityAfter}`);

  console.log("22. Preserving effective nested LIFO schedule lineage across P1/P2 reversals...");
  await execSql(withUser(`
    ${createBaselineLoanSql(ids.nestedLifecycleDebt, "Crédito nested lifecycle")}
    ${recordPrepaymentSql({
      debtId: ids.nestedLifecycleDebt,
      eventId: ids.nestedLifecycleP1,
      movementId: "bank-prepayment-v1-nested-p1",
      effect: "reduce_term",
      schedule: scheduleRows(1, 2),
      notes: "Nested P1",
      source: "estimated",
    })}
    ${recordPrepaymentSql({
      debtId: ids.nestedLifecycleDebt,
      eventId: ids.nestedLifecycleP2,
      movementId: "bank-prepayment-v1-nested-p2",
      eventDate: '2026-08-28',
      effect: "reduce_term",
      schedule: scheduleRows(1, 2),
      notes: "Nested P2",
      source: "estimated",
    })}
  `));
  const nestedBefore = await execSql(`select string_agg(version_number::text, ',' order by version_number) from public.debt_schedule_versions where debt_id = '${ids.nestedLifecycleDebt}';`);
  if (nestedBefore !== "1,2,3") throw new Error(`Nested schedule history before reversal was not V1..V3: ${nestedBefore}`);
  await expectSqlError(withUser(reverseDebtSql({
    debtId: ids.nestedLifecycleDebt,
    reversalEventId: ids.nestedLifecycleR1,
    targetEventId: ids.nestedLifecycleP1,
    eventDate: '2026-08-29',
    schedule: scheduleRows(1, 2),
  })), "DEBT_REVERSAL_HAS_LATER_DEPENDENCIES");
  await execSql(withUser(reverseDebtSql({
    debtId: ids.nestedLifecycleDebt,
    reversalEventId: ids.nestedLifecycleR2,
    targetEventId: ids.nestedLifecycleP2,
    eventDate: '2026-08-30',
    schedule: scheduleRows(1, 2),
  })));
  await execSql(withUser(reverseDebtSql({
    debtId: ids.nestedLifecycleDebt,
    reversalEventId: ids.nestedLifecycleR1,
    targetEventId: ids.nestedLifecycleP1,
    eventDate: '2026-08-31',
    schedule: scheduleRows(1, 2),
  })));
  const nestedAfter = await execSql(`
    select string_agg(version_number::text, ',' order by version_number) || '|' ||
      string_agg(coalesce(trigger_event_id::text, 'initial'), ',' order by version_number) || '|' ||
      (select count(*) from public.debt_events where debt_id = '${ids.nestedLifecycleDebt}' and event_type = 'reversal')
      from public.debt_schedule_versions where debt_id = '${ids.nestedLifecycleDebt}';
  `);
  if (nestedAfter !== `1,2,3,4,5|initial,${ids.nestedLifecycleP1},${ids.nestedLifecycleP2},${ids.nestedLifecycleR2},${ids.nestedLifecycleR1}|2`) throw new Error(`Nested P1/P2 reversal did not preserve effective LIFO history: ${nestedAfter}`);

  console.log("23. Releasing nested estimated/official P2 lineage only after P2 reversal...");
  await execSql(withUser(`
    ${createBaselineLoanSql(ids.nestedMetadataDebt, "Crédito nested metadata")}
    ${recordPrepaymentSql({
      debtId: ids.nestedMetadataDebt,
      eventId: ids.nestedMetadataP1,
      movementId: "bank-prepayment-v1-nested-metadata-p1",
      effect: "reduce_term",
      schedule: scheduleRows(1, 2),
      notes: "Nested metadata P1",
      source: "estimated",
    })}
    ${recordPrepaymentSql({
      debtId: ids.nestedMetadataDebt,
      eventId: ids.nestedMetadataP2,
      movementId: "bank-prepayment-v1-nested-metadata-p2",
      eventDate: '2026-08-28',
      effect: "reduce_term",
      schedule: scheduleRows(1, 2),
      notes: "Nested metadata P2 estimate",
      source: "estimated",
    })}
    select public.update_bank_prepayment_schedule_v1(
      '${ids.household}', '${ids.nestedMetadataDebt}', '${ids.nestedMetadataP2}', '2026-08-28',
      '${scheduleRows(1, 2)}'::jsonb, 'Nested metadata P2 official'
    );
  `));
  await expectSqlError(withUser(reverseDebtSql({
    debtId: ids.nestedMetadataDebt,
    reversalEventId: ids.nestedMetadataR1,
    targetEventId: ids.nestedMetadataP1,
    eventDate: '2026-08-29',
    schedule: scheduleRows(1, 2),
  })), "DEBT_REVERSAL_HAS_LATER_DEPENDENCIES");
  await execSql(withUser(reverseDebtSql({
    debtId: ids.nestedMetadataDebt,
    reversalEventId: ids.nestedMetadataR2,
    targetEventId: ids.nestedMetadataP2,
    eventDate: '2026-08-30',
    schedule: scheduleRows(1, 2),
  })));
  await execSql(withUser(reverseDebtSql({
    debtId: ids.nestedMetadataDebt,
    reversalEventId: ids.nestedMetadataR1,
    targetEventId: ids.nestedMetadataP1,
    eventDate: '2026-08-31',
    schedule: scheduleRows(1, 2),
  })));
  const nestedMetadataAfter = await execSql(`select string_agg(schedule_source || ':' || version_number::text, ',' order by version_number) from public.debt_schedule_versions where debt_id = '${ids.nestedMetadataDebt}';`);
  if (nestedMetadataAfter !== `contractual:1,estimated:2,estimated:3,contractual:4,estimated:5,contractual:6`) throw new Error(`Nested estimated/official history was not retained: ${nestedMetadataAfter}`);

  console.log("24. Carrying pretracking state and full effective allocation coverage without duplication...");
  const fullAllocation = `jsonb_build_array(jsonb_build_object(
    'installment_id', (select i.id from public.debt_installments as i where i.debt_id = '${ids.carriedFullDebt}' and i.schedule_version_id = ${currentScheduleIdSql(ids.carriedFullDebt)} and i.installment_number = 3),
    'allocated_amount', 100
  ))`;
  await execSql(withUser(`
    ${createBaselineLoanSql(ids.carriedFullDebt, "Crédito carried full", { termInstallments: 6, installmentsPaidBeforeTracking: 2, schedule: scheduleRows(1, 6) })}
    ${recordPaymentSql({ debtId: ids.carriedFullDebt, eventId: ids.carriedFullPayment, movementId: "bank-prepayment-v1-carried-full-payment", eventDate: '2026-08-20', cashAmount: 100, principalAmount: 80, interestAmount: 20, allocations: fullAllocation })}
    ${recordPrepaymentSql({
      debtId: ids.carriedFullDebt,
      eventId: ids.carriedFullP1,
      movementId: "bank-prepayment-v1-carried-full-p1",
      effect: "reduce_term",
      schedule: scheduleRows(1, 6),
      notes: "Carried full P1",
      source: "estimated",
    })}
  `));
  await execSql(withUser(reverseDebtSql({
    debtId: ids.carriedFullDebt,
    reversalEventId: ids.carriedFullR1,
    targetEventId: ids.carriedFullP1,
    schedule: scheduleRows(1, 6),
  })));
  const carriedFullState = await execSql(`
    select string_agg((case when is_paid_before_tracking then '1' else '0' end) || ':' || carried_allocated_amount::text, ',' order by installment_number) || '|' ||
      (select count(*) from public.debt_event_installment_allocations where debt_id = '${ids.carriedFullDebt}') || '|' ||
      (select count(*) from public.movements where household_id = '${ids.household}' and id in ('bank-prepayment-v1-carried-full-payment', 'bank-prepayment-v1-carried-full-p1')) || '|' ||
      (select count(*) from public.debt_events where debt_id = '${ids.carriedFullDebt}')
     from public.debt_installments as i
     where i.debt_id = '${ids.carriedFullDebt}'
       and i.schedule_version_id = ${currentScheduleIdSql(ids.carriedFullDebt)};
  `);
  if (carriedFullState !== "1:0,1:0,0:100,0:0,0:0,0:0|1|2|3") throw new Error(`Full carried state or ledger counts were incorrect: ${carriedFullState}`);
  await expectSqlError(withUser(recordPaymentSql({
    debtId: ids.carriedFullDebt,
    eventId: "00000000-0000-4000-8000-000000000982",
    movementId: "bank-prepayment-v1-carried-full-overage",
    eventDate: '2026-09-01',
    cashAmount: 1,
    principalAmount: 1,
    allocations: `jsonb_build_array(jsonb_build_object('installment_id', (select i.id from public.debt_installments as i where i.debt_id = '${ids.carriedFullDebt}' and i.schedule_version_id = ${currentScheduleIdSql(ids.carriedFullDebt)} and i.installment_number = 3), 'allocated_amount', 1))`,
  })), "INVALID_DEBT_ALLOCATIONS");
  const carriedFullReplayBefore = await execSql(`select (select count(*) from public.debt_events where debt_id = '${ids.carriedFullDebt}') || '|' || (select count(*) from public.debt_schedule_versions where debt_id = '${ids.carriedFullDebt}') || '|' || (select count(*) from public.debt_event_installment_allocations where debt_id = '${ids.carriedFullDebt}');`);
  const carriedFullReplay = await execSql(withUser(reverseDebtSql({ debtId: ids.carriedFullDebt, reversalEventId: ids.carriedFullR1, targetEventId: ids.carriedFullP1, schedule: scheduleRows(1, 6) })));
  const carriedFullReplayAfter = await execSql(`select (select count(*) from public.debt_events where debt_id = '${ids.carriedFullDebt}') || '|' || (select count(*) from public.debt_schedule_versions where debt_id = '${ids.carriedFullDebt}') || '|' || (select count(*) from public.debt_event_installment_allocations where debt_id = '${ids.carriedFullDebt}');`);
  if (carriedFullReplay !== "true" || carriedFullReplayAfter !== carriedFullReplayBefore) throw new Error(`Full carried exact replay changed state: ${carriedFullReplay} ${carriedFullReplayBefore} -> ${carriedFullReplayAfter}`);

  console.log("25. Carrying partial coverage, accepting the exact remainder, and rejecting overage...");
  const partialAllocation = `jsonb_build_array(jsonb_build_object(
    'installment_id', (select i.id from public.debt_installments as i where i.debt_id = '${ids.carriedPartialDebt}' and i.schedule_version_id = ${currentScheduleIdSql(ids.carriedPartialDebt)} and i.installment_number = 3),
    'allocated_amount', 40
  ))`;
  await execSql(withUser(`
    ${createBaselineLoanSql(ids.carriedPartialDebt, "Crédito carried partial", { termInstallments: 6, schedule: scheduleRows(1, 6) })}
    ${recordPaymentSql({ debtId: ids.carriedPartialDebt, eventId: ids.carriedPartialPayment, movementId: "bank-prepayment-v1-carried-partial-payment", eventDate: '2026-08-20', cashAmount: 40, principalAmount: 32, interestAmount: 8, allocations: partialAllocation })}
    ${recordPrepaymentSql({
      debtId: ids.carriedPartialDebt,
      eventId: ids.carriedPartialP1,
      movementId: "bank-prepayment-v1-carried-partial-p1",
      effect: "reduce_term",
      schedule: scheduleRows(1, 6),
      notes: "Carried partial P1",
      source: "estimated",
    })}
  `));
  await execSql(withUser(reverseDebtSql({ debtId: ids.carriedPartialDebt, reversalEventId: ids.carriedPartialR1, targetEventId: ids.carriedPartialP1, schedule: scheduleRows(1, 6) })));
  const partialInstallmentIdSql = `(select i.id from public.debt_installments as i where i.debt_id = '${ids.carriedPartialDebt}' order by i.installment_number offset 2 limit 1)`;
  const carriedPartialBefore = await execSql(`select carried_allocated_amount::text || '|' || (select count(*) from public.debt_event_installment_allocations where debt_id = '${ids.carriedPartialDebt}') from public.debt_installments where debt_id = '${ids.carriedPartialDebt}' and schedule_version_id = ${currentScheduleIdSql(ids.carriedPartialDebt)} and installment_number = 3;`);
  if (carriedPartialBefore !== "40|1") throw new Error(`Partial carried coverage was not restored: ${carriedPartialBefore}`);
  await execSql(withUser(recordPaymentSql({
    debtId: ids.carriedPartialDebt,
    eventId: "00000000-0000-4000-8000-000000000983",
    movementId: "bank-prepayment-v1-carried-partial-remainder",
    eventDate: '2026-09-01',
    cashAmount: 60,
    principalAmount: 48,
    interestAmount: 12,
    allocations: `jsonb_build_array(jsonb_build_object('installment_id', ${partialInstallmentIdSql}, 'allocated_amount', 60))`,
  })));
  const carriedPartialAfter = await execSql(`select carried_allocated_amount::text || '|' || (select sum(allocated_amount)::text from public.debt_event_installment_allocations where debt_id = '${ids.carriedPartialDebt}') from public.debt_installments where debt_id = '${ids.carriedPartialDebt}' and schedule_version_id = ${currentScheduleIdSql(ids.carriedPartialDebt)} and installment_number = 3;`);
  if (carriedPartialAfter !== "40|100") throw new Error(`Partial carried plus new allocation was not exactly 100: ${carriedPartialAfter}`);
  await expectSqlError(withUser(recordPaymentSql({
    debtId: ids.carriedPartialDebt,
    eventId: "00000000-0000-4000-8000-000000000984",
    movementId: "bank-prepayment-v1-carried-partial-overage",
    eventDate: '2026-09-02',
    cashAmount: 1,
    principalAmount: 1,
    allocations: `jsonb_build_array(jsonb_build_object('installment_id', ${partialInstallmentIdSql}, 'allocated_amount', 1))`,
  })), "INVALID_DEBT_ALLOCATIONS");

  console.log("26. Excluding reverted pre-target allocations from restored carried coverage...");
  const revertedAllocation = `jsonb_build_array(jsonb_build_object(
    'installment_id', (select i.id from public.debt_installments as i where i.debt_id = '${ids.carriedRevertedDebt}' and i.schedule_version_id = ${currentScheduleIdSql(ids.carriedRevertedDebt)} and i.installment_number = 3),
    'allocated_amount', 40
  ))`;
  await execSql(withUser(`
    ${createBaselineLoanSql(ids.carriedRevertedDebt, "Crédito carried reverted", { termInstallments: 6, schedule: scheduleRows(1, 6) })}
    ${recordPaymentSql({ debtId: ids.carriedRevertedDebt, eventId: ids.carriedRevertedPayment, movementId: "bank-prepayment-v1-carried-reverted-payment", eventDate: '2026-08-20', cashAmount: 40, principalAmount: 32, interestAmount: 8, allocations: revertedAllocation })}
  `));
  await execSql(withUser(reverseDebtSql({ debtId: ids.carriedRevertedDebt, reversalEventId: ids.carriedRevertedPaymentR, targetEventId: ids.carriedRevertedPayment, eventDate: '2026-08-21', schedule: "[]" })));
  await execSql(withUser(`
    ${recordPrepaymentSql({
      debtId: ids.carriedRevertedDebt,
      eventId: ids.carriedRevertedP1,
      movementId: "bank-prepayment-v1-carried-reverted-p1",
      effect: "reduce_term",
      schedule: scheduleRows(1, 6),
      notes: "Carried reverted P1",
      source: "estimated",
    })}
  `));
  await execSql(withUser(reverseDebtSql({ debtId: ids.carriedRevertedDebt, reversalEventId: ids.carriedRevertedR1, targetEventId: ids.carriedRevertedP1, schedule: scheduleRows(1, 6) })));
  const carriedRevertedState = await execSql(`select carried_allocated_amount::text || '|' || (select count(*) from public.debt_event_installment_allocations where debt_id = '${ids.carriedRevertedDebt}') from public.debt_installments where debt_id = '${ids.carriedRevertedDebt}' and schedule_version_id = ${currentScheduleIdSql(ids.carriedRevertedDebt)} and installment_number = 3;`);
  if (carriedRevertedState !== "0|1") throw new Error(`Reverted pre-target allocation was carried or duplicated: ${carriedRevertedState}`);

  console.log("SUCCESS! BANK PREPAYMENT LIFECYCLE V1 local schema, metadata, numbering, replay, pending transition, stale guards, reversal baselines, late-reversal validation, effective nested LIFO lineage, restored installment state carry, allocation overage, and ledger-protection checks passed.");
} catch (error) {
  console.error("SQL SMOKE TEST FAILED:", error);
  process.exitCode = 1;
} finally {
  try {
    await execSql(cleanupSql);
  } catch {
    // Keep the original smoke-test failure visible if the local container is unavailable.
  }
}
