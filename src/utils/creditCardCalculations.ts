import type { CreditCardEntry, Debt } from "../types";

export function effectiveCreditCardEntries(entries: CreditCardEntry[], debtId?: string): CreditCardEntry[] {
  const scopedEntries =
    debtId === undefined
      ? entries
      : entries.filter((entry) => entry.debtId === debtId);

  const reversedIds = new Set<string>(
    scopedEntries
      .filter((entry) => entry.entryType === "reversal" && entry.reversalOfEntryId !== null)
      .map((entry) => entry.reversalOfEntryId!)
  );

  return scopedEntries.filter(
    (entry) => entry.entryType !== "reversal" && !reversedIds.has(entry.id)
  );
}

export function currentCreditCardBalance(debt: Debt, entries: CreditCardEntry[]): number {
  const effective = effectiveCreditCardEntries(entries, debt.id);
  const deltaSum = effective.reduce((sum, entry) => sum + entry.liabilityDelta, 0);
  return debt.openingPrincipalBalance + deltaSum;
}
