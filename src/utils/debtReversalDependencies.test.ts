import { describe, expect, it } from "vitest";
import type { DebtEvent, DebtScheduleVersion } from "../types.js";
import { getDebtReversalDependencyState } from "./debtReversalDependencies.js";

function event(overrides: Partial<DebtEvent> = {}): DebtEvent {
  return {
    id: "target",
    debtId: "debt-1",
    eventDate: "2026-08-20",
    eventType: "principal_prepayment",
    cashAmount: 100,
    principalDelta: -100,
    interestPaid: 0,
    feesPaid: 0,
    insurancePaid: 0,
    otherCostPaid: 0,
    breakdownComplete: true,
    movementId: "movement-target",
    reversalOfEventId: null,
    description: "",
    registeredByUserId: "user-1",
    createdAt: "2026-08-20T10:00:00Z",
    ...overrides,
  };
}

function schedule(overrides: Partial<DebtScheduleVersion> = {}): DebtScheduleVersion {
  return {
    id: "schedule-1",
    debtId: "debt-1",
    versionNumber: 1,
    effectiveDate: "2026-01-01",
    reason: "initial",
    scheduleSource: "contractual",
    isAuthoritative: true,
    triggerEventId: null,
    notes: "",
    createdByUserId: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const target = event();
const targetSchedule = schedule({ id: "schedule-target", versionNumber: 2, triggerEventId: target.id });

describe("getDebtReversalDependencyState", () => {
  it("does not guard a target without a generated schedule", () => {
    const laterPayment = event({ id: "payment-later", eventType: "payment", eventDate: "2026-08-21", createdAt: "2026-08-21T10:00:00Z" });
    const state = getDebtReversalDependencyState({ targetEvent: target, events: [target, laterPayment], scheduleVersions: [schedule()] });
    expect(state).toEqual({ targetHasSchedule: false, laterEffectiveEvent: null, laterScheduleVersion: null, hasDependencies: false });
  });

  it("detects a later effective payment in event order", () => {
    const laterPayment = event({ id: "payment-later", eventType: "payment", eventDate: "2026-08-21", createdAt: "2026-08-21T10:00:00Z" });
    const state = getDebtReversalDependencyState({ targetEvent: target, events: [laterPayment, target], scheduleVersions: [schedule(), targetSchedule] });
    expect(state.hasDependencies).toBe(true);
    expect(state.laterEffectiveEvent?.id).toBe(laterPayment.id);
  });

  it("ignores a later financial event that was already reversed", () => {
    const laterPayment = event({ id: "payment-later", eventType: "payment", eventDate: "2026-08-21", createdAt: "2026-08-21T10:00:00Z" });
    const laterReversal = event({ id: "reversal-later", eventType: "reversal", eventDate: "2026-08-22", createdAt: "2026-08-22T10:00:00Z", reversalOfEventId: laterPayment.id });
    const state = getDebtReversalDependencyState({ targetEvent: target, events: [target, laterPayment, laterReversal], scheduleVersions: [schedule(), targetSchedule] });
    expect(state.hasDependencies).toBe(false);
    expect(state.laterEffectiveEvent).toBeNull();
  });

  it("does not treat same-target estimated and official versions as dependencies", () => {
    const official = schedule({ id: "schedule-target-official", versionNumber: 3, triggerEventId: target.id });
    const state = getDebtReversalDependencyState({ targetEvent: target, events: [target], scheduleVersions: [schedule(), targetSchedule, official] });
    expect(state.hasDependencies).toBe(false);
    expect(state.laterScheduleVersion).toBeNull();
  });

  it("detects a later schedule with a different trigger", () => {
    const laterSchedule = schedule({ id: "schedule-later", versionNumber: 3, triggerEventId: "other-event", reason: "manual_adjustment" });
    const state = getDebtReversalDependencyState({ targetEvent: target, events: [target], scheduleVersions: [schedule(), targetSchedule, laterSchedule] });
    expect(state.hasDependencies).toBe(true);
    expect(state.laterScheduleVersion?.id).toBe(laterSchedule.id);
  });

  it("uses created_at and id to order same-day events deterministically", () => {
    const sameDayLater = event({ id: "payment-later", eventType: "payment", createdAt: "2026-08-20T10:00:01Z" });
    const state = getDebtReversalDependencyState({ targetEvent: target, events: [target, sameDayLater], scheduleVersions: [schedule(), targetSchedule] });
    expect(state.laterEffectiveEvent?.id).toBe(sameDayLater.id);
  });
});
