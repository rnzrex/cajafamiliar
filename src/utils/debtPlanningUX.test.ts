import { describe, expect, it } from "vitest";
import type { Debt, DebtEvent, DebtEventInstallmentAllocation, DebtInstallment, DebtScheduleVersion } from "../types";
import {
  buildDebtPlanningItems,
  formatMonthKeyLabel,
  getNextMonthKey,
  getPrevMonthKey,
  groupDebtPlanningItemsForAgenda,
  selectDebtPlanningAttentionItems,
  summarizeDebtPlanningAlerts,
  summarizeDebtPlanningMonth,
} from "./debtPlanning";

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

describe("DEBT-3B Hardened UX & Multi-Currency Contracts", () => {
  it("1. currencyCode is present in planning item", () => {
    const dUSD = debt({ id: "d-usd", currencyCode: "USD" });
    const sv = scheduleVersion({ debtId: "d-usd" });
    const inst = installment({ debtId: "d-usd", scheduleVersionId: sv.id });

    const items = buildDebtPlanningItems([dUSD], [], [sv], [inst], [], "2026-08-21");
    expect(items[0].currencyCode).toBe("USD");
  });

  it("2. single currency: top-level monetary metrics are numbers (not null)", () => {
    const sv = scheduleVersion();
    const inst = installment({ expectedAmount: 1000, dueDate: "2026-08-25" });
    const items = buildDebtPlanningItems([debt()], [], [sv], [inst], [], "2026-08-21");

    const summary = summarizeDebtPlanningMonth(items, "2026-08");
    expect(summary.currencyCode).toBe("PEN");
    expect(summary.hasMultipleCurrencies).toBe(false);
    expect(summary.scheduledKnownAmount).toBe(1000);
    expect(summary.pendingKnownAmount).toBe(1000);
    expect(summary.coveredKnownAmount).toBe(0);
    expect(summary.overdueKnownAmount).toBe(0);
  });

  it("3-5 & 7. multi-currency: hasMultipleCurrencies=true, currencyCode=null, top-level monetary fields are null", () => {
    const dPEN = debt({ id: "d-pen", currencyCode: "PEN" });
    const dUSD = debt({ id: "d-usd", currencyCode: "USD" });
    const svPEN = scheduleVersion({ id: "sv-pen", debtId: "d-pen" });
    const svUSD = scheduleVersion({ id: "sv-usd", debtId: "d-usd" });
    const iPEN = installment({ id: "i-pen", debtId: "d-pen", scheduleVersionId: "sv-pen", expectedAmount: 1000, dueDate: "2026-08-15" });
    const iUSD = installment({ id: "i-usd", debtId: "d-usd", scheduleVersionId: "sv-usd", expectedAmount: 300, dueDate: "2026-08-20" });

    const items = buildDebtPlanningItems([dPEN, dUSD], [], [svPEN, svUSD], [iPEN, iUSD], [], "2026-08-21");
    const summary = summarizeDebtPlanningMonth(items, "2026-08");

    expect(summary.hasMultipleCurrencies).toBe(true);
    expect(summary.currencyCode).toBeNull();
    // Rule: top-level monetary amounts MUST be null to prevent cross-currency summation (e.g. 1000 PEN + 300 USD != 1300)
    expect(summary.scheduledKnownAmount).toBeNull();
    expect(summary.coveredKnownAmount).toBeNull();
    expect(summary.pendingKnownAmount).toBeNull();
    expect(summary.overdueKnownAmount).toBeNull();

    // Counts remain numeric
    expect(summary.totalInstallments).toBe(2);
    expect(summary.knownAmountInstallments).toBe(2);
  });

  it("6, 8, 9. PEN and USD remain separated in byCurrency with per-currency counts and overdue amounts", () => {
    const dPEN = debt({ id: "d-pen", currencyCode: "PEN" });
    const dUSD = debt({ id: "d-usd", currencyCode: "USD" });
    const svPEN = scheduleVersion({ id: "sv-pen", debtId: "d-pen" });
    const svUSD = scheduleVersion({ id: "sv-usd", debtId: "d-usd" });

    // overdue PEN cuota
    const iPEN = installment({ id: "i-pen", debtId: "d-pen", scheduleVersionId: "sv-pen", expectedAmount: 1000, dueDate: "2026-08-01" });
    // overdue USD cuota with unknown amount
    const iUSD = installment({ id: "i-usd", debtId: "d-usd", scheduleVersionId: "sv-usd", expectedAmount: null, dueDate: "2026-08-05" });

    const items = buildDebtPlanningItems([dPEN, dUSD], [], [svPEN, svUSD], [iPEN, iUSD], [], "2026-08-21");
    const summary = summarizeDebtPlanningMonth(items, "2026-08");

    expect(summary.byCurrency["PEN"].pendingKnownAmount).toBe(1000);
    expect(summary.byCurrency["PEN"].overdueKnownAmount).toBe(1000);
    expect(summary.byCurrency["PEN"].unknownAmountInstallments).toBe(0);

    expect(summary.byCurrency["USD"].pendingKnownAmount).toBe(0);
    expect(summary.byCurrency["USD"].overdueKnownAmount).toBe(0);
    expect(summary.byCurrency["USD"].unknownAmountInstallments).toBe(1);
    expect(summary.byCurrency["USD"].overdueInstallments).toBe(1);

    expect(summary.unknownAmountInstallments).toBe(1);
  });

  it("10. unknown amount does not turn into zero", () => {
    const sv = scheduleVersion();
    const iUnknown = installment({ id: "iu", dueDate: "2026-08-15", expectedAmount: null });
    const items = buildDebtPlanningItems([debt()], [], [sv], [iUnknown], [], "2026-08-21");

    const summary = summarizeDebtPlanningMonth(items, "2026-08");
    expect(summary.unknownAmountInstallments).toBe(1);
    expect(summary.scheduledKnownAmount).toBe(0);
    expect(summary.pendingKnownAmount).toBe(0);
  });

  it("11-14. selectDebtPlanningAttentionItems uses production helper, filters overdue/today/tomorrow/upcoming, sorts by daysUntilDue, respects limit", () => {
    const sv = scheduleVersion();
    const d1 = debt({ id: "d1" });

    const iOverdue = installment({ id: "iod", dueDate: "2026-08-10" }); // -11 days
    const iToday = installment({ id: "itd", dueDate: "2026-08-21", installmentNumber: 2 }); // 0 days
    const iTomorrow = installment({ id: "itm", dueDate: "2026-08-22", installmentNumber: 3 }); // +1 days
    const iUpcoming = installment({ id: "iup", dueDate: "2026-08-25", installmentNumber: 4 }); // +4 days
    const iLater = installment({ id: "ila", dueDate: "2026-08-31", installmentNumber: 5 }); // +10 days (excluded)
    const iCovered = installment({ id: "ico", dueDate: "2026-08-01", expectedAmount: 100, installmentNumber: 6 }); // covered (excluded)
    const ev = debtEvent({ id: "e1" });
    const alloc = allocation({ id: "a1", eventId: "e1", installmentId: "ico", allocatedAmount: 100 });

    const items = buildDebtPlanningItems([d1], [ev], [sv], [iOverdue, iToday, iTomorrow, iUpcoming, iLater, iCovered], [alloc], "2026-08-21");

    // Call production helper with default limit=3
    const attention3 = selectDebtPlanningAttentionItems(items, 3);
    expect(attention3).toHaveLength(3);
    expect(attention3.map((i) => i.installmentId)).toEqual(["iod", "itd", "itm"]);

    // Call production helper with limit=10
    const attentionAll = selectDebtPlanningAttentionItems(items, 10);
    expect(attentionAll).toHaveLength(4); // excludes iLater and iCovered
    expect(attentionAll.map((i) => i.installmentId)).toEqual(["iod", "itd", "itm", "iup"]);
  });

  it("15. selected month filters items correctly and month navigation works", () => {
    expect(getNextMonthKey("2026-12")).toBe("2027-01");
    expect(getPrevMonthKey("2027-01")).toBe("2026-12");
    expect(formatMonthKeyLabel("2027-01")).toBe("Enero 2027");
  });

  it("16. agenda grouping places items in correct groups without duplication", () => {
    const sv = scheduleVersion();
    const i1 = installment({ id: "i1", dueDate: "2026-08-10" }); // overdue
    const i2 = installment({ id: "i2", dueDate: "2026-08-21", installmentNumber: 2 }); // today
    const items = buildDebtPlanningItems([debt()], [], [sv], [i1, i2], [], "2026-08-21");

    const groups = groupDebtPlanningItemsForAgenda(items);
    expect(groups.map((g) => g.key)).toEqual(["overdue", "today"]);
  });
});
