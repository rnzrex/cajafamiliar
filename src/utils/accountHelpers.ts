import type { FinancialAccount, Movement, PaymentMethod } from "../types";

export const UNASSIGNED_ACCOUNT_ID = "__unassigned__";
export const LEGACY_CASH_ACCOUNT_NAME = "Efectivo";
const UNASSIGNED_ACCOUNT_LABEL = "Sin cuenta (histórico)";

export function getActiveCashAccount(accounts: FinancialAccount[]): FinancialAccount | null {
  return accounts.find((account) => account.reconciliationType === "cash" && account.isActive) ?? null;
}

export function isDefaultCashAccount(account: FinancialAccount) {
  return account.name === LEGACY_CASH_ACCOUNT_NAME && account.reconciliationType === "cash";
}

export function accountNameForMovement(movement: Movement, accounts: FinancialAccount[]): string {
  if (!movement.accountId) return UNASSIGNED_ACCOUNT_LABEL;
  const account = accounts.find((item) => item.id === movement.accountId);
  return account ? account.name : UNASSIGNED_ACCOUNT_LABEL;
}

export function accountDisplayName(account: FinancialAccount | null | undefined): string {
  if (!account) return UNASSIGNED_ACCOUNT_LABEL;
  return account.isActive ? account.name : `${account.name} (archivada)`;
}

export function legacyMethodForAccount(account: FinancialAccount | null): PaymentMethod {
  return account?.reconciliationType === "balance" ? "transferencia" : "efectivo";
}

export function expectedAccountBalance(movements: Movement[], accountId: string, openingBalance: number) {
  return movements.reduce((total, movement) => {
    if (movement.accountId !== accountId) return total;
    return movement.type === "ingreso" ? total + movement.amount : total - movement.amount;
  }, openingBalance);
}