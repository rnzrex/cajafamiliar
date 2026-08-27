import type {
  BankDueDateAdjustmentRule,
  BankInstallmentTotalMode,
  BankInterestDayCountBasis,
  DebtInstallment,
  DebtInsuranceTerms,
  AmortizationMethod,
  PeriodicRateBasis,
  PrepaymentEffect,
} from "../types.js";

export type BankPrepaymentSimulationEffect = Extract<PrepaymentEffect, "reduce_term" | "reduce_installment">;

export interface BankPrepaymentSimulationInput {
  effect: BankPrepaymentSimulationEffect;
  principalBeforeOperation: number;
  /** Principal covered by the regular installment in this same operation. */
  principalPaid?: number;
  /** Extraordinary principal paid in this operation. */
  extraPrincipalPaid?: number;
  operationDate: string;
  originalPrincipal?: number | null;
  teaPercent?: number | null;
  periodicRatePercent?: number | null;
  periodicRateBasis?: PeriodicRateBasis | null;
  dayCountBasis?: BankInterestDayCountBasis | null;
  installmentTotalMode?: BankInstallmentTotalMode | null;
  dueDateAdjustmentRule?: BankDueDateAdjustmentRule | null;
  amortizationMethod?: AmortizationMethod | null;
  currentSchedule: Array<Pick<DebtInstallment, "installmentNumber" | "contractualInstallmentNumber" | "dueDate" | "expectedAmount" | "expectedPrincipal" | "expectedInterest" | "expectedFees" | "expectedInsurance">>;
  insuranceTerms?: Array<Pick<DebtInsuranceTerms, "pricingMode" | "ratePercent" | "fixedAmount" | "rateBasis" | "isRequired">>;
}

export interface BankPrepaymentSimulationRow {
  installmentNumber: number;
  contractualInstallmentNumber: number;
  dueDate: string;
  principal: number;
  interest: number;
  insurance: number;
  fees: number;
  total: number;
  remainingPrincipalBalance: number;
  interestDays: number;
}

export type BankPrepaymentSimulationStatus = "calculated" | "calculated_with_warnings" | "insufficient_data";

export interface BankPrepaymentSimulationResult {
  status: BankPrepaymentSimulationStatus;
  effect: BankPrepaymentSimulationEffect;
  principalBefore: number;
  principalAfter: number | null;
  oldRemainingInstallments: number;
  newRemainingInstallments: number;
  oldRegularInstallment: number | null;
  newRegularInstallment: number | null;
  oldFinalDueDate: string | null;
  newFinalDueDate: string | null;
  oldRemainingInterest: number | null;
  newEstimatedInterest: number | null;
  estimatedInterestSavings: number | null;
  rows: BankPrepaymentSimulationRow[];
  warnings: string[];
  /** False when a warning means the numbers must not be persisted as exact rows. */
  canPersist: boolean;
}

type FutureRow = BankPrepaymentSimulationInput["currentSchedule"][number];

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function daysBetween(from: string, to: string): number {
  const fromDate = parseIsoDate(from);
  const toDate = parseIsoDate(to);
  if (!fromDate || !toDate) return NaN;
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000);
}

function effectiveRate(input: BankPrepaymentSimulationInput, days: number): number | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  if (input.teaPercent != null && Number.isFinite(input.teaPercent) && input.teaPercent >= 0) {
    const denominator = input.dayCountBasis === "actual_days_365" ? 365 : input.dayCountBasis === "actual_days_360" ? 360 : null;
    if (denominator != null) return Math.pow(1 + input.teaPercent / 100, days / denominator) - 1;
  }
  if (input.periodicRatePercent == null || !Number.isFinite(input.periodicRatePercent) || input.periodicRatePercent < 0) return null;
  const denominator = input.periodicRateBasis === "daily"
    ? 1
    : input.periodicRateBasis === "weekly"
      ? 7
      : input.periodicRateBasis === "biweekly"
        ? 14
        : input.periodicRateBasis === "monthly"
          ? 30
          : null;
  if (denominator == null) return null;
  return Math.pow(1 + input.periodicRatePercent / 100, days / denominator) - 1;
}

function emptyResult(effect: BankPrepaymentSimulationEffect, warnings: string[], principalBefore: number): BankPrepaymentSimulationResult {
  return {
    status: "insufficient_data",
    effect,
    principalBefore,
    principalAfter: null,
    oldRemainingInstallments: 0,
    newRemainingInstallments: 0,
    oldRegularInstallment: null,
    newRegularInstallment: null,
    oldFinalDueDate: null,
    newFinalDueDate: null,
    oldRemainingInterest: null,
    newEstimatedInterest: null,
    estimatedInterestSavings: null,
    rows: [],
    warnings,
    canPersist: false,
  };
}

function insuranceForRow(
  input: BankPrepaymentSimulationInput,
  balance: number,
  index: number,
  futureRow: FutureRow,
  warnings: string[],
): { amount: number; known: boolean } {
  const terms = input.insuranceTerms ?? [];
  if (terms.length === 0) {
    if ((futureRow.expectedInsurance ?? 0) > 0) {
      return { amount: 0, known: false };
    }
    return { amount: 0, known: true };
  }

  let amount = 0;
  let known = true;
  for (const term of terms) {
    if (term.pricingMode === "percent_outstanding_balance" && term.ratePercent != null && Number.isFinite(term.ratePercent)) {
      amount += round2(balance * term.ratePercent / 100);
    } else if (term.pricingMode === "percent_original_principal" && term.ratePercent != null && Number.isFinite(term.ratePercent) && input.originalPrincipal != null && Number.isFinite(input.originalPrincipal)) {
      amount += round2(input.originalPrincipal * term.ratePercent / 100);
    } else if (term.pricingMode === "fixed_amount" && term.fixedAmount != null && Number.isFinite(term.fixedAmount)) {
      if (term.rateBasis === "total_credit_upfront") {
        if (index === 0) amount += round2(term.fixedAmount);
      } else if (term.rateBasis === "total_credit_even") {
        const futureInstallmentCount = input.currentSchedule.filter((row) => row.dueDate > input.operationDate).length;
        amount += round2(term.fixedAmount / Math.max(1, futureInstallmentCount));
      } else if (term.rateBasis === "total_credit_unknown") {
        known = false;
      } else {
        amount += round2(term.fixedAmount);
      }
    } else {
      known = false;
    }
  }

  if (!known && !warnings.includes("El seguro futuro depende del banco; no se inventó una fórmula.")) {
    warnings.push("El seguro futuro depende del banco; no se inventó una fórmula.");
  }
  return { amount: round2(amount), known };
}

function feesForRow(futureRow: FutureRow, warnings: string[]): number {
  if (futureRow.expectedFees != null && Number.isFinite(futureRow.expectedFees)) return round2(Math.max(0, futureRow.expectedFees));
  if (!warnings.includes("Hay gastos o comisiones futuras por confirmar.")) warnings.push("Hay gastos o comisiones futuras por confirmar.");
  return 0;
}

function totalMode(input: BankPrepaymentSimulationInput): BankInstallmentTotalMode | null {
  return input.installmentTotalMode === "total_installment_including_costs" || input.installmentTotalMode === "financial_installment_plus_costs"
    ? input.installmentTotalMode
    : null;
}

function regularPaymentTarget(input: BankPrepaymentSimulationInput, row: FutureRow): number | null {
  const mode = totalMode(input);
  if (mode === "total_installment_including_costs") {
    return row.expectedAmount != null && Number.isFinite(row.expectedAmount) ? round2(row.expectedAmount) : null;
  }
  if (mode === "financial_installment_plus_costs") {
    const principal = row.expectedPrincipal;
    const interest = row.expectedInterest;
    return principal != null && interest != null && Number.isFinite(principal) && Number.isFinite(interest)
      ? round2(principal + interest)
      : null;
  }
  return null;
}

function buildRows(
  input: BankPrepaymentSimulationInput,
  futureRows: FutureRow[],
  principalAfter: number,
  paymentTarget: number,
  warnings: string[],
  preserveTerm: boolean,
): { rows: BankPrepaymentSimulationRow[]; exhausted: boolean; insuranceKnown: boolean } {
  const mode = totalMode(input)!;
  let balance = round2(principalAfter);
  let previousDate = input.operationDate;
  let insuranceKnown = true;
  const rows: BankPrepaymentSimulationRow[] = [];

  for (let index = 0; index < futureRows.length; index += 1) {
    const source = futureRows[index];
    const interestDays = daysBetween(previousDate, source.dueDate);
    const rate = effectiveRate(input, interestDays);
    if (rate == null) break;
    const interest = round2(balance * rate);
    const insuranceResult = insuranceForRow(input, balance, index, source, warnings);
    insuranceKnown = insuranceKnown && insuranceResult.known;
    const insurance = insuranceResult.amount;
    const fees = feesForRow(source, warnings);
    const targetFinancial = mode === "financial_installment_plus_costs" ? paymentTarget : paymentTarget - insurance - fees;
    const targetPrincipal = round2(Math.max(0, targetFinancial - interest));
    const principal = preserveTerm || index === futureRows.length - 1
      ? round2(Math.min(balance, index === futureRows.length - 1 ? balance : targetPrincipal))
      : round2(Math.min(balance, targetPrincipal));
    const remaining = round2(Math.max(0, balance - principal));
    const total = round2(principal + interest + insurance + fees);
    rows.push({
      installmentNumber: index + 1,
      contractualInstallmentNumber: source.contractualInstallmentNumber ?? source.installmentNumber,
      dueDate: source.dueDate,
      principal,
      interest,
      insurance,
      fees,
      total,
      remainingPrincipalBalance: remaining <= 0.01 ? 0 : remaining,
      interestDays,
    });
    balance = remaining;
    previousDate = source.dueDate;
    if (!preserveTerm && balance <= 0) break;
  }

  return { rows, exhausted: balance <= 0.01, insuranceKnown };
}

function simulateReduceInstallment(
  input: BankPrepaymentSimulationInput,
  futureRows: FutureRow[],
  principalAfter: number,
  warnings: string[],
): { rows: BankPrepaymentSimulationRow[]; paymentTarget: number; insuranceKnown: boolean } | null {
  const mode = totalMode(input)!;
  const maxKnownTotal = futureRows.reduce((sum, row) => sum + (row.expectedAmount ?? 0), 0);
  let low = 0;
  let high = Math.max(1, principalAfter + maxKnownTotal, (futureRows[0]?.expectedAmount ?? 0) * 4);

  const endingBalance = (candidate: number): number => {
    const trialWarnings: string[] = [];
    let balance = principalAfter;
    let previousDate = input.operationDate;
    for (let index = 0; index < futureRows.length; index += 1) {
      const source = futureRows[index];
      const days = daysBetween(previousDate, source.dueDate);
      const rate = effectiveRate(input, days);
      if (rate == null) return Number.POSITIVE_INFINITY;
      const interest = round2(balance * rate);
      const insurance = insuranceForRow(input, balance, index, source, trialWarnings).amount;
      const fees = feesForRow(source, trialWarnings);
      const targetFinancial = mode === "financial_installment_plus_costs" ? candidate : candidate - insurance - fees;
      const principal = round2(Math.min(balance, Math.max(0, targetFinancial - interest)));
      balance = round2(Math.max(0, balance - principal));
      previousDate = source.dueDate;
    }
    return balance;
  };

  if (!Number.isFinite(endingBalance(high))) return null;
  for (let iteration = 0; iteration < 90; iteration += 1) {
    const middle = (low + high) / 2;
    if (endingBalance(middle) <= 0.01) high = middle;
    else low = middle;
  }

  const paymentTarget = round2(high);
  const built = buildRows(input, futureRows, principalAfter, paymentTarget, warnings, true);
  return { rows: built.rows, paymentTarget, insuranceKnown: built.insuranceKnown };
}

function validateInput(input: BankPrepaymentSimulationInput): string[] {
  const warnings: string[] = [];
  if (!Number.isFinite(input.principalBeforeOperation) || input.principalBeforeOperation <= 0) warnings.push("El principal anterior a la operación no es válido.");
  if (!parseIsoDate(input.operationDate)) warnings.push("La fecha de la operación no es válida.");
  if (input.amortizationMethod && input.amortizationMethod !== "fixed_installment") warnings.push("La modalidad de amortización no es compatible con esta simulación determinística.");
  if (totalMode(input) == null) warnings.push("Falta conocer cómo se define el total de la cuota.");
  if ((input.teaPercent == null || !Number.isFinite(input.teaPercent)) && (input.periodicRatePercent == null || !Number.isFinite(input.periodicRatePercent))) warnings.push("Falta una tasa contractual utilizable.");
  if (input.teaPercent != null && input.dayCountBasis == null && input.periodicRatePercent == null) warnings.push("Falta la base de conteo de días de la tasa contractual.");
  return warnings;
}

export function simulateBankPrepayment(input: BankPrepaymentSimulationInput): BankPrepaymentSimulationResult {
  const principalBefore = round2(input.principalBeforeOperation);
  const initialWarnings = validateInput(input);
  const effect = input.effect;
  const operationDate = parseIsoDate(input.operationDate);
  const futureRows = [...input.currentSchedule]
    .filter((row) => parseIsoDate(row.dueDate) != null && row.dueDate > input.operationDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  if (initialWarnings.length > 0 || !operationDate || futureRows.length === 0) {
    if (futureRows.length === 0) initialWarnings.push("No existen suficientes fechas contractuales futuras para proyectar el cronograma.");
    return emptyResult(effect, Array.from(new Set(initialWarnings)), principalBefore);
  }

  const principalAfter = round2(Math.max(0, principalBefore - (input.principalPaid ?? 0) - (input.extraPrincipalPaid ?? 0)));
  if (!Number.isFinite(principalAfter) || principalAfter <= 0) {
    return emptyResult(effect, ["El principal posterior al prepago debe ser mayor que cero; para cancelar toda la deuda usa Liquidar deuda."], principalBefore);
  }

  const warnings: string[] = [];
  const oldRemainingInterest = futureRows.every((row) => row.expectedInterest != null && Number.isFinite(row.expectedInterest))
    ? round2(futureRows.reduce((sum, row) => sum + Number(row.expectedInterest), 0))
    : null;
  const oldRegularInstallment = futureRows[0]?.expectedAmount != null && Number.isFinite(futureRows[0].expectedAmount)
    ? round2(futureRows[0].expectedAmount)
    : null;
  const oldFinalDueDate = futureRows.at(-1)?.dueDate ?? null;

  let rows: BankPrepaymentSimulationRow[] = [];
  let newRegularInstallment: number | null = null;
  let insuranceKnown = true;

  if (effect === "reduce_term") {
    if (oldRegularInstallment == null) {
      return emptyResult(effect, ["No conocemos la cuota regular contractual para simular la reducción de plazo."], principalBefore);
    }
    const paymentTarget = regularPaymentTarget(input, futureRows[0]!);
    if (paymentTarget == null) {
      return emptyResult(effect, ["No conocemos el componente financiero de la cuota contractual para simular la reducción de plazo."], principalBefore);
    }
    const built = buildRows(input, futureRows, principalAfter, paymentTarget, warnings, false);
    rows = built.rows;
    insuranceKnown = built.insuranceKnown;
    newRegularInstallment = oldRegularInstallment;
    if (rows.length === 0 || !built.exhausted) {
      return emptyResult(effect, [...warnings, "La cuota contractual conocida no permite extinguir el principal con las fechas disponibles."], principalBefore);
    }
  } else {
    const built = simulateReduceInstallment(input, futureRows, principalAfter, warnings);
    if (!built || built.rows.length !== futureRows.length || built.rows.at(-1)?.remainingPrincipalBalance !== 0) {
      return emptyResult(effect, [...warnings, "No fue posible encontrar una cuota determinística que lleve el saldo a cero."], principalBefore);
    }
    rows = built.rows;
    insuranceKnown = built.insuranceKnown;
    newRegularInstallment = round2(rows[0]?.total ?? built.paymentTarget);
  }

  const newEstimatedInterest = insuranceKnown || rows.length > 0
    ? round2(rows.reduce((sum, row) => sum + row.interest, 0))
    : null;
  if (!insuranceKnown) warnings.push("TOTAL ESTIMADO / SEGURO POR CONFIRMAR.");
  const uniqueWarnings = Array.from(new Set(warnings));
  const canPersist = uniqueWarnings.length === 0;

  return {
    status: uniqueWarnings.length === 0 ? "calculated" : "calculated_with_warnings",
    effect,
    principalBefore,
    principalAfter,
    oldRemainingInstallments: futureRows.length,
    newRemainingInstallments: rows.length,
    oldRegularInstallment,
    newRegularInstallment,
    oldFinalDueDate,
    newFinalDueDate: rows.at(-1)?.dueDate ?? null,
    oldRemainingInterest,
    newEstimatedInterest,
    estimatedInterestSavings: oldRemainingInterest != null && newEstimatedInterest != null
      ? round2(oldRemainingInterest - newEstimatedInterest)
      : null,
    rows,
    warnings: uniqueWarnings,
    canPersist,
  };
}
