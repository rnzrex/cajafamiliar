import { describe, expect, it } from "vitest";
import type {
  CreditCardEntry,
  CreditCardProfile,
  CreditCardStatement,
  Debt,
} from "../types.js";
import {
  buildAllDebtNextActions,
  getCreditCardProfileCompleteness,
  getDebtNextAction,
  getUrgentDebtAttentionItems,
  sortDebtNextActions,
} from "./debtAttention.js";
import type { DebtIntelligenceItem } from "./debtIntelligence.js";

function sampleDebt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: "debt-1",
    name: "Préstamo BCP",
    creditorName: "BCP",
    debtKind: "bank_loan",
    currencyCode: "PEN",
    originDate: "2026-01-01",
    trackingStartDate: "2026-01-01",
    originalPrincipal: 10000,
    openingPrincipalBalance: 10000,
    plannedInstallmentCount: 12,
    plannedInstallmentAmount: 900,
    installmentAmountMode: "fixed",
    paymentFrequency: "monthly",
    customFrequencyDays: null,
    firstDueDate: "2026-02-01",
    teaPercent: 15,
    tceaPercent: 18,
    notes: "",
    status: "active",
    isArchived: false,
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function sampleCardDebt(overrides: Partial<Debt> = {}): Debt {
  return sampleDebt({
    id: "card-debt-1",
    name: "Visa Black",
    creditorName: "Interbank",
    debtKind: "credit_card",
    currencyCode: "USD",
    ...overrides,
  });
}

function sampleStatement(overrides: Partial<CreditCardStatement> = {}): CreditCardStatement {
  return {
    id: "stm-1",
    debtId: "card-debt-1",
    statementDate: "2026-08-20",
    dueDate: "2026-09-05",
    statementBalance: 500,
    minimumPaymentAmount: 50,
    closingEntryId: null,
    createdByUserId: "u1",
    createdAt: "2026-08-20T00:00:00Z",
    updatedAt: "2026-08-20T00:00:00Z",
    ...overrides,
  };
}

function sampleIntelligence(overrides: Partial<DebtIntelligenceItem> = {}): DebtIntelligenceItem {
  return {
    debtId: "debt-1",
    debtKind: "bank_loan",
    currencyCode: "PEN",
    currentPrincipal: 5000,
    originalPrincipal: 10000,
    openingPrincipalBalance: 10000,
    recordedFundPrincipalReduction: 5000,
    nonFundPrincipalDelta: 0,
    balanceReductionPercentFromOriginal: 50,
    historicalEconomics: {
      cashOutflow: 6000,
      principalReduction: 5000,
      economicExpense: 1000,
      interestPaid: 1000,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      knownDetailedCosts: 1000,
      unclassifiedDebtCost: 0,
      fundEventCount: 6,
      paymentCount: 6,
      prepaymentCount: 0,
      payoffCount: 0,
      inconsistentEventCount: 0,
    },
    rateBasis: "tea",
    effectiveAnnualRate: 18,
    readiness: {
      isFullyConfigured: true,
      hasPrincipal: true,
      hasSchedule: true,
      hasRates: true,
      limitations: [],
    },
    currentScheduleVersionId: "s1",
    scheduleReason: "initial",
    scheduleCreationDate: "2026-01-01",
    nextInstallmentNumber: 7,
    nextInstallmentDueDate: "2026-08-20",
    nextInstallmentDueDaysDiff: -3,
    nextInstallmentDueStatus: "overdue",
    nextInstallmentExpectedAmount: 900,
    nextInstallmentRemainingAmount: 900,
    nextInstallmentAmountKnown: true,
    ...overrides,
  };
}

describe("DEBT-5F-B: Debt Attention Intelligence Model", () => {
  describe("Priority hierarchy tests", () => {
    it("1. overdue beats due today", () => {
      const overdueDebt = sampleDebt({ id: "d-overdue", name: "Overdue Loan" });
      const overdueIntel = sampleIntelligence({
        debtId: "d-overdue",
        nextInstallmentDueDate: "2026-08-10",
        nextInstallmentDueStatus: "overdue",
      });

      const dueTodayDebt = sampleDebt({ id: "d-today", name: "Due Today Loan" });
      const dueTodayIntel = sampleIntelligence({
        debtId: "d-today",
        nextInstallmentDueDate: "2026-08-23",
        nextInstallmentDueStatus: "today",
      });

      const actions = buildAllDebtNextActions({
        debts: [dueTodayDebt, overdueDebt],
        intelligenceItems: [dueTodayIntel, overdueIntel],
        todayKey: "2026-08-23",
      });

      expect(actions[0].debtId).toBe("d-overdue");
      expect(actions[0].priority).toBe("overdue");
      expect(actions[1].debtId).toBe("d-today");
      expect(actions[1].priority).toBe("due_today");
    });

    it("2. due today beats upcoming", () => {
      const dueTodayDebt = sampleDebt({ id: "d-today", name: "Due Today Loan" });
      const dueTodayIntel = sampleIntelligence({
        debtId: "d-today",
        nextInstallmentDueDate: "2026-08-23",
        nextInstallmentDueStatus: "today",
      });

      const upcomingDebt = sampleDebt({ id: "d-upcoming", name: "Upcoming Loan" });
      const upcomingIntel = sampleIntelligence({
        debtId: "d-upcoming",
        nextInstallmentDueDate: "2026-09-01",
        nextInstallmentDueStatus: "upcoming",
      });

      const actions = buildAllDebtNextActions({
        debts: [upcomingDebt, dueTodayDebt],
        intelligenceItems: [upcomingIntel, dueTodayIntel],
        todayKey: "2026-08-23",
      });

      expect(actions[0].debtId).toBe("d-today");
      expect(actions[0].priority).toBe("due_today");
      expect(actions[1].debtId).toBe("d-upcoming");
      expect(actions[1].priority).toBe("upcoming");
    });

    it("3. unknown amount remains urgent but monetary amount stays null", () => {
      const debt = sampleDebt({ id: "d-unknown-amt", name: "Variable Installment Loan" });
      const intel = sampleIntelligence({
        debtId: "d-unknown-amt",
        nextInstallmentDueDate: "2026-08-20",
        nextInstallmentDueStatus: "overdue",
        nextInstallmentRemainingAmount: null,
        nextInstallmentAmountKnown: false,
      });

      const action = getDebtNextAction({
        debt,
        intelligenceItem: intel,
        todayKey: "2026-08-23",
      });

      expect(action.priority).toBe("overdue");
      expect(action.resolvedAmount).toBeNull();
      expect(action.isAmountUnknown).toBe(true);
      expect(action.reason).toBe("Monto de cuota por confirmar");
    });

    it("4. incomplete card profile does not outrank real overdue payment", () => {
      const overdueLoan = sampleDebt({ id: "d-overdue" });
      const overdueIntel = sampleIntelligence({
        debtId: "d-overdue",
        nextInstallmentDueStatus: "overdue",
      });

      const incompleteCard = sampleCardDebt({ id: "card-incomplete" });
      const cardProfile: CreditCardProfile = {
        debtId: "card-incomplete",
        creditLimit: null,
        closingDay: null,
        dueDay: null,
        last4: null,
        createdByUserId: "u1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };

      const actions = buildAllDebtNextActions({
        debts: [incompleteCard, overdueLoan],
        intelligenceItems: [overdueIntel],
        creditCardProfiles: [cardProfile],
        todayKey: "2026-08-23",
      });

      expect(actions[0].debtId).toBe("d-overdue");
      expect(actions[0].priority).toBe("overdue");
      expect(actions[1].debtId).toBe("card-incomplete");
      expect(actions[1].priority).toBe("incomplete");
    });

    it("5. paid/covered item is not urgent", () => {
      const coveredCard = sampleCardDebt({ id: "card-covered" });
      const cardProfile: CreditCardProfile = {
        debtId: "card-covered",
        creditLimit: 5000,
        closingDay: 20,
        dueDay: 5,
        last4: "1234",
        createdByUserId: "u1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const paymentEntry: CreditCardEntry = {
        id: "e-pay",
        debtId: "card-covered",
        entryDate: "2026-08-15",
        entryType: "payment",
        liabilityDelta: -500,
        description: "Pago total",
        movementId: "m1",
        creditOfEntryId: null,
        reversalOfEntryId: null,
        registeredByUserId: "u1",
        createdAt: "2026-08-15T00:00:00Z",
      };
      const stm = sampleStatement({
        id: "stm-1",
        debtId: "card-covered",
        statementDate: "2026-08-20",
        dueDate: "2026-09-05",
        statementBalance: 0,
        minimumPaymentAmount: 0,
      });

      const action = getDebtNextAction({
        debt: coveredCard,
        creditCardProfiles: [cardProfile],
        cardStatements: [stm],
        creditCardEntries: [paymentEntry],
        todayKey: "2026-08-23",
      });

      expect(action.priority).toBe("info");
      expect(action.badgeLabel).toBe("Al día");
      expect(getUrgentDebtAttentionItems([action]).length).toBe(0);
    });

    it("6. archived debt is not actionable", () => {
      const archivedCard = sampleCardDebt({ id: "card-archived", isArchived: true });
      const action = getDebtNextAction({ debt: archivedCard });

      expect(action.priority).toBe("info");
      expect(action.badgeLabel).toBe("Archivado");
      expect(action.kind).toBe("none");
      expect(getUrgentDebtAttentionItems([action]).length).toBe(0);
    });
  });

  describe("Multi-currency isolation tests", () => {
    it("compares PEN and USD urgency by date/priority without raw monetary amounts comparison or combined totals", () => {
      const penDebt = sampleDebt({ id: "pen-1", currencyCode: "PEN", name: "PEN Loan" });
      const penIntel = sampleIntelligence({
        debtId: "pen-1",
        currencyCode: "PEN",
        nextInstallmentDueDate: "2026-08-20",
        nextInstallmentDueStatus: "overdue",
        nextInstallmentRemainingAmount: 5000, // S/ 5,000
      });

      const usdDebt = sampleCardDebt({ id: "usd-1", currencyCode: "USD", name: "USD Card" });
      const usdProfile: CreditCardProfile = {
        debtId: "usd-1",
        creditLimit: 10000,
        closingDay: 20,
        dueDay: 5,
        last4: "9999",
        createdByUserId: "u1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const usdStm = sampleStatement({
        id: "stm-usd",
        debtId: "usd-1",
        statementDate: "2026-08-20",
        dueDate: "2026-09-05",
        statementBalance: 100, // $ 100
        minimumPaymentAmount: 100,
      });

      const actions = buildAllDebtNextActions({
        debts: [penDebt, usdDebt],
        intelligenceItems: [penIntel],
        creditCardProfiles: [usdProfile],
        cardStatements: [usdStm],
        todayKey: "2026-08-23",
      });

      // PEN is overdue (rank 1), USD is upcoming (rank 3)
      expect(actions[0].debtId).toBe("pen-1");
      expect(actions[0].currencyCode).toBe("PEN");
      expect(actions[0].resolvedAmount).toBe(5000);

      expect(actions[1].debtId).toBe("usd-1");
      expect(actions[1].currencyCode).toBe("USD");
      expect(actions[1].resolvedAmount).toBe(100);

      // Verify sorting function does not mix currencies or compare 5000 vs 100 directly
      const sorted = sortDebtNextActions(actions);
      expect(sorted[0].currencyCode).toBe("PEN");
      expect(sorted[1].currencyCode).toBe("USD");
    });
  });

  describe("Card statement states", () => {
    it("handles overdue card statement", () => {
      const card = sampleCardDebt();
      const profile: CreditCardProfile = {
        debtId: card.id,
        creditLimit: 5000,
        closingDay: 20,
        dueDay: 5,
        last4: "1234",
        createdByUserId: "u1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const stm = sampleStatement({
        id: "stm-1",
        debtId: card.id,
        statementDate: "2026-07-20",
        dueDate: "2026-08-05",
        statementBalance: 1000,
        minimumPaymentAmount: 100,
      });

      const action = getDebtNextAction({
        debt: card,
        creditCardProfiles: [profile],
        cardStatements: [stm],
        todayKey: "2026-08-23",
      });

      expect(action.kind).toBe("pay_card_statement_overdue");
      expect(action.priority).toBe("overdue");
      expect(action.badgeLabel).toBe("Vencido");
      expect(action.resolvedAmount).toBe(100);
    });

    it("handles statement due today", () => {
      const card = sampleCardDebt();
      const profile: CreditCardProfile = {
        debtId: card.id,
        creditLimit: 5000,
        closingDay: 20,
        dueDay: 23,
        last4: "1234",
        createdByUserId: "u1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const stm = sampleStatement({
        id: "stm-1",
        debtId: card.id,
        statementDate: "2026-08-08",
        dueDate: "2026-08-23",
        statementBalance: 400,
        minimumPaymentAmount: 50,
      });

      const action = getDebtNextAction({
        debt: card,
        creditCardProfiles: [profile],
        cardStatements: [stm],
        todayKey: "2026-08-23",
      });

      expect(action.kind).toBe("pay_card_statement_due");
      expect(action.priority).toBe("due_today");
      expect(action.badgeLabel).toBe("Vence hoy");
    });

    it("handles minimumPaymentAmount null on statement", () => {
      const card = sampleCardDebt();
      const profile: CreditCardProfile = {
        debtId: card.id,
        creditLimit: 5000,
        closingDay: 20,
        dueDay: 28,
        last4: "1234",
        createdByUserId: "u1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const stm = sampleStatement({
        id: "stm-1",
        debtId: card.id,
        statementDate: "2026-08-10",
        dueDate: "2026-08-28",
        statementBalance: 800,
        minimumPaymentAmount: null,
      });

      const action = getDebtNextAction({
        debt: card,
        creditCardProfiles: [profile],
        cardStatements: [stm],
        todayKey: "2026-08-23",
      });

      expect(action.kind).toBe("pay_card_statement_upcoming");
      expect(action.priority).toBe("due_soon");
      expect(action.isAmountUnknown).toBe(true);
      expect(action.resolvedAmount).toBe(800); // Falls back to statementBalance when minimum is null
      expect(action.reason).toBe("No se conoce el pago mínimo");
    });

    it("handles unknown_after_settlement_activity state honestly", () => {
      const card = sampleCardDebt();
      const profile: CreditCardProfile = {
        debtId: card.id,
        creditLimit: 5000,
        closingDay: 20,
        dueDay: 5,
        last4: "1234",
        createdByUserId: "u1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      // Purchase entry ON OR BEFORE statement date
      const snapshotPurchase: CreditCardEntry = {
        id: "e-purch",
        debtId: card.id,
        entryDate: "2026-08-15",
        entryType: "purchase",
        liabilityDelta: 500,
        description: "Initial purchase",
        movementId: "m1",
        creditOfEntryId: null,
        reversalOfEntryId: null,
        registeredByUserId: "u1",
        createdAt: "2026-08-15T00:00:00Z",
      };
      const stm = sampleStatement({
        id: "stm-1",
        debtId: card.id,
        statementDate: "2026-08-20",
        dueDate: "2026-09-05",
        statementBalance: 500,
        minimumPaymentAmount: 50,
      });
      // Credit (refund) recorded AFTER statement close for a purchase in the snapshot
      const postClosingCredit: CreditCardEntry = {
        id: "e-post-credit",
        debtId: card.id,
        entryDate: "2026-08-22",
        entryType: "credit",
        liabilityDelta: -200,
        description: "Post closing refund",
        movementId: "m2",
        creditOfEntryId: "e-purch",
        reversalOfEntryId: null,
        registeredByUserId: "u1",
        createdAt: "2026-08-22T00:00:00Z",
      };

      const action = getDebtNextAction({
        debt: card,
        creditCardProfiles: [profile],
        cardStatements: [stm],
        creditCardEntries: [snapshotPurchase, postClosingCredit],
        todayKey: "2026-08-23",
      });

      expect(action.kind).toBe("review_card_statement_activity");
      expect(action.priority).toBe("incomplete");
      expect(action.badgeLabel).toBe("Revisar estado");
    });
  });

  describe("Profile completeness tests", () => {
    it("detects all known facts", () => {
      const profile: CreditCardProfile = {
        debtId: "card-1",
        creditLimit: 5000,
        closingDay: 20,
        dueDay: 5,
        last4: "1234",
        createdByUserId: "u1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };

      const result = getCreditCardProfileCompleteness(profile);
      expect(result.isComplete).toBe(true);
      expect(result.missingFields).toEqual([]);
      expect(result.statusLabel).toBe("Datos de tarjeta completos");
    });

    it("last4 alone missing does not render profile incomplete for financial operations", () => {
      const profile: CreditCardProfile = {
        debtId: "card-1",
        creditLimit: 5000,
        closingDay: 20,
        dueDay: 5,
        last4: null,
        createdByUserId: "u1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };

      const result = getCreditCardProfileCompleteness(profile);
      expect(result.isComplete).toBe(true);
      expect(result.missingFields).toEqual([]);
    });

    it("detects missing creditLimit, closingDay, dueDay", () => {
      const profile: CreditCardProfile = {
        debtId: "card-1",
        creditLimit: null,
        closingDay: null,
        dueDay: null,
        last4: "1234",
        createdByUserId: "u1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };

      const result = getCreditCardProfileCompleteness(profile);
      expect(result.isComplete).toBe(false);
      expect(result.missingFields).toEqual(["creditLimit", "closingDay", "dueDay"]);
      expect(result.statusLabel).toBe("Falta registrar límite y día de cierre y día de pago");
    });
  });
});
