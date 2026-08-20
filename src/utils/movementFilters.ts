import { DebtEvent, FinancialAccount, Movement, MovementType } from "../types";
import { UNASSIGNED_ACCOUNT_ID, accountNameForMovement } from "./accountHelpers";
import { monthKey } from "./calculations";
import { localDateString, localMonthString } from "./date";
import { getMovementEconomics } from "./movementEconomics";

export type DateFilterMode = "all" | "month" | "date" | "range";
export type MovementTypeFilter = MovementType | "todos";

export interface MovementFilters {
  search: string;
  dateMode: DateFilterMode;
  month: string;
  exactDate: string;
  dateFrom: string;
  dateTo: string;
  category: string;
  accountId: string;
  type: MovementTypeFilter;
}

export const defaultMovementFilters = (): MovementFilters => ({
  search: "",
  dateMode: "all",
  month: localMonthString(),
  exactDate: localDateString(),
  dateFrom: "",
  dateTo: "",
  category: "todas",
  accountId: "",
  type: "todos",
});

export function filterMovements(movements: Movement[], filters: MovementFilters, accounts: FinancialAccount[] = []) {
  const search = normalizeSearch(filters.search);

  return movements
    .filter((movement) => {
      if (filters.dateMode === "month") return monthKey(movement.date) === filters.month;
      if (filters.dateMode === "date") return movement.date === filters.exactDate;
      if (filters.dateMode === "range") {
        const afterStart = !filters.dateFrom || movement.date >= filters.dateFrom;
        const beforeEnd = !filters.dateTo || movement.date <= filters.dateTo;
        return afterStart && beforeEnd;
      }
      return true;
    })
    .filter((movement) => {
      if (!search) return true;
      return [movement.description, movement.category, movement.person, accountNameForMovement(movement, accounts)].some((value) => normalizeSearch(value).includes(search));
    })
    .filter((movement) => filters.category === "todas" || movement.category === filters.category)
    .filter((movement) => {
      if (!filters.accountId) return true;
      if (filters.accountId === UNASSIGNED_ACCOUNT_ID) return movement.accountId == null;
      return movement.accountId === filters.accountId;
    })
    .filter((movement) => filters.type === "todos" || movement.type === filters.type)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function normalizeSearch(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function describeFilters(filters: MovementFilters, accountName?: string) {
  const parts: string[] = [];
  if (filters.dateMode === "month") parts.push(`Mes ${filters.month}`);
  if (filters.dateMode === "date") parts.push(`Fecha ${filters.exactDate}`);
  if (filters.dateMode === "range") parts.push(`Rango ${filters.dateFrom || "inicio"} a ${filters.dateTo || "fin"}`);
  if (filters.dateMode === "all") parts.push("Reporte total");
  if (filters.category !== "todas") parts.push(`Categoria ${filters.category}`);
  if (filters.accountId) parts.push(`Cuenta ${accountName ?? (filters.accountId === UNASSIGNED_ACCOUNT_ID ? "Sin cuenta (historico)" : filters.accountId)}`);
  if (filters.type !== "todos") parts.push(`Tipo ${filters.type}`);
  return parts.join(" - ");
}

export function movementTotals(movements: Movement[], debtEvents: DebtEvent[] = []) {
  const totals = movements.reduce(
    (totals, movement) => {
      if (movement.type === "ingreso") {
        totals.income += movement.amount;
        return totals;
      }

      const economics = getMovementEconomics(movement, debtEvents);
      totals.cashOutflow += economics.cashOutflow;
      totals.expense += economics.economicExpense;
      totals.principalReduction += economics.principalReduction;
      totals.unresolvedDebtServiceOutflow += economics.unresolvedDebtServiceOutflow;
      totals.unclassifiedDebtCost += economics.unclassifiedDebtCost;
      return totals;
    },
    {
      income: 0,
      cashOutflow: 0,
      expense: 0,
      principalReduction: 0,
      unresolvedDebtServiceOutflow: 0,
      unclassifiedDebtCost: 0,
    }
  );

  return {
    ...totals,
    balance: totals.income - totals.cashOutflow,
    economicBalance: totals.income - totals.expense,
  };
}
