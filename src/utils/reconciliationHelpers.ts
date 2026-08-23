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
 * Pure helper: Determines if a movement belongs to ANY ACTIVE financial account.
 */
export function doesMovementBelongToAnyActiveAccount(
  movement: Movement,
  accounts: FinancialAccount[] = []
): boolean {
  return accounts.some((account) => account.isActive && movementBelongsToAccount(movement, account));
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
 * Pure production helper: Determines if a movement is "Pendiente" for reconciliation.
 * A movement is pending ONLY if:
 * 1. It belongs to an ACTIVE reconcilable account (doesMovementBelongToAnyActiveAccount is true).
 * 2. AND it lacks current valid certified matched evidence.
 */
export function isMovementPendingForReconciliation(
  movement: Movement,
  accounts: FinancialAccount[] = [],
  reconciliations: AccountReconciliation[] = [],
  recMovements: AccountReconciliationMovement[] = [],
  creditCardEntries: CreditCardEntry[] = []
): boolean {
  if (!doesMovementBelongToAnyActiveAccount(movement, accounts)) {
    return false;
  }
  return !isMovementCertifiedMatched(movement, reconciliations, recMovements, creditCardEntries);
}

/**
 * Pure helper: Gets movements belonging to an account that do NOT have valid matched snapshot evidence
 * in its latest matched reconciliation.
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
    if (!rm) return true;
    if (m.updatedAt && m.updatedAt !== rm.movementUpdatedAtSnapshot) return true;
    const effectiveContrib = calculateEffectiveContribution(m, creditCardEntries);
    if (effectiveContrib !== rm.balanceContribution) return true;
    return false;
  });
}

/**
 * Pure helper: Determines if an account reconciliation status is stale.
 * Stale condition rules (RECON-1A + RECON-1B):
 * 1. openingBalanceSnapshot !== account.openingBalance
 * 2. Any snapshot movement in latestMatchedRec is missing from current movements collection (deleted)
 * 3. Any movement belonging to account is unreconciled (new, modified updatedAt, or contribution reversed)
 */
export function isReconciliationStale(
  latestMatchedRec: AccountReconciliation | null,
  account: FinancialAccount,
  movements: Movement[],
  recMovements: AccountReconciliationMovement[],
  creditCardEntries: CreditCardEntry[] = []
): boolean {
  if (!latestMatchedRec) return false;

  if (latestMatchedRec.openingBalanceSnapshot !== account.openingBalance) {
    return true;
  }

  const currentMovementIds = new Set(movements.map((m) => m.id));
  const recSnapshots = recMovements.filter((rm) => rm.reconciliationId === latestMatchedRec.id);

  for (const rm of recSnapshots) {
    if (!currentMovementIds.has(rm.movementId)) {
      return true;
    }
  }

  const unreconciled = getUnreconciledMovements(
    account,
    movements,
    latestMatchedRec,
    recMovements,
    creditCardEntries
  );

  return unreconciled.length > 0;
}
