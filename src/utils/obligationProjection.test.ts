import { describe, expect, it } from "vitest";
import type { Debt, DebtEvent, DebtEventInstallmentAllocation, DebtInstallment, DebtScheduleVersion, RecurringPayment } from "../types";
import { monthlyDueDate } from "./calculations";
import { buildDebtPlanningItems } from "./debtPlanning";
import { buildObligationProjection, summarizeObligationProjectionMonth } from "./obligationProjection";

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

function debt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: "d1",
    name: "Préstamo BCP",
    creditorName: "BCP",
    debtKind: "bank_loan",
    currencyCode: "PEN",
    originDate: null,
    trackingStartDate: "2026-01-01",
    originalPrincipal: 10000,
    openingPrincipalBalance: 10000,
    plannedInstallmentCount: 12,
    plannedInstallmentAmount: 900,
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
    ...overrides,
  };
}

function scheduleVersion(overrides: Partial<DebtScheduleVersion> = {}): DebtScheduleVersion {
  return {
    id: "sv1",
    debtId: "d1",
    versionNumber: 1,
    effectiveDate: "2026-01-01",
    reason: "initial",
    triggerEventId: null,
    notes: "",
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function installment(overrides: Partial<DebtInstallment> = {}): DebtInstallment {
  return {
    id: "i1",
    scheduleVersionId: "sv1",
    debtId: "d1",
    installmentNumber: 1,
    dueDate: "2026-08-15",
    expectedAmount: 900,
    expectedPrincipal: 750,
    expectedInterest: 150,
    expectedFees: null,
    expectedInsurance: null,
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function debtEvent(overrides: Partial<DebtEvent> = {}): DebtEvent {
  return {
    id: "e1",
    debtId: "d1",
    eventDate: "2026-08-10",
    eventType: "payment",
    cashAmount: 900,
    principalDelta: -750,
    interestPaid: 150,
    feesPaid: 0,
    insurancePaid: 0,
    otherCostPaid: 0,
    breakdownComplete: true,
    movementId: "m1",
    reversalOfEventId: null,
    description: "Pago cuota",
    registeredByUserId: "u1",
    createdAt: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

function allocation(overrides: Partial<DebtEventInstallmentAllocation> = {}): DebtEventInstallmentAllocation {
  return {
    id: "a1",
    eventId: "e1",
    installmentId: "i1",
    debtId: "d1",
    allocatedAmount: 900,
    createdByUserId: "u1",
    createdAt: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

describe("DEBT-3D Obligation Projection Read-Model", () => {
  const todayKey = "2026-08-21";

  describe("Recurring Payments Projection", () => {
    it("1. indefinite pendiente generates current month + next 2 months", () => {
      const p = recurringPayment({ recurrence_type: "indefinite", status: "pendiente", last_paid_month: null });
      const result = buildObligationProjection({ recurringPayments: [p], debts: [], debtPlanningItems: [], todayKey });

      expect(result.horizonMonths).toEqual(["2026-08", "2026-09", "2026-10"]);
      expect(result.items).toHaveLength(3);
      expect(result.items.map((i) => i.monthKey)).toEqual(["2026-08", "2026-09", "2026-10"]);
    });

    it("2. indefinite pagado este mes starts from next month", () => {
      const p = recurringPayment({
        recurrence_type: "indefinite",
        status: "pagado",
        last_paid_month: 8,
        last_paid_year: 2026,
      });
      const result = buildObligationProjection({ recurringPayments: [p], debts: [], debtPlanningItems: [], todayKey });

      expect(result.items).toHaveLength(2);
      expect(result.items.map((i) => i.monthKey)).toEqual(["2026-09", "2026-10"]);
    });

    it("3. fixed respects remainingInstallments", () => {
      const p = recurringPayment({
        recurrence_type: "fixed",
        total_installments: 3,
        paid_installments: 1, // 2 remaining
        status: "pendiente",
        last_paid_month: null,
      });
      const result = buildObligationProjection({ recurringPayments: [p], debts: [], debtPlanningItems: [], todayKey });

      expect(result.items).toHaveLength(2);
      expect(result.items.map((i) => i.monthKey)).toEqual(["2026-08", "2026-09"]);
    });

    it("4. fixed finished does not appear (with is_active: true)", () => {
      const pFinished = recurringPayment({
        recurrence_type: "fixed",
        total_installments: 3,
        paid_installments: 3,
        is_active: true,
      });
      const result = buildObligationProjection({ recurringPayments: [pFinished], debts: [], debtPlanningItems: [], todayKey });

      expect(result.items).toHaveLength(0);
    });

    it("5. one_time pendiente appears once in corresponding month", () => {
      const pOneTime = recurringPayment({
        recurrence_type: "one_time",
        dueDate: "2026-09-10",
        status: "pendiente",
      });
      const result = buildObligationProjection({ recurringPayments: [pOneTime], debts: [], debtPlanningItems: [], todayKey });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].monthKey).toBe("2026-09");
    });

    it("6. one_time pagado is excluded (with is_active: true)", () => {
      const pOneTimePaid = recurringPayment({
        recurrence_type: "one_time",
        dueDate: "2026-08-10",
        status: "pagado",
        is_active: true,
      });
      const result = buildObligationProjection({ recurringPayments: [pOneTimePaid], debts: [], debtPlanningItems: [], todayKey });

      expect(result.items).toHaveLength(0);
    });

    it("fixed pagado este mes starts from next month with advancing installment numbers", () => {
      const p = recurringPayment({
        recurrence_type: "fixed",
        is_active: true,
        total_installments: 5,
        paid_installments: 2,
        last_paid_month: 8,
        last_paid_year: 2026,
        status: "pagado",
      });
      const result = buildObligationProjection({ recurringPayments: [p], debts: [], debtPlanningItems: [], todayKey });

      expect(result.items).toHaveLength(2);
      expect(result.items[0].monthKey).toBe("2026-09");
      expect(result.items[0].detail).toBe("Cuota 3 de 5");
      expect(result.items[1].monthKey).toBe("2026-10");
      expect(result.items[1].detail).toBe("Cuota 4 de 5");
    });

    it("fixed pendiente este mes starts from current month with advancing installment numbers", () => {
      const p = recurringPayment({
        recurrence_type: "fixed",
        is_active: true,
        total_installments: 5,
        paid_installments: 2,
        last_paid_month: null,
        status: "pendiente",
      });
      const result = buildObligationProjection({ recurringPayments: [p], debts: [], debtPlanningItems: [], todayKey });

      expect(result.items).toHaveLength(3);
      expect(result.items[0].monthKey).toBe("2026-08");
      expect(result.items[0].detail).toBe("Cuota 3 de 5");
      expect(result.items[1].monthKey).toBe("2026-09");
      expect(result.items[1].detail).toBe("Cuota 4 de 5");
      expect(result.items[2].monthKey).toBe("2026-10");
      expect(result.items[2].detail).toBe("Cuota 5 de 5");
    });

    it("one_time vencido previo goes to overduePriorItems", () => {
      const pOverduePrior = recurringPayment({
        recurrence_type: "one_time",
        is_active: true,
        status: "pendiente",
        dueDate: "2026-07-15",
      });
      const result = buildObligationProjection({ recurringPayments: [pOverduePrior], debts: [], debtPlanningItems: [], todayKey });

      expect(result.items).toHaveLength(0);
      expect(result.overduePriorItems).toHaveLength(1);
      expect(result.overduePriorItems[0].isOverduePrior).toBe(true);
      expect(result.overduePriorItems[0].dueStatus).toBe("overdue");
    });

    it("7. inactive is excluded", () => {
      const pInactive = recurringPayment({ is_active: false });
      const result = buildObligationProjection({ recurringPayments: [pInactive], debts: [], debtPlanningItems: [], todayKey });

      expect(result.items).toHaveLength(0);
    });

    it("8. dueDay=null does not invent date and increments unscheduledRecurringCount", () => {
      const pUnscheduled = recurringPayment({ dueDay: null, dueDate: null });
      const result = buildObligationProjection({ recurringPayments: [pUnscheduled], debts: [], debtPlanningItems: [], todayKey });

      expect(result.items).toHaveLength(0);
      expect(result.unscheduledRecurringCount).toBe(1);
    });

    it("9. one_time dueDate=null does not invent date and increments unscheduledRecurringCount", () => {
      const pOneTimeNoDate = recurringPayment({ recurrence_type: "one_time", dueDate: null, dueDay: null });
      const result = buildObligationProjection({ recurringPayments: [pOneTimeNoDate], debts: [], debtPlanningItems: [], todayKey });

      expect(result.items).toHaveLength(0);
      expect(result.unscheduledRecurringCount).toBe(1);
    });

    it("10. month-end clamp 31 -> end of month (Feb 28 in 2026, Apr 30)", () => {
      expect(monthlyDueDate(31, "2026-01-01")).toBe("2026-01-31");
      expect(monthlyDueDate(31, "2026-02-01")).toBe("2026-02-28");
      expect(monthlyDueDate(31, "2026-04-01")).toBe("2026-04-30");
    });

    it("11. variable amount_mode numeric => estimated amountKind", () => {
      const pVar = recurringPayment({ amount_mode: "variable", amount: 250 });
      const result = buildObligationProjection({ recurringPayments: [pVar], debts: [], debtPlanningItems: [], todayKey });

      expect(result.items[0].amountKind).toBe("estimated");
      expect(result.items[0].amount).toBe(250);
    });

    it("12. fixed amount_mode numeric => known amountKind", () => {
      const pFixed = recurringPayment({ amount_mode: "fixed", amount: 300 });
      const result = buildObligationProjection({ recurringPayments: [pFixed], debts: [], debtPlanningItems: [], todayKey });

      expect(result.items[0].amountKind).toBe("known");
      expect(result.items[0].amount).toBe(300);
    });

    it("13. amount=null => unknown amountKind", () => {
      const pUnknown = recurringPayment({ amount: null });
      const result = buildObligationProjection({ recurringPayments: [pUnknown], debts: [], debtPlanningItems: [], todayKey });

      expect(result.items[0].amountKind).toBe("unknown");
      expect(result.items[0].amount).toBeNull();
    });

    it("14. recurring currencyCode = PEN", () => {
      const p = recurringPayment();
      const result = buildObligationProjection({ recurringPayments: [p], debts: [], debtPlanningItems: [], todayKey });

      expect(result.items[0].currencyCode).toBe("PEN");
    });

    it("15. does not reconstruct historical missing months", () => {
      const p = recurringPayment({ recurrence_type: "indefinite", status: "pendiente", last_paid_month: null });
      const result = buildObligationProjection({ recurringPayments: [p], debts: [], debtPlanningItems: [], todayKey });

      // Only projects currentMonth (2026-08) and future (2026-09, 2026-10). Does not invent 2026-07.
      const monthKeys = result.items.map((i) => i.monthKey);
      expect(monthKeys).not.toContain("2026-07");
    });
  });

  describe("Debt Projection Rules", () => {
    it("16. Debt covered is excluded", () => {
      const d1 = debt({ id: "d1" });
      const sv = scheduleVersion({ id: "sv1", debtId: "d1" });
      const iCovered = installment({ id: "ic", debtId: "d1", expectedAmount: 500 });
      const ev = debtEvent({ id: "e1", debtId: "d1" });
      const alloc = allocation({ id: "a1", eventId: "e1", installmentId: "ic", allocatedAmount: 500 });

      const planningItems = buildDebtPlanningItems([d1], [ev], [sv], [iCovered], [alloc], todayKey);
      const result = buildObligationProjection({ recurringPayments: [], debts: [d1], debtPlanningItems: planningItems, todayKey });

      expect(result.items).toHaveLength(0);
    });

    it("17. Debt partial uses remainingAmount, NOT expectedAmount", () => {
      const d1 = debt({ id: "d1" });
      const sv = scheduleVersion({ id: "sv1", debtId: "d1" });
      const iPartial = installment({ id: "ip", debtId: "d1", expectedAmount: 1000 });
      const ev = debtEvent({ id: "e1", debtId: "d1" });
      const alloc = allocation({ id: "a1", eventId: "e1", installmentId: "ip", allocatedAmount: 400 });

      const planningItems = buildDebtPlanningItems([d1], [ev], [sv], [iPartial], [alloc], todayKey);
      const result = buildObligationProjection({ recurringPayments: [], debts: [d1], debtPlanningItems: planningItems, todayKey });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].amount).toBe(600); // 1000 - 400 = 600 remaining
      expect(result.items[0].amountKind).toBe("known");
    });

    it("18. Debt unknown retains amount=null", () => {
      const d1 = debt({ id: "d1" });
      const sv = scheduleVersion({ id: "sv1", debtId: "d1" });
      const iUnknown = installment({ id: "iu", debtId: "d1", expectedAmount: null });

      const planningItems = buildDebtPlanningItems([d1], [], [sv], [iUnknown], [], todayKey);
      const result = buildObligationProjection({ recurringPayments: [], debts: [d1], debtPlanningItems: planningItems, todayKey });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].amount).toBeNull();
      expect(result.items[0].amountKind).toBe("unknown");
    });

    it("19. Debt currencyCode is preserved", () => {
      const dUSD = debt({ id: "d-usd", currencyCode: "USD" });
      const sv = scheduleVersion({ id: "sv-usd", debtId: "d-usd" });
      const inst = installment({ id: "i-usd", debtId: "d-usd", scheduleVersionId: "sv-usd" });

      const planningItems = buildDebtPlanningItems([dUSD], [], [sv], [inst], [], todayKey);
      const result = buildObligationProjection({ recurringPayments: [], debts: [dUSD], debtPlanningItems: planningItems, todayKey });

      expect(result.items[0].currencyCode).toBe("USD");
    });

    it("20. Debt overdue from prior month goes to overduePrior", () => {
      const d1 = debt({ id: "d1" });
      const sv = scheduleVersion({ id: "sv1", debtId: "d1" });
      const iPriorOverdue = installment({ id: "ipo", debtId: "d1", dueDate: "2026-07-15" });

      const planningItems = buildDebtPlanningItems([d1], [], [sv], [iPriorOverdue], [], todayKey);
      const result = buildObligationProjection({ recurringPayments: [], debts: [d1], debtPlanningItems: planningItems, todayKey });

      expect(result.items).toHaveLength(0);
      expect(result.overduePriorItems).toHaveLength(1);
      expect(result.overduePriorItems[0].dueDate).toBe("2026-07-15");
      expect(result.overduePriorItems[0].isOverduePrior).toBe(true);
    });

    it("21. Debt current month goes to month bucket", () => {
      const d1 = debt({ id: "d1" });
      const sv = scheduleVersion({ id: "sv1", debtId: "d1" });
      const iCurrent = installment({ id: "ic", debtId: "d1", dueDate: "2026-08-25" });

      const planningItems = buildDebtPlanningItems([d1], [], [sv], [iCurrent], [], todayKey);
      const result = buildObligationProjection({ recurringPayments: [], debts: [d1], debtPlanningItems: planningItems, todayKey });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].monthKey).toBe("2026-08");
      expect(result.overduePriorItems).toHaveLength(0);
    });

    it("22. Debt beyond horizon does not appear", () => {
      const d1 = debt({ id: "d1" });
      const sv = scheduleVersion({ id: "sv1", debtId: "d1" });
      const iBeyond = installment({ id: "ib", debtId: "d1", dueDate: "2026-12-01" });

      const planningItems = buildDebtPlanningItems([d1], [], [sv], [iBeyond], [], todayKey);
      const result = buildObligationProjection({ recurringPayments: [], debts: [d1], debtPlanningItems: planningItems, todayKey });

      expect(result.items).toHaveLength(0);
      expect(result.overduePriorItems).toHaveLength(0);
    });

    it("23. active Debt without planning is counted separately", () => {
      const dActiveNoPlan = debt({ id: "d-noplan", status: "active", isArchived: false });
      const result = buildObligationProjection({ recurringPayments: [], debts: [dActiveNoPlan], debtPlanningItems: [], todayKey });

      expect(result.activeDebtsWithoutPlanningCount).toBe(1);
    });
  });

  describe("Consolidation & Summary Rules", () => {
    it("24. recurring + Debt appear together without merging", () => {
      const p = recurringPayment({ id: "p1", name: "Servicios" });
      const d = debt({ id: "d1", name: "Servicios" });
      const sv = scheduleVersion({ debtId: "d1" });
      const inst = installment({ debtId: "d1", dueDate: "2026-08-25" });

      const planningItems = buildDebtPlanningItems([d], [], [sv], [inst], [], todayKey);
      const result = buildObligationProjection({ recurringPayments: [p], debts: [d], debtPlanningItems: planningItems, todayKey });

      const augSummary = result.monthSummaries["2026-08"];
      expect(augSummary.totalObligations).toBe(2);
      expect(augSummary.recurringCount).toBe(1);
      expect(augSummary.debtCount).toBe(1);
    });

    it("25. same name in recurring/debt does NOT deduplicate", () => {
      const p = recurringPayment({ id: "p-bcp", name: "Préstamo BCP" });
      const d = debt({ id: "d-bcp", name: "Préstamo BCP" });
      const sv = scheduleVersion({ debtId: "d-bcp" });
      const inst = installment({ debtId: "d-bcp", dueDate: "2026-08-25" });

      const planningItems = buildDebtPlanningItems([d], [], [sv], [inst], [], todayKey);
      const result = buildObligationProjection({ recurringPayments: [p], debts: [d], debtPlanningItems: planningItems, todayKey });

      expect(result.items.filter((i) => i.monthKey === "2026-08")).toHaveLength(2);
    });

    it("26-27. PEN + USD remain separated in byCurrency without cross-currency monetary sum", () => {
      const pPEN = recurringPayment({ id: "p-pen", amount: 1000 });
      const dUSD = debt({ id: "d-usd", currencyCode: "USD" });
      const svUSD = scheduleVersion({ debtId: "d-usd" });
      const iUSD = installment({ debtId: "d-usd", dueDate: "2026-08-20", expectedAmount: 300 });

      const planningItems = buildDebtPlanningItems([dUSD], [], [svUSD], [iUSD], [], todayKey);
      const result = buildObligationProjection({ recurringPayments: [pPEN], debts: [dUSD], debtPlanningItems: planningItems, todayKey });

      const summary = result.monthSummaries["2026-08"];
      expect(summary.byCurrency["PEN"].knownAmount).toBe(1000);
      expect(summary.byCurrency["USD"].knownAmount).toBe(300);

      // Assure no single cross-currency totalAmount field exists on summary
      expect((summary as any).totalAmount).toBeUndefined();
    });

    it("28. known and estimated remain separated", () => {
      const pKnown = recurringPayment({ id: "pk", amount_mode: "fixed", amount: 500 });
      const pEst = recurringPayment({ id: "pe", amount_mode: "variable", amount: 200 });

      const result = buildObligationProjection({ recurringPayments: [pKnown, pEst], debts: [], debtPlanningItems: [], todayKey });
      const summary = result.monthSummaries["2026-08"].byCurrency["PEN"];

      expect(summary.knownAmount).toBe(500);
      expect(summary.estimatedAmount).toBe(200);
    });

    it("29. unknown does not sum as false-zero", () => {
      const pUnk = recurringPayment({ id: "pu", amount: null });
      const result = buildObligationProjection({ recurringPayments: [pUnk], debts: [], debtPlanningItems: [], todayKey });

      const summary = result.monthSummaries["2026-08"].byCurrency["PEN"];
      expect(summary.knownAmount).toBe(0);
      expect(summary.estimatedAmount).toBe(0);
      expect(summary.unknownAmountCount).toBe(1);
    });

    it("30-31. counts and 3-month horizon are correct", () => {
      const p = recurringPayment();
      const result = buildObligationProjection({ recurringPayments: [p], debts: [], debtPlanningItems: [], todayKey });

      expect(result.horizonMonths).toHaveLength(3);
      expect(result.horizonMonths).toEqual(["2026-08", "2026-09", "2026-10"]);
    });

    it("32. overdue prior items are not duplicated inside month buckets", () => {
      const d = debt({ id: "d1" });
      const sv = scheduleVersion({ debtId: "d1" });
      const iPrior = installment({ id: "ip", debtId: "d1", dueDate: "2026-07-10" });
      const iCurrent = installment({ id: "ic", debtId: "d1", dueDate: "2026-08-10" });

      const planningItems = buildDebtPlanningItems([d], [], [sv], [iPrior, iCurrent], [], todayKey);
      const result = buildObligationProjection({ recurringPayments: [], debts: [d], debtPlanningItems: planningItems, todayKey });

      expect(result.overduePriorItems).toHaveLength(1);
      expect(result.overduePriorItems[0].installmentId).toBe("ip");

      const monthItems = result.items.filter((i) => i.monthKey === "2026-08");
      expect(monthItems).toHaveLength(1);
      expect(monthItems[0].installmentId).toBe("ic");
    });
  });
});
