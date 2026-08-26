import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = process.env.BANK_LOAN_V3_DB_CONTAINER ?? "supabase_db_caja-familiar";
const ids = {
  user: "00000000-0000-4000-8000-000000000801",
  household: "00000000-0000-4000-8000-000000000802",
  account: "00000000-0000-4000-8000-000000000803",
  debt: "00000000-0000-4000-8000-000000000804",
  partialDebt: "00000000-0000-4000-8000-000000000805",
  invalidDebt: "00000000-0000-4000-8000-000000000806",
  newDebt: "00000000-0000-4000-8000-00000000080a",
  baselinePayment: "00000000-0000-4000-8000-000000000807",
  pendingPayment: "00000000-0000-4000-8000-000000000808",
  scheduleUpdate: "00000000-0000-4000-8000-000000000809",
  estimatedPartialDebt: "00000000-0000-4000-8000-00000000080b",
  estimatedFullDebt: "00000000-0000-4000-8000-00000000080c",
  validPartialDebt: "00000000-0000-4000-8000-00000000080d",
};

function runSql(sql) {
  return execFileAsync(
    "docker",
    ["exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At", "-F", "|", "-c", sql],
    { maxBuffer: 4 * 1024 * 1024 }
  );
}

async function execSql(sql) {
  const result = await runSql(sql);
  return result.stdout.trim();
}

function withUser(sql) {
  return `begin; select set_config('request.jwt.claim.sub', '${ids.user}', true); select set_config('request.jwt.claim.role', 'authenticated', true); set local role authenticated; ${sql} commit;`;
}

function scheduleRows(start, end) {
  return JSON.stringify(Array.from({ length: end - start + 1 }, (_, index) => {
    const contractualNumber = start + index;
    const dueDate = new Date(Date.UTC(2026, 8 + contractualNumber - 1, 15)).toISOString().slice(0, 10);
    return {
      installment_number: index + 1,
      contractual_installment_number: contractualNumber,
      due_date: dueDate,
      expected_amount: 100,
      expected_principal: 80,
      expected_interest: 20,
      expected_fees: 0,
      expected_insurance: 0,
    };
  }));
}

function createBankLoan(debtId, schedule, baseline, term, scheduleSource = "contractual") {
  return withUser(`
    select public.create_bank_loan_v1(
      '${ids.household}', '${debtId}', 'Crédito V3', 'Banco V3', 'bank_loan', 'PEN',
      '2026-01-01', '2026-08-26', 1000, 800, ${term}, 100, 'fixed', 'monthly', null, '2026-09-15',
      0, null, '', 'fixed_schedule', 'contract_schedule', null, null, null,
      jsonb_build_object('loan_subtype', 'personal', 'amortization_method', 'fixed_installment', 'financed_amount', 1000, 'term_installments', ${term}, 'installments_paid_before_tracking', ${baseline}),
      '[]'::jsonb, '${scheduleSource}', '${schedule}'::jsonb, '[]'::jsonb
    );
  `);
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

console.log("=== RUNNING LOCAL SQL SMOKE SUITE FOR BANK LOAN ONBOARDING V3 ===");

try {
  await execSql("select 1");
  await execSql(`
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
    insert into auth.users (id, email) values ('${ids.user}', 'bank-loan-v3@example.test');
    insert into public.households (id, name) values ('${ids.household}', 'BANK V3 harness');
    insert into public.household_members (household_id, user_id, role, display_name) values ('${ids.household}', '${ids.user}', 'owner', 'BANK V3');
    insert into public.financial_accounts (id, household_id, name, reconciliation_type, opening_balance, is_active, sort_order) values ('${ids.account}', '${ids.household}', 'Cuenta V3', 'balance', 0, true, 10);
  `);

  console.log("1. Complete schedule + baseline metadata...");
  await execSql(createBankLoan(ids.debt, scheduleRows(1, 4), 2, 4));
  const baseline = await execSql(`
    select (select installments_paid_before_tracking::text from public.bank_loan_profiles where debt_id = '${ids.debt}') || '|' ||
      (select string_agg(is_paid_before_tracking::text, ',' order by installment_number) from public.debt_installments where debt_id = '${ids.debt}');
  `);
  if (baseline !== "2|true,true,false,false") throw new Error(`Unexpected baseline: ${baseline}`);
  const emptyHistory = await execSql(`
    select (select count(*) from public.debt_events where debt_id = '${ids.debt}') || '|' ||
      (select count(*) from public.movements where household_id = '${ids.household}') || '|' ||
      (select count(*) from public.debt_event_installment_allocations where debt_id = '${ids.debt}');
  `);
  if (emptyHistory !== "0|0|0") throw new Error(`Historical rows were fabricated: ${emptyHistory}`);

  console.log("1b. New loan baseline=0 preserves legacy behavior...");
  await execSql(createBankLoan(ids.newDebt, scheduleRows(1, 2), 0, 2));
  const newLoanBaseline = await execSql(`select count(*) from public.debt_installments where debt_id = '${ids.newDebt}' and is_paid_before_tracking;`);
  if (newLoanBaseline !== "0") throw new Error(`New loan unexpectedly marked baseline rows: ${newLoanBaseline}`);

  console.log("2. Baseline allocation is rejected atomically...");
  const baselineInstallment = `(select id from public.debt_installments where debt_id = '${ids.debt}' and installment_number = 1)`;
  await expectSqlError(withUser(`
    select public.record_debt_payment_v2(
      '${ids.household}', '${ids.debt}', '${ids.baselinePayment}', 'bank-v3-baseline-movement',
      '2026-08-26', 100, '${ids.account}', 'Pago baseline', 'Pago de deuda',
      80, 20, 0, 0, 0, 0, null, true,
      jsonb_build_array(jsonb_build_object('installment_id', ${baselineInstallment}, 'allocated_amount', 100))
    );
  `), "INVALID_DEBT_ALLOCATION");
  const baselineRollback = await execSql(`
    select (select count(*) from public.debt_events where id = '${ids.baselinePayment}') || '|' ||
      (select count(*) from public.movements where id = 'bank-v3-baseline-movement');
  `);
  if (baselineRollback !== "0|0") throw new Error(`Baseline rejection was not atomic: ${baselineRollback}`);

  console.log("3. Next pending installment remains allocatable...");
  const pendingInstallment = `(select id from public.debt_installments where debt_id = '${ids.debt}' and installment_number = 3)`;
  await execSql(withUser(`
    select public.record_debt_payment_v2(
      '${ids.household}', '${ids.debt}', '${ids.pendingPayment}', 'bank-v3-pending-movement',
      '2026-08-26', 100, '${ids.account}', 'Pago cuota 3', 'Pago de deuda',
      80, 20, 0, 0, 0, 0, null, true,
      jsonb_build_array(jsonb_build_object('installment_id', ${pendingInstallment}, 'allocated_amount', 100))
    );
  `));
  const pendingResult = await execSql(`select count(*) from public.debt_event_installment_allocations where event_id = '${ids.pendingPayment}';`);
  if (pendingResult !== "1") throw new Error(`Pending allocation was not accepted: ${pendingResult}`);

  console.log("4. Later schedule versions clear baseline flags...");
  await execSql(withUser(`
    select public.update_debt_contractual_schedule_v1(
      '${ids.household}', '${ids.debt}', '${ids.scheduleUpdate}', '2026-08-27', 'rate_change',
      '${scheduleRows(1, 4)}'::jsonb, 'Schedule V3 posterior'
    );
  `));
  const laterBaseline = await execSql(`
    select count(*)
      from public.debt_installments as i
      join public.debt_schedule_versions as s on s.id = i.schedule_version_id
     where i.debt_id = '${ids.debt}'
       and s.version_number = (select max(version_number) from public.debt_schedule_versions where debt_id = '${ids.debt}')
       and i.is_paid_before_tracking;
  `);
  if (laterBaseline !== "0") throw new Error(`Later schedule inherited baseline flags: ${laterBaseline}`);

  console.log("5. Mismatched pending-only schedule 6..7 is rejected for baseline=2...");
  await expectSqlError(createBankLoan(ids.partialDebt, scheduleRows(6, 7), 2, 7), "BANK_SCHEDULE_REQUIRED");

  console.log("6. Pending-only schedule 6..7 is accepted with baseline=5 and internal 1..2...");
  await execSql(createBankLoan(ids.validPartialDebt, scheduleRows(6, 7), 5, 7));
  const rejectedPartialCount = await execSql(`select count(*) from public.debts where id = '${ids.partialDebt}';`);
  if (rejectedPartialCount !== "0") throw new Error(`Mismatched partial schedule was persisted: ${rejectedPartialCount}`);
  const validPartialResult = await execSql(`
    select (select string_agg(installment_number::text, ',' order by installment_number) from public.debt_installments where debt_id = '${ids.validPartialDebt}') || '|' ||
      (select string_agg(contractual_installment_number::text, ',' order by installment_number) from public.debt_installments where debt_id = '${ids.validPartialDebt}') || '|' ||
      (select count(*) from public.debt_installments where debt_id = '${ids.validPartialDebt}' and is_paid_before_tracking);
  `);
  if (validPartialResult !== "1,2|6,7|0") throw new Error(`Unexpected valid partial schedule: ${validPartialResult}`);

  console.log("7. Partial estimated schedule is rejected while full estimated schedule is accepted...");
  await expectSqlError(createBankLoan(ids.estimatedPartialDebt, scheduleRows(6, 7), 5, 7, "estimated"), "BANK_SCHEDULE_REQUIRED");
  await execSql(createBankLoan(ids.estimatedFullDebt, scheduleRows(1, 7), 0, 7, "estimated"));

  console.log("8. Invalid baseline is rejected...");
  await expectSqlError(createBankLoan(ids.invalidDebt, scheduleRows(1, 2), 3, 2), "INVALID_DEBT_INPUT");
  console.log("SUCCESS! BANK LOAN ONBOARDING V3 SQL baseline, allocation, partial schedule and lifecycle checks passed.");
} catch (error) {
  console.error("SQL SMOKE TEST FAILED:", error);
  process.exitCode = 1;
}
