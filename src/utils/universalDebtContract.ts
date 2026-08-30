import type {
  Debt,
  DebtContractAuthority,
  DebtDayCountBasis,
  DebtEvent,
  DebtFinancingContract,
  DebtInstallment,
  DebtEventInstallmentAllocation,
  DebtInstallmentCarriedAllocation,
  DebtRefinancingLink,
  DebtStateSnapshot,
} from "../types";
import { effectiveDebtEvents, effectiveInstallmentAllocations, totalAllocatedAmountForInstallment } from "./debtCalculations";

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface NominalAnnualSimpleInterestInput {
  principal: number | null | undefined;
  annualRatePercent: number | null | undefined;
  elapsedDays: number | null | undefined;
  dayCountBasis: DebtDayCountBasis | null | undefined;
}

/** TNA is nominal annual simple interest; it is deliberately not TCEA/TEA. */
export function calculateNominalAnnualSimpleInterest(input: NominalAnnualSimpleInterestInput): number | null {
  const principal = input.principal;
  const annualRatePercent = input.annualRatePercent;
  const elapsedDays = input.elapsedDays;
  const denominator = input.dayCountBasis === "actual_days_365" ? 365 : input.dayCountBasis === "actual_days_360" ? 360 : null;
  if (
    principal == null || annualRatePercent == null || elapsedDays == null || denominator == null
    || !Number.isFinite(principal) || !Number.isFinite(annualRatePercent) || !Number.isFinite(elapsedDays)
    || principal < 0 || annualRatePercent < 0 || elapsedDays < 0
  ) return null;
  return roundCurrency(principal * (annualRatePercent / 100) * (elapsedDays / denominator));
}

export interface DebtFeeInput {
  ruleType: DebtFinancingContract["feeRuleType"];
  rule: Record<string, unknown> | null | undefined;
  baseAmount: number | null | undefined;
  installmentNumber?: number | null;
}

/** Unknown fee formulas stay unknown instead of being silently converted to zero. */
export function calculateKnownDebtFee(input: DebtFeeInput): number | null {
  if (input.ruleType === "unknown" || input.ruleType === "contract_schedule_only") return null;
  if (!input.rule || input.baseAmount == null || !Number.isFinite(input.baseAmount) || input.baseAmount < 0) return null;
  const amount = typeof input.rule.amount === "number" ? input.rule.amount : null;
  if (input.ruleType === "fixed") return amount == null || amount < 0 ? null : roundCurrency(amount);
  if (input.ruleType === "percentage") {
    const percent = typeof input.rule.percent === "number" ? input.rule.percent : null;
    return percent == null || percent < 0 ? null : roundCurrency(input.baseAmount * percent / 100);
  }
  if (input.ruleType === "formula_known" && input.rule.formula === "fixed_per_installment") {
    return amount == null || amount < 0 ? null : roundCurrency(amount);
  }
  return null;
}

export function isFixedScheduleDebt(debt: Pick<Debt, "repaymentStructure">, contract?: Pick<DebtFinancingContract, "repaymentStructure"> | null): boolean {
  return (contract?.repaymentStructure ?? debt.repaymentStructure) === "fixed_schedule";
}

export interface UniversalScheduleArithmeticRow {
  expectedAmount: number | null | undefined;
  expectedPrincipal: number | null | undefined;
  expectedInterest: number | null | undefined;
  expectedFees: number | null | undefined;
  expectedInsurance: number | null | undefined;
  expectedTaxes?: number | null;
}

/**
 * Validates a row without turning a missing tax into a zero tax. A known tax
 * participates in the total exactly once; an unknown tax leaves the row
 * reviewable instead of creating a false reconciliation failure.
 */
export function validateUniversalScheduleArithmetic(row: UniversalScheduleArithmeticRow): boolean {
  const required = [row.expectedAmount, row.expectedPrincipal, row.expectedInterest, row.expectedFees, row.expectedInsurance];
  if (required.some((value) => value == null || !Number.isFinite(value) || value < 0) || row.expectedAmount! <= 0) return false;
  if (row.expectedTaxes != null && (!Number.isFinite(row.expectedTaxes) || row.expectedTaxes < 0)) return false;
  const knownComponents = row.expectedPrincipal! + row.expectedInterest! + row.expectedFees! + row.expectedInsurance!;
  if (row.expectedTaxes == null) return roundCurrency(knownComponents) <= roundCurrency(row.expectedAmount!) + 0.01;
  return Math.abs(roundCurrency(knownComponents + row.expectedTaxes) - roundCurrency(row.expectedAmount!)) <= 0.01;
}

export function debtContractAuthorityIsAuthoritative(authority: DebtContractAuthority | null | undefined): boolean {
  return authority === "contractual";
}

export interface UniversalDebtStateInput {
  debt: Debt;
  events: DebtEvent[];
  installments?: DebtInstallment[];
  allocations?: DebtEventInstallmentAllocation[];
  carriedAllocations?: DebtInstallmentCarriedAllocation[];
  currentScheduleId?: string | null;
  scheduleAuthority?: DebtContractAuthority | null;
  today?: string;
}

export function deriveUniversalDebtState(input: UniversalDebtStateInput): DebtStateSnapshot {
  const relevantEvents = effectiveDebtEvents(input.events).filter((event) => event.debtId === input.debt.id);
  const currentPrincipal = Math.max(0, roundCurrency(input.debt.openingPrincipalBalance + relevantEvents.reduce((sum, event) => sum + event.principalDelta, 0)));
  const principalPaid = roundCurrency(relevantEvents.reduce((sum, event) => sum + Math.max(0, -event.principalDelta), 0));
  const cashPaid = roundCurrency(relevantEvents.reduce((sum, event) => sum + Math.max(0, event.cashAmount), 0));
  const interestPaid = roundCurrency(relevantEvents.reduce((sum, event) => sum + Math.max(0, event.interestPaid), 0));
  const feesPaid = roundCurrency(relevantEvents.reduce((sum, event) => sum + Math.max(0, event.feesPaid), 0));
  const insurancePaid = roundCurrency(relevantEvents.reduce((sum, event) => sum + Math.max(0, event.insurancePaid), 0));
  const otherCostsPaid = roundCurrency(relevantEvents.reduce((sum, event) => sum + Math.max(0, event.otherCostPaid), 0));
  const installments = (input.installments ?? [])
    .filter((installment) => installment.debtId === input.debt.id && !installment.isPaidBeforeTracking && (input.currentScheduleId == null || installment.scheduleVersionId === input.currentScheduleId))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.installmentNumber - b.installmentNumber);
  const effectiveAllocations = effectiveInstallmentAllocations(input.allocations ?? [], input.events, input.debt.id);
  const effectiveEventById = new Map(relevantEvents.map((event) => [event.id, event]));
  const installmentRows = installments.map((installment) => {
    const allocated = totalAllocatedAmountForInstallment(installment, effectiveAllocations, input.events, input.carriedAllocations ?? []);
    const expected = installment.expectedAmount;
    const remainingAmount = expected == null ? null : roundCurrency(Math.max(0, expected - allocated));
    const paid = remainingAmount != null ? remainingAmount <= 0.01 : allocated > 0;
    const advanced = effectiveAllocations.some((allocation) => allocation.installmentId === installment.id && effectiveEventById.get(allocation.eventId)?.eventType === "installment_advance" && effectiveEventById.get(allocation.eventId)!.eventDate < installment.dueDate);
    // An allocation carries only a total amount. Unless the row is untouched
    // or completely covered, subtracting it from principal/interest/costs
    // would invent a component allocation that the ledger does not contain.
    const componentResidual = (value: number | null): number | null => {
      if (value == null) return null;
      if (allocated <= 0.01) return roundCurrency(value);
      if (paid) return 0;
      return null;
    };
    return { installment, allocated, remainingAmount, paid, advanced, componentResidual };
  });
  const unpaidInstallments = installmentRows.filter((row) => !row.paid);
  const futureInstallments = input.today == null ? unpaidInstallments : unpaidInstallments.filter((row) => row.installment.dueDate >= input.today!);
  const authority = input.scheduleAuthority ?? "unknown";
  const next = futureInstallments[0]?.installment ?? null;
  const scheduleKnown = installments.length > 0;
  const certainty = authority === "contractual" ? "exact" : authority === "estimated" ? "estimated" : authority === "user_reported" || authority === "official_noncontractual" ? "reported" : "insufficient_info";
  const sumKnown = (selector: (row: (typeof installmentRows)[number]) => number | null): number | null => {
    const values = unpaidInstallments.map((row) => selector(row));
    if (values.some((value) => value == null)) return null;
    return roundCurrency(values.reduce<number>((sum, value) => sum + (value as number), 0));
  };
  const sumRemainingAmounts = (rows: typeof installmentRows): number | null => {
    const values = rows.map((row) => row.remainingAmount);
    if (values.some((value) => value == null)) return null;
    return roundCurrency(values.reduce<number>((sum, value) => sum + (value as number), 0));
  };
  const overdueRows = input.today == null ? [] : unpaidInstallments.filter((row) => row.installment.dueDate < input.today! && (row.remainingAmount == null || row.remainingAmount > 0.01));
  return {
    currentPrincipal,
    principalPaid,
    cashPaid,
    interestPaid,
    feesPaid,
    insurancePaid,
    otherCostsPaid,
    effectiveEventCount: relevantEvents.length,
    futureInstallmentCount: futureInstallments.length,
    scheduleKnown,
    scheduleAuthority: authority,
    nextDueDate: next?.dueDate ?? null,
    nextInstallmentAmount: futureInstallments[0]?.remainingAmount ?? null,
    overdueAmount: sumRemainingAmounts(overdueRows),
    remainingScheduledPrincipal: sumKnown((row) => row.componentResidual(row.installment.expectedPrincipal)),
    remainingProjectedInterest: sumKnown((row) => row.componentResidual(row.installment.expectedInterest)),
    remainingProjectedFees: sumKnown((row) => row.componentResidual(row.installment.expectedFees)),
    remainingProjectedInsurance: sumKnown((row) => row.componentResidual(row.installment.expectedInsurance)),
    remainingProjectedTotalCash: sumRemainingAmounts(unpaidInstallments),
    paidInstallmentCount: installmentRows.filter((row) => row.paid).length,
    partialInstallmentCount: installmentRows.filter((row) => !row.paid && row.allocated > 0).length,
    advancedInstallmentCount: installmentRows.filter((row) => row.advanced).length,
    pendingInstallmentCount: installmentRows.filter((row) => !row.paid && row.allocated <= 0).length,
    overdueInstallmentCount: input.today == null ? 0 : unpaidInstallments.filter((row) => row.installment.dueDate < input.today!).length,
    certainty: scheduleKnown ? certainty : "insufficient_info",
  };
}

export interface RefinancingComparisonInput {
  sourcePrincipal: number | null | undefined;
  sourceRemainingPayments: number | null | undefined;
  targetPrincipal: number | null | undefined;
  targetRemainingPayments: number | null | undefined;
  cashContribution: number | null | undefined;
  sourceRemainingInterest?: number | null;
  sourceRemainingFees?: number | null;
  sourceRemainingInsurance?: number | null;
  targetRemainingInterest?: number | null;
  targetRemainingFees?: number | null;
  targetRemainingInsurance?: number | null;
  refinanceCosts?: number | null;
  sourceRemainingInstallments?: number | null;
  targetRemainingInstallments?: number | null;
  sourceFinalDueDate?: string | null;
  targetFinalDueDate?: string | null;
}

export interface RefinancingComparison {
  status: "known" | "insufficient_info";
  sourceTotal: number | null;
  targetTotal: number | null;
  difference: number | null;
  monthlyPaymentDelta: number | null;
  termDelta: number | null;
  warning: string | null;
}

export function compareRefinancing(input: RefinancingComparisonInput): RefinancingComparison {
  const sourceComponents = [input.sourcePrincipal ?? null, input.sourceRemainingInterest ?? 0, input.sourceRemainingFees ?? 0, input.sourceRemainingInsurance ?? 0];
  const targetComponents = [input.targetPrincipal ?? null, input.targetRemainingInterest ?? null, input.targetRemainingFees ?? null, input.targetRemainingInsurance ?? null];
  const explicitSourceComponents = input.sourceRemainingInterest != null || input.sourceRemainingFees != null || input.sourceRemainingInsurance != null;
  const explicitTargetComponents = input.targetRemainingInterest != null || input.targetRemainingFees != null || input.targetRemainingInsurance != null;
  const sourceTotal = input.sourceRemainingPayments == null
    ? (explicitSourceComponents && sourceComponents.every((value) => value != null) ? roundCurrency(sourceComponents.reduce((sum, value) => sum + (value as number), 0)) : null)
    : roundCurrency(input.sourceRemainingPayments);
  const targetBase = input.targetRemainingPayments == null
    ? (explicitTargetComponents && targetComponents.every((value) => value != null) ? roundCurrency(targetComponents.reduce((sum, value) => sum + (value as number), 0)) : null)
    : roundCurrency(input.targetRemainingPayments);
  const costs = input.refinanceCosts === null ? null : input.refinanceCosts ?? 0;
  const targetTotal = targetBase == null || input.cashContribution == null || costs == null
    ? null
    : roundCurrency(targetBase + input.cashContribution + costs);
  if (sourceTotal == null || targetTotal == null) {
    return { status: "insufficient_info", sourceTotal, targetTotal, difference: null, monthlyPaymentDelta: null, termDelta: null, warning: "No hay información suficiente para afirmar ahorro o sobrecosto." };
  }
  const sourceMonthly = input.sourceRemainingPayments != null && input.sourceRemainingInstallments && input.sourceRemainingInstallments > 0
    ? input.sourceRemainingPayments / input.sourceRemainingInstallments : null;
  const targetMonthly = input.targetRemainingPayments != null && input.targetRemainingInstallments && input.targetRemainingInstallments > 0
    ? input.targetRemainingPayments / input.targetRemainingInstallments : null;
  return {
    status: "known",
    sourceTotal,
    targetTotal,
    difference: roundCurrency(sourceTotal - targetTotal),
    monthlyPaymentDelta: sourceMonthly != null && targetMonthly != null ? roundCurrency(targetMonthly - sourceMonthly) : null,
    termDelta: input.sourceRemainingInstallments != null && input.targetRemainingInstallments != null ? input.targetRemainingInstallments - input.sourceRemainingInstallments : null,
    warning: null,
  };
}

export function isActiveRefinancingLink(link: Pick<DebtRefinancingLink, "status">): boolean {
  return link.status === "active";
}
