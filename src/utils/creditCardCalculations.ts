import type { CreditCardEntry, Debt } from "../types";

export function effectiveCreditCardEntries(entries: CreditCardEntry[], debtId?: string): CreditCardEntry[] {
  const reversedIds = new Set<string>(
    entries
      .filter((entry) => entry.entryType === "reversal" && entry.reversalOfEntryId !== null)
      .map((entry) => entry.reversalOfEntryId!)
  );

  return entries.filter(
    (entry) =>
      entry.entryType !== "reversal" &&
      !reversedIds.has(entry.id) &&
      (debtId === undefined || entry.debtId === debtId)
  );
}

export function currentCreditCardBalance(debt: Debt, entries: CreditCardEntry[]): number {
  const effective = effectiveCreditCardEntries(entries, debt.id);
  const deltaSum = effective.reduce((sum, entry) => sum + entry.liabilityDelta, 0);
  return debt.openingPrincipalBalance + deltaSum;
}
