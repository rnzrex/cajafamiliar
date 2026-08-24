import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { calculateNextPayment, getDerivedNextDueDate } from "../utils/debtNextPayment";
import { calculateAssistedInterestSuggestion } from "../utils/debtInterestEngine";
import { isRecurringPaymentCoveredForMonth, paymentStatus, type PaymentAlertSummary } from "../utils/calculations";
import { currentDebtPrincipal } from "../utils/debtCalculations";
import { buildObligationProjection } from "../utils/obligationProjection";
import { buildObligationReminderPayload } from "../../api/_lib/paymentReminders";
import { RecurringPayments } from "./RecurringPayments";
import type { Debt, DebtEvent, RecurringPayment } from "../types";

describe("DEBT-6B.2 Comprehensive Unit Tests (Month-Rollover Fix)", () => {
  const baseDebt: Debt = {
    id: "debt-test-1",
    createdByUserId: "u-1",
    name: "Empeño Laptop Lenovo",
    creditorName: "Casa de Empeño",
    debtKind: "pledge",
    currencyCode: "PEN",
    originDate: "2026-01-01",
    trackingStartDate: "2026-01-01",
    openingPrincipalBalance: 5000,
    originalPrincipal: 5000,
    plannedInstallmentCount: null,
    plannedInstallmentAmount: null,
    installmentAmountMode: "unknown",
    paymentFrequency: "monthly",
    customFrequencyDays: null,
    firstDueDate: "2026-08-15",
    minimumPrincipalPayment: 100,
    teaPercent: null,
    tceaPercent: null,
    notes: "",
    status: "active",
    isArchived: false,
    repaymentStructure: "open_ended",
    interestCalculationMode: "contract_periodic_rate",
    periodicRatePercent: 4,
    periodicRateBasis: "monthly",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  // Month-Rollover Test 1: linked debt last_paid_month=8, last_paid_year=2026, status='pagado', target September 2026 => NOT covered/paid in September (stale status ignored)
  it("1. linked debt with last_paid=08/2026 and status='pagado' is NOT covered in September 2026 (stale status ignored)", () => {
    const linkedRec: RecurringPayment = {
      id: "debt:debt-test-1",
      name: "Empeño Laptop Lenovo",
      amount_mode: "variable",
      amount: null,
      dueDay: 15,
      dueDate: null,
      category: "Deudas",
      status: "pagado", // Stale DB row status from August
      notes: "",
      recurrence_type: "indefinite",
      total_installments: null,
      paid_installments: 0,
      is_active: true,
      last_paid_month: 8,
      last_paid_year: 2026,
      linked_debt_id: "debt-test-1",
      starts_on: "2026-08-15",
      currency_code: "PEN",
    };

    const coveredInSep = isRecurringPaymentCoveredForMonth(linkedRec, "2026-09");
    expect(coveredInSep).toBe(false);
  });

  // Month-Rollover Test 2: linked debt last_paid_month=10, last_paid_year=2026, target September 2026, starts_on <= September => September IS covered
  it("2. linked debt with last_paid=10/2026 is covered in September 2026 (future cycle prepaid)", () => {
    const linkedRec: RecurringPayment = {
      id: "debt:debt-test-1",
      name: "Empeño Laptop Lenovo",
      amount_mode: "variable",
      amount: null,
      dueDay: 15,
      dueDate: null,
      category: "Deudas",
      status: "pagado",
      notes: "",
      recurrence_type: "indefinite",
      total_installments: null,
      paid_installments: 0,
      is_active: true,
      last_paid_month: 10,
      last_paid_year: 2026,
      linked_debt_id: "debt-test-1",
      starts_on: "2026-08-15",
      currency_code: "PEN",
    };

    const coveredInSep = isRecurringPaymentCoveredForMonth(linkedRec, "2026-09");
    expect(coveredInSep).toBe(true);
  });

  // Month-Rollover Test 3: linked debt starts_on=2026-10-15, last_paid_month=10, target September => NOT overdue and NOT current-month paid
  it("3. linked debt with future starts_on (2026-10-15) is NOT covered in September and NOT overdue", () => {
    const linkedRec: RecurringPayment = {
      id: "debt:debt-test-1",
      name: "Empeño Laptop Lenovo",
      amount_mode: "variable",
      amount: null,
      dueDay: 15,
      dueDate: null,
      category: "Deudas",
      status: "pendiente",
      notes: "",
      recurrence_type: "indefinite",
      total_installments: null,
      paid_installments: 0,
      is_active: true,
      last_paid_month: 10,
      last_paid_year: 2026,
      linked_debt_id: "debt-test-1",
      starts_on: "2026-10-15",
      currency_code: "PEN",
    };

    const coveredInSep = isRecurringPaymentCoveredForMonth(linkedRec, "2026-09");
    expect(coveredInSep).toBe(false);
  });

  // Month-Rollover Test 4: linked debt starts_on=2026-09-15, last_paid_month=9, today=2026-09-01 => paid this month, no alert
  it("4. linked debt with starts_on=2026-09-15 and last_paid=09/2026 is covered on 2026-09-01 (early payment)", () => {
    const linkedRec: RecurringPayment = {
      id: "debt:debt-test-1",
      name: "Empeño Laptop Lenovo",
      amount_mode: "variable",
      amount: null,
      dueDay: 15,
      dueDate: null,
      category: "Deudas",
      status: "pagado",
      notes: "",
      recurrence_type: "indefinite",
      total_installments: null,
      paid_installments: 0,
      is_active: true,
      last_paid_month: 9,
      last_paid_year: 2026,
      linked_debt_id: "debt-test-1",
      starts_on: "2026-09-15",
      currency_code: "PEN",
    };

    const coveredInSep = isRecurringPaymentCoveredForMonth(linkedRec, "2026-09");
    expect(coveredInSep).toBe(true);
  });

  // Month-Rollover Test 5: manual recurring regression unchanged
  it("5. ordinary/manual recurring payment with last_paid=08/2026 is NOT covered in September 2026", () => {
    const manualRec: RecurringPayment = {
      id: "manual-1",
      name: "Internet Movistar",
      amount_mode: "fixed",
      amount: 120,
      dueDay: 10,
      dueDate: null,
      category: "Servicios",
      status: "pendiente",
      notes: "",
      recurrence_type: "indefinite",
      total_installments: null,
      paid_installments: 0,
      is_active: true,
      last_paid_month: 8,
      last_paid_year: 2026,
      currency_code: "PEN",
    };

    const coveredInSep = isRecurringPaymentCoveredForMonth(manualRec, "2026-09");
    expect(coveredInSep).toBe(false);
  });

  // Current Debt Principal SSOT & Principal Adjustment Regression
  it("reuses currentDebtPrincipal SSOT: 5000 opening + 500 adjustment - 100 payment => 5400 canonical principal", () => {
    const adjEvent: DebtEvent = {
      id: "ev-adj",
      debtId: baseDebt.id,
      eventDate: "2026-01-15",
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
      description: "Gasto legal refinanciado",
      registeredByUserId: "u-1",
      createdAt: "2026-01-15T00:00:00Z",
    };

    const payEvent: DebtEvent = {
      id: "ev-pay",
      debtId: baseDebt.id,
      eventDate: "2026-02-15",
      eventType: "payment",
      cashAmount: 300,
      principalDelta: -100,
      interestPaid: 200,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      breakdownComplete: true,
      movementId: "mov-1",
      reversalOfEventId: null,
      description: "Pago cuota 1",
      registeredByUserId: "u-1",
      createdAt: "2026-02-15T00:00:00Z",
    };

    const events = [adjEvent, payEvent];
    const canonicalPrincipal = currentDebtPrincipal(baseDebt, events);
    expect(canonicalPrincipal).toBe(5400);

    const res = calculateNextPayment({
      debt: baseDebt,
      debtEvents: events,
      currentPrincipal: canonicalPrincipal,
      todayKey: "2026-08-10",
    });

    expect(res.interestAmount).toBe(216);
    expect(res.minimumPaymentAmount).toBe(316);
  });

  // Contractual Monthly Cycle Advancement Semantics (A-G)
  it("A. first due 15/08 with no payments => next due 15/08", () => {
    expect(getDerivedNextDueDate("2026-08-15", [], baseDebt.id)).toBe("2026-08-15");
  });

  it("B. payment on 15/08 => advances cycle to 15/09", () => {
    const pay1: DebtEvent = {
      id: "p1",
      debtId: baseDebt.id,
      eventDate: "2026-08-15",
      eventType: "payment",
      cashAmount: 300,
      principalDelta: -100,
      interestPaid: 200,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      breakdownComplete: true,
      movementId: null,
      reversalOfEventId: null,
      description: "",
      registeredByUserId: "u-1",
      createdAt: "2026-08-15T00:00:00Z",
    };
    expect(getDerivedNextDueDate("2026-08-15", [pay1], baseDebt.id)).toBe("2026-09-15");
  });

  it("C. LATE payment on 01/09 covering first cycle => next due 15/09 (NOT 15/10)", () => {
    const latePay: DebtEvent = {
      id: "p-late",
      debtId: baseDebt.id,
      eventDate: "2026-09-01",
      eventType: "payment",
      cashAmount: 300,
      principalDelta: -100,
      interestPaid: 200,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      breakdownComplete: true,
      movementId: null,
      reversalOfEventId: null,
      description: "Pago atrasado de agosto",
      registeredByUserId: "u-1",
      createdAt: "2026-09-01T00:00:00Z",
    };
    expect(getDerivedNextDueDate("2026-08-15", [latePay], baseDebt.id)).toBe("2026-09-15");
  });

  it("E. principal_prepayment does NOT advance contractual monthly cycle", () => {
    const prepay: DebtEvent = {
      id: "pre1",
      debtId: baseDebt.id,
      eventDate: "2026-08-10",
      eventType: "principal_prepayment",
      cashAmount: 1000,
      principalDelta: -1000,
      interestPaid: 0,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      breakdownComplete: true,
      movementId: null,
      reversalOfEventId: null,
      description: "Abono extra a capital",
      registeredByUserId: "u-1",
      createdAt: "2026-08-10T00:00:00Z",
    };
    expect(getDerivedNextDueDate("2026-08-15", [prepay], baseDebt.id)).toBe("2026-08-15");
  });

  it("F. reversed payment does NOT advance contractual cycle", () => {
    const p1: DebtEvent = {
      id: "p1",
      debtId: baseDebt.id,
      eventDate: "2026-08-15",
      eventType: "payment",
      cashAmount: 300,
      principalDelta: -100,
      interestPaid: 200,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      breakdownComplete: true,
      movementId: null,
      reversalOfEventId: null,
      description: "",
      registeredByUserId: "u-1",
      createdAt: "2026-08-15T00:00:00Z",
    };
    const rev: DebtEvent = {
      id: "rev1",
      debtId: baseDebt.id,
      eventDate: "2026-08-16",
      eventType: "reversal",
      cashAmount: 0,
      principalDelta: 0,
      interestPaid: 0,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      breakdownComplete: false,
      movementId: null,
      reversalOfEventId: "p1",
      description: "Anulación de pago",
      registeredByUserId: "u-1",
      createdAt: "2026-08-16T00:00:00Z",
    };
    expect(getDerivedNextDueDate("2026-08-15", [p1, rev], baseDebt.id)).toBe("2026-08-15");
  });
});
