import { describe, expect, it } from "vitest";
import type { Debt, DebtEvent, DebtEventInstallmentAllocation, DebtInstallmentCarriedAllocation, DebtScheduleVersion } from "../types";
import { allocatedAmountForInstallment, currentDebtPrincipal, currentDebtScheduleVersion, effectiveDebtEvents, effectiveInstallmentAllocations, hasLaterEffectiveDebtFundEvent, totalAllocatedAmountForInstallment } from "./debtCalculations";

function debt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: "d1",
    name: "Préstamo BCP",
    creditorName: "BCP",
    debtKind: "bank_loan",
    currencyCode: "PEN",
    originDate: null,
    trackingStartDate: "2026-08-01",
    originalPrincipal: 10000,
    openingPrincipalBalance: 10000,
    plannedInstallmentCount: null,
    plannedInstallmentAmount: null,
    installmentAmountMode: "fixed",
    paymentFrequency: "monthly",
    customFrequencyDays: null,
    firstDueDate: null,
    teaPercent: null,
    tceaPercent: null,
    notes: "",
    status: "active",
    isArchived: false,
    createdByUserId: "u1",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function event(overrides: Partial<DebtEvent>): DebtEvent {
  return {
    id: "e1",
    debtId: "d1",
    eventDate: "2026-08-10",
    eventType: "payment",
    cashAmount: 0,
    principalDelta: 0,
    interestPaid: 0,
    feesPaid: 0,
    insurancePaid: 0,
    otherCostPaid: 0,
    breakdownComplete: true,
    movementId: null,
    reversalOfEventId: null,
    description: "",
    registeredByUserId: "u1",
    createdAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function allocation(overrides: Partial<DebtEventInstallmentAllocation>): DebtEventInstallmentAllocation {
  return {
    id: "a1",
    eventId: "e1",
    installmentId: "i1",
    debtId: "d1",
    allocatedAmount: 800,
    createdByUserId: "u1",
    createdAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function version(overrides: Partial<DebtScheduleVersion>): DebtScheduleVersion {
  return {
    id: "v1",
    debtId: "d1",
    versionNumber: 1,
    effectiveDate: "2026-08-01",
    reason: "initial",
    triggerEventId: null,
    notes: "",
    createdByUserId: "u1",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("effectiveDebtEvents", () => {
  it("payment normal cuenta, reversal no, evento revertido tampoco", () => {
    const payment = event({ id: "e1", eventType: "payment", principalDelta: -800 });
    const target = event({ id: "e2", eventType: "principal_prepayment", principalDelta: -2000 });
    const reversal = event({ id: "e3", eventType: "reversal", reversalOfEventId: "e2" });
    const effective = effectiveDebtEvents([payment, target, reversal]);
    expect(effective.map((entry) => entry.id)).toEqual(["e1"]);
  });

  it("no muta los arreglos originales", () => {
    const payment = event({ id: "e1", eventType: "payment", principalDelta: -800 });
    const original = [payment];
    effectiveDebtEvents(original);
    expect(original).toHaveLength(1);
  });
});

describe("currentDebtPrincipal", () => {
  it("baseline 10000 con payment -600 y prepayment -2000 da 7400", () => {
    const d = debt();
    const events = [
      event({ id: "e1", eventType: "payment", principalDelta: -600 }),
      event({ id: "e2", eventType: "principal_prepayment", principalDelta: -2000 }),
    ];
    expect(currentDebtPrincipal(d, events)).toBe(7400);
  });

  it("principal_adjustment positivo aumenta la deuda", () => {
    const d = debt();
    const events = [event({ id: "e1", eventType: "principal_adjustment", principalDelta: 500 })];
    expect(currentDebtPrincipal(d, events)).toBe(10500);
  });

  it("un reversal elimina el efecto del evento objetivo del cálculo", () => {
    const d = debt();
    const payment = event({ id: "e1", eventType: "payment", principalDelta: -600 });
    const reversal = event({ id: "e2", eventType: "reversal", reversalOfEventId: "e1" });
    expect(currentDebtPrincipal(d, [payment, reversal])).toBe(10000);
  });

  it("no toma eventos de otra deuda", () => {
    const d = debt();
    const otherPayment = event({ id: "e9", debtId: "d2", eventType: "payment", principalDelta: -500 });
    expect(currentDebtPrincipal(d, [otherPayment])).toBe(10000);
  });
});

describe("currentDebtScheduleVersion", () => {
  it("elige la mayor version_number, no la más reciente por fecha", () => {
    const v1 = version({ id: "v1", versionNumber: 1, effectiveDate: "2026-08-01" });
    const v2 = version({ id: "v2", versionNumber: 2, effectiveDate: "2026-08-15" });
    const v3 = version({ id: "v3", versionNumber: 3, effectiveDate: "2026-08-10" });
    expect(currentDebtScheduleVersion("d1", [v1, v2, v3])).toBe(v3);
  });

  it("ignora versiones de otro debt", () => {
    const v1 = version({ id: "v1", versionNumber: 1 });
    const other = version({ id: "vx", debtId: "d2", versionNumber: 9 });
    expect(currentDebtScheduleVersion("d1", [v1, other])).toBe(v1);
  });

  it("devuelve null cuando no existe versión", () => {
    expect(currentDebtScheduleVersion("d1", [])).toBeNull();
  });
});

describe("effectiveInstallmentAllocations", () => {
  it("allocation de un payment efectivo cuenta", () => {
    const payment = event({ id: "e1", eventType: "payment", principalDelta: -800 });
    const alloc = allocation({ id: "a1", eventId: "e1", allocatedAmount: 800 });
    expect(effectiveInstallmentAllocations([alloc], [payment]).map((entry) => entry.id)).toEqual(["a1"]);
    expect(allocatedAmountForInstallment("i1", [alloc], [payment])).toBe(800);
  });

  it("allocation cuyo payment fue revertido no cuenta", () => {
    const payment = event({ id: "e1", eventType: "payment", principalDelta: -800 });
    const reversal = event({ id: "e2", eventType: "reversal", reversalOfEventId: "e1" });
    const alloc = allocation({ id: "a1", eventId: "e1", allocatedAmount: 800 });
    expect(effectiveInstallmentAllocations([alloc], [payment, reversal])).toEqual([]);
    expect(allocatedAmountForInstallment("i1", [alloc], [payment, reversal])).toBe(0);
  });

  it("allocation de otro debt queda fuera al filtrar por debtId", () => {
    const ownPayment = event({ id: "e1", eventType: "payment", principalDelta: -800 });
    const otherPayment = event({ id: "e2", debtId: "d2", eventType: "payment", principalDelta: -100 });
    const own = allocation({ id: "a1", eventId: "e1", allocatedAmount: 800 });
    const theirs = allocation({ id: "a2", eventId: "e2", debtId: "d2", allocatedAmount: 100 });
    expect(effectiveInstallmentAllocations([own, theirs], [ownPayment, otherPayment], "d1").map((entry) => entry.id)).toEqual(["a1"]);
  });

  it("allocation con eventId de payment efectivo pero debtId distinto no cuenta", () => {
    const payment = event({ id: "e1", eventType: "payment", principalDelta: -800 });
    const crossDebtAllocation = allocation({ id: "a1", eventId: "e1", debtId: "d2", allocatedAmount: 800 });
    expect(effectiveInstallmentAllocations([crossDebtAllocation], [payment])).toEqual([]);
    expect(allocatedAmountForInstallment("i1", [crossDebtAllocation], [payment])).toBe(0);
  });

  it("solo eventos tipo payment permiten allocations efectivas", () => {
    const prepayment = event({ id: "e1", eventType: "principal_prepayment", principalDelta: -2000 });
    const alloc = allocation({ id: "a1", eventId: "e1", allocatedAmount: 500 });
    expect(effectiveInstallmentAllocations([alloc], [prepayment])).toEqual([]);
  });

  it("suma cobertura carried sin duplicar las allocations económicas efectivas", () => {
    const payment = event({ id: "e1", eventType: "payment", principalDelta: -40 });
    const alloc = allocation({ id: "a1", eventId: "e1", installmentId: "i1", allocatedAmount: 60 });
    const carried: DebtInstallmentCarriedAllocation = {
      id: "c1",
      restoredInstallmentId: "i1",
      sourceEventId: "e1",
      sourceAllocationId: "a-carried",
      debtId: "d1",
      householdId: "h1",
      allocatedAmount: 40,
      createdByUserId: "u1",
      createdAt: "",
    };
    expect(totalAllocatedAmountForInstallment({ id: "i1", debtId: "d1" }, [alloc], [payment], [carried])).toBe(100);
    expect(allocatedAmountForInstallment("i1", [alloc], [payment])).toBe(60);
  });

  it("removes carried coverage when the source event is reversed and deduplicates nested lineage", () => {
    const payment = event({ id: "e1", eventType: "payment", principalDelta: -40 });
    const reversal = event({ id: "e2", eventType: "reversal", reversalOfEventId: "e1", cashAmount: 0, principalDelta: 0 });
    const carried: DebtInstallmentCarriedAllocation[] = [
      { id: "c1", restoredInstallmentId: "i1", sourceEventId: "e1", sourceAllocationId: "a0", debtId: "d1", householdId: "h1", allocatedAmount: 40, createdByUserId: "u1", createdAt: "" },
      { id: "c2", restoredInstallmentId: "i1", sourceEventId: "e1", sourceAllocationId: "a0", debtId: "d1", householdId: "h1", allocatedAmount: 40, createdByUserId: "u1", createdAt: "" },
    ];
    expect(totalAllocatedAmountForInstallment({ id: "i1", debtId: "d1" }, [], [payment], carried)).toBe(40);
    expect(totalAllocatedAmountForInstallment({ id: "i1", debtId: "d1" }, [], [payment, reversal], carried)).toBe(0);
  });
});

describe("hasLaterEffectiveDebtFundEvent", () => {
  it("detecta pagos posteriores y deja de considerarlos cuando se revierten", () => {
    const target = event({ id: "p1", eventType: "principal_prepayment", eventDate: "2026-08-20", createdAt: "2026-08-20T00:00:00.000Z" });
    const later = event({ id: "p2", eventType: "payment", eventDate: "2026-08-21", createdAt: "2026-08-21T00:00:00.000Z" });
    const reversal = event({ id: "r2", eventType: "reversal", eventDate: "2026-08-22", reversalOfEventId: later.id });
    expect(hasLaterEffectiveDebtFundEvent(target, [target, later])).toBe(true);
    expect(hasLaterEffectiveDebtFundEvent(target, [target, later, reversal])).toBe(false);
  });
});
