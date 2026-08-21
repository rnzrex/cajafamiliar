import { localDateString, parseLocalDate } from "./date.js";

/**
 * Kinds of due-date status shared across all obligation domains.
 * This is the generic SSOT for date-proximity classification.
 */
export type DueDateKind = "overdue" | "today" | "tomorrow" | "upcoming" | "later";

export interface DueDateStatus {
  kind: DueDateKind;
  label: string;
  tone: "red" | "orange" | "yellow" | "blue";
  days: number;
  dueDate?: string;
}

/**
 * Classify a due date relative to today.
 *
 * @param dueDate  ISO date string "YYYY-MM-DD", or null/invalid.
 * @param todayKey Optional override for today as "YYYY-MM-DD". Defaults to
 *                 the current local date (America/Lima). Useful for
 *                 deterministic tests.
 *
 * Semantics (exact, preserved from the original calculations.ts):
 *   invalid / null        → later, "Fecha por confirmar"
 *   diff < 0              → overdue
 *   diff === 0            → today
 *   diff === 1            → tomorrow
 *   2 <= diff <= 7        → upcoming
 *   diff > 7              → later
 *
 * "later" with an unknown date uses days=999 and omits dueDate.
 */
export function dueDateStatus(dueDate: string | null, todayKey?: string): DueDateStatus {
  const key = todayKey ?? localDateString();
  const today = parseLocalDate(key);
  if (!today) return { kind: "later", label: "Fecha por confirmar", tone: "blue", days: 999 };
  if (!dueDate || !parseLocalDate(dueDate)) return { kind: "later", label: "Fecha por confirmar", tone: "blue", days: 999 };

  const due = parseLocalDate(dueDate)!;
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);

  if (diff < 0) return { kind: "overdue", label: `Vencido hace ${Math.abs(diff)} ${Math.abs(diff) === 1 ? "día" : "días"}`, tone: "red", days: diff, dueDate };
  if (diff === 0) return { kind: "today", label: "Vence hoy", tone: "orange", days: 0, dueDate };
  if (diff === 1) return { kind: "tomorrow", label: "Vence mañana", tone: "yellow", days: 1, dueDate };
  if (diff <= 7) return { kind: "upcoming", label: `Vence en ${diff} días`, tone: "blue", days: diff, dueDate };
  return { kind: "later", label: `Vence en ${diff} días`, tone: "blue", days: diff, dueDate };
}
