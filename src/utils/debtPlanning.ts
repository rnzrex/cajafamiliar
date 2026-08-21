import type {
  Debt,
  DebtEvent,
  DebtEventInstallmentAllocation,
  DebtInstallment,
  DebtScheduleVersion,
} from "../types.js";
import {
  allocatedAmountForInstallment,
  currentDebtScheduleVersion,
  effectiveDebtEvents,
} from "./debtCalculations.js";
import { dueDateStatus } from "./dueDates.js";
import type { DueDateKind, DueDateStatus } from "./dueDates.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Extended due-status for Debt installments.
 * "covered" is prepended and has priority over all date-based kinds.
 */
export type InstallmentDueStatus = "covered" | DueDateKind;

/**
 * A fully-derived, client-side read-model for a single DebtInstallment.
 * Nothing here is persisted. All values are computed on every render from
 * the raw AppData already loaded.
 *
 * Key invariants:
 *   - expectedAmount === null  → amountKnown=false, remainingAmount=null, isCovered=false
 *   - isCovered=true           → dueStatus="covered" (regardless of whether dueDate is past)
 *   - null + positive allocation → still NOT covered
 */
export interface DebtInstallmentPlanningItem {
  // Debt context
  debtId: string;
  debtName: string;
  creditorName: string;
  currencyCode: string;

  // Installment identity
  installmentId: string;
  installmentNumber: number;
  scheduleVersionId: string;
  dueDate: string; // "YYYY-MM-DD"

  // Temporal classification (never persisted)
  daysUntilDue: number;      // negative = overdue; 999 = unknown date
  dueStatus: InstallmentDueStatus;
  dueLabel: string;
  dueTone: "green" | "red" | "orange" | "yellow" | "blue";

  // Amounts
  expectedAmount: number | null; // null = unknown, NOT zero
  allocatedAmount: number;
  remainingAmount: number | null; // null when expectedAmount is null
  amountKnown: boolean;
  isCovered: boolean;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build the full list of DebtInstallmentPlanningItem for all eligible debts.
 *
 * Eligible debts: status === "active" AND isArchived === false.
 * Only installments belonging to the current (highest versionNumber) schedule
 * are included. Historical schedule versions are excluded.
 *
 * @param todayKey Optional "YYYY-MM-DD" override for deterministic tests.
 *                 Defaults to the current local date.
 */
export function buildDebtPlanningItems(
  debts: Debt[],
  debtEvents: DebtEvent[],
  scheduleVersions: DebtScheduleVersion[],
  installments: DebtInstallment[],
  allocations: DebtEventInstallmentAllocation[],
  todayKey?: string
): DebtInstallmentPlanningItem[] {
  const items: DebtInstallmentPlanningItem[] = [];

  for (const debt of debts) {
    // Only active, non-archived debts enter planning
    if (debt.status !== "active" || debt.isArchived) continue;

    const currentSchedule = currentDebtScheduleVersion(debt.id, scheduleVersions);
    if (!currentSchedule) continue; // No schedule — nothing to plan

    // Only installments of the current schedule version
    const debtInstallments = installments.filter(
      (i) => i.scheduleVersionId === currentSchedule.id && i.debtId === debt.id
    );

    for (const installment of debtInstallments) {
      const allocatedAmount = allocatedAmountForInstallment(
        installment.id,
        allocations,
        debtEvents
      );

      const { amountKnown, remainingAmount, isCovered } = resolveAmounts(
        installment.expectedAmount,
        allocatedAmount
      );

      const { dueStatus, dueLabel, dueTone, daysUntilDue } = resolveDueStatus(
        installment.dueDate,
        isCovered,
        todayKey
      );

      items.push({
        debtId: debt.id,
        debtName: debt.name,
        creditorName: debt.creditorName,
        currencyCode: debt.currencyCode,
        installmentId: installment.id,
        installmentNumber: installment.installmentNumber,
        scheduleVersionId: currentSchedule.id,
        dueDate: installment.dueDate,
        daysUntilDue,
        dueStatus,
        dueLabel,
        dueTone,
        expectedAmount: installment.expectedAmount,
        allocatedAmount,
        remainingAmount,
        amountKnown,
        isCovered,
      });
    }
  }

  return sortPlanningItems(items);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function resolveAmounts(
  expectedAmount: number | null,
  allocatedAmount: number
): { amountKnown: boolean; remainingAmount: number | null; isCovered: boolean } {
  if (expectedAmount === null) {
    // Unknown amount — allocation cannot imply coverage
    return { amountKnown: false, remainingAmount: null, isCovered: false };
  }
  const remainingAmount = Math.max(0, expectedAmount - allocatedAmount);
  return {
    amountKnown: true,
    remainingAmount,
    isCovered: remainingAmount <= 0,
  };
}

function resolveDueStatus(
  dueDate: string,
  isCovered: boolean,
  todayKey?: string
): { dueStatus: InstallmentDueStatus; dueLabel: string; dueTone: "green" | "red" | "orange" | "yellow" | "blue"; daysUntilDue: number } {
  // "covered" is the highest-priority state — even if the date is past
  if (isCovered) {
    return {
      dueStatus: "covered",
      dueLabel: "Cubierta",
      dueTone: "green",
      daysUntilDue: 0,
    };
  }

  const ds: DueDateStatus = dueDateStatus(dueDate, todayKey);
  return {
    dueStatus: ds.kind,
    dueLabel: ds.label,
    dueTone: ds.tone,
    daysUntilDue: ds.days,
  };
}

/**
 * Stable sort: dueDate ascending → debtName → installmentNumber.
 * Items with invalid/unknown dates go to the end.
 */
function sortPlanningItems(items: DebtInstallmentPlanningItem[]): DebtInstallmentPlanningItem[] {
  return [...items].sort((a, b) => {
    const dateA = a.dueDate ?? "";
    const dateB = b.dueDate ?? "";
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const nameCompare = a.debtName.localeCompare(b.debtName);
    if (nameCompare !== 0) return nameCompare;
    return a.installmentNumber - b.installmentNumber;
  });
}

// ---------------------------------------------------------------------------
// Monthly metrics
// ---------------------------------------------------------------------------

export interface DebtMonthCurrencySummary {
  currencyCode: string;
  scheduledKnownAmount: number;
  coveredKnownAmount: number;
  pendingKnownAmount: number;
  overdueKnownAmount: number;
}

export interface DebtMonthSummary {
  /** Primary currency code or "PEN" */
  currencyCode: string;
  /** True if month items contain more than one distinct currencyCode */
  hasMultipleCurrencies: boolean;
  /** Breakdown by currency code */
  byCurrency: Record<string, DebtMonthCurrencySummary>;

  /** Total installments whose dueDate falls in the month */
  totalInstallments: number;
  /** Installments with expectedAmount !== null */
  knownAmountInstallments: number;
  /** Installments with expectedAmount === null */
  unknownAmountInstallments: number;
  /** Sum of expectedAmount for known-amount installments in the month */
  scheduledKnownAmount: number;
  /** Sum of min(allocatedAmount, expectedAmount) for covered/partial known-amount installments */
  coveredKnownAmount: number;
  /** Sum of remainingAmount for known-amount installments */
  pendingKnownAmount: number;
  /** Sum of remainingAmount for overdue known-amount installments */
  overdueKnownAmount: number;
  /** Count of overdue installments (any amount) in the month */
  overdueInstallments: number;
  /** Count of covered installments in the month */
  coveredInstallments: number;
}

/**
 * Aggregate monthly planning metrics from a set of planning items.
 *
 * @param items     Full list (all months). Function filters by monthKey.
 * @param monthKey  "YYYY-MM"
 */
export function summarizeDebtPlanningMonth(
  items: DebtInstallmentPlanningItem[],
  monthKey: string
): DebtMonthSummary {
  const monthItems = items.filter((item) => item.dueDate.startsWith(monthKey));

  const currencies = new Set<string>();
  const byCurrency: Record<string, DebtMonthCurrencySummary> = {};

  let totalInstallments = 0;
  let knownAmountInstallments = 0;
  let unknownAmountInstallments = 0;
  let scheduledKnownAmount = 0;
  let coveredKnownAmount = 0;
  let pendingKnownAmount = 0;
  let overdueKnownAmount = 0;
  let overdueInstallments = 0;
  let coveredInstallments = 0;

  for (const item of monthItems) {
    totalInstallments++;
    const curr = item.currencyCode || "PEN";
    currencies.add(curr);

    if (!byCurrency[curr]) {
      byCurrency[curr] = {
        currencyCode: curr,
        scheduledKnownAmount: 0,
        coveredKnownAmount: 0,
        pendingKnownAmount: 0,
        overdueKnownAmount: 0,
      };
    }
    const currEntry = byCurrency[curr];

    if (!item.amountKnown) {
      unknownAmountInstallments++;
    } else {
      knownAmountInstallments++;
      const coveredPart = Math.min(item.allocatedAmount, item.expectedAmount!);
      scheduledKnownAmount += item.expectedAmount!;
      coveredKnownAmount += coveredPart;
      pendingKnownAmount += item.remainingAmount!;

      currEntry.scheduledKnownAmount += item.expectedAmount!;
      currEntry.coveredKnownAmount += coveredPart;
      currEntry.pendingKnownAmount += item.remainingAmount!;
    }

    if (item.dueStatus === "overdue") {
      overdueInstallments++;
      if (item.amountKnown) {
        overdueKnownAmount += item.remainingAmount!;
        currEntry.overdueKnownAmount += item.remainingAmount!;
      }
    }

    if (item.dueStatus === "covered") {
      coveredInstallments++;
    }
  }

  const currencyList = Array.from(currencies);
  const primaryCurrency = currencyList.length === 1 ? currencyList[0] : (currencyList[0] || "PEN");
  const hasMultipleCurrencies = currencyList.length > 1;

  return {
    currencyCode: primaryCurrency,
    hasMultipleCurrencies,
    byCurrency,
    totalInstallments,
    knownAmountInstallments,
    unknownAmountInstallments,
    scheduledKnownAmount,
    coveredKnownAmount,
    pendingKnownAmount,
    overdueKnownAmount,
    overdueInstallments,
    coveredInstallments,
  };
}

// ---------------------------------------------------------------------------
// Alert summary
// ---------------------------------------------------------------------------

export interface DebtPlanningAlertSummary {
  overdue: number;
  today: number;
  tomorrow: number;
  upcoming: number;
  total: number;
}

/**
 * Count urgent, non-covered debt installments.
 * "covered" items are excluded from alerts regardless of their due date.
 * "later" items are also excluded — they don't require immediate attention.
 */
export function summarizeDebtPlanningAlerts(
  items: DebtInstallmentPlanningItem[]
): DebtPlanningAlertSummary {
  const summary: DebtPlanningAlertSummary = {
    overdue: 0,
    today: 0,
    tomorrow: 0,
    upcoming: 0,
    total: 0,
  };

  for (const item of items) {
    if (item.dueStatus === "covered" || item.dueStatus === "later") continue;
    if (item.dueStatus === "overdue") summary.overdue++;
    else if (item.dueStatus === "today") summary.today++;
    else if (item.dueStatus === "tomorrow") summary.tomorrow++;
    else if (item.dueStatus === "upcoming") summary.upcoming++;
    summary.total++;
  }

  return summary;
}

// ---------------------------------------------------------------------------
// UX & Navigation Helpers
// ---------------------------------------------------------------------------

/**
 * Return next month key "YYYY-MM" handling Dec -> Jan year rollover.
 */
export function getNextMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  if (month === 12) {
    return `${year + 1}-01`;
  }
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/**
 * Return previous month key "YYYY-MM" handling Jan -> Dec year rollover.
 */
export function getPrevMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  if (month === 1) {
    return `${year - 1}-12`;
  }
  return `${year}-${String(month - 1).padStart(2, "0")}`;
}

/**
 * Format "YYYY-MM" into human label in Spanish, e.g. "Agosto 2026".
 */
export function formatMonthKeyLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  const date = new Date(Date.UTC(year, month - 1, 15, 12));
  const monthName = date.toLocaleDateString("es-PE", { month: "long", timeZone: "UTC" });
  const capitalized = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  return `${capitalized} ${year}`;
}

export interface DebtAgendaGroup {
  key: "overdue" | "today" | "tomorrow" | "upcoming" | "later" | "covered";
  label: string;
  tone: "red" | "orange" | "yellow" | "blue" | "green";
  items: DebtInstallmentPlanningItem[];
}

/**
 * Group monthly debt planning items into UX sections in exact order:
 * 1. Vencidas (overdue)
 * 2. Hoy (today)
 * 3. Mañana (tomorrow)
 * 4. Próximos 7 días (upcoming)
 * 5. Más adelante (later)
 * 6. Cubiertas (covered)
 */
export function groupDebtPlanningItemsForAgenda(
  monthItems: DebtInstallmentPlanningItem[]
): DebtAgendaGroup[] {
  const groups: Record<DebtAgendaGroup["key"], DebtAgendaGroup> = {
    overdue: { key: "overdue", label: "Vencidas", tone: "red", items: [] },
    today: { key: "today", label: "Vencen hoy", tone: "orange", items: [] },
    tomorrow: { key: "tomorrow", label: "Vence mañana", tone: "yellow", items: [] },
    upcoming: { key: "upcoming", label: "Próximos 7 días", tone: "blue", items: [] },
    later: { key: "later", label: "Más adelante", tone: "blue", items: [] },
    covered: { key: "covered", label: "Cubiertas", tone: "green", items: [] },
  };

  for (const item of monthItems) {
    const key = item.dueStatus;
    if (groups[key]) {
      groups[key].items.push(item);
    }
  }

  const order: DebtAgendaGroup["key"][] = ["overdue", "today", "tomorrow", "upcoming", "later", "covered"];
  return order.map((key) => groups[key]).filter((group) => group.items.length > 0);
}
