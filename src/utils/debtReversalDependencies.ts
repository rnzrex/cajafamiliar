import type { DebtEvent, DebtEventType, DebtScheduleVersion } from "../types.js";
import { effectiveDebtEvents } from "./debtCalculations.js";

const DEPENDENT_EVENT_TYPES = new Set<DebtEventType>([
  "payment",
  "principal_prepayment",
  "payoff",
  "installment_advance",
]);

export interface DebtReversalDependencyState {
  targetHasSchedule: boolean;
  laterEffectiveEvent: DebtEvent | null;
  laterScheduleVersion: DebtScheduleVersion | null;
  hasDependencies: boolean;
}

function compareDebtEventOrder(left: DebtEvent, right: DebtEvent): number {
  return left.eventDate.localeCompare(right.eventDate)
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id);
}

/**
 * Computes the client-side LIFO hint for reversing a schedule-generating
 * event. The server remains authoritative; this helper only prevents a
 * predictable blocked action from being offered in the history UI.
 */
export function getDebtReversalDependencyState({
  targetEvent,
  events,
  scheduleVersions,
}: {
  targetEvent: DebtEvent;
  events: DebtEvent[];
  scheduleVersions: DebtScheduleVersion[];
}): DebtReversalDependencyState {
  const targetVersions = scheduleVersions.filter((version) =>
    version.debtId === targetEvent.debtId && version.triggerEventId === targetEvent.id
  );
  const targetHasSchedule = targetVersions.length > 0;

  if (!targetHasSchedule) {
    return {
      targetHasSchedule: false,
      laterEffectiveEvent: null,
      laterScheduleVersion: null,
      hasDependencies: false,
    };
  }

  const laterEffectiveEvent = effectiveDebtEvents(events, targetEvent.debtId)
    .filter((event) => DEPENDENT_EVENT_TYPES.has(event.eventType))
    .filter((event) => compareDebtEventOrder(event, targetEvent) > 0)
    .sort(compareDebtEventOrder)[0] ?? null;

  const latestTargetVersion = targetVersions.reduce((latest, version) =>
    version.versionNumber > latest.versionNumber ? version : latest
  );
  const laterScheduleVersion = scheduleVersions
    .filter((version) =>
      version.debtId === targetEvent.debtId
      && version.versionNumber > latestTargetVersion.versionNumber
      && version.triggerEventId !== targetEvent.id
    )
    .sort((left, right) => left.versionNumber - right.versionNumber)[0] ?? null;

  return {
    targetHasSchedule: true,
    laterEffectiveEvent,
    laterScheduleVersion,
    hasDependencies: laterEffectiveEvent !== null || laterScheduleVersion !== null,
  };
}
