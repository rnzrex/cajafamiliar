import { describe, expect, it } from "vitest";
import type { Debt } from "../types";
import { parseNotificationDeepLink } from "./deepLink";

function sampleDebt(id: string, name: string): Debt {
  return {
    id,
    name,
    creditorName: "Banco",
    debtKind: "bank_loan",
    currencyCode: "PEN",
    originDate: null,
    trackingStartDate: "2026-01-01",
    originalPrincipal: 5000,
    openingPrincipalBalance: 5000,
    plannedInstallmentCount: 10,
    plannedInstallmentAmount: 500,
    installmentAmountMode: "fixed",
    paymentFrequency: "monthly",
    customFrequencyDays: null,
    firstDueDate: "2026-02-01",
    teaPercent: null,
    tceaPercent: null,
    notes: "",
    status: "active",
    isArchived: false,
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("DEBT-3C Deep Link Navigation Parsing", () => {
  const debtsList = [sampleDebt("debt-bcp", "Préstamo BCP"), sampleDebt("debt-bbva", "Préstamo BBVA")];
  const cardDebt = { ...sampleDebt("card-visa", "Visa Signature"), debtKind: "credit_card" as const };

  it("1. pagos with valid payment id", () => {
    const res = parseNotificationDeepLink("?view=pagos&payment=pay-123", debtsList);
    expect(res.view).toBe("pagos");
    expect(res.focusedPaymentId).toBe("pay-123");
    expect(res.selectedDebtId).toBeNull();
  });

  it("2. deudas with valid debt id resolves debtId correctly", () => {
    const res = parseNotificationDeepLink("?view=deudas&debt=debt-bbva", debtsList);
    expect(res.view).toBe("deudas");
    expect(res.focusedPaymentId).toBeNull();
    expect(res.selectedDebtId).toBe("debt-bbva");
  });

  it("3. deudas with non-existent debt id keeps view=deudas without error", () => {
    const res = parseNotificationDeepLink("?view=deudas&debt=debt-nonexistent", debtsList);
    expect(res.view).toBe("deudas");
    expect(res.focusedPaymentId).toBeNull();
    expect(res.selectedDebtId).toBeNull();
  });

  it("4. dashboard view clears focusedPaymentId and selectedDebtId", () => {
    const res = parseNotificationDeepLink("?view=dashboard", debtsList);
    expect(res.view).toBe("dashboard");
    expect(res.focusedPaymentId).toBeNull();
    expect(res.selectedDebtId).toBeNull();
  });

  it("5. unknown view or empty query returns null view", () => {
    const res1 = parseNotificationDeepLink("?view=arbitrary_view", debtsList);
    expect(res1.view).toBeNull();

    const res2 = parseNotificationDeepLink("", debtsList);
    expect(res2.view).toBeNull();
  });

  it("6. tarjetas deep link resolves a credit card detail", () => {
    const res = parseNotificationDeepLink("?view=tarjetas&debt=card-visa", [...debtsList, cardDebt]);
    expect(res.view).toBe("tarjetas");
    expect(res.selectedDebtId).toBe("card-visa");
  });

  it("7. legacy deudas deep link for a card is routed to tarjetas", () => {
    const res = parseNotificationDeepLink("?view=deudas&debt=card-visa", [...debtsList, cardDebt]);
    expect(res.view).toBe("tarjetas");
    expect(res.selectedDebtId).toBe("card-visa");
  });
});
