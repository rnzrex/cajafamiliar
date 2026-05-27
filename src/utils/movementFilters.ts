import { Movement, MovementType, PaymentMethod } from "../types";
import { monthKey } from "./calculations";

export type DateFilterMode = "all" | "month" | "date" | "range";
export type MovementTypeFilter = MovementType | "todos";
export type PaymentMethodFilter = PaymentMethod | "todos";

export interface MovementFilters {
  dateMode: DateFilterMode;
  month: string;
  exactDate: string;
  dateFrom: string;
  dateTo: string;
  category: string;
  method: PaymentMethodFilter;
  type: MovementTypeFilter;
}

export const defaultMovementFilters = (): MovementFilters => ({
  dateMode: "all",
  month: monthKey(new Date().toISOString()),
  exactDate: new Date().toISOString().slice(0, 10),
  dateFrom: "",
  dateTo: "",
  category: "todas",
  method: "todos",
  type: "todos",
});

export function filterMovements(movements: Movement[], filters: MovementFilters) {
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
    .filter((movement) => filters.category === "todas" || movement.category === filters.category)
    .filter((movement) => filters.method === "todos" || movement.method === filters.method)
    .filter((movement) => filters.type === "todos" || movement.type === filters.type)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function describeFilters(filters: MovementFilters) {
  const parts: string[] = [];
  if (filters.dateMode === "month") parts.push(`Mes ${filters.month}`);
  if (filters.dateMode === "date") parts.push(`Fecha ${filters.exactDate}`);
  if (filters.dateMode === "range") parts.push(`Rango ${filters.dateFrom || "inicio"} a ${filters.dateTo || "fin"}`);
  if (filters.dateMode === "all") parts.push("Reporte total");
  if (filters.category !== "todas") parts.push(`Categoria ${filters.category}`);
  if (filters.method !== "todos") parts.push(`Metodo ${filters.method}`);
  if (filters.type !== "todos") parts.push(`Tipo ${filters.type}`);
  return parts.join(" - ");
}

export function movementTotals(movements: Movement[]) {
  const income = movements.filter((movement) => movement.type === "ingreso").reduce((sum, movement) => sum + movement.amount, 0);
  const expense = movements.filter((movement) => movement.type === "egreso").reduce((sum, movement) => sum + movement.amount, 0);
  return { income, expense, balance: income - expense };
}
