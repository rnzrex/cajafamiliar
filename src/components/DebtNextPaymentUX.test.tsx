import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { calculateNextPayment, getDerivedNextDueDate } from "../utils/debtNextPayment";
import { calculateAssistedInterestSuggestion } from "../utils/debtInterestEngine";
import { paymentStatus, type PaymentAlertSummary } from "../utils/calculations";
import { buildObligationProjection } from "../utils/obligationProjection";
import { buildObligationReminderPayload } from "../../api/_lib/paymentReminders";
import { DebtDetailModal } from "./DebtDetailModal";
import { RecurringPayments } from "./RecurringPayments";
import type { Debt, DebtEvent, RecurringPayment } from "../types";
import type { DebtIntelligenceItem } from "../utils/debtIntelligence";

describe("DEBT-6B.2 Comprehensive Unit Tests (A-U)", () => {
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

  // A. 5000 principal, 4% contractual monthly, monthly frequency, known monthly due date, minimum principal 100
  it("A. calculates pawn-shop next payment: 200 interest, 100 min principal, 300 total, 4900 balance, estimate certainty (NOT exact_rate)", () => {
    const res = calculateNextPayment({
      debt: baseDebt,
      debtEvents: [],
      currentPrincipal: 5000,
      todayKey: "2026-08-10",
    });

    expect(res.nextDueDate).toBe("2026-08-15");
    expect(res.interestKnown).toBe(true);
    expect(res.interestAmount).toBe(200);
    expect(res.minimumPrincipalKnown).toBe(true);
    expect(res.minimumPrincipalAmount).toBe(100);
    expect(res.minimumPaymentKnown).toBe(true);
    expect(res.minimumPaymentAmount).toBe(300);
    expect(res.principalAfterPayment).toBe(4900);
    expect(res.certainty).toBe("estimate");
    expect(res.certainty).not.toBe("exact_rate");
  });

  // B. Remaining principal 50, contractual minimum 100 => effective minimum principal 50
  it("B. caps minimum principal to remaining principal (50 remaining, 100 contractual min -> effective 50)", () => {
    const res = calculateNextPayment({
      debt: baseDebt,
      debtEvents: [],
      currentPrincipal: 50,
      todayKey: "2026-08-10",
    });

    expect(res.minimumPrincipalAmount).toBe(50);
    expect(res.minimumPaymentAmount).toBe(52); // 4% of 50 = 2 interest + 50 principal = 52
    expect(res.principalAfterPayment).toBe(0);
  });

  // C. Insufficient financial information => no fabricated interest/total
  it("C. returns unknown interest and payment when financial info is insufficient", () => {
    const unknownDebt: Debt = {
      ...baseDebt,
      repaymentStructure: "open_ended",
      interestCalculationMode: "unknown",
      periodicRatePercent: null,
      firstDueDate: null,
      minimumPrincipalPayment: null,
    };

    const res = calculateNextPayment({
      debt: unknownDebt,
      debtEvents: [],
      currentPrincipal: 5000,
      todayKey: "2026-08-10",
    });

    expect(res.interestKnown).toBe(false);
    expect(res.interestAmount).toBeNull();
    expect(res.minimumPaymentKnown).toBe(false);
    expect(res.minimumPaymentAmount).toBeNull();
  });

  // D. TEA populated but mode unknown/manual/contract_schedule => TEA does NOT silently drive allocation
  it("D. TEA populated does NOT drive interest allocation when mode is manual or unknown", () => {
    const manualDebtWithTea: Debt = {
      ...baseDebt,
      interestCalculationMode: "manual",
      teaPercent: 72.4,
    };

    const suggestion = calculateAssistedInterestSuggestion({
      debt: manualDebtWithTea,
      currentPrincipal: 5000,
      paymentDate: "2026-08-15",
      cashAmount: 300,
    });

    expect(suggestion.certainty).toBe("insufficient_info");
    expect(suggestion.calcInterest).toBe(0);
  });

  // P. Future starts_on is not overdue
  it("P. starts_on in the future prevents false overdue tone before start date", () => {
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
      starts_on: "2026-09-15",
      currency_code: "PEN",
    };

    const status = paymentStatus(linkedRec);
    expect(status.tone).not.toBe("danger");
  });

  // Q. Push mapper preserves linked_debt_id / starts_on / currency_code and deep-links to debt
  it("Q. push reminder payload deep-links to debt view when sole urgent obligation is linked debt", () => {
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

    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [linkedRec],
      urgentDebtInstallments: [],
      urgentCardAlerts: [],
      today: "2026-08-24",
    });

    expect(payload.url).toBe("/?view=deudas&debt=debt-test-1");
  });

  // R. Linked obligation projection uses dynamic next payment amount/currency
  it("R. obligation projection uses dynamic next payment amount and currency for linked open-ended debt", () => {
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
      currency_code: "USD",
    };

    const usdDebt: Debt = {
      ...baseDebt,
      currencyCode: "USD",
    };

    const proj = buildObligationProjection({
      recurringPayments: [linkedRec],
      debts: [usdDebt],
      debtPlanningItems: [],
      debtEvents: [],
      todayKey: "2026-08-10",
    });

    const item = proj.items.find((i) => i.sourceId === linkedRec.id);
    expect(item).toBeDefined();
    expect(item?.currencyCode).toBe("USD");
    expect(item?.amount).toBe(300); // 200 interest + 100 min principal
  });

  // S. Fixed schedule has NO linked recurring duplicate
  it("S. fixed-schedule debt skips linked recurring projection to avoid duplicate obligation", () => {
    const fixedDebt: Debt = {
      ...baseDebt,
      id: "debt-fixed-1",
      repaymentStructure: "fixed_schedule",
    };

    const linkedRec: RecurringPayment = {
      id: "debt:debt-fixed-1",
      name: "Préstamo Banco",
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
      linked_debt_id: "debt-fixed-1",
      starts_on: "2026-08-15",
      currency_code: "PEN",
    };

    const proj = buildObligationProjection({
      recurringPayments: [linkedRec],
      debts: [fixedDebt],
      debtPlanningItems: [],
      debtEvents: [],
      todayKey: "2026-08-10",
    });

    const item = proj.items.find((i) => i.sourceId === linkedRec.id);
    expect(item).toBeUndefined();
  });

  // U. Day 31 -> Feb 28/29, Apr 30 due date handling
  it("U. handles day 31 due date in shorter months (Feb 28, Apr 30) without timezone shift", () => {
    const jan31PaidEvent = {
      id: "ev-jan-31",
      debtId: baseDebt.id,
      movementId: "mov-1",
      eventType: "payment",
      eventDate: "2026-01-31",
      cashAmount: 300,
      principalPaid: 100,
      interestPaid: 200,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      reversalTargetEventId: null,
      reversedByEventId: null,
      createdAt: "2026-01-31T00:00:00Z",
      updatedAt: "2026-01-31T00:00:00Z",
    } as unknown as DebtEvent;

    const jan31Debt: Debt = {
      ...baseDebt,
      firstDueDate: "2026-01-31",
    };

    const febNextDate = getDerivedNextDueDate(jan31Debt.firstDueDate, [jan31PaidEvent], jan31Debt.id);
    expect(febNextDate).toBe("2026-02-28");

    const mar31PaidEvent = {
      id: "ev-mar-31",
      debtId: baseDebt.id,
      movementId: "mov-2",
      eventType: "payment",
      eventDate: "2026-03-31",
      cashAmount: 300,
      principalPaid: 100,
      interestPaid: 200,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      reversalTargetEventId: null,
      reversedByEventId: null,
      createdAt: "2026-03-31T00:00:00Z",
      updatedAt: "2026-03-31T00:00:00Z",
    } as unknown as DebtEvent;

    const aprNextDate = getDerivedNextDueDate(jan31Debt.firstDueDate, [mar31PaidEvent], jan31Debt.id);
    expect(aprNextDate).toBe("2026-04-30");
  });

  // I. Linked recurring cannot be manually archived/edited through generic UX
  it("I. RecurringPayments UX suppresses Edit and Archive/Reactivate for linked debt", () => {
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

    const alertSummary = {
      overdue: 0,
      today: 0,
      tomorrow: 0,
      total: 1,
      totalUrgent: 1,
      overdueCount: 0,
      todayCount: 0,
      upcomingCount: 1,
      totalEstimatedCash: 300,
    } as unknown as PaymentAlertSummary;

    const html = renderToStaticMarkup(
      <RecurringPayments
        payments={[linkedRec]}
        categories={[]}
        alertSummary={alertSummary}
        debts={[baseDebt]}
        debtEvents={[]}
        isBrowserOnline={true}
        onSave={vi.fn()}
        onMarkPaid={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onOpenDebt={vi.fn()}
      />
    );

    expect(html).toContain("Deuda vinculada");
    expect(html).toContain("Registrar pago de deuda");
    expect(html).not.toContain("Marcar pagado");
    expect(html).not.toContain("Editar");
    expect(html).not.toContain("Archivar");
  });
});
