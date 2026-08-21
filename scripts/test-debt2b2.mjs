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
  concurrentDebt: "00000000-0000-4000-8000-000000000107",
  precisionDebt: "00000000-0000-4000-8000-000000000108",
  paymentEvent: "00000000-0000-4000-8000-000000000109",
  prepaymentEvent: "00000000-0000-4000-8000-000000000110",
  prepaymentReversal: "00000000-0000-4000-8000-000000000111",
  payoffEvent: "00000000-0000-4000-8000-000000000112",
  concurrentEventA: "00000000-0000-4000-8000-000000000113",
  concurrentEventB: "00000000-0000-4000-8000-000000000114",
  precisionEvent: "00000000-0000-4000-8000-000000000115",
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
    ('${ids.concurrentDebt}', '${ids.household}', 'Concurrent Debt', 'Harness Creditor', 'bank_loan', '2026-08-20', 100, '${ids.user}'),
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

const concurrentSql = withUser(`
  select public.record_debt_payment_v1(
    '${ids.household}', '${ids.concurrentDebt}', EVENT_ID, MOVEMENT_ID,
    '2026-08-20', 60, '${ids.account}', 'Concurrent payment', 'Debt', 60, 0, 0, 0, 0, true, '[]'::jsonb
  );
`);
const [concurrentA, concurrentB] = await Promise.all([
  runSql(concurrentSql.replace("EVENT_ID", `'${ids.concurrentEventA}'`).replace("MOVEMENT_ID", "'debt2b2-concurrent-a'")),
  runSql(concurrentSql.replace("EVENT_ID", `'${ids.concurrentEventB}'`).replace("MOVEMENT_ID", "'debt2b2-concurrent-b'")),
]);
const concurrentResults = [concurrentA, concurrentB];
if (concurrentResults.filter((result) => result.ok).length !== 1) {
  throw new Error(`La prueba concurrente esperaba exactamente un éxito: ${JSON.stringify(concurrentResults)}`);
}
if (!concurrentResults.some((result) => `${result.stdout}\n${result.stderr}`.includes("DEBT_PRINCIPAL_EXCEEDED"))) {
  throw new Error("La segunda operación concurrente no devolvió DEBT_PRINCIPAL_EXCEEDED.");
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
assertEqual(await scalar(`select count(*) from public.debt_events where debt_id = '${ids.concurrentDebt}' and event_type = 'payment';`), "1", "concurrent serialization");
assertEqual(await scalar(`select private.debt2b2_current_principal('${ids.household}', '${ids.concurrentDebt}');`), "40", "concurrent principal");

console.log("OK: DEBT-2B.2 payment, replay, prepayment, schedule reversal, payoff, precision and real concurrency checks passed.");

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
