import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { calculateNextPayment, getDerivedNextDueDate } from "../utils/debtNextPayment";
import { paymentStatus, type PaymentAlertSummary } from "../utils/calculations";
import { buildObligationProjection } from "../utils/obligationProjection";
import { DebtDetailModal } from "./DebtDetailModal";
import { RecurringPayments } from "./RecurringPayments";
import type { Debt, FinancialAccount, Category, DebtEvent, RecurringPayment } from "../types";
import type { DebtIntelligenceItem } from "../utils/debtIntelligence";

describe("DEBT-6B.2 Next Payment & Linked Recurring Debt Tests", () => {
  const mockDebt: Debt = {
    id: "debt-next-1",
    createdByUserId: "u-1",
    name: "Empeño Joyas",
    creditorName: "Casa de Empeño",
    debtKind: "pledge",
    currencyCode: "PEN",
    originDate: "2026-01-15",
    trackingStartDate: "2026-01-15",
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
    createdAt: "2026-01-15T00:00:00Z",
    updatedAt: "2026-01-15T00:00:00Z",
  };

  const mockEvents: DebtEvent[] = [];

  it("calculates next payment correctly for open-ended debt with interest and minimum principal", () => {
    const res = calculateNextPayment({
      debt: mockDebt,
      debtEvents: mockEvents,
      currentPrincipal: 5000,
      todayKey: "2026-08-10",
    });

    expect(res.nextDueDate).toBe("2026-08-15");
    expect(res.interestKnown).toBe(true);
    expect(res.interestAmount).toBe(200); // 4% of 5000 = 200
    expect(res.minimumPrincipalKnown).toBe(true);
    expect(res.minimumPrincipalAmount).toBe(100);
    expect(res.minimumPaymentKnown).toBe(true);
    expect(res.minimumPaymentAmount).toBe(300); // 200 interest + 100 principal
    expect(res.principalAfterPayment).toBe(4900); // 5000 - 100
  });

  it("derives next due date handling shorter months properly", () => {
    const jan31Debt: Debt = {
      ...mockDebt,
      firstDueDate: "2026-01-31",
    };
    const janPaidEvent = {
      id: "ev-1",
      debtId: mockDebt.id,
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

    const nextDate = getDerivedNextDueDate(jan31Debt.firstDueDate, [janPaidEvent], mockDebt.id);
    expect(nextDate).toBe("2026-02-28");
  });

  it("paymentStatus respects starts_on to avoid false overdue alerts before start date", () => {
    const linkedRec: RecurringPayment = {
      id: "debt:debt-next-1",
      name: "Empeño Joyas (Interés de deuda)",
      amount_mode: "fixed",
      amount: 300,
      dueDay: 15,
      dueDate: null,
      category: "Préstamos",
      status: "pendiente",
      notes: "Auto",
      recurrence_type: "indefinite",
      total_installments: null,
      paid_installments: 0,
      is_active: true,
      last_paid_month: null,
      last_paid_year: null,
      linked_debt_id: "debt-next-1",
      starts_on: "2026-09-15",
      currency_code: "PEN",
    };

    const status = paymentStatus(linkedRec);
    expect(status.tone).not.toBe("danger");
  });

  it("buildObligationProjection respects linked debt currency and dynamic next payment", () => {
    const linkedRec: RecurringPayment = {
      id: "debt:debt-next-1",
      name: "Empeño Joyas (Interés de deuda)",
      amount_mode: "fixed",
      amount: 300,
      dueDay: 15,
      dueDate: null,
      category: "Préstamos",
      status: "pendiente",
      notes: "Auto",
      recurrence_type: "indefinite",
      total_installments: null,
      paid_installments: 0,
      is_active: true,
      last_paid_month: null,
      last_paid_year: null,
      linked_debt_id: "debt-next-1",
      starts_on: "2026-08-15",
      currency_code: "USD",
    };

    const proj = buildObligationProjection({
      recurringPayments: [linkedRec],
      debts: [mockDebt],
      debtPlanningItems: [],
      todayKey: "2026-08-10",
    });

    const item = proj.items.find((i) => i.sourceId === linkedRec.id);
    expect(item).toBeDefined();
    expect(item?.currencyCode).toBe("PEN"); // Inherited from linked debt
  });

  it("renders Próximo Pago section in DebtDetailModal", () => {
    const mockIntelligence = {
      debtId: mockDebt.id,
      name: mockDebt.name,
      creditorName: mockDebt.creditorName,
      debtKind: mockDebt.debtKind,
      currencyCode: mockDebt.currencyCode,
      status: "active",
      currentPrincipal: 5000,
      openingBalance: 5000,
      originalPrincipal: 5000,
      repaymentStructure: "open_ended",
      readiness: { limitations: [] },
      installmentsProgress: null,
      collateralProtection: null,
      interestDiagnosis: { summary: "Tasa 4% mensual" },
      financialAlerts: [],
      historicalEconomics: {
        cashOutflow: 0,
        principalPaid: 0,
        interestPaid: 0,
        feesPaid: 0,
        insurancePaid: 0,
        otherCostPaid: 0,
        totalCost: 0,
      },
    } as unknown as DebtIntelligenceItem;

    const html = renderToStaticMarkup(
      <DebtDetailModal
        debt={mockDebt}
        debtIntelligence={mockIntelligence}
        debtEvents={[]}
        scheduleVersions={[]}
        installments={[]}
        allocations={[]}
        collaterals={[]}
        accounts={[]}
        categories={[]}
        onClose={vi.fn()}
        onOpenOperation={vi.fn()}
        onRefresh={vi.fn()}
        setToast={vi.fn()}
      />
    );

    expect(html).toContain("PRÓXIMO PAGO");
    expect(html).toContain("Registrar este pago");
    expect(html).toContain("Interés estimado");
    expect(html).toContain("Mínimo a capital");
    expect(html).toContain("Pago mínimo");
  });

  it("renders Deuda vinculada badge and action CTA in RecurringPayments", () => {
    const linkedRec: RecurringPayment = {
      id: "debt:debt-next-1",
      name: "Empeño Joyas (Interés de deuda)",
      amount_mode: "fixed",
      amount: 300,
      dueDay: 15,
      dueDate: null,
      category: "Préstamos",
      status: "pendiente",
      notes: "Auto",
      recurrence_type: "indefinite",
      total_installments: null,
      paid_installments: 0,
      is_active: true,
      last_paid_month: null,
      last_paid_year: null,
      linked_debt_id: "debt-next-1",
      starts_on: "2026-08-15",
      currency_code: "PEN",
    };

    const alertSummary = {
      overdue: [],
      today: [],
      tomorrow: [],
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
  });
});
