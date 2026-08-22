import { describe, expect, it } from "vitest";
import type { RecurringPayment } from "../../src/types.js";
import type { DebtInstallmentPlanningItem } from "../../src/utils/debtPlanning.js";
import { buildObligationReminderPayload } from "./paymentReminders.js";

function recurringPayment(overrides: Partial<RecurringPayment> = {}): RecurringPayment {
  return {
    id: "p1",
    name: "Luz",
    amount: 150,
    amount_mode: "fixed",
    dueDay: 15,
    dueDate: "2026-08-15",
    category: "Servicios",
    status: "pendiente",
    notes: "",
    recurrence_type: "indefinite",
    total_installments: null,
    paid_installments: 0,
    is_active: true,
    last_paid_month: null,
    last_paid_year: null,
    paidAt: null,
    ...overrides,
  };
}

function debtPlanningItem(overrides: Partial<DebtInstallmentPlanningItem> = {}): DebtInstallmentPlanningItem {
  return {
    debtId: "d1",
    debtName: "Préstamo BCP",
    creditorName: "BCP",
    currencyCode: "PEN",
    scheduleVersionId: "sv1",
    installmentId: "i1",
    installmentNumber: 1,
    dueDate: "2026-08-15",
    expectedAmount: 900,
    allocatedAmount: 0,
    remainingAmount: 900,
    amountKnown: true,
    dueStatus: "overdue",
    daysUntilDue: -6,
    dueTone: "red",
    dueLabel: "Vencida hace 6 días",
    isCovered: false,
    ...overrides,
  };
}

describe("DEBT-3C Server Push Notification Payload & Wording Rules", () => {
  it("1. recurring-only singular body wording", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [recurringPayment({ id: "p1" })],
      urgentDebtInstallments: [],
      today: "2026-08-21",
    });

    expect(payload.title).toBe("Caja Familiar");
    expect(payload.body).toBe("Tienes 1 pago que requiere atención.");
  });

  it("2. recurring-only plural body wording", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [recurringPayment({ id: "p1" }), recurringPayment({ id: "p2" })],
      urgentDebtInstallments: [],
      today: "2026-08-21",
    });

    expect(payload.body).toBe("Tienes 2 pagos que requieren atención.");
  });

  it("3. Debt-only singular body wording", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [],
      urgentDebtInstallments: [debtPlanningItem({ debtId: "d1" })],
      today: "2026-08-21",
    });

    expect(payload.body).toBe("Tienes 1 cuota de deuda que requiere atención.");
  });

  it("4. Debt-only plural body wording", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [],
      urgentDebtInstallments: [debtPlanningItem({ debtId: "d1" }), debtPlanningItem({ debtId: "d2" })],
      today: "2026-08-21",
    });

    expect(payload.body).toBe("Tienes 2 cuotas de deuda que requieren atención.");
  });

  it("5. mixed body wording (handles singular and plural combinations)", () => {
    const mixed1 = buildObligationReminderPayload({
      urgentRecurringPayments: [recurringPayment({ id: "p1" })],
      urgentDebtInstallments: [debtPlanningItem({ debtId: "d1" })],
      today: "2026-08-21",
    });
    expect(mixed1.body).toBe("Tienes 2 obligaciones que requieren atención: 1 pago y 1 cuota de deuda.");

    const mixed2 = buildObligationReminderPayload({
      urgentRecurringPayments: [recurringPayment({ id: "p1" }), recurringPayment({ id: "p2" })],
      urgentDebtInstallments: [debtPlanningItem({ debtId: "d1" }), debtPlanningItem({ debtId: "d2" }), debtPlanningItem({ debtId: "d3" })],
      today: "2026-08-21",
    });
    expect(mixed2.body).toBe("Tienes 5 obligaciones que requieren atención: 2 pagos y 3 cuotas de deuda.");
  });

  it("6. exactly one recurring => payment deep link", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [recurringPayment({ id: "p-abc" })],
      urgentDebtInstallments: [],
      today: "2026-08-21",
    });

    expect(payload.url).toBe("/?view=pagos&payment=p-abc");
  });

  it("7. exactly one Debt => debt deep link", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [],
      urgentDebtInstallments: [debtPlanningItem({ debtId: "d-bcp" })],
      today: "2026-08-21",
    });

    expect(payload.url).toBe("/?view=deudas&debt=d-bcp");
  });

  it("8. multiple recurring => view=pagos", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [recurringPayment({ id: "p1" }), recurringPayment({ id: "p2" })],
      urgentDebtInstallments: [],
      today: "2026-08-21",
    });

    expect(payload.url).toBe("/?view=pagos");
  });

  it("9. multiple Debt => view=deudas", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [],
      urgentDebtInstallments: [debtPlanningItem({ debtId: "d1" }), debtPlanningItem({ debtId: "d2" })],
      today: "2026-08-21",
    });

    expect(payload.url).toBe("/?view=deudas");
  });

  it("10. mixed => view=dashboard", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [recurringPayment({ id: "p1" })],
      urgentDebtInstallments: [debtPlanningItem({ debtId: "d1" })],
      today: "2026-08-21",
    });

    expect(payload.url).toBe("/?view=dashboard");
  });

  it("11-12. daily stable tag format", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [recurringPayment()],
      urgentDebtInstallments: [],
      today: "2026-08-21",
    });

    expect(payload.tag).toBe("urgent-payments-2026-08-21");
  });

  it("13. no financial amount included in payload body", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [recurringPayment({ amount: 9999.99 })],
      urgentDebtInstallments: [debtPlanningItem({ expectedAmount: 8888.88 })],
      today: "2026-08-21",
    });

    expect(payload.body).not.toContain("9999");
    expect(payload.body).not.toContain("8888");
    expect(payload.body).not.toContain("PEN");
    expect(payload.body).not.toContain("S/");
    expect(payload.body).not.toContain("$");
  });
});
