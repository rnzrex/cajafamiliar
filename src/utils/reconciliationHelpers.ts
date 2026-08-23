import type { AccountReconciliation, AccountReconciliationMovement, CreditCardEntry, FinancialAccount, Movement } from "../types.js";
import { isCreditCardMovementEffective } from "./creditCardCalculations.js";

/**
 * Pure helper: Returns the latest MATCHED reconciliation for a financial account.
 */
export function getLatestMatchedReconciliation(
  account: FinancialAccount,
  reconciliations: AccountReconciliation[]
): AccountReconciliation | null {
  const matched = reconciliations.filter(
    (rec) => rec.accountId === account.id && rec.status === "matched"
  );
  if (matched.length === 0) return null;

  return [...matched].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/**
 * Pure helper: Determines if a movement belongs to an account based on reconciliation type.
 * - Balance account: movement.accountId === account.id
 * - Cash account: movement.accountId === account.id OR (movement.accountId IS NULL AND method === 'efectivo')
 */
export function movementBelongsToAccount(movement: Movement, account: FinancialAccount): boolean {
  if (account.reconciliationType === "balance") {
    return movement.accountId === account.id;
  }
  return movement.accountId === account.id || (movement.accountId == null && movement.method === "efectivo");
}

/**
 * Pure helper: Computes the effective balance contribution of a movement as of now.
 */
export function calculateEffectiveContribution(
  movement: Movement,
  creditCardEntries: CreditCardEntry[] = []
): number {
  if (creditCardEntries.length > 0 && !isCreditCardMovementEffective(movement.id, creditCardEntries)) {
    return 0;
  }
  return movement.type === "ingreso" ? movement.amount : -movement.amount;
}

/**
 * Pure helper: Determines if a movement has CURRENT valid MATCHED reconciliation evidence.
 * A movement has valid matched evidence ONLY when its membership in a matched reconciliation agrees with:
 * 1. movement.updatedAt === snapshot.movementUpdatedAtSnapshot
 * 2. effective contribution === snapshot.balanceContribution
 */
export function isMovementCertifiedMatched(
  movement: Movement,
  reconciliations: AccountReconciliation[],
  recMovements: AccountReconciliationMovement[],
  creditCardEntries: CreditCardEntry[] = []
): boolean {
  const matchedRecIds = new Set(
    reconciliations.filter((r) => r.status === "matched").map((r) => r.id)
  );

  const effectiveContrib = calculateEffectiveContribution(movement, creditCardEntries);

  return recMovements.some((rm) => {
    if (rm.movementId !== movement.id || !matchedRecIds.has(rm.reconciliationId)) {
      return false;
    }

    if (movement.updatedAt && movement.updatedAt !== rm.movementUpdatedAtSnapshot) {
      return false;
    }

    if (effectiveContrib !== rm.balanceContribution) {
      return false;
    }

    return true;
  });
}

/**
 * Pure helper: Gets movements belonging to an account that do NOT have valid matched snapshot evidence
 * in its latest matched reconciliation.
 * A movement is pending (unreconciled) if:
 * 1. It was NOT included in the latest matched reconciliation snapshot.
 * 2. Or it WAS included, but its updatedAt changed since the snapshot.
 * 3. Or it WAS included, but its effective contribution changed (e.g. credit card payment reversed).
 */
export function getUnreconciledMovements(
  account: FinancialAccount,
  movements: Movement[],
  latestMatchedRec: AccountReconciliation | null,
  recMovements: AccountReconciliationMovement[],
  creditCardEntries: CreditCardEntry[] = []
): Movement[] {
  const accountMovements = movements.filter((m) => movementBelongsToAccount(m, account));

  if (!latestMatchedRec) {
    return accountMovements;
  }

  const snapshotMap = new Map<string, AccountReconciliationMovement>(
    recMovements
      .filter((rm) => rm.reconciliationId === latestMatchedRec.id)
      .map((rm) => [rm.movementId, rm])
  );

  return accountMovements.filter((m) => {
    const rm = snapshotMap.get(m.id);
    if (!rm) {
      // New movement not in snapshot => pending
      return true;
    }

    // Included movement whose updatedAt changed => pending
    if (m.updatedAt && m.updatedAt !== rm.movementUpdatedAtSnapshot) {
      return true;
    }

    // Included movement whose effective contribution changed => pending
    const effectiveContrib = calculateEffectiveContribution(m, creditCardEntries);
    if (effectiveContrib !== rm.balanceContribution) {
      return true;
    }

    return false;
  });
}

/**
 * Pure helper: Determines if a reconciliation state is STALE for the entire reconciliation.
 * Stale conditions:
 * 1. Opening balance changed (account.openingBalance !== reconciliation.openingBalanceSnapshot).
 * 2. A new movement appeared for the account that was NOT in the reconciliation snapshot.
 * 3. An included movement's version/updatedAt changed.
 * 4. An included movement's effective contribution changed (e.g., credit card payment reversal).
 */
export function isReconciliationStale(
  reconciliation: AccountReconciliation,
  account: FinancialAccount,
  movements: Movement[],
  recMovements: AccountReconciliationMovement[],
  creditCardEntries: CreditCardEntry[] = []
): boolean {
  // Condition 1: Opening balance changed
  if (account.openingBalance !== reconciliation.openingBalanceSnapshot) {
    return true;
  }

  const snapshotRecMovements = recMovements.filter(
    (rm) => rm.reconciliationId === reconciliation.id
  );
  const snapshotMovementIds = new Set(snapshotRecMovements.map((rm) => rm.movementId));

  // Condition 2: New movement appeared that belongs to account but not in snapshot
  const currentAccountMovements = movements.filter((m) => movementBelongsToAccount(m, account));
  const hasNewMovement = currentAccountMovements.some((m) => !snapshotMovementIds.has(m.id));
  if (hasNewMovement) {
    return true;
  }

  // Condition 3 & 4: Check existing snapshot movements for updatedAt mismatch or contribution mismatch
  for (const snapshotRm of snapshotRecMovements) {
    const currentMov = movements.find((m) => m.id === snapshotRm.movementId);
    if (!currentMov) {
      // Movement was removed/missing
      return true;
    }

    // Check updatedAt mismatch if currentMov has updatedAt
    if (currentMov.updatedAt && currentMov.updatedAt !== snapshotRm.movementUpdatedAtSnapshot) {
      return true;
    }

    // Check effective contribution mismatch (e.g. credit card reversal)
    const currentEffectiveContrib = calculateEffectiveContribution(currentMov, creditCardEntries);
    if (currentEffectiveContrib !== snapshotRm.balanceContribution) {
      return true;
    }
  }

  return false;
}
