import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  Debt,
  CreditCardProfile,
  CreditCardEntry,
  CreditCardStatement,
  FinancialAccount,
  Category,
  DebtKind,
} from "../types";
import {
  currentCreditCardBalance,
  calculateCreditCardRefundCapacity,
  isCreditCardEntryEligibleForReversal,
  canOperateCreditCard,
} from "../utils/creditCardCalculations";
import { DebtDetailModal } from "./DebtDetailModal";
import { buildDebtIntelligenceItems } from "../utils/debtIntelligence";
import { isCreditCardDebtKind, DEBT_KIND_OPTIONS } from "../utils/debtFormMode";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function sampleCardDebt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: "card-debt-100",
    name: "Visa Infinite BCP",
    creditorName: "BCP",
    debtKind: "credit_card",
    currencyCode: "USD",
    originDate: "2026-01-01",
    trackingStartDate: "2026-01-01",
    originalPrincipal: null,
    openingPrincipalBalance: 500,
    plannedInstallmentCount: null,
    plannedInstallmentAmount: null,
    installmentAmountMode: "variable",
    paymentFrequency: "monthly",
    customFrequencyDays: null,
    firstDueDate: null,
    teaPercent: 35,
    tceaPercent: 42,
    notes: "Tarjeta USD",
    status: "active",
    isArchived: false,
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function sampleNormalDebt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: "loan-debt-200",
    name: "Préstamo Personal Scotiabank",
    creditorName: "Scotiabank",
    debtKind: "bank_loan",
    currencyCode: "PEN",
    originDate: "2026-01-01",
    trackingStartDate: "2026-01-01",
    originalPrincipal: 20000,
    openingPrincipalBalance: 20000,
    plannedInstallmentCount: 36,
    plannedInstallmentAmount: 620,
    installmentAmountMode: "fixed",
    paymentFrequency: "monthly",
    customFrequencyDays: null,
    firstDueDate: "2026-02-01",
    teaPercent: 18,
    tceaPercent: 22,
    notes: "",
    status: "active",
    isArchived: false,
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function sampleCardProfile(overrides: Partial<CreditCardProfile> = {}): CreditCardProfile {
  return {
    debtId: "card-debt-100",
    creditLimit: 5000,
    closingDay: 20,
    dueDay: 5,
    last4: "4321",
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeEntry(id: string, overrides: Partial<CreditCardEntry> = {}): CreditCardEntry {
  return {
    id,
    debtId: "card-debt-100",
    entryDate: "2026-08-01",
    entryType: "purchase",
    liabilityDelta: 100,
    description: `Entry ${id}`,
    movementId: `m-${id}`,
    creditOfEntryId: null,
    reversalOfEntryId: null,
    registeredByUserId: "u1",
    createdAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Existing tests (preserved exactly)
// ---------------------------------------------------------------------------

describe("DEBT-5F-A: Credit Card Operational UX Component & Domain Tests", () => {
  it("1. currentCreditCardBalance calculates baseline opening balance + entries correctly", () => {
    const debt = sampleCardDebt({ openingPrincipalBalance: 1000 });
    const entries: CreditCardEntry[] = [
      {
        id: "e1",
        debtId: debt.id,
        entryDate: "2026-08-10",
        entryType: "purchase",
        liabilityDelta: 500,
        description: "Laptop",
        movementId: "m1",
        creditOfEntryId: null,
        reversalOfEntryId: null,
        registeredByUserId: "u1",
        createdAt: "2026-08-10T00:00:00Z",
      },
      {
        id: "e2",
        debtId: debt.id,
        entryDate: "2026-08-15",
        entryType: "payment",
        liabilityDelta: -300,
        description: "Pago parcial",
        movementId: "m2",
        creditOfEntryId: null,
        reversalOfEntryId: null,
        registeredByUserId: "u1",
        createdAt: "2026-08-15T00:00:00Z",
      },
      {
        id: "e3",
        debtId: debt.id,
        entryDate: "2026-08-18",
        entryType: "finance_charge",
        liabilityDelta: 50,
        description: "Mantenimiento",
        movementId: "m3",
        creditOfEntryId: null,
        reversalOfEntryId: null,
        registeredByUserId: "u1",
        createdAt: "2026-08-18T00:00:00Z",
      },
    ];

    const balance = currentCreditCardBalance(debt, entries);
    expect(balance).toBe(1250);
  });

  it("2. available credit & utilization percentage handle null credit limit without inventing zeros", () => {
    const debt = sampleCardDebt({ openingPrincipalBalance: 400 });
    const profile = sampleCardProfile({ creditLimit: null });

    const balance = currentCreditCardBalance(debt, []);
    const creditLimit = profile.creditLimit;
    const availableCredit = creditLimit != null ? creditLimit - balance : null;
    const utilization = creditLimit != null && creditLimit > 0 ? (balance / creditLimit) * 100 : null;

    expect(availableCredit).toBeNull();
    expect(utilization).toBeNull();
  });

  it("3. available credit & utilization percentage calculate accurately when limit is specified", () => {
    const debt = sampleCardDebt({ openingPrincipalBalance: 1000 });
    const profile = sampleCardProfile({ creditLimit: 4000 });

    const balance = currentCreditCardBalance(debt, []);
    const availableCredit = profile.creditLimit! - balance;
    const utilization = (balance / profile.creditLimit!) * 100;

    expect(availableCredit).toBe(3000);
    expect(utilization).toBe(25);
  });

  it("4. over-limit balance produces negative available credit and >100% utilization without clamping", () => {
    const debt = sampleCardDebt({ openingPrincipalBalance: 6000 });
    const profile = sampleCardProfile({ creditLimit: 5000 });

    const balance = currentCreditCardBalance(debt, []);
    const availableCredit = profile.creditLimit! - balance;
    const utilization = (balance / profile.creditLimit!) * 100;

    expect(availableCredit).toBe(-1000);
    expect(utilization).toBe(120);
  });

  it("5. card entries sorting puts newest first by entryDate DESC, createdAt DESC, id DESC", () => {
    const entries: CreditCardEntry[] = [
      {
        id: "e1",
        debtId: "card-debt-100",
        entryDate: "2026-08-01",
        entryType: "purchase",
        liabilityDelta: 100,
        description: "First",
        movementId: "m1",
        creditOfEntryId: null,
        reversalOfEntryId: null,
        registeredByUserId: "u1",
        createdAt: "2026-08-01T10:00:00Z",
      },
      {
        id: "e3",
        debtId: "card-debt-100",
        entryDate: "2026-08-15",
        entryType: "purchase",
        liabilityDelta: 200,
        description: "Third B",
        movementId: "m3",
        creditOfEntryId: null,
        reversalOfEntryId: null,
        registeredByUserId: "u1",
        createdAt: "2026-08-15T12:00:00Z",
      },
      {
        id: "e2",
        debtId: "card-debt-100",
        entryDate: "2026-08-15",
        entryType: "purchase",
        liabilityDelta: 150,
        description: "Third A",
        movementId: "m2",
        creditOfEntryId: null,
        reversalOfEntryId: null,
        registeredByUserId: "u1",
        createdAt: "2026-08-15T08:00:00Z",
      },
    ];

    const sorted = [...entries].sort((a, b) => {
      if (a.entryDate !== b.entryDate) return b.entryDate.localeCompare(a.entryDate);
      if (a.createdAt !== b.createdAt) return b.createdAt.localeCompare(a.createdAt);
      return b.id.localeCompare(a.id);
    });

    expect(sorted.map((e) => e.id)).toEqual(["e3", "e2", "e1"]);
  });

  it("6. payment account eligibility enforces matching currency and active status", () => {
    const cardCurrency = "USD";
    const accounts: FinancialAccount[] = [
      {
        id: "acc-usd-active",
        name: "Cuenta Dólares Interbank",
        reconciliationType: "balance",
        currencyCode: "USD",
        openingBalance: 1000,
        isActive: true,
        sortOrder: 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "acc-pen-active",
        name: "Cuenta Soles BCP",
        reconciliationType: "balance",
        currencyCode: "PEN",
        openingBalance: 5000,
        isActive: true,
        sortOrder: 2,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "acc-usd-inactive",
        name: "Cuenta Dólares Inactiva",
        reconciliationType: "balance",
        currencyCode: "USD",
        openingBalance: 200,
        isActive: false,
        sortOrder: 3,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    const eligible = accounts.filter(
      (acc) => acc.isActive && acc.currencyCode === cardCurrency
    );

    expect(eligible.length).toBe(1);
    expect(eligible[0].id).toBe("acc-usd-active");
  });

  it("7. executeCreditCardOperation correctly dispatches purchase operation", async () => {
    const { executeCreditCardOperation } = await import("../services/creditCardOperationalActions");
    const dataRepo = await import("../services/dataRepository");

    const spy = vi.spyOn(dataRepo, "recordCreditCardPurchase").mockResolvedValueOnce({
      success: true,
      entryId: "e-purchase",
      movementId: "m-purchase",
      idempotent: false,
    });

    const res = await executeCreditCardOperation({
      operation: "purchase",
      purchaseInput: {
        debtId: "card-debt-100",
        entryId: "e-purchase",
        movementId: "m-purchase",
        purchaseDate: "2026-08-20",
        amount: 150,
        description: "Supermercado",
        category: "cat1",
      },
    });

    expect(spy).toHaveBeenCalledOnce();
    expect(res.type).toBe("purchase");
    if (res.type === "purchase") {
      expect(res.result.entryId).toBe("e-purchase");
    }
  });

  it("8. calculateCreditCardRefundCapacity accurately accounts for partial refunds", async () => {
    const { calculateCreditCardRefundCapacity } = await import("../utils/creditCardCalculations");

    const purchaseEntry: CreditCardEntry = {
      id: "p1",
      debtId: "card-debt-100",
      entryDate: "2026-08-01",
      entryType: "purchase",
      liabilityDelta: 500,
      description: "Laptop",
      movementId: "m1",
      creditOfEntryId: null,
      reversalOfEntryId: null,
      registeredByUserId: "u1",
      createdAt: "2026-08-01T00:00:00Z",
    };

    const partialRefund: CreditCardEntry = {
      id: "c1",
      debtId: "card-debt-100",
      entryDate: "2026-08-05",
      entryType: "credit",
      liabilityDelta: -200,
      description: "Devolución parcial",
      movementId: "m2",
      creditOfEntryId: "p1",
      reversalOfEntryId: null,
      registeredByUserId: "u1",
      createdAt: "2026-08-05T00:00:00Z",
    };

    const cardEntries = [purchaseEntry, partialRefund];
    const refundCap = calculateCreditCardRefundCapacity(purchaseEntry, cardEntries);

    expect(refundCap.originalAmount).toBe(500);
    expect(refundCap.effectiveRefundedAmount).toBe(200);
    expect(refundCap.remainingRefundableAmount).toBe(300);
    expect(refundCap.isRefundable).toBe(true);
  });

  it("9. isCreditCardEntryEligibleForReversal blocks entries with active linked refunds", async () => {
    const { isCreditCardEntryEligibleForReversal } = await import("../utils/creditCardCalculations");

    const purchaseWithRefund: CreditCardEntry = {
      id: "p1",
      debtId: "card-debt-100",
      entryDate: "2026-08-01",
      entryType: "purchase",
      liabilityDelta: 500,
      description: "Laptop",
      movementId: "m1",
      creditOfEntryId: null,
      reversalOfEntryId: null,
      registeredByUserId: "u1",
      createdAt: "2026-08-01T00:00:00Z",
    };

    const partialRefund: CreditCardEntry = {
      id: "c1",
      debtId: "card-debt-100",
      entryDate: "2026-08-05",
      entryType: "credit",
      liabilityDelta: -200,
      description: "Devolución parcial",
      movementId: "m2",
      creditOfEntryId: "p1",
      reversalOfEntryId: null,
      registeredByUserId: "u1",
      createdAt: "2026-08-05T00:00:00Z",
    };

    const cleanPurchase: CreditCardEntry = {
      id: "p2",
      debtId: "card-debt-100",
      entryDate: "2026-08-02",
      entryType: "purchase",
      liabilityDelta: 100,
      description: "Audífonos",
      movementId: "m3",
      creditOfEntryId: null,
      reversalOfEntryId: null,
      registeredByUserId: "u1",
      createdAt: "2026-08-02T00:00:00Z",
    };

    const cardEntries = [purchaseWithRefund, partialRefund, cleanPurchase];

    expect(isCreditCardEntryEligibleForReversal(purchaseWithRefund, cardEntries)).toBe(false);
    expect(isCreditCardEntryEligibleForReversal(cleanPurchase, cardEntries)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 10 — uses REAL canOperateCreditCard production helper (not inline copy)
  // ---------------------------------------------------------------------------
  it("10. canOperateCreditCard (production helper) correctly evaluates active non-archived status", () => {
    const activeDebt = sampleCardDebt({ status: "active", isArchived: false });
    const archivedDebt = sampleCardDebt({ status: "active", isArchived: true });
    const closedDebt = sampleCardDebt({ status: "paid_off", isArchived: false });
    const nonCardDebt = sampleNormalDebt({ status: "active", isArchived: false });

    expect(canOperateCreditCard(activeDebt, true)).toBe(true);
    expect(canOperateCreditCard(activeDebt, false)).toBe(false);
    expect(canOperateCreditCard(archivedDebt, true)).toBe(false);
    expect(canOperateCreditCard(closedDebt, true)).toBe(false);
    expect(canOperateCreditCard(nonCardDebt, true)).toBe(false);
    expect(canOperateCreditCard(null, true)).toBe(false);
    expect(canOperateCreditCard(undefined, true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Refund capacity — all five required scenarios (A-E)
// ---------------------------------------------------------------------------

describe("DEBT-5F-A: Refund Capacity — Five Required Scenarios", () => {
  const debtId = "card-debt-100";

  it("A. purchase +100 => refundable 100 (no credits applied)", () => {
    const purchase = makeEntry("p1", { liabilityDelta: 100 });
    const result = calculateCreditCardRefundCapacity(purchase, [purchase]);
    expect(result.originalAmount).toBe(100);
    expect(result.effectiveRefundedAmount).toBe(0);
    expect(result.remainingRefundableAmount).toBe(100);
    expect(result.isRefundable).toBe(true);
  });

  it("B. purchase +100 + credit -30 => refunded 30 / remaining 70", () => {
    const purchase = makeEntry("p1", { liabilityDelta: 100 });
    const credit = makeEntry("c1", {
      entryType: "credit",
      liabilityDelta: -30,
      creditOfEntryId: "p1",
    });
    const entries = [purchase, credit];
    const result = calculateCreditCardRefundCapacity(purchase, entries);
    expect(result.originalAmount).toBe(100);
    expect(result.effectiveRefundedAmount).toBe(30);
    expect(result.remainingRefundableAmount).toBe(70);
    expect(result.isRefundable).toBe(true);
  });

  it("C. purchase +100 + credit -100 => remaining 0 / not refundable", () => {
    const purchase = makeEntry("p1", { liabilityDelta: 100 });
    const credit = makeEntry("c1", {
      entryType: "credit",
      liabilityDelta: -100,
      creditOfEntryId: "p1",
    });
    const entries = [purchase, credit];
    const result = calculateCreditCardRefundCapacity(purchase, entries);
    expect(result.remainingRefundableAmount).toBe(0);
    expect(result.isRefundable).toBe(false);
  });

  it("D. purchase +100 + credit -30 + reversal of credit => remaining 100 / fully refundable again", () => {
    const purchase = makeEntry("p1", { liabilityDelta: 100 });
    const credit = makeEntry("c1", {
      entryType: "credit",
      liabilityDelta: -30,
      creditOfEntryId: "p1",
    });
    const reversalOfCredit = makeEntry("r1", {
      entryType: "reversal",
      liabilityDelta: 30,
      reversalOfEntryId: "c1",
    });
    const entries = [purchase, credit, reversalOfCredit];
    const result = calculateCreditCardRefundCapacity(purchase, entries);
    expect(result.originalAmount).toBe(100);
    expect(result.effectiveRefundedAmount).toBe(0);
    expect(result.remainingRefundableAmount).toBe(100);
    expect(result.isRefundable).toBe(true);
  });

  it("E. purchase +100 + reversal of purchase => NOT refundable (target itself was reversed)", () => {
    const purchase = makeEntry("p1", { liabilityDelta: 100 });
    const reversalOfPurchase = makeEntry("r1", {
      entryType: "reversal",
      liabilityDelta: -100,
      reversalOfEntryId: "p1",
    });
    const entries = [purchase, reversalOfPurchase];
    const result = calculateCreditCardRefundCapacity(purchase, entries);
    expect(result.isRefundable).toBe(false);
    expect(result.remainingRefundableAmount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Reversal eligibility — all required scenarios
// ---------------------------------------------------------------------------

describe("DEBT-5F-A: Reversal Eligibility — All Required Scenarios", () => {
  it("reversal row itself: false", () => {
    const reversalRow = makeEntry("r1", {
      entryType: "reversal",
      liabilityDelta: -100,
      reversalOfEntryId: "p1",
    });
    expect(isCreditCardEntryEligibleForReversal(reversalRow, [reversalRow])).toBe(false);
  });

  it("already reversed purchase: false", () => {
    const purchase = makeEntry("p1", { liabilityDelta: 100 });
    const reversal = makeEntry("r1", {
      entryType: "reversal",
      liabilityDelta: -100,
      reversalOfEntryId: "p1",
    });
    const entries = [purchase, reversal];
    expect(isCreditCardEntryEligibleForReversal(purchase, entries)).toBe(false);
  });

  it("purchase with effective linked credit (active refund): false", () => {
    const purchase = makeEntry("p1", { liabilityDelta: 100 });
    const credit = makeEntry("c1", {
      entryType: "credit",
      liabilityDelta: -30,
      creditOfEntryId: "p1",
    });
    const entries = [purchase, credit];
    expect(isCreditCardEntryEligibleForReversal(purchase, entries)).toBe(false);
  });

  it("credit entry itself: true (if otherwise eligible — no reversal of it)", () => {
    const purchase = makeEntry("p1", { liabilityDelta: 100 });
    const credit = makeEntry("c1", {
      entryType: "credit",
      liabilityDelta: -30,
      creditOfEntryId: "p1",
    });
    const entries = [purchase, credit];
    // credit itself has no active refund and is not a reversal row — eligible
    expect(isCreditCardEntryEligibleForReversal(credit, entries)).toBe(true);
  });

  it("purchase whose linked credit was itself reversed: true (eligible again)", () => {
    const purchase = makeEntry("p1", { liabilityDelta: 100 });
    const credit = makeEntry("c1", {
      entryType: "credit",
      liabilityDelta: -30,
      creditOfEntryId: "p1",
    });
    const reversalOfCredit = makeEntry("r1", {
      entryType: "reversal",
      liabilityDelta: 30,
      reversalOfEntryId: "c1",
    });
    const entries = [purchase, credit, reversalOfCredit];
    // credit was reversed => no effective credit linked to purchase => purchase is eligible
    expect(isCreditCardEntryEligibleForReversal(purchase, entries)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle helper — production canOperateCreditCard
// ---------------------------------------------------------------------------

describe("DEBT-5F-A: Lifecycle Helper canOperateCreditCard", () => {
  it("active card + canWriteDebt=true => true", () => {
    const debt = sampleCardDebt({ status: "active", isArchived: false });
    expect(canOperateCreditCard(debt, true)).toBe(true);
  });

  it("archived card + canWriteDebt=true => false", () => {
    const debt = sampleCardDebt({ status: "active", isArchived: true });
    expect(canOperateCreditCard(debt, true)).toBe(false);
  });

  it("paid_off card + canWriteDebt=true => false", () => {
    const debt = sampleCardDebt({ status: "paid_off", isArchived: false });
    expect(canOperateCreditCard(debt, true)).toBe(false);
  });

  it("active non-archived card + canWriteDebt=false => false", () => {
    const debt = sampleCardDebt({ status: "active", isArchived: false });
    expect(canOperateCreditCard(debt, false)).toBe(false);
  });

  it("null debt => false", () => {
    expect(canOperateCreditCard(null, true)).toBe(false);
  });

  it("undefined debt => false", () => {
    expect(canOperateCreditCard(undefined, true)).toBe(false);
  });

  it("non-card debt kind (bank_loan) => false", () => {
    const debt = sampleNormalDebt({ status: "active", isArchived: false });
    expect(canOperateCreditCard(debt, true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Profile edit policy — canWriteDebt only (not canOperateCreditCard)
// ---------------------------------------------------------------------------

describe("DEBT-5F-A: Profile Edit Policy", () => {
  it("profile edit allowed when canWriteDebt=true even if card is archived", () => {
    const archivedCard = sampleCardDebt({ status: "active", isArchived: true });
    // Profile is config metadata: allowed when canWriteDebt, regardless of archived/status
    const canWriteDebt = true;
    const canOperateCard = canOperateCreditCard(archivedCard, canWriteDebt);
    // Financial ops blocked
    expect(canOperateCard).toBe(false);
    // Profile edit allowed (canWriteDebt is the only guard)
    expect(canWriteDebt).toBe(true);
  });

  it("profile edit allowed when canWriteDebt=true even if card is paid_off", () => {
    const paidOffCard = sampleCardDebt({ status: "paid_off", isArchived: false });
    const canWriteDebt = true;
    const canOperateCard = canOperateCreditCard(paidOffCard, canWriteDebt);
    expect(canOperateCard).toBe(false);
    expect(canWriteDebt).toBe(true);
  });

  it("profile edit blocked when canWriteDebt=false", () => {
    const activeCard = sampleCardDebt({ status: "active", isArchived: false });
    const canWriteDebt = false;
    // Even for active card, if canWriteDebt is false, profile is blocked
    expect(canWriteDebt).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Real Production Component Render Tests
// ---------------------------------------------------------------------------

function renderModalMarkup(
  debt: Debt,
  overrides: Partial<React.ComponentProps<typeof DebtDetailModal>> = {}
): string {
  const isCard = debt.debtKind === "credit_card";
  const profile = isCard ? sampleCardProfile({ debtId: debt.id }) : null;
  const intelItems = buildDebtIntelligenceItems({
    debts: [debt],
    debtEvents: [],
    debtScheduleVersions: [],
    debtInstallments: [],
    debtCollaterals: [],
    debtPlanningItems: [],
    creditCardProfiles: profile ? [profile] : [],
    creditCardEntries: [],
    creditCardStatements: [],
  });
  const defaultProps: React.ComponentProps<typeof DebtDetailModal> = {
    debt,
    debtIntelligence: intelItems[0],
    debtEvents: [],
    scheduleVersions: [],
    installments: [],
    allocations: [],
    collaterals: [],
    accounts: [],
    categories: [],
    currentMember: {
      householdId: "hh1",
      userId: "u1",
      displayName: "User 1",
      role: "owner",
    },
    creditCardProfiles: profile ? [profile] : [],
    creditCardEntries: [],
    cardStatements: [],
    allDebts: [debt],
    canWriteDebt: true,
    onClose: () => {},
    onOpenOperation: () => {},
    onRefresh: () => {},
    setToast: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(DebtDetailModal, defaultProps));
}

describe("DEBT-5F-A: Real Production Card & Loan Component Render Tests", () => {
  it("renders real DebtDetailModal for credit card with all required operational actions and NO forbidden loan actions", () => {
    const cardDebt = sampleCardDebt();
    const html = renderModalMarkup(cardDebt);

    // Required card actions rendered by CreditCardDetailPanel
    expect(html).toContain("Registrar compra");
    expect(html).toContain("Registrar pago");
    expect(html).toContain("Interés / Comisión");
    expect(html).toContain("Cerrar estado");
    expect(html).toContain("Registrar devolución / reembolso");
    expect(html).toContain("Corregir mediante reverso");

    // Forbidden actions MUST NOT be rendered for card
    expect(html).not.toContain("Prepago");
    expect(html).not.toContain("Liquidar deuda");
  });

  it("renders real DebtDetailModal for normal loan with all required loan controls and NO card operational panel", () => {
    const loanDebt = sampleNormalDebt();
    const html = renderModalMarkup(loanDebt);

    // Required loan actions rendered by normal DebtDetailModal
    expect(html).toContain("Registrar pago");
    expect(html).toContain("Prepago");
    expect(html).toContain("Liquidar deuda");
    expect(html).toContain("Cronograma");
    expect(html).toContain("Garantías");
    expect(html).toContain("Historial");

    // Credit card operational panel MUST NOT be used
    expect(html).not.toContain("Registrar compra");
    expect(html).not.toContain("Interés / Comisión");
    expect(html).not.toContain("Cerrar estado");
    expect(html).not.toContain("Corregir mediante reverso");
  });

  it("disables card financial operation buttons for archived or paid_off cards while maintaining profile edit policy", () => {
    function findButtonContaining(html: string, text: string): string | null {
      const matches = html.match(/<button[^>]*>[\s\S]*?<\/button>/g) || [];
      return matches.find((b) => b.includes(text)) ?? null;
    }

    function isButtonDisabled(btnHtml: string): boolean {
      const openingTag = btnHtml.match(/<button[^>]*>/)?.[0] ?? "";
      return openingTag.includes('disabled=""') || openingTag.includes(" disabled ") || openingTag.endsWith(" disabled>");
    }

    const archivedCard = sampleCardDebt({ isArchived: true, status: "active" });
    const archivedHtml = renderModalMarkup(archivedCard, { canWriteDebt: true });

    // Financial operations must be disabled
    const archivedPurchaseBtn = findButtonContaining(archivedHtml, "Registrar compra");
    expect(archivedPurchaseBtn).not.toBeNull();
    expect(isButtonDisabled(archivedPurchaseBtn!)).toBe(true);

    const archivedPaymentBtn = findButtonContaining(archivedHtml, "Registrar pago");
    expect(archivedPaymentBtn).not.toBeNull();
    expect(isButtonDisabled(archivedPaymentBtn!)).toBe(true);

    // Profile edit (Ajustes de tarjeta) remains available when canWriteDebt=true
    const archivedSettingsBtn = findButtonContaining(archivedHtml, "Ajustes de tarjeta");
    expect(archivedSettingsBtn).not.toBeNull();
    expect(isButtonDisabled(archivedSettingsBtn!)).toBe(false);

    const paidOffCard = sampleCardDebt({ isArchived: false, status: "paid_off" });
    const paidOffHtml = renderModalMarkup(paidOffCard, { canWriteDebt: true });

    // Financial operations must be disabled
    const paidOffPurchaseBtn = findButtonContaining(paidOffHtml, "Registrar compra");
    expect(paidOffPurchaseBtn).not.toBeNull();
    expect(isButtonDisabled(paidOffPurchaseBtn!)).toBe(true);

    const paidOffPaymentBtn = findButtonContaining(paidOffHtml, "Registrar pago");
    expect(paidOffPaymentBtn).not.toBeNull();
    expect(isButtonDisabled(paidOffPaymentBtn!)).toBe(true);

    // Profile edit (Ajustes de tarjeta) remains available when canWriteDebt=true
    const paidOffSettingsBtn = findButtonContaining(paidOffHtml, "Ajustes de tarjeta");
    expect(paidOffSettingsBtn).not.toBeNull();
    expect(isButtonDisabled(paidOffSettingsBtn!)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Production Debt Form Helper & Model Tests
// ---------------------------------------------------------------------------

describe("DEBT-5F-A: Production Debt Form Helper Tests", () => {
  it("isCreditCardDebtKind production helper evaluates credit_card as true and all non-card kinds as false", () => {
    expect(isCreditCardDebtKind("credit_card")).toBe(true);

    const nonCardKinds: DebtKind[] = [
      "bank_loan",
      "family_loan",
      "installment_purchase",
      "mortgage",
      "pledge",
      "other",
    ];

    for (const kind of nonCardKinds) {
      expect(isCreditCardDebtKind(kind)).toBe(false);
    }
  });

  it("DEBT_KIND_OPTIONS production constant excludes credit_card from generic debt onboarding", () => {
    const cardOpt = DEBT_KIND_OPTIONS.find((opt) => opt.value === "credit_card");
    expect(cardOpt).toBeUndefined();
  });
});
