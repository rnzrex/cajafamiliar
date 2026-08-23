import { describe, expect, it } from "vitest";
import type { CreditCardEntry, CreditCardProfile, CreditCardStatement, Debt, FinancialAccount, Movement } from "../types.js";
import {
  buildCreditCardIntelligenceItem,
  buildCreditCardStatementAlerts,
  classifyCreditCardStatementAttention,
  currentCreditCardBalance,
  latestCreditCardStatement,
  selectUrgentCreditCardStatementAlertsForReminder,
  statementCreditCardBalance,
} from "./creditCardCalculations.js";
import { buildDebtIntelligenceItems } from "./debtIntelligence.js";
import { buildCashFlowRelief30dStrategy, buildDebtStrategies } from "./debtStrategy.js";
import { getMovementEconomics, resolveMovementCurrencyCode } from "./movementEconomics.js";
import { movementTotals, movementTotalsByCurrency } from "./movementFilters.js";
import { buildObligationReminderPayload } from "../../api/_lib/paymentReminders.js";
import { buildReportCategoryRowsByCurrency } from "./excelExport.js";

describe("DEBT-5E — Card Strategy, Planning & Reporting Integration Engine", () => {
  const mockCardPEN: Debt = {
    id: "card-pen-1",
    name: "Visa Interbank PEN",
    creditorName: "Interbank",
    debtKind: "credit_card",
    currencyCode: "PEN",
    originDate: "2026-01-01",
    trackingStartDate: "2026-01-01",
    originalPrincipal: null,
    openingPrincipalBalance: 0,
    plannedInstallmentCount: null,
    plannedInstallmentAmount: null,
    installmentAmountMode: "variable",
    paymentFrequency: "monthly",
    customFrequencyDays: null,
    firstDueDate: null,
    teaPercent: 45.0,
    tceaPercent: 55.0,
    notes: "",
    status: "active",
    isArchived: false,
    createdByUserId: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  const mockCardUSD: Debt = {
    id: "card-usd-1",
    name: "Visa BCP USD",
    creditorName: "BCP",
    debtKind: "credit_card",
    currencyCode: "USD",
    originDate: "2026-01-01",
    trackingStartDate: "2026-01-01",
    originalPrincipal: null,
    openingPrincipalBalance: 0,
    plannedInstallmentCount: null,
    plannedInstallmentAmount: null,
    installmentAmountMode: "variable",
    paymentFrequency: "monthly",
    customFrequencyDays: null,
    firstDueDate: null,
    teaPercent: null,
    tceaPercent: null,
    notes: "",
    status: "active",
    isArchived: false,
    createdByUserId: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  const mockLoanPEN: Debt = {
    id: "loan-pen-1",
    name: "Préstamo Personal BCP",
    creditorName: "BCP",
    debtKind: "bank_loan",
    currencyCode: "PEN",
    originDate: "2026-01-01",
    trackingStartDate: "2026-01-01",
    originalPrincipal: 5000,
    openingPrincipalBalance: 2000,
    plannedInstallmentCount: 12,
    plannedInstallmentAmount: 200,
    installmentAmountMode: "fixed",
    paymentFrequency: "monthly",
    customFrequencyDays: null,
    firstDueDate: "2026-09-01",
    teaPercent: 20.0,
    tceaPercent: 25.0,
    notes: "",
    status: "active",
    isArchived: false,
    createdByUserId: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  // 1. Current vs Statement Balance
  it("preserves strict separation between currentCardBalance and statementBalance", () => {
    const entries: CreditCardEntry[] = [
      {
        id: "entry-1",
        debtId: "card-pen-1",
        entryDate: "2026-08-15",
        entryType: "purchase",
        liabilityDelta: 1000,
        movementId: "mov-1",
        reversalOfEntryId: null,
        description: "Compra 1",
        registeredByUserId: "user-1",
        createdAt: "2026-08-15T00:00:00Z",
      },
      {
        id: "entry-2",
        debtId: "card-pen-1",
        entryDate: "2026-09-02",
        entryType: "purchase",
        liabilityDelta: 200,
        movementId: "mov-2",
        reversalOfEntryId: null,
        description: "Compra 2",
        registeredByUserId: "user-1",
        createdAt: "2026-09-02T00:00:00Z",
      },
    ];

    const statementDate = "2026-08-31";
    const currentBalance = currentCreditCardBalance(mockCardPEN, entries);
    const stmtBalance = statementCreditCardBalance(mockCardPEN, entries, statementDate);

    expect(currentBalance).toBe(1200);
    expect(stmtBalance).toBe(1000);
  });

  // 2. Snowball Strategy for Credit Cards
  it("ranks active credit cards by current balance ASC and isolates currency cohorts", () => {
    const cardSmall: Debt = { ...mockCardPEN, id: "card-small", name: "Small Card", openingPrincipalBalance: 300 };
    const cardZero: Debt = { ...mockCardPEN, id: "card-zero", name: "Zero Card", openingPrincipalBalance: 0 };
    const cardUSDPEN: Debt = { ...mockCardUSD, openingPrincipalBalance: 100 };

    const intelligenceItems = buildDebtIntelligenceItems({
      debts: [cardSmall, cardZero, mockLoanPEN, cardUSDPEN],
      debtEvents: [],
      debtScheduleVersions: [],
      debtInstallments: [],
      debtCollaterals: [],
      debtPlanningItems: [],
    });

    const strategies = buildDebtStrategies(intelligenceItems);
    const snowballPEN = strategies.snowball.byCurrency.PEN;
    const snowballUSD = strategies.snowball.byCurrency.USD;

    // Small (300) before Loan (2000). Zero card (0) is excluded because currentPrincipal <= 0
    expect(snowballPEN).toHaveLength(2);
    expect(snowballPEN[0].debtId).toBe("card-small");
    expect(snowballPEN[0].currentPrincipal).toBe(300);
    expect(snowballPEN[1].debtId).toBe("loan-pen-1");
    expect(snowballPEN[1].currentPrincipal).toBe(2000);

    // USD is isolated
    expect(snowballUSD).toHaveLength(1);
    expect(snowballUSD[0].debtId).toBe("card-usd-1");
  });

  // 3. Avalanche Strategy & Unrated Cards
  it("ranks cards with known rate in Avalanche and marks cards without rate as unrated without assuming 0%", () => {
    const intelligenceItems = buildDebtIntelligenceItems({
      debts: [mockCardPEN, mockCardUSD],
      debtEvents: [],
      debtScheduleVersions: [],
      debtInstallments: [],
      debtCollaterals: [],
      debtPlanningItems: [],
    });

    const strategies = buildDebtStrategies(intelligenceItems);

    // PEN card has TCEA 55%
    const penAvalanche = strategies.avalanche.byCurrency.PEN;
    expect(penAvalanche.tceaCandidates).toHaveLength(1);
    expect(penAvalanche.tceaCandidates[0].ratePercent).toBe(55.0);

    // USD card has no rate -> unknownRateDebtIds, NOT 0%
    const usdAvalanche = strategies.avalanche.byCurrency.USD;
    expect(usdAvalanche.tceaCandidates).toHaveLength(0);
    expect(usdAvalanche.teaCandidates).toHaveLength(0);
    expect(usdAvalanche.unknownRateDebtIds).toContain("card-usd-1");
    expect(usdAvalanche.comparisonMode).toBe("unavailable");
  });

  // 4. Urgency & Statement Alerts Read-Model
  it("builds statement alerts and ranks Urgency using latest closed statement due date", () => {
    const statements: CreditCardStatement[] = [
      {
        id: "stmt-1",
        debtId: "card-pen-1",
        statementDate: "2026-08-20",
        dueDate: "2026-09-05",
        statementBalance: 1500,
        minimumPaymentAmount: 150,
        closingEntryId: null,
        createdByUserId: "user-1",
        createdAt: "2026-08-20T00:00:00Z",
        updatedAt: "2026-08-20T00:00:00Z",
      },
    ];

    const entries: CreditCardEntry[] = [
      {
        id: "entry-stmt-4",
        debtId: "card-pen-1",
        entryDate: "2026-08-15",
        entryType: "purchase",
        liabilityDelta: 1500,
        movementId: "mov-4",
        reversalOfEntryId: null,
        description: "Compra",
        registeredByUserId: "user-1",
        createdAt: "2026-08-15T00:00:00Z",
      },
    ];

    const alerts = buildCreditCardStatementAlerts({
      debts: [mockCardPEN],
      creditCardStatements: statements,
      creditCardEntries: entries,
      todayKey: "2026-09-04", // 1 day before due date -> "tomorrow"
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0].dueStatus).toBe("tomorrow");
    expect(alerts[0].minimumPaymentAmount).toBe(150);
    expect(alerts[0].minimumPaymentKnown).toBe(true);

    const urgentAlerts = selectUrgentCreditCardStatementAlertsForReminder(alerts);
    expect(urgentAlerts).toHaveLength(1);
  });

  // 5. Nullable Minimum Payment Contract
  it("represents null minimum payment as unknown without inventing S/ 0", () => {
    const statements: CreditCardStatement[] = [
      {
        id: "stmt-2",
        debtId: "card-usd-1",
        statementDate: "2026-08-20",
        dueDate: "2026-09-10",
        statementBalance: 500,
        minimumPaymentAmount: null, // Null reported by bank
        closingEntryId: null,
        createdByUserId: "user-1",
        createdAt: "2026-08-20T00:00:00Z",
        updatedAt: "2026-08-20T00:00:00Z",
      },
    ];

    const item = buildCreditCardIntelligenceItem({
      debt: mockCardUSD,
      entries: [],
      statements,
      todayKey: "2026-08-25",
    });

    expect(item.minimumPaymentAmount).toBeNull();
    expect(item.minimumPaymentKnown).toBe(false);

    const alerts = buildCreditCardStatementAlerts({
      debts: [mockCardUSD],
      creditCardStatements: statements,
      todayKey: "2026-08-25",
    });

    expect(alerts[0].minimumPaymentAmount).toBeNull();
    expect(alerts[0].minimumPaymentKnown).toBe(false);
  });

  // 6. Utilization & Credit Limit
  it("calculates utilization ratio without clamping above 100% when over limit", () => {
    const profile: CreditCardProfile = {
      debtId: "card-pen-1",
      creditLimit: 1000,
      closingDay: 20,
      dueDay: 5,
      last4: "1234",
      createdByUserId: "user-1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const entries: CreditCardEntry[] = [
      {
        id: "entry-over",
        debtId: "card-pen-1",
        entryDate: "2026-08-10",
        entryType: "purchase",
        liabilityDelta: 1200,
        movementId: "mov-over",
        reversalOfEntryId: null,
        description: "Compra sobre línea",
        registeredByUserId: "user-1",
        createdAt: "2026-08-10T00:00:00Z",
      },
    ];

    const item = buildCreditCardIntelligenceItem({
      debt: mockCardPEN,
      profile,
      entries,
      statements: [],
    });

    expect(item.currentBalance).toBe(1200);
    expect(item.creditLimit).toBe(1000);
    expect(item.availableCredit).toBe(-200);
    expect(item.utilizationRatio).toBe(1.2); // 120%, NOT clamped to 1.0!
  });

  // 7. Dual Economics in Reports (Cash Flow vs Economic Expense)
  it("correctly separates cashOutflow and economicExpense for card purchases, payments, fees, and credits", () => {
    const purchaseMov: Movement = {
      id: "mov-p",
      date: "2026-08-10",
      type: "egreso",
      amount: 100,
      description: "Compra Visa",
      category: "Supermercado",
      person: "Renzo",
      method: "tarjeta",
      accountId: null,
      movementContext: "credit_card_purchase",
    };

    const paymentMov: Movement = {
      id: "mov-pay",
      date: "2026-08-25",
      type: "egreso",
      amount: 100,
      description: "Pago Visa desde BCP",
      category: "Pago Tarjeta",
      person: "Renzo",
      method: "transferencia",
      accountId: "acc-bcp",
      movementContext: "credit_card_payment",
    };

    const feeMov: Movement = {
      id: "mov-fee",
      date: "2026-08-15",
      type: "egreso",
      amount: 20,
      description: "Membresía Tarjeta",
      category: "Comisiones",
      person: "Renzo",
      method: "tarjeta",
      accountId: null,
      movementContext: "credit_card_fee",
    };

    const creditMov: Movement = {
      id: "mov-cred",
      date: "2026-08-20",
      type: "egreso",
      amount: 40,
      description: "Devolución Supermercado",
      category: "Supermercado",
      person: "Renzo",
      method: "tarjeta",
      accountId: null,
      movementContext: "credit_card_credit",
    };

    expect(getMovementEconomics(purchaseMov, []).economicExpense).toBe(100);
    expect(getMovementEconomics(purchaseMov, []).cashOutflow).toBe(0);

    expect(getMovementEconomics(paymentMov, []).economicExpense).toBe(0);
    expect(getMovementEconomics(paymentMov, []).cashOutflow).toBe(100);

    expect(getMovementEconomics(feeMov, []).economicExpense).toBe(20);
    expect(getMovementEconomics(feeMov, []).cashOutflow).toBe(0);

    expect(getMovementEconomics(creditMov, []).economicExpense).toBe(-40);
    expect(getMovementEconomics(creditMov, []).cashOutflow).toBe(0);

    const totals = movementTotals([purchaseMov, paymentMov, feeMov, creditMov], []);
    expect(totals.expense).toBe(80); // 100 (purchase) + 20 (fee) - 40 (refund) = 80
    expect(totals.cashOutflow).toBe(100); // 100 (payment)
    expect(totals.income).toBe(0); // Targeted refund is NOT income!
  });

  // 8. Category Netting for Targeted Credit / Refund
  it("nets targeted refunds within category without converting to income", () => {
    const purchaseMov: Movement = {
      id: "mov-p",
      date: "2026-08-10",
      type: "egreso",
      amount: 100,
      description: "Supermercado",
      category: "Supermercado",
      person: "Renzo",
      method: "tarjeta",
      accountId: null,
      movementContext: "credit_card_purchase",
    };

    const refundMov: Movement = {
      id: "mov-r",
      date: "2026-08-12",
      type: "egreso",
      amount: 40,
      description: "Devolución Supermercado",
      category: "Supermercado",
      person: "Renzo",
      method: "tarjeta",
      accountId: null,
      movementContext: "credit_card_credit",
    };

    const totals = movementTotals([purchaseMov, refundMov], []);
    expect(totals.expense).toBe(60);
    expect(totals.income).toBe(0);
  });

  // 9. Push Notification Payload Hook
  it("builds factual push notification payload including card statement due reminders", () => {
    const alertItem = {
      debtId: "card-pen-1",
      cardName: "Visa Interbank",
      creditorName: "Interbank",
      currencyCode: "PEN",
      statementId: "stmt-1",
      statementDate: "2026-08-20",
      dueDate: "2026-09-05",
      statementBalance: 1500,
      minimumPaymentAmount: 150,
      minimumPaymentKnown: true,
      daysUntilDue: 1,
      dueStatus: "tomorrow" as const,
      dueLabel: "Vence mañana",
      dueTone: "yellow" as const,
      coverageStatus: "known_unsettled" as const,
      actionable: true,
      statementOutstandingBalance: null,
      dedupeKey: "card-statement-card-pen-1-stmt-1-tomorrow",
    };

    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [],
      urgentDebtInstallments: [],
      urgentCardAlerts: [alertItem],
      today: "2026-09-04",
    });

    expect(payload.title).toBe("Caja Familiar");
    expect(payload.body).toContain("Visa Interbank");
    expect(payload.body).toContain("Pago mínimo:");
    expect(payload.body).toContain("150");
    expect(payload.url).toBe("/?view=deudas");
    expect(payload.tag).toBe("urgent-payments-2026-09-04");
  });

  // 10. Statement Attention Safety Tests (A, B, C, D, E, F, G, H, I)
  it("classifies statement attention and suppresses push & strategy obligations when coverage is unknown or no positive obligation", () => {
    const statement: CreditCardStatement = {
      id: "stmt-safety-1",
      debtId: "card-pen-1",
      statementDate: "2026-08-20",
      dueDate: "2026-09-05",
      statementBalance: 1000,
      minimumPaymentAmount: 150,
      closingEntryId: null,
      createdByUserId: "user-1",
      createdAt: "2026-08-20T00:00:00Z",
      updatedAt: "2026-08-20T00:00:00Z",
    };

    // A. statement balance = 1000, current balance > 0, no post-close settlement -> known_unsettled, actionable = true
    const entriesA: CreditCardEntry[] = [
      {
        id: "entry-a1",
        debtId: "card-pen-1",
        entryDate: "2026-08-15",
        entryType: "purchase",
        liabilityDelta: 1000,
        movementId: "mov-a1",
        reversalOfEntryId: null,
        description: "Compra previa",
        registeredByUserId: "user-1",
        createdAt: "2026-08-15T00:00:00Z",
      },
    ];

    const attA = classifyCreditCardStatementAttention({
      debt: mockCardPEN,
      statement,
      entries: entriesA,
      currentCardBalance: 1000,
    });
    expect(attA.coverageStatus).toBe("known_unsettled");
    expect(attA.actionable).toBe(true);

    // B. payment post-close -> coverage = unknown_after_settlement_activity, actionable = false
    const entriesB: CreditCardEntry[] = [
      ...entriesA,
      {
        id: "entry-b1",
        debtId: "card-pen-1",
        entryDate: "2026-08-25",
        entryType: "payment",
        liabilityDelta: -500,
        movementId: "mov-b1",
        reversalOfEntryId: null,
        description: "Pago post-cierre",
        registeredByUserId: "user-1",
        createdAt: "2026-08-25T00:00:00Z",
      },
    ];

    const attB = classifyCreditCardStatementAttention({
      debt: mockCardPEN,
      statement,
      entries: entriesB,
      currentCardBalance: 500,
    });
    expect(attB.coverageStatus).toBe("unknown_after_settlement_activity");
    expect(attB.actionable).toBe(false);

    // C. post-close payment subsequently reversed -> payment no longer effective -> re-evaluated without payment -> known_unsettled
    const entriesC: CreditCardEntry[] = [
      ...entriesB,
      {
        id: "entry-c1",
        debtId: "card-pen-1",
        entryDate: "2026-08-26",
        entryType: "reversal",
        liabilityDelta: 500,
        movementId: "mov-c1",
        reversalOfEntryId: "entry-b1",
        description: "Anulación de pago",
        registeredByUserId: "user-1",
        createdAt: "2026-08-26T00:00:00Z",
      },
    ];

    const attC = classifyCreditCardStatementAttention({
      debt: mockCardPEN,
      statement,
      entries: entriesC,
      currentCardBalance: 1000,
    });
    expect(attC.coverageStatus).toBe("known_unsettled");
    expect(attC.actionable).toBe(true);

    // D. current card balance = 0 -> no_positive_obligation, actionable = false
    const attD = classifyCreditCardStatementAttention({
      debt: mockCardPEN,
      statement,
      entries: [],
      currentCardBalance: 0,
    });
    expect(attD.coverageStatus).toBe("no_positive_obligation");
    expect(attD.actionable).toBe(false);

    // E. post-close purchase only -> DOES NOT transform statement coverage to unknown
    const entriesE: CreditCardEntry[] = [
      ...entriesA,
      {
        id: "entry-e1",
        debtId: "card-pen-1",
        entryDate: "2026-08-22",
        entryType: "purchase",
        liabilityDelta: 200,
        movementId: "mov-e1",
        reversalOfEntryId: null,
        description: "Compra post-cierre",
        registeredByUserId: "user-1",
        createdAt: "2026-08-22T00:00:00Z",
      },
    ];

    const attE = classifyCreditCardStatementAttention({
      debt: mockCardPEN,
      statement,
      entries: entriesE,
      currentCardBalance: 1200,
    });
    expect(attE.coverageStatus).toBe("known_unsettled");
    expect(attE.actionable).toBe(true);
  });

  // 11. Multi-Currency Resolver & Totals Tests
  it("resolves movement currency code by domain SSOT and prevents PEN + USD cross-currency summation", () => {
    const accPEN: FinancialAccount = {
      id: "acc-pen",
      name: "Cuenta BCP PEN",
      reconciliationType: "balance",
      openingBalance: 1000,
      currencyCode: "PEN",
      isActive: true,
      sortOrder: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const accUSD: FinancialAccount = {
      id: "acc-usd",
      name: "Cuenta BCP USD",
      reconciliationType: "balance",
      openingBalance: 500,
      currencyCode: "USD",
      isActive: true,
      sortOrder: 2,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const movStandardPEN: Movement = {
      id: "mov-std-pen",
      date: "2026-08-10",
      type: "ingreso",
      amount: 100,
      description: "Sueldo PEN",
      category: "Sueldo",
      person: "Renzo",
      method: "transferencia",
      accountId: "acc-pen",
      movementContext: "standard",
    };

    const movStandardUSD: Movement = {
      id: "mov-std-usd",
      date: "2026-08-10",
      type: "ingreso",
      amount: 50,
      description: "Pago USD",
      category: "Honorarios",
      person: "Renzo",
      method: "transferencia",
      accountId: "acc-usd",
      movementContext: "standard",
    };

    const movCardUSD: Movement = {
      id: "mov-card-usd",
      date: "2026-08-12",
      type: "egreso",
      amount: 40,
      description: "Amazon USD",
      category: "Compras",
      person: "Renzo",
      method: "tarjeta",
      accountId: null,
      movementContext: "credit_card_purchase",
    };

    const cardEntryUSD: CreditCardEntry = {
      id: "entry-amazon-usd",
      debtId: "card-usd-1",
      entryDate: "2026-08-12",
      entryType: "purchase",
      liabilityDelta: 40,
      movementId: "mov-card-usd",
      reversalOfEntryId: null,
      description: "Amazon USD",
      registeredByUserId: "user-1",
      createdAt: "2026-08-12T00:00:00Z",
    };

    // Currency Resolution Verification
    expect(resolveMovementCurrencyCode(movStandardPEN, [accPEN, accUSD], [mockCardPEN, mockCardUSD])).toBe("PEN");
    expect(resolveMovementCurrencyCode(movStandardUSD, [accPEN, accUSD], [mockCardPEN, mockCardUSD])).toBe("USD");
    expect(resolveMovementCurrencyCode(movCardUSD, [accPEN, accUSD], [mockCardPEN, mockCardUSD], [], [cardEntryUSD])).toBe("USD");

    // Totals by currency verification
    const res = movementTotalsByCurrency(
      [movStandardPEN, movStandardUSD, movCardUSD],
      [],
      [cardEntryUSD],
      [accPEN, accUSD],
      [mockCardPEN, mockCardUSD]
    );

    expect(res.byCurrency.PEN.income).toBe(100);
    expect(res.byCurrency.USD.income).toBe(50);
    expect(res.byCurrency.USD.expense).toBe(40);
    expect(res.unresolvedMovements).toHaveLength(0);
  });

  // 12. Reversal of Pre-Close Snapshot Entry
  it("marks coverage as unknown when a post-close reversal targets an entry that belonged to the statement snapshot", () => {
    const statement: CreditCardStatement = {
      id: "stmt-reversal-1",
      debtId: "card-pen-1",
      statementDate: "2026-08-20",
      dueDate: "2026-09-05",
      statementBalance: 1000,
      minimumPaymentAmount: 150,
      closingEntryId: null,
      createdByUserId: "user-1",
      createdAt: "2026-08-20T00:00:00Z",
      updatedAt: "2026-08-20T00:00:00Z",
    };

    const preClosePurchase: CreditCardEntry = {
      id: "entry-pre-p",
      debtId: "card-pen-1",
      entryDate: "2026-08-15",
      entryType: "purchase",
      liabilityDelta: 1000,
      movementId: "mov-pre-p",
      reversalOfEntryId: null,
      description: "Compra previa",
      registeredByUserId: "user-1",
      createdAt: "2026-08-15T00:00:00Z",
    };

    const postCloseReversal: CreditCardEntry = {
      id: "entry-post-rev",
      debtId: "card-pen-1",
      entryDate: "2026-08-25",
      entryType: "reversal",
      liabilityDelta: -1000,
      movementId: "mov-post-rev",
      reversalOfEntryId: "entry-pre-p",
      description: "Anulación post-cierre de compra previa",
      registeredByUserId: "user-1",
      createdAt: "2026-08-25T00:00:00Z",
    };

    const att = classifyCreditCardStatementAttention({
      debt: mockCardPEN,
      statement,
      entries: [preClosePurchase, postCloseReversal],
      currentCardBalance: 500, // another balance exists
    });

    expect(att.coverageStatus).toBe("unknown_after_settlement_activity");
    expect(att.actionable).toBe(false);
  });

  // 13. Unresolved Currency Protection
  it("returns null for unresolvable protected context without silently defaulting to PEN", () => {
    const brokenCardMov: Movement = {
      id: "mov-broken-card",
      date: "2026-08-10",
      type: "egreso",
      amount: 200,
      description: "Tarjeta sin entry vinculada",
      category: "Varios",
      person: "Renzo",
      method: "tarjeta",
      accountId: null,
      movementContext: "credit_card_purchase",
    };

    const resolved = resolveMovementCurrencyCode(brokenCardMov, [], []);
    expect(resolved).toBeNull();

    const totals = movementTotalsByCurrency([brokenCardMov], [], [], [], []);
    expect(totals.unresolvedMovements).toHaveLength(1);
    expect(totals.unresolvedMovements[0].id).toBe("mov-broken-card");
    expect(totals.byCurrency.PEN).toBeUndefined();
    expect(totals.byCurrency.USD).toBeUndefined();
  });

  // 14. Cash-Flow Relief 30d Strategy Safety
  it("classifies cards with zero principal or non-actionable statement attention as no_actionable_obligation", () => {
    const cardZeroPrincipal: Debt = {
      ...mockCardPEN,
      id: "card-zero-p",
    };

    const intelItems = buildDebtIntelligenceItems({
      debts: [cardZeroPrincipal],
      debtEvents: [],
      debtScheduleVersions: [],
      debtInstallments: [],
      debtCollaterals: [],
      debtPlanningItems: [],
      creditCardEntries: [],
      todayKey: "2026-08-22",
    });

    const relief = buildCashFlowRelief30dStrategy(intelItems);
    const penStrategy = relief.byCurrency["PEN"];
    expect(penStrategy.rankedCandidates).toHaveLength(0);
    expect(penStrategy.unrankedItems).toHaveLength(1);
    expect(penStrategy.unrankedItems[0].unrankedReason).toBe("no_actionable_obligation");
  });

  // 15. Cash-Flow Relief 30d Outside Horizon Test
  it("classifies card with actionable statement due beyond 30 days as outside_30_day_horizon", () => {
    const card: Debt = {
      ...mockCardPEN,
      id: "card-horizon-1",
    };

    const entry: CreditCardEntry = {
      id: "entry-h1",
      debtId: "card-horizon-1",
      entryDate: "2026-08-01",
      entryType: "purchase",
      liabilityDelta: 300,
      movementId: null,
      reversalOfEntryId: null,
      description: "Compra",
      registeredByUserId: "u1",
      createdAt: "2026-08-01T00:00:00Z",
    };

    const statement: CreditCardStatement = {
      id: "stmt-h1",
      debtId: "card-horizon-1",
      statementDate: "2026-08-10",
      dueDate: "2026-10-10", // 49 days away from 2026-08-22
      statementBalance: 300,
      minimumPaymentAmount: 50,
      closingEntryId: null,
      createdByUserId: "u1",
      createdAt: "2026-08-10T00:00:00Z",
      updatedAt: "2026-08-10T00:00:00Z",
    };

    const intelItems = buildDebtIntelligenceItems({
      debts: [card],
      debtEvents: [],
      debtScheduleVersions: [],
      debtInstallments: [],
      debtCollaterals: [],
      debtPlanningItems: [],
      creditCardEntries: [entry],
      creditCardStatements: [statement],
      todayKey: "2026-08-22",
    });

    const relief = buildCashFlowRelief30dStrategy(intelItems);
    const penStrategy = relief.byCurrency["PEN"];
    expect(penStrategy.rankedCandidates).toHaveLength(0);
    expect(penStrategy.unrankedItems).toHaveLength(1);
    expect(penStrategy.unrankedItems[0].unrankedReason).toBe("outside_30_day_horizon");
  });

  // 16. Excel Category Percentage Denominator Safety Tests
  it("calculates category percentage denominator using positiveCategoryExpenseTotal without NaN or 10000%", () => {
    const accPEN: FinancialAccount = {
      id: "acc-pen",
      name: "Cuenta PEN",
      reconciliationType: "cash",
      currencyCode: "PEN",
      openingBalance: 0,
      isActive: true,
      sortOrder: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    // Case A: Mercado +100, Mercado refund -40 -> net 60 -> 100%
    const movA1: Movement = { id: "m1", date: "2026-08-01", type: "egreso", amount: 100, description: "Super", category: "Mercado", person: "Renzo", method: "efectivo", accountId: "acc-pen", movementContext: "standard" };
    const movA2: Movement = { id: "m2", date: "2026-08-02", type: "egreso", amount: -40, description: "Devolucion Super", category: "Mercado", person: "Renzo", method: "efectivo", accountId: "acc-pen", movementContext: "standard" };

    const rowsA = buildReportCategoryRowsByCurrency([movA1, movA2], [accPEN]);
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0][1]).toBe("Mercado");
    expect(rowsA[0][2]).toBe(60);
    expect(rowsA[0][3]).toBe(1.0); // 100%

    // Case C: Mercado +100, Viajes -100 -> overall expense 0, positive total 100 -> Mercado 100% (not 10000%)
    const movC1: Movement = { id: "mc1", date: "2026-08-01", type: "egreso", amount: 100, description: "Super", category: "Mercado", person: "Renzo", method: "efectivo", accountId: "acc-pen", movementContext: "standard" };
    const movC2: Movement = { id: "mc2", date: "2026-08-02", type: "egreso", amount: -100, description: "Reembolso Viaje", category: "Viajes", person: "Renzo", method: "efectivo", accountId: "acc-pen", movementContext: "standard" };

    const rowsC = buildReportCategoryRowsByCurrency([movC1, movC2], [accPEN]);
    expect(rowsC).toHaveLength(1);
    expect(rowsC[0][1]).toBe("Mercado");
    expect(rowsC[0][2]).toBe(100);
    expect(rowsC[0][3]).toBe(1.0); // 100%, NOT 10000%
  });
});
