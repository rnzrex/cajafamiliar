import { formatMoneyByCurrency } from "./calculations.js";
import type { AdvisorExtraCashScenario, AdvisorObligationWindow, FinancialAdvisorResult } from "./financialAdvisor.js";

export type FinancialAdvisorQuestionIntent =
  | "weekly_obligations"
  | "debt_cost"
  | "payoff_priority"
  | "extra_cash"
  | "prepayment"
  | "monthly_need"
  | "debt_load"
  | "changes"
  | "unsupported";

export interface ParsedFinancialAdvisorQuestion {
  rawText: string;
  normalizedText: string;
  intent: FinancialAdvisorQuestionIntent;
  amount: number | null;
  currencyCode: string | null;
}

export interface FinancialAdvisorQuestionAnswer {
  intent: FinancialAdvisorQuestionIntent;
  answer: string;
  suggestions: string[];
  scenario: AdvisorExtraCashScenario | null;
}

const QUICK_SUGGESTIONS = [
  "¿Qué tengo que pagar esta semana?",
  "¿Cuál es mi deuda más cara?",
  "¿Qué debería cancelar primero?",
  "Tengo S/ 2000 extra, ¿qué hago?",
  "¿Puedo hacer un abono a capital?",
  "¿Cuánto dinero necesito este mes?",
  "¿Estoy muy endeudado?",
];

export function normalizeFinancialAdvisorQuestion(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/$.,\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseQuestionAmount(normalizedText: string): { amount: number | null; currencyCode: string | null } {
  const match = normalizedText.match(/(us\$|usd|s\/|pen)?\s*([0-9][0-9.,]*)/);
  if (!match) return { amount: null, currencyCode: null };
  const raw = match[2].replace(/\s/g, "");
  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  let normalizedNumber = raw;
  if (hasComma && hasDot) {
    normalizedNumber = raw.lastIndexOf(",") > raw.lastIndexOf(".")
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "");
  } else if (hasComma) {
    normalizedNumber = raw.replace(",", ".");
  }
  const amount = Number(normalizedNumber);
  if (!Number.isFinite(amount)) return { amount: null, currencyCode: null };
  const marker = match[1];
  return {
    amount,
    currencyCode: marker && ["us$", "usd"].includes(marker) ? "USD" : marker ? "PEN" : null,
  };
}

export function parseFinancialAdvisorQuestion(rawText: string): ParsedFinancialAdvisorQuestion {
  const normalizedText = normalizeFinancialAdvisorQuestion(rawText);
  const { amount, currencyCode } = parseQuestionAmount(normalizedText);
  let intent: FinancialAdvisorQuestionIntent = "unsupported";
  if (normalizedText.includes("que cambio") || normalizedText.includes("cambio desde") || normalizedText.includes("semana pasada")) {
    intent = "changes";
  } else if (normalizedText.includes("extra") || normalizedText.includes("sobrante") || normalizedText.includes("dinero") && amount != null) {
    intent = "extra_cash";
  } else if (normalizedText.includes("esta semana") || normalizedText.includes("esta semana")) {
    intent = "weekly_obligations";
  } else if (normalizedText.includes("este mes") || normalizedText.includes("este mes") || normalizedText.includes("30 dias")) {
    intent = "monthly_need";
  } else if (normalizedText.includes("muy endeud") || normalizedText.includes("carga de deuda") || normalizedText.includes("deuda/ingreso")) {
    intent = "debt_load";
  } else if (normalizedText.includes("abono") || normalizedText.includes("prepago") || normalizedText.includes("capital")) {
    intent = "prepayment";
  } else if (normalizedText.includes("mas cara") || normalizedText.includes("mayor tasa") || normalizedText.includes("costo")) {
    intent = "debt_cost";
  } else if (normalizedText.includes("cancelar primero") || normalizedText.includes("pagar primero") || normalizedText.includes("prioridad")) {
    intent = "payoff_priority";
  }
  return { rawText, normalizedText, intent, amount, currencyCode };
}

function summarizeWindow(window: AdvisorObligationWindow): string {
  const parts = Object.values(window.byCurrency).map((summary) => {
    const known = formatMoneyByCurrency(summary.knownAmount, summary.currencyCode);
    const estimated = summary.estimatedAmount > 0 ? ` · estimado ${formatMoneyByCurrency(summary.estimatedAmount, summary.currencyCode)}` : "";
    const unknown = summary.unknownAmountCount > 0 ? ` · ${summary.unknownAmountCount} monto(s) por confirmar` : "";
    return `${summary.currencyCode}: conocido ${known}${estimated}${unknown}`;
  });
  return parts.length > 0 ? parts.join("; ") : "No hay obligaciones proyectadas en esa ventana.";
}

function extraCashAmount(scenario: AdvisorExtraCashScenario, amount: number): string {
  return formatMoneyByCurrency(amount, scenario.currencyCode);
}

/**
 * Uses only the already-computed extra-cash read-model. The panel and the local
 * question surface deliberately share this copy so neither surface recalculates
 * financial values independently.
 */
export function formatExtraCashAdvice(scenario: AdvisorExtraCashScenario): string {
  if (scenario.decisionStatus === "no_positive_extra") {
    return "No hay dinero adicional positivo para simular. Ingresa dinero nuevo que todavía no forme parte de tu liquidez registrada.";
  }

  const unknownCaveat = scenario.unknownObligationCount > 0
    ? " Además, todavía hay obligaciones con monto por confirmar; no trates ningún remanente como dinero libre para prepago."
    : "";

  if (scenario.shortfallAfter > 0) {
    return `Actualmente te faltan ${extraCashAmount(scenario, scenario.shortfallBefore)} para cubrir tus obligaciones conocidas. Si recibieras ${extraCashAmount(scenario, scenario.additionalCash)} adicionales, tu liquidez subiría a ${extraCashAmount(scenario, scenario.liquidityAfterAdditionalCash)} y el faltante bajaría a ${extraCashAmount(scenario, scenario.shortfallAfter)}. Recomendación: conserva esos ${extraCashAmount(scenario, scenario.additionalCash)} para tus próximos pagos. Todavía no los destines a reducción de principal.${unknownCaveat}`;
  }

  if (scenario.shortfallBefore > 0 && scenario.remainingAfterKnownRequirements === 0) {
    return `Con este dinero lograrías cubrir exactamente las obligaciones conocidas consideradas por el asesor. No queda un remanente demostrado para prepago.${unknownCaveat}`;
  }

  if (scenario.remainingAfterKnownRequirements > 0) {
    const remaining = extraCashAmount(scenario, scenario.remainingAfterKnownRequirements);
    if (scenario.decisionStatus === "unknown_requirements") {
      return `Existe un remanente potencial de ${remaining}, pero todavía hay obligaciones con monto por confirmar; no lo trates como dinero libre para prepago.`;
    }
    if (scenario.selectedDebtName && scenario.simulation && scenario.simulation.status !== "exceeds_current_principal") {
      const simulatedReduction = scenario.simulation.appliedPrincipalReduction ?? scenario.simulation.requestedPrincipalReduction;
      return `Después de cubrir tus obligaciones conocidas quedarían ${remaining} potencialmente disponibles para una decisión extraordinaria. Podrías evaluar un abono simulado de ${extraCashAmount(scenario, simulatedReduction)} a ${scenario.selectedDebtName}; es una opción a considerar, no una instrucción de pago. El ahorro exacto de intereses y el nuevo cronograma dependen del recálculo contractual del acreedor.`;
    }
    return `Después de cubrir tus obligaciones quedarían ${remaining}, pero no existe información comparable suficiente para afirmar qué deuda conviene prepagar.${unknownCaveat}`;
  }

  return `No queda un remanente demostrado después de cubrir las obligaciones conocidas.${unknownCaveat}`;
}

export function answerFinancialAdvisorQuestion(
  parsed: ParsedFinancialAdvisorQuestion,
  result: FinancialAdvisorResult,
  scenario: AdvisorExtraCashScenario | null = null
): FinancialAdvisorQuestionAnswer {
  let answer: string;
  switch (parsed.intent) {
    case "weekly_obligations":
      answer = `Para el resto de esta semana: ${summarizeWindow(result.windows.rest_of_week)}`;
      break;
    case "monthly_need":
      answer = `Para los próximos 30 días: ${summarizeWindow(result.windows.next_30_days)}`;
      break;
    case "debt_cost": {
      const winners = result.debtComparisons.filter((item) => item.recommendedDebtId);
      answer = winners.length > 0
        ? winners.map((item) => `${item.currencyCode}: ${item.explanation}`).join(" ")
        : "La comparación es parcial o no hay tasas comparables suficientes; una deuda sin tasa no se considera 0%.";
      break;
    }
    case "payoff_priority":
      answer = result.recommendations[0]
        ? `${result.recommendations[0].title}. ${result.recommendations[0].reason}`
        : "No hay una prioridad de pago demostrable con los datos actuales.";
      break;
    case "extra_cash":
      answer = scenario
        ? formatExtraCashAdvice(scenario)
        : "Indica el monto y la moneda para simular primero la reserva de obligaciones y después un posible prepago.";
      break;
    case "prepayment":
      answer = "Puedes simular un abono a capital desde el asesor. La V1 no ejecuta operaciones ni inventa ahorro exacto de intereses: el recálculo depende del acreedor.";
      break;
    case "debt_load":
      answer = result.debtLoad.activeDebtCount > 0
        ? `Hay ${result.debtLoad.activeDebtCount} deuda(s) activa(s) y ${result.debtLoad.overdueObligationCount} obligación(es) vencida(s). ${result.debtLoad.incomeRatioMessage}`
        : "No hay deudas activas registradas. No inventamos un problema financiero.";
      break;
    case "changes":
      answer = "Esta versión todavía no guarda snapshots del asesor para comparar semanas con precisión.";
      break;
    default:
      answer = "Todavía no puedo responder esa consulta con seguridad usando los datos disponibles. Prueba una de las preguntas sugeridas.";
  }
  return { intent: parsed.intent, answer, suggestions: QUICK_SUGGESTIONS, scenario };
}

export { QUICK_SUGGESTIONS };
