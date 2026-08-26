import type { Debt, DebtInstallment, ScheduleSource } from "../types.js";
import type { DebtIntelligenceItem } from "./debtIntelligence.js";

export interface ContractualDetailNextPayment {
  source: "contractual_schedule" | "estimated_schedule";
  installmentNumber: number;
  dueDate: string;
  remainingAmount: number | null;
  amountKnown: boolean;
  installment: DebtInstallment | null;
}

/**
 * Resolves the fixed-schedule detail card from the same intelligence item
 * consumed by Agenda and planning. It must not infer a contractual date from
 * debt_events because pre-tracking baseline rows intentionally have no events.
 */
export function resolveContractualDetailNextPayment(params: {
  debt: Debt;
  debtIntelligence: Pick<DebtIntelligenceItem, "nextInstallmentId" | "nextInstallmentNumber" | "nextInstallmentDueDate" | "nextInstallmentRemainingAmount" | "nextInstallmentAmountKnown" | "pendingBankSchedule">;
  currentScheduleId: string | null;
  scheduleSource?: ScheduleSource | null;
  installments: DebtInstallment[];
}): ContractualDetailNextPayment | null {
  const { debt, debtIntelligence, currentScheduleId, scheduleSource, installments } = params;
  if (debt.repaymentStructure !== "fixed_schedule" || !currentScheduleId || debtIntelligence.pendingBankSchedule) {
    return null;
  }
  if (debtIntelligence.nextInstallmentNumber == null || !debtIntelligence.nextInstallmentDueDate) {
    return null;
  }

  const installment = debtIntelligence.nextInstallmentId
    ? installments.find((candidate) => candidate.id === debtIntelligence.nextInstallmentId) ?? null
    : null;

  return {
    source: scheduleSource === "contractual" ? "contractual_schedule" : "estimated_schedule",
    installmentNumber: debtIntelligence.nextInstallmentNumber,
    dueDate: debtIntelligence.nextInstallmentDueDate,
    remainingAmount: debtIntelligence.nextInstallmentRemainingAmount,
    amountKnown: debtIntelligence.nextInstallmentAmountKnown,
    installment,
  };
}
