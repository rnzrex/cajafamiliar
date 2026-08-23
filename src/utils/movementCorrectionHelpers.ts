import type { FinancialAccount, HouseholdMember } from "../types.js";
import { formatMoneyByCurrency } from "./calculations.js";
import { accountNameForMovement } from "./accountHelpers.js";

export interface MovementFieldChange {
  fieldKey: string;
  label: string;
  beforeValue: string;
  afterValue: string;
}

export function formatMovementCorrectionUser(
  registeredByUserId: string,
  currentMember?: HouseholdMember
): string {
  if (currentMember && currentMember.userId === registeredByUserId) {
    return currentMember.displayName || "Tú";
  }
  return "Otro miembro";
}

export function formatMovementDateShort(value: string | undefined | null): string {
  if (!value || typeof value !== "string") return "-";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

export function getMovementCorrectionFieldChanges(
  beforeSnapshot: Record<string, any> = {},
  afterSnapshot: Record<string, any> = {},
  accounts: FinancialAccount[] = []
): MovementFieldChange[] {
  const changes: MovementFieldChange[] = [];

  // 1. Date
  const beforeDate = String(beforeSnapshot.date || "");
  const afterDate = String(afterSnapshot.date || "");
  if (beforeDate !== afterDate) {
    changes.push({
      fieldKey: "date",
      label: "Fecha",
      beforeValue: formatMovementDateShort(beforeDate),
      afterValue: formatMovementDateShort(afterDate),
    });
  }

  // Resolve currencies independently per snapshot's account
  const beforeAccId = beforeSnapshot.account_id || beforeSnapshot.accountId;
  const afterAccId = afterSnapshot.account_id || afterSnapshot.accountId;

  const beforeAccount = accounts.find((a) => a.id === beforeAccId);
  const afterAccount = accounts.find((a) => a.id === afterAccId);

  const beforeCurrency = beforeAccount?.currencyCode || "PEN";
  const afterCurrency = afterAccount?.currencyCode || "PEN";

  // 2. Amount
  const beforeAmount = Number(beforeSnapshot.amount);
  const afterAmount = Number(afterSnapshot.amount);
  if (beforeAmount !== afterAmount || beforeCurrency !== afterCurrency) {
    changes.push({
      fieldKey: "amount",
      label: "Monto",
      beforeValue: Number.isFinite(beforeAmount) ? formatMoneyByCurrency(beforeAmount, beforeCurrency) : "-",
      afterValue: Number.isFinite(afterAmount) ? formatMoneyByCurrency(afterAmount, afterCurrency) : "-",
    });
  }

  // 3. Description
  const beforeDesc = String(beforeSnapshot.description || "");
  const afterDesc = String(afterSnapshot.description || "");
  if (beforeDesc !== afterDesc) {
    changes.push({
      fieldKey: "description",
      label: "Descripción",
      beforeValue: beforeDesc || "-",
      afterValue: afterDesc || "-",
    });
  }

  // 4. Method
  const beforeMethod = String(beforeSnapshot.method || "");
  const afterMethod = String(afterSnapshot.method || "");
  if (beforeMethod !== afterMethod) {
    changes.push({
      fieldKey: "method",
      label: "Método de pago",
      beforeValue: beforeMethod || "-",
      afterValue: afterMethod || "-",
    });
  }

  // 5. Category
  const beforeCat = String(beforeSnapshot.category || "");
  const afterCat = String(afterSnapshot.category || "");
  if (beforeCat !== afterCat) {
    changes.push({
      fieldKey: "category",
      label: "Categoría",
      beforeValue: beforeCat || "-",
      afterValue: afterCat || "-",
    });
  }

  // 6. Person
  const beforePerson = String(beforeSnapshot.person || "");
  const afterPerson = String(afterSnapshot.person || "");
  if (beforePerson !== afterPerson) {
    changes.push({
      fieldKey: "person",
      label: "Persona",
      beforeValue: beforePerson || "-",
      afterValue: afterPerson || "-",
    });
  }

  // 7. Account
  if (beforeAccId !== afterAccId) {
    const beforeAccName = accountNameForMovement({ accountId: beforeAccId } as any, accounts);
    const afterAccName = accountNameForMovement({ accountId: afterAccId } as any, accounts);
    changes.push({
      fieldKey: "accountId",
      label: "Cuenta",
      beforeValue: beforeAccName,
      afterValue: afterAccName,
    });
  }

  return changes;
}
