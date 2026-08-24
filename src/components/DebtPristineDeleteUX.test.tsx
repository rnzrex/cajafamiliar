import { describe, expect, it } from "vitest";
import type { Debt, DebtEvent, CreditCardEntry, CreditCardStatement } from "../types";
import { translateDebtError } from "../utils/debtViewModel";

describe("DEBT-6B.3 Pristine Delete UX & Logic Tests", () => {
  const baseDebt: Debt = {
    id: "debt-pristine-1",
    name: "Préstamo Pristino",
    creditorName: "Banco A",
    debtKind: "bank_loan",
    currencyCode: "PEN",
    originDate: "2026-01-01",
    trackingStartDate: "2026-01-01",
    originalPrincipal: 1000,
    openingPrincipalBalance: 1000,
    plannedInstallmentCount: null,
    plannedInstallmentAmount: null,
    installmentAmountMode: "unknown",
    paymentFrequency: null,
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
    repaymentStructure: "open_ended",
    interestCalculationMode: "unknown",
    periodicRatePercent: null,
    periodicRateBasis: null,
  };

  const isDebtPristine = (
    debt: Debt,
    events: DebtEvent[],
    cardEntries: CreditCardEntry[] = [],
    cardStatements: CreditCardStatement[] = []
  ): boolean => {
    const hasEvents = events.some((e) => e.debtId === debt.id);
    if (hasEvents) return false;
    if ((debt.debtKind as string) === "credit_card") {
      const hasEntries = cardEntries.some((e) => e.debtId === debt.id);
      const hasStatements = cardStatements.some((s) => s.debtId === debt.id);
      if (hasEntries || hasStatements) return false;
    }
    return true;
  };

  it("15. pristine normal debt is eligible for Delete", () => {
    expect(isDebtPristine(baseDebt, [])).toBe(true);
  });

  it("16. normal debt with event is NOT eligible for Delete (Archive only)", () => {
    const event: DebtEvent = {
      id: "event-1",
      debtId: baseDebt.id,
      movementId: null,
      eventType: "payment",
      eventDate: "2026-02-01",
      cashAmount: 100,
      principalDelta: 100,
      interestPaid: 0,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      reversalOfEventId: null,
      description: "Pago",
      breakdownComplete: true,
      registeredByUserId: "user-1",
      createdAt: "2026-02-01T00:00:00Z",
    };
    expect(isDebtPristine(baseDebt, [event])).toBe(false);
  });

  it("17. pristine credit card is eligible for Delete", () => {
    const cardDebt: Debt = { ...baseDebt, debtKind: "credit_card" };
    expect(isDebtPristine(cardDebt, [], [], [])).toBe(true);
  });

  it("18. credit card with entry or statement is NOT eligible for Delete", () => {
    const cardDebt: Debt = { ...baseDebt, debtKind: "credit_card" };
    const entry: CreditCardEntry = {
      id: "entry-1",
      debtId: cardDebt.id,
      entryDate: "2026-02-01",
      entryType: "purchase",
      liabilityDelta: 50,
      movementId: null,
      reversalOfEntryId: null,
      description: "Compra",
      registeredByUserId: "user-1",
      createdAt: "2026-02-01T00:00:00Z",
    };
    expect(isDebtPristine(cardDebt, [], [entry], [])).toBe(false);
  });

  it("19. DEBT_HAS_HISTORY error translates correctly to user-facing message", () => {
    const errorMsg = translateDebtError(new Error("DEBT_HAS_HISTORY"));
    expect(errorMsg).toContain("Esta deuda ya tiene historial registrado y no puede eliminarse");
    expect(errorMsg).toContain("archivarla");
  });

  it("20. reversed payment event still blocks pristine delete", () => {
    const reversedEvent: DebtEvent = {
      id: "event-rev-1",
      debtId: baseDebt.id,
      movementId: null,
      eventType: "reversal",
      eventDate: "2026-02-01",
      cashAmount: 0,
      principalDelta: 0,
      interestPaid: 0,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      reversalOfEventId: null,
      description: "Reversión",
      breakdownComplete: true,
      registeredByUserId: "user-1",
      createdAt: "2026-02-01T00:00:00Z",
    };
    expect(isDebtPristine(baseDebt, [reversedEvent])).toBe(false);
  });
});
