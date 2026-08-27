import { describe, expect, it } from "vitest";
import type { AppData, Debt, DebtCollateral, DebtInstallment, DebtScheduleVersion } from "../types.js";
import type { DebtCreateResult } from "./dataRepository.js";
import { containsDebtCreateResult, mergeDebtCreateResultIntoAppData } from "./authoritativeSync.js";

function debt(id: string): Debt {
  return {
    id,
    name: `Deuda ${id}`,
    creditorName: "Banco fixture",
    debtKind: "bank_loan",
    currencyCode: "PEN",
    originDate: null,
    trackingStartDate: "2026-08-27",
    originalPrincipal: 4100,
    openingPrincipalBalance: 3294.39,
    plannedInstallmentCount: 18,
    plannedInstallmentAmount: 347.67,
    installmentAmountMode: "fixed",
    paymentFrequency: "monthly",
    customFrequencyDays: null,
    firstDueDate: "2026-06-10",
    teaPercent: 68.4,
    tceaPercent: null,
    notes: "",
    status: "active",
    isArchived: false,
    createdByUserId: "user-1",
    createdAt: "2026-08-27T00:00:00Z",
    updatedAt: "2026-08-27T00:00:00Z",
  };
}

function scheduleVersion(id: string, debtId: string): DebtScheduleVersion {
  return {
    id,
    debtId,
    versionNumber: 1,
    effectiveDate: "2026-08-27",
    reason: "initial",
    scheduleSource: "contractual",
    isAuthoritative: true,
    triggerEventId: null,
    notes: "",
    createdByUserId: "user-1",
    createdAt: "2026-08-27T00:00:00Z",
  };
}

function installment(id: string, debtId: string, versionId: string, number: number): DebtInstallment {
  return {
    id,
    scheduleVersionId: versionId,
    debtId,
    installmentNumber: number,
    contractualInstallmentNumber: number,
    dueDate: `2026-${String(number + 5).padStart(2, "0")}-10`,
    expectedAmount: 347.67,
    expectedPrincipal: 138.91,
    expectedInterest: 194.41,
    expectedFees: 0,
    expectedInsurance: 14.35,
    reportedBalance: null,
    isPaidBeforeTracking: number <= 5,
    createdByUserId: "user-1",
    createdAt: "2026-08-27T00:00:00Z",
  };
}

function collateral(id: string, debtId: string): DebtCollateral {
  return {
    id,
    debtId,
    description: "Garantía fixture",
    pledgedValue: null,
    estimatedValue: 5000,
    redemptionDeadline: null,
    status: "pledged",
    notes: "",
    createdByUserId: "user-1",
    createdAt: "2026-08-27T00:00:00Z",
    updatedAt: "2026-08-27T00:00:00Z",
  };
}

function emptyAppData(): AppData {
  return {
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
  };
}

function createResult(): DebtCreateResult {
  const createdDebt = debt("new-debt");
  const version = scheduleVersion("version-1", createdDebt.id);
  return {
    debt: createdDebt,
    scheduleVersion: version,
    installments: [installment("installment-1", createdDebt.id, version.id, 1), installment("installment-2", createdDebt.id, version.id, 2)],
    collaterals: [collateral("collateral-1", createdDebt.id)],
  };
}

describe("mergeDebtCreateResultIntoAppData", () => {
  it("makes a newly created debt visible immediately", () => {
    const result = createResult();
    const merged = mergeDebtCreateResultIntoAppData(emptyAppData(), result);

    expect(merged.debts).toContainEqual(result.debt);
    expect(merged.debts).toHaveLength(1);
  });

  it("adds the schedule version, installments, and collaterals returned by the RPC", () => {
    const result = createResult();
    const merged = mergeDebtCreateResultIntoAppData(emptyAppData(), result);

    expect(merged.debtScheduleVersions).toEqual([result.scheduleVersion]);
    expect(merged.debtInstallments).toEqual(result.installments);
    expect(merged.debtCollaterals).toEqual(result.collaterals);
  });

  it("is idempotent when the same create result is applied twice", () => {
    const result = createResult();
    const once = mergeDebtCreateResultIntoAppData(emptyAppData(), result);
    const twice = mergeDebtCreateResultIntoAppData(once, result);

    expect(twice.debts).toHaveLength(1);
    expect(twice.debtScheduleVersions).toHaveLength(1);
    expect(twice.debtInstallments).toHaveLength(2);
    expect(twice.debtCollaterals).toHaveLength(1);
    expect(containsDebtCreateResult(twice, result)).toBe(true);
  });

  it("preserves unrelated debts and their related rows", () => {
    const result = createResult();
    const otherDebt = debt("other-debt");
    const otherVersion = scheduleVersion("other-version", otherDebt.id);
    const otherInstallment = installment("other-installment", otherDebt.id, otherVersion.id, 1);
    const otherCollateral = collateral("other-collateral", otherDebt.id);
    const initial = emptyAppData();
    initial.debts = [otherDebt];
    initial.debtScheduleVersions = [otherVersion];
    initial.debtInstallments = [otherInstallment];
    initial.debtCollaterals = [otherCollateral];

    const merged = mergeDebtCreateResultIntoAppData(initial, result);

    expect(merged.debts.map((item) => item.id)).toEqual([otherDebt.id, result.debt.id]);
    expect(merged.debtScheduleVersions.map((item) => item.id)).toEqual([otherVersion.id, result.scheduleVersion!.id]);
    expect(merged.debtInstallments.map((item) => item.id)).toEqual([otherInstallment.id, ...result.installments.map((item) => item.id)]);
    expect(merged.debtCollaterals.map((item) => item.id)).toEqual([otherCollateral.id, result.collaterals[0]!.id]);
  });

  it("reconciles a later authoritative snapshot with the same IDs without duplicates", () => {
    const result = createResult();
    const afterCreate = mergeDebtCreateResultIntoAppData(emptyAppData(), result);
    const authoritative = mergeDebtCreateResultIntoAppData(afterCreate, {
      ...result,
      debt: { ...result.debt, updatedAt: "2026-08-27T00:01:00Z" },
    });

    expect(authoritative.debts).toHaveLength(1);
    expect(authoritative.debtScheduleVersions).toHaveLength(1);
    expect(authoritative.debtInstallments).toHaveLength(2);
    expect(authoritative.debtCollaterals).toHaveLength(1);
  });
});
