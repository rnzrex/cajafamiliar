import type { Debt, DebtEvent, DebtInterestCalculationMode } from "../types";
import {
  calculateAssistedInterestSuggestion,
  getLastEffectiveDebtPaymentDate,
  type InterestSuggestionCertainty,
} from "./debtInterestEngine";

export interface DebtNextPaymentResult {
  nextDueDate: string | null;
  currentPrincipal: number;
  interestAmount: number | null;
  interestKnown: boolean;
  interestSource: DebtInterestCalculationMode | "unknown";
  interestExplanation: string;
  minimumPrincipalAmount: number | null;
  minimumPrincipalKnown: boolean;
  minimumPaymentAmount: number | null;
  minimumPaymentKnown: boolean;
  principalAfterPayment: number | null;
  currencyCode: string;
  certainty: InterestSuggestionCertainty | "estimate";
}

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Returns max valid days in a given calendar month (1-12) and year.
 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Derives the next monthly due date for open-ended debt using contractual day and last payment date.
 * Correctly handles days 28–31 in shorter months without timezone shift.
 */
export function getDerivedNextDueDate(
  firstDueDateStr: string | null,
  debtEvents: DebtEvent[],
  debtId: string
): string | null {
  if (!firstDueDateStr || firstDueDateStr.trim() === "") return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(firstDueDateStr.trim());
  if (!match) return firstDueDateStr;

  const firstYear = parseInt(match[1], 10);
  const firstMonth = parseInt(match[2], 10);
  const dueDay = parseInt(match[3], 10);

  const debtScopedEvents = debtEvents.filter((e) => e.debtId === debtId);
  const reversedIds = new Set(
    debtScopedEvents
      .filter((e) => e.eventType === "reversal" && e.reversalOfEventId)
      .map((e) => e.reversalOfEventId!)
  );

  const effectivePayments = debtScopedEvents.filter(
    (e) =>
      !reversedIds.has(e.id) &&
      e.eventType !== "reversal" &&
      (e.eventType === "payment" || e.eventType === "payoff")
  );

  if (effectivePayments.length === 0) {
    return firstDueDateStr;
  }

  effectivePayments.sort((a, b) => {
    if (a.eventDate !== b.eventDate) return a.eventDate.localeCompare(b.eventDate);
    if ((a.createdAt || "") !== (b.createdAt || "")) {
      return (a.createdAt || "").localeCompare(b.createdAt || "");
    }
    return (a.id || "").localeCompare(b.id || "");
  });

  const lastPayment = effectivePayments[effectivePayments.length - 1];
  const lastDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(lastPayment.eventDate);
  if (!lastDateMatch) return firstDueDateStr;

  const lastYear = parseInt(lastDateMatch[1], 10);
  const lastMonth = parseInt(lastDateMatch[2], 10);

  // If last payment was before first due month/year, next due date remains first due date
  if (lastYear < firstYear || (lastYear === firstYear && lastMonth < firstMonth)) {
    return firstDueDateStr;
  }

  // Next due month is one month after last payment month
  let nextMonth = lastMonth + 1;
  let nextYear = lastYear;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }

  const daysInNextMonth = getDaysInMonth(nextYear, nextMonth);
  const actualDay = Math.min(dueDay, daysInNextMonth);

  const mm = String(nextMonth).padStart(2, "0");
  const dd = String(actualDay).padStart(2, "0");
  return `${nextYear}-${mm}-${dd}`;
}

/**
 * Pure helper for single source of truth Next Payment calculation.
 */
export function calculateNextPayment(params: {
  debt: Debt;
  debtEvents: DebtEvent[];
  currentPrincipal: number;
  todayKey?: string;
}): DebtNextPaymentResult {
  const { debt, debtEvents, currentPrincipal } = params;
  const currencyCode = debt.currencyCode || "PEN";
  const principal = Math.max(0, round2(currentPrincipal));

  const nextDueDate = getDerivedNextDueDate(debt.firstDueDate, debtEvents, debt.id);
  const targetDate = nextDueDate || params.todayKey || debt.trackingStartDate || debt.originDate || "";

  const lastEventDate = getLastEffectiveDebtPaymentDate(debtEvents, debt.id);

  const suggestion = calculateAssistedInterestSuggestion({
    debt,
    currentPrincipal: principal,
    paymentDate: targetDate,
    cashAmount: 0,
    lastEventDate,
  });

  let interestKnown = suggestion.certainty !== "insufficient_info";
  let interestAmount: number | null = interestKnown ? suggestion.calcInterest : null;
  let interestSource = suggestion.calculationSource;
  let interestExplanation = suggestion.calculationExplanation;
  let certainty: InterestSuggestionCertainty | "estimate" = suggestion.certainty;

  const isFullMonthPawnPledgeEstimate =
    debt.repaymentStructure === "open_ended" &&
    debt.interestCalculationMode === "contract_periodic_rate" &&
    debt.periodicRatePercent != null &&
    debt.periodicRatePercent > 0 &&
    (debt.periodicRateBasis || "monthly") === "monthly" &&
    (debt.paymentFrequency || "monthly") === "monthly" &&
    Boolean(debt.firstDueDate);

  if (!interestKnown && isFullMonthPawnPledgeEstimate) {
    interestKnown = true;
    interestAmount = round2(principal * (debt.periodicRatePercent! / 100));
    interestSource = "contract_periodic_rate";
    certainty = "estimate";
    interestExplanation = `Estimación mensual con tasa contractual de ${debt.periodicRatePercent}% mensual.`;
  }

  const rawMinPrincipal = debt.minimumPrincipalPayment;
  const minimumPrincipalKnown = rawMinPrincipal != null && rawMinPrincipal > 0;
  const minimumPrincipalAmount = minimumPrincipalKnown ? round2(Math.min(rawMinPrincipal!, principal)) : null;
  const effectiveMinPrincipal = minimumPrincipalKnown ? minimumPrincipalAmount! : 0;

  let minimumPaymentKnown = false;
  let minimumPaymentAmount: number | null = null;
  let principalAfterPayment: number | null = null;

  if (interestKnown) {
    minimumPaymentKnown = true;
    minimumPaymentAmount = round2((interestAmount ?? 0) + effectiveMinPrincipal);
    principalAfterPayment = round2(Math.max(0, principal - effectiveMinPrincipal));
  } else {
    minimumPaymentKnown = false;
    minimumPaymentAmount = null;
    principalAfterPayment = minimumPrincipalKnown ? round2(Math.max(0, principal - effectiveMinPrincipal)) : null;
  }

  return {
    nextDueDate,
    currentPrincipal: principal,
    interestAmount,
    interestKnown,
    interestSource,
    interestExplanation,
    minimumPrincipalAmount,
    minimumPrincipalKnown,
    minimumPaymentAmount,
    minimumPaymentKnown,
    principalAfterPayment,
    currencyCode,
    certainty,
  };
}
