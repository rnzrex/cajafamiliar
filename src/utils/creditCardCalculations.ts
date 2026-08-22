import type { CreditCardEntry, CreditCardStatement, Debt } from "../types";

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

export function effectiveCreditCardEntriesAsOf(
  entries: CreditCardEntry[],
  asOfDate: string,
  debtId?: string
): CreditCardEntry[] {
  const scopedAsOf = entries.filter((entry) => {
    if (debtId !== undefined && entry.debtId !== debtId) return false;
    return entry.entryDate <= asOfDate;
  });

  const reversedIds = new Set<string>(
    scopedAsOf
      .filter((entry) => entry.entryType === "reversal" && entry.reversalOfEntryId !== null)
      .map((entry) => entry.reversalOfEntryId!)
  );

  return scopedAsOf.filter(
    (entry) => entry.entryType !== "reversal" && !reversedIds.has(entry.id)
  );
}

export function currentCreditCardBalance(debt: Debt, entries: CreditCardEntry[]): number {
  const effective = effectiveCreditCardEntries(entries, debt.id);
  const deltaSum = effective.reduce((sum, entry) => sum + entry.liabilityDelta, 0);
  return debt.openingPrincipalBalance + deltaSum;
}

export function statementCreditCardBalance(debt: Debt, entries: CreditCardEntry[], statementDate: string): number {
  const effectiveAsOfDate = effectiveCreditCardEntriesAsOf(entries, statementDate, debt.id);
  const deltaSum = effectiveAsOfDate.reduce((sum, entry) => sum + entry.liabilityDelta, 0);
  return debt.openingPrincipalBalance + deltaSum;
}

export function latestCreditCardStatement(statements: CreditCardStatement[], debtId: string): CreditCardStatement | null {
  const cardStatements = statements.filter((s) => s.debtId === debtId);
  if (cardStatements.length === 0) return null;
  return cardStatements.reduce((latest, s) =>
    s.statementDate > latest.statementDate ? s : latest
  );
}
