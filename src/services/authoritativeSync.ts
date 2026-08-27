import type { AppData } from "../types";
import type { AppDataLoadResult, DebtCreateResult } from "./dataRepository";
import type { OfflineCreateMovementOperation } from "./offlineOutbox";

function upsertById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return existing;

  const positions = new Map(existing.map((item, index) => [item.id, index]));
  const merged = [...existing];
  for (const item of incoming) {
    const existingIndex = positions.get(item.id);
    if (existingIndex == null) {
      positions.set(item.id, merged.length);
      merged.push(item);
    } else {
      merged[existingIndex] = item;
    }
  }
  return merged;
}

/**
 * Applies the authoritative rows returned by a successful debt-creation RPC
 * to the currently rendered AppData. The helper is intentionally idempotent:
 * a later authoritative refresh may contain the same IDs, and reapplying the
 * create result must not duplicate any debt-owned rows.
 */
export function mergeDebtCreateResultIntoAppData(data: AppData, result: DebtCreateResult): AppData {
  return {
    ...data,
    debts: upsertById(data.debts, [result.debt]),
    debtScheduleVersions: result.scheduleVersion
      ? upsertById(data.debtScheduleVersions, [result.scheduleVersion])
      : data.debtScheduleVersions,
    debtInstallments: upsertById(data.debtInstallments, result.installments),
    debtCollaterals: upsertById(data.debtCollaterals, result.collaterals),
  };
}

export function containsDebtCreateResult(data: AppData, result: DebtCreateResult): boolean {
  return data.debts.some((debt) => debt.id === result.debt.id)
    && (result.scheduleVersion == null || data.debtScheduleVersions.some((version) => version.id === result.scheduleVersion!.id))
    && result.installments.every((installment) => data.debtInstallments.some((row) => row.id === installment.id))
    && result.collaterals.every((collateral) => data.debtCollaterals.some((row) => row.id === collateral.id));
}

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
