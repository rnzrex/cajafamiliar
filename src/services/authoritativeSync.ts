import type { AppData } from "../types";
import type { AppDataLoadResult } from "./dataRepository";
import type { OfflineCreateMovementOperation } from "./offlineOutbox";

/**
 * Validates whether loaded AppData can be adopted based on browser connectivity state.
 *
 * Rule:
 * - Online + remote: ACCEPT (true)
 * - Online + fallback / local: REJECT (false)
 * - Offline + fallback: ACCEPT (true)
 * - Offline + remote / local: REJECT (false)
 */
export function validateAuthoritativeLoadSource({
  isOnline,
  source,
}: {
  isOnline: boolean;
  source: AppDataLoadResult["source"];
}): boolean {
  if (isOnline) {
    return source === "remote";
  }
  return source === "fallback";
}

/**
 * Determines whether an automatic refresh trigger should execute or be deduplicated.
 *
 * Rules:
 * - If refresh is already in-flight: REJECT (false)
 * - If trigger is automatic and last refresh started less than windowMs ago: REJECT (false)
 * - Manual triggers always bypass the time window deduplication.
 */
export function shouldStartAuthoritativeRefresh({
  reason,
  now,
  lastStartedAt,
  inFlight,
  windowMs = 1000,
}: {
  reason: string;
  now: number;
  lastStartedAt: number;
  inFlight: boolean;
  windowMs?: number;
}): boolean {
  if (inFlight) return false;
  if (reason !== "manual" && now - lastStartedAt < windowMs) {
    return false;
  }
  return true;
}

/**
 * Merges pending offline outbox movements into AppData without duplicating IDs.
 */
export function mergePendingMovements(data: AppData, operations: OfflineCreateMovementOperation[]): AppData {
  const remoteMovementIds = new Set(data.movements.map((movement) => movement.id));
  const overlayMovementIds = new Set<string>();
  const pendingMovements = operations
    .map((operation) => operation.movement)
    .filter((movement) => {
      if (remoteMovementIds.has(movement.id) || overlayMovementIds.has(movement.id)) return false;
      overlayMovementIds.add(movement.id);
      return true;
    });

  return pendingMovements.length > 0 ? { ...data, movements: [...pendingMovements, ...data.movements] } : data;
}
