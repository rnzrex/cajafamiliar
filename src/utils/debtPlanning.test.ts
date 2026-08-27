import { afterEach, describe, expect, it, vi } from "vitest";
import type { Debt, DebtEvent, DebtEventInstallmentAllocation, DebtInstallment, DebtScheduleVersion } from "../types";
import { buildDebtPlanningItems, getBankPrepaymentScheduleTarget, summarizeDebtPlanningAlerts, summarizeDebtPlanningMonth } from "./debtPlanning";
import { paymentStatus, paymentAlert } from "./calculations";


// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
    dueDate: "2026-09-01",
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

// Convenience: build items with defaults
function build(
  debts: Debt[],
  events: DebtEvent[],
  versions: DebtScheduleVersion[],
  installments: DebtInstallment[],
  allocs: DebtEventInstallmentAllocation[],
  todayKey = "2026-08-21"
) {
  return buildDebtPlanningItems(debts, events, versions, installments, allocs, todayKey);
}

afterEach(() => vi.useRealTimers());

// ---------------------------------------------------------------------------
// Tests 11-12: Schedule version handling
// ---------------------------------------------------------------------------

describe("buildDebtPlanningItems — schedule version handling", () => {
  it("11. uses only the current (highest versionNumber) schedule", () => {
    const v1 = scheduleVersion({ id: "sv1", versionNumber: 1 });
    const v2 = scheduleVersion({ id: "sv2", versionNumber: 2 });
    const inst_v1 = installment({ id: "i1", scheduleVersionId: "sv1", installmentNumber: 1 });
    const inst_v2 = installment({ id: "i2", scheduleVersionId: "sv2", installmentNumber: 2 });
    const items = build([debt()], [], [v1, v2], [inst_v1, inst_v2], []);
    expect(items).toHaveLength(1);
    expect(items[0].installmentId).toBe("i2");
    expect(items[0].scheduleVersionId).toBe("sv2");
  });

  it("12. historical schedule version installments are excluded", () => {
    const v1 = scheduleVersion({ id: "sv1", versionNumber: 1 });
    const v2 = scheduleVersion({ id: "sv2", versionNumber: 2 });
    const inst_v1 = installment({ id: "i_old", scheduleVersionId: "sv1" });
    const items = build([debt()], [], [v1, v2], [inst_v1], []);
    // sv2 is current but has no installments; sv1 has installments but is historical
    expect(items).toHaveLength(0);
  });

  it("hides the last known schedule while a bank schedule is pending", () => {
    const pendingEvent = debtEvent({
      id: "e_pending",
      eventType: "principal_prepayment",
      eventDate: "2026-08-20",
      prepaymentEffect: "pending_bank_schedule",
      createdAt: "2026-08-20T00:00:00Z",
    });
    const items = build([debt()], [pendingEvent], [scheduleVersion()], [installment()], []);
    expect(items).toHaveLength(0);
  });

  it("hides V1 after a payment plus extra principal enters pending state", () => {
    const pendingPayment = debtEvent({
      id: "e_pending_payment",
      eventType: "payment",
      eventDate: "2026-08-20",
      extraPrincipalAmount: 100,
      prepaymentEffect: "pending_bank_schedule",
      createdAt: "2026-08-20T00:00:00Z",
    });
    const items = build([debt()], [pendingPayment], [scheduleVersion()], [installment()], []);
    expect(items).toHaveLength(0);
  });

  it("hides V1 after a standalone prepayment enters pending state", () => {
    const pendingPrepayment = debtEvent({
      id: "e_pending_prepayment",
      eventType: "principal_prepayment",
      eventDate: "2026-08-20",
      prepaymentEffect: "pending_bank_schedule",
      createdAt: "2026-08-20T00:00:00Z",
    });
    const items = build([debt()], [pendingPrepayment], [scheduleVersion()], [installment()], []);
    expect(items).toHaveLength(0);
  });

  it("uses the official schedule after a pending state is updated", () => {
    const v1 = scheduleVersion({ id: "sv1", versionNumber: 1 });
    const v2 = scheduleVersion({
      id: "sv2",
      versionNumber: 2,
      triggerEventId: "e_schedule_update",
      reason: "manual_adjustment",
    });
    const pendingPrepayment = debtEvent({
      id: "e_pending_prepayment",
      eventType: "principal_prepayment",
      eventDate: "2026-08-20",
      prepaymentEffect: "pending_bank_schedule",
      createdAt: "2026-08-20T00:00:00Z",
    });
    const scheduleUpdate = debtEvent({
      id: "e_schedule_update",
      eventType: "principal_adjustment",
      eventDate: "2026-08-21",
      cashAmount: 0,
      principalDelta: 0,
      movementId: null,
      description: "Cronograma oficial posterior al prepago",
      createdAt: "2026-08-21T00:00:00Z",
    });
    const nextInstallment = installment({
      id: "i2",
      scheduleVersionId: "sv2",
      dueDate: "2026-10-01",
      expectedAmount: 850,
      expectedPrincipal: 700,
      expectedInterest: 100,
      expectedFees: 20,
      expectedInsurance: 30,
    });

    const items = build(
      [debt()],
      [pendingPrepayment, scheduleUpdate],
      [v1, v2],
      [installment(), nextInstallment],
      []
    );

    expect(items).toHaveLength(1);
    expect(items[0].installmentId).toBe("i2");
    expect(items[0].scheduleVersionId).toBe("sv2");
    expect(items[0].pendingBankSchedule).toBe(false);
  });
});

describe("getBankPrepaymentScheduleTarget", () => {
  it("targets the estimated schedule trigger instead of guessing by date", () => {
    const event = debtEvent({
      id: "e_prepayment",
      eventType: "principal_prepayment",
      eventDate: "2026-08-20",
      prepaymentEffect: "reduce_term",
      createdAt: "2026-08-20T00:00:00Z",
    });
    const version = scheduleVersion({
      id: "sv_estimated",
      scheduleSource: "estimated",
      reason: "prepayment",
      triggerEventId: event.id,
    });

    expect(getBankPrepaymentScheduleTarget({ debtId: "d1", debtEvents: [event], scheduleVersions: [version] })).toEqual({
      eventId: event.id,
      source: "estimated",
    });
  });

  it("targets the latest pending prepayment when no newer schedule exists", () => {
    const first = debtEvent({
      id: "e_first",
      eventType: "principal_prepayment",
      eventDate: "2026-08-20",
      prepaymentEffect: "pending_bank_schedule",
      createdAt: "2026-08-20T00:00:00Z",
    });
    const second = debtEvent({
      id: "e_second",
      eventType: "payment",
      eventDate: "2026-08-21",
      extraPrincipalAmount: 100,
      prepaymentEffect: "pending_bank_schedule",
      createdAt: "2026-08-21T00:00:00Z",
    });

    expect(getBankPrepaymentScheduleTarget({ debtId: "d1", debtEvents: [first, second], scheduleVersions: [scheduleVersion()] })).toEqual({
      eventId: second.id,
      source: "pending",
    });
  });
});

// ---------------------------------------------------------------------------
// Tests 13-15: Debt eligibility filtering
// ---------------------------------------------------------------------------

describe("buildDebtPlanningItems — debt eligibility", () => {
  const sv = scheduleVersion();
  const inst = installment();

  it("13. archived debt is excluded", () => {
    const d = debt({ isArchived: true });
    expect(build([d], [], [sv], [inst], [])).toHaveLength(0);
  });

  it("14. paid_off debt is excluded", () => {
    const d = debt({ status: "paid_off" });
    expect(build([d], [], [sv], [inst], [])).toHaveLength(0);
  });

  it("15. refinanced debt is excluded", () => {
    const d = debt({ status: "refinanced" });
    expect(build([d], [], [sv], [inst], [])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests 16-17: Allocation semantics
// ---------------------------------------------------------------------------

describe("buildDebtPlanningItems — allocation semantics", () => {
  it("16. reversed payment allocation is NOT counted", () => {
    const sv = scheduleVersion();
    const paymentEvent = debtEvent({ id: "e1", eventType: "payment" });
    const reversalEvent = debtEvent({ id: "e2", eventType: "reversal", reversalOfEventId: "e1", cashAmount: 0, principalDelta: 0, interestPaid: 0 });
    const alloc = allocation({ eventId: "e1", allocatedAmount: 900 });
    const inst = installment({ expectedAmount: 900 });
    const items = build([debt()], [paymentEvent, reversalEvent], [sv], [inst], [alloc]);
    expect(items).toHaveLength(1);
    expect(items[0].allocatedAmount).toBe(0);
    expect(items[0].isCovered).toBe(false);
    expect(items[0].remainingAmount).toBe(900);
  });

  it("17. effective allocation is correctly counted", () => {
    const sv = scheduleVersion();
    const paymentEvent = debtEvent({ id: "e1", eventType: "payment" });
    const alloc = allocation({ eventId: "e1", allocatedAmount: 500 });
    const inst = installment({ expectedAmount: 900 });
    const items = build([debt()], [paymentEvent], [sv], [inst], [alloc]);
    expect(items).toHaveLength(1);
    expect(items[0].allocatedAmount).toBe(500);
    expect(items[0].remainingAmount).toBe(400);
    expect(items[0].isCovered).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests 18-23: Amount semantics
// ---------------------------------------------------------------------------

describe("buildDebtPlanningItems — amount semantics", () => {
  it("18. expectedAmount known, partial allocation: remaining is correct", () => {
    const sv = scheduleVersion();
    const ev = debtEvent({ id: "e1", eventType: "payment" });
    const alloc = allocation({ eventId: "e1", allocatedAmount: 300 });
    const inst = installment({ expectedAmount: 900 });
    const items = build([debt()], [ev], [sv], [inst], [alloc]);
    expect(items[0].amountKnown).toBe(true);
    expect(items[0].remainingAmount).toBe(600);
    expect(items[0].isCovered).toBe(false);
  });

  it("19. expectedAmount known, fully allocated: isCovered=true", () => {
    const sv = scheduleVersion();
    const ev = debtEvent({ id: "e1", eventType: "payment" });
    const alloc = allocation({ eventId: "e1", allocatedAmount: 900 });
    const inst = installment({ expectedAmount: 900 });
    const items = build([debt()], [ev], [sv], [inst], [alloc]);
    expect(items[0].isCovered).toBe(true);
    expect(items[0].remainingAmount).toBe(0);
  });

  it("20. covered installment with past dueDate → dueStatus='covered', not overdue", () => {
    const sv = scheduleVersion();
    const ev = debtEvent({ id: "e1", eventType: "payment" });
    const alloc = allocation({ eventId: "e1", allocatedAmount: 900 });
    const inst = installment({ dueDate: "2026-08-01", expectedAmount: 900 });
    const items = build([debt()], [ev], [sv], [inst], [alloc], "2026-08-21");
    expect(items[0].isCovered).toBe(true);
    expect(items[0].dueStatus).toBe("covered");
    expect(items[0].dueLabel).toBe("Cubierta");
    expect(items[0].dueTone).toBe("green");
  });

  it("21. expectedAmount=null → amountKnown=false, remainingAmount=null", () => {
    const sv = scheduleVersion();
    const inst = installment({ expectedAmount: null });
    const items = build([debt()], [], [sv], [inst], []);
    expect(items[0].amountKnown).toBe(false);
    expect(items[0].remainingAmount).toBeNull();
  });

  it("22. expectedAmount=null + positive allocation → NOT covered", () => {
    const sv = scheduleVersion();
    const ev = debtEvent({ id: "e1", eventType: "payment" });
    const alloc = allocation({ eventId: "e1", allocatedAmount: 200 });
    const inst = installment({ expectedAmount: null });
    const items = build([debt()], [ev], [sv], [inst], [alloc]);
    expect(items[0].amountKnown).toBe(false);
    expect(items[0].isCovered).toBe(false);
    expect(items[0].allocatedAmount).toBe(200);
    expect(items[0].remainingAmount).toBeNull();
  });

  it("23. expectedAmount=null with past dueDate → dueStatus='overdue'", () => {
    const sv = scheduleVersion();
    const inst = installment({ dueDate: "2026-08-01", expectedAmount: null });
    const items = build([debt()], [], [sv], [inst], [], "2026-08-21");
    expect(items[0].amountKnown).toBe(false);
    expect(items[0].dueStatus).toBe("overdue");
    expect(items[0].isCovered).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 24: Stable sort
// ---------------------------------------------------------------------------

describe("buildDebtPlanningItems — stable sort", () => {
  it("24. items are sorted by dueDate asc, then debtName, then installmentNumber", () => {
    const sv1 = scheduleVersion({ id: "sv1", debtId: "d1" });
    const sv2 = scheduleVersion({ id: "sv2", debtId: "d2" });
    const d1 = debt({ id: "d1", name: "Zebra Bank" });
    const d2 = debt({ id: "d2", name: "Alpha Bank" });
    const i1 = installment({ id: "i1", debtId: "d1", scheduleVersionId: "sv1", dueDate: "2026-09-15", installmentNumber: 1 });
    const i2 = installment({ id: "i2", debtId: "d2", scheduleVersionId: "sv2", dueDate: "2026-09-01", installmentNumber: 1 });
    const i3 = installment({ id: "i3", debtId: "d1", scheduleVersionId: "sv1", dueDate: "2026-09-15", installmentNumber: 2 });
    const items = build([d1, d2], [], [sv1, sv2], [i1, i2, i3], []);
    expect(items.map((item) => item.installmentId)).toEqual(["i2", "i1", "i3"]);
  });
});

// ---------------------------------------------------------------------------
// Tests 25-28: Monthly metrics
// ---------------------------------------------------------------------------

describe("summarizeDebtPlanningMonth", () => {
  it("25. correct totals for known-amount installments in month", () => {
    const sv = scheduleVersion();
    const ev = debtEvent({ id: "e1", eventType: "payment" });
    const alloc = allocation({ eventId: "e1", allocatedAmount: 300 });
    const inst1 = installment({ id: "i1", dueDate: "2026-08-15", expectedAmount: 900 });
    const inst2 = installment({ id: "i2", scheduleVersionId: "sv1", debtId: "d1", dueDate: "2026-08-20", expectedAmount: 500, installmentNumber: 2 });
    const alloc2 = allocation({ id: "a2", installmentId: "i2", allocatedAmount: 0, eventId: "e1" });
    const items = build([debt()], [ev], [sv], [inst1, inst2], [alloc, alloc2], "2026-08-21");
    const summary = summarizeDebtPlanningMonth(items, "2026-08");
    expect(summary.totalInstallments).toBe(2);
    expect(summary.knownAmountInstallments).toBe(2);
    expect(summary.unknownAmountInstallments).toBe(0);
    expect(summary.scheduledKnownAmount).toBe(1400); // 900+500
    expect(summary.pendingKnownAmount).toBe(1100); // 600+500
  });

  it("26. unknown-amount installments counted separately, not as zero", () => {
    const sv = scheduleVersion();
    const inst = installment({ dueDate: "2026-08-10", expectedAmount: null });
    const items = build([debt()], [], [sv], [inst], [], "2026-08-21");
    const summary = summarizeDebtPlanningMonth(items, "2026-08");
    expect(summary.totalInstallments).toBe(1);
    expect(summary.unknownAmountInstallments).toBe(1);
    expect(summary.knownAmountInstallments).toBe(0);
    expect(summary.scheduledKnownAmount).toBe(0);
  });

  it("27. unknown installments do NOT inflate pendingKnownAmount/scheduledKnownAmount", () => {
    const sv = scheduleVersion();
    const instKnown = installment({ id: "i1", dueDate: "2026-08-10", expectedAmount: 900 });
    const instUnknown = installment({ id: "i2", dueDate: "2026-08-15", expectedAmount: null, installmentNumber: 2 });
    const items = build([debt()], [], [sv], [instKnown, instUnknown], [], "2026-08-21");
    const summary = summarizeDebtPlanningMonth(items, "2026-08");
    expect(summary.scheduledKnownAmount).toBe(900); // only instKnown
    expect(summary.pendingKnownAmount).toBe(900);   // only instKnown remaining
  });

  it("28. overdueKnownAmount sums only overdue known-amount installments", () => {
    const sv = scheduleVersion();
    const instOverdueKnown = installment({ id: "i1", dueDate: "2026-08-01", expectedAmount: 900 });
    const instFutureKnown = installment({ id: "i2", dueDate: "2026-08-25", expectedAmount: 500, installmentNumber: 2 });
    const instOverdueUnknown = installment({ id: "i3", dueDate: "2026-08-05", expectedAmount: null, installmentNumber: 3 });
    const items = build([debt()], [], [sv], [instOverdueKnown, instFutureKnown, instOverdueUnknown], [], "2026-08-21");
    const summary = summarizeDebtPlanningMonth(items, "2026-08");
    expect(summary.overdueKnownAmount).toBe(900); // only i1
    expect(summary.overdueInstallments).toBe(2);   // i1 + i3 (both overdue)
  });
});

// ---------------------------------------------------------------------------
// Tests 29-30: Alert summary
// ---------------------------------------------------------------------------

describe("summarizeDebtPlanningAlerts", () => {
  it("29. alert summary excludes covered installments", () => {
    const sv = scheduleVersion();
    const ev = debtEvent({ id: "e1", eventType: "payment" });
    const alloc = allocation({ eventId: "e1", allocatedAmount: 900 });
    // Past due but covered — must NOT appear in alerts
    const instCovered = installment({ id: "i1", dueDate: "2026-08-01", expectedAmount: 900 });
    const items = build([debt()], [ev], [sv], [instCovered], [alloc], "2026-08-21");
    expect(items[0].dueStatus).toBe("covered");
    const alerts = summarizeDebtPlanningAlerts(items);
    expect(alerts.total).toBe(0);
    expect(alerts.overdue).toBe(0);
  });

  it("30. alert summary correctly counts overdue/today/tomorrow/upcoming (not covered/later)", () => {
    const sv = scheduleVersion();
    const sv2 = scheduleVersion({ id: "sv2", debtId: "d2" });
    const sv3 = scheduleVersion({ id: "sv3", debtId: "d3" });
    const sv4 = scheduleVersion({ id: "sv4", debtId: "d4" });
    const sv5 = scheduleVersion({ id: "sv5", debtId: "d5" });
    const sv6 = scheduleVersion({ id: "sv6", debtId: "d6" });

    const d2 = debt({ id: "d2", name: "D2" });
    const d3 = debt({ id: "d3", name: "D3" });
    const d4 = debt({ id: "d4", name: "D4" });
    const d5 = debt({ id: "d5", name: "D5" });
    const d6 = debt({ id: "d6", name: "D6" });

    // overdue (past, not covered)
    const iOverdue = installment({ id: "iod", dueDate: "2026-08-01", expectedAmount: 900 });
    // today
    const iToday = installment({ id: "itd", debtId: "d2", scheduleVersionId: "sv2", dueDate: "2026-08-21", expectedAmount: 900 });
    // tomorrow
    const iTomorrow = installment({ id: "itm", debtId: "d3", scheduleVersionId: "sv3", dueDate: "2026-08-22", expectedAmount: 900 });
    // upcoming (5 days)
    const iUpcoming = installment({ id: "iup", debtId: "d4", scheduleVersionId: "sv4", dueDate: "2026-08-26", expectedAmount: 900 });
    // later — should NOT count
    const iLater = installment({ id: "ila", debtId: "d5", scheduleVersionId: "sv5", dueDate: "2026-09-30", expectedAmount: 900 });
    // covered — should NOT count
    const iCovered = installment({ id: "ico", debtId: "d6", scheduleVersionId: "sv6", dueDate: "2026-08-01", expectedAmount: 900 });
    const evCovered = debtEvent({ id: "ec", debtId: "d6", eventType: "payment" });
    const allocCovered = allocation({ id: "ac", eventId: "ec", installmentId: "ico", debtId: "d6", allocatedAmount: 900 });

    const items = build(
      [debt(), d2, d3, d4, d5, d6],
      [evCovered],
      [sv, sv2, sv3, sv4, sv5, sv6],
      [iOverdue, iToday, iTomorrow, iUpcoming, iLater, iCovered],
      [allocCovered],
      "2026-08-21"
    );

    const alerts = summarizeDebtPlanningAlerts(items);
    expect(alerts.overdue).toBe(1);
    expect(alerts.today).toBe(1);
    expect(alerts.tomorrow).toBe(1);
    expect(alerts.upcoming).toBe(1);
    expect(alerts.total).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Tests 8-10: RecurringPayment regression (uses calculations.ts which now
// delegates to dueDates.ts — we import paymentStatus to verify behavior)
// ---------------------------------------------------------------------------

describe("paymentStatus — regression after wiring to dueDates SSOT", () => {
  afterEach(() => vi.useRealTimers());

  function setToday(iso: string) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  }

  function basePayment(overrides: Partial<Parameters<typeof paymentStatus>[0]> = {}) {
    return {
      id: "p1",
      name: "Test",
      amount: 100,
      amount_mode: "fixed" as const,
      dueDay: 20 as number | null,
      dueDate: null as string | null,
      category: "Otros",
      status: "pendiente" as const,
      notes: "",
      recurrence_type: "indefinite" as const,
      total_installments: null as number | null,
      paid_installments: 0,
      is_active: true,
      last_paid_month: null as number | null,
      last_paid_year: null as number | null,
      ...overrides,
    };
  }


  it("8. paymentStatus still produces overdue/today/tomorrow/upcoming/later correctly", () => {
    setToday("2026-08-21T12:00:00Z");
    expect(paymentStatus(basePayment({ dueDay: 10 })).kind).toBe("overdue");
    expect(paymentStatus(basePayment({ dueDay: 21 })).kind).toBe("today");
    expect(paymentStatus(basePayment({ dueDay: 22 })).kind).toBe("tomorrow");
    expect(paymentStatus(basePayment({ dueDay: 25 })).kind).toBe("upcoming");
    expect(paymentStatus(basePayment({ dueDay: 31 })).kind).toBe("later");
  });

  it("9. paymentAlert only alerts for overdue/today/tomorrow", () => {
    setToday("2026-08-21T12:00:00Z");
    expect(paymentAlert(basePayment({ dueDay: 10 }))).not.toBeNull();
    expect(paymentAlert(basePayment({ dueDay: 21 }))).not.toBeNull();
    expect(paymentAlert(basePayment({ dueDay: 22 }))).not.toBeNull();
    expect(paymentAlert(basePayment({ dueDay: 25 }))).toBeNull(); // upcoming → no alert
    expect(paymentAlert(basePayment({ dueDay: 31 }))).toBeNull(); // later → no alert
  });

  it("10. paid/completed/inactive maintain priority over date", () => {
    setToday("2026-08-21T12:00:00Z");
    // paid this month
    expect(paymentStatus(basePayment({ dueDay: 10, last_paid_month: 8, last_paid_year: 2026 })).kind).toBe("paid");
    // completed (fixed all paid)
    expect(paymentStatus(basePayment({ recurrence_type: "fixed", total_installments: 3, paid_installments: 3 })).kind).toBe("completed");
    // inactive
    expect(paymentStatus(basePayment({ is_active: false })).kind).toBe("inactive");
    // one_time pagado
    expect(paymentStatus(basePayment({ recurrence_type: "one_time", dueDate: "2026-08-10", status: "pagado" })).kind).toBe("completed");
  });
});
