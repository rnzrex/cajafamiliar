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

console.log("=== RUNNING LOCAL SQL SMOKE SUITE FOR BANK PREPAYMENT LIFECYCLE V1 ===");

try {
  await execSql("select 1");
  const schemaCheck = await execSql(`
    select
      (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'debt_installments' and column_name in ('contractual_installment_number', 'reported_balance', 'is_paid_before_tracking')) || '|' ||
      (select count(*) from information_schema.routines where routine_schema = 'public' and routine_name = 'update_bank_prepayment_schedule_v1');
  `);
  if (schemaCheck !== "3|1") throw new Error(`Lifecycle schema/RPC check failed: ${schemaCheck}`);

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

  console.log("SUCCESS! BANK PREPAYMENT LIFECYCLE V1 local schema, metadata, numbering, replay, pending transition, fixed-schedule guard, and ledger-protection checks passed.");
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
