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

export interface DebtMonthSummary {
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

    if (!item.amountKnown) {
      unknownAmountInstallments++;
    } else {
      knownAmountInstallments++;
      scheduledKnownAmount += item.expectedAmount!;
      coveredKnownAmount += Math.min(item.allocatedAmount, item.expectedAmount!);
      pendingKnownAmount += item.remainingAmount!;
    }

    if (item.dueStatus === "overdue") {
      overdueInstallments++;
      if (item.amountKnown) {
        overdueKnownAmount += item.remainingAmount!;
      }
    }

    if (item.dueStatus === "covered") {
      coveredInstallments++;
    }
  }

  return {
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
