import type { DebtInstallment } from "../types.js";

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Returns the balance represented by an estimated schedule after a row.
 *
 * Estimated balances are historical projections, so they must be derived only
 * from the schedule itself. Using today's debt principal would subtract rows
 * again after a real payment is recorded.
 */
export function estimatedBalanceAfterRow(
  installments: Array<Pick<DebtInstallment, "expectedPrincipal">>,
  rowIndex: number,
): number | null {
  if (rowIndex < 0 || rowIndex >= installments.length) return null;
  if (!installments.every((row) => row.expectedPrincipal != null && Number.isFinite(row.expectedPrincipal))) return null;
  return Math.max(0, round2(installments.slice(rowIndex + 1).reduce((sum, row) => sum + Number(row.expectedPrincipal), 0)));
}
