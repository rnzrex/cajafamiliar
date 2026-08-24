import type { Debt, DebtEvent, RecurringPayment } from "../types.js";
import { isPaymentFinished, isPaymentPaidThisMonth, monthlyDueDate } from "./calculations.js";
import { formatLocalDate, localDateString } from "./date.js";
import { currentDebtPrincipal } from "./debtCalculations.js";
import { calculateNextPayment } from "./debtNextPayment.js";
import type { DebtInstallmentPlanningItem } from "./debtPlanning.js";
import { formatMonthKeyLabel, getNextMonthKey } from "./debtPlanning.js";
import { dueDateStatus } from "./dueDates.js";

export type ObligationProjectionSource = "recurring" | "debt";
export type ProjectionAmountKind = "known" | "estimated" | "unknown";

export interface ObligationProjectionItem {
  id: string;
  source: ObligationProjectionSource;
  sourceId: string;

  recurringPaymentId: string | null;
  debtId: string | null;
  installmentId: string | null;

  label: string;
  detail: string;

  dueDate: string | null;
  monthKey: string | null;

  currencyCode: string;
  amount: number | null;
  amountKind: ProjectionAmountKind;

  dueStatus: "overdue" | "today" | "tomorrow" | "upcoming" | "later" | "covered";
  isOverduePrior: boolean;
}

export interface ProjectionCurrencySummary {
  currencyCode: string;
  knownAmount: number;
  estimatedAmount: number;
  unknownAmountCount: number;
  obligationCount: number;
  recurringCount: number;
  debtCount: number;
}

export interface ObligationMonthSummary {
  monthKey: string;
  label: string;
  totalObligations: number;
  recurringCount: number;
  debtCount: number;
  byCurrency: Record<string, ProjectionCurrencySummary>;
}

export interface ObligationProjectionResult {
  items: ObligationProjectionItem[];
  horizonMonths: string[];
  monthSummaries: Record<string, ObligationMonthSummary>;
  overduePriorItems: ObligationProjectionItem[];
  overduePriorSummary: Record<string, ProjectionCurrencySummary> | null;
  unscheduledRecurringCount: number;
  activeDebtsWithoutPlanningCount: number;
}

export interface BuildObligationProjectionInput {
  recurringPayments: RecurringPayment[];
  debts: Debt[];
  debtPlanningItems: DebtInstallmentPlanningItem[];
  debtEvents?: DebtEvent[];
  todayKey?: string;
}

function parseReferenceDate(todayKey: string): Date {
  const [y, m, d] = todayKey.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12));
}

/**
 * Consolidates upcoming planned cash outflows for Recurring Payments and Debt Installments
 * across a 3-month horizon (Current Month, Month + 1, Month + 2) plus Prior Overdue items.
 */
export function buildObligationProjection({
  recurringPayments,
  debts,
  debtPlanningItems,
  debtEvents = [],
  todayKey = localDateString(),
}: BuildObligationProjectionInput): ObligationProjectionResult {
  const currentMonth = todayKey.slice(0, 7);
  const month1 = getNextMonthKey(currentMonth);
  const month2 = getNextMonthKey(month1);
  const horizonMonths = [currentMonth, month1, month2];
  const referenceDate = parseReferenceDate(todayKey);

  const items: ObligationProjectionItem[] = [];
  const overduePriorItems: ObligationProjectionItem[] = [];
  let unscheduledRecurringCount = 0;

  // 1. Process Active Recurring Payments
  const activeRecurring = recurringPayments.filter((p) => p.is_active);

  for (const payment of activeRecurring) {
    const linkedDebtId = payment.linked_debt_id ?? payment.linkedDebtId ?? null;
    const linkedDebt = linkedDebtId ? debts.find((d) => d.id === linkedDebtId) ?? null : null;

    if (linkedDebt) {
      // Fixed-schedule debts are already covered by debtPlanningItems -> skip linked recurring duplicate
      if (linkedDebt.repaymentStructure === "fixed_schedule") {
        continue;
      }

      // Compute canonical current principal for linked debt
      const debtEventsForLinked = debtEvents.filter((e) => e.debtId === linkedDebt.id);
      const currentPrincipal = currentDebtPrincipal(linkedDebt, debtEventsForLinked);

      const nextPayRes = calculateNextPayment({
        debt: linkedDebt,
        debtEvents: debtEventsForLinked,
        currentPrincipal,
        todayKey,
      });

      if (nextPayRes.nextDueDate) {
        const mKey = nextPayRes.nextDueDate.slice(0, 7);
        const status = dueDateStatus(nextPayRes.nextDueDate, todayKey).kind;
        const amountKind: ProjectionAmountKind = nextPayRes.minimumPaymentKnown
          ? nextPayRes.certainty === "exact_contract" || nextPayRes.certainty === "exact_rate"
            ? "known"
            : "estimated"
          : "unknown";

        const item: ObligationProjectionItem = {
          id: `rec:${payment.id}:${nextPayRes.nextDueDate}`,
          source: "recurring",
          sourceId: payment.id,
          recurringPaymentId: payment.id,
          debtId: linkedDebt.id,
          installmentId: null,
          label: payment.name,
          detail: "Deuda vinculada",
          dueDate: nextPayRes.nextDueDate,
          monthKey: mKey,
          currencyCode: linkedDebt.currencyCode || "PEN",
          amount: nextPayRes.minimumPaymentAmount,
          amountKind,
          dueStatus: status,
          isOverduePrior: mKey < currentMonth,
        };

        if (mKey < currentMonth) {
          overduePriorItems.push(item);
        } else if (horizonMonths.includes(mKey)) {
          items.push(item);
        }
      }
      continue;
    }

    const isVariable = payment.amount_mode === "variable";
    const amountKind: ProjectionAmountKind =
      payment.amount == null ? "unknown" : isVariable ? "estimated" : "known";
    const currencyCode = payment.currency_code ?? payment.currencyCode ?? "PEN";
    const startsOn = payment.starts_on ?? payment.startsOn ?? null;

    if (payment.recurrence_type === "one_time") {
      if (payment.status === "pagado") continue;

      if (!payment.dueDate) {
        unscheduledRecurringCount++;
      } else {
        const mKey = payment.dueDate.slice(0, 7);
        const status = dueDateStatus(payment.dueDate, todayKey).kind;

        const item: ObligationProjectionItem = {
          id: `rec:${payment.id}:${payment.dueDate}`,
          source: "recurring",
          sourceId: payment.id,
          recurringPaymentId: payment.id,
          debtId: null,
          installmentId: null,
          label: payment.name,
          detail: `Pago único · ${payment.category}`,
          dueDate: payment.dueDate,
          monthKey: mKey,
          currencyCode,
          amount: payment.amount,
          amountKind,
          dueStatus: status,
          isOverduePrior: mKey < currentMonth,
        };

        if (mKey < currentMonth) {
          overduePriorItems.push(item);
        } else if (horizonMonths.includes(mKey)) {
          items.push(item);
        }
      }
    } else if (payment.recurrence_type === "indefinite") {
      if (payment.dueDay == null) {
        unscheduledRecurringCount++;
      } else {
        const paidThisMonth = isPaymentPaidThisMonth(payment, referenceDate);
        const targetMonths = paidThisMonth ? [month1, month2] : [currentMonth, month1, month2];

        for (const mKey of targetMonths) {
          if (startsOn && `${mKey}-31` < startsOn) continue;

          let dueDate = monthlyDueDate(payment.dueDay, `${mKey}-01`);
          if (startsOn && dueDate && dueDate < startsOn) {
            dueDate = startsOn;
          }
          const status = dueDate ? dueDateStatus(dueDate, todayKey).kind : "upcoming";

          items.push({
            id: `rec:${payment.id}:${mKey}`,
            source: "recurring",
            sourceId: payment.id,
            recurringPaymentId: payment.id,
            debtId: null,
            installmentId: null,
            label: payment.name,
            detail: `Pago recurrente · ${payment.category}`,
            dueDate,
            monthKey: mKey,
            currencyCode,
            amount: payment.amount,
            amountKind,
            dueStatus: status,
            isOverduePrior: false,
          });
        }
      }
    } else if (payment.recurrence_type === "fixed") {
      const remainingInst = Math.max(
        0,
        (payment.total_installments ?? 0) - (payment.paid_installments ?? 0)
      );
      if (remainingInst === 0 || isPaymentFinished(payment)) continue;

      if (payment.dueDay == null) {
        unscheduledRecurringCount++;
      } else {
        const paidThisMonth = isPaymentPaidThisMonth(payment, referenceDate);
        const candidateMonths = paidThisMonth ? [month1, month2] : [currentMonth, month1, month2];
        const selectedMonths = candidateMonths.slice(0, remainingInst);

        const initialPaid = payment.paid_installments ?? 0;
        const totalInst = payment.total_installments ?? 0;

        selectedMonths.forEach((mKey, idx) => {
          const dueDate = monthlyDueDate(payment.dueDay, `${mKey}-01`);
          const status = dueDate ? dueDateStatus(dueDate, todayKey).kind : "upcoming";
          const projectedInstallmentNumber = initialPaid + idx + 1;

          items.push({
            id: `rec:${payment.id}:${mKey}`,
            source: "recurring",
            sourceId: payment.id,
            recurringPaymentId: payment.id,
            debtId: null,
            installmentId: null,
            label: payment.name,
            detail:
              totalInst > 0
                ? `Cuota ${projectedInstallmentNumber} de ${totalInst}`
                : `Cuota ${projectedInstallmentNumber}`,
            dueDate,
            monthKey: mKey,
            currencyCode,
            amount: payment.amount,
            amountKind,
            dueStatus: status,
            isOverduePrior: false,
          });
        });
      }
    }
  }

  // 2. Process Debt Planning Items (Excluding Covered)
  const nonCoveredDebts = debtPlanningItems.filter((i) => !i.isCovered);

  for (const debtItem of nonCoveredDebts) {
    const mKey = debtItem.dueDate.slice(0, 7);

    const item: ObligationProjectionItem = {
      id: `debt:${debtItem.installmentId}`,
      source: "debt",
      sourceId: debtItem.debtId,
      recurringPaymentId: null,
      debtId: debtItem.debtId,
      installmentId: debtItem.installmentId,
      label: debtItem.debtName,
      detail: debtItem.creditorName
        ? `Cuota #${debtItem.installmentNumber} · ${debtItem.creditorName}`
        : `Cuota #${debtItem.installmentNumber}`,
      dueDate: debtItem.dueDate,
      monthKey: mKey,
      currencyCode: debtItem.currencyCode || "PEN",
      amount: debtItem.amountKnown ? debtItem.remainingAmount : null,
      amountKind: debtItem.amountKnown ? "known" : "unknown",
      dueStatus: debtItem.dueStatus,
      isOverduePrior: mKey < currentMonth,
    };

    if (mKey < currentMonth) {
      overduePriorItems.push(item);
    } else if (horizonMonths.includes(mKey)) {
      items.push(item);
    }
  }

  // 3. Process Active Debts Without Planning
  const activeDebts = debts.filter((d) => !d.isArchived && d.status === "active");
  const debtsWithPlanning = new Set(debtPlanningItems.map((i) => i.debtId));
  const activeDebtsWithoutPlanningCount = activeDebts.filter((d) => !debtsWithPlanning.has(d.id)).length;

  // 4. Summarize Month Horizon
  const monthSummaries: Record<string, ObligationMonthSummary> = {};

  for (const mKey of horizonMonths) {
    const monthItems = items.filter((i) => i.monthKey === mKey);
    monthSummaries[mKey] = summarizeObligationProjectionMonth(monthItems, mKey);
  }

  // 5. Summarize Overdue Prior
  let overduePriorSummary: Record<string, ProjectionCurrencySummary> | null = null;
  if (overduePriorItems.length > 0) {
    overduePriorSummary = summarizeCurrencyBreakdown(overduePriorItems);
  }

  return {
    items,
    horizonMonths,
    monthSummaries,
    overduePriorItems,
    overduePriorSummary,
    unscheduledRecurringCount,
    activeDebtsWithoutPlanningCount,
  };
}

/**
 * Summarizes projection items for a specific monthKey ("YYYY-MM").
 */
export function summarizeObligationProjectionMonth(
  items: ObligationProjectionItem[],
  monthKey: string
): ObligationMonthSummary {
  const monthItems = items.filter((i) => i.monthKey === monthKey);
  const byCurrency = summarizeCurrencyBreakdown(monthItems);

  let recurringCount = 0;
  let debtCount = 0;

  for (const item of monthItems) {
    if (item.source === "recurring") recurringCount++;
    if (item.source === "debt") debtCount++;
  }

  return {
    monthKey,
    label: formatMonthKeyLabel(monthKey),
    totalObligations: monthItems.length,
    recurringCount,
    debtCount,
    byCurrency,
  };
}

/**
 * Helper to build per-currency breakdown for projection items.
 */
function summarizeCurrencyBreakdown(
  items: ObligationProjectionItem[]
): Record<string, ProjectionCurrencySummary> {
  const byCurrency: Record<string, ProjectionCurrencySummary> = {};

  for (const item of items) {
    const curr = item.currencyCode || "PEN";

    if (!byCurrency[curr]) {
      byCurrency[curr] = {
        currencyCode: curr,
        knownAmount: 0,
        estimatedAmount: 0,
        unknownAmountCount: 0,
        obligationCount: 0,
        recurringCount: 0,
        debtCount: 0,
      };
    }

    const entry = byCurrency[curr];
    entry.obligationCount++;

    if (item.source === "recurring") entry.recurringCount++;
    if (item.source === "debt") entry.debtCount++;

    if (item.amountKind === "known" && item.amount != null) {
      entry.knownAmount += item.amount;
    } else if (item.amountKind === "estimated" && item.amount != null) {
      entry.estimatedAmount += item.amount;
    } else if (item.amountKind === "unknown") {
      entry.unknownAmountCount++;
    }
  }

  return byCurrency;
}
