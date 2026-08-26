export interface BankLoanBaselineRow {
  contractualInstallmentNumber: number;
  isPaidBeforeTracking?: boolean;
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
