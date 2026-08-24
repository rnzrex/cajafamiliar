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
    debtKind: "bank_loan",
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

  it("A. monthly 51.11% => TEM ≈ 3.500178898%", () => {
    const res = effectivePeriodicRateFromTea({ teaPercent: 51.11, frequency: "monthly" });
    expect(res.ratePercent).toBeCloseTo(3.500178898, 6);
    expect(res.rateDecimal).toBeCloseTo(0.03500178898, 8);
  });

  it("B. biweekly helper uses (1 + 0.5111)^(14/365) - 1", () => {
    const res = effectivePeriodicRateFromTea({ teaPercent: 51.11, frequency: "biweekly" });
    const expectedDecimal = Math.pow(1.5111, 14 / 365) - 1;
    expect(res.rateDecimal).toBeCloseTo(expectedDecimal, 8);

    const debt: Debt = {
      ...baseDebt,
      interestCalculationMode: "tea_estimate",
      teaPercent: 51.11,
      paymentFrequency: "biweekly",
    };
    const suggestion = calculateAssistedInterestSuggestion({
      debt,
      currentPrincipal: 5000,
      paymentDate: "2026-08-15",
      cashAmount: 300,
    });
    expect(suggestion.calcInterest).toBe(Math.round(5000 * expectedDecimal * 100) / 100);
    expect(suggestion.calculationExplanation).toContain("TEQ");
  });

  it("C. weekly helper uses (1 + 0.5111)^(7/365) - 1", () => {
    const res = effectivePeriodicRateFromTea({ teaPercent: 51.11, frequency: "weekly" });
    const expectedDecimal = Math.pow(1.5111, 7 / 365) - 1;
    expect(res.rateDecimal).toBeCloseTo(expectedDecimal, 8);

    const debt: Debt = {
      ...baseDebt,
      interestCalculationMode: "tea_estimate",
      teaPercent: 51.11,
      paymentFrequency: "weekly",
    };
    const suggestion = calculateAssistedInterestSuggestion({
      debt,
      currentPrincipal: 5000,
      paymentDate: "2026-08-15",
      cashAmount: 300,
    });
    expect(suggestion.calcInterest).toBe(Math.round(5000 * expectedDecimal * 100) / 100);
    expect(suggestion.calculationExplanation).toContain("TES");
  });

  it("D. null/unknown frequency does not enter periodic helper path and uses actual-day fallback", () => {
    const debt: Debt = {
      ...baseDebt,
      interestCalculationMode: "tea_estimate",
      teaPercent: 51.11,
      paymentFrequency: null,
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

    expect(suggestion.certainty).toBe("tea_estimate");
    expect(suggestion.calculationExplanation).toContain("para 5 días");
    expect(suggestion.calcInterest).toBe(28.36);
  });

  it("E. contract_periodic_rate irregular period + firstDueDate alone does NOT bypass pre-hotfix validation", () => {
    const debtPeriodic: Debt = {
      ...baseDebt,
      interestCalculationMode: "contract_periodic_rate",
      periodicRatePercent: 4,
      periodicRateBasis: "monthly",
      paymentFrequency: "monthly",
      firstDueDate: "2026-08-15",
      trackingStartDate: "2026-08-10",
    };

    // 5 days elapsed is outside [21, 45] expected range for monthly (30 days) and has no nextInstallment
    const suggestionIrregular = calculateAssistedInterestSuggestion({
      debt: debtPeriodic,
      currentPrincipal: 5000,
      paymentDate: "2026-08-15",
      cashAmount: 300,
      lastEventDate: "2026-08-10",
    });

    // Restored main semantics: irregular period without nextInstallment downgrades to insufficient_info
    expect(suggestionIrregular.certainty).toBe("insufficient_info");
    expect(suggestionIrregular.calcInterest).toBe(0);
  });

  it("F. existing valid 4% monthly contractual-rate test remains 200", () => {
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

  it("G. principal 5000, TEA 51.11%, monthly + minimum principal 100 => minimum payment = 275.01 => principal after = 4900", () => {
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

  it("H. TCEA changes from 60% to 150% => monthly interest remains unchanged (175.01)", () => {
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

  it("I. Next Payment card and payment form suggestion use 100% identical interest result", () => {
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
});
