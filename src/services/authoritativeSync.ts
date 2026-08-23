import type { AppData } from "../types.js";
import type { AppDataLoadSource } from "./dataRepository.js";
import type { OfflineCreateMovementOperation } from "./offlineOutbox.js";

export type RemoteSyncStatus = "idle" | "refreshing" | "fresh" | "offline" | "error";

/**
 * Pure helper: Determines if an authoritative refresh should start.
 *
 * Rules:
 * - If refresh is already in-flight: REJECT (false)
 * - If trigger is automatic and last refresh started less than windowMs ago: REJECT (false)
 * - Forced triggers ("manual" or "reconciliation") always bypass the time window deduplication.
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
  const isForcedTrigger = reason === "manual" || reason === "reconciliation";
  if (!isForcedTrigger && now - lastStartedAt < windowMs) {
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

  const newPendingMovements = operations
    .filter((op) => !remoteMovementIds.has(op.movement.id))
    .map((op) => op.movement);

  for (const op of operations) {
    overlayMovementIds.add(op.movement.id);
  }

  const baseMovements = data.movements.map((movement) => {
    if (overlayMovementIds.has(movement.id)) {
      const op = operations.find((item) => item.movement.id === movement.id);
      return op ? op.movement : movement;
    }
    return movement;
  });

  return {
    ...data,
    movements: [...newPendingMovements, ...baseMovements],
  };
}

/**
 * Pure helper: Validates source for adopting authoritative load.
 */
export function validateAuthoritativeLoadSource({
  isOnline,
  source,
}: {
  isOnline: boolean;
  source: AppDataLoadSource | "trusted_snapshot";
}): boolean {
  if (isOnline) return source === "remote";
  return source === "trusted_snapshot" || source === "fallback";
}
