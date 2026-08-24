import { describe, expect, it } from "vitest";
import type { Debt } from "../types";
import { calculateAssistedInterestSuggestion } from "./debtInterestEngine";

describe("DEBT-6B Assisted Interest Engine Tests", () => {
  const baseDebt: Debt = {
    id: "debt-1",
    name: "Empeño Laptop",
    creditorName: "Casa de Empeño",
    debtKind: "pledge",
    currencyCode: "PEN",
    originDate: "2026-01-01",
    trackingStartDate: "2026-01-01",
    originalPrincipal: 5000,
    openingPrincipalBalance: 5000,
    plannedInstallmentCount: null,
    plannedInstallmentAmount: null,
    installmentAmountMode: "unknown",
    paymentFrequency: null,
    customFrequencyDays: null,
    firstDueDate: null,
    teaPercent: null,
    tceaPercent: 72.4,
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

  it("1. calculates contractual monthly interest (4% on S/ 5,000 -> S/ 200 interest, S/ 100 principal)", () => {
    const debt: Debt = {
      ...baseDebt,
      interestCalculationMode: "contract_periodic_rate",
      periodicRatePercent: 4,
      periodicRateBasis: "monthly",
    };

    const suggestion = calculateAssistedInterestSuggestion({
      debt,
      currentPrincipal: 5000,
      paymentDate: "2026-02-01",
      cashAmount: 300,
    });

    expect(suggestion.calcInterest).toBe(200);
    expect(suggestion.suggestedInterest).toBe(200);
    expect(suggestion.suggestedPrincipal).toBe(100);
    expect(suggestion.principalAfterPayment).toBe(4900);
    expect(suggestion.certainty).toBe("exact_rate");
    expect(suggestion.calculationExplanation).toContain("4% mensual");
    expect(suggestion.warningMessage).toBeNull();
  });

  it("2. handles payment smaller than calculated interest without negative principal", () => {
    const debt: Debt = {
      ...baseDebt,
      interestCalculationMode: "contract_periodic_rate",
      periodicRatePercent: 4,
      periodicRateBasis: "monthly",
    };

    const suggestion = calculateAssistedInterestSuggestion({
      debt,
      currentPrincipal: 5000,
      paymentDate: "2026-02-01",
      cashAmount: 150,
    });

    expect(suggestion.calcInterest).toBe(200);
    expect(suggestion.suggestedInterest).toBe(150);
    expect(suggestion.suggestedPrincipal).toBe(0);
    expect(suggestion.principalAfterPayment).toBe(5000);
    expect(suggestion.warningMessage).toContain("no cubre el interés calculado");
  });

  it("3. TEA actual-day mathematical estimate displays estimate label and does NOT use TCEA", () => {
    const debt: Debt = {
      ...baseDebt,
      interestCalculationMode: "tea_estimate",
      teaPercent: 60.1,
      tceaPercent: 85.5, // TCEA present but must NOT be used for interest
    };

    const suggestion = calculateAssistedInterestSuggestion({
      debt,
      currentPrincipal: 1000,
      paymentDate: "2026-02-01",
      cashAmount: 100,
      lastEventDate: "2026-01-01",
    });

    expect(suggestion.certainty).toBe("tea_estimate");
    expect(suggestion.calculationExplanation).toContain("Estimación calculada con TEA");
    expect(suggestion.calculationExplanation).toContain("60.1%");
    expect(suggestion.calculationExplanation).toContain("TCEA no se utiliza para calcular el interés");
    expect(suggestion.calcInterest).toBeGreaterThan(0);
  });

  it("4. manual/unknown fallback provides no fabricated suggestion", () => {
    const suggestion = calculateAssistedInterestSuggestion({
      debt: baseDebt,
      currentPrincipal: 2000,
      paymentDate: "2026-03-01",
      cashAmount: 250,
    });

    expect(suggestion.certainty).toBe("insufficient_info");
    expect(suggestion.calcInterest).toBe(0);
    expect(suggestion.calculationExplanation).toContain("No tenemos suficiente información");
    expect(suggestion.suggestedPrincipal).toBe(250);
  });

  it("5. formats currency correctly for USD debt", () => {
    const debt: Debt = {
      ...baseDebt,
      currencyCode: "USD",
      interestCalculationMode: "contract_periodic_rate",
      periodicRatePercent: 3,
      periodicRateBasis: "monthly",
    };

    const suggestion = calculateAssistedInterestSuggestion({
      debt,
      currentPrincipal: 1000,
      paymentDate: "2026-03-01",
      cashAmount: 20,
    });

    expect(suggestion.warningMessage).toContain("$");
  });
});
