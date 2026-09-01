import type {
  CreditCardEntry,
  CreditCardProfile,
  CreditCardStatement,
  Debt,
  DebtEvent,
  FinancialAccount,
  Movement,
} from "../types.js";
import { expectedAccountBalance, getActiveCashAccount } from "./accountHelpers.js";
import {
  buildCreditCardIntelligenceItem,
  type CreditCardIntelligenceAdapterItem,
} from "./creditCardCalculations.js";
import { expectedCash, formatMoneyByCurrency } from "./calculations.js";
import type { DebtIntelligenceItem } from "./debtIntelligence.js";
import type { DebtInstallmentPlanningItem } from "./debtPlanning.js";
import type { DebtStrategyResult } from "./debtStrategy.js";
import { simulateDebtPrincipalPrepayment, type DebtPrepaymentSimulation } from "./debtSimulation.js";
import type {
  ObligationProjectionItem,
  ObligationProjectionResult,
  ProjectionAmountKind,
} from "./obligationProjection.js";
import { formatLocalDate, localDateString, parseLocalDate } from "./date.js";

export type AdvisorDataQualityStatus = "complete" | "partial" | "insufficient";
export type AdvisorRecommendationType =
  | "URGENT_PAYMENT"
  | "RESERVE_CASH"
  | "CARD_STATEMENT_DUE"
  | "KEEP_LIQUIDITY"
  | "PRIORITIZE_DEBT"
  | "CONSIDER_PREPAYMENT"
  | "DATA_GAP";

export type AdvisorRecommendationPriorityClass =
  | "overdue"
  | "due_today"
  | "immediate"
  | "card_statement"
  | "strategy"
  | "data_gap";

export type AdvisorWindowKey =
  | "overdue"
  | "today"
  | "next_7_days"
  | "rest_of_week"
  | "next_30_days"
  | "next_90_days";

export interface AdvisorEvidence {
  code: string;
  label: string;
  source: string;
}

export interface AdvisorDataQuality {
  status: AdvisorDataQualityStatus;
  missingDataCount: number;
  messages: string[];
  reasonCodes: string[];
}

export interface AdvisorLiquiditySummary {
  currencyCode: string;
  knownAmount: number;
  accountCount: number;
  unknownAccountCount: number;
  balanceStatus: "known" | "partial" | "unknown";
}

export interface AdvisorAmountSummary {
  currencyCode: string;
  knownAmount: number;
  estimatedAmount: number;
  unknownAmountCount: number;
  obligationCount: number;
}

export interface AdvisorObligationWindow {
  key: AdvisorWindowKey;
  label: string;
  byCurrency: Record<string, AdvisorAmountSummary>;
  items: ObligationProjectionItem[];
  cardStatements: AdvisorCardStatement[];
}

export interface AdvisorReserveRequirement {
  currencyCode: string;
  ordinaryKnownAmount: number;
  ordinaryEstimatedAmount: number;
  ordinaryUnknownCount: number;
  cardKnownAmount: number;
  cardUnknownCount: number;
  requiredKnownAmount: number;
}

export interface AdvisorCoverageSummary {
  currencyCode: string;
  liquidityKnownAmount: number;
  requiredKnownAmount: number;
  unknownAmountCount: number;
  shortfallKnownAmount: number;
  coverageStatus: "covered" | "shortfall" | "unknown";
}

export interface AdvisorRecommendation {
  id: string;
  priority: number;
  priorityClass: AdvisorRecommendationPriorityClass;
  type: AdvisorRecommendationType;
  title: string;
  reason: string;
  currencyCode: string | null;
  amount: number | null;
  dueDate: string | null;
  debtId: string | null;
  cardId: string | null;
  paymentId: string | null;
  confidence: AdvisorDataQualityStatus;
  evidence: AdvisorEvidence[];
}

export interface AdvisorDebtPriority {
  debtId: string;
  debtName: string;
  creditorName: string;
  currencyCode: string;
  currentPrincipal: number;
  rateBasis: "tcea" | "tea" | "unknown";
  ratePercent: number | null;
  urgencyRank: number | null;
  avalancheRank: number | null;
  snowballRank: number | null;
  cashFlowReliefRank: number | null;
  nextDueDate: string | null;
  nextDueAmount: number | null;
}

export interface AdvisorDebtComparison {
  currencyCode: string;
  mode: "tcea_full" | "tea_full" | "partial" | "unavailable";
  recommendedDebtId: string | null;
  tceaDebtIds: string[];
  teaDebtIds: string[];
  unknownRateDebtIds: string[];
  explanation: string;
}

export interface AdvisorCardStatement {
  cardId: string;
  cardName: string;
  creditorName: string;
  currencyCode: string;
  currentBalance: number;
  statementId: string | null;
  statementBalance: number | null;
  minimumPaymentAmount: number | null;
  dueDate: string | null;
  daysUntilDue: number | null;
  coverageStatus: CreditCardIntelligenceAdapterItem["coverageStatus"];
  actionable: boolean;
}

export interface AdvisorDebtLoadSummary {
  activeDebtCount: number;
  overdueObligationCount: number;
  byCurrency: Record<string, {
    currencyCode: string;
    activeDebtCount: number;
    currentPrincipal: number;
    knownNextObligationAmount: number;
    unknownNextObligationCount: number;
    liquidityCommittedPercent: number | null;
  }>;
  incomeRatioStatus: "not_calculated";
  incomeRatioMessage: string;
}

export type AdvisorExtraCashDecisionStatus =
  | "cover_shortfall_first"
  | "potential_extra_available"
  | "no_positive_extra"
  | "unknown_requirements";

export interface AdvisorExtraCashScenario {
  /** New money that is not included in the current liquidity read-model. */
  additionalCash: number;
  currentLiquidity: number;
  liquidityAfterAdditionalCash: number;
  knownReserveRequirement: number;
  shortfallBefore: number;
  shortfallAfter: number;
  reservedFromAdditionalCash: number;
  remainingAfterKnownRequirements: number;
  decisionStatus: AdvisorExtraCashDecisionStatus;
  amount: number;
  currencyCode: string;
  /** @deprecated Use reservedFromAdditionalCash. */
  reservedForObligations: number;
  /** @deprecated Use remainingAfterKnownRequirements. */
  availableForDecision: number;
  /** @deprecated Use shortfallBefore. */
  uncoveredObligationAmount: number;
  unknownObligationCount: number;
  selectedDebtId: string | null;
  selectedDebtName: string | null;
  selectedDebtComparisonReason: string | null;
  comparisonMode: AdvisorDebtComparison["mode"] | null;
  simulation: DebtPrepaymentSimulation | null;
  warnings: string[];
}

export interface FinancialAdvisorSnapshot {
  todayKey?: string;
  initialBalance?: number | null;
  financialAccounts: FinancialAccount[];
  movements: Movement[];
  debts: Debt[];
  debtEvents: DebtEvent[];
  debtPlanningItems: DebtInstallmentPlanningItem[];
  debtIntelligenceItems: DebtIntelligenceItem[];
  debtStrategies: DebtStrategyResult;
  obligationProjection: ObligationProjectionResult;
  creditCardProfiles: CreditCardProfile[];
  creditCardEntries: CreditCardEntry[];
  creditCardStatements: CreditCardStatement[];
}

export interface FinancialAdvisorResult {
  todayKey: string;
  dataQuality: AdvisorDataQuality;
  liquidityByCurrency: Record<string, AdvisorLiquiditySummary>;
  windows: Record<AdvisorWindowKey, AdvisorObligationWindow>;
  coverageByCurrency: Record<string, AdvisorCoverageSummary>;
  reserveRequirementsByCurrency: Record<string, AdvisorReserveRequirement>;
  recommendations: AdvisorRecommendation[];
  debtPriorities: AdvisorDebtPriority[];
  debtComparisons: AdvisorDebtComparison[];
  cardStatements: AdvisorCardStatement[];
  debtLoad: AdvisorDebtLoadSummary;
  extraCash: AdvisorExtraCashScenario | null;
  /** Pure read-model inputs used by simulateFinancialAdvisorExtraCash. */
  extraCashDebtItems: DebtIntelligenceItem[];
}

const WINDOW_LABELS: Record<AdvisorWindowKey, string> = {
  overdue: "Vencidas",
  today: "Hoy",
  next_7_days: "Próximos 7 días",
  rest_of_week: "Resto de esta semana",
  next_30_days: "Próximos 30 días",
  next_90_days: "Próximos 90 días",
};

const EMPTY_AMOUNT = (currencyCode: string): AdvisorAmountSummary => ({
  currencyCode,
  knownAmount: 0,
  estimatedAmount: 0,
  unknownAmountCount: 0,
  obligationCount: 0,
});

function currencyOf(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase();
  return code ? code : null;
}

function finiteAmount(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function validDateKey(value: string | null | undefined): value is string {
  return Boolean(value && parseLocalDate(value));
}

function addDaysKey(todayKey: string, days: number): string | null {
  const today = parseLocalDate(todayKey);
  if (!today) return null;
  return new Date(today.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function endOfWeekKey(todayKey: string): string | null {
  const today = parseLocalDate(todayKey);
  if (!today) return null;
  return addDaysKey(todayKey, 7 - today.getUTCDay());
}

function addProjectionAmount(summary: AdvisorAmountSummary, amount: number | null, amountKind: ProjectionAmountKind) {
  summary.obligationCount++;
  if (amountKind === "known" && finiteAmount(amount)) {
    summary.knownAmount += amount;
  } else if (amountKind === "estimated" && finiteAmount(amount)) {
    summary.estimatedAmount += amount;
  } else {
    summary.unknownAmountCount++;
  }
}

function buildWindow(
  key: AdvisorWindowKey,
  items: ObligationProjectionItem[],
  cardStatements: AdvisorCardStatement[]
): AdvisorObligationWindow {
  const byCurrency: Record<string, AdvisorAmountSummary> = {};
  for (const item of items) {
    const currencyCode = currencyOf(item.currencyCode) ?? "UNKNOWN";
    const summary = byCurrency[currencyCode] ?? (byCurrency[currencyCode] = EMPTY_AMOUNT(currencyCode));
    addProjectionAmount(summary, item.amount, item.amountKind);
  }
  for (const card of cardStatements) {
    const currencyCode = currencyOf(card.currencyCode) ?? "UNKNOWN";
    const summary = byCurrency[currencyCode] ?? (byCurrency[currencyCode] = EMPTY_AMOUNT(currencyCode));
    if (card.coverageStatus === "known_unsettled" && card.actionable && finiteAmount(card.statementBalance)) {
      addProjectionAmount(summary, card.statementBalance, "known");
    } else {
      addProjectionAmount(summary, null, "unknown");
    }
  }
  return { key, label: WINDOW_LABELS[key], byCurrency, items, cardStatements };
}

function projectionItemsForWindows(projection: ObligationProjectionResult, todayKey: string) {
  const allOverdue = [...projection.overduePriorItems, ...projection.items.filter((item) => item.dueStatus === "overdue")];
  const seen = new Set<string>();
  const uniqueOverdue = allOverdue.filter((item) => !seen.has(item.id) && seen.add(item.id));
  const todayEnd = addDaysKey(todayKey, 0);
  const next7End = addDaysKey(todayKey, 7);
  const weekEnd = endOfWeekKey(todayKey);
  const next30End = addDaysKey(todayKey, 30);
  const next90End = addDaysKey(todayKey, 90);
  const future = projection.items.filter((item) => item.dueStatus !== "overdue" && validDateKey(item.dueDate));
  const between = (start: string, end: string | null) => future.filter((item) => Boolean(end && item.dueDate && item.dueDate >= start && item.dueDate <= end));

  return {
    overdue: uniqueOverdue,
    today: between(todayKey, todayEnd),
    next_7_days: between(addDaysKey(todayKey, 1) ?? todayKey, next7End),
    rest_of_week: between(todayKey, weekEnd),
    next_30_days: between(addDaysKey(todayKey, 1) ?? todayKey, next30End),
    next_90_days: between(addDaysKey(todayKey, 1) ?? todayKey, next90End),
  } satisfies Record<AdvisorWindowKey, ObligationProjectionItem[]>;
}

function cardDateBelongsToWindow(card: AdvisorCardStatement, key: AdvisorWindowKey, todayKey: string): boolean {
  if (!card.dueDate || !validDateKey(card.dueDate)) return false;
  const tomorrowKey = addDaysKey(todayKey, 1);
  const next7End = addDaysKey(todayKey, 7);
  const weekEnd = endOfWeekKey(todayKey);
  const next30End = addDaysKey(todayKey, 30);
  const next90End = addDaysKey(todayKey, 90);
  if (key === "overdue") return card.dueDate < todayKey;
  if (key === "today") return card.dueDate === todayKey;
  if (key === "next_7_days") return Boolean(tomorrowKey && next7End && card.dueDate >= tomorrowKey && card.dueDate <= next7End);
  if (key === "rest_of_week") return Boolean(card.dueDate >= todayKey && weekEnd && card.dueDate <= weekEnd);
  if (key === "next_30_days") return Boolean(tomorrowKey && next30End && card.dueDate >= tomorrowKey && card.dueDate <= next30End);
  return Boolean(tomorrowKey && next90End && card.dueDate >= tomorrowKey && card.dueDate <= next90End);
}

function cardsForWindow(cards: AdvisorCardStatement[], key: AdvisorWindowKey, todayKey: string): AdvisorCardStatement[] {
  return cards.filter((card) => card.statementBalance != null && card.statementBalance > 0 && cardDateBelongsToWindow(card, key, todayKey));
}

function buildLiquidity(snapshot: FinancialAdvisorSnapshot): {
  liquidityByCurrency: Record<string, AdvisorLiquiditySummary>;
  unknownCurrencyCount: number;
} {
  const byCurrency: Record<string, AdvisorLiquiditySummary> = {};
  let unknownCurrencyCount = 0;
  const activeAccounts = snapshot.financialAccounts.filter((account) => account.isActive);
  const primaryCashAccount = getActiveCashAccount(snapshot.financialAccounts);

  const add = (currencyCode: string | null, amount: number | null, known: boolean) => {
    if (!currencyCode) {
      unknownCurrencyCount++;
      return;
    }
    const current = byCurrency[currencyCode] ?? (byCurrency[currencyCode] = {
      currencyCode,
      knownAmount: 0,
      accountCount: 0,
      unknownAccountCount: 0,
      balanceStatus: "known",
    });
    current.accountCount++;
    if (known && finiteAmount(amount)) current.knownAmount += amount;
    else {
      current.unknownAccountCount++;
      current.balanceStatus = current.knownAmount > 0 ? "partial" : "unknown";
    }
  };

  for (const account of activeAccounts) {
    const currencyCode = currencyOf(account.currencyCode);
    if (!currencyCode || !finiteAmount(account.openingBalance)) {
      add(currencyCode, null, false);
      continue;
    }
    const amount = account.reconciliationType === "cash" && account.id === primaryCashAccount?.id
      ? expectedCash(snapshot.movements, account.openingBalance, account.id, snapshot.creditCardEntries)
      : expectedAccountBalance(snapshot.movements, account.id, account.openingBalance, snapshot.creditCardEntries);
    add(currencyCode, amount, finiteAmount(amount));
  }

  if (activeAccounts.length === 0) {
    const fallback = snapshot.initialBalance;
    const amount = finiteAmount(fallback)
      ? expectedCash(snapshot.movements, fallback, null, snapshot.creditCardEntries)
      : null;
    add("PEN", amount, finiteAmount(amount));
  }

  return { liquidityByCurrency: byCurrency, unknownCurrencyCount };
}

function buildCardStatements(snapshot: FinancialAdvisorSnapshot, todayKey: string): AdvisorCardStatement[] {
  return snapshot.debts
    .filter((debt) => debt.debtKind === "credit_card" && debt.status === "active" && !debt.isArchived)
    .map((debt) => {
      const profile = snapshot.creditCardProfiles.find((item) => item.debtId === debt.id);
      const item = buildCreditCardIntelligenceItem({
        debt,
        profile,
        entries: snapshot.creditCardEntries,
        statements: snapshot.creditCardStatements,
        todayKey,
      });
      return {
        cardId: debt.id,
        cardName: debt.name,
        creditorName: debt.creditorName,
        currencyCode: currencyOf(debt.currencyCode) ?? "UNKNOWN",
        currentBalance: item.currentBalance,
        statementId: item.latestStatement?.id ?? null,
        statementBalance: item.latestStatement?.statementBalance ?? null,
        minimumPaymentAmount: item.minimumPaymentAmount,
        dueDate: item.latestStatementDueDate,
        daysUntilDue: item.daysUntilStatementDue,
        coverageStatus: item.coverageStatus,
        actionable: item.actionable,
      } satisfies AdvisorCardStatement;
    });
}

function buildDebtComparisons(
  strategies: DebtStrategyResult,
  debtItems: DebtIntelligenceItem[]
): AdvisorDebtComparison[] {
  const itemNames = new Map(debtItems.map((item) => [item.debtId, item.debtName]));
  return Object.values(strategies.avalanche.byCurrency).map((group) => {
    let recommendedDebtId: string | null = null;
    if (group.comparisonMode === "tcea_full") recommendedDebtId = group.tceaCandidates[0]?.debtId ?? null;
    if (group.comparisonMode === "tea_full") recommendedDebtId = group.teaCandidates[0]?.debtId ?? null;
    const explanation = group.comparisonMode === "tcea_full"
      ? `${itemNames.get(recommendedDebtId ?? "") ?? "La candidata"} tiene la TCEA más alta entre las deudas comparables.`
      : group.comparisonMode === "tea_full"
        ? `${itemNames.get(recommendedDebtId ?? "") ?? "La candidata"} tiene la TEA más alta entre las deudas comparables.`
        : group.comparisonMode === "partial"
          ? "Comparación parcial: se separan TCEA, TEA y deudas sin tasa; no hay ganadora absoluta."
          : "No hay una tasa comparable suficiente para declarar una prioridad de costo.";
    return {
      currencyCode: group.currencyCode,
      mode: group.comparisonMode,
      recommendedDebtId,
      tceaDebtIds: group.tceaCandidates.map((candidate) => candidate.debtId),
      teaDebtIds: group.teaCandidates.map((candidate) => candidate.debtId),
      unknownRateDebtIds: group.unknownRateDebtIds,
      explanation,
    };
  });
}

function buildDebtPriorities(
  debtItems: DebtIntelligenceItem[],
  strategies: DebtStrategyResult
): AdvisorDebtPriority[] {
  const urgency = new Map(strategies.urgency.rankedCandidates.map((candidate) => [candidate.debtId, candidate.urgencyRank]));
  const snowball = new Map<string, number>();
  for (const candidates of Object.values(strategies.snowball.byCurrency)) {
    for (const candidate of candidates) snowball.set(candidate.debtId, candidate.rankWithinCurrency);
  }
  const cashFlow = new Map<string, number>();
  for (const group of Object.values(strategies.cashFlowRelief30d.byCurrency)) {
    for (const candidate of group.rankedCandidates) cashFlow.set(candidate.debtId, candidate.rankWithinCurrency);
  }
  const avalanche = new Map<string, number>();
  for (const group of Object.values(strategies.avalanche.byCurrency)) {
    for (const candidate of [...group.tceaCandidates, ...group.teaCandidates]) avalanche.set(candidate.debtId, candidate.rankWithinBasis);
  }

  return debtItems
    .filter((item) => item.status === "active" && !item.isArchived && item.debtKind !== "credit_card" && item.currentPrincipal > 0)
    .map((item) => ({
      debtId: item.debtId,
      debtName: item.debtName,
      creditorName: item.creditorName,
      currencyCode: currencyOf(item.currencyCode) ?? "UNKNOWN",
      currentPrincipal: item.currentPrincipal,
      rateBasis: item.rateBasis,
      ratePercent: item.ratePercent,
      urgencyRank: urgency.get(item.debtId) ?? null,
      avalancheRank: avalanche.get(item.debtId) ?? null,
      snowballRank: snowball.get(item.debtId) ?? null,
      cashFlowReliefRank: cashFlow.get(item.debtId) ?? null,
      nextDueDate: item.nextInstallmentDueDate,
      nextDueAmount: item.nextInstallmentRemainingAmount,
    }))
    .sort((a, b) => a.debtName.localeCompare(b.debtName) || a.debtId.localeCompare(b.debtId));
}

function addGap(gaps: Array<{ code: string; message: string }>, code: string, message: string) {
  if (!gaps.some((gap) => gap.code === code)) gaps.push({ code, message });
}

function buildDataQuality(
  snapshot: FinancialAdvisorSnapshot,
  windows: Record<AdvisorWindowKey, AdvisorObligationWindow>,
  cardStatements: AdvisorCardStatement[],
  unknownCurrencyCount: number
): AdvisorDataQuality {
  const gaps: Array<{ code: string; message: string }> = [];
  if (unknownCurrencyCount > 0) addGap(gaps, "unknown_currency", "Hay un saldo sin moneda resoluble.");
  if (snapshot.obligationProjection.unscheduledRecurringCount > 0) {
    addGap(gaps, "unscheduled_recurring", "Hay pagos recurrentes sin fecha confirmada.");
  }
  if (snapshot.obligationProjection.activeDebtsWithoutPlanningCount > 0) {
    addGap(gaps, "debt_without_planning", "Hay deudas activas sin un cronograma utilizable.");
  }
  const activeDebtItems = snapshot.debtIntelligenceItems.filter((item) => item.status === "active" && !item.isArchived && item.debtKind !== "credit_card");
  if (activeDebtItems.some((item) => !item.readiness.hasRate)) addGap(gaps, "missing_rate", "Algunas deudas no tienen tasa registrada; no se consideran 0%.");
  if (activeDebtItems.some((item) => !item.readiness.hasCurrentSchedule && item.readiness.limitations.includes("missing_current_schedule"))) {
    addGap(gaps, "missing_schedule", "Falta el cronograma vigente de una o más deudas.");
  }
  if (activeDebtItems.some((item) => item.readiness.limitations.includes("unknown_installment_amounts"))) {
    addGap(gaps, "unknown_installment_amount", "Hay cuotas cuyo monto todavía no está confirmado.");
  }
  for (const card of cardStatements) {
    if (card.coverageStatus === "no_statement") addGap(gaps, "missing_card_statement", "Hay una tarjeta sin estado de cuenta cargado.");
    if (card.coverageStatus === "unknown_after_settlement_activity") {
      addGap(gaps, "card_settlement_unknown", "El importe pendiente de un estado de cuenta necesita confirmación.");
    }
  }
  const unknownWindowAmounts = Object.values(windows).reduce((sum, window) =>
    sum + Object.values(window.byCurrency).reduce((inner, summary) => inner + summary.unknownAmountCount, 0), 0);
  if (unknownWindowAmounts > 0) addGap(gaps, "unknown_obligation_amount", "Hay obligaciones próximas con monto por confirmar.");

  const knownEvidence = Object.values(windows).some((window) => Object.values(window.byCurrency).some((summary) => summary.knownAmount > 0 || summary.estimatedAmount > 0))
    || snapshot.debtIntelligenceItems.some((item) => item.status === "active" && !item.isArchived && finiteAmount(item.currentPrincipal));
  const status: AdvisorDataQualityStatus = gaps.length === 0 ? "complete" : knownEvidence ? "partial" : "insufficient";
  return {
    status,
    missingDataCount: gaps.length,
    messages: gaps.map((gap) => gap.message),
    reasonCodes: gaps.map((gap) => gap.code),
  };
}

function buildReserveRequirements(
  windows: Record<AdvisorWindowKey, AdvisorObligationWindow>,
  cards: AdvisorCardStatement[]
): Record<string, AdvisorReserveRequirement> {
  const result: Record<string, AdvisorReserveRequirement> = {};
  const add = (currencyCode: string) => result[currencyCode] ?? (result[currencyCode] = {
    currencyCode,
    ordinaryKnownAmount: 0,
    ordinaryEstimatedAmount: 0,
    ordinaryUnknownCount: 0,
    cardKnownAmount: 0,
    cardUnknownCount: 0,
    requiredKnownAmount: 0,
  });
  const reserveWindows = [windows.overdue, windows.today, windows.next_7_days];
  for (const window of reserveWindows) {
    for (const item of window.items) {
      const currencyCode = currencyOf(item.currencyCode) ?? "UNKNOWN";
      const target = add(currencyCode);
      if (item.amountKind === "known" && finiteAmount(item.amount)) target.ordinaryKnownAmount += item.amount;
      else if (item.amountKind === "estimated" && finiteAmount(item.amount)) target.ordinaryEstimatedAmount += item.amount;
      else target.ordinaryUnknownCount++;
    }
  }
  for (const card of cards) {
    if (card.statementBalance == null || card.statementBalance <= 0 || card.daysUntilDue == null || card.daysUntilDue > 30) continue;
    const target = add(card.currencyCode);
    if (card.actionable && card.coverageStatus === "known_unsettled") target.cardKnownAmount += card.statementBalance;
    else target.cardUnknownCount++;
  }
  for (const target of Object.values(result)) {
    target.requiredKnownAmount = target.ordinaryKnownAmount + target.ordinaryEstimatedAmount + target.cardKnownAmount;
  }
  return result;
}

function buildCoverage(
  liquidity: Record<string, AdvisorLiquiditySummary>,
  reserveRequirements: Record<string, AdvisorReserveRequirement>
): Record<string, AdvisorCoverageSummary> {
  const currencies = new Set([...Object.keys(liquidity), ...Object.keys(reserveRequirements)]);
  const result: Record<string, AdvisorCoverageSummary> = {};
  for (const currencyCode of currencies) {
    const liquid = liquidity[currencyCode]?.knownAmount ?? 0;
    const requirement = reserveRequirements[currencyCode];
    const required = requirement?.requiredKnownAmount ?? 0;
    const unknown = (requirement?.ordinaryUnknownCount ?? 0) + (requirement?.cardUnknownCount ?? 0);
    const shortfall = Math.max(0, required - liquid);
    result[currencyCode] = {
      currencyCode,
      liquidityKnownAmount: liquid,
      requiredKnownAmount: required,
      unknownAmountCount: unknown,
      shortfallKnownAmount: shortfall,
      coverageStatus: unknown > 0 ? "unknown" : shortfall > 0 ? "shortfall" : "covered",
    };
  }
  return result;
}

function buildDebtLoad(
  priorities: AdvisorDebtPriority[],
  reserveRequirements: Record<string, AdvisorReserveRequirement>,
  liquidity: Record<string, AdvisorLiquiditySummary>,
  overdueCount: number
): AdvisorDebtLoadSummary {
  const byCurrency: AdvisorDebtLoadSummary["byCurrency"] = {};
  for (const debt of priorities) {
    const target = byCurrency[debt.currencyCode] ?? (byCurrency[debt.currencyCode] = {
      currencyCode: debt.currencyCode,
      activeDebtCount: 0,
      currentPrincipal: 0,
      knownNextObligationAmount: 0,
      unknownNextObligationCount: 0,
      liquidityCommittedPercent: null,
    });
    target.activeDebtCount++;
    target.currentPrincipal += debt.currentPrincipal;
    if (finiteAmount(debt.nextDueAmount)) target.knownNextObligationAmount += debt.nextDueAmount;
    else if (debt.nextDueDate) target.unknownNextObligationCount++;
  }
  for (const [currencyCode, target] of Object.entries(byCurrency)) {
    const liquid = liquidity[currencyCode]?.knownAmount;
    const reserve = reserveRequirements[currencyCode]?.requiredKnownAmount ?? 0;
    target.liquidityCommittedPercent = finiteAmount(liquid) && liquid > 0 ? (reserve / liquid) * 100 : null;
  }
  return {
    activeDebtCount: priorities.length,
    overdueObligationCount: overdueCount,
    byCurrency,
    incomeRatioStatus: "not_calculated",
    incomeRatioMessage: "No calculamos un ratio deuda/ingreso porque Caja Familiar no tiene un ingreso mensual estable confirmado.",
  };
}

function makeRecommendation(input: Omit<AdvisorRecommendation, "priority">, priority: number): AdvisorRecommendation {
  return { ...input, priority };
}

const RECOMMENDATION_CLASS_ORDER: Record<AdvisorRecommendationPriorityClass, number> = {
  overdue: 10,
  due_today: 20,
  immediate: 30,
  card_statement: 40,
  strategy: 50,
  data_gap: 90,
};

function humanDueDate(dueDate: string | null, todayKey: string): string {
  if (!dueDate || !validDateKey(dueDate)) return "una fecha por confirmar";
  if (dueDate < todayKey) return `el ${formatLocalDate(dueDate)}`;
  if (dueDate === todayKey) return "hoy";
  if (dueDate === addDaysKey(todayKey, 1)) return "mañana";
  return `el ${formatLocalDate(dueDate)}`;
}

function priorityClassForCard(card: AdvisorCardStatement, todayKey: string): AdvisorRecommendationPriorityClass {
  if (card.dueDate && card.dueDate < todayKey) return "overdue";
  if (card.dueDate === todayKey) return "due_today";
  return "card_statement";
}

function buildRecommendations(
  resultParts: {
    todayKey: string;
    windows: Record<AdvisorWindowKey, AdvisorObligationWindow>;
    coverage: Record<string, AdvisorCoverageSummary>;
    cards: AdvisorCardStatement[];
    debtPriorities: AdvisorDebtPriority[];
    comparisons: AdvisorDebtComparison[];
    quality: AdvisorDataQuality;
  }
): AdvisorRecommendation[] {
  const recommendations: AdvisorRecommendation[] = [];
  for (const [currencyCode, summary] of Object.entries(resultParts.windows.overdue.byCurrency)) {
    if (summary.knownAmount + summary.estimatedAmount <= 0 && summary.unknownAmountCount === 0) continue;
    const amount = summary.knownAmount + summary.estimatedAmount;
    recommendations.push(makeRecommendation({
      id: `overdue:${currencyCode}`,
      type: "URGENT_PAYMENT",
      priorityClass: "overdue",
      title: amount > 0 ? `Atiende vencimientos por ${formatMoneyByCurrency(amount, currencyCode)}` : "Revisa tus vencimientos inmediatos",
      reason: summary.unknownAmountCount > 0
        ? "Hay obligaciones vencidas y al menos un monto necesita confirmación."
        : "Resolver lo vencido es la primera prioridad antes de usar liquidez en decisiones opcionales.",
      currencyCode,
      amount: amount > 0 ? amount : null,
      dueDate: null,
      debtId: null,
      cardId: null,
      paymentId: null,
      confidence: summary.unknownAmountCount > 0 ? "partial" : "complete",
      evidence: [{ code: "overdue_projection", label: "Obligaciones vencidas", source: "buildObligationProjection" }],
    }, recommendations.length + 1));
  }

  const dueTodayDebtIds = new Set<string>();
  for (const debt of resultParts.debtPriorities
    .filter((item) => item.nextDueDate === resultParts.todayKey)
    .sort((a, b) => a.debtName.localeCompare(b.debtName) || a.debtId.localeCompare(b.debtId))) {
    dueTodayDebtIds.add(debt.debtId);
    const hasAmount = finiteAmount(debt.nextDueAmount);
    recommendations.push(makeRecommendation({
      id: `debt-due-today:${debt.debtId}`,
      type: "URGENT_PAYMENT",
      priorityClass: "due_today",
      title: `Paga ${debt.debtName} hoy`,
      reason: hasAmount
        ? `La cuota contractual vence hoy. Monto conocido: ${formatMoneyByCurrency(debt.nextDueAmount!, debt.currencyCode)}.`
        : "La cuota contractual vence hoy, pero el monto necesita confirmación.",
      currencyCode: debt.currencyCode,
      amount: hasAmount ? debt.nextDueAmount : null,
      dueDate: debt.nextDueDate,
      debtId: debt.debtId,
      cardId: null,
      paymentId: null,
      confidence: hasAmount ? "complete" : "partial",
      evidence: [{ code: "debt_due_today", label: "Cuota contractual que vence hoy", source: "buildDebtPlanningItems" }],
    }, recommendations.length + 1));
  }

  for (const card of resultParts.cards) {
    if (!card.actionable || card.statementBalance == null || card.statementBalance <= 0 || card.daysUntilDue == null || card.daysUntilDue > 30) continue;
    recommendations.push(makeRecommendation({
      id: `card:${card.cardId}:${card.statementId}`,
      type: "CARD_STATEMENT_DUE",
      priorityClass: priorityClassForCard(card, resultParts.todayKey),
      title: `Reserva ${formatMoneyByCurrency(card.statementBalance, card.currencyCode)} para ${card.cardName}`,
      reason: `El estado de cuenta cerrado es una obligación conocida y vence ${humanDueDate(card.dueDate, resultParts.todayKey)}; el saldo vivo posterior al cierre no se suma aquí.`,
      currencyCode: card.currencyCode,
      amount: card.statementBalance,
      dueDate: card.dueDate,
      debtId: null,
      cardId: card.cardId,
      paymentId: null,
      confidence: "complete",
      evidence: [{ code: "closed_statement", label: "Estado de cuenta cerrado", source: "buildCreditCardIntelligenceItem" }],
    }, recommendations.length + 1));
  }

  for (const [currencyCode, coverage] of Object.entries(resultParts.coverage)) {
    if (coverage.shortfallKnownAmount <= 0) continue;
    recommendations.push(makeRecommendation({
      id: `reserve:${currencyCode}`,
      type: "RESERVE_CASH",
      priorityClass: "immediate",
      title: `Te faltan ${formatMoneyByCurrency(coverage.shortfallKnownAmount, currencyCode)} para cubrir tus obligaciones conocidas`,
      reason: coverage.unknownAmountCount > 0
        ? `Con tu liquidez actual de ${formatMoneyByCurrency(coverage.liquidityKnownAmount, currencyCode)}, todavía faltan ${formatMoneyByCurrency(coverage.shortfallKnownAmount, currencyCode)} para cubrir las obligaciones consideradas; además hay montos por confirmar.`
        : `Con tu liquidez actual de ${formatMoneyByCurrency(coverage.liquidityKnownAmount, currencyCode)}, todavía faltan ${formatMoneyByCurrency(coverage.shortfallKnownAmount, currencyCode)} para cubrir las obligaciones consideradas.`,
      currencyCode,
      amount: coverage.shortfallKnownAmount,
      dueDate: null,
      debtId: null,
      cardId: null,
      paymentId: null,
      confidence: coverage.unknownAmountCount > 0 ? "partial" : "complete",
      evidence: [{ code: "liquidity_gap", label: "Cobertura de obligaciones", source: "financial accounts + obligation projection" }],
    }, recommendations.length + 1));
  }

  const next7End = addDaysKey(resultParts.todayKey, 7);
  const dueSoonDebtIds = new Set<string>();
  for (const debt of resultParts.debtPriorities
    .filter((item) => item.nextDueDate && item.nextDueDate > resultParts.todayKey && Boolean(next7End && item.nextDueDate <= next7End))
    .sort((a, b) => a.nextDueDate!.localeCompare(b.nextDueDate!) || a.debtName.localeCompare(b.debtName) || a.debtId.localeCompare(b.debtId))) {
    dueSoonDebtIds.add(debt.debtId);
    recommendations.push(makeRecommendation({
      id: `debt-due-soon:${debt.debtId}`,
      type: "URGENT_PAYMENT",
      priorityClass: "immediate",
      title: debt.nextDueDate === addDaysKey(resultParts.todayKey, 1)
        ? `Paga ${debt.debtName} antes de mañana`
        : `Paga ${debt.debtName} antes del ${formatLocalDate(debt.nextDueDate!)}`,
      reason: `La siguiente cuota contractual vence ${humanDueDate(debt.nextDueDate, resultParts.todayKey)} y forma parte de tus obligaciones inmediatas.`,
      currencyCode: debt.currencyCode,
      amount: finiteAmount(debt.nextDueAmount) ? debt.nextDueAmount : null,
      dueDate: debt.nextDueDate,
      debtId: debt.debtId,
      cardId: null,
      paymentId: null,
      confidence: finiteAmount(debt.nextDueAmount) ? "complete" : "partial",
      evidence: [{ code: "debt_due_date", label: "Próxima cuota", source: "buildDebtPlanningItems" }],
    }, recommendations.length + 1));
  }

  const urgentDebt = resultParts.debtPriorities
    .filter((item) => item.nextDueDate && !dueTodayDebtIds.has(item.debtId) && !dueSoonDebtIds.has(item.debtId))
    .sort((a, b) => a.nextDueDate!.localeCompare(b.nextDueDate!) || a.debtName.localeCompare(b.debtName) || a.debtId.localeCompare(b.debtId))[0];
  if (urgentDebt) {
    recommendations.push(makeRecommendation({
      id: `debt-due:${urgentDebt.debtId}`,
      type: "URGENT_PAYMENT",
      priorityClass: "strategy",
      title: urgentDebt.nextDueDate === addDaysKey(resultParts.todayKey, 1)
        ? `Paga ${urgentDebt.debtName} antes de mañana`
        : `Paga ${urgentDebt.debtName} antes del ${formatLocalDate(urgentDebt.nextDueDate!)}`,
      reason: "La siguiente cuota contractual aparece entre tus obligaciones próximas.",
      currencyCode: urgentDebt.currencyCode,
      amount: finiteAmount(urgentDebt.nextDueAmount) ? urgentDebt.nextDueAmount : null,
      dueDate: urgentDebt.nextDueDate,
      debtId: urgentDebt.debtId,
      cardId: null,
      paymentId: null,
      confidence: finiteAmount(urgentDebt.nextDueAmount) ? "complete" : "partial",
      evidence: [{ code: "debt_due_date", label: "Próxima cuota", source: "buildDebtPlanningItems" }],
    }, recommendations.length + 1));
  }

  for (const comparison of resultParts.comparisons) {
    if (!comparison.recommendedDebtId) continue;
    const candidate = resultParts.debtPriorities.find((item) => item.debtId === comparison.recommendedDebtId);
    if (!candidate) continue;
    const coverage = resultParts.coverage[comparison.currencyCode];
    if (coverage?.shortfallKnownAmount || coverage?.unknownAmountCount) continue;
    recommendations.push(makeRecommendation({
      id: `debt-priority:${candidate.debtId}`,
      type: "PRIORITIZE_DEBT",
      priorityClass: "strategy",
      title: `Mi prioridad recomendada hoy: ${candidate.debtName}`,
      reason: comparison.explanation,
      currencyCode: comparison.currencyCode,
      amount: null,
      dueDate: null,
      debtId: candidate.debtId,
      cardId: null,
      paymentId: null,
      confidence: "complete",
      evidence: [{ code: comparison.mode, label: "Comparación de costo", source: "buildDebtStrategies" }],
    }, recommendations.length + 1));
  }

  if (recommendations.length === 0 && resultParts.quality.status !== "complete") {
    recommendations.push(makeRecommendation({
      id: "data-gap",
      type: "DATA_GAP",
      priorityClass: "data_gap",
      title: "Completa algunos datos antes de tomar decisiones",
      reason: resultParts.quality.messages[0] ?? "La cobertura actual no permite una recomendación responsable.",
      currencyCode: null,
      amount: null,
      dueDate: null,
      debtId: null,
      cardId: null,
      paymentId: null,
      confidence: resultParts.quality.status,
      evidence: [{ code: "data_quality", label: "Calidad del análisis", source: "FinancialAdvisor" }],
    }, 1));
  }
  return recommendations
    .sort((a, b) => RECOMMENDATION_CLASS_ORDER[a.priorityClass] - RECOMMENDATION_CLASS_ORDER[b.priorityClass] || a.priority - b.priority)
    .slice(0, 5)
    .map((item, index) => ({ ...item, priority: index + 1 }));
}

export function buildFinancialAdvisorResult(snapshot: FinancialAdvisorSnapshot): FinancialAdvisorResult {
  const todayKey = snapshot.todayKey ?? localDateString();
  const windowItems = projectionItemsForWindows(snapshot.obligationProjection, todayKey);
  const cardStatements = buildCardStatements(snapshot, todayKey);
  const windows = {
    overdue: buildWindow("overdue", windowItems.overdue, cardsForWindow(cardStatements, "overdue", todayKey)),
    today: buildWindow("today", windowItems.today, cardsForWindow(cardStatements, "today", todayKey)),
    next_7_days: buildWindow("next_7_days", windowItems.next_7_days, cardsForWindow(cardStatements, "next_7_days", todayKey)),
    rest_of_week: buildWindow("rest_of_week", windowItems.rest_of_week, cardsForWindow(cardStatements, "rest_of_week", todayKey)),
    next_30_days: buildWindow("next_30_days", windowItems.next_30_days, cardsForWindow(cardStatements, "next_30_days", todayKey)),
    next_90_days: buildWindow("next_90_days", windowItems.next_90_days, cardsForWindow(cardStatements, "next_90_days", todayKey)),
  } satisfies Record<AdvisorWindowKey, AdvisorObligationWindow>;
  const { liquidityByCurrency, unknownCurrencyCount } = buildLiquidity(snapshot);
  const reserveRequirementsByCurrency = buildReserveRequirements(windows, cardStatements);
  const coverageByCurrency = buildCoverage(liquidityByCurrency, reserveRequirementsByCurrency);
  const dataQuality = buildDataQuality(snapshot, windows, cardStatements, unknownCurrencyCount);
  const debtPriorities = buildDebtPriorities(snapshot.debtIntelligenceItems, snapshot.debtStrategies);
  const debtComparisons = buildDebtComparisons(snapshot.debtStrategies, snapshot.debtIntelligenceItems);
  const debtLoad = buildDebtLoad(
    debtPriorities,
    reserveRequirementsByCurrency,
    liquidityByCurrency,
    windows.overdue.items.length
  );
  const recommendations = buildRecommendations({
    todayKey,
    windows,
    coverage: coverageByCurrency,
    cards: cardStatements,
    debtPriorities,
    comparisons: debtComparisons,
    quality: dataQuality,
  });

  return {
    todayKey,
    dataQuality,
    liquidityByCurrency,
    windows,
    coverageByCurrency,
    reserveRequirementsByCurrency,
    recommendations,
    debtPriorities,
    debtComparisons,
    cardStatements,
    debtLoad,
    extraCash: null,
    extraCashDebtItems: snapshot.debtIntelligenceItems,
  };
}

export function simulateFinancialAdvisorExtraCash(
  result: FinancialAdvisorResult,
  amount: number,
  currencyCode: string
): AdvisorExtraCashScenario {
  const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
  const normalizedCurrency = currencyOf(currencyCode) ?? "UNKNOWN";
  const safeAmount = finiteAmount(amount) && amount > 0 ? roundMoney(amount) : 0;
  const reserve = result.reserveRequirementsByCurrency[normalizedCurrency];
  const currentLiquidity = roundMoney(result.liquidityByCurrency[normalizedCurrency]?.knownAmount ?? 0);
  const knownReserveRequirement = roundMoney(reserve?.requiredKnownAmount ?? 0);
  const shortfallBefore = roundMoney(Math.max(0, knownReserveRequirement - currentLiquidity));
  const reservedFromAdditionalCash = roundMoney(Math.min(safeAmount, shortfallBefore));
  const shortfallAfter = roundMoney(Math.max(0, shortfallBefore - safeAmount));
  const remainingAfterKnownRequirements = roundMoney(Math.max(0, safeAmount - shortfallBefore));
  const liquidityAfterAdditionalCash = roundMoney(currentLiquidity + safeAmount);
  const unknownObligationCount = (reserve?.ordinaryUnknownCount ?? 0) + (reserve?.cardUnknownCount ?? 0);
  const decisionStatus: AdvisorExtraCashDecisionStatus = unknownObligationCount > 0
    ? "unknown_requirements"
    : safeAmount <= 0
      ? "no_positive_extra"
      : remainingAfterKnownRequirements > 0
        ? "potential_extra_available"
        : "cover_shortfall_first";
  const warnings: string[] = [];
  if (unknownObligationCount > 0) warnings.push("Hay obligaciones inmediatas con monto por confirmar; el remanente es potencial, no una autorización de prepago.");

  let selectedDebtId: string | null = null;
  let selectedDebtName: string | null = null;
  let selectedDebtComparisonReason: string | null = null;
  let comparisonMode: AdvisorDebtComparison["mode"] | null = null;
  let simulation: DebtPrepaymentSimulation | null = null;
  if (decisionStatus === "potential_extra_available") {
    const comparison = result.debtComparisons.find((item) =>
      item.currencyCode === normalizedCurrency
      && (item.mode === "tcea_full" || item.mode === "tea_full")
      && item.recommendedDebtId
    );
    const candidate = comparison ? result.debtPriorities.find((item) => item.debtId === comparison.recommendedDebtId) : null;
    const item = candidate ? result.extraCashDebtItems.find((debt) => debt.debtId === candidate.debtId) : null;
    if (candidate && item) {
      selectedDebtId = candidate.debtId;
      selectedDebtName = candidate.debtName;
      comparisonMode = comparison?.mode ?? null;
      selectedDebtComparisonReason = comparisonMode === "tcea_full"
        ? "su TCEA es la más alta entre las deudas comparables"
        : "su TEA es la más alta entre las deudas comparables";
      simulation = simulateDebtPrincipalPrepayment(item, remainingAfterKnownRequirements);
      if (simulation.status === "exceeds_current_principal") {
        warnings.push("El remanente supera el principal actual de la candidata; no se ajustó ni se inventó un resultado.");
      }
      warnings.push("El ahorro exacto de intereses y el nuevo cronograma dependen del recálculo contractual del acreedor.");
    } else {
      warnings.push("No hay una deuda comparable suficiente para recomendar una candidata absoluta.");
    }
  }
  return {
    additionalCash: safeAmount,
    currentLiquidity,
    liquidityAfterAdditionalCash,
    knownReserveRequirement,
    shortfallBefore,
    shortfallAfter,
    reservedFromAdditionalCash,
    remainingAfterKnownRequirements,
    decisionStatus,
    amount: safeAmount,
    currencyCode: normalizedCurrency,
    reservedForObligations: reservedFromAdditionalCash,
    availableForDecision: remainingAfterKnownRequirements,
    uncoveredObligationAmount: shortfallBefore,
    unknownObligationCount,
    selectedDebtId,
    selectedDebtName,
    selectedDebtComparisonReason,
    comparisonMode,
    simulation,
    warnings,
  };
}
