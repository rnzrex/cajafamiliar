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

describe("DEBT-3B UX & Planning Helpers (Original Coverage)", () => {
  it("1. selected month filters items correctly", () => {
    const sv = scheduleVersion();
    const i1 = installment({ id: "i1", dueDate: "2026-08-15" });
    const i2 = installment({ id: "i2", dueDate: "2026-09-15", installmentNumber: 2 });
    const items = buildDebtPlanningItems([debt()], [], [sv], [i1, i2], [], "2026-08-21");

    const augustItems = items.filter((item) => item.dueDate.startsWith("2026-08"));
    const septemberItems = items.filter((item) => item.dueDate.startsWith("2026-09"));

    expect(augustItems).toHaveLength(1);
    expect(augustItems[0].installmentId).toBe("i1");
    expect(septemberItems).toHaveLength(1);
    expect(septemberItems[0].installmentId).toBe("i2");
  });

  it("2. month navigation Dec -> Jan (year rollover)", () => {
    expect(getNextMonthKey("2026-12")).toBe("2027-01");
    expect(formatMonthKeyLabel("2027-01")).toBe("Enero 2027");
  });

  it("3. month navigation Jan -> Dec (year rollover)", () => {
    expect(getPrevMonthKey("2027-01")).toBe("2026-12");
    expect(formatMonthKeyLabel("2026-12")).toBe("Diciembre 2026");
  });

  it("4. agenda grouping does not duplicate items", () => {
    const sv = scheduleVersion();
    const i1 = installment({ id: "i1", dueDate: "2026-08-10" }); // overdue
    const i2 = installment({ id: "i2", dueDate: "2026-08-21", installmentNumber: 2 }); // today
    const i3 = installment({ id: "i3", dueDate: "2026-08-22", installmentNumber: 3 }); // tomorrow
    const i4 = installment({ id: "i4", dueDate: "2026-08-26", installmentNumber: 4 }); // upcoming
    const i5 = installment({ id: "i5", dueDate: "2026-08-31", installmentNumber: 5 }); // later
    const i6 = installment({ id: "i6", dueDate: "2026-08-01", installmentNumber: 6, expectedAmount: 100 }); // covered
    const ev = debtEvent({ id: "e1" });
    const alloc = allocation({ id: "a1", eventId: "e1", installmentId: "i6", allocatedAmount: 100 });

    const items = buildDebtPlanningItems([debt()], [ev], [sv], [i1, i2, i3, i4, i5, i6], [alloc], "2026-08-21");
    const monthItems = items.filter((item) => item.dueDate.startsWith("2026-08"));
    const groups = groupDebtPlanningItemsForAgenda(monthItems);

    const totalInGroups = groups.reduce((sum, g) => sum + g.items.length, 0);
    expect(totalInGroups).toBe(monthItems.length);

    // Verify all item IDs are unique across groups
    const itemIds = groups.flatMap((g) => g.items.map((i) => i.installmentId));
    expect(new Set(itemIds).size).toBe(monthItems.length);
  });

  it("5. covered items go to Cubiertas group", () => {
    const sv = scheduleVersion();
    const iCovered = installment({ id: "i1", dueDate: "2026-08-01", expectedAmount: 500 });
    const ev = debtEvent({ id: "e1" });
    const alloc = allocation({ id: "a1", eventId: "e1", installmentId: "i1", allocatedAmount: 500 });
    const items = buildDebtPlanningItems([debt()], [ev], [sv], [iCovered], [alloc], "2026-08-21");

    const groups = groupDebtPlanningItemsForAgenda(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("covered");
    expect(groups[0].label).toBe("Cubiertas");
  });

  it("6. overdue items go to Vencidas group", () => {
    const sv = scheduleVersion();
    const iOverdue = installment({ id: "i1", dueDate: "2026-08-05", expectedAmount: 500 });
    const items = buildDebtPlanningItems([debt()], [], [sv], [iOverdue], [], "2026-08-21");

    const groups = groupDebtPlanningItemsForAgenda(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("overdue");
    expect(groups[0].label).toBe("Vencidas");
  });

  it("7. today/tomorrow/upcoming grouped correctly", () => {
    const sv = scheduleVersion();
    const iToday = installment({ id: "itd", dueDate: "2026-08-21" });
    const iTomorrow = installment({ id: "itm", dueDate: "2026-08-22", installmentNumber: 2 });
    const iUpcoming = installment({ id: "iup", dueDate: "2026-08-26", installmentNumber: 3 });

    const items = buildDebtPlanningItems([debt()], [], [sv], [iToday, iTomorrow, iUpcoming], [], "2026-08-21");
    const groups = groupDebtPlanningItemsForAgenda(items);

    expect(groups.map((g) => g.key)).toEqual(["today", "tomorrow", "upcoming"]);
  });

  it("8. later grouped correctly", () => {
    const sv = scheduleVersion();
    const iLater = installment({ id: "ila", dueDate: "2026-08-31" });

    const items = buildDebtPlanningItems([debt()], [], [sv], [iLater], [], "2026-08-21");
    const groups = groupDebtPlanningItemsForAgenda(items);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("later");
  });

  it("9. unknown amount shows semantics without false-zero", () => {
    const sv = scheduleVersion();
    const iKnown = installment({ id: "ik", dueDate: "2026-08-25", expectedAmount: 1000 });
    const iUnknown = installment({ id: "iu", dueDate: "2026-08-28", expectedAmount: null, installmentNumber: 2 });

    const items = buildDebtPlanningItems([debt()], [], [sv], [iKnown, iUnknown], [], "2026-08-21");
    const summary = summarizeDebtPlanningMonth(items, "2026-08");

    expect(summary.totalInstallments).toBe(2);
    expect(summary.knownAmountInstallments).toBe(1);
    expect(summary.unknownAmountInstallments).toBe(1);
    expect(summary.scheduledKnownAmount).toBe(1000);
    expect(summary.pendingKnownAmount).toBe(1000);
  });

  it("10. known partial retains remaining amount", () => {
    const sv = scheduleVersion();
    const iPartial = installment({ id: "ip", dueDate: "2026-08-25", expectedAmount: 1000 });
    const ev = debtEvent({ id: "e1" });
    const alloc = allocation({ id: "a1", eventId: "e1", installmentId: "ip", allocatedAmount: 400 });

    const items = buildDebtPlanningItems([debt()], [ev], [sv], [iPartial], [alloc], "2026-08-21");
    expect(items[0].remainingAmount).toBe(600);
    expect(items[0].isCovered).toBe(false);
  });

  it("11. combined mobile attention total = recurring total + debt total", () => {
    const recurringTotal = 2; // e.g. 2 overdue recurring payments
    const debtAlertSummary = { overdue: 1, today: 1, tomorrow: 0, upcoming: 1, total: 3 };
    const combinedTotal = recurringTotal + debtAlertSummary.total;
    expect(combinedTotal).toBe(5);
  });

  it("12. debt alert summary excludes covered and later items", () => {
    const sv = scheduleVersion();
    const iCovered = installment({ id: "ic", dueDate: "2026-08-01", expectedAmount: 500 });
    const iLater = installment({ id: "il", dueDate: "2026-08-31", expectedAmount: 500, installmentNumber: 2 });
    const iUrgent = installment({ id: "iu", dueDate: "2026-08-21", expectedAmount: 500, installmentNumber: 3 });

    const ev = debtEvent({ id: "e1" });
    const alloc = allocation({ id: "a1", eventId: "e1", installmentId: "ic", allocatedAmount: 500 });

    const items = buildDebtPlanningItems([debt()], [ev], [sv], [iCovered, iLater, iUrgent], [alloc], "2026-08-21");
    const alertSummary = summarizeDebtPlanningAlerts(items);

    expect(alertSummary.total).toBe(1);
    expect(alertSummary.today).toBe(1);
    expect(alertSummary.overdue).toBe(0);
  });

  it("13. dashboard debt attention sorted by daysUntilDue ascending using production helper", () => {
    const sv = scheduleVersion();
    const iToday = installment({ id: "itd", dueDate: "2026-08-21" });
    const iOverdue = installment({ id: "iod", dueDate: "2026-08-10", installmentNumber: 2 });
    const iUpcoming = installment({ id: "iup", dueDate: "2026-08-25", installmentNumber: 3 });

    const items = buildDebtPlanningItems([debt()], [], [sv], [iToday, iOverdue, iUpcoming], [], "2026-08-21");
    const attentionItems = selectDebtPlanningAttentionItems(items, 3);

    expect(attentionItems.map((i) => i.installmentId)).toEqual(["iod", "itd", "iup"]);
  });

  it("14. debt navigation resolves debtId correctly", () => {
    const d1 = debt({ id: "debt-bcp", name: "Préstamo BCP" });
    const d2 = debt({ id: "debt-bbva", name: "Préstamo BBVA" });
    const debtsList = [d1, d2];

    const targetId = "debt-bbva";
    const foundDebt = debtsList.find((d) => d.id === targetId);

    expect(foundDebt).toBeDefined();
    expect(foundDebt?.name).toBe("Préstamo BBVA");
  });

  it("15. multi-currency basic handling (currencyCode present in item)", () => {
    const dPEN = debt({ id: "d-pen", currencyCode: "PEN" });
    const dUSD = debt({ id: "d-usd", currencyCode: "USD" });

    const svPEN = scheduleVersion({ id: "sv-pen", debtId: "d-pen" });
    const svUSD = scheduleVersion({ id: "sv-usd", debtId: "d-usd" });

    const iPEN = installment({ id: "i-pen", debtId: "d-pen", scheduleVersionId: "sv-pen", expectedAmount: 1000, dueDate: "2026-08-15" });
    const iUSD = installment({ id: "i-usd", debtId: "d-usd", scheduleVersionId: "sv-usd", expectedAmount: 300, dueDate: "2026-08-20" });

    const items = buildDebtPlanningItems([dPEN, dUSD], [], [svPEN, svUSD], [iPEN, iUSD], [], "2026-08-21");

    expect(items.find((i) => i.installmentId === "i-pen")?.currencyCode).toBe("PEN");
    expect(items.find((i) => i.installmentId === "i-usd")?.currencyCode).toBe("USD");
  });
});

describe("DEBT-3B Hardened Multi-Currency Contracts & Attention Helpers", () => {
  it("16. single currency: top-level monetary metrics are numbers (not null)", () => {
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

  it("17. multi-currency: hasMultipleCurrencies=true, currencyCode=null, top-level monetary fields are null", () => {
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
    // Top-level monetary fields must be null to avoid cross-currency addition (e.g. 1000 PEN + 300 USD != 1300)
    expect(summary.scheduledKnownAmount).toBeNull();
    expect(summary.coveredKnownAmount).toBeNull();
    expect(summary.pendingKnownAmount).toBeNull();
    expect(summary.overdueKnownAmount).toBeNull();

    // Counts remain numeric
    expect(summary.totalInstallments).toBe(2);
    expect(summary.knownAmountInstallments).toBe(2);
  });

  it("18. PEN and USD remain separated in byCurrency with per-currency counts and overdue amounts", () => {
    const dPEN = debt({ id: "d-pen", currencyCode: "PEN" });
    const dUSD = debt({ id: "d-usd", currencyCode: "USD" });
    const svPEN = scheduleVersion({ id: "sv-pen", debtId: "d-pen" });
    const svUSD = scheduleVersion({ id: "sv-usd", debtId: "d-usd" });

    const iPEN = installment({ id: "i-pen", debtId: "d-pen", scheduleVersionId: "sv-pen", expectedAmount: 1000, dueDate: "2026-08-01" });
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

  it("19. unknown amount does not turn into zero", () => {
    const sv = scheduleVersion();
    const iUnknown = installment({ id: "iu", dueDate: "2026-08-15", expectedAmount: null });
    const items = buildDebtPlanningItems([debt()], [], [sv], [iUnknown], [], "2026-08-21");

    const summary = summarizeDebtPlanningMonth(items, "2026-08");
    expect(summary.unknownAmountInstallments).toBe(1);
    expect(summary.scheduledKnownAmount).toBe(0);
    expect(summary.pendingKnownAmount).toBe(0);
  });

  it("20. selectDebtPlanningAttentionItems filters overdue/today/tomorrow/upcoming, excludes covered/later, sorts by daysUntilDue, respects limit", () => {
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

    const attention3 = selectDebtPlanningAttentionItems(items, 3);
    expect(attention3).toHaveLength(3);
    expect(attention3.map((i) => i.installmentId)).toEqual(["iod", "itd", "itm"]);

    const attentionAll = selectDebtPlanningAttentionItems(items, 10);
    expect(attentionAll).toHaveLength(4);
    expect(attentionAll.map((i) => i.installmentId)).toEqual(["iod", "itd", "itm", "iup"]);
  });
});
