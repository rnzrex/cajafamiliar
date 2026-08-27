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
  pendingDebt: "00000000-0000-4000-8000-000000000906",
  pendingEvent: "00000000-0000-4000-8000-000000000907",
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
      jsonb_build_object('loan_subtype', 'personal', 'amortization_method', 'fixed_installment', 'financed_amount', 1000, 'term_installments', 2),
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
      '${scheduleRows(7, 10, 500)}'::jsonb,
      'Estimación local', 'estimated'
    );
  `));
  const estimatedMetadata = await execSql(`
    select s.schedule_source || '|' || s.is_authoritative::text || '|' ||
      (select string_agg(installment_number::text, ',' order by installment_number) from public.debt_installments where schedule_version_id = s.id) || '|' ||
      (select string_agg(contractual_installment_number::text, ',' order by installment_number) from public.debt_installments where schedule_version_id = s.id) || '|' ||
      (select string_agg(reported_balance::text, ',' order by installment_number) from public.debt_installments where schedule_version_id = s.id) || '|' ||
      (select bool_and(not is_paid_before_tracking)::text from public.debt_installments where schedule_version_id = s.id)
      from public.debt_schedule_versions as s
     where s.trigger_event_id = '${ids.prepaymentEvent}';
  `);
  if (estimatedMetadata !== "estimated|false|1,2,3,4,5,6,7,8,9,10|7,8,9,10,11,12,13,14,15,16|500,499,498,497,496,495,494,493,492,491|true") throw new Error(`Estimated metadata was not preserved: ${estimatedMetadata}`);

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

  console.log("4. Verifying idempotent replay, no extra event/movement, and conflict protection...");
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

  console.log("5. Pending prepayment transitions to an official schedule without a synthetic event...");
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

  console.log("SUCCESS! BANK PREPAYMENT LIFECYCLE V1 local schema, metadata, replay, pending transition, and ledger-protection checks passed.");
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
