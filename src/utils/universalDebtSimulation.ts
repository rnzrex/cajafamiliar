import type { DebtDayCountBasis, DebtFinancingContract, DebtInstallment, DebtInsuranceTerms, PeriodicRateBasis, PrepaymentEffect, ScheduleSource } from "../types.js";
import { calculateKnownDebtFee, calculateNominalAnnualSimpleInterest, roundCurrency } from "./universalDebtContract.js";

export type UniversalSimulationEffect = Extract<PrepaymentEffect, "reduce_term" | "reduce_installment">;

export interface UniversalDebtSimulationInput {
  effect: UniversalSimulationEffect;
  principalBeforeOperation: number;
  principalPaid?: number;
  extraPrincipalPaid?: number;
  operationDate: string;
  originalPrincipal?: number | null;
  originalTermInstallments?: number | null;
  currentSchedule: Array<Pick<DebtInstallment, "installmentNumber" | "contractualInstallmentNumber" | "dueDate" | "expectedAmount" | "expectedPrincipal" | "expectedInterest" | "expectedFees" | "expectedInsurance" | "expectedTaxes">>;
  contract?: Pick<DebtFinancingContract, "interestRateType" | "interestRatePercent" | "interestRateBasis" | "dayCountBasis" | "feeRuleType" | "feeRule" | "prepaymentTerms" | "repaymentStructure"> | null;
  insuranceTerms?: Array<Pick<DebtInsuranceTerms, "pricingMode" | "ratePercent" | "fixedAmount" | "rateBasis" | "isRequired"> & { affectsInstallmentSchedule?: boolean | null }>;
  currentScheduleSource?: ScheduleSource | null;
  currentScheduleAuthoritative?: boolean;
  hasAllocatedFutureInstallments?: boolean;
}

export interface UniversalDebtSimulationRow {
  installmentNumber: number;
  contractualInstallmentNumber: number;
  dueDate: string;
  principal: number;
  interest: number | null;
  fees: number | null;
  insurance: number | null;
  taxes: number | null;
  total: number | null;
  remainingPrincipalBalance: number;
  interestDays: number;
}

export interface UniversalDebtSimulationResult {
  status: "calculated" | "calculated_with_warnings" | "insufficient_data";
  effect: UniversalSimulationEffect;
  principalBefore: number;
  principalAfter: number;
  oldRemainingInstallments: number;
  newRemainingInstallments: number;
  oldRegularInstallment: number | null;
  newRegularInstallment: number | null;
  oldFinalDueDate: string | null;
  newFinalDueDate: string | null;
  oldRemainingInterest: number | null;
  newEstimatedInterest: number | null;
  estimatedInterestSavings: number | null;
  rows: UniversalDebtSimulationRow[];
  warnings: string[];
  canPersist: boolean;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : NaN;
}

function rateFor(contract: UniversalDebtSimulationInput["contract"], principal: number, days: number): number | null {
  if (!contract || !Number.isFinite(days) || days <= 0 || contract.interestRatePercent == null) return null;
  const annual = contract.interestRatePercent;
  if (!Number.isFinite(annual) || annual < 0) return null;
  if (contract.interestRateType === "nominal_annual_simple") {
    const simple = calculateNominalAnnualSimpleInterest({ principal, annualRatePercent: annual, elapsedDays: days, dayCountBasis: contract.dayCountBasis as DebtDayCountBasis });
    return simple == null || principal <= 0 ? null : simple / principal;
  }
  if (contract.interestRateType === "effective_annual") return Math.pow(1 + annual / 100, days / 365) - 1;
  if (contract.interestRateType === "effective_periodic") {
    const basis = contract.interestRateBasis as PeriodicRateBasis | null;
    const baseDays = basis === "daily" ? 1 : basis === "weekly" ? 7 : basis === "biweekly" ? 14 : basis === "monthly" ? 30 : null;
    return baseDays == null ? null : Math.pow(1 + annual / 100, days / baseDays) - 1;
  }
  return null;
}

function emptyResult(input: UniversalDebtSimulationInput, warnings: string[], principalAfter: number): UniversalDebtSimulationResult {
  const futureRows = input.currentSchedule.filter((row) => row.dueDate > input.operationDate);
  return {
    status: "insufficient_data", effect: input.effect, principalBefore: roundCurrency(input.principalBeforeOperation), principalAfter,
    oldRemainingInstallments: futureRows.length, newRemainingInstallments: 0, oldRegularInstallment: futureRows[0]?.expectedAmount ?? null,
    newRegularInstallment: null, oldFinalDueDate: futureRows.at(-1)?.dueDate ?? null, newFinalDueDate: null,
    oldRemainingInterest: futureRows.every((row) => row.expectedInterest != null) ? roundCurrency(futureRows.reduce((sum, row) => sum + (row.expectedInterest ?? 0), 0)) : null,
    newEstimatedInterest: null, estimatedInterestSavings: null, rows: [], warnings: Array.from(new Set(warnings)), canPersist: false,
  };
}

const UNKNOWN_FUTURE_COSTS_WARNING = "COMISIONES, SEGURO O IMPUESTOS FUTUROS: POR CONFIRMAR.";
const UNKNOWN_FUTURE_COSTS_ESTIMATE_WARNING = "Los costos futuros desconocidos pueden cambiar la distribución entre capital e interés. Esta proyección es orientativa y debe confirmarse con el nuevo cronograma del acreedor.";

function distributeEvenInsurance(total: number, installments: number): number[] {
  if (total <= 0 || installments <= 0) return Array.from({ length: Math.max(0, installments) }, () => 0);
  const regularAmount = roundCurrency(total / installments);
  const amounts = Array.from({ length: installments }, () => regularAmount);
  const priorTotal = amounts.slice(0, -1).reduce((sum, amount) => sum + amount, 0);
  amounts[installments - 1] = roundCurrency(total - priorTotal);
  return amounts;
}

type FutureRow = UniversalDebtSimulationInput["currentSchedule"][number];

function insuranceForRow(
  input: UniversalDebtSimulationInput,
  balance: number,
  source: FutureRow,
): { amount: number | null; known: boolean } {
  // A documentary auxiliary policy may be displayed to the user, but it is
  // never part of the operational projection.
  const terms = (input.insuranceTerms ?? []).filter((term) => term.affectsInstallmentSchedule !== false);
  if (terms.length === 0) {
    if (source.expectedInsurance === 0) return { amount: 0, known: true };
    return { amount: null, known: false };
  }

  const originalPrincipal = input.originalPrincipal;
  const amount = terms.reduce((sum, term) => {
    if (term.pricingMode === "percent_outstanding_balance" && term.ratePercent != null && Number.isFinite(term.ratePercent) && term.ratePercent >= 0) {
      return sum + roundCurrency(balance * term.ratePercent / 100);
    }
    if (term.pricingMode === "percent_original_principal" && term.ratePercent != null && Number.isFinite(term.ratePercent) && term.ratePercent >= 0 && originalPrincipal != null && Number.isFinite(originalPrincipal) && originalPrincipal >= 0) {
      return sum + roundCurrency(originalPrincipal * term.ratePercent / 100);
    }
    if (term.pricingMode === "fixed_amount" && term.fixedAmount != null && Number.isFinite(term.fixedAmount) && term.fixedAmount >= 0) {
      if (term.rateBasis === "per_installment") return sum + roundCurrency(term.fixedAmount);
      if (term.rateBasis === "total_credit_upfront") return sum;
      if (term.rateBasis === "total_credit_even") {
        const originalTerm = input.originalTermInstallments;
        const contractualNumber = source.contractualInstallmentNumber ?? source.installmentNumber;
        if (originalTerm == null || !Number.isInteger(originalTerm) || originalTerm <= 0 || !Number.isInteger(contractualNumber) || contractualNumber < 1 || contractualNumber > originalTerm) return sum;
        return sum + (distributeEvenInsurance(term.fixedAmount, originalTerm)[contractualNumber - 1] ?? 0);
      }
    }
    return sum;
  }, 0);

  const known = terms.every((term) => {
    if (term.pricingMode === "percent_outstanding_balance") return term.ratePercent != null && Number.isFinite(term.ratePercent) && term.ratePercent >= 0;
    if (term.pricingMode === "percent_original_principal") return term.ratePercent != null && Number.isFinite(term.ratePercent) && term.ratePercent >= 0 && originalPrincipal != null && Number.isFinite(originalPrincipal) && originalPrincipal >= 0;
    if (term.pricingMode !== "fixed_amount" || term.fixedAmount == null || !Number.isFinite(term.fixedAmount) || term.fixedAmount < 0) return false;
    if (term.rateBasis === "per_installment" || term.rateBasis === "total_credit_upfront") return true;
    if (term.rateBasis !== "total_credit_even") return false;
    const originalTerm = input.originalTermInstallments;
    const contractualNumber = source.contractualInstallmentNumber ?? source.installmentNumber;
    return originalTerm != null && Number.isInteger(originalTerm) && originalTerm > 0 && Number.isInteger(contractualNumber) && contractualNumber >= 1 && contractualNumber <= originalTerm;
  });
  return known ? { amount: roundCurrency(amount), known: true } : { amount: null, known: false };
}

function taxesForRow(source: FutureRow): { amount: number | null; known: boolean } {
  // V1 deliberately accepts only explicit zero. A positive historical tax or a
  // missing value is not a recalculation rule for the new schedule.
  return source.expectedTaxes === 0 ? { amount: 0, known: true } : { amount: null, known: false };
}

function buildRows(input: UniversalDebtSimulationInput, futureRows: UniversalDebtSimulationInput["currentSchedule"], principalAfter: number, payment: number): { rows: UniversalDebtSimulationRow[]; balance: number; warnings: string[] } {
  let balance = roundCurrency(principalAfter);
  let previousDate = input.operationDate;
  const warnings: string[] = [];
  const rows: UniversalDebtSimulationRow[] = [];
  for (const source of futureRows) {
    const days = daysBetween(previousDate, source.dueDate);
    const rate = rateFor(input.contract, balance, days);
    if (rate == null) break;
    const interest = input.contract?.interestRateType === "nominal_annual_simple"
      ? roundCurrency(calculateNominalAnnualSimpleInterest({ principal: balance, annualRatePercent: input.contract.interestRatePercent, elapsedDays: days, dayCountBasis: input.contract.dayCountBasis }) ?? 0)
      : roundCurrency(balance * rate);
    const knownFee = input.contract && input.contract.feeRuleType !== "unknown" && input.contract.feeRuleType !== "contract_schedule_only"
      ? calculateKnownDebtFee({ ruleType: input.contract.feeRuleType, rule: input.contract.feeRule, baseAmount: balance, installmentNumber: source.installmentNumber })
      : null;
    const insuranceResult = insuranceForRow(input, balance, source);
    const taxResult = taxesForRow(source);
    const knownInsurance = insuranceResult.amount;
    const knownTaxes = taxResult.amount;
    const costsKnown = knownFee != null && knownInsurance != null && knownTaxes != null;
    if (!costsKnown && !warnings.includes(UNKNOWN_FUTURE_COSTS_WARNING)) warnings.push(UNKNOWN_FUTURE_COSTS_WARNING);
    if (!costsKnown && !warnings.includes(UNKNOWN_FUTURE_COSTS_ESTIMATE_WARNING)) warnings.push(UNKNOWN_FUTURE_COSTS_ESTIMATE_WARNING);
    const principal = roundCurrency(Math.min(balance, Math.max(0, payment - interest - (knownFee ?? 0) - (knownInsurance ?? 0) - (knownTaxes ?? 0))));
    const remaining = roundCurrency(Math.max(0, balance - principal));
    rows.push({
      installmentNumber: rows.length + 1,
      contractualInstallmentNumber: source.contractualInstallmentNumber ?? source.installmentNumber,
      dueDate: source.dueDate, principal, interest,
      fees: knownFee, insurance: knownInsurance, taxes: knownTaxes,
      total: costsKnown ? roundCurrency(principal + interest + (knownFee ?? 0) + (knownInsurance ?? 0) + (knownTaxes ?? 0)) : null,
      remainingPrincipalBalance: remaining <= 0.01 ? 0 : remaining, interestDays: days,
    });
    balance = remaining;
    previousDate = source.dueDate;
    if (balance <= 0) break;
  }
  return { rows, balance, warnings };
}

export function simulateUniversalDebtPrepayment(input: UniversalDebtSimulationInput): UniversalDebtSimulationResult {
  const principalBefore = roundCurrency(input.principalBeforeOperation);
  const principalAfter = roundCurrency(Math.max(0, principalBefore - (input.principalPaid ?? 0) - (input.extraPrincipalPaid ?? 0)));
  const futureRows = [...input.currentSchedule].filter((row) => row.dueDate > input.operationDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (!Number.isFinite(principalBefore) || principalBefore <= 0 || principalAfter <= 0) return emptyResult(input, ["El principal posterior debe ser mayor que cero; para cancelar usa Liquidar deuda."], principalAfter);
  if (futureRows.length === 0) return emptyResult(input, ["No existen cuotas futuras para proyectar."], principalAfter);
  if (input.hasAllocatedFutureInstallments) return emptyResult(input, ["Hay cuotas futuras adelantadas; confirma primero cómo las tratará el acreedor."], principalAfter);
  if (input.contract?.interestRateType === "contract_schedule" || input.contract?.interestRateType === "manual" || input.contract?.interestRateType === "unknown") {
    return emptyResult(input, ["La tasa está definida solo por cronograma o es desconocida; el interés futuro queda POR CONFIRMAR."], principalAfter);
  }
  if (input.currentSchedule.some((row) => row.expectedAmount == null)) return emptyResult(input, ["El total contractual futuro está incompleto; no se inventó un cronograma."], principalAfter);
  const firstPayment = futureRows[0]?.expectedAmount;
  if (firstPayment == null || !Number.isFinite(firstPayment)) return emptyResult(input, ["No conocemos la cuota futura para proyectar."], principalAfter);
  const warnings: string[] = [];
  let built = buildRows(input, futureRows, principalAfter, firstPayment);
  if (input.effect === "reduce_installment") {
    let low = 0;
    let high = Math.max(firstPayment * 2, principalAfter * 2);
    for (let i = 0; i < 70; i += 1) {
      const middle = (low + high) / 2;
      const trial = buildRows(input, futureRows, principalAfter, middle);
      if (trial.rows.length === futureRows.length && trial.balance <= 0.01) high = middle; else low = middle;
    }
    built = buildRows(input, futureRows, principalAfter, roundCurrency(high));
  }
  warnings.push(...built.warnings);
  if (built.rows.length === 0 || built.balance > 0.01) return emptyResult(input, [...warnings, "No fue posible extinguir el principal con la información contractual disponible."], principalAfter);
  if (input.effect === "reduce_term") built.rows = built.rows.filter((row) => row.remainingPrincipalBalance >= 0);
  const oldInterest = futureRows.every((row) => row.expectedInterest != null) ? roundCurrency(futureRows.reduce((sum, row) => sum + (row.expectedInterest ?? 0), 0)) : null;
  const newInterest = built.rows.every((row) => row.interest != null) ? roundCurrency(built.rows.reduce((sum, row) => sum + (row.interest ?? 0), 0)) : null;
  const uniqueWarnings = Array.from(new Set(warnings));
  return {
    status: uniqueWarnings.length ? "calculated_with_warnings" : "calculated", effect: input.effect, principalBefore, principalAfter,
    oldRemainingInstallments: futureRows.length, newRemainingInstallments: built.rows.length, oldRegularInstallment: firstPayment,
    newRegularInstallment: built.rows[0]?.total ?? null, oldFinalDueDate: futureRows.at(-1)?.dueDate ?? null,
    newFinalDueDate: built.rows.at(-1)?.dueDate ?? null, oldRemainingInterest: oldInterest, newEstimatedInterest: newInterest,
    estimatedInterestSavings: oldInterest != null && newInterest != null ? roundCurrency(oldInterest - newInterest) : null,
    rows: built.rows, warnings: uniqueWarnings, canPersist: uniqueWarnings.length === 0,
  };
}
