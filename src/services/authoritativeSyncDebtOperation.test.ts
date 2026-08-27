import { describe, expect, it } from "vitest";
import type { AppData, Debt, DebtEvent, DebtInstallment, DebtScheduleVersion, Movement } from "../types.js";
import type { DebtFundOperationResult } from "./dataRepository.js";
import { containsDebtOperationResult, mergeDebtOperationResultIntoAppData } from "./authoritativeSync.js";

const emptyAppData = (): AppData => ({
  movements: [],
  cashCounts: [],
  recurringPayments: [],
  categories: [],
  initialBalance: 0,
  financialAccounts: [],
  debts: [],
  bankLoanProfiles: [],
  debtInsuranceTerms: [],
  debtEvents: [],
  debtScheduleVersions: [],
  debtInstallments: [],
  debtEventInstallmentAllocations: [],
  debtCollaterals: [],
  creditCardProfiles: [],
  creditCardEntries: [],
  creditCardStatements: [],
  accountReconciliations: [],
  accountReconciliationMovements: [],
  movementCorrections: [],
});

function operationResult(): DebtFundOperationResult {
  const debt = { id: "debt-operation", openingPrincipalBalance: 2609.47 } as Debt;
  const movement = { id: "movement-operation" } as Movement;
  const event = { id: "event-operation", debtId: debt.id, principalDelta: -500, extraPrincipalAmount: 500, prepaymentEffect: "reduce_term" } as DebtEvent;
  const scheduleVersion = { id: "schedule-operation", debtId: debt.id, scheduleSource: "estimated", isAuthoritative: false, reason: "prepayment", triggerEventId: event.id } as DebtScheduleVersion;
  const installment = { id: "installment-operation", debtId: debt.id, scheduleVersionId: scheduleVersion.id, contractualInstallmentNumber: 7, installmentNumber: 1 } as DebtInstallment;
  return { idempotentReplay: false, debt, movement, event, allocations: [], scheduleVersion, installments: [installment] };
}

describe("mergeDebtOperationResultIntoAppData", () => {
  it("overlays the returned principal, event, estimated schedule and movement immediately", () => {
    const result = operationResult();
    const once = mergeDebtOperationResultIntoAppData(emptyAppData(), result);
    const twice = mergeDebtOperationResultIntoAppData(once, result);

    expect(twice.debts[0]?.openingPrincipalBalance).toBe(2609.47);
    expect(twice.debtEvents).toEqual([result.event]);
    expect(twice.movements).toEqual([result.movement]);
    expect(twice.debtScheduleVersions[0]).toMatchObject({ scheduleSource: "estimated", isAuthoritative: false, triggerEventId: result.event.id });
    expect(twice.debtInstallments[0]?.contractualInstallmentNumber).toBe(7);
    expect(twice.debts).toHaveLength(1);
    expect(twice.debtInstallments).toHaveLength(1);
    expect(containsDebtOperationResult(twice, result)).toBe(true);
  });
});
