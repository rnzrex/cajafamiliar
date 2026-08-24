import type { Debt, DebtEvent, DebtInstallment, DebtInterestCalculationMode } from "../types";
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

export interface EffectivePeriodicRateParams {
  teaPercent: number;
  frequency: "monthly" | "biweekly" | "weekly";
}

export interface EffectivePeriodicRateResult {
  rateDecimal: number;
  ratePercent: number;
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

/**
 * Pure SSOT helper to convert TEA (Tasa Efectiva Anual) to explicit periodic effective rate.
 * - Monthly (1/12): (1 + TEA)^(1/12) - 1
 * - Biweekly (14-day cycle): (1 + TEA)^(14/365) - 1
 * - Weekly (7-day cycle): (1 + TEA)^(7/365) - 1
 * Never uses nominal division TEA / 12.
 */
export function effectivePeriodicRateFromTea(params: EffectivePeriodicRateParams): EffectivePeriodicRateResult {
  const { teaPercent, frequency } = params;
  if (teaPercent == null || teaPercent <= 0) {
    return { rateDecimal: 0, ratePercent: 0 };
  }

  let rateDecimal = 0;
  if (frequency === "monthly") {
    rateDecimal = Math.pow(1 + teaPercent / 100, 1 / 12) - 1;
  } else if (frequency === "biweekly") {
    rateDecimal = Math.pow(1 + teaPercent / 100, 14 / 365) - 1;
  } else if (frequency === "weekly") {
    rateDecimal = Math.pow(1 + teaPercent / 100, 7 / 365) - 1;
  } else {
    return { rateDecimal: 0, ratePercent: 0 };
  }

  return {
    rateDecimal,
    ratePercent: rateDecimal * 100,
  };
}

export function getLastEffectiveDebtPaymentDate(
  debtEvents: DebtEvent[],
  debtId: string
): string | null {
  const debtScopedEvents = debtEvents.filter((e) => e.debtId === debtId);

  const reversedIds = new Set(
    debtScopedEvents
      .filter((e) => e.eventType === "reversal" && e.reversalOfEventId)
      .map((e) => e.reversalOfEventId!)
  );

  const effectivePaymentEvents = debtScopedEvents.filter(
    (e) =>
      !reversedIds.has(e.id) &&
      e.eventType !== "reversal" &&
      e.eventType !== "principal_adjustment" &&
      (e.eventType === "payment" ||
        e.eventType === "principal_prepayment" ||
        e.eventType === "payoff")
  );

  effectivePaymentEvents.sort((a, b) => {
    if (a.eventDate !== b.eventDate) return a.eventDate.localeCompare(b.eventDate);
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  });

  const lastEvent = effectivePaymentEvents[effectivePaymentEvents.length - 1];
  return lastEvent ? lastEvent.eventDate : null;
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

  const anchorDate = lastEventDate || debt.trackingStartDate || debt.originDate;

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
  // Priority 2: Contract Periodic Rate (Requires rate > 0)
  else if (
    debt.interestCalculationMode === "contract_periodic_rate" &&
    debt.periodicRatePercent != null &&
    debt.periodicRatePercent > 0
  ) {
    const basis = debt.periodicRateBasis || "monthly";
    const ratePercent = debt.periodicRatePercent;

    if (basis === "daily") {
      if (anchorDate && paymentDate && paymentDate > anchorDate) {
        const days = parseDaysBetween(anchorDate, paymentDate);
        if (days > 0) {
          calcInterest = round2(principal * (ratePercent / 100) * days);
          calculationSource = "contract_periodic_rate";
          certainty = "tea_estimate";
          calculationExplanation = `Estimación con tasa contractual de ${ratePercent}% diaria sobre el saldo pendiente (${days} días).`;
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
      if (!anchorDate || !paymentDate || paymentDate <= anchorDate) {
        certainty = "insufficient_info";
        calculationExplanation = "No se puede calcular estimación de interés sin un período transcurrido de días válido (la fecha de pago debe ser posterior a la fecha inicial o del último pago).";
      } else {
        const elapsedDays = parseDaysBetween(anchorDate, paymentDate);
        if (elapsedDays <= 0) {
          certainty = "insufficient_info";
          calculationExplanation = "No se puede calcular estimación de interés sin un período transcurrido de días válido (la fecha de pago debe ser posterior a la fecha inicial o del último pago).";
        } else {
          const expectedDays = basis === "monthly" ? 30 : basis === "biweekly" ? 14 : 7;
          if ((elapsedDays >= Math.floor(expectedDays * 0.7) && elapsedDays <= Math.ceil(expectedDays * 1.5)) || nextInstallment) {
            calcInterest = round2(principal * (ratePercent / 100));
            calculationSource = "contract_periodic_rate";
            certainty = "tea_estimate";
            calculationExplanation = `Estimación con tasa contractual de ${ratePercent}% ${basis === "monthly" ? "mensual" : basis === "biweekly" ? "quincenal" : "semanal"} sobre el saldo pendiente.`;
          } else {
            certainty = "insufficient_info";
            calculationExplanation = `El período transcurrido (${elapsedDays} días) no coincide con un período contractual regular (${basis}).`;
          }
        }
      }
    }
  }
  // Priority 3: TEA Estimate (requires mode === 'tea_estimate')
  else if (debt.interestCalculationMode === "tea_estimate") {
    if (debt.teaPercent == null || debt.teaPercent <= 0) {
      certainty = "insufficient_info";
      calculationExplanation = "No tenemos un porcentaje de TEA válido para proponer la estimación.";
    } else {
      const frequency = debt.paymentFrequency;
      const isExplicitContractualFrequency =
        frequency === "monthly" ||
        frequency === "biweekly" ||
        frequency === "weekly";

      if (isExplicitContractualFrequency) {
        const effectiveFreq = frequency as "monthly" | "biweekly" | "weekly";
        const { rateDecimal, ratePercent } = effectivePeriodicRateFromTea({
          teaPercent: debt.teaPercent,
          frequency: effectiveFreq,
        });

        calcInterest = round2(principal * rateDecimal);
        calculationSource = "tea_estimate";
        certainty = "tea_estimate";
        const label = effectiveFreq === "monthly" ? "TEM" : effectiveFreq === "biweekly" ? "TEQ" : "TES";
        calculationExplanation = `Calculado con ${label} ${ratePercent.toFixed(4)}% derivada de una TEA de ${debt.teaPercent}%. TCEA no se utiliza para calcular el interés.`;
      } else if (anchorDate && paymentDate && paymentDate > anchorDate) {
        const days = parseDaysBetween(anchorDate, paymentDate);
        if (days > 0) {
          const teaDecimal = debt.teaPercent / 100;
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
        calculationExplanation = "No se puede calcular estimación TEA sin un período transcurrido de días válido o una frecuencia contractual definida.";
      }
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
    suggestedInterest = 0;
    suggestedPrincipal = 0;
    principalAfterPayment = principal;
  } else if (cashPaid >= calcInterest) {
    suggestedInterest = calcInterest;
    suggestedPrincipal = round2(cashPaid - calcInterest);
    principalAfterPayment = round2(Math.max(0, principal - suggestedPrincipal));
  } else {
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
