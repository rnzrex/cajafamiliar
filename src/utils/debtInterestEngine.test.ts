import { describe, expect, it } from "vitest";
import type { Debt, DebtEvent } from "../types";
import { calculateAssistedInterestSuggestion, getLastEffectiveDebtPaymentDate } from "./debtInterestEngine";

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
    expect(suggestion.certainty).toBe("tea_estimate");
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

  it("4. TEA without known period does NOT invent 30 days", () => {
    const debt: Debt = {
      ...baseDebt,
      interestCalculationMode: "tea_estimate",
      teaPercent: 60.1,
    };

    const suggestion = calculateAssistedInterestSuggestion({
      debt,
      currentPrincipal: 1000,
      paymentDate: "2026-01-01", // payment date on same day as origin -> 0 days
      cashAmount: 100,
    });

    expect(suggestion.certainty).toBe("insufficient_info");
    expect(suggestion.suggestedInterest).toBe(0);
    expect(suggestion.suggestedPrincipal).toBe(0);
  });

  it("5. manual/unknown fallback provides no fabricated suggestion (suggestedInterest = 0, suggestedPrincipal = 0)", () => {
    const suggestion = calculateAssistedInterestSuggestion({
      debt: baseDebt,
      currentPrincipal: 2000,
      paymentDate: "2026-03-01",
      cashAmount: 250,
    });

    expect(suggestion.certainty).toBe("insufficient_info");
    expect(suggestion.calcInterest).toBe(0);
    expect(suggestion.suggestedInterest).toBe(0);
    expect(suggestion.suggestedPrincipal).toBe(0);
    expect(suggestion.calculationExplanation).toContain("No tenemos suficiente información");
  });

  it("6. formats currency correctly for USD debt", () => {
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
      lastEventDate: "2026-02-01",
      cashAmount: 20,
    });

    expect(suggestion.warningMessage).toContain("$");
  });

  it("7. periodic rate with zero/invalid elapsed period blocks calculation", () => {
    const debt: Debt = {
      ...baseDebt,
      interestCalculationMode: "contract_periodic_rate",
      periodicRatePercent: 4,
      periodicRateBasis: "monthly",
      trackingStartDate: "2026-02-01",
    };

    // Same day as anchor -> 0 days elapsed
    const suggestionSameDay = calculateAssistedInterestSuggestion({
      debt,
      currentPrincipal: 5000,
      paymentDate: "2026-02-01",
      cashAmount: 300,
    });

    expect(suggestionSameDay.certainty).toBe("insufficient_info");
    expect(suggestionSameDay.calcInterest).toBe(0);
    expect(suggestionSameDay.suggestedInterest).toBe(0);
    expect(suggestionSameDay.suggestedPrincipal).toBe(0);

    // Payment before anchor -> invalid elapsed
    const suggestionBeforeAnchor = calculateAssistedInterestSuggestion({
      debt,
      currentPrincipal: 5000,
      paymentDate: "2026-01-15",
      cashAmount: 300,
    });

    expect(suggestionBeforeAnchor.certainty).toBe("insufficient_info");
    expect(suggestionBeforeAnchor.calcInterest).toBe(0);

    // Valid ~monthly period -> gives assisted estimate
    const suggestionValidPeriod = calculateAssistedInterestSuggestion({
      debt,
      currentPrincipal: 5000,
      paymentDate: "2026-03-03",
      cashAmount: 300,
    });

    expect(suggestionValidPeriod.certainty).toBe("tea_estimate");
    expect(suggestionValidPeriod.calcInterest).toBe(200);
    expect(suggestionValidPeriod.suggestedInterest).toBe(200);
    expect(suggestionValidPeriod.suggestedPrincipal).toBe(100);
  });

  describe("getLastEffectiveDebtPaymentDate Pure Production Helper Tests", () => {
    it("A. prevents cross-debt contamination (Debt A payment vs Debt B payment)", () => {
      const events: DebtEvent[] = [
        {
          id: "evt-a1",
          debtId: "debt-a",
          eventDate: "2026-03-01",
          eventType: "payment",
          cashAmount: 300,
          principalDelta: -200,
          interestPaid: 100,
          feesPaid: 0,
          insurancePaid: 0,
          otherCostPaid: 0,
          breakdownComplete: true,
          movementId: "mov-1",
          reversalOfEventId: null,
          description: "Pago Debt A",
          registeredByUserId: "user-1",
          createdAt: "2026-03-01T10:00:00Z",
        },
        {
          id: "evt-b1",
          debtId: "debt-b",
          eventDate: "2026-03-20",
          eventType: "payment",
          cashAmount: 500,
          principalDelta: -400,
          interestPaid: 100,
          feesPaid: 0,
          insurancePaid: 0,
          otherCostPaid: 0,
          breakdownComplete: true,
          movementId: "mov-2",
          reversalOfEventId: null,
          description: "Pago Debt B",
          registeredByUserId: "user-1",
          createdAt: "2026-03-20T10:00:00Z",
        },
      ];

      expect(getLastEffectiveDebtPaymentDate(events, "debt-a")).toBe("2026-03-01");
      expect(getLastEffectiveDebtPaymentDate(events, "debt-b")).toBe("2026-03-20");
    });

    it("B. ignores reversed latest payment and uses previous effective payment date", () => {
      const events: DebtEvent[] = [
        {
          id: "evt-1",
          debtId: "debt-a",
          eventDate: "2026-02-01",
          eventType: "payment",
          cashAmount: 300,
          principalDelta: -200,
          interestPaid: 100,
          feesPaid: 0,
          insurancePaid: 0,
          otherCostPaid: 0,
          breakdownComplete: true,
          movementId: "mov-1",
          reversalOfEventId: null,
          description: "Pago cuota 1",
          registeredByUserId: "user-1",
          createdAt: "2026-02-01T10:00:00Z",
        },
        {
          id: "evt-2",
          debtId: "debt-a",
          eventDate: "2026-03-01",
          eventType: "payment",
          cashAmount: 400,
          principalDelta: -300,
          interestPaid: 100,
          feesPaid: 0,
          insurancePaid: 0,
          otherCostPaid: 0,
          breakdownComplete: true,
          movementId: "mov-2",
          reversalOfEventId: null,
          description: "Pago cuota 2 (anulado)",
          registeredByUserId: "user-1",
          createdAt: "2026-03-01T10:00:00Z",
        },
        {
          id: "evt-3",
          debtId: "debt-a",
          eventDate: "2026-03-02",
          eventType: "reversal",
          cashAmount: -400,
          principalDelta: 300,
          interestPaid: -100,
          feesPaid: 0,
          insurancePaid: 0,
          otherCostPaid: 0,
          breakdownComplete: true,
          movementId: "mov-3",
          reversalOfEventId: "evt-2",
          description: "Reversión pago cuota 2",
          registeredByUserId: "user-1",
          createdAt: "2026-03-02T10:00:00Z",
        },
      ];

      expect(getLastEffectiveDebtPaymentDate(events, "debt-a")).toBe("2026-02-01");
    });

    it("C. ignores principal_adjustment events as interest-period anchors", () => {
      const events: DebtEvent[] = [
        {
          id: "evt-1",
          debtId: "debt-a",
          eventDate: "2026-02-01",
          eventType: "payment",
          cashAmount: 300,
          principalDelta: -200,
          interestPaid: 100,
          feesPaid: 0,
          insurancePaid: 0,
          otherCostPaid: 0,
          breakdownComplete: true,
          movementId: "mov-1",
          reversalOfEventId: null,
          description: "Pago cuota 1",
          registeredByUserId: "user-1",
          createdAt: "2026-02-01T10:00:00Z",
        },
        {
          id: "evt-2",
          debtId: "debt-a",
          eventDate: "2026-02-15",
          eventType: "principal_adjustment",
          cashAmount: 0,
          principalDelta: 500,
          interestPaid: 0,
          feesPaid: 0,
          insurancePaid: 0,
          otherCostPaid: 0,
          breakdownComplete: true,
          movementId: null,
          reversalOfEventId: null,
          description: "Ajuste de saldo",
          registeredByUserId: "user-1",
          createdAt: "2026-02-15T10:00:00Z",
        },
      ];

      expect(getLastEffectiveDebtPaymentDate(events, "debt-a")).toBe("2026-02-01");
    });
  });
});
