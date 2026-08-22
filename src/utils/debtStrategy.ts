import type { DueDateKind } from "./dueDates.js";
import type { DebtIntelligenceItem } from "./debtIntelligence.js";

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

// A. Snowball Strategy
export interface SnowballCandidate {
  debtId: string;
  debtName: string;
  currencyCode: string;
  currentPrincipal: number;
  rankWithinCurrency: number;
}

export interface SnowballStrategyResult {
  byCurrency: Record<string, SnowballCandidate[]>;
}

// B. Avalanche Strategy
export interface AvalancheCandidate {
  debtId: string;
  debtName: string;
  currencyCode: string;
  rateBasis: "tcea" | "tea";
  ratePercent: number;
  rankWithinBasis: number;
}

export type AvalancheComparisonMode = "tcea_full" | "tea_full" | "partial" | "unavailable";

export interface AvalancheCurrencyStrategy {
  currencyCode: string;
  comparisonMode: AvalancheComparisonMode;
  tceaCandidates: AvalancheCandidate[];
  teaCandidates: AvalancheCandidate[];
  unknownRateDebtIds: string[];
}

export interface AvalancheStrategyResult {
  byCurrency: Record<string, AvalancheCurrencyStrategy>;
}

// C. Urgency Strategy
export interface UrgencyCandidate {
  debtId: string;
  debtName: string;
  currencyCode: string;
  nextInstallmentId: string;
  nextInstallmentDueDate: string;
  nextInstallmentDueStatus: "covered" | DueDateKind;
  nextInstallmentRemainingAmount: number | null;
  nextInstallmentAmountKnown: boolean;
  urgencyRank: number;
}

export interface UrgencyStrategyResult {
  rankedCandidates: UrgencyCandidate[];
  unrankedDebtIds: string[];
}

// D. Cash-Flow Relief 30d Strategy
export type CashFlowRelief30dUnrankedReason = "missing_current_schedule" | "unknown_next30_amounts";

export interface CashFlowRelief30dCandidate {
  debtId: string;
  debtName: string;
  currencyCode: string;
  relief30dKnownAmount: number;
  rankWithinCurrency: number;
}

export interface CashFlowRelief30dUnrankedItem {
  debtId: string;
  debtName: string;
  currencyCode: string;
  knownNext30Amount: number;
  unknownNext30AmountCount: number;
  unrankedReason: CashFlowRelief30dUnrankedReason;
}

export interface CashFlowRelief30dCurrencyStrategy {
  currencyCode: string;
  rankedCandidates: CashFlowRelief30dCandidate[];
  unrankedItems: CashFlowRelief30dUnrankedItem[];
}

export interface CashFlowRelief30dStrategyResult {
  byCurrency: Record<string, CashFlowRelief30dCurrencyStrategy>;
}

// Consolidated Result
export interface DebtStrategyResult {
  snowball: SnowballStrategyResult;
  avalanche: AvalancheStrategyResult;
  urgency: UrgencyStrategyResult;
  cashFlowRelief30d: CashFlowRelief30dStrategyResult;
}

// ---------------------------------------------------------------------------
// Base Helper
// ---------------------------------------------------------------------------

/**
 * Filter items for active, non-archived debts (status === "active" && !isArchived).
 * Excludes paid_off, refinanced, and archived debts.
 */
export function activeDebtStrategyItems(items: DebtIntelligenceItem[]): DebtIntelligenceItem[] {
  return items.filter((item) => item.status === "active" && !item.isArchived);
}

// ---------------------------------------------------------------------------
// Strategy A: Snowball
// ---------------------------------------------------------------------------

/**
 * Snowball strategy orders active debts per currency by currentPrincipal ASC (smallest principal first).
 * Tie-break: currentPrincipal ASC -> debtName ASC -> debtId ASC.
 */
export function buildSnowballStrategy(items: DebtIntelligenceItem[]): SnowballStrategyResult {
  const activeItems = activeDebtStrategyItems(items);
  const byCurrency: Record<string, SnowballCandidate[]> = {};

  for (const item of activeItems) {
    const curr = item.currencyCode || "PEN";
    if (!byCurrency[curr]) byCurrency[curr] = [];
  }

  for (const curr of Object.keys(byCurrency)) {
    const currencyItems = activeItems.filter((i) => (i.currencyCode || "PEN") === curr);

    const sorted = [...currencyItems].sort(
      (a, b) =>
        a.currentPrincipal - b.currentPrincipal ||
        a.debtName.localeCompare(b.debtName) ||
        a.debtId.localeCompare(b.debtId)
    );

    byCurrency[curr] = sorted.map((item, idx) => ({
      debtId: item.debtId,
      debtName: item.debtName,
      currencyCode: curr,
      currentPrincipal: item.currentPrincipal,
      rankWithinCurrency: idx + 1,
    }));
  }

  return { byCurrency };
}

// ---------------------------------------------------------------------------
// Strategy B: Avalanche
// ---------------------------------------------------------------------------

/**
 * Avalanche strategy groups active debts per currency by rate basis (TCEA, TEA, unknown).
 * Within TCEA and TEA cohorts, orders by ratePercent DESC.
 * Tie-break: ratePercent DESC -> debtName ASC -> debtId ASC.
 */
export function buildAvalancheStrategy(items: DebtIntelligenceItem[]): AvalancheStrategyResult {
  const activeItems = activeDebtStrategyItems(items);
  const byCurrency: Record<string, AvalancheCurrencyStrategy> = {};

  for (const item of activeItems) {
    const curr = item.currencyCode || "PEN";
    if (!byCurrency[curr]) {
      byCurrency[curr] = {
        currencyCode: curr,
        comparisonMode: "unavailable",
        tceaCandidates: [],
        teaCandidates: [],
        unknownRateDebtIds: [],
      };
    }
  }

  for (const curr of Object.keys(byCurrency)) {
    const currencyItems = activeItems.filter((i) => (i.currencyCode || "PEN") === curr);

    const tceaItems = currencyItems.filter((i) => i.rateBasis === "tcea" && i.ratePercent != null);
    const teaItems = currencyItems.filter((i) => i.rateBasis === "tea" && i.ratePercent != null);
    const unknownItems = currencyItems.filter((i) => i.rateBasis === "unknown" || i.ratePercent == null);

    const sortedTcea = [...tceaItems].sort(
      (a, b) =>
        (b.ratePercent ?? 0) - (a.ratePercent ?? 0) ||
        a.debtName.localeCompare(b.debtName) ||
        a.debtId.localeCompare(b.debtId)
    );

    const sortedTea = [...teaItems].sort(
      (a, b) =>
        (b.ratePercent ?? 0) - (a.ratePercent ?? 0) ||
        a.debtName.localeCompare(b.debtName) ||
        a.debtId.localeCompare(b.debtId)
    );

    const tceaCandidates: AvalancheCandidate[] = sortedTcea.map((item, idx) => ({
      debtId: item.debtId,
      debtName: item.debtName,
      currencyCode: curr,
      rateBasis: "tcea",
      ratePercent: item.ratePercent!,
      rankWithinBasis: idx + 1,
    }));

    const teaCandidates: AvalancheCandidate[] = sortedTea.map((item, idx) => ({
      debtId: item.debtId,
      debtName: item.debtName,
      currencyCode: curr,
      rateBasis: "tea",
      ratePercent: item.ratePercent!,
      rankWithinBasis: idx + 1,
    }));

    const unknownRateDebtIds = unknownItems
      .map((i) => i.debtId)
      .sort((a, b) => a.localeCompare(b));

    // Determine comparisonMode
    let comparisonMode: AvalancheComparisonMode = "unavailable";
    const totalCount = currencyItems.length;

    if (totalCount > 0) {
      if (tceaItems.length === totalCount) {
        comparisonMode = "tcea_full";
      } else if (tceaItems.length === 0 && teaItems.length === totalCount) {
        comparisonMode = "tea_full";
      } else if (tceaItems.length === 0 && teaItems.length === 0) {
        comparisonMode = "unavailable";
      } else {
        comparisonMode = "partial";
      }
    }

    byCurrency[curr] = {
      currencyCode: curr,
      comparisonMode,
      tceaCandidates,
      teaCandidates,
      unknownRateDebtIds,
    };
  }

  return { byCurrency };
}

// ---------------------------------------------------------------------------
// Strategy C: Urgency
// ---------------------------------------------------------------------------

/**
 * Urgency strategy ranks active debts globally by nextInstallmentDueDate ASC (earliest due date / oldest overdue first).
 * Tie-break: nextInstallmentDueDate ASC -> debtName ASC -> debtId ASC.
 */
export function buildUrgencyStrategy(items: DebtIntelligenceItem[]): UrgencyStrategyResult {
  const activeItems = activeDebtStrategyItems(items);

  const rankableItems = activeItems.filter(
    (i) => i.nextInstallmentId != null && i.nextInstallmentDueDate != null && i.nextInstallmentDueStatus != null
  );

  const unrankedItems = activeItems.filter(
    (i) => i.nextInstallmentId == null || i.nextInstallmentDueDate == null
  );

  const sortedRankable = [...rankableItems].sort(
    (a, b) =>
      a.nextInstallmentDueDate!.localeCompare(b.nextInstallmentDueDate!) ||
      a.debtName.localeCompare(b.debtName) ||
      a.debtId.localeCompare(b.debtId)
  );

  const rankedCandidates: UrgencyCandidate[] = sortedRankable.map((item, idx) => ({
    debtId: item.debtId,
    debtName: item.debtName,
    currencyCode: item.currencyCode || "PEN",
    nextInstallmentId: item.nextInstallmentId!,
    nextInstallmentDueDate: item.nextInstallmentDueDate!,
    nextInstallmentDueStatus: item.nextInstallmentDueStatus!,
    nextInstallmentRemainingAmount: item.nextInstallmentRemainingAmount,
    nextInstallmentAmountKnown: item.nextInstallmentAmountKnown,
    urgencyRank: idx + 1,
  }));

  const unrankedDebtIds = unrankedItems
    .map((i) => i.debtId)
    .sort((a, b) => a.localeCompare(b));

  return {
    rankedCandidates,
    unrankedDebtIds,
  };
}

// ---------------------------------------------------------------------------
// Strategy D: Cash-Flow Relief 30d
// ---------------------------------------------------------------------------

/**
 * Cash-Flow Relief 30d ranks comparable active debts per currency by next30KnownAmount DESC.
 * Comparable: hasCurrentSchedule === true AND next30UnknownAmountCount === 0.
 * Tie-break: next30KnownAmount DESC -> debtName ASC -> debtId ASC.
 */
export function buildCashFlowRelief30dStrategy(
  items: DebtIntelligenceItem[]
): CashFlowRelief30dStrategyResult {
  const activeItems = activeDebtStrategyItems(items);
  const byCurrency: Record<string, CashFlowRelief30dCurrencyStrategy> = {};

  for (const item of activeItems) {
    const curr = item.currencyCode || "PEN";
    if (!byCurrency[curr]) {
      byCurrency[curr] = {
        currencyCode: curr,
        rankedCandidates: [],
        unrankedItems: [],
      };
    }
  }

  for (const curr of Object.keys(byCurrency)) {
    const currencyItems = activeItems.filter((i) => (i.currencyCode || "PEN") === curr);

    const comparable: DebtIntelligenceItem[] = [];
    const unrankedItems: CashFlowRelief30dUnrankedItem[] = [];

    for (const item of currencyItems) {
      if (!item.readiness.hasCurrentSchedule) {
        unrankedItems.push({
          debtId: item.debtId,
          debtName: item.debtName,
          currencyCode: curr,
          knownNext30Amount: item.next30KnownAmount,
          unknownNext30AmountCount: item.next30UnknownAmountCount,
          unrankedReason: "missing_current_schedule",
        });
      } else if (item.next30UnknownAmountCount > 0) {
        unrankedItems.push({
          debtId: item.debtId,
          debtName: item.debtName,
          currencyCode: curr,
          knownNext30Amount: item.next30KnownAmount,
          unknownNext30AmountCount: item.next30UnknownAmountCount,
          unrankedReason: "unknown_next30_amounts",
        });
      } else {
        comparable.push(item);
      }
    }

    const sortedComparable = [...comparable].sort(
      (a, b) =>
        b.next30KnownAmount - a.next30KnownAmount ||
        a.debtName.localeCompare(b.debtName) ||
        a.debtId.localeCompare(b.debtId)
    );

    const rankedCandidates: CashFlowRelief30dCandidate[] = sortedComparable.map((item, idx) => ({
      debtId: item.debtId,
      debtName: item.debtName,
      currencyCode: curr,
      relief30dKnownAmount: item.next30KnownAmount,
      rankWithinCurrency: idx + 1,
    }));

    unrankedItems.sort((a, b) => a.debtName.localeCompare(b.debtName) || a.debtId.localeCompare(b.debtId));

    byCurrency[curr] = {
      currencyCode: curr,
      rankedCandidates,
      unrankedItems,
    };
  }

  return { byCurrency };
}

// ---------------------------------------------------------------------------
// Consolidated Builder
// ---------------------------------------------------------------------------

export function buildDebtStrategies(items: DebtIntelligenceItem[]): DebtStrategyResult {
  return {
    snowball: buildSnowballStrategy(items),
    avalanche: buildAvalancheStrategy(items),
    urgency: buildUrgencyStrategy(items),
    cashFlowRelief30d: buildCashFlowRelief30dStrategy(items),
  };
}
