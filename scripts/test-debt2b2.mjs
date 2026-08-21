import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = process.env.DEBT2B2_DB_CONTAINER ?? "supabase_db_debt2b2-local";
const ids = {
  user: "00000000-0000-4000-8000-000000000101",
  household: "00000000-0000-4000-8000-000000000102",
  account: "00000000-0000-4000-8000-000000000103",
  paymentDebt: "00000000-0000-4000-8000-000000000104",
  prepaymentDebt: "00000000-0000-4000-8000-000000000105",
  payoffDebt: "00000000-0000-4000-8000-000000000106",
  concurrentDebtA: "00000000-0000-4000-8000-000000000107",
  concurrentDebtB: "00000000-0000-4000-8000-000000000108",
  precisionDebt: "00000000-0000-4000-8000-000000000109",
  paymentEvent: "00000000-0000-4000-8000-000000000110",
  prepaymentEvent: "00000000-0000-4000-8000-000000000111",
  prepaymentReversal: "00000000-0000-4000-8000-000000000112",
  payoffEvent: "00000000-0000-4000-8000-000000000113",
  sharedInitialEvent: "00000000-0000-4000-8000-000000000114",
  sharedReversal: "00000000-0000-4000-8000-000000000115",
  concurrentEventA: "00000000-0000-4000-8000-000000000116",
  concurrentEventB: "00000000-0000-4000-8000-000000000117",
  precisionEvent: "00000000-0000-4000-8000-000000000118",
  sharedMovement: "debt2b2-shared-movement",
};

const schedule = "jsonb_build_array(jsonb_build_object('installment_number', 1, 'due_date', '2026-09-20', 'expected_amount', 100, 'expected_principal', 80, 'expected_interest', 20))";

await execSql(`
  delete from public.debt_event_installment_allocations where household_id = '${ids.household}';
  delete from public.debt_installments where household_id = '${ids.household}';
  delete from public.debt_schedule_versions where household_id = '${ids.household}';
  delete from public.debt_events where household_id = '${ids.household}';
  delete from public.movements where household_id = '${ids.household}';
  delete from public.debt_collaterals where household_id = '${ids.household}';
  delete from public.debts where household_id = '${ids.household}';
  delete from public.financial_accounts where household_id = '${ids.household}';
  delete from public.households where id = '${ids.household}';
  delete from auth.users where id = '${ids.user}';
  insert into auth.users (id, email) values ('${ids.user}', 'debt2b2-harness@example.test');
  insert into public.households (id, name) values ('${ids.household}', 'DEBT-2B.2 harness');
  insert into public.household_members (household_id, user_id, role, display_name)
    values ('${ids.household}', '${ids.user}', 'owner', 'Harness User');
  insert into public.financial_accounts (id, household_id, name, reconciliation_type, opening_balance, is_active, sort_order)
    values ('${ids.account}', '${ids.household}', 'Harness Bank', 'balance', 0, true, 10);
  insert into public.debts (id, household_id, name, creditor_name, debt_kind, tracking_start_date, opening_principal_balance, created_by_user_id)
  values
    ('${ids.paymentDebt}', '${ids.household}', 'Payment Debt', 'Harness Creditor', 'bank_loan', '2026-08-20', 1000, '${ids.user}'),
    ('${ids.prepaymentDebt}', '${ids.household}', 'Prepayment Debt', 'Harness Creditor', 'bank_loan', '2026-08-20', 500, '${ids.user}'),
    ('${ids.payoffDebt}', '${ids.household}', 'Payoff Debt', 'Harness Creditor', 'bank_loan', '2026-08-20', 250, '${ids.user}'),
    ('${ids.concurrentDebtA}', '${ids.household}', 'Concurrent Debt A', 'Harness Creditor', 'bank_loan', '2026-08-20', 1000, '${ids.user}'),
    ('${ids.concurrentDebtB}', '${ids.household}', 'Concurrent Debt B', 'Harness Creditor', 'bank_loan', '2026-08-20', 1000, '${ids.user}'),
    ('${ids.precisionDebt}', '${ids.household}', 'Precision Debt', 'Harness Creditor', 'bank_loan', '2026-08-20', 1000, '${ids.user}');
`);

await execSql(withUser(`
  select public.record_debt_payment_v1(
    '${ids.household}', '${ids.paymentDebt}', '${ids.paymentEvent}', 'debt2b2-payment-movement',
    '2026-08-20', 100, '${ids.account}', 'Payment', 'Debt', 80, 20, 0, 0, 0, true, '[]'::jsonb
  );
`));

await execSql(withUser(`
  select public.record_debt_payment_v1(
    '${ids.household}', '${ids.paymentDebt}', '${ids.paymentEvent}', 'debt2b2-payment-movement',
    '2026-08-20', 100, '${ids.account}', 'Replay metadata', 'Other', 80, 20, 0, 0, 0, true, '[]'::jsonb
  );
`));

await execSql(withUser(`
  select public.record_debt_prepayment_v1(
    '${ids.household}', '${ids.prepaymentDebt}', '${ids.prepaymentEvent}', 'debt2b2-prepayment-movement',
    '2026-08-20', 100, '${ids.account}', 'Prepayment', 'Debt', 80, 20, 0, 0, 0, true,
    ${schedule}, 'Prepayment schedule'
  );
`));

await execSql(withUser(`
  select public.reverse_debt_event_v1(
    '${ids.household}', '${ids.prepaymentDebt}', '${ids.prepaymentReversal}', '${ids.prepaymentEvent}',
    '2026-08-21', 'Reverse prepayment', ${schedule}, 'Reversal schedule'
  );
`));

await execSql(withUser(`
  select public.record_debt_payoff_v1(
    '${ids.household}', '${ids.payoffDebt}', '${ids.payoffEvent}', 'debt2b2-payoff-movement',
    '2026-08-20', 250, '${ids.account}', 'Payoff', 'Debt', 0, 0, 0, 0, true
  );
`));

await execSql(withUser(`
  select public.record_debt_payment_v1(
    '${ids.household}', '${ids.concurrentDebtA}', '${ids.sharedInitialEvent}', '${ids.sharedMovement}',
    '2026-08-20', 100, '${ids.account}', 'Shared payment', 'Debt', 80, 20, 0, 0, 0, true, '[]'::jsonb
  );
`));

await execSql(withUser(`
  select public.reverse_debt_event_v1(
    '${ids.household}', '${ids.concurrentDebtA}', '${ids.sharedReversal}', '${ids.sharedInitialEvent}',
    '2026-08-21', 'Reverse shared payment', '[]'::jsonb, null
  );
`));

const concurrentSql = withUser(`
  select public.record_debt_payment_v1(
    '${ids.household}', DEBT_ID, EVENT_ID, '${ids.sharedMovement}',
    '2026-08-20', 100, '${ids.account}', 'Shared payment', 'Debt', 80, 20, 0, 0, 0, true, '[]'::jsonb
  );
`);
const [concurrentA, concurrentB] = await Promise.all([
  runSql(concurrentSql.replace("DEBT_ID", `'${ids.concurrentDebtA}'`).replace("EVENT_ID", `'${ids.concurrentEventA}'`)),
  runSql(concurrentSql.replace("DEBT_ID", `'${ids.concurrentDebtB}'`).replace("EVENT_ID", `'${ids.concurrentEventB}'`)),
]);
const concurrentResults = [concurrentA, concurrentB];
if (concurrentResults.filter((result) => result.ok).length !== 1) {
  throw new Error(`La prueba concurrente por Movement esperaba exactamente un éxito: ${JSON.stringify(concurrentResults)}`);
}
const losingResult = concurrentResults.find((result) => !result.ok);
const losingError = losingResult ? `${losingResult.stdout}\n${losingResult.stderr}` : "";
const losingErrorCode = losingError.match(/ERROR:\s+([A-Z0-9_]+)/)?.[1];
if (losingErrorCode !== "DEBT_MOVEMENT_ALREADY_LINKED") {
  throw new Error(`El perdedor concurrente devolvió ${losingErrorCode ?? "ningún código"}, no DEBT_MOVEMENT_ALREADY_LINKED.`);
}

await expectSqlError(withUser(`
  select public.record_debt_payment_v1(
    '${ids.household}', '${ids.precisionDebt}', '${ids.precisionEvent}', 'debt2b2-precision-movement',
    '2026-08-20', 100.001, '${ids.account}', 'Precision', 'Debt', 100, 0, 0, 0, 0, false, '[]'::jsonb
  );
`), "INVALID_DEBT_PAYMENT");

assertEqual(await scalar(`select count(*) from public.debt_events where id = '${ids.paymentEvent}';`), "1", "payment idempotency");
assertEqual(await scalar(`select count(*) from public.movements where id = 'debt2b2-payment-movement';`), "1", "payment movement idempotency");
assertEqual(await scalar(`select status from public.debts where id = '${ids.payoffDebt}';`), "paid_off", "payoff status");
assertEqual(await scalar(`select count(*) from public.debt_schedule_versions where trigger_event_id = '${ids.prepaymentReversal}' and reason = 'reversal';`), "1", "reversal schedule");
assertEqual(await scalar(`select movement_context || '|' || amount::text from public.movements where id = 'debt2b2-payment-movement';`), "debt_service|100.00", "debt movement semantics");
assertEqual(await scalar(`select count(*) from public.movements where id = '${ids.sharedMovement}';`), "1", "shared movement remains physical");
assertEqual(await scalar(`
  select count(*)
    from public.debt_events as e
   where e.movement_id = '${ids.sharedMovement}'
     and e.event_type in ('payment', 'principal_prepayment', 'payoff')
     and not exists (
       select 1
         from public.debt_events as r
        where r.household_id = e.household_id
          and r.debt_id = e.debt_id
          and r.event_type = 'reversal'
          and r.reversal_of_event_id = e.id
     );
`), "1", "shared movement effective-event exclusivity");

console.log("OK: DEBT-2B.2 payment, replay, prepayment, schedule reversal, payoff, precision and shared-Movement concurrency checks passed: 1 success, 1 DEBT_MOVEMENT_ALREADY_LINKED, 1 effective event.");

function withUser(sql) {
  return `select set_config('request.jwt.claim.sub', '${ids.user}', false); ${sql}`;
}

async function scalar(sql) {
  return (await execSql(sql)).split(/\r?\n/).at(-1)?.trim() ?? "";
}

async function expectSqlError(sql, expected) {
  const result = await runSql(sql);
  if (result.ok) throw new Error(`Se esperaba ${expected}, pero la operación terminó correctamente.`);
  if (!`${result.stdout}\n${result.stderr}`.includes(expected)) {
    throw new Error(`Se esperaba ${expected}; salida recibida: ${result.stdout}\n${result.stderr}`);
  }
}

async function execSql(sql) {
  const result = await runSql(sql);
  if (!result.ok) throw new Error(`psql falló:\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

async function runSql(sql) {
  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      ["exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At", "-F", "|", "-c", sql],
      { maxBuffer: 4 * 1024 * 1024 }
    );
    return { ok: true, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
    };
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: esperado ${expected}, recibido ${actual}`);
}
