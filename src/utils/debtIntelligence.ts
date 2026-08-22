import type {
  CreditCardEntry,
  CreditCardProfile,
  CreditCardStatement,
  Debt,
  DebtCollateral,
  DebtEvent,
  DebtInstallment,
  DebtKind,
  DebtScheduleVersion,
  DebtStatus,
} from "../types.js";
import {
  currentDebtPrincipal,
  currentDebtScheduleVersion,
  effectiveDebtEvents,
  effectiveDebtFundEvents,
} from "./debtCalculations.js";
import {
  classifyCreditCardStatementAttention,
  currentCreditCardBalance,
  latestCreditCardStatement,
} from "./creditCardCalculations.js";
import type { DebtInstallmentPlanningItem } from "./debtPlanning.js";
import { dueDateStatus } from "./dueDates.js";
import type { DueDateKind } from "./dueDates.js";
import { localDateString } from "./date.js";

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

export interface DebtHistoricalEconomics {
  cashOutflow: number;
  principalReduction: number;
  economicExpense: number;

  interestPaid: number;
  feesPaid: number;
  insurancePaid: number;
  otherCostPaid: number;

  knownDetailedCosts: number;
  unclassifiedDebtCost: number;

  fundEventCount: number;
  paymentCount: number;
  prepaymentCount: number;
  payoffCount: number;

  inconsistentEventCount: number;
}

export type DebtRateBasis = "tcea" | "tea" | "unknown";

export type DebtDataLimitation =
  | "missing_original_principal"
  | "missing_current_schedule"
  | "unknown_installment_amounts"
  | "missing_rate"
  | "missing_last_due_date";

export interface DebtDataReadiness {
  hasOriginalPrincipal: boolean;
  hasCurrentSchedule: boolean;
  hasKnownCurrentScheduleAmounts: boolean;
  hasRecordedLastDueDate: boolean;
  hasRate: boolean;
  hasTcea: boolean;
  hasTea: boolean;

  planningReady: boolean;
  rateStrategyReady: boolean;
  originalProgressReady: boolean;
  payoffVisibilityReady: boolean;

  limitations: DebtDataLimitation[];
}

export interface DebtIntelligenceItem {
  debtId: string;
  debtName: string;
  creditorName: string;
  debtKind: DebtKind;
  currencyCode: string;
  status: DebtStatus;
  isArchived: boolean;

  currentPrincipal: number;
  originalPrincipal: number | null;
  openingPrincipalBalance: number;

  recordedFundPrincipalReduction: number;
  nonFundPrincipalDelta: number;

  balanceReductionFromOriginal: number | null;
  balanceReductionPercentFromOriginal: number | null;

  historicalEconomics: DebtHistoricalEconomics;

  rateBasis: DebtRateBasis;
  ratePercent: number | null;

  hasCurrentSchedule: boolean;
  currentScheduleId: string | null;
  currentScheduleInstallmentCount: number;
  currentScheduleLastDueDate: string | null;

  remainingInstallmentCount: number;
  knownRemainingInstallmentCount: number;
  unknownRemainingInstallmentCount: number;
  overdueInstallmentCount: number;

  nextInstallmentId: string | null;
  nextInstallmentNumber: number | null;
  nextInstallmentDueDate: string | null;
  nextInstallmentDueStatus: "covered" | DueDateKind | null;
  nextInstallmentRemainingAmount: number | null;
  nextInstallmentAmountKnown: boolean;

  next30KnownAmount: number;
  next30UnknownAmountCount: number;
  next30InstallmentCount: number;

  prepaymentPrincipalReduction: number;
  prepaymentCashOutflow: number;

  hasActiveCollateral: boolean;
  activeCollateralCount: number;
  nearestRedemptionDeadline: string | null;
  nearestRedemptionStatus: DueDateKind | null;

  readiness: DebtDataReadiness;
}

export interface DebtPortfolioCurrencyIntelligence {
  currencyCode: string;
  activeDebtCount: number;
  totalCurrentPrincipal: number;

  largestDebtId: string | null;
  largestDebtPrincipal: number | null;

  smallestDebtId: string | null;
  smallestDebtPrincipal: number | null;

  overdueInstallmentCount: number;

  next30KnownAmount: number;
  next30UnknownAmountCount: number;
  next30InstallmentCount: number;

  debtsWithoutRateCount: number;
  debtsWithoutCurrentScheduleCount: number;
  debtsWithUnknownInstallmentsCount: number;
  debtsWithActiveCollateralCount: number;

  historicalKnownDetailedCosts: number;
  historicalUnclassifiedDebtCost: number;

  prepaymentPrincipalReduction: number;
  prepaymentCashOutflow: number;
}

export interface DebtPortfolioIntelligence {
  totalActiveDebts: number;

  unratedDebtCount: number;
  debtsWithoutCurrentScheduleCount: number;
  debtsWithUnknownInstallmentsCount: number;
  debtsWithActiveCollateralCount: number;

  byCurrency: Record<string, DebtPortfolioCurrencyIntelligence>;
}

export interface BuildDebtIntelligenceInput {
  debts: Debt[];
  debtEvents: DebtEvent[];
  debtScheduleVersions: DebtScheduleVersion[];
  debtInstallments: DebtInstallment[];
  debtCollaterals: DebtCollateral[];
  debtPlanningItems: DebtInstallmentPlanningItem[];
  creditCardProfiles?: CreditCardProfile[];
  creditCardEntries?: CreditCardEntry[];
  creditCardStatements?: CreditCardStatement[];
  todayKey?: string;
}

// ---------------------------------------------------------------------------
// Item Builder
// ---------------------------------------------------------------------------

/**
 * Builds intelligence items for ALL debts passed, regardless of status or archived flag.
 */
export function buildDebtIntelligenceItems({
  debts,
  debtEvents,
  debtScheduleVersions,
  debtInstallments,
  debtCollaterals,
  debtPlanningItems,
  creditCardProfiles = [],
  creditCardEntries = [],
  creditCardStatements = [],
  todayKey = localDateString(),
}: BuildDebtIntelligenceInput): DebtIntelligenceItem[] {
  return debts.map((debt) => {
    // 1. Current Principal
    const currentPrincipal =
      debt.debtKind === "credit_card" && creditCardEntries.length > 0
        ? currentCreditCardBalance(debt, creditCardEntries)
        : currentDebtPrincipal(debt, debtEvents);

    // 2. Fund events vs Non-fund events
    const fundEvents = effectiveDebtFundEvents(debtEvents, debt.id);
    const effectiveEvents = effectiveDebtEvents(debtEvents, debt.id);
    const nonFundEvents = effectiveEvents.filter(
      (e) => e.eventType === "principal_adjustment" || e.eventType === "refinance"
    );

    const recordedFundPrincipalReduction = fundEvents.reduce((sum, e) => sum + -e.principalDelta, 0);
    const nonFundPrincipalDelta = nonFundEvents.reduce((sum, e) => sum + e.principalDelta, 0);

    // 3. Historical Economics
    let cashOutflow = 0;
    let principalReduction = 0;
    let economicExpense = 0;
    let interestPaid = 0;
    let feesPaid = 0;
    let insurancePaid = 0;
    let otherCostPaid = 0;
    let knownDetailedCosts = 0;
    let unclassifiedDebtCost = 0;
    let paymentCount = 0;
    let prepaymentCount = 0;
    let payoffCount = 0;
    let inconsistentEventCount = 0;

    let prepaymentPrincipalReduction = 0;
    let prepaymentCashOutflow = 0;

    for (const e of fundEvents) {
      cashOutflow += e.cashAmount;
      const eventPrincipalRed = -e.principalDelta;
      principalReduction += eventPrincipalRed;

      const eventEconomicExpense = e.cashAmount + e.principalDelta;
      economicExpense += eventEconomicExpense;

      interestPaid += e.interestPaid;
      feesPaid += e.feesPaid;
      insurancePaid += e.insurancePaid;
      otherCostPaid += e.otherCostPaid;

      const eventKnownCosts = e.interestPaid + e.feesPaid + e.insurancePaid + e.otherCostPaid;
      knownDetailedCosts += eventKnownCosts;

      const eventUnclassified = eventEconomicExpense - eventKnownCosts;
      unclassifiedDebtCost += eventUnclassified;

      if (eventUnclassified < -0.01) {
        inconsistentEventCount++;
      }

      if (e.eventType === "payment") paymentCount++;
      if (e.eventType === "payoff") payoffCount++;
      if (e.eventType === "principal_prepayment") {
        prepaymentCount++;
        prepaymentPrincipalReduction += eventPrincipalRed;
        prepaymentCashOutflow += e.cashAmount;
      }
    }

    const historicalEconomics: DebtHistoricalEconomics = {
      cashOutflow,
      principalReduction,
      economicExpense,
      interestPaid,
      feesPaid,
      insurancePaid,
      otherCostPaid,
      knownDetailedCosts,
      unclassifiedDebtCost,
      fundEventCount: fundEvents.length,
      paymentCount,
      prepaymentCount,
      payoffCount,
      inconsistentEventCount,
    };

    // 4. Original Principal Progress
    let balanceReductionFromOriginal: number | null = null;
    let balanceReductionPercentFromOriginal: number | null = null;

    if (debt.originalPrincipal != null && debt.originalPrincipal > 0) {
      balanceReductionFromOriginal = debt.originalPrincipal - currentPrincipal;
      balanceReductionPercentFromOriginal = (balanceReductionFromOriginal / debt.originalPrincipal) * 100;
    }

    // 5. Rate Information
    let rateBasis: DebtRateBasis = "unknown";
    let ratePercent: number | null = null;

    if (debt.tceaPercent != null) {
      rateBasis = "tcea";
      ratePercent = debt.tceaPercent;
    } else if (debt.teaPercent != null) {
      rateBasis = "tea";
      ratePercent = debt.teaPercent;
    }

    // 6. Current Schedule Intelligence
    const isCard = debt.debtKind === "credit_card";
    const latestCardStatement = isCard ? latestCreditCardStatement(creditCardStatements, debt.id) : null;

    const currentSchedule = currentDebtScheduleVersion(debt.id, debtScheduleVersions);
    const hasCurrentSchedule = isCard ? Boolean(latestCardStatement) : Boolean(currentSchedule);
    const currentScheduleId = isCard ? (latestCardStatement ? latestCardStatement.id : null) : (currentSchedule ? currentSchedule.id : null);

    const scheduleInstallments = currentSchedule
      ? debtInstallments.filter((i) => i.scheduleVersionId === currentSchedule.id && i.debtId === debt.id)
      : [];

    const currentScheduleInstallmentCount = isCard ? (latestCardStatement ? 1 : 0) : scheduleInstallments.length;

    let currentScheduleLastDueDate: string | null = null;
    if (isCard) {
      currentScheduleLastDueDate = latestCardStatement?.dueDate ?? null;
    } else if (scheduleInstallments.length > 0) {
      const dates = scheduleInstallments.map((i) => i.dueDate).filter(Boolean);
      if (dates.length > 0) {
        currentScheduleLastDueDate = dates.reduce((max, d) => (d.localeCompare(max) > 0 ? d : max), dates[0]);
      }
    }

    // 7. Planning Items & Outstanding Installments
    const debtPlanning = debtPlanningItems.filter((item) => item.debtId === debt.id);
    const outstanding = debtPlanning.filter((item) => !item.isCovered);

    let remainingInstallmentCount = outstanding.length;
    let knownRemainingInstallmentCount = outstanding.filter((item) => item.amountKnown).length;
    let unknownRemainingInstallmentCount = outstanding.filter((item) => !item.amountKnown).length;
    let overdueInstallmentCount = outstanding.filter((item) => item.dueStatus === "overdue").length;

    // Next Outstanding Installment (Sorted by dueDate ASC, then installmentNumber ASC)
    let nextInstallmentId: string | null = null;
    let nextInstallmentNumber: number | null = null;
    let nextInstallmentDueDate: string | null = null;
    let nextInstallmentDueStatus: ("covered" | DueDateKind) | null = null;
    let nextInstallmentRemainingAmount: number | null = null;
    let nextInstallmentAmountKnown = false;

    let next30InstallmentCount = 0;
    let next30KnownAmount = 0;
    let next30UnknownAmountCount = 0;

    if (isCard && latestCardStatement && latestCardStatement.dueDate) {
      const attention = classifyCreditCardStatementAttention({
        debt,
        statement: latestCardStatement,
        entries: creditCardEntries,
        currentCardBalance: currentPrincipal,
      });

      if (attention.actionable) {
        const ds = dueDateStatus(latestCardStatement.dueDate, todayKey);
        nextInstallmentId = latestCardStatement.id;
        nextInstallmentNumber = 1;
        nextInstallmentDueDate = latestCardStatement.dueDate;
        nextInstallmentDueStatus = ds.kind;
        nextInstallmentRemainingAmount = latestCardStatement.minimumPaymentAmount ?? null;
        nextInstallmentAmountKnown = latestCardStatement.minimumPaymentAmount != null;

        if (ds.days >= 0 && ds.days <= 30) {
          next30InstallmentCount = 1;
          if (nextInstallmentAmountKnown && latestCardStatement.minimumPaymentAmount != null) {
            next30KnownAmount = latestCardStatement.minimumPaymentAmount;
          } else {
            next30UnknownAmountCount = 1;
          }
        }
      }
    } else if (outstanding.length > 0) {
      const sortedOutstanding = [...outstanding].sort(
        (a, b) => a.dueDate.localeCompare(b.dueDate) || a.installmentNumber - b.installmentNumber
      );
      const nextItem = sortedOutstanding[0];
      nextInstallmentId = nextItem.installmentId;
      nextInstallmentNumber = nextItem.installmentNumber;
      nextInstallmentDueDate = nextItem.dueDate;
      nextInstallmentDueStatus = nextItem.dueStatus;
      nextInstallmentRemainingAmount = nextItem.remainingAmount;
      nextInstallmentAmountKnown = nextItem.amountKnown;

      const next30Items = outstanding.filter((item) => item.daysUntilDue >= 0 && item.daysUntilDue <= 30);
      next30InstallmentCount = next30Items.length;
      next30KnownAmount = next30Items.reduce(
        (sum, item) => (item.amountKnown && item.remainingAmount != null ? sum + item.remainingAmount : sum),
        0
      );
      next30UnknownAmountCount = next30Items.filter((item) => !item.amountKnown).length;
    }

    // 8. Collateral Intelligence
    const activeCollaterals = debtCollaterals.filter((c) => c.debtId === debt.id && c.status === "pledged");
    const hasActiveCollateral = activeCollaterals.length > 0;
    const activeCollateralCount = activeCollaterals.length;

    let nearestRedemptionDeadline: string | null = null;
    let nearestRedemptionStatus: DueDateKind | null = null;

    const deadlinedCollaterals = activeCollaterals.filter(
      (c): c is DebtCollateral & { redemptionDeadline: string } => Boolean(c.redemptionDeadline)
    );

    if (deadlinedCollaterals.length > 0) {
      nearestRedemptionDeadline = deadlinedCollaterals.reduce(
        (earliest, c) => (c.redemptionDeadline.localeCompare(earliest) < 0 ? c.redemptionDeadline : earliest),
        deadlinedCollaterals[0].redemptionDeadline
      );
      nearestRedemptionStatus = dueDateStatus(nearestRedemptionDeadline, todayKey).kind;
    }

    // 9. Data Readiness & Limitations
    const hasOriginalPrincipal = debt.originalPrincipal != null && debt.originalPrincipal > 0;
    const hasKnownCurrentScheduleAmounts = hasCurrentSchedule && unknownRemainingInstallmentCount === 0;
    const hasRecordedLastDueDate = currentScheduleLastDueDate != null;
    const hasRate = ratePercent != null;
    const hasTcea = debt.tceaPercent != null;
    const hasTea = debt.teaPercent != null;

    const limitations: DebtDataLimitation[] = [];
    if (!hasOriginalPrincipal) limitations.push("missing_original_principal");
    if (!hasCurrentSchedule) limitations.push("missing_current_schedule");
    if (unknownRemainingInstallmentCount > 0) limitations.push("unknown_installment_amounts");
    if (!hasRate) limitations.push("missing_rate");
    if (!hasRecordedLastDueDate) limitations.push("missing_last_due_date");

    const readiness: DebtDataReadiness = {
      hasOriginalPrincipal,
      hasCurrentSchedule,
      hasKnownCurrentScheduleAmounts,
      hasRecordedLastDueDate,
      hasRate,
      hasTcea,
      hasTea,

      planningReady: hasCurrentSchedule,
      rateStrategyReady: hasRate,
      originalProgressReady: hasOriginalPrincipal,
      payoffVisibilityReady: hasCurrentSchedule && hasRecordedLastDueDate,

      limitations,
    };

    return {
      debtId: debt.id,
      debtName: debt.name,
      creditorName: debt.creditorName,
      debtKind: debt.debtKind,
      currencyCode: debt.currencyCode || "PEN",
      status: debt.status,
      isArchived: debt.isArchived,

      currentPrincipal,
      originalPrincipal: debt.originalPrincipal,
      openingPrincipalBalance: debt.openingPrincipalBalance,

      recordedFundPrincipalReduction,
      nonFundPrincipalDelta,

      balanceReductionFromOriginal,
      balanceReductionPercentFromOriginal,

      historicalEconomics,

      rateBasis,
      ratePercent,

      hasCurrentSchedule,
      currentScheduleId,
      currentScheduleInstallmentCount,
      currentScheduleLastDueDate,

      remainingInstallmentCount,
      knownRemainingInstallmentCount,
      unknownRemainingInstallmentCount,
      overdueInstallmentCount,

      nextInstallmentId,
      nextInstallmentNumber,
      nextInstallmentDueDate,
      nextInstallmentDueStatus,
      nextInstallmentRemainingAmount,
      nextInstallmentAmountKnown,

      next30KnownAmount,
      next30UnknownAmountCount,
      next30InstallmentCount,

      prepaymentPrincipalReduction,
      prepaymentCashOutflow,

      hasActiveCollateral,
      activeCollateralCount,
      nearestRedemptionDeadline,
      nearestRedemptionStatus,

      readiness,
    };
  });
}

// ---------------------------------------------------------------------------
// Portfolio Builder
// ---------------------------------------------------------------------------

/**
 * Builds portfolio-level intelligence from a list of DebtIntelligenceItems.
 * Filters strictly for active, non-archived debts (status === "active" && !isArchived).
 */
export function buildDebtPortfolioIntelligence(
  items: DebtIntelligenceItem[]
): DebtPortfolioIntelligence {
  const activeItems = items.filter((item) => item.status === "active" && !item.isArchived);

  const unratedDebtCount = activeItems.filter((i) => !i.readiness.hasRate).length;
  const debtsWithoutCurrentScheduleCount = activeItems.filter((i) => !i.readiness.hasCurrentSchedule).length;
  const debtsWithUnknownInstallmentsCount = activeItems.filter((i) => i.unknownRemainingInstallmentCount > 0).length;
  const debtsWithActiveCollateralCount = activeItems.filter((i) => i.hasActiveCollateral).length;

  const byCurrency: Record<string, DebtPortfolioCurrencyIntelligence> = {};

  for (const item of activeItems) {
    const curr = item.currencyCode || "PEN";

    if (!byCurrency[curr]) {
      byCurrency[curr] = {
        currencyCode: curr,
        activeDebtCount: 0,
        totalCurrentPrincipal: 0,

        largestDebtId: null,
        largestDebtPrincipal: null,

        smallestDebtId: null,
        smallestDebtPrincipal: null,

        overdueInstallmentCount: 0,

        next30KnownAmount: 0,
        next30UnknownAmountCount: 0,
        next30InstallmentCount: 0,

        debtsWithoutRateCount: 0,
        debtsWithoutCurrentScheduleCount: 0,
        debtsWithUnknownInstallmentsCount: 0,
        debtsWithActiveCollateralCount: 0,

        historicalKnownDetailedCosts: 0,
        historicalUnclassifiedDebtCost: 0,

        prepaymentPrincipalReduction: 0,
        prepaymentCashOutflow: 0,
      };
    }

    const entry = byCurrency[curr];

    entry.activeDebtCount++;
    entry.totalCurrentPrincipal += item.currentPrincipal;

    // Largest / Smallest tracking
    if (entry.largestDebtPrincipal === null || item.currentPrincipal > entry.largestDebtPrincipal) {
      entry.largestDebtId = item.debtId;
      entry.largestDebtPrincipal = item.currentPrincipal;
    }

    if (entry.smallestDebtPrincipal === null || item.currentPrincipal < entry.smallestDebtPrincipal) {
      entry.smallestDebtId = item.debtId;
      entry.smallestDebtPrincipal = item.currentPrincipal;
    }

    entry.overdueInstallmentCount += item.overdueInstallmentCount;

    entry.next30KnownAmount += item.next30KnownAmount;
    entry.next30UnknownAmountCount += item.next30UnknownAmountCount;
    entry.next30InstallmentCount += item.next30InstallmentCount;

    if (!item.readiness.hasRate) entry.debtsWithoutRateCount++;
    if (!item.readiness.hasCurrentSchedule) entry.debtsWithoutCurrentScheduleCount++;
    if (item.unknownRemainingInstallmentCount > 0) entry.debtsWithUnknownInstallmentsCount++;
    if (item.hasActiveCollateral) entry.debtsWithActiveCollateralCount++;

    entry.historicalKnownDetailedCosts += item.historicalEconomics.knownDetailedCosts;
    entry.historicalUnclassifiedDebtCost += item.historicalEconomics.unclassifiedDebtCost;

    entry.prepaymentPrincipalReduction += item.prepaymentPrincipalReduction;
    entry.prepaymentCashOutflow += item.prepaymentCashOutflow;
  }

  return {
    totalActiveDebts: activeItems.length,
    unratedDebtCount,
    debtsWithoutCurrentScheduleCount,
    debtsWithUnknownInstallmentsCount,
    debtsWithActiveCollateralCount,
    byCurrency,
  };
}
