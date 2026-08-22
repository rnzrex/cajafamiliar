import type { DebtIntelligenceItem } from "./debtIntelligence.js";

// ---------------------------------------------------------------------------
// Constants & Types
// ---------------------------------------------------------------------------

export const DEBT_SIMULATION_MONEY_TOLERANCE = 0.01;

export type DebtPrepaymentSimulationStatus =
  | "valid_prepayment"
  | "payoff_candidate"
  | "invalid_amount"
  | "exceeds_current_principal"
  | "not_active"
  | "archived"
  | "no_outstanding_principal"
  | "unsupported_debt_kind";

export type DebtPrepaymentSimulationLimitation =
  | "exact_interest_savings_unavailable"
  | "installment_recalculation_unavailable"
  | "payoff_date_recalculation_unavailable"
  | "cash_outflow_not_determined"
  | "recalculated_schedule_required";

export interface DebtPrepaymentSimulation {
  debtId: string;
  debtName: string;
  currencyCode: string;

  status: DebtPrepaymentSimulationStatus;

  requestedPrincipalReduction: number;
  currentPrincipal: number;

  appliedPrincipalReduction: number | null;
  simulatedPrincipal: number | null;

  principalReductionPercentOfCurrent: number | null;

  originalPrincipal: number | null;
  simulatedBalanceReductionFromOriginal: number | null;
  simulatedBalanceReductionPercentFromOriginal: number | null;

  rateBasis: "tcea" | "tea" | "unknown";
  ratePercent: number | null;

  currentScheduleLastDueDate: string | null;

  operationHint: "principal_prepayment" | "payoff" | null;

  exactInterestSavingsAmount: null;
  simulatedInstallmentAmount: null;
  simulatedScheduleLastDueDate: null;
  simulatedCashOutflow: null;

  limitations: DebtPrepaymentSimulationLimitation[];
}

const STANDARD_SIMULATION_LIMITATIONS: DebtPrepaymentSimulationLimitation[] = [
  "exact_interest_savings_unavailable",
  "installment_recalculation_unavailable",
  "payoff_date_recalculation_unavailable",
  "cash_outflow_not_determined",
  "recalculated_schedule_required",
];

/**
 * Calculates a tiny epsilon to guard money comparisons against IEEE-754 binary floating point artifacts
 * without altering the 0.01 functional monetary tolerance rule.
 */
function moneyComparisonEpsilon(a: number, b: number): number {
  return Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 4;
}

// ---------------------------------------------------------------------------
// Pure Prepayment Simulator Function
// ---------------------------------------------------------------------------

/**
 * Simulates applying a requested amount of principal reduction to a debt.
 * Input represents requestedPrincipalReduction (NOT cash payment or cash outflow).
 * Pure, deterministic function without side effects.
 */
export function simulateDebtPrincipalPrepayment(
  item: DebtIntelligenceItem,
  requestedPrincipalReduction: number
): DebtPrepaymentSimulation {
  const baseResult: DebtPrepaymentSimulation = {
    debtId: item.debtId,
    debtName: item.debtName,
    currencyCode: item.currencyCode || "PEN",

    status: "invalid_amount",

    requestedPrincipalReduction,
    currentPrincipal: item.currentPrincipal,

    appliedPrincipalReduction: null,
    simulatedPrincipal: null,

    principalReductionPercentOfCurrent: null,

    originalPrincipal: item.originalPrincipal,
    simulatedBalanceReductionFromOriginal: null,
    simulatedBalanceReductionPercentFromOriginal: null,

    rateBasis: item.rateBasis,
    ratePercent: item.ratePercent,

    currentScheduleLastDueDate: item.currentScheduleLastDueDate,

    operationHint: null,

    exactInterestSavingsAmount: null,
    simulatedInstallmentAmount: null,
    simulatedScheduleLastDueDate: null,
    simulatedCashOutflow: null,

    limitations: [],
  };

  // 1. Check unsupported debt kind (credit_card)
  if (item.debtKind === "credit_card") {
    return { ...baseResult, status: "unsupported_debt_kind" };
  }

  // 2. Check if archived
  if (item.isArchived) {
    return { ...baseResult, status: "archived" };
  }

  // 3. Check if active
  if (item.status !== "active") {
    return { ...baseResult, status: "not_active" };
  }

  // 4. Check if debt has positive outstanding principal
  if (item.currentPrincipal <= 0) {
    return { ...baseResult, status: "no_outstanding_principal" };
  }

  // 5. Validate requested amount
  if (
    !Number.isFinite(requestedPrincipalReduction) ||
    Number.isNaN(requestedPrincipalReduction) ||
    requestedPrincipalReduction <= 0
  ) {
    return { ...baseResult, status: "invalid_amount" };
  }

  // 6. Floating-point robust tolerance check
  const difference = requestedPrincipalReduction - item.currentPrincipal;
  const comparisonEpsilon = moneyComparisonEpsilon(requestedPrincipalReduction, item.currentPrincipal);
  const toleranceWithFloatGuard = DEBT_SIMULATION_MONEY_TOLERANCE + comparisonEpsilon;

  if (difference > toleranceWithFloatGuard) {
    return { ...baseResult, status: "exceeds_current_principal" };
  }

  // 7. Determine payoff_candidate vs valid_prepayment
  let status: DebtPrepaymentSimulationStatus = "valid_prepayment";
  let operationHint: "principal_prepayment" | "payoff" = "principal_prepayment";
  let appliedPrincipalReduction = requestedPrincipalReduction;
  let simulatedPrincipal = item.currentPrincipal - requestedPrincipalReduction;

  if (Math.abs(difference) <= toleranceWithFloatGuard) {
    status = "payoff_candidate";
    operationHint = "payoff";
    appliedPrincipalReduction = item.currentPrincipal;
    simulatedPrincipal = 0;
  }

  // 8. Percent of current principal
  const principalReductionPercentOfCurrent = (appliedPrincipalReduction / item.currentPrincipal) * 100;

  // 9. Original principal progress
  let simulatedBalanceReductionFromOriginal: number | null = null;
  let simulatedBalanceReductionPercentFromOriginal: number | null = null;

  if (item.originalPrincipal != null && item.originalPrincipal > 0) {
    simulatedBalanceReductionFromOriginal = item.originalPrincipal - simulatedPrincipal;
    simulatedBalanceReductionPercentFromOriginal =
      (simulatedBalanceReductionFromOriginal / item.originalPrincipal) * 100;
  }

  return {
    ...baseResult,
    status,
    appliedPrincipalReduction,
    simulatedPrincipal,
    principalReductionPercentOfCurrent,
    simulatedBalanceReductionFromOriginal,
    simulatedBalanceReductionPercentFromOriginal,
    operationHint,
    limitations: [...STANDARD_SIMULATION_LIMITATIONS],
  };
}

// ---------------------------------------------------------------------------
// Multiple Scenarios Helper
// ---------------------------------------------------------------------------

/**
 * Simulates multiple prepayment amounts for a single debt, preserving input order.
 */
export function simulateDebtPrincipalPrepaymentScenarios(
  item: DebtIntelligenceItem,
  requestedAmounts: number[]
): DebtPrepaymentSimulation[] {
  return requestedAmounts.map((amount) => simulateDebtPrincipalPrepayment(item, amount));
}
