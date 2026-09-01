import { describe, expect, it } from "vitest";
import type {
  CreditCardEntry,
  CreditCardProfile,
  CreditCardStatement,
  Debt,
  DebtEvent,
  DebtInstallment,
  DebtScheduleVersion,
  FinancialAccount,
  Movement,
  RecurringPayment,
} from "../types.js";
import { buildDebtIntelligenceItems } from "./debtIntelligence.js";
import { buildDebtPlanningItems } from "./debtPlanning.js";
import { simulateDebtPrincipalPrepayment } from "./debtSimulation.js";
import { buildDebtStrategies } from "./debtStrategy.js";
import { buildObligationProjection } from "./obligationProjection.js";
import { answerFinancialAdvisorQuestion, formatExtraCashAdvice, parseFinancialAdvisorQuestion } from "./financialAdvisorQuestions.js";
import {
  buildFinancialAdvisorResult,
  simulateFinancialAdvisorExtraCash,
  type FinancialAdvisorSnapshot,
} from "./financialAdvisor.js";

const TODAY = "2026-09-01";

function debt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: "debt-a",
    name: "Deuda A",
    creditorName: "Banco Fixture",
    debtKind: "bank_loan",
    currencyCode: "PEN",
    originDate: null,
    trackingStartDate: TODAY,
    originalPrincipal: 5000,
    openingPrincipalBalance: 5000,
    plannedInstallmentCount: 12,
    plannedInstallmentAmount: 800,
    installmentAmountMode: "fixed",
    paymentFrequency: "monthly",
    customFrequencyDays: null,
    firstDueDate: "2026-09-05",
    teaPercent: null,
    tceaPercent: 20,
    notes: "",
    status: "active",
    isArchived: false,
    createdByUserId: "fixture-user",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function schedule(debtId: string, overrides: Partial<DebtScheduleVersion> = {}): DebtScheduleVersion {
  return {
    id: `schedule-${debtId}`,
    debtId,
    versionNumber: 1,
    effectiveDate: "2026-01-01",
    reason: "initial",
    triggerEventId: null,
    notes: "",
    createdByUserId: "fixture-user",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function installment(debtId: string, installmentNumber: number, dueDate: string, overrides: Partial<DebtInstallment> = {}): DebtInstallment {
  return {
    id: `installment-${debtId}-${installmentNumber}`,
    scheduleVersionId: `schedule-${debtId}`,
    debtId,
    installmentNumber,
    dueDate,
    expectedAmount: 800,
    expectedPrincipal: 700,
    expectedInterest: 100,
    expectedFees: 0,
    expectedInsurance: 0,
    createdByUserId: "fixture-user",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function account(overrides: Partial<FinancialAccount> = {}): FinancialAccount {
  return {
    id: "account-pen",
    name: "Cuenta Fixture",
    reconciliationType: "cash",
    openingBalance: 1000,
    currencyCode: "PEN",
    isActive: true,
    sortOrder: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function recurring(overrides: Partial<RecurringPayment> = {}): RecurringPayment {
  return {
    id: "recurring-a",
    name: "Servicio Fixture",
    amount: 100,
    amount_mode: "fixed",
    dueDay: 10,
    dueDate: null,
    category: "Casa",
    status: "pendiente",
    notes: "",
    recurrence_type: "indefinite",
    total_installments: null,
    paid_installments: 0,
    is_active: true,
    last_paid_month: null,
    last_paid_year: null,
    ...overrides,
  };
}

function movement(overrides: Partial<Movement> = {}): Movement {
  return {
    id: "movement-a",
    type: "ingreso",
    date: TODAY,
    amount: 0,
    description: "Fixture",
    method: "efectivo",
    category: "Otros",
    person: "Fixture",
    accountId: "account-pen",
    movementContext: "standard",
    ...overrides,
  };
}

function cardDebt(overrides: Partial<Debt> = {}): Debt {
  return debt({
    id: "card-a",
    name: "Tarjeta Fixture",
    creditorName: "Emisor Fixture",
    debtKind: "credit_card",
    originalPrincipal: null,
    openingPrincipalBalance: 0,
    plannedInstallmentCount: null,
    plannedInstallmentAmount: null,
    installmentAmountMode: "unknown",
    paymentFrequency: null,
    firstDueDate: null,
    teaPercent: null,
    tceaPercent: null,
    ...overrides,
  });
}

function cardEntry(overrides: Partial<CreditCardEntry> = {}): CreditCardEntry {
  return {
    id: "card-entry-a",
    debtId: "card-a",
    entryDate: "2026-08-15",
    entryType: "purchase",
    liabilityDelta: 900,
    movementId: null,
    reversalOfEntryId: null,
    description: "Compra Fixture",
    registeredByUserId: "fixture-user",
    createdAt: "2026-08-15T00:00:00Z",
    ...overrides,
  };
}

function cardStatement(overrides: Partial<CreditCardStatement> = {}): CreditCardStatement {
  return {
    id: "card-statement-a",
    debtId: "card-a",
    statementDate: "2026-08-20",
    dueDate: "2026-09-05",
    statementBalance: 400,
    minimumPaymentAmount: 40,
    closingEntryId: null,
    createdByUserId: "fixture-user",
    createdAt: "2026-08-20T00:00:00Z",
    updatedAt: "2026-08-20T00:00:00Z",
    ...overrides,
  };
}

function buildSnapshot({
  debts = [],
  recurringPayments = [],
  accounts = [account()],
  movements = [],
  installments = [],
  debtEvents = [],
  cardEntries = [],
  cardStatements = [],
  cardProfiles = [],
}: {
  debts?: Debt[];
  recurringPayments?: RecurringPayment[];
  accounts?: FinancialAccount[];
  movements?: Movement[];
  installments?: DebtInstallment[];
  debtEvents?: DebtEvent[];
  cardEntries?: CreditCardEntry[];
  cardStatements?: CreditCardStatement[];
  cardProfiles?: CreditCardProfile[];
} = {}): FinancialAdvisorSnapshot {
  const schedules = debts.map((item) => schedule(item.id));
  const planningItems = buildDebtPlanningItems(debts, debtEvents, schedules, installments, [], TODAY);
  const intelligenceItems = buildDebtIntelligenceItems({
    debts,
    debtEvents,
    debtScheduleVersions: schedules,
    debtInstallments: installments,
    debtCollaterals: [],
    debtPlanningItems: planningItems,
    creditCardProfiles: cardProfiles,
    creditCardEntries: cardEntries,
    creditCardStatements: cardStatements,
    todayKey: TODAY,
  });
  const strategies = buildDebtStrategies(intelligenceItems.filter((item) => item.debtKind !== "credit_card"));
  const obligationProjection = buildObligationProjection({
    recurringPayments,
    debts,
    debtPlanningItems: planningItems,
    debtEvents,
    todayKey: TODAY,
    horizonMonthCount: 4,
  });
  return {
    todayKey: TODAY,
    initialBalance: 0,
    financialAccounts: accounts,
    movements,
    debts,
    debtEvents,
    debtPlanningItems: planningItems,
    debtIntelligenceItems: intelligenceItems,
    debtStrategies: strategies,
    obligationProjection,
    creditCardProfiles: cardProfiles,
    creditCardEntries: cardEntries,
    creditCardStatements: cardStatements,
  };
}

function shortfallResult(options: { unknownObligation?: boolean; comparableDebts?: boolean } = {}) {
  const debts = options.comparableDebts
    ? [
        debt({ id: "debt-cheap", name: "Deuda barata", tceaPercent: 15 }),
        debt({ id: "debt-expensive", name: "Deuda cara", tceaPercent: 25 }),
      ]
    : options.unknownObligation
      ? [debt({ id: "debt-unknown", name: "Deuda por confirmar" })]
      : [];
  const installments = options.comparableDebts
    ? [installment("debt-cheap", 1, "2026-09-20"), installment("debt-expensive", 1, "2026-09-21")]
    : options.unknownObligation
      ? [installment("debt-unknown", 1, "2026-09-03", { expectedAmount: null })]
      : [];
  return buildFinancialAdvisorResult(buildSnapshot({
    accounts: [account({ openingBalance: 2138.25 })],
    debts,
    installments,
    recurringPayments: [recurring({ id: "known-reserve", amount: 3656.69, dueDay: 2 })],
  }));
}

describe("Financial Advisor deterministic read-model", () => {
  it("1. prioritizes an overdue debt payment first", () => {
    const result = buildFinancialAdvisorResult(buildSnapshot({
      debts: [debt()],
      installments: [installment("debt-a", 1, "2026-08-31")],
    }));
    expect(result.windows.overdue.byCurrency.PEN.knownAmount).toBe(800);
    expect(result.recommendations[0].type).toBe("URGENT_PAYMENT");
  });

  it("2. liquidity S/1000 covers known 7-day obligations of S/700", () => {
    const result = buildFinancialAdvisorResult(buildSnapshot({
      accounts: [account({ openingBalance: 1000 })],
      recurringPayments: [recurring({ amount: 700, dueDay: 3 })],
    }));
    expect(result.coverageByCurrency.PEN.shortfallKnownAmount).toBe(0);
    expect(result.coverageByCurrency.PEN.coverageStatus).toBe("covered");
  });

  it("3. liquidity S/500 preserves a S/300 shortfall", () => {
    const result = buildFinancialAdvisorResult(buildSnapshot({
      accounts: [account({ openingBalance: 500 })],
      recurringPayments: [recurring({ amount: 800, dueDay: 3 })],
    }));
    expect(result.coverageByCurrency.PEN.shortfallKnownAmount).toBe(300);
    const shortfall = result.recommendations.find((item) => item.type === "RESERVE_CASH");
    expect(shortfall?.amount).toBe(300);
    expect(shortfall?.title).toMatch(/Te faltan S\/\s*300\.00/);
    expect(shortfall?.title).not.toContain("Reserva");
    expect(shortfall?.reason).toMatch(/Con tu liquidez actual de S\/\s*500\.00/);
  });

  it("4. reserves the S/300 shortfall before leaving S/700 as potential extra cash", () => {
    const result = buildFinancialAdvisorResult(buildSnapshot({
      accounts: [account({ openingBalance: 500 })],
      recurringPayments: [recurring({ amount: 800, dueDay: 3 })],
    }));
    const scenario = simulateFinancialAdvisorExtraCash(result, 1000, "PEN");
    expect(scenario.reservedForObligations).toBe(300);
    expect(scenario.availableForDecision).toBe(700);
  });

  it("extra cash: reports the shortfall before and after a partial contribution", () => {
    const scenario = simulateFinancialAdvisorExtraCash(shortfallResult(), 100, "PEN");
    expect(scenario.currentLiquidity).toBe(2138.25);
    expect(scenario.additionalCash).toBe(100);
    expect(scenario.liquidityAfterAdditionalCash).toBe(2238.25);
    expect(scenario.knownReserveRequirement).toBe(3656.69);
    expect(scenario.shortfallBefore).toBe(1518.44);
    expect(scenario.shortfallAfter).toBe(1418.44);
    expect(scenario.reservedFromAdditionalCash).toBe(100);
    expect(scenario.remainingAfterKnownRequirements).toBe(0);
    expect(scenario.decisionStatus).toBe("cover_shortfall_first");
  });

  it("extra cash: recognizes exact shortfall coverage without proving surplus", () => {
    const scenario = simulateFinancialAdvisorExtraCash(shortfallResult(), 1518.44, "PEN");
    expect(scenario.shortfallAfter).toBe(0);
    expect(scenario.remainingAfterKnownRequirements).toBe(0);
    expect(scenario.decisionStatus).toBe("cover_shortfall_first");
    expect(formatExtraCashAdvice(scenario)).toContain("cubrir exactamente las obligaciones conocidas");
  });

  it("extra cash: exposes only the surplus after covering the known shortfall", () => {
    const scenario = simulateFinancialAdvisorExtraCash(shortfallResult(), 2000, "PEN");
    expect(scenario.reservedFromAdditionalCash).toBe(1518.44);
    expect(scenario.remainingAfterKnownRequirements).toBe(481.56);
    expect(scenario.decisionStatus).toBe("potential_extra_available");
  });

  it("extra cash: passes only the surplus into a full comparable TCEA simulation", () => {
    const scenario = simulateFinancialAdvisorExtraCash(shortfallResult({ comparableDebts: true }), 2000, "PEN");
    expect(scenario.selectedDebtId).toBe("debt-expensive");
    expect(scenario.simulation?.requestedPrincipalReduction).toBe(481.56);
    expect(scenario.simulation?.requestedPrincipalReduction).not.toBe(2000);
    expect(scenario.selectedDebtComparisonReason).toContain("TCEA");
  });

  it("extra cash: keeps a potential remainder fail-closed when an obligation is unknown", () => {
    const scenario = simulateFinancialAdvisorExtraCash(shortfallResult({ unknownObligation: true }), 2000, "PEN");
    expect(scenario.decisionStatus).toBe("unknown_requirements");
    expect(scenario.unknownObligationCount).toBeGreaterThan(0);
    expect(scenario.remainingAfterKnownRequirements).toBe(481.56);
    expect(scenario.simulation).toBeNull();
    expect(formatExtraCashAdvice(scenario)).toContain("Existe un remanente potencial");
  });

  it("extra cash: reports no positive scenario for an empty or non-positive input", () => {
    const scenario = simulateFinancialAdvisorExtraCash(shortfallResult(), 0, "PEN");
    expect(scenario.decisionStatus).toBe("no_positive_extra");
    expect(scenario.additionalCash).toBe(0);
    expect(scenario.remainingAfterKnownRequirements).toBe(0);
  });

  it("extra cash: does not invent a debt candidate without a comparable cohort", () => {
    const scenario = simulateFinancialAdvisorExtraCash(shortfallResult(), 2000, "PEN");
    expect(scenario.remainingAfterKnownRequirements).toBe(481.56);
    expect(scenario.selectedDebtId).toBeNull();
    expect(scenario.simulation).toBeNull();
    expect(scenario.warnings.join(" ")).toContain("deuda comparable");
  });

  it("extra cash: the question uses the same shortfall-before/after read-model", () => {
    const result = shortfallResult();
    const scenario = simulateFinancialAdvisorExtraCash(result, 100, "PEN");
    const answer = answerFinancialAdvisorQuestion(parseFinancialAdvisorQuestion("Tengo S/100 extra, ¿qué hago?"), result, scenario);
    expect(answer.answer).toContain("faltan S/");
    expect(answer.answer).toContain("bajaría a S/");
    expect(answer.answer).toContain("conserva esos S/");
    expect(answer.answer).not.toContain("Reserva primero");
  });

  it("5. keeps PEN and USD liquidity separate", () => {
    const result = buildFinancialAdvisorResult(buildSnapshot({
      accounts: [account({ openingBalance: 1000 }), account({ id: "account-usd", openingBalance: 500, currencyCode: "USD" })],
    }));
    expect(result.liquidityByCurrency.PEN.knownAmount).toBe(1000);
    expect(result.liquidityByCurrency.USD.knownAmount).toBe(500);
    expect(Object.keys(result.liquidityByCurrency)).toEqual(["PEN", "USD"]);
  });

  it("7. uses a closed card statement of S/400, not the live S/900 balance", () => {
    const result = buildFinancialAdvisorResult(buildSnapshot({
      debts: [cardDebt()],
      cardEntries: [cardEntry()],
      cardStatements: [cardStatement()],
    }));
    expect(result.cardStatements[0].currentBalance).toBe(900);
    expect(result.cardStatements[0].statementBalance).toBe(400);
    expect(result.reserveRequirementsByCurrency.PEN.cardKnownAmount).toBe(400);
  });

  it("8. post-close settlement activity makes statement coverage unknown", () => {
    const result = buildFinancialAdvisorResult(buildSnapshot({
      debts: [cardDebt()],
      cardEntries: [cardEntry(), cardEntry({ id: "card-payment", entryDate: "2026-08-25", entryType: "payment", liabilityDelta: -100 })],
      cardStatements: [cardStatement()],
    }));
    expect(result.cardStatements[0].coverageStatus).toBe("unknown_after_settlement_activity");
    expect(result.cardStatements[0].statementBalance).toBe(400);
    expect(result.reserveRequirementsByCurrency.PEN?.cardKnownAmount ?? 0).toBe(0);
    expect(result.reserveRequirementsByCurrency.PEN?.cardUnknownCount).toBe(1);
    expect(result.dataQuality.status).toBe("partial");
  });

  it("9. prioritizes an actionable card statement before optional debt strategy", () => {
    const result = buildFinancialAdvisorResult(buildSnapshot({
      debts: [
        debt({ id: "debt-cost", name: "Deuda costo", tceaPercent: 30 }),
        cardDebt(),
      ],
      installments: [installment("debt-cost", 1, "2026-09-20")],
      cardEntries: [cardEntry()],
      cardStatements: [cardStatement({ dueDate: "2026-09-04" })],
    }));
    expect(result.recommendations.find((item) => item.type === "CARD_STATEMENT_DUE")?.priority).toBeLessThan(
      result.recommendations.find((item) => item.type === "PRIORITIZE_DEBT")?.priority ?? 99
    );
  });

  it("10. uses the existing avalanche TCEA ranking when comparable", () => {
    const result = buildFinancialAdvisorResult(buildSnapshot({
      debts: [debt({ id: "d1", name: "Deuda menor", tceaPercent: 15 }), debt({ id: "d2", name: "Deuda cara", tceaPercent: 25 })],
      installments: [installment("d1", 1, "2026-09-20"), installment("d2", 1, "2026-09-21")],
    }));
    expect(result.debtComparisons.find((item) => item.currencyCode === "PEN")?.mode).toBe("tcea_full");
    expect(result.debtComparisons.find((item) => item.currencyCode === "PEN")?.recommendedDebtId).toBe("d2");
  });

  it("11. uses the existing avalanche TEA ranking when every debt has TEA", () => {
    const result = buildFinancialAdvisorResult(buildSnapshot({
      debts: [debt({ id: "d1", teaPercent: 10, tceaPercent: null }), debt({ id: "d2", teaPercent: 20, tceaPercent: null })],
      installments: [installment("d1", 1, "2026-09-20"), installment("d2", 1, "2026-09-21")],
    }));
    expect(result.debtComparisons[0].mode).toBe("tea_full");
    expect(result.debtComparisons[0].recommendedDebtId).toBe("d2");
  });

  it("12. mixed TCEA, TEA and missing rate stays a partial comparison", () => {
    const result = buildFinancialAdvisorResult(buildSnapshot({
      debts: [debt({ id: "d1", tceaPercent: 20 }), debt({ id: "d2", tceaPercent: null, teaPercent: 10 }), debt({ id: "d3", tceaPercent: null, teaPercent: null })],
      installments: [installment("d1", 1, "2026-09-20"), installment("d2", 1, "2026-09-21"), installment("d3", 1, "2026-09-22")],
    }));
    expect(result.debtComparisons[0].mode).toBe("partial");
    expect(result.debtComparisons[0].recommendedDebtId).toBeNull();
  });

  it("13. a debt without a rate is not treated as 0%", () => {
    const result = buildFinancialAdvisorResult(buildSnapshot({ debts: [debt({ tceaPercent: null, teaPercent: null })] }));
    expect(result.debtPriorities[0].ratePercent).toBeNull();
    expect(result.dataQuality.reasonCodes).toContain("missing_rate");
  });

  it("14. prepayment simulation preserves exact interest savings as null", () => {
    const result = buildFinancialAdvisorResult(buildSnapshot({ debts: [debt()], installments: [installment("debt-a", 1, "2026-09-20")] }));
    const item = result.extraCashDebtItems.find((candidate) => candidate.debtId === "debt-a")!;
    const simulation = simulateDebtPrincipalPrepayment(item, 100);
    expect(simulation.exactInterestSavingsAmount).toBeNull();
    expect(simulation.simulatedInstallmentAmount).toBeNull();
  });

  it("15. an unknown future amount remains unknown and makes coverage partial", () => {
    const result = buildFinancialAdvisorResult(buildSnapshot({
      debts: [debt()],
      installments: [installment("debt-a", 1, "2026-09-20", { expectedAmount: null })],
    }));
    expect(result.windows.next_30_days.byCurrency.PEN.unknownAmountCount).toBe(1);
    expect(result.dataQuality.status).toBe("partial");
  });

  it("16. no debts and no obligations does not invent a problem", () => {
    const result = buildFinancialAdvisorResult(buildSnapshot({ debts: [], recurringPayments: [] }));
    expect(result.dataQuality.status).toBe("complete");
    expect(result.recommendations).toEqual([]);
  });

  it("visual gate: prioritizes a debt due today before a future card or liquidity gap", () => {
    const result = buildFinancialAdvisorResult(buildSnapshot({
      accounts: [account({ openingBalance: 2138.25 })],
      debts: [
        debt({ id: "debt-today", name: "Financiamiento Fixture" }),
        cardDebt({ id: "card-cmr-fixture", name: "Tarjeta CMR Fixture" }),
      ],
      installments: [installment("debt-today", 1, TODAY, { expectedAmount: 1361.5 })],
      recurringPayments: [recurring({ id: "recurring-next", amount: 1250, dueDay: 2 })],
      cardEntries: [cardEntry({ id: "card-entry-cmr", debtId: "card-cmr-fixture" })],
      cardStatements: [cardStatement({ id: "statement-cmr", debtId: "card-cmr-fixture", statementBalance: 852.73, dueDate: "2026-09-20" })],
    }));

    expect(result.windows.today.byCurrency.PEN.knownAmount).toBe(1361.5);
    expect(result.windows.today.cardStatements).toEqual([]);
    expect(result.recommendations[0].debtId).toBe("debt-today");
    expect(result.recommendations[0].title).toBe("Paga Financiamiento Fixture hoy");
    expect(result.recommendations[0].title).not.toContain(TODAY);
    expect(result.recommendations.find((item) => item.cardId === "card-cmr-fixture")?.title).toContain("S/");
    expect(result.recommendations.find((item) => item.cardId === "card-cmr-fixture")?.reason).toMatch(/20 (set\.|sep)\.?(?: 2026)/);
  });

  it("visual gate: reconciles ordinary and card obligations in the 30-day window once", () => {
    const result = buildFinancialAdvisorResult(buildSnapshot({
      debts: [cardDebt()],
      recurringPayments: [recurring({ amount: 1000, dueDay: 10 })],
      cardEntries: [cardEntry()],
      cardStatements: [cardStatement({ statementBalance: 400, dueDate: "2026-09-20" })],
    }));

    expect(result.windows.next_30_days.byCurrency.PEN.knownAmount).toBe(1400);
    expect(result.windows.next_30_days.byCurrency.PEN.obligationCount).toBe(2);
    expect(result.windows.next_30_days.cardStatements).toHaveLength(1);
    expect(result.windows.next_30_days.byCurrency.PEN.knownAmount).not.toBe(1900);
    expect(result.reserveRequirementsByCurrency.PEN.cardKnownAmount).toBe(400);
  });

  it("visual gate: keeps a post-close card settlement unknown in every applicable window", () => {
    const result = buildFinancialAdvisorResult(buildSnapshot({
      debts: [cardDebt()],
      cardEntries: [cardEntry(), cardEntry({ id: "card-payment", entryDate: "2026-08-25", entryType: "payment", liabilityDelta: -100 })],
      cardStatements: [cardStatement({ statementBalance: 400, dueDate: "2026-09-20" })],
    }));

    expect(result.windows.next_30_days.byCurrency.PEN.knownAmount).toBe(0);
    expect(result.windows.next_30_days.byCurrency.PEN.unknownAmountCount).toBe(1);
    expect(result.windows.next_30_days.cardStatements).toHaveLength(1);
    expect(result.reserveRequirementsByCurrency.PEN.cardKnownAmount).toBe(0);
    expect(result.reserveRequirementsByCurrency.PEN.cardUnknownCount).toBe(1);
  });
});
