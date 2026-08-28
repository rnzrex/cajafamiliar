import type { Debt, DebtEvent, DebtEventInstallmentAllocation, DebtInstallment, DebtScheduleVersion } from "../types.js";

export function effectiveDebtEvents(events: DebtEvent[], debtId?: string): DebtEvent[] {
  const reversedIds = new Set(
    events
      .filter((event) => event.eventType === "reversal")
      .map((reversal) => reversal.reversalOfEventId)
      .filter((reversalOfEventId): reversalOfEventId is string => reversalOfEventId !== null)
  );
  return events.filter(
    (event) =>
      event.eventType !== "reversal" &&
      !reversedIds.has(event.id) &&
      (debtId === undefined || event.debtId === debtId)
  );
}

export const DEBT_FUND_EVENT_TYPES = new Set<string>(["payment", "principal_prepayment", "payoff", "installment_advance"]);

export function effectiveDebtFundEvents(events: DebtEvent[], debtId?: string): DebtEvent[] {
  return effectiveDebtEvents(events, debtId).filter((event) => DEBT_FUND_EVENT_TYPES.has(event.eventType));
}

export function currentDebtPrincipal(debt: Debt, events: DebtEvent[]): number {
  return debt.openingPrincipalBalance + effectiveDebtEvents(events, debt.id).reduce((sum, event) => sum + event.principalDelta, 0);
}

export function currentDebtScheduleVersion(debtId: string, versions: DebtScheduleVersion[]): DebtScheduleVersion | null {
  let best: DebtScheduleVersion | null = null;
  for (const version of versions) {
    if (version.debtId !== debtId) continue;
    if (best === null || version.versionNumber > best.versionNumber) best = version;
  }
  return best;
}

export function effectiveInstallmentAllocations(allocations: DebtEventInstallmentAllocation[], events: DebtEvent[], debtId?: string): DebtEventInstallmentAllocation[] {
  const effectivePaymentsById = new Map(
    effectiveDebtEvents(events, debtId)
      .filter((event) => event.eventType === "payment" || event.eventType === "installment_advance")
      .map((event) => [event.id, event])
  );
  return allocations.filter((allocation) => {
    const event = effectivePaymentsById.get(allocation.eventId);
    if (!event) return false;
    if (allocation.debtId !== event.debtId) return false;
    if (debtId !== undefined && allocation.debtId !== debtId) return false;
    return true;
  });
}

export function allocatedAmountForInstallment(installmentId: string, allocations: DebtEventInstallmentAllocation[], events: DebtEvent[]): number {
  return effectiveInstallmentAllocations(allocations, events).reduce(
    (sum, allocation) => (allocation.installmentId === installmentId ? sum + allocation.allocatedAmount : sum),
    0
  );
}

/**
 * Total current obligation coverage for a persisted installment.
 *
 * `carriedAllocatedAmount` is state copied onto a restored schedule row; it
 * is deliberately kept separate from effective allocation rows so economic
 * ledger totals never double-count a payment or advance.
 */
export function totalAllocatedAmountForInstallment(
  installment: Pick<DebtInstallment, "id" | "debtId" | "carriedAllocatedAmount">,
  allocations: DebtEventInstallmentAllocation[],
  events: DebtEvent[]
): number {
  const carried = Number.isFinite(installment.carriedAllocatedAmount)
    ? Math.max(0, installment.carriedAllocatedAmount ?? 0)
    : 0;
  return carried + effectiveInstallmentAllocations(allocations, events, installment.debtId)
    .filter((allocation) => allocation.installmentId === installment.id)
    .reduce((sum, allocation) => sum + allocation.allocatedAmount, 0);
}
