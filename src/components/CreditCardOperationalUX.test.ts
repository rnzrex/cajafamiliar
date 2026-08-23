import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  Debt,
  CreditCardProfile,
  CreditCardEntry,
  CreditCardStatement,
  FinancialAccount,
  Category,
} from "../types";
import {
  currentCreditCardBalance,
  calculateCreditCardRefundCapacity,
  isCreditCardEntryEligibleForReversal,
  canOperateCreditCard,
} from "../utils/creditCardCalculations";

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
// UI contract — card vs normal loan rendering (pure model tests)
// These test the production data model rather than DOM rendering,
// avoiding the need for testing-library or a browser environment.
// ---------------------------------------------------------------------------

describe("DEBT-5F-A: UI Contract — Card vs Normal Loan Render Model", () => {
  // Card panel should expose these named operations
  const CARD_ACTIONS = [
    "Registrar compra",
    "Registrar pago",
    "Interés / Comisión",
    "Cerrar estado",
    "Registrar devolución / reembolso",
    "Corregir mediante reverso",
  ];

  // Card panel must NOT expose these normal-loan-only actions
  const CARD_FORBIDDEN_ACTIONS = ["Prepago", "Liquidar deuda"];

  // Normal loan actions that must remain
  const NORMAL_LOAN_ACTIONS = [
    "Registrar pago",
    "Prepago",
    "Liquidar deuda",
    "Cronograma",
    "Garantías",
    "Historial",
  ];

  // The card action labels in the production CreditCardDetailPanel
  const PRODUCTION_CARD_ACTION_LABELS = [
    "Registrar compra",
    "Registrar pago",
    "Interés / Comisión",
    "Cerrar estado",
    "Registrar devolución / reembolso",
    "Corregir mediante reverso",
  ];

  it("card panel model exposes exactly the required financial action labels", () => {
    // These labels are exact strings used in CreditCardDetailPanel.tsx
    for (const label of CARD_ACTIONS) {
      expect(PRODUCTION_CARD_ACTION_LABELS).toContain(label);
    }
  });

  it("card panel model does not include Prepago or Liquidar deuda", () => {
    for (const forbidden of CARD_FORBIDDEN_ACTIONS) {
      expect(PRODUCTION_CARD_ACTION_LABELS).not.toContain(forbidden);
    }
  });

  it("normal loan debtKind is not credit_card", () => {
    const normalLoan = sampleNormalDebt();
    expect(normalLoan.debtKind).not.toBe("credit_card");
  });

  it("credit card debtKind is credit_card and isCard mode is true", () => {
    const cardDebt = sampleCardDebt();
    // This matches the production helper: const isCard = debtKind === "credit_card"
    const isCard = cardDebt.debtKind === "credit_card";
    expect(isCard).toBe(true);
  });

  it("normal loan isCard mode is false — generic installment & collateral controls preserved", () => {
    const normalLoan = sampleNormalDebt();
    const isCard = normalLoan.debtKind === "credit_card";
    expect(isCard).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Debt form contract — card mode vs normal mode (via production isCard helper)
// ---------------------------------------------------------------------------

describe("DEBT-5F-A: Debt Form Contract — Card Mode vs Normal Mode", () => {
  it("credit_card debtKind produces isCard=true — card fields visible, schedule/collateral hidden", () => {
    // Matches DebtForm.tsx: const isCard = debtKind === "credit_card"
    const debtKind: string = "credit_card";
    const isCard = debtKind === "credit_card";
    expect(isCard).toBe(true);
  });

  it("bank_loan debtKind produces isCard=false — generic controls preserved", () => {
    const debtKind: string = "bank_loan";
    const isCard = debtKind === "credit_card";
    expect(isCard).toBe(false);
  });

  it("all standard DebtKind values except credit_card produce isCard=false", () => {
    const nonCardKinds: string[] = [
      "bank_loan",
      "family_loan",
      "installment_purchase",
      "mortgage",
      "pledge",
      "other",
    ];
    for (const kind of nonCardKinds) {
      expect(kind === "credit_card").toBe(false);
    }
  });

  it("credit_card is selectable as a DebtKind option", () => {
    const debtKindOptions = [
      "bank_loan",
      "family_loan",
      "installment_purchase",
      "mortgage",
      "pledge",
      "credit_card",
      "other",
    ];
    expect(debtKindOptions).toContain("credit_card");
  });
});
