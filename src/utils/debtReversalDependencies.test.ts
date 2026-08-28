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

  it("unwinds nested schedule lineage after P2 is reversed, preserving V1..V5 history", () => {
    const p2 = event({ id: "prepayment-2", eventDate: "2026-08-21", createdAt: "2026-08-21T10:00:00Z" });
    const p2Reversal = event({
      id: "reversal-p2",
      eventType: "reversal",
      eventDate: "2026-08-23",
      createdAt: "2026-08-23T10:00:00Z",
      reversalOfEventId: p2.id,
    });
    const p1Schedule = targetSchedule;
    const p2Schedule = schedule({ id: "schedule-p2", versionNumber: 3, triggerEventId: p2.id });
    const p2RestoredSchedule = schedule({ id: "schedule-p2-reversal", versionNumber: 4, triggerEventId: p2Reversal.id, reason: "reversal" });

    const blockedBeforeP2Reversal = getDebtReversalDependencyState({
      targetEvent: target,
      events: [target, p2],
      scheduleVersions: [schedule(), p1Schedule, p2Schedule],
    });
    expect(blockedBeforeP2Reversal.hasDependencies).toBe(true);

    const readyAfterP2Reversal = getDebtReversalDependencyState({
      targetEvent: target,
      events: [target, p2, p2Reversal],
      scheduleVersions: [schedule(), p1Schedule, p2Schedule, p2RestoredSchedule],
    });
    expect(readyAfterP2Reversal.hasDependencies).toBe(false);
    expect(readyAfterP2Reversal.laterScheduleVersion).toBeNull();
  });

  it("keeps a later manual/rate schedule as a dependency while its trigger is effective", () => {
    const manualEvent = event({ id: "manual-rate", eventType: "principal_adjustment", eventDate: "2026-08-21", createdAt: "2026-08-21T10:00:00Z" });
    const laterSchedule = schedule({ id: "schedule-rate", versionNumber: 3, triggerEventId: manualEvent.id, reason: "rate_change" });
    const state = getDebtReversalDependencyState({
      targetEvent: target,
      events: [target, manualEvent],
      scheduleVersions: [schedule(), targetSchedule, laterSchedule],
    });
    expect(state.hasDependencies).toBe(true);
    expect(state.laterScheduleVersion?.id).toBe(laterSchedule.id);
  });

  it("releases a later manual/rate schedule when its lifecycle trigger is reverted", () => {
    const manualEvent = event({ id: "manual-rate", eventType: "principal_adjustment", eventDate: "2026-08-21", createdAt: "2026-08-21T10:00:00Z" });
    const manualReversal = event({
      id: "reversal-manual-rate",
      eventType: "reversal",
      eventDate: "2026-08-22",
      createdAt: "2026-08-22T10:00:00Z",
      reversalOfEventId: manualEvent.id,
    });
    const laterSchedule = schedule({ id: "schedule-rate", versionNumber: 3, triggerEventId: manualEvent.id, reason: "rate_change" });
    const state = getDebtReversalDependencyState({
      targetEvent: target,
      events: [target, manualEvent, manualReversal],
      scheduleVersions: [schedule(), targetSchedule, laterSchedule],
    });
    expect(state.hasDependencies).toBe(false);
    expect(state.laterScheduleVersion).toBeNull();
  });

  it("releases estimated/official nested P2 versions once P2 is reverted", () => {
    const p2 = event({ id: "prepayment-2", eventDate: "2026-08-21", createdAt: "2026-08-21T10:00:00Z" });
    const p2Reversal = event({ id: "reversal-p2", eventType: "reversal", eventDate: "2026-08-23", createdAt: "2026-08-23T10:00:00Z", reversalOfEventId: p2.id });
    const p2Estimated = schedule({ id: "schedule-p2-estimated", versionNumber: 3, triggerEventId: p2.id, scheduleSource: "estimated", isAuthoritative: false });
    const p2Official = schedule({ id: "schedule-p2-official", versionNumber: 4, triggerEventId: p2.id, scheduleSource: "contractual", isAuthoritative: true });
    const p2Restored = schedule({ id: "schedule-p2-restored", versionNumber: 5, triggerEventId: p2Reversal.id, reason: "reversal" });
    const state = getDebtReversalDependencyState({
      targetEvent: target,
      events: [target, p2, p2Reversal],
      scheduleVersions: [schedule(), targetSchedule, p2Estimated, p2Official, p2Restored],
    });
    expect(state.hasDependencies).toBe(false);
  });
});
