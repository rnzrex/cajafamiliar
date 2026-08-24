import type { Debt, DebtInstallment, DebtInterestCalculationMode } from "../types";
import { getCurrencySymbol } from "./debtFormMode";

export type InterestSuggestionCertainty = "exact_contract" | "exact_rate" | "tea_estimate" | "insufficient_info";

export interface AssistedInterestSuggestion {
  cashPaid: number;
  calcInterest: number;
  suggestedInterest: number;
  suggestedPrincipal: number;
  suggestedOtherCosts: number;
  principalAfterPayment: number;
  calculationSource: DebtInterestCalculationMode;
  calculationExplanation: string;
  certainty: InterestSuggestionCertainty;
  warningMessage: string | null;
}

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function parseDaysBetween(startDateStr: string, endDateStr: string): number {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  const diffTime = end.getTime() - start.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 3600 * 24));
  return Math.max(0, diffDays);
}

export function calculateAssistedInterestSuggestion(params: {
  debt: Debt;
  currentPrincipal: number;
  paymentDate: string;
  cashAmount: number;
  lastEventDate?: string | null;
  nextInstallment?: DebtInstallment | null;
}): AssistedInterestSuggestion {
  const { debt, currentPrincipal, paymentDate, cashAmount, lastEventDate, nextInstallment } = params;
  const currencySymbol = getCurrencySymbol(debt.currencyCode);
  const cashPaid = Math.max(0, round2(cashAmount));
  const principal = Math.max(0, round2(currentPrincipal));

  let calcInterest = 0;
  let calculationSource: DebtInterestCalculationMode = "unknown";
  let calculationExplanation = "";
  let certainty: InterestSuggestionCertainty = "insufficient_info";

  // Priority 1: Contractual Schedule
  if (
    (debt.interestCalculationMode === "contract_schedule" || debt.repaymentStructure === "fixed_schedule") &&
    nextInstallment &&
    nextInstallment.expectedInterest != null &&
    nextInstallment.expectedInterest >= 0
  ) {
    calcInterest = round2(nextInstallment.expectedInterest);
    calculationSource = "contract_schedule";
    certainty = "exact_contract";
    calculationExplanation = `Calculado según cuota #${nextInstallment.installmentNumber} del cronograma contractual.`;
  }
  // Priority 2: Contract Periodic Rate
  else if (
    debt.interestCalculationMode === "contract_periodic_rate" &&
    debt.periodicRatePercent != null &&
    debt.periodicRatePercent > 0
  ) {
    const basis = debt.periodicRateBasis || "monthly";
    const ratePercent = debt.periodicRatePercent;

    if (basis === "monthly") {
      calcInterest = round2(principal * (ratePercent / 100));
      calculationExplanation = `Calculado con tasa contractual de ${ratePercent}% mensual sobre el saldo pendiente.`;
    } else if (basis === "biweekly") {
      calcInterest = round2(principal * (ratePercent / 100));
      calculationExplanation = `Calculado con tasa contractual de ${ratePercent}% quincenal sobre el saldo pendiente.`;
    } else if (basis === "weekly") {
      calcInterest = round2(principal * (ratePercent / 100));
      calculationExplanation = `Calculado con tasa contractual de ${ratePercent}% semanal sobre el saldo pendiente.`;
    } else if (basis === "daily") {
      const anchorDate = lastEventDate || debt.trackingStartDate || debt.originDate || paymentDate;
      const days = Math.max(1, parseDaysBetween(anchorDate, paymentDate));
      calcInterest = round2(principal * (ratePercent / 100) * days);
      calculationExplanation = `Calculado con tasa contractual de ${ratePercent}% diaria sobre el saldo pendiente (${days} días).`;
    }
    calculationSource = "contract_periodic_rate";
    certainty = "exact_rate";
  }
  // Priority 3: TEA Estimate
  else if (
    (debt.interestCalculationMode === "tea_estimate" || (debt.teaPercent != null && debt.teaPercent > 0)) &&
    debt.interestCalculationMode !== "manual"
  ) {
    const anchorDate = lastEventDate || debt.trackingStartDate || debt.originDate || paymentDate;
    const days = parseDaysBetween(anchorDate, paymentDate);
    const effectiveDays = days > 0 ? days : 30; // default 30 days if same day or missing
    const teaDecimal = (debt.teaPercent || 0) / 100;
    const periodRate = Math.pow(1 + teaDecimal, effectiveDays / 365) - 1;
    calcInterest = round2(principal * periodRate);
    calculationSource = "tea_estimate";
    certainty = "tea_estimate";
    calculationExplanation = `Estimación calculada con TEA (${debt.teaPercent}% anual) para ${effectiveDays} días. TCEA no se utiliza para calcular el interés del pago.`;
  }
  // Priority 4: Manual / Unknown
  else {
    calcInterest = 0;
    calculationSource = "manual";
    certainty = "insufficient_info";
    calculationExplanation = "No tenemos suficiente información para calcular el interés automáticamente.";
  }

  // Waterfall logic
  let suggestedInterest = 0;
  let suggestedPrincipal = 0;
  let principalAfterPayment = principal;
  let warningMessage: string | null = null;

  if (certainty === "insufficient_info") {
    suggestedInterest = 0;
    suggestedPrincipal = cashPaid;
    principalAfterPayment = round2(Math.max(0, principal - cashPaid));
  } else if (cashPaid >= calcInterest) {
    suggestedInterest = calcInterest;
    suggestedPrincipal = round2(cashPaid - calcInterest);
    principalAfterPayment = round2(Math.max(0, principal - suggestedPrincipal));
  } else {
    // Payment is smaller than calculated interest
    suggestedInterest = cashPaid;
    suggestedPrincipal = 0;
    principalAfterPayment = principal;
    warningMessage = `El pago ingresado (${currencySymbol} ${cashPaid.toFixed(2)}) no cubre el interés calculado (${currencySymbol} ${calcInterest.toFixed(2)}).`;
  }

  return {
    cashPaid,
    calcInterest,
    suggestedInterest,
    suggestedPrincipal,
    suggestedOtherCosts: 0,
    principalAfterPayment,
    calculationSource,
    calculationExplanation,
    certainty,
    warningMessage,
  };
}
