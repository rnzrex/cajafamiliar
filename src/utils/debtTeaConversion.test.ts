import { describe, expect, it } from "vitest";
import type { Debt } from "../types";
import {
  calculateAssistedInterestSuggestion,
  effectivePeriodicRateFromTea,
} from "./debtInterestEngine";
import { calculateNextPayment } from "./debtNextPayment";

describe("HOTFIX-DEBT-TEA-01 TEA Conversion & Explicit Frequency Tests", () => {
  const baseDebt: Debt = {
    id: "debt-tea-1",
    name: "Prestamo Personal TEA",
    creditorName: "Banco",
    debtKind: "loan",
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

  it("1. TEA 51.11% monthly => TEM ≈ 3.500178898%", () => {
    const res = effectivePeriodicRateFromTea({ teaPercent: 51.11, frequency: "monthly" });
    expect(res.ratePercent).toBeCloseTo(3.500178898, 6);
    expect(res.rateDecimal).toBeCloseTo(0.03500178898, 8);
  });

  it("2. principal 5000, TEA 51.11%, paymentFrequency='monthly' => interest = 175.01", () => {
    const debt: Debt = {
      ...baseDebt,
      interestCalculationMode: "tea_estimate",
      teaPercent: 51.11,
      paymentFrequency: "monthly",
    };

    const suggestion = calculateAssistedInterestSuggestion({
      debt,
      currentPrincipal: 5000,
      paymentDate: "2026-08-15",
      cashAmount: 300,
    });

    expect(suggestion.calcInterest).toBe(175.01);
    expect(suggestion.calculationExplanation).toContain("TEM 3.5002%");
  });

  it("3. principal 5000, TEA 51.11%, monthly + minimum principal 100 => minimum payment = 275.01 => principal after = 4900", () => {
    const debt: Debt = {
      ...baseDebt,
      interestCalculationMode: "tea_estimate",
      teaPercent: 51.11,
      paymentFrequency: "monthly",
      minimumPrincipalPayment: 100,
      firstDueDate: "2026-08-15",
    };

    const nextPay = calculateNextPayment({
      debt,
      debtEvents: [],
      currentPrincipal: 5000,
      todayKey: "2026-08-10",
    });

    expect(nextPay.interestAmount).toBe(175.01);
    expect(nextPay.minimumPrincipalAmount).toBe(100);
    expect(nextPay.minimumPaymentAmount).toBe(275.01);
    expect(nextPay.principalAfterPayment).toBe(4900);
  });

  it("4. Regression: firstDueDate known but paymentFrequency=null => MUST use actual 5-day TEA estimate, NOT monthly TEM", () => {
    const debt: Debt = {
      ...baseDebt,
      interestCalculationMode: "tea_estimate",
      teaPercent: 51.11,
      paymentFrequency: null, // Null frequency! Must NOT infer monthly from firstDueDate!
      firstDueDate: "2026-08-15",
      trackingStartDate: "2026-08-10",
    };

    const suggestion = calculateAssistedInterestSuggestion({
      debt,
      currentPrincipal: 5000,
      paymentDate: "2026-08-15",
      cashAmount: 300,
      lastEventDate: "2026-08-10",
    });

    // 5 days elapsed: (1 + 0.5111)^(5/365) - 1 ≈ 0.0056623 => 5000 * 0.0056623 = 28.31
    expect(suggestion.certainty).toBe("tea_estimate");
    expect(suggestion.calculationExplanation).toContain("para 5 días");
    expect(suggestion.calcInterest).toBe(28.31);
    expect(suggestion.calcInterest).not.toBe(175.01);
  });

  it("5. Regression: firstDueDate known AND paymentFrequency='monthly' => MUST use TEM 3.5001789% (S/ 175.01)", () => {
    const debt: Debt = {
      ...baseDebt,
      interestCalculationMode: "tea_estimate",
      teaPercent: 51.11,
      paymentFrequency: "monthly",
      firstDueDate: "2026-08-15",
      trackingStartDate: "2026-08-10",
    };

    const suggestion = calculateAssistedInterestSuggestion({
      debt,
      currentPrincipal: 5000,
      paymentDate: "2026-08-15",
      cashAmount: 300,
      lastEventDate: "2026-08-10",
    });

    expect(suggestion.calcInterest).toBe(175.01);
    expect(suggestion.calculationExplanation).toContain("TEM 3.5002%");
  });

  it("6. proves implementation is NOT nominal TEA / 12 (which would yield 212.96)", () => {
    const debt: Debt = {
      ...baseDebt,
      interestCalculationMode: "tea_estimate",
      teaPercent: 51.11,
      paymentFrequency: "monthly",
    };

    const suggestion = calculateAssistedInterestSuggestion({
      debt,
      currentPrincipal: 5000,
      paymentDate: "2026-08-15",
      cashAmount: 300,
    });

    const nominalDivisionInterest = Math.round(5000 * (51.11 / 12 / 100) * 100) / 100;
    expect(nominalDivisionInterest).toBe(212.96);
    expect(suggestion.calcInterest).not.toBe(212.96);
    expect(suggestion.calcInterest).toBe(175.01);
  });

  it("7. TCEA changes from 60% to 150% => monthly interest remains unchanged (175.01)", () => {
    const debt1: Debt = {
      ...baseDebt,
      interestCalculationMode: "tea_estimate",
      teaPercent: 51.11,
      tceaPercent: 60,
      paymentFrequency: "monthly",
    };
    const debt2: Debt = {
      ...baseDebt,
      interestCalculationMode: "tea_estimate",
      teaPercent: 51.11,
      tceaPercent: 150,
      paymentFrequency: "monthly",
    };

    const sug1 = calculateAssistedInterestSuggestion({
      debt: debt1,
      currentPrincipal: 5000,
      paymentDate: "2026-08-15",
      cashAmount: 300,
    });
    const sug2 = calculateAssistedInterestSuggestion({
      debt: debt2,
      currentPrincipal: 5000,
      paymentDate: "2026-08-15",
      cashAmount: 300,
    });

    expect(sug1.calcInterest).toBe(175.01);
    expect(sug2.calcInterest).toBe(175.01);
  });

  it("8. TEA actual-day fallback remains correct when paymentFrequency is null", () => {
    const debtNoFreq: Debt = {
      ...baseDebt,
      interestCalculationMode: "tea_estimate",
      teaPercent: 51.11,
      paymentFrequency: null,
      firstDueDate: null,
    };

    const suggestion = calculateAssistedInterestSuggestion({
      debt: debtNoFreq,
      currentPrincipal: 5000,
      paymentDate: "2026-02-01",
      lastEventDate: "2026-01-01",
      cashAmount: 300,
    });

    expect(suggestion.certainty).toBe("tea_estimate");
    expect(suggestion.calculationExplanation).toContain("para 31 días");
    expect(suggestion.calcInterest).toBeGreaterThan(0);
  });

  it("9. existing 4% contractual monthly periodic-rate behavior remains unchanged", () => {
    const debtPeriodic: Debt = {
      ...baseDebt,
      interestCalculationMode: "contract_periodic_rate",
      periodicRatePercent: 4,
      periodicRateBasis: "monthly",
      paymentFrequency: "monthly",
      firstDueDate: "2026-08-15",
    };

    const suggestion = calculateAssistedInterestSuggestion({
      debt: debtPeriodic,
      currentPrincipal: 5000,
      paymentDate: "2026-08-15",
      lastEventDate: "2026-07-15",
      cashAmount: 300,
    });

    expect(suggestion.calcInterest).toBe(200);
  });

  it("10. PEN/USD monetary formatting remains correct for USD debt", () => {
    const usdDebt: Debt = {
      ...baseDebt,
      currencyCode: "USD",
      interestCalculationMode: "tea_estimate",
      teaPercent: 51.11,
      paymentFrequency: "monthly",
    };

    const nextPayUsd = calculateNextPayment({
      debt: usdDebt,
      debtEvents: [],
      currentPrincipal: 5000,
      todayKey: "2026-08-10",
    });

    expect(nextPayUsd.currencyCode).toBe("USD");
    expect(nextPayUsd.interestAmount).toBe(175.01);
  });

  it("11. Next Payment card and payment form suggestion use 100% identical interest result", () => {
    const debt: Debt = {
      ...baseDebt,
      interestCalculationMode: "tea_estimate",
      teaPercent: 51.11,
      paymentFrequency: "monthly",
      firstDueDate: "2026-08-15",
    };

    const nextPay = calculateNextPayment({
      debt,
      debtEvents: [],
      currentPrincipal: 5000,
      todayKey: "2026-08-10",
    });

    const formSug = calculateAssistedInterestSuggestion({
      debt,
      currentPrincipal: 5000,
      paymentDate: nextPay.nextDueDate || "2026-08-15",
      cashAmount: 300,
    });

    expect(nextPay.interestAmount).toBe(formSug.calcInterest);
    expect(nextPay.interestAmount).toBe(175.01);
  });

  it("12. Warning copy fixed to 'no cubre el interés calculado'", () => {
    const debt: Debt = {
      ...baseDebt,
      interestCalculationMode: "tea_estimate",
      teaPercent: 51.11,
      paymentFrequency: "monthly",
    };

    const suggestion = calculateAssistedInterestSuggestion({
      debt,
      currentPrincipal: 5000,
      paymentDate: "2026-08-15",
      cashAmount: 50, // Less than 175.01 interest
    });

    expect(suggestion.warningMessage).toContain("no cubre el interés calculado");
    expect(suggestion.warningMessage).not.toContain("calculated");
  });
});
