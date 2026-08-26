import { describe, expect, it } from "vitest";
import type { Debt } from "../types.js";
import { eligibleCreditCardsForSpending, isCreditCardMovementContext } from "./creditCardSpending.js";

function debt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: "card-1",
    name: "Visa",
    creditorName: "Banco",
    debtKind: "credit_card",
    currencyCode: "PEN",
    originDate: null,
    trackingStartDate: "2026-08-01",
    originalPrincipal: 0,
    openingPrincipalBalance: 0,
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
    createdByUserId: "u1",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("credit card spending source rules", () => {
  it("allows only active, non-archived PEN credit cards", () => {
    const eligible = eligibleCreditCardsForSpending([
      debt({ id: "pen-active" }),
      debt({ id: "usd-active", currencyCode: "USD" }),
      debt({ id: "archived", isArchived: true }),
      debt({ id: "paid-off", status: "paid_off" }),
      debt({ id: "loan", debtKind: "bank_loan" }),
    ]);

    expect(eligible.map((item) => item.id)).toEqual(["pen-active"]);
  });

  it("recognizes all card movements as protected contexts", () => {
    expect(isCreditCardMovementContext("credit_card_purchase")).toBe(true);
    expect(isCreditCardMovementContext("credit_card_payment")).toBe(true);
    expect(isCreditCardMovementContext("credit_card_fee")).toBe(true);
    expect(isCreditCardMovementContext("credit_card_credit")).toBe(true);
    expect(isCreditCardMovementContext("standard")).toBe(false);
  });
});
