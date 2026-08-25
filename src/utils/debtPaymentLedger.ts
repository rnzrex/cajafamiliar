import type { Debt, DebtEvent } from "../types";
import { formatReviewDate } from "./debtFormMode";

export interface DebtLedgerItem {
  id: string;
  eventDate: string;
  formattedDate: string;
  eventType: string;
  cashAmount: number;
  principalDelta: number;
  interestPaid: number;
  feesPaid: number;
  insurancePaid: number;
  otherCostPaid: number;
  totalOtherCosts: number;
  principalBalanceAfter: number;
  isReversed: boolean;
  isReversal: boolean;
  breakdownComplete: boolean;
  description: string;
  extraPrincipalAmount?: number;
  prepaymentEffect?: string | null;
}

export interface DebtProgressSummary {
  openingPrincipal: number;
  currentPrincipal: number;
  totalPrincipalAmortized: number;
  pctReduced: number;
  totalCashPaid: number;
  totalInterestPaid: number;
  totalOtherCosts: number;
  eventCount: number;
  hasIncompleteBreakdown: boolean;
}

export interface DebtPaymentLedgerResult {
  items: DebtLedgerItem[];
  summary: DebtProgressSummary;
}

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function getEventTypeLabel(eventType: string): string {
  switch (eventType) {
    case "payment":
      return "Pago de cuota";
    case "principal_prepayment":
    case "prepayment":
      return "Amortización de capital";
    case "installment_advance":
      return "Adelanto de cuotas";
    case "payoff":
      return "Cancelación / Liquidación";
    case "reversal":
      return "Reversión de pago";
    default:
      return "Pago de deuda";
  }
}

export function buildDebtPaymentLedger(debt: Debt, events: DebtEvent[]): DebtPaymentLedgerResult {
  // Derive reversed event IDs using real schema reversalOfEventId
  const reversedIds = new Set<string>();
  for (const e of events) {
    if (e.eventType === "reversal" && e.reversalOfEventId) {
      reversedIds.add(e.reversalOfEventId);
    }
  }

  // Sort events by eventDate ASC, then createdAt ASC, then id ASC
  const sortedEvents = [...events].sort((a, b) => {
    if (a.eventDate !== b.eventDate) return a.eventDate.localeCompare(b.eventDate);
    if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
    return a.id.localeCompare(b.id);
  });

  let runningPrincipal = debt.openingPrincipalBalance;
  let totalCashPaid = 0;
  let totalInterestPaid = 0;
  let totalOtherCosts = 0;
  let hasIncompleteBreakdown = false;

  const items: DebtLedgerItem[] = [];

  for (const event of sortedEvents) {
    const isReversal = event.eventType === "reversal";
    const isReversed = reversedIds.has(event.id);
    const effective = !isReversal && !isReversed;

    if (effective) {
      // Production Debt contract: runningPrincipal += principalDelta (where principalDelta is negative for reduction)
      runningPrincipal = round2(Math.max(0, runningPrincipal + event.principalDelta));
      totalCashPaid = round2(totalCashPaid + event.cashAmount);
      totalInterestPaid = round2(totalInterestPaid + event.interestPaid);
      const otherCosts = round2(event.feesPaid + event.insurancePaid + event.otherCostPaid);
      totalOtherCosts = round2(totalOtherCosts + otherCosts);
      if (!event.breakdownComplete) {
        hasIncompleteBreakdown = true;
      }
    }

    const totalOtherCostsItem = round2(event.feesPaid + event.insurancePaid + event.otherCostPaid);
    const userPrincipalReduction = round2(Math.max(0, -event.principalDelta));

    items.push({
      id: event.id,
      eventDate: event.eventDate,
      formattedDate: formatReviewDate(event.eventDate),
      eventType: getEventTypeLabel(event.eventType),
      cashAmount: event.cashAmount,
      principalDelta: userPrincipalReduction,
      interestPaid: event.interestPaid,
      feesPaid: event.feesPaid,
      insurancePaid: event.insurancePaid,
      otherCostPaid: event.otherCostPaid,
      totalOtherCosts: totalOtherCostsItem,
      principalBalanceAfter: runningPrincipal,
      isReversed,
      isReversal,
      breakdownComplete: event.breakdownComplete,
      description: event.description || "",
      extraPrincipalAmount: event.extraPrincipalAmount ?? 0,
      prepaymentEffect: event.prepaymentEffect ?? null,
    });
  }

  const openingPrincipal = debt.openingPrincipalBalance;
  const currentPrincipal = runningPrincipal;
  const totalPrincipalAmortized = round2(Math.max(0, openingPrincipal - currentPrincipal));
  const pctReduced = openingPrincipal > 0 ? round2((totalPrincipalAmortized / openingPrincipal) * 100) : 0;

  return {
    items,
    summary: {
      openingPrincipal,
      currentPrincipal,
      totalPrincipalAmortized,
      pctReduced,
      totalCashPaid,
      totalInterestPaid,
      totalOtherCosts,
      eventCount: sortedEvents.filter((e) => e.eventType !== "reversal" && !reversedIds.has(e.id)).length,
      hasIncompleteBreakdown,
    },
  };
}
