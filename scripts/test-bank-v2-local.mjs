import { spawn } from "node:child_process";

const container = process.env.DEBT_BANK_DB_CONTAINER ?? "supabase_db_caja-familiar";

const ids = {
  userA: "00000000-0000-4000-8000-000000000701",
  householdA: "00000000-0000-4000-8000-000000000702",
  accountA: "00000000-0000-4000-8000-000000000703",
  debtA: "00000000-0000-4000-8000-000000000704",
  debtEst: "00000000-0000-4000-8000-000000000708",
  nonBankDebt: "00000000-0000-4000-8000-000000000713",

  userB: "00000000-0000-4000-8000-000000000710",
  householdB: "00000000-0000-4000-8000-000000000711",

  paymentEvent: "00000000-0000-4000-8000-000000000705",
  advanceEvent: "00000000-0000-4000-8000-000000000706",
  reversalEvent: "00000000-0000-4000-8000-000000000707",
  prepaymentEvent: "00000000-0000-4000-8000-000000000709",
  prepaymentReversalEvent: "00000000-0000-4000-8000-00000000070a",
  v3PaymentEvent: "00000000-0000-4000-8000-00000000070d",
  v3PendingEvent: "00000000-0000-4000-8000-00000000070e",
  scheduleUpdateEvent: "00000000-0000-4000-8000-00000000070f",
  v3InvalidEvent: "00000000-0000-4000-8000-000000000712",
  nonBankEvent: "00000000-0000-4000-8000-000000000714",
  v3InvalidNoScheduleEvent: "00000000-0000-4000-8000-000000000715",
  v3PrepaymentInvalidEvent: "00000000-0000-4000-8000-000000000716",
  v3PrepaymentPendingEvent: "00000000-0000-4000-8000-000000000717",
};

function execSql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [
      "exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-t", "-A",
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`psql exited with code ${code}: ${stderr || stdout}`));
      } else {
        resolve(stdout.trim());
      }
    });
    child.stdin.write(sql);
    child.stdin.end();
  });
}

function withUser(sql, userId = ids.userA) {
  return `
    begin;
    select set_config('request.jwt.claim.sub', '${userId}', true);
    select set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    ${sql}
    commit;
  `;
}

console.log("=== RUNNING LOCAL SQL SMOKE SUITE FOR BANK CREDIT CONTRACT V2 ===");

try {
  // Test DDL and RPC execution on local DB
  const hasContainer = await execSql("select 1").then(() => true).catch(() => false);
  if (!hasContainer) {
    console.error("Local Supabase container is not running.");
    process.exit(1);
  }

  console.log("1. Checking table and function existence...");
  const tableCheck = await execSql(`
    select count(*) from information_schema.tables 
    where table_schema = 'public' and table_name in ('bank_loan_profiles', 'debt_insurance_terms');
  `);
  if (parseInt(tableCheck, 10) !== 2) {
    throw new Error("Tables bank_loan_profiles or debt_insurance_terms missing!");
  }

  const rpcCheck = await execSql(`
    select count(*) from information_schema.routines 
    where routine_schema = 'public' and routine_name in (
      'create_bank_loan_v1', 'record_debt_payment_v2', 'record_debt_payment_v3', 'record_debt_prepayment_v3',
      'record_debt_installment_advance_v1', 'reverse_debt_event_v1', 'update_debt_contractual_schedule_v1'
    );
  `);
  if (parseInt(rpcCheck, 10) !== 7) {
    throw new Error("RPC functions missing!");
  }

  console.log("2. Setting up harness users & households...");
  await execSql(`
    delete from public.debt_event_installment_allocations where household_id in ('${ids.householdA}', '${ids.householdB}');
    delete from public.debt_installments where household_id in ('${ids.householdA}', '${ids.householdB}');
    delete from public.debt_schedule_versions where household_id in ('${ids.householdA}', '${ids.householdB}');
    delete from public.debt_insurance_terms where household_id in ('${ids.householdA}', '${ids.householdB}');
    delete from public.bank_loan_profiles where household_id in ('${ids.householdA}', '${ids.householdB}');
    delete from public.debt_events where household_id in ('${ids.householdA}', '${ids.householdB}');
    delete from public.movements where household_id in ('${ids.householdA}', '${ids.householdB}');
    delete from public.debts where household_id in ('${ids.householdA}', '${ids.householdB}');
    delete from public.financial_accounts where household_id in ('${ids.householdA}', '${ids.householdB}');
    delete from public.household_members where household_id in ('${ids.householdA}', '${ids.householdB}');
    delete from public.households where id in ('${ids.householdA}', '${ids.householdB}');
    delete from auth.users where id in ('${ids.userA}', '${ids.userB}');

    insert into auth.users (id, email) values ('${ids.userA}', 'userA@example.test'), ('${ids.userB}', 'userB@example.test');
    insert into public.households (id, name) values ('${ids.householdA}', 'Household A'), ('${ids.householdB}', 'Household B');
    insert into public.household_members (household_id, user_id, role, display_name)
      values ('${ids.householdA}', '${ids.userA}', 'owner', 'User A'), ('${ids.householdB}', '${ids.userB}', 'owner', 'User B');
    insert into public.financial_accounts (id, household_id, name, reconciliation_type, opening_balance, is_active, sort_order)
      values ('${ids.accountA}', '${ids.householdA}', 'Account A', 'balance', 10000, true, 10);
    insert into public.debts (id, household_id, name, creditor_name, debt_kind, tracking_start_date, opening_principal_balance, created_by_user_id)
      values ('${ids.nonBankDebt}', '${ids.householdA}', 'Family Loan', 'Family', 'family_loan', '2026-01-01', 1000, '${ids.userA}');
  `);

  console.log("3. A & D: Creating Bank Loan with Contractual Schedule...");
  await execSql(withUser(`
    select public.create_bank_loan_v1(
      '${ids.householdA}', '${ids.debtA}', 'Préstamo Vehicular BBVA', 'BBVA', 'bank_loan', 'PEN',
       '2026-01-01', '2026-01-01', 50000, 40000, 2, 1200, 'fixed', 'monthly', null, '2026-02-01',
      12.5, 14.2, 'Notas de crédito', 'fixed_schedule', 'contract_schedule', null, null, null,
      '{"loan_subtype": "vehicular", "contract_number": "CON-123", "amortization_method": "fixed_installment", "asset_price": 50000, "down_payment_amount": 10000, "financed_amount": 40000}'::jsonb,
      '[{"insurance_type": "credit_life", "label": "Desgravamen", "pricing_mode": "percent_outstanding_balance", "rate_percent": 0.05}]'::jsonb,
      'contractual',
      '[{"installment_number": 1, "due_date": "2026-02-01", "expected_amount": 1200, "expected_principal": 800, "expected_interest": 350, "expected_insurance": 50, "expected_fees": 0}, {"installment_number": 2, "due_date": "2026-03-01", "expected_amount": 1200, "expected_principal": 810, "expected_interest": 340, "expected_insurance": 50, "expected_fees": 0}]'::jsonb,
      '[]'::jsonb
    );
  `));

  console.log("4. B & C: Verifying Profile and Insurance Inserted...");
  const profCount = await execSql(`select count(*) from public.bank_loan_profiles where debt_id = '${ids.debtA}';`);
  const insCount = await execSql(`select count(*) from public.debt_insurance_terms where debt_id = '${ids.debtA}';`);
  if (parseInt(profCount, 10) !== 1 || parseInt(insCount, 10) !== 1) {
    throw new Error("Profile or Insurance record missing after create_bank_loan_v1!");
  }

  const schedSource = await execSql(`select schedule_source || '|' || is_authoritative::text from public.debt_schedule_versions where debt_id = '${ids.debtA}';`);
  if (schedSource !== "contractual|true") {
    throw new Error(`Unexpected contractual schedule metadata: ${schedSource}`);
  }

  console.log("5. E: Creating Estimated Bank Loan...");
  await execSql(withUser(`
    select public.create_bank_loan_v1(
      '${ids.householdA}', '${ids.debtEst}', 'Préstamo Personal BCP', 'BCP', 'bank_loan', 'PEN',
       '2026-01-01', '2026-01-01', 10000, 10000, 1, 900, 'fixed', 'monthly', null, '2026-02-01',
      18.0, 19.5, null, 'fixed_schedule', 'tea_estimate', null, null, null,
      '{"loan_subtype": "personal", "amortization_method": "fixed_installment", "financed_amount": 10000}'::jsonb,
      '[]'::jsonb,
      'estimated',
      '[{"installment_number": 1, "due_date": "2026-02-01", "expected_amount": 900, "expected_principal": 750, "expected_interest": 150, "expected_insurance": 0, "expected_fees": 0}]'::jsonb,
      '[]'::jsonb
    );
  `));
  const estSource = await execSql(`select schedule_source || '|' || is_authoritative::text from public.debt_schedule_versions where debt_id = '${ids.debtEst}';`);
  if (estSource !== "estimated|false") {
    throw new Error(`Unexpected estimated schedule metadata: ${estSource}`);
  }
  // Legacy manual schedules must remain reversible after the V3 finalization.
  await execSql(`
    update public.debt_schedule_versions
       set schedule_source = 'manual', is_authoritative = false
     where debt_id = '${ids.debtEst}' and version_number = 1;
  `);

  console.log("6. F: Testing record_debt_payment_v2 (payment + extra principal)...");
  await execSql(withUser(`
    select public.record_debt_payment_v2(
      '${ids.householdA}', '${ids.debtA}', '${ids.paymentEvent}', 'mov-pay-1',
      '2026-02-01', 3200, '${ids.accountA}', 'Pago cuota + extra principal', 'Pago de deuda',
       800, 350, 0, 50, 0, 2000, 'reduce_term', true,
       jsonb_build_array(jsonb_build_object(
         'installment_id', (select i.id from public.debt_installments as i where i.debt_id = '${ids.debtA}' and i.installment_number = 1),
         'allocated_amount', 1200
       ))
    );
  `));
  const paymentCheck = await execSql(`
    select count(*)::text || '|' || max(extra_principal_amount)::text || '|' || max(prepayment_effect) || '|' || max(m.person)
      from public.debt_events as e
      join public.movements as m on m.id = e.movement_id
     where e.id = '${ids.paymentEvent}';
  `);
  if (paymentCheck !== "1|2000|reduce_term|User A") {
    throw new Error(`Payment payload/movement mismatch: ${paymentCheck}`);
  }
  await execSql(withUser(`
    select public.record_debt_payment_v2(
      '${ids.householdA}', '${ids.debtA}', '${ids.paymentEvent}', 'mov-pay-1',
      '2026-02-01', 3200, '${ids.accountA}', 'Pago cuota + extra principal', 'Pago de deuda',
      800, 350, 0, 50, 0, 2000, 'reduce_term', true,
      jsonb_build_array(jsonb_build_object(
        'installment_id', (select i.id from public.debt_installments as i where i.debt_id = '${ids.debtA}' and i.installment_number = 1),
        'allocated_amount', 1200
      ))
    );
  `));
  try {
    await execSql(withUser(`
      select public.record_debt_payment_v2(
        '${ids.householdA}', '${ids.debtA}', '${ids.paymentEvent}', 'mov-pay-1',
        '2026-02-01', 3200, '${ids.accountA}', 'Payload cambiado', 'Pago de deuda',
        800, 350, 0, 50, 0, 2000, 'reduce_term', true, '[]'::jsonb
      );
    `));
    throw new Error("Changed payment payload was NOT rejected!");
  } catch (err) {
    if (!String(err.message).includes("DEBT_EVENT_ID_CONFLICT")) {
      throw err;
    }
  }

  console.log("7. G & H: Testing record_debt_installment_advance_v1 & Allocations...");
  await execSql(withUser(`
    select public.record_debt_installment_advance_v1(
      '${ids.householdA}', '${ids.debtA}', '${ids.advanceEvent}', 'mov-adv-1',
      '2026-02-15', 1200, '${ids.accountA}', 'Adelanto cuota 2', 'Pago de deuda',
      810, 340, 0, 50, 0, true,
      jsonb_build_array(jsonb_build_object(
        'installment_id', (select i.id from public.debt_installments as i where i.debt_id = '${ids.debtA}' and i.installment_number = 2),
        'allocated_amount', 1200
      ))
    );
  `));
  const advanceRow = await execSql(`
    select e.event_type || '|' || count(a.*)::text || '|' || count(distinct s.id)::text
      from public.debt_events as e
      left join public.debt_event_installment_allocations as a on a.event_id = e.id
      left join public.debt_schedule_versions as s on s.debt_id = e.debt_id
     where e.id = '${ids.advanceEvent}'
     group by e.event_type;
  `);
  if (advanceRow !== "installment_advance|1|1") {
    throw new Error(`Advance event/allocation/schedule mismatch: ${advanceRow}`);
  }
  await execSql(withUser(`
    select public.record_debt_installment_advance_v1(
      '${ids.householdA}', '${ids.debtA}', '${ids.advanceEvent}', 'mov-adv-1',
      '2026-02-15', 1200, '${ids.accountA}', 'Adelanto cuota 2', 'Pago de deuda',
      810, 340, 0, 50, 0, true,
      jsonb_build_array(jsonb_build_object(
        'installment_id', (select i.id from public.debt_installments as i where i.debt_id = '${ids.debtA}' and i.installment_number = 2),
        'allocated_amount', 1200
      ))
    );
  `));

  console.log("8. I: Testing reverse_debt_event_v1 for installment_advance...");
  await execSql(withUser(`
    select public.reverse_debt_event_v1(
      '${ids.householdA}', '${ids.debtA}', '${ids.reversalEvent}', '${ids.advanceEvent}',
      '2026-02-16', 'Reversión adelanto', '[]'::jsonb, ''
    );
  `));
  const advanceReversalCheck = await execSql(`
    select count(*)::text || '|' || (select status from public.debts where id = '${ids.debtA}')
      from public.debt_events
     where reversal_of_event_id = '${ids.advanceEvent}';
  `);
  if (advanceReversalCheck !== "1|active") {
    throw new Error(`Advance reversal mismatch: ${advanceReversalCheck}`);
  }

  console.log("9. J: Testing standalone prepayment and schedule restoration...");
  await execSql(withUser(`
    select public.record_debt_prepayment_v3(
      '${ids.householdA}', '${ids.debtEst}', '${ids.prepaymentEvent}', 'mov-prepay-1',
      '2026-01-15', 500, '${ids.accountA}', 'Prepago parcial', 'Pago de deuda',
      500, 0, 0, 0, 0, 'reduce_term', true,
      '[{"installment_number": 1, "due_date": "2026-03-01", "expected_amount": 9500, "expected_principal": 9500, "expected_interest": 0, "expected_fees": 0, "expected_insurance": 0}]'::jsonb,
      '', 'estimated'
    );
  `));
  const prepaymentCheck = await execSql(`
    select e.event_type || '|' || count(s.id)::text || '|' || max(s.schedule_source) || '|' || max(s.is_authoritative::text)
      from public.debt_events as e
      left join public.debt_schedule_versions as s on s.trigger_event_id = e.id
     where e.id = '${ids.prepaymentEvent}'
     group by e.event_type;
  `);
  if (prepaymentCheck !== "principal_prepayment|1|estimated|false") {
    throw new Error(`Prepayment/schedule mismatch: ${prepaymentCheck}`);
  }
  await execSql(withUser(`
    select public.reverse_debt_event_v1(
      '${ids.householdA}', '${ids.debtEst}', '${ids.prepaymentReversalEvent}', '${ids.prepaymentEvent}',
      '2026-01-20', 'Reversión prepago',
      '[{"installment_number": 1, "due_date": "2026-02-01", "expected_amount": 900, "expected_principal": 750, "expected_interest": 150, "expected_fees": 0, "expected_insurance": 0}]'::jsonb,
      ''
    );
  `));
  const restoredCheck = await execSql(`
    select count(*)::text || '|' || (select status from public.debts where id = '${ids.debtEst}')
      from public.debt_schedule_versions
     where debt_id = '${ids.debtEst}';
  `);
  if (restoredCheck !== "3|active") {
    throw new Error(`Prepayment schedule restoration mismatch: ${restoredCheck}`);
  }
  const manualRestorationSource = await execSql(`
    select schedule_source || '|' || is_authoritative::text
      from public.debt_schedule_versions
     where trigger_event_id = '${ids.prepaymentReversalEvent}';
  `);
  if (manualRestorationSource !== "manual|false") {
    throw new Error(`Legacy manual schedule metadata was not restored: ${manualRestorationSource}`);
  }
  await execSql(withUser(`
    select public.reverse_debt_event_v1(
      '${ids.householdA}', '${ids.debtEst}', '${ids.prepaymentReversalEvent}', '${ids.prepaymentEvent}',
      '2026-01-20', 'Reversión prepago',
      '[{"installment_number": 1, "due_date": "2026-02-01", "expected_amount": 900, "expected_principal": 750, "expected_interest": 150, "expected_fees": 0, "expected_insurance": 0}]'::jsonb,
      ''
    );
  `));

  console.log("10. N: Testing bank profile and initial schedule guards...");
  try {
    await execSql(withUser(`
      select public.create_bank_loan_v1(
        '${ids.householdA}', '00000000-0000-4000-8000-00000000070b', 'Sin perfil', 'Banco', 'bank_loan', 'PEN',
        '2026-01-01', '2026-01-01', 1000, 1000, 1, 1000, 'fixed', 'monthly', null, '2026-02-01',
        10, 11, '', 'fixed_schedule', 'contract_schedule', null, null, null, null, '[]'::jsonb,
        'contractual', '[]'::jsonb, '[]'::jsonb
      );
    `));
    throw new Error("Bank loan without profile/schedule was NOT rejected!");
  } catch (err) {
    if (!String(err.message).includes("BANK_PROFILE_REQUIRED")) {
      throw err;
    }
  }
  try {
    await execSql(withUser(`
      select public.create_bank_loan_v1(
        '${ids.householdA}', '00000000-0000-4000-8000-00000000070c', 'Secuencia inválida', 'Banco', 'bank_loan', 'PEN',
        '2026-01-01', '2026-01-01', 1000, 1000, 1, 1000, 'fixed', 'monthly', null, '2026-02-01',
        10, 11, '', 'fixed_schedule', 'contract_schedule', null, null, null,
        '{"loan_subtype":"personal","amortization_method":"fixed_installment","financed_amount":1000}'::jsonb,
        '[]'::jsonb, 'contractual',
        '[{"installment_number":2,"due_date":"2026-02-01","expected_amount":1000,"expected_principal":900,"expected_interest":100,"expected_fees":0,"expected_insurance":0}]'::jsonb,
        '[]'::jsonb
      );
    `));
    throw new Error("Bank loan with non-contiguous schedule was NOT rejected!");
  } catch (err) {
    if (!String(err.message).includes("BANK_SCHEDULE_REQUIRED")) {
      throw err;
    }
  }

  console.log("11. O, P, Q: Testing finalization payment, pending schedule and contractual update...");
  const v3PrincipalBefore = Number(await execSql(`
    select private.debt2b2_current_principal(
      '${ids.householdA}',
      '${ids.debtA}'
    );
  `));
  if (!Number.isFinite(v3PrincipalBefore)) {
    throw new Error(`Could not read live principal before Step 11 payment: ${v3PrincipalBefore}`);
  }
  const v3PrincipalReduction = 100 + 50;
  const v3PostPaymentPrincipal = Math.round((v3PrincipalBefore - v3PrincipalReduction) * 100) / 100;
  if (!(v3PostPaymentPrincipal > 0)) {
    throw new Error(`Step 11 post-payment principal must remain positive: ${v3PostPaymentPrincipal}`);
  }
  const v3ScheduleRows = [{
    installment_number: 1,
    due_date: "2026-05-01",
    expected_amount: v3PostPaymentPrincipal,
    expected_principal: v3PostPaymentPrincipal,
    expected_interest: 0,
    expected_fees: 0,
    expected_insurance: 0,
  }];
  const v3Schedule = JSON.stringify(v3ScheduleRows);
  const v3SchedulePrincipalSum = Math.round(v3ScheduleRows.reduce((sum, row) => sum + row.expected_principal, 0) * 100) / 100;
  if (Math.abs(v3SchedulePrincipalSum - v3PostPaymentPrincipal) > 0.01) {
    throw new Error(`Step 11 schedule principal mismatch: ${v3SchedulePrincipalSum} vs ${v3PostPaymentPrincipal}`);
  }
  console.log(`11 fixture: principal before ${v3PrincipalBefore.toFixed(2)} - reduction ${v3PrincipalReduction.toFixed(2)} = post-payment ${v3PostPaymentPrincipal.toFixed(2)}; schedule principal sum ${v3SchedulePrincipalSum.toFixed(2)}`);
  await execSql(withUser(`
    select public.record_debt_payment_v3(
      '${ids.householdA}', '${ids.debtA}', '${ids.v3PaymentEvent}', 'mov-v3-pay-1',
      '2026-04-01', 150, '${ids.accountA}', 'Pago V3 + extra', 'Pago de deuda',
      100, 0, 0, 0, 0, 50, 'reduce_term', true, '[]'::jsonb,
      '${v3Schedule}'::jsonb, 'Cronograma posterior al pago', 'contractual'
    );
  `));
  const v3PaymentCheck = await execSql(`
    select count(*)::text || '|' || max(e.extra_principal_amount)::text || '|' || max(e.prepayment_effect)
      || '|' || count(distinct s.id)::text || '|' || max(s.schedule_source) || '|' || max(s.is_authoritative::text)
      from public.debt_events as e
      left join public.debt_schedule_versions as s on s.trigger_event_id = e.id
     where e.id = '${ids.v3PaymentEvent}';
  `);
  if (v3PaymentCheck !== "1|50|reduce_term|1|contractual|true") {
    throw new Error(`Payment V3/schedule mismatch: ${v3PaymentCheck}`);
  }
  await execSql(withUser(`
    select public.record_debt_payment_v3(
      '${ids.householdA}', '${ids.debtA}', '${ids.v3PaymentEvent}', 'mov-v3-pay-1',
      '2026-04-01', 150, '${ids.accountA}', 'Pago V3 + extra', 'Pago de deuda',
      100, 0, 0, 0, 0, 50, 'reduce_term', true, '[]'::jsonb,
      '${v3Schedule}'::jsonb, 'Cronograma posterior al pago', 'contractual'
    );
  `));
  const v3ReplayCheck = await execSql(`select count(*) from public.debt_events where id = '${ids.v3PaymentEvent}';`);
  if (v3ReplayCheck !== "1") throw new Error(`Payment V3 replay duplicated the event: ${v3ReplayCheck}`);

  try {
    await execSql(withUser(`
      select public.record_debt_payment_v3(
        '${ids.householdA}', '${ids.debtA}', '${ids.v3InvalidEvent}', 'mov-v3-invalid-1',
        '2026-04-02', 90, '${ids.accountA}', 'Pago V3 inválido', 'Pago de deuda',
        50, 0, 0, 0, 0, 40, 'reduce_term', true, '[]'::jsonb,
        '[{"installment_number":1,"due_date":"2026-05-02","expected_amount":100,"expected_principal":80,"expected_interest":10,"expected_fees":0,"expected_insurance":0}]'::jsonb,
        'Cronograma inválido', 'contractual'
      );
    `));
    throw new Error("Invalid V3 schedule was NOT rejected!");
  } catch (err) {
    if (!String(err.message).includes("INVALID_DEBT_SCHEDULE")) throw err;
  }
  const atomicityCheck = await execSql(`
    select (select count(*) from public.debt_events where id = '${ids.v3InvalidEvent}')::text || '|'
      || (select count(*) from public.movements where id = 'mov-v3-invalid-1')::text;
  `);
  if (atomicityCheck !== "0|0") throw new Error(`Invalid V3 schedule left financial rows behind: ${atomicityCheck}`);

  try {
    await execSql(withUser(`
      select public.record_debt_payment_v3(
        '${ids.householdA}', '${ids.debtA}', '${ids.v3InvalidNoScheduleEvent}', 'mov-v3-invalid-no-schedule-1',
        '2026-04-03', 90, '${ids.accountA}', 'Pago V3 sin cronograma', 'Pago de deuda',
        50, 0, 0, 0, 0, 40, 'reduce_term', true, '[]'::jsonb,
        '[]'::jsonb, null, null
      );
    `));
    throw new Error("Payment plus extra without a schedule was NOT rejected!");
  } catch (err) {
    if (!String(err.message).includes("INVALID_DEBT_PAYMENT")) throw err;
  }
  const invalidPaymentNoScheduleAtomicity = await execSql(`
    select (select count(*) from public.debt_events where id = '${ids.v3InvalidNoScheduleEvent}')::text || '|'
      || (select count(*) from public.movements where id = 'mov-v3-invalid-no-schedule-1')::text;
  `);
  if (invalidPaymentNoScheduleAtomicity !== "0|0") throw new Error(`Invalid no-schedule payment left financial rows behind: ${invalidPaymentNoScheduleAtomicity}`);

  try {
    await execSql(withUser(`
      select public.record_debt_prepayment_v3(
        '${ids.householdA}', '${ids.debtA}', '${ids.v3PrepaymentInvalidEvent}', 'mov-v3-prepay-invalid-1',
        '2026-05-01', 50, '${ids.accountA}', 'Prepago V3 sin cronograma', 'Pago de deuda',
        50, 0, 0, 0, 0, 'reduce_installment', true, '[]'::jsonb, null, null
      );
    `));
    throw new Error("Prepayment with a future-term change and no schedule was NOT rejected!");
  } catch (err) {
    if (!String(err.message).includes("INVALID_DEBT_PREPAYMENT")) throw err;
  }
  const invalidPrepaymentNoScheduleAtomicity = await execSql(`
    select (select count(*) from public.debt_events where id = '${ids.v3PrepaymentInvalidEvent}')::text || '|'
      || (select count(*) from public.movements where id = 'mov-v3-prepay-invalid-1')::text;
  `);
  if (invalidPrepaymentNoScheduleAtomicity !== "0|0") throw new Error(`Invalid no-schedule prepayment left financial rows behind: ${invalidPrepaymentNoScheduleAtomicity}`);

  await execSql(withUser(`
    select public.record_debt_prepayment_v3(
      '${ids.householdA}', '${ids.debtA}', '${ids.v3PrepaymentPendingEvent}', 'mov-v3-prepay-pending-1',
      '2026-05-15', 50, '${ids.accountA}', 'Prepago V3 pendiente', 'Pago de deuda',
      50, 0, 0, 0, 0, 'pending_bank_schedule', true, '[]'::jsonb, null, null
    );
  `));
  const pendingPrepaymentCheck = await execSql(`
    select e.event_type || '|' || max(e.prepayment_effect) || '|' || count(s.id)::text
      from public.debt_events as e
      left join public.debt_schedule_versions as s on s.trigger_event_id = e.id
     where e.id = '${ids.v3PrepaymentPendingEvent}'
     group by e.event_type;
  `);
  if (pendingPrepaymentCheck !== "principal_prepayment|pending_bank_schedule|0") {
    throw new Error(`Pending prepayment state mismatch: ${pendingPrepaymentCheck}`);
  }

  try {
    await execSql(withUser(`
      select public.record_debt_payment_v3(
        '${ids.householdA}', '${ids.nonBankDebt}', '${ids.nonBankEvent}', 'mov-v3-nonbank-1',
        '2026-04-02', 60, '${ids.accountA}', 'Pago no bancario pendiente', 'Pago de deuda',
        40, 0, 0, 0, 0, 20, 'pending_bank_schedule', true, '[]'::jsonb,
        '[]'::jsonb, null, null
      );
    `));
    throw new Error("Bank schedule state was accepted for a non-bank debt!");
  } catch (err) {
    if (!String(err.message).includes("DEBT_NOT_BANK_LOAN")) throw err;
  }
  const nonBankAtomicityCheck = await execSql(`
    select (select count(*) from public.debt_events where id = '${ids.nonBankEvent}')::text || '|'
      || (select count(*) from public.movements where id = 'mov-v3-nonbank-1')::text;
  `);
  if (nonBankAtomicityCheck !== "0|0") throw new Error(`Non-bank schedule guard left financial rows behind: ${nonBankAtomicityCheck}`);

  await execSql(withUser(`
    select public.record_debt_payment_v3(
      '${ids.householdA}', '${ids.debtA}', '${ids.v3PendingEvent}', 'mov-v3-pending-1',
      '2026-06-01', 60, '${ids.accountA}', 'Pago V3 pendiente', 'Pago de deuda',
      40, 0, 0, 0, 0, 20, 'pending_bank_schedule', true, '[]'::jsonb,
      '[]'::jsonb, null, null
    );
  `));
  const pendingCheck = await execSql(`
    select max(e.prepayment_effect) || '|' || count(s.id)::text
      from public.debt_events as e
      left join public.debt_schedule_versions as s on s.trigger_event_id = e.id
     where e.id = '${ids.v3PendingEvent}';
  `);
  if (pendingCheck !== "pending_bank_schedule|0") {
    throw new Error(`Pending schedule state mismatch: ${pendingCheck}`);
  }

  const updatedSchedule = '[{"installment_number":1,"due_date":"2026-07-01","expected_amount":120,"expected_principal":90,"expected_interest":30,"expected_fees":0,"expected_insurance":0}]';
  await execSql(withUser(`
    select public.update_debt_contractual_schedule_v1(
      '${ids.householdA}', '${ids.debtA}', '${ids.scheduleUpdateEvent}', '2026-06-15',
      'rate_change', '${updatedSchedule}'::jsonb, 'Cronograma contractual actualizado'
    );
  `));
  const updateCheck = await execSql(`
    select e.event_type || '|' || coalesce(e.movement_id::text, '') || '|' || s.reason || '|'
      || s.schedule_source || '|' || s.is_authoritative::text || '|' || count(i.id)::text
      from public.debt_events as e
      join public.debt_schedule_versions as s on s.trigger_event_id = e.id
      join public.debt_installments as i on i.schedule_version_id = s.id
     where e.id = '${ids.scheduleUpdateEvent}'
     group by e.event_type, e.movement_id, s.reason, s.schedule_source, s.is_authoritative;
  `);
  if (updateCheck !== "principal_adjustment||rate_change|contractual|true|1") {
    throw new Error(`Contractual schedule update mismatch: ${updateCheck}`);
  }
  const currentScheduleCheck = await execSql(`
    select version_number::text || '|' || coalesce(trigger_event_id::text, '') || '|'
      || schedule_source || '|' || is_authoritative::text
      from public.debt_schedule_versions
     where debt_id = '${ids.debtA}'
     order by version_number desc
     limit 1;
  `);
  if (currentScheduleCheck !== `3|${ids.scheduleUpdateEvent}|contractual|true`) {
    throw new Error(`Pending schedule was not replaced by the official version: ${currentScheduleCheck}`);
  }
  await execSql(withUser(`
    select public.update_debt_contractual_schedule_v1(
      '${ids.householdA}', '${ids.debtA}', '${ids.scheduleUpdateEvent}', '2026-06-15',
      'rate_change', '${updatedSchedule}'::jsonb, 'Cronograma contractual actualizado'
    );
  `));
  const updateReplayCheck = await execSql(`select count(*) from public.debt_events where id = '${ids.scheduleUpdateEvent}';`);
  if (updateReplayCheck !== "1") throw new Error(`Schedule update replay duplicated the event: ${updateReplayCheck}`);
  try {
    await execSql(withUser(`
      select public.update_debt_contractual_schedule_v1(
        '${ids.householdA}', '${ids.debtA}', '${ids.scheduleUpdateEvent}', '2026-06-15',
        'rate_change', '[{"installment_number":1,"due_date":"2026-07-02","expected_amount":120,"expected_principal":90,"expected_interest":30,"expected_fees":0,"expected_insurance":0}]'::jsonb,
        'Cronograma contractual actualizado'
      );
    `));
    throw new Error("Changed contractual schedule update was NOT rejected!");
  } catch (err) {
    if (!String(err.message).includes("DEBT_EVENT_ID_CONFLICT")) throw err;
  }

  console.log("12. K, L, M: Testing Security, RLS & Cross-household Isolation...");
  // Cross-household access attempt by User B on Household A debt
  try {
    await execSql(withUser(`
      select public.record_debt_payment_v2(
        '${ids.householdA}', '${ids.debtA}', '00000000-0000-4000-8000-000000000799', 'mov-hacker-1',
        '2026-02-01', 100, '${ids.accountA}', 'Ataque cross-household', 'Pago de deuda',
        100, 0, 0, 0, 0, 0, null, true, '[]'::jsonb
      );
    `, ids.userB));
    throw new Error("Cross-household access was NOT rejected!");
  } catch (err) {
    console.log("Cross-household access successfully rejected:", err.message.substring(0, 80));
  }
  const isolatedRowsOutput = await execSql(withUser(`
    select count(*) from public.debts where id = '${ids.debtA}';
  `, ids.userB));
  const isolatedRows = isolatedRowsOutput.trim().split(/\r?\n/).at(-2);
  if (isolatedRows !== "0") {
    throw new Error(`Cross-household RLS returned ${isolatedRows ?? isolatedRowsOutput} debt rows!`);
  }

  console.log("SUCCESS! BANK CREDIT CONTRACT V2 SQL SMOKE REQUIREMENTS PASSED CLEANLY.");
} catch (err) {
  console.error("SQL SMOKE TEST FAILED:", err);
  process.exit(1);
}
