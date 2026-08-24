import type { AmortizationMethod, DebtPaymentFrequency } from "../types.js";
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
  termInstallments: number;
  paymentFrequency: DebtPaymentFrequency | null;
  firstDueDate: string;
  amortizationMethod: AmortizationMethod;
  creditLifeRatePercent?: number | null; // Desgravamen % over balance per period
  fixedInsuranceAmount?: number | null;  // Fixed insurance amount per period
  fixedFeesAmount?: number | null;       // Fixed fees amount per period
}

export interface DebtScheduleEstimateResult {
  rows: EstimatedInstallmentRow[];
  totalContractSum: number;
  totalPrincipal: number;
  totalInterest: number;
  totalInsurance: number;
  totalFees: number;
  financialInstallmentAmount: number; // Principal + Interest base cuota
  isEstimated: true;
}

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function addMonths(dateStr: string, months: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().split("T")[0];
}

function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split("T")[0];
}

function getNextDueDate(currentDateStr: string, frequency: DebtPaymentFrequency | null, step: number): string {
  const freq = frequency || "monthly";
  if (freq === "monthly") {
    return addMonths(currentDateStr, step);
  } else if (freq === "biweekly") {
    return addDays(currentDateStr, step * 14);
  } else if (freq === "weekly") {
    return addDays(currentDateStr, step * 7);
  }
  return addMonths(currentDateStr, step);
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
    termInstallments,
    paymentFrequency,
    firstDueDate,
    amortizationMethod,
    creditLifeRatePercent = 0,
    fixedInsuranceAmount = 0,
    fixedFeesAmount = 0,
  } = input;

  const freq = paymentFrequency || "monthly";
  const { rateDecimal } = effectivePeriodicRateFromTea({
    teaPercent: teaPercent || 0,
    frequency: freq === "custom" ? "monthly" : freq,
  });

  const n = Math.max(1, termInstallments);
  let baseFinancialInstallment = 0;

  if (amortizationMethod === "constant_principal") {
    baseFinancialInstallment = financedAmount / n;
  } else {
    // Default to French system (fixed_installment)
    baseFinancialInstallment = calculateFrenchFinancialInstallment(financedAmount, rateDecimal, n);
  }

  const rows: EstimatedInstallmentRow[] = [];
  let currentBalance = financedAmount;

  for (let i = 1; i <= n; i++) {
    const dueDate = getNextDueDate(firstDueDate, paymentFrequency, i - 1);
    const interest = round2(currentBalance * rateDecimal);

    let principal = 0;
    if (amortizationMethod === "constant_principal") {
      principal = round2(financedAmount / n);
    } else {
      principal = round2(baseFinancialInstallment - interest);
    }

    // Final installment adjustment to clear exact remaining balance
    if (i === n) {
      principal = round2(currentBalance);
    } else {
      principal = Math.min(principal, currentBalance);
    }

    // Desgravamen insurance calculated on remaining balance before this payment
    const desgravamenAmount = creditLifeRatePercent && creditLifeRatePercent > 0
      ? round2(currentBalance * (creditLifeRatePercent / 100))
      : 0;

    const insurance = round2(desgravamenAmount + (fixedInsuranceAmount || 0));
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

  return {
    rows,
    totalContractSum,
    totalPrincipal,
    totalInterest,
    totalInsurance,
    totalFees,
    financialInstallmentAmount: round2(baseFinancialInstallment),
    isEstimated: true,
  };
}
