import type { CreditCardEntry, FinancialAccount, Movement, PaymentMethod } from "../types";
import { isCreditCardMovementEffective } from "./creditCardCalculations";

export const UNASSIGNED_ACCOUNT_ID = "__unassigned__";
const UNASSIGNED_ACCOUNT_LABEL = "Sin cuenta (histórico)";

export function getActiveCashAccount(accounts: FinancialAccount[]): FinancialAccount | null {
  return accounts.find((account) => account.reconciliationType === "cash" && account.isActive) ?? null;
}

export function isDefaultCashAccount(account: FinancialAccount) {
  return account.reconciliationType === "cash";
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

export function expectedAccountBalance(
  movements: Movement[],
  accountId: string,
  openingBalance: number,
  creditCardEntries?: CreditCardEntry[]
) {
  return movements.reduce((total, movement) => {
    if (movement.accountId !== accountId) return total;
    if (creditCardEntries && !isCreditCardMovementEffective(movement.id, creditCardEntries)) {
      return total;
    }
    return movement.type === "ingreso" ? total + movement.amount : total - movement.amount;
  }, openingBalance);
}