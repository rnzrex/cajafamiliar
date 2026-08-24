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
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
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
    const anchorDate = debt.interestAccrualAnchorDate || lastEventDate || debt.trackingStartDate || debt.originDate;

    if (basis === "daily") {
      if (anchorDate && paymentDate && paymentDate > anchorDate) {
        const days = parseDaysBetween(anchorDate, paymentDate);
        if (days > 0) {
          calcInterest = round2(principal * (ratePercent / 100) * days);
          calculationSource = "contract_periodic_rate";
          certainty = "exact_rate";
          calculationExplanation = `Calculado con tasa contractual de ${ratePercent}% diaria sobre el saldo pendiente (${days} días).`;
        } else {
          certainty = "insufficient_info";
          calculationExplanation = "No se puede calcular el período para tasa diaria sin fecha anterior válida.";
        }
      } else {
        certainty = "insufficient_info";
        calculationExplanation = "No se puede calcular el período para tasa diaria sin fecha anterior válida.";
      }
    } else {
      // Monthly, biweekly, weekly
      const expectedDays = basis === "monthly" ? 30 : basis === "biweekly" ? 14 : 7;
      const elapsedDays = anchorDate && paymentDate && paymentDate > anchorDate ? parseDaysBetween(anchorDate, paymentDate) : null;

      if (elapsedDays === null || (elapsedDays >= Math.floor(expectedDays * 0.7) && elapsedDays <= Math.ceil(expectedDays * 1.5)) || nextInstallment) {
        calcInterest = round2(principal * (ratePercent / 100));
        calculationSource = "contract_periodic_rate";
        certainty = "exact_rate";
        calculationExplanation = `Calculado con tasa contractual de ${ratePercent}% ${basis === "monthly" ? "mensual" : basis === "biweekly" ? "quincenal" : "semanal"} sobre el saldo pendiente.`;
      } else {
        // Irregular or ambiguous elapsed period -> downgrade to insufficient_info
        certainty = "insufficient_info";
        calculationExplanation = `El período transcurrido (${elapsedDays} días) no coincide con un período contractual regular (${basis}).`;
      }
    }
  }
  // Priority 3: TEA Estimate (requires explicit known elapsed days > 0)
  else if (
    (debt.interestCalculationMode === "tea_estimate" || (debt.teaPercent != null && debt.teaPercent > 0)) &&
    debt.interestCalculationMode !== "manual"
  ) {
    const anchorDate = debt.interestAccrualAnchorDate || lastEventDate || debt.trackingStartDate || debt.originDate;
    if (anchorDate && paymentDate && paymentDate > anchorDate) {
      const days = parseDaysBetween(anchorDate, paymentDate);
      if (days > 0) {
        const teaDecimal = (debt.teaPercent || 0) / 100;
        const periodRate = Math.pow(1 + teaDecimal, days / 365) - 1;
        calcInterest = round2(principal * periodRate);
        calculationSource = "tea_estimate";
        certainty = "tea_estimate";
        calculationExplanation = `Estimación calculada con TEA (${debt.teaPercent}% anual) para ${days} días. TCEA no se utiliza para calcular el interés del pago.`;
      } else {
        certainty = "insufficient_info";
        calculationExplanation = "No se puede calcular estimación TEA sin un período transcurrido de días válido.";
      }
    } else {
      certainty = "insufficient_info";
      calculationExplanation = "No se puede calcular estimación TEA sin un período transcurrido de días válido.";
    }
  }
  // Priority 4: Manual / Unknown / Insufficient Info
  else {
    calcInterest = 0;
    calculationSource = "manual";
    certainty = "insufficient_info";
    calculationExplanation = "No tenemos suficiente información contractual para proponer una distribución de interés y capital.";
  }

  // Waterfall logic
  let suggestedInterest = 0;
  let suggestedPrincipal = 0;
  let principalAfterPayment = principal;
  let warningMessage: string | null = null;

  if (certainty === "insufficient_info") {
    // REQUIREMENT 4: NEVER FABRICATE PRINCIPAL WHEN INTEREST IS UNKNOWN
    suggestedInterest = 0;
    suggestedPrincipal = 0;
    principalAfterPayment = principal;
  } else if (cashPaid >= calcInterest) {
    suggestedInterest = calcInterest;
    suggestedPrincipal = round2(cashPaid - calcInterest);
    principalAfterPayment = round2(Math.max(0, principal - suggestedPrincipal));
  } else {
    // Underpaid interest: payment does not cover calculated interest
    suggestedInterest = cashPaid;
    suggestedPrincipal = 0;
    principalAfterPayment = principal;
    warningMessage = `El pago ingresado (${currencySymbol} ${cashPaid.toFixed(2)}) no cubre el interés calculado (${currencySymbol} ${calcInterest.toFixed(2)}). El capital no se reduce.`;
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
