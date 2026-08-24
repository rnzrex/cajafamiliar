import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { calculateNextPayment, getDerivedNextDueDate } from "../utils/debtNextPayment";
import { calculateAssistedInterestSuggestion } from "../utils/debtInterestEngine";
import { paymentStatus, type PaymentAlertSummary } from "../utils/calculations";
import { currentDebtPrincipal } from "../utils/debtCalculations";
import { buildObligationProjection } from "../utils/obligationProjection";
import { buildObligationReminderPayload } from "../../api/_lib/paymentReminders";
import { RecurringPayments } from "./RecurringPayments";
import type { Debt, DebtEvent, RecurringPayment } from "../types";

describe("DEBT-6B.2 Comprehensive Unit Tests (Final Release Corrections)", () => {
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

  // 1. Current Debt Principal SSOT & Principal Adjustment Regression
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

    // 4% of 5400 = 216 interest + 100 min principal = 316
    expect(res.interestAmount).toBe(216);
    expect(res.minimumPaymentAmount).toBe(316);
  });

  // 2. Integration assertion: recorded debt payment changes obligation projection
  it("proves recorded debt payment changes the linked obligation projection", () => {
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
      last_paid_month: null,
      last_paid_year: null,
      linked_debt_id: "debt-test-1",
      starts_on: "2026-08-15",
      currency_code: "PEN",
    };

    // Projection before any payment (first due 2026-08-15)
    const projBefore = buildObligationProjection({
      recurringPayments: [linkedRec],
      debts: [baseDebt],
      debtPlanningItems: [],
      debtEvents: [],
      todayKey: "2026-08-10",
    });
    const itemBefore = projBefore.items.find((i) => i.sourceId === linkedRec.id);
    expect(itemBefore?.dueDate).toBe("2026-08-15");

    // Recorded regular payment
    const payEvent: DebtEvent = {
      id: "ev-pay-aug",
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
      movementId: "mov-1",
      reversalOfEventId: null,
      description: "Pago Agosto",
      registeredByUserId: "u-1",
      createdAt: "2026-08-15T00:00:00Z",
    };

    // Projection after payment (next due advances to 2026-09-15)
    const projAfter = buildObligationProjection({
      recurringPayments: [linkedRec],
      debts: [baseDebt],
      debtPlanningItems: [],
      debtEvents: [payEvent],
      todayKey: "2026-08-10",
    });
    const itemAfter = projAfter.items.find((i) => i.sourceId === linkedRec.id);
    expect(itemAfter?.dueDate).toBe("2026-09-15");
  });

  // 3. Contractual Monthly Cycle Advancement Semantics (A-G)
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

  it("D. two effective regular payments => advances two contractual cycles (15/10)", () => {
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
    const p2: DebtEvent = {
      id: "p2",
      debtId: baseDebt.id,
      eventDate: "2026-09-15",
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
      createdAt: "2026-09-15T00:00:00Z",
    };
    expect(getDerivedNextDueDate("2026-08-15", [p1, p2], baseDebt.id)).toBe("2026-10-15");
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

  it("G. day 31 short-month handling (Jan 31 -> Feb 28, Apr 30)", () => {
    const p1: DebtEvent = {
      id: "p1",
      debtId: baseDebt.id,
      eventDate: "2026-01-31",
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
      createdAt: "2026-01-31T00:00:00Z",
    };
    expect(getDerivedNextDueDate("2026-01-31", [p1], baseDebt.id)).toBe("2026-02-28");

    const p2: DebtEvent = {
      id: "p2",
      debtId: baseDebt.id,
      eventDate: "2026-02-28",
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
      createdAt: "2026-02-28T00:00:00Z",
    };
    const p3: DebtEvent = {
      id: "p3",
      debtId: baseDebt.id,
      eventDate: "2026-03-31",
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
      createdAt: "2026-03-31T00:00:00Z",
    };
    expect(getDerivedNextDueDate("2026-01-31", [p1, p2, p3], baseDebt.id)).toBe("2026-04-30");
  });

  // 4. Future starts_on / Early-Paid Regression
  it("paymentStatus reports paid when status === pagado, even if starts_on is later in the month", () => {
    const earlyPaidRec: RecurringPayment = {
      id: "debt:debt-test-1",
      name: "Empeño Laptop Lenovo",
      amount_mode: "variable",
      amount: null,
      dueDay: 28,
      dueDate: null,
      category: "Deudas",
      status: "pagado",
      notes: "",
      recurrence_type: "indefinite",
      total_installments: null,
      paid_installments: 0,
      is_active: true,
      last_paid_month: 8,
      last_paid_year: 2026,
      linked_debt_id: "debt-test-1",
      starts_on: "2026-08-28",
      currency_code: "PEN",
    };

    const status = paymentStatus(earlyPaidRec);
    expect(status.kind).toBe("paid");
  });

  // 5. Pawn-shop next payment calculation estimate honesty
  it("pawn-shop next payment: 200 interest + 100 min principal = 300 total, estimate certainty", () => {
    const res = calculateNextPayment({
      debt: baseDebt,
      debtEvents: [],
      currentPrincipal: 5000,
      todayKey: "2026-08-10",
    });

    expect(res.nextDueDate).toBe("2026-08-15");
    expect(res.interestKnown).toBe(true);
    expect(res.interestAmount).toBe(200);
    expect(res.minimumPrincipalAmount).toBe(100);
    expect(res.minimumPaymentAmount).toBe(300);
    expect(res.certainty).toBe("estimate");
  });
});
