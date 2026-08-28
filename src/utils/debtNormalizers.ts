import type { Debt, DebtCollateral, DebtEvent, DebtEventInstallmentAllocation, DebtInstallment, DebtInstallmentCarriedAllocation, DebtScheduleVersion } from "../types";

export function normalizeDebts(saved: Debt[]): Debt[] {
  return saved.map((debt) => ({
    ...debt,
    currencyCode: debt.currencyCode,
    originDate: debt.originDate ?? null,
    originalPrincipal: debt.originalPrincipal == null ? null : Number(debt.originalPrincipal),
    openingPrincipalBalance: Number(debt.openingPrincipalBalance),
    plannedInstallmentCount: debt.plannedInstallmentCount == null ? null : Number(debt.plannedInstallmentCount),
    plannedInstallmentAmount: debt.plannedInstallmentAmount == null ? null : Number(debt.plannedInstallmentAmount),
    paymentFrequency: debt.paymentFrequency ?? null,
    customFrequencyDays: debt.customFrequencyDays == null ? null : Number(debt.customFrequencyDays),
    firstDueDate: debt.firstDueDate ?? null,
    teaPercent: debt.teaPercent == null ? null : Number(debt.teaPercent),
    tceaPercent: debt.tceaPercent == null ? null : Number(debt.tceaPercent),
    notes: debt.notes ?? "",
    isArchived: debt.isArchived,
  }));
}

export function normalizeDebtEvents(saved: DebtEvent[]): DebtEvent[] {
  return saved.map((event) => ({
    ...event,
    cashAmount: Number(event.cashAmount),
    principalDelta: Number(event.principalDelta),
    interestPaid: Number(event.interestPaid),
    feesPaid: Number(event.feesPaid),
    insurancePaid: Number(event.insurancePaid),
    otherCostPaid: Number(event.otherCostPaid),
    breakdownComplete: event.breakdownComplete,
    movementId: event.movementId ?? null,
    reversalOfEventId: event.reversalOfEventId ?? null,
    description: event.description ?? "",
  }));
}

export function normalizeDebtScheduleVersions(saved: DebtScheduleVersion[]): DebtScheduleVersion[] {
  return saved.map((version) => ({
    ...version,
    versionNumber: Number(version.versionNumber),
    triggerEventId: version.triggerEventId ?? null,
    notes: version.notes ?? "",
  }));
}

export function normalizeDebtInstallments(saved: DebtInstallment[]): DebtInstallment[] {
  return saved.map((installment) => ({
    ...installment,
    installmentNumber: Number(installment.installmentNumber),
    contractualInstallmentNumber: installment.contractualInstallmentNumber == null
      ? Number(installment.installmentNumber)
      : Number(installment.contractualInstallmentNumber),
    isPaidBeforeTracking: Boolean(installment.isPaidBeforeTracking),
    expectedAmount: installment.expectedAmount == null ? null : Number(installment.expectedAmount),
    expectedPrincipal: installment.expectedPrincipal == null ? null : Number(installment.expectedPrincipal),
    expectedInterest: installment.expectedInterest == null ? null : Number(installment.expectedInterest),
    expectedFees: installment.expectedFees == null ? null : Number(installment.expectedFees),
    expectedInsurance: installment.expectedInsurance == null ? null : Number(installment.expectedInsurance),
  }));
}

export function normalizeDebtEventInstallmentAllocations(saved: DebtEventInstallmentAllocation[]): DebtEventInstallmentAllocation[] {
  return saved.map((allocation) => ({
    ...allocation,
    allocatedAmount: Number(allocation.allocatedAmount),
  }));
}

export function normalizeDebtInstallmentCarriedAllocations(saved: DebtInstallmentCarriedAllocation[]): DebtInstallmentCarriedAllocation[] {
  return saved.map((allocation) => ({
    ...allocation,
    allocatedAmount: Number(allocation.allocatedAmount),
  }));
}

export function normalizeDebtCollaterals(saved: DebtCollateral[]): DebtCollateral[] {
  return saved.map((collateral) => ({
    ...collateral,
    pledgedValue: collateral.pledgedValue == null ? null : Number(collateral.pledgedValue),
    estimatedValue: collateral.estimatedValue == null ? null : Number(collateral.estimatedValue),
    redemptionDeadline: collateral.redemptionDeadline ?? null,
    notes: collateral.notes ?? "",
  }));
}
