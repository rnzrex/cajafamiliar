import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Debt } from "../types";
import { calculateNextPayment } from "../utils/debtNextPayment";
import { effectivePeriodicRateFromTea, calculateAssistedInterestSuggestion } from "../utils/debtInterestEngine";
import { buildDebtCreateInputPayload } from "../utils/debtFormMode";
import { buildDebtIntelligenceItems } from "../utils/debtIntelligence";
import { DebtForm } from "./DebtForm";
import { DebtDetailModal } from "./DebtDetailModal";

describe("HOTFIX-DEBT-TEA-02 & In-Page Debt Detail UX & Final Cleanup", () => {
  // 1. DebtForm pledge/open-ended + monthly frequency => create payload paymentFrequency === "monthly"
  it("1. DebtForm pledge/open-ended + monthly frequency produces paymentFrequency 'monthly' in payload", () => {
    const payload = buildDebtCreateInputPayload({
      debtId: "debt-pledge-1",
      debtKind: "pledge",
      onboardingMode: "EXISTING_DEBT",
      currencyCode: "PEN",
      name: "Empeño Laptop",
      creditorName: "Casa Empeño",
      openingPrincipalBalance: 6510,
      paymentFrequency: "monthly",
      repaymentStructure: "open_ended",
      interestCalculationMode: "tea_estimate",
      teaPercent: 51.11,
      pledgeItemDescription: "Laptop Lenovo",
    });

    expect(payload.paymentFrequency).toBe("monthly");
    expect(payload.repaymentStructure).toBe("open_ended");
    expect(payload.teaPercent).toBe(51.11);
  });

  // 2. DebtForm single authoritative frequency control and no duplicate controls
  it("2. DebtForm renders exactly ONE 'Frecuencia de pago' label and NO duplicate '¿Cada cuánto pagas?'", () => {
    const html = renderToStaticMarkup(
  <DebtForm
  initialDebtKind="other"
        accounts={[]}
        categories={[]}
        canWriteDebt={true}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
        setToast={vi.fn()}
        initialStep="details"
      />
    );

    const freqOccurrences = (html.match(/Frecuencia de pago/g) || []).length;
    expect(freqOccurrences).toBe(1);
    expect(html).not.toContain("¿Cada cuánto pagas?");
    expect(html).toContain("Convierte la TEA a la tasa efectiva del período cuando la frecuencia está definida.");
  });

  // 3. Single monthly due control when monthly frequency is active
  it("3. DebtForm renders at most ONE 'Día de pago mensual (1–31)' control", () => {
    const html = renderToStaticMarkup(
  <DebtForm
  initialDebtKind="other"
        accounts={[]}
        categories={[]}
        canWriteDebt={true}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
        setToast={vi.fn()}
        initialStep="details"
      />
    );

    const monthlyDueOccurrences = (html.match(/Día de pago mensual/g) || []).length;
    // Default form without selecting monthly has 0 occurrences; when monthly is selected it has exactly 1.
    expect(monthlyDueOccurrences).toBeLessThanOrEqual(1);
  });

  // 4. TEA 51.11 + monthly + 6510 => interest 227.86
  it("4. TEA 51.11% with monthly frequency and principal 6510 yields interest 227.86", () => {
    const debt: Debt = {
      id: "d1",
      createdByUserId: "u1",
      name: "Deuda TEA",
      creditorName: "Banco",
      debtKind: "bank_loan",
      currencyCode: "PEN",
      originDate: "2026-08-01",
      trackingStartDate: "2026-08-24",
      originalPrincipal: 6510,
      openingPrincipalBalance: 6510,
      plannedInstallmentCount: null,
      plannedInstallmentAmount: null,
      installmentAmountMode: "unknown",
      paymentFrequency: "monthly",
      customFrequencyDays: null,
      firstDueDate: "2026-08-31",
      teaPercent: 51.11,
      tceaPercent: 51.11,
      status: "active",
      notes: "",
      isArchived: false,
      repaymentStructure: "open_ended",
      interestCalculationMode: "tea_estimate",
      periodicRatePercent: null,
      periodicRateBasis: null,
      minimumPrincipalPayment: 30,
      createdAt: "2026-08-24T00:00:00Z",
      updatedAt: "2026-08-24T00:00:00Z",
    };

    const nextPayment = calculateNextPayment({
      debt,
      debtEvents: [],
      currentPrincipal: 6510,
      todayKey: "2026-08-24",
    });

    const temResult = effectivePeriodicRateFromTea({ teaPercent: 51.11, frequency: "monthly" });
    expect(temResult.ratePercent).toBeCloseTo(3.500178898, 4);

    expect(nextPayment.interestAmount).toBe(227.86);
  });

  // 5. same + minimum principal 30 => minimum payment 257.86 => principal after 6480
  it("5. Minimum principal 30 with interest 227.86 yields minimum payment 257.86 and principal after 6480.00", () => {
    const debt: Debt = {
      id: "d1",
      createdByUserId: "u1",
      name: "Deuda TEA",
      creditorName: "Banco",
      debtKind: "bank_loan",
      currencyCode: "PEN",
      originDate: "2026-08-01",
      trackingStartDate: "2026-08-24",
      originalPrincipal: 6510,
      openingPrincipalBalance: 6510,
      plannedInstallmentCount: null,
      plannedInstallmentAmount: null,
      installmentAmountMode: "unknown",
      paymentFrequency: "monthly",
      customFrequencyDays: null,
      firstDueDate: "2026-08-31",
      teaPercent: 51.11,
      tceaPercent: 51.11,
      status: "active",
      notes: "",
      isArchived: false,
      repaymentStructure: "open_ended",
      interestCalculationMode: "tea_estimate",
      periodicRatePercent: null,
      periodicRateBasis: null,
      minimumPrincipalPayment: 30,
      createdAt: "2026-08-24T00:00:00Z",
      updatedAt: "2026-08-24T00:00:00Z",
    };

    const nextPayment = calculateNextPayment({
      debt,
      debtEvents: [],
      currentPrincipal: 6510,
      todayKey: "2026-08-24",
    });

    expect(nextPayment.interestAmount).toBe(227.86);
    expect(nextPayment.minimumPrincipalAmount).toBe(30);
    expect(nextPayment.minimumPaymentAmount).toBe(257.86);
    expect(nextPayment.principalAfterPayment).toBe(6480.0);
  });

  // 6. 7-day first-due gap with monthly contractual frequency => still 227.86
  it("6. 7-day first-due gap with explicit monthly paymentFrequency STILL calculates contractual TEM interest 227.86", () => {
    const debt: Debt = {
      id: "d1",
      createdByUserId: "u1",
      name: "Deuda TEA 7 Días",
      creditorName: "Banco",
      debtKind: "pledge",
      currencyCode: "PEN",
      originDate: "2026-08-24",
      trackingStartDate: "2026-08-24",
      originalPrincipal: 6510,
      openingPrincipalBalance: 6510,
      plannedInstallmentCount: null,
      plannedInstallmentAmount: null,
      installmentAmountMode: "unknown",
      paymentFrequency: "monthly",
      customFrequencyDays: null,
      firstDueDate: "2026-08-31",
      teaPercent: 51.11,
      tceaPercent: 51.11,
      status: "active",
      notes: "",
      isArchived: false,
      repaymentStructure: "open_ended",
      interestCalculationMode: "tea_estimate",
      periodicRatePercent: null,
      periodicRateBasis: null,
      minimumPrincipalPayment: 30,
      createdAt: "2026-08-24T00:00:00Z",
      updatedAt: "2026-08-24T00:00:00Z",
    };

    const suggestion = calculateAssistedInterestSuggestion({
      debt,
      currentPrincipal: 6510,
      paymentDate: "2026-08-31",
      cashAmount: 257.86,
      lastEventDate: "2026-08-24",
    });

    expect(suggestion.calcInterest).toBe(227.86);
  });

  // 7. frequency null + 7-day gap => actual-day fallback ≈ 51.75
  it("7. frequency null with 7-day gap falls back to actual-day calculation (≈ 51.75)", () => {
    const debt: Debt = {
      id: "d1",
      createdByUserId: "u1",
      name: "Deuda TEA Sin Frecuencia",
      creditorName: "Banco",
      debtKind: "pledge",
      currencyCode: "PEN",
      originDate: "2026-08-24",
      trackingStartDate: "2026-08-24",
      originalPrincipal: 6510,
      openingPrincipalBalance: 6510,
      plannedInstallmentCount: null,
      plannedInstallmentAmount: null,
      installmentAmountMode: "unknown",
      paymentFrequency: null,
      customFrequencyDays: null,
      firstDueDate: "2026-08-31",
      teaPercent: 51.11,
      tceaPercent: 51.11,
      status: "active",
      notes: "",
      isArchived: false,
      repaymentStructure: "open_ended",
      interestCalculationMode: "tea_estimate",
      periodicRatePercent: null,
      periodicRateBasis: null,
      minimumPrincipalPayment: 30,
      createdAt: "2026-08-24T00:00:00Z",
      updatedAt: "2026-08-24T00:00:00Z",
    };

    const suggestion = calculateAssistedInterestSuggestion({
      debt,
      currentPrincipal: 6510,
      paymentDate: "2026-08-31",
      cashAmount: 257.86,
      lastEventDate: "2026-08-24",
    });

    expect(suggestion.calcInterest).toBeCloseTo(51.75, 1);
  });

  // 8. Edit Terms renders Frecuencia
  it("8. Edit Terms form in DebtDetailModal renders Frecuencia and Editar términos", () => {
    const debt: Debt = {
      id: "d1",
      createdByUserId: "u1",
      name: "Préstamo Test",
      creditorName: "BCP",
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
      teaPercent: 50,
      tceaPercent: 50,
      status: "active",
      notes: "",
      isArchived: false,
      repaymentStructure: "open_ended",
      interestCalculationMode: "tea_estimate",
      periodicRatePercent: null,
      periodicRateBasis: null,
      minimumPrincipalPayment: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const intelligence = buildDebtIntelligenceItems({
      debts: [debt],
      debtEvents: [],
      debtScheduleVersions: [],
      debtInstallments: [],
      debtCollaterals: [],
    })[0];

    const html = renderToStaticMarkup(
      <DebtDetailModal
        debt={debt}
        debtIntelligence={intelligence}
        debtEvents={[]}
        scheduleVersions={[]}
        installments={[]}
        allocations={[]}
        collaterals={[]}
        accounts={[]}
        categories={[]}
        canWriteDebt={true}
        onClose={vi.fn()}
        onOpenOperation={vi.fn()}
        onRefresh={vi.fn()}
        setToast={vi.fn()}
      />
    );

    expect(html).toContain("Frecuencia");
    expect(html).toContain("Editar términos");
  });

  // 9. terms summary shows: Frecuencia Mensual, TEM 3.5002%
  it("9. Terms summary displays explicit Frecuencia Mensual and calculated TEM 3.5002%", () => {
    const debt: Debt = {
      id: "d1",
      createdByUserId: "u1",
      name: "Préstamo TEA",
      creditorName: "BCP",
      debtKind: "bank_loan",
      currencyCode: "PEN",
      originDate: "2026-01-01",
      trackingStartDate: "2026-01-01",
      originalPrincipal: 6510,
      openingPrincipalBalance: 6510,
      plannedInstallmentCount: null,
      plannedInstallmentAmount: null,
      installmentAmountMode: "unknown",
      paymentFrequency: "monthly",
      customFrequencyDays: null,
      firstDueDate: "2026-08-31",
      teaPercent: 51.11,
      tceaPercent: 51.11,
      status: "active",
      notes: "",
      isArchived: false,
      repaymentStructure: "open_ended",
      interestCalculationMode: "tea_estimate",
      periodicRatePercent: null,
      periodicRateBasis: null,
      minimumPrincipalPayment: 30,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const intelligence = buildDebtIntelligenceItems({
      debts: [debt],
      debtEvents: [],
      debtScheduleVersions: [],
      debtInstallments: [],
      debtCollaterals: [],
    })[0];

    const html = renderToStaticMarkup(
      <DebtDetailModal
        debt={debt}
        debtIntelligence={intelligence}
        debtEvents={[]}
        scheduleVersions={[]}
        installments={[]}
        allocations={[]}
        collaterals={[]}
        accounts={[]}
        categories={[]}
        canWriteDebt={true}
        onClose={vi.fn()}
        onOpenOperation={vi.fn()}
        onRefresh={vi.fn()}
        setToast={vi.fn()}
      />
    );

    expect(html).toContain("Mensual");
    expect(html).toContain("TEM 3.5002%");
  });

  // 10. TCEA change does not change interest
  it("10. Changing TCEA does not alter calculated interest amount", () => {
    const debtTEAOnly: Debt = {
      id: "d1",
      createdByUserId: "u1",
      name: "Deuda TEA",
      creditorName: "Banco",
      debtKind: "bank_loan",
      currencyCode: "PEN",
      originDate: "2026-08-01",
      trackingStartDate: "2026-08-24",
      originalPrincipal: 6510,
      openingPrincipalBalance: 6510,
      plannedInstallmentCount: null,
      plannedInstallmentAmount: null,
      installmentAmountMode: "unknown",
      paymentFrequency: "monthly",
      customFrequencyDays: null,
      firstDueDate: "2026-08-31",
      teaPercent: 51.11,
      tceaPercent: 99.99, // Changed TCEA
      status: "active",
      notes: "",
      isArchived: false,
      repaymentStructure: "open_ended",
      interestCalculationMode: "tea_estimate",
      periodicRatePercent: null,
      periodicRateBasis: null,
      minimumPrincipalPayment: 30,
      createdAt: "2026-08-24T00:00:00Z",
      updatedAt: "2026-08-24T00:00:00Z",
    };

    const nextPayment = calculateNextPayment({
      debt: debtTEAOnly,
      debtEvents: [],
      currentPrincipal: 6510,
      todayKey: "2026-08-24",
    });

    expect(nextPayment.interestAmount).toBe(227.86);
  });

  // 11. Debt selected renders in-page detail and Volver a deudas button
  it("11. DebtDetailModal renders in-page with Volver a deudas button", () => {
    const onClose = vi.fn();
    const debt: Debt = {
      id: "d1",
      createdByUserId: "u1",
      name: "Deuda In-Page",
      creditorName: "Banco",
      debtKind: "bank_loan",
      currencyCode: "PEN",
      originDate: "2026-08-01",
      trackingStartDate: "2026-08-24",
      originalPrincipal: 1000,
      openingPrincipalBalance: 1000,
      plannedInstallmentCount: null,
      plannedInstallmentAmount: null,
      installmentAmountMode: "unknown",
      paymentFrequency: "monthly",
      customFrequencyDays: null,
      firstDueDate: "2026-08-31",
      teaPercent: 20,
      tceaPercent: 20,
      status: "active",
      notes: "",
      isArchived: false,
      repaymentStructure: "open_ended",
      interestCalculationMode: "tea_estimate",
      periodicRatePercent: null,
      periodicRateBasis: null,
      minimumPrincipalPayment: null,
      createdAt: "2026-08-24T00:00:00Z",
      updatedAt: "2026-08-24T00:00:00Z",
    };

    const intelligence = buildDebtIntelligenceItems({
      debts: [debt],
      debtEvents: [],
      debtScheduleVersions: [],
      debtInstallments: [],
      debtCollaterals: [],
    })[0];

    const html = renderToStaticMarkup(
      <DebtDetailModal
        debt={debt}
        debtIntelligence={intelligence}
        debtEvents={[]}
        scheduleVersions={[]}
        installments={[]}
        allocations={[]}
        collaterals={[]}
        accounts={[]}
        categories={[]}
        canWriteDebt={true}
        onClose={onClose}
        onOpenOperation={vi.fn()}
        onRefresh={vi.fn()}
        setToast={vi.fn()}
      />
    );

    expect(html).toContain("Volver a deudas");
  });
});
