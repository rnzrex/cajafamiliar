import type { AmortizationMethod, DebtInsuranceRateBasis, DebtPaymentFrequency, PeriodicRateBasis } from "../types.js";
import { effectivePeriodicRateFromTea } from "./debtInterestEngine.js";

export interface EstimatedInstallmentRow {
  installmentNumber: number;
  dueDate: string;
  expectedAmount: number;
  expectedPrincipal: number;
  expectedInterest: number;
  expectedInsurance: number;
  expectedFees: number;
  remainingPrincipalBalance: number;
}

export interface DebtScheduleEstimateInput {
  financedAmount: number;
  teaPercent: number | null;
  periodicRatePercent?: number | null;
  periodicRateBasis?: PeriodicRateBasis | null;
  termInstallments: number;
  paymentFrequency: DebtPaymentFrequency | null;
  customFrequencyDays?: number | null;
  firstDueDate: string;
  amortizationMethod: AmortizationMethod;
  gracePeriodType?: "none" | "total" | "partial";
  gracePeriodInstallments?: number | null;
  balloonPaymentAmount?: number | null;
  creditLifeRatePercent?: number | null; // Desgravamen % over balance per period
  fixedInsuranceAmount?: number | null;  // Fixed insurance amount per period (legacy/default)
  fixedInsuranceTotalAmount?: number | null; // Fixed insurance amount for the whole credit
  fixedInsuranceRateBasis?: DebtInsuranceRateBasis | null;
  /** Explicit mixed-insurance buckets. These take precedence over the legacy single-basis fields. */
  fixedInsurancePerInstallmentAmount?: number | null;
  fixedInsuranceTotalEvenAmount?: number | null;
  fixedInsuranceTotalUpfrontAmount?: number | null;
  fixedInsuranceTotalUnknownAmount?: number | null;
  percentOriginalPrincipalRatePercent?: number | null;
  fixedFeesAmount?: number | null;       // Fixed fees amount per period
  installmentsPaidBeforeTracking?: number | null;
}

export interface DebtScheduleEstimateResult {
  rows: EstimatedInstallmentRow[];
  totalContractSum: number;
  totalPrincipal: number;
  totalInterest: number;
  totalInsurance: number;
  totalFees: number;
  financialInstallmentAmount: number; // Principal + Interest base cuota
  installmentAmountMode: "fixed" | "variable";
  remainingPrincipalBalanceAfterPaidBeforeTracking: number | null;
  undistributedInsuranceTotal: number;
  hasUnknownInsuranceDistribution: boolean;
  isEstimated: true;
}

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function addMonthsClamped(dateStr: string, months: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const targetDate = new Date(Date.UTC(year, month - 1 + months, 1));
  const targetYear = targetDate.getUTCFullYear();
  const targetMonth = targetDate.getUTCMonth();
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);

  const finalYear = targetYear.toString().padStart(4, "0");
  const finalMonth = (targetMonth + 1).toString().padStart(2, "0");
  const finalDay = clampedDay.toString().padStart(2, "0");

  return `${finalYear}-${finalMonth}-${finalDay}`;
}

export function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split("T")[0];
}

export function getNextDueDate(
  firstDueDateStr: string,
  frequency: DebtPaymentFrequency | null,
  stepIndex: number,
  customFrequencyDays?: number | null
): string {
  if (stepIndex === 0) return firstDueDateStr;
  const freq = frequency || "monthly";

  if (freq === "monthly") {
    return addMonthsClamped(firstDueDateStr, stepIndex);
  } else if (freq === "biweekly") {
    return addDays(firstDueDateStr, stepIndex * 14);
  } else if (freq === "weekly") {
    return addDays(firstDueDateStr, stepIndex * 7);
  } else if (freq === "custom") {
    if (customFrequencyDays == null || customFrequencyDays <= 0) {
      throw new Error("La frecuencia personalizada requiere indicar los días entre pagos.");
    }
    return addDays(firstDueDateStr, stepIndex * customFrequencyDays);
  }
  return addMonthsClamped(firstDueDateStr, stepIndex);
}

export function calculateFrenchFinancialInstallment(
  principal: number,
  periodicRateDecimal: number,
  n: number
): number {
  if (n <= 0) return 0;
  if (periodicRateDecimal <= 0) return principal / n;

  const r = periodicRateDecimal;
  const factor = Math.pow(1 + r, n);
  const payment = (principal * r * factor) / (factor - 1);
  return payment;
}

export function generateEstimatedDebtSchedule(
  input: DebtScheduleEstimateInput
): DebtScheduleEstimateResult {
  const {
    financedAmount,
    teaPercent,
    periodicRatePercent = null,
    periodicRateBasis = null,
    termInstallments,
    paymentFrequency,
    customFrequencyDays,
    firstDueDate,
    amortizationMethod,
    gracePeriodType = "none",
    balloonPaymentAmount = 0,
    creditLifeRatePercent = 0,
    fixedInsuranceAmount = 0,
    fixedInsuranceTotalAmount = 0,
    fixedInsuranceRateBasis = "per_installment",
    fixedInsurancePerInstallmentAmount = null,
    fixedInsuranceTotalEvenAmount = null,
    fixedInsuranceTotalUpfrontAmount = null,
    fixedInsuranceTotalUnknownAmount = null,
    percentOriginalPrincipalRatePercent = 0,
    fixedFeesAmount = 0,
    installmentsPaidBeforeTracking = 0,
  } = input;

  if (!Number.isFinite(financedAmount) || financedAmount <= 0) {
    throw new Error("El monto financiado debe ser mayor a cero.");
  }
  if ((!Number.isFinite(teaPercent) || teaPercent == null || teaPercent < 0) && !(periodicRatePercent != null && Number.isFinite(periodicRatePercent) && periodicRatePercent >= 0)) {
    throw new Error("La TEA o la tasa periódica contractual debe ser un porcentaje válido.");
  }
  if (!Number.isInteger(termInstallments) || termInstallments <= 0) {
    throw new Error("El plazo debe ser un número de cuotas mayor a cero.");
  }
  if (installmentsPaidBeforeTracking != null && (!Number.isInteger(installmentsPaidBeforeTracking) || installmentsPaidBeforeTracking < 0 || installmentsPaidBeforeTracking > termInstallments)) {
    throw new Error("Las cuotas pagadas antes de empezar el seguimiento deben estar entre 0 y el plazo total.");
  }
  const mixedInsuranceAmounts = [
    fixedInsurancePerInstallmentAmount,
    fixedInsuranceTotalEvenAmount,
    fixedInsuranceTotalUpfrontAmount,
    fixedInsuranceTotalUnknownAmount,
  ];
  if (![fixedInsuranceAmount, fixedInsuranceTotalAmount, ...mixedInsuranceAmounts].every((amount) => amount == null || (Number.isFinite(amount) && amount >= 0))) {
    throw new Error("Los importes del seguro deben ser números no negativos.");
  }
  const hasExplicitMixedInsurance = mixedInsuranceAmounts.some((amount) => amount != null);
  if (!hasExplicitMixedInsurance && fixedInsuranceTotalAmount && fixedInsuranceRateBasis === "per_installment") {
    throw new Error("El seguro total requiere indicar cómo se distribuye.");
  }
  if (!paymentFrequency) {
    throw new Error("La frecuencia de pago es obligatoria para estimar el cronograma.");
  }
  if (!firstDueDate) {
    throw new Error("La primera fecha de vencimiento es obligatoria para estimar el cronograma.");
  }
  if (paymentFrequency === "custom" && (!customFrequencyDays || customFrequencyDays <= 0)) {
    throw new Error("La frecuencia personalizada requiere indicar los días entre pagos.");
  }

  if (amortizationMethod !== "fixed_installment" && amortizationMethod !== "constant_principal") {
    throw new Error("No es posible estimar esta modalidad con seguridad. Ingresa el cronograma de la entidad.");
  }

  if (gracePeriodType !== "none" || (balloonPaymentAmount && balloonPaymentAmount > 0)) {
    throw new Error("No es posible estimar deudas con periodo de gracia o cuota balloon de forma automática. Ingresa el cronograma de la entidad.");
  }

  const freq = paymentFrequency;
  const rateDecimal = periodicRatePercent != null && Number.isFinite(periodicRatePercent) && periodicRatePercent > 0 && periodicRateBasis
    ? effectivePeriodicRateFromPeriodicRate({ periodicRatePercent, periodicRateBasis, frequency: freq, customFrequencyDays })
    : effectivePeriodicRateFromTea({
        teaPercent: teaPercent ?? 0,
        frequency: freq,
        customFrequencyDays,
        yearBasis: 365,
      }).rateDecimal;

  const n = termInstallments;
  let baseFinancialInstallment = 0;

  if (amortizationMethod === "constant_principal") {
    baseFinancialInstallment = financedAmount / n;
  } else {
    baseFinancialInstallment = calculateFrenchFinancialInstallment(financedAmount, rateDecimal, n);
  }

  const rows: EstimatedInstallmentRow[] = [];
  let currentBalance = financedAmount;
  const fixedPerInstallment = round2(hasExplicitMixedInsurance
    ? fixedInsurancePerInstallmentAmount || 0
    : fixedInsuranceRateBasis === "per_installment" ? fixedInsuranceAmount || 0 : 0);
  const fixedTotalEven = round2(hasExplicitMixedInsurance
    ? fixedInsuranceTotalEvenAmount || 0
    : fixedInsuranceRateBasis === "total_credit_even" ? fixedInsuranceTotalAmount || 0 : 0);
  const fixedTotalUpfront = round2(hasExplicitMixedInsurance
    ? fixedInsuranceTotalUpfrontAmount || 0
    : fixedInsuranceRateBasis === "total_credit_upfront" ? fixedInsuranceTotalAmount || 0 : 0);
  const fixedTotalUnknown = round2(hasExplicitMixedInsurance
    ? fixedInsuranceTotalUnknownAmount || 0
    : fixedInsuranceRateBasis === "total_credit_unknown" ? fixedInsuranceTotalAmount || 0 : 0);
  const distributedEvenInsurance = distributeEvenInsurance(fixedTotalEven, n);
  const distributedUpfrontInsurance = Array.from({ length: n }, (_, index) => index === 0 ? fixedTotalUpfront : 0);
  const hasUnknownInsuranceDistribution = fixedTotalUnknown > 0;

  for (let i = 1; i <= n; i++) {
    const dueDate = getNextDueDate(firstDueDate, paymentFrequency, i - 1, customFrequencyDays);
    const interest = round2(currentBalance * rateDecimal);

    let principal = 0;
    if (amortizationMethod === "constant_principal") {
      principal = round2(financedAmount / n);
    } else {
      principal = round2(baseFinancialInstallment - interest);
    }

    if (i === n) {
      principal = round2(currentBalance);
    } else {
      principal = Math.min(principal, currentBalance);
    }

    const desgravamenAmount = creditLifeRatePercent && creditLifeRatePercent > 0
      ? round2(currentBalance * (creditLifeRatePercent / 100))
      : 0;

    const originalPrincipalInsurance = percentOriginalPrincipalRatePercent && percentOriginalPrincipalRatePercent > 0
      ? round2(financedAmount * (percentOriginalPrincipalRatePercent / 100))
      : 0;
    const totalInsuranceForRow = fixedPerInstallment + distributedEvenInsurance[i - 1] + distributedUpfrontInsurance[i - 1];
    const insurance = round2(desgravamenAmount + originalPrincipalInsurance + totalInsuranceForRow);
    const fees = round2(fixedFeesAmount || 0);
    const expectedAmount = round2(principal + interest + insurance + fees);

    currentBalance = round2(Math.max(0, currentBalance - principal));

    rows.push({
      installmentNumber: i,
      dueDate,
      expectedAmount,
      expectedPrincipal: principal,
      expectedInterest: interest,
      expectedInsurance: insurance,
      expectedFees: fees,
      remainingPrincipalBalance: currentBalance,
    });
  }

  const totalContractSum = round2(rows.reduce((s, r) => s + r.expectedAmount, 0));
  const totalPrincipal = round2(rows.reduce((s, r) => s + r.expectedPrincipal, 0));
  const totalInterest = round2(rows.reduce((s, r) => s + r.expectedInterest, 0));
  const totalInsurance = round2(rows.reduce((s, r) => s + r.expectedInsurance, 0));
  const totalFees = round2(rows.reduce((s, r) => s + r.expectedFees, 0));
  const installmentAmountMode = rows.every((row) => Math.abs(row.expectedAmount - rows[0].expectedAmount) <= 0.01)
    ? "fixed"
    : "variable";
  const paidBefore = installmentsPaidBeforeTracking;
  const remainingPrincipalBalanceAfterPaidBeforeTracking = paidBefore == null
    ? null
    : paidBefore === 0
      ? round2(financedAmount)
      : rows[paidBefore - 1]?.remainingPrincipalBalance ?? null;
  const undistributedInsuranceTotal = fixedTotalUnknown;

  return {
    rows,
    totalContractSum,
    totalPrincipal,
    totalInterest,
    totalInsurance,
    totalFees,
    financialInstallmentAmount: round2(baseFinancialInstallment),
    installmentAmountMode,
    remainingPrincipalBalanceAfterPaidBeforeTracking,
    undistributedInsuranceTotal,
    hasUnknownInsuranceDistribution,
    isEstimated: true,
  };
}

function distributeEvenInsurance(total: number, installments: number): number[] {
  if (total <= 0 || installments <= 0) return Array.from({ length: Math.max(0, installments) }, () => 0);
  const regularAmount = round2(total / installments);
  const amounts = Array.from({ length: installments }, () => regularAmount);
  const priorTotal = amounts.slice(0, -1).reduce((sum, amount) => sum + amount, 0);
  amounts[installments - 1] = round2(total - priorTotal);
  return amounts;
}

function effectivePeriodicRateFromPeriodicRate(params: {
  periodicRatePercent: number;
  periodicRateBasis: PeriodicRateBasis;
  frequency: DebtPaymentFrequency;
  customFrequencyDays?: number | null;
}): number {
  const daysForFrequency = params.frequency === "monthly" ? 30 : params.frequency === "biweekly" ? 14 : params.frequency === "weekly" ? 7 : params.customFrequencyDays ?? 30;
  const basisDays = params.periodicRateBasis === "monthly" ? 30 : params.periodicRateBasis === "biweekly" ? 14 : params.periodicRateBasis === "weekly" ? 7 : 1;
  const baseRate = params.periodicRatePercent / 100;
  if (basisDays === daysForFrequency) return baseRate;
  return Math.pow(1 + baseRate, daysForFrequency / basisDays) - 1;
}
