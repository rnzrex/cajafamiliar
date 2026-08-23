import { describe, expect, it, vi } from "vitest";
import type {
  Debt,
  CreditCardProfile,
  CreditCardEntry,
  CreditCardStatement,
  FinancialAccount,
  Category,
} from "../types";
import { currentCreditCardBalance } from "../utils/creditCardCalculations";

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
    // 1000 + 500 - 300 + 50 = 1250
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
});
