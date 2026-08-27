import type { ScheduleSource } from "../types.js";

export interface BankLoanBaselineRow {
  contractualInstallmentNumber: number;
  isPaidBeforeTracking?: boolean;
}

export interface BankLoanScheduleConsistencyInput {
  onboardingMode: "EXISTING_DEBT" | "NEW_DEBT";
  installmentsPaidBeforeTracking: number | string | null | undefined;
  plannedInstallmentCount: number | string | null | undefined;
  scheduleSource: ScheduleSource | null | undefined;
  installments: Array<{
    installmentNumber: number;
    contractualInstallmentNumber?: number | null;
  }>;
}

/**
 * Marks historical installments only when the initial schedule is a complete
 * schedule beginning at contractual installment 1. A pending-only import is
 * metadata for future obligations and must never manufacture historical debt.
 */
export function applyInitialBankLoanBaseline<T extends BankLoanBaselineRow>(
  rows: T[],
  installmentsPaidBeforeTracking: number,
  totalInstallments?: number | null
): T[] {
  const knownTotal = totalInstallments != null && Number.isInteger(totalInstallments) && totalInstallments > 0
    ? totalInstallments
    : null;
  const startsAtOne = rows[0]?.contractualInstallmentNumber === 1;
  const endsAtKnownTotal = knownTotal == null || rows.at(-1)?.contractualInstallmentNumber === knownTotal;
  const isCompleteInitialSchedule = startsAtOne && endsAtKnownTotal;
  return rows.map((row) => ({
    ...row,
    isPaidBeforeTracking: isCompleteInitialSchedule && row.contractualInstallmentNumber <= installmentsPaidBeforeTracking,
  }));
}

export function normalizeBankLoanScheduleRows<T extends { contractualInstallmentNumber?: number | null }>(rows: T[]): Array<T & { installmentNumber: number; contractualInstallmentNumber: number }> {
  return rows.map((row, index) => ({
    ...row,
    installmentNumber: index + 1,
    contractualInstallmentNumber: row.contractualInstallmentNumber ?? index + 1,
  }));
}

export function bankLoanBaselineSummary(totalInstallments: number | null | undefined, paidBefore: number): {
  total: number | null;
  paid: number;
  nextContractualNumber: number | null;
  pending: number | null;
} {
  const total = totalInstallments != null && Number.isInteger(totalInstallments) && totalInstallments > 0 ? totalInstallments : null;
  return {
    total,
    paid: Math.max(0, paidBefore),
    nextContractualNumber: total == null ? null : paidBefore < total ? paidBefore + 1 : null,
    pending: total == null ? null : Math.max(0, total - paidBefore),
  };
}

export function baselineConsistencyWarning(
  installmentsPaidBeforeTracking: number,
  firstContractualInstallmentNumber: number | null | undefined
): string | null {
  if (!firstContractualInstallmentNumber || installmentsPaidBeforeTracking < 0) return null;
  const expectedNext = installmentsPaidBeforeTracking + 1;
  if (firstContractualInstallmentNumber === expectedNext || firstContractualInstallmentNumber === 1) return null;
  return `Dijiste que la próxima cuota es la ${expectedNext}, pero el archivo comienza en la ${firstContractualInstallmentNumber}. Revisa la última cuota pagada o el archivo.`;
}

/**
 * Derives the current client-side invariant for an initial bank schedule.
 * This deliberately reads current form values on every render instead of
 * preserving a parse-time snapshot, so edits to the baseline or term cannot
 * leave a stale warning behind.
 */
export function bankLoanScheduleConsistencyError(input: BankLoanScheduleConsistencyInput): string | null {
  if (input.installments.length === 0 || input.scheduleSource == null) return null;

  const paidBefore = input.onboardingMode === "EXISTING_DEBT"
    ? input.installmentsPaidBeforeTracking == null || input.installmentsPaidBeforeTracking === ""
      ? null
      : Number(input.installmentsPaidBeforeTracking)
    : 0;
  const term = input.plannedInstallmentCount == null || input.plannedInstallmentCount === ""
    ? null
    : Number(input.plannedInstallmentCount);
  const firstContractual = input.installments[0].contractualInstallmentNumber ?? input.installments[0].installmentNumber;
  const lastContractual = input.installments.at(-1)?.contractualInstallmentNumber
    ?? input.installments.at(-1)?.installmentNumber
    ?? null;

  if (paidBefore == null || !Number.isInteger(paidBefore) || paidBefore < (input.onboardingMode === "EXISTING_DEBT" ? 1 : 0) || !Number.isInteger(firstContractual) || firstContractual <= 0) {
    return null;
  }

  if (input.scheduleSource === "estimated") {
    if (firstContractual !== 1) {
      return "El cronograma estimado debe representar el contrato completo y comenzar en la cuota 1.";
    }
    if (term != null && Number.isInteger(term) && term > 0 && lastContractual !== term) {
      return `El cronograma estimado debe terminar en la cuota ${term}.`;
    }
    return null;
  }

  if (input.scheduleSource !== "contractual" && input.scheduleSource !== "reconstructed") return null;

  const expectedNext = paidBefore + 1;
  if (firstContractual > 1 && firstContractual !== expectedNext) {
    return `Dijiste que la próxima cuota es la ${expectedNext}, pero el cronograma comienza en la ${firstContractual}. Corrige la última cuota pagada o el cronograma.`;
  }

  if (term != null && Number.isInteger(term) && term > 0 && lastContractual !== term) {
    if (firstContractual > 1) {
      return `El cronograma parcial debe terminar en la cuota ${term}.`;
    }
    return `El cronograma completo debe terminar en la cuota ${term}.`;
  }

  return null;
}
