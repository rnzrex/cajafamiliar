import type { DebtKind } from "../types";

export function isCreditCardDebtKind(kind: DebtKind): boolean {
  return kind === "credit_card";
}

export const DEBT_KIND_OPTIONS: Array<{ value: DebtKind; label: string }> = [
  { value: "bank_loan", label: "Préstamo bancario" },
  { value: "family_loan", label: "Préstamo familiar" },
  { value: "installment_purchase", label: "Compra en cuotas" },
  { value: "mortgage", label: "Hipoteca" },
  { value: "pledge", label: "Pignoración / Empeño" },
  { value: "credit_card", label: "Tarjeta de crédito" },
  { value: "other", label: "Otro" },
];
