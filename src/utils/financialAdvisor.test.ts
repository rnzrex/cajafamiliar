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
    expect(result.recommendations.some((item) => item.type === "RESERVE_CASH" && item.amount === 300)).toBe(true);
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
});
