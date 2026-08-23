import type { CreditCardEntry, CreditCardStatement, Debt } from "../types.js";

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

export function isCreditCardMovementEffective(
  movementId: string,
  creditCardEntries?: CreditCardEntry[],
  asOfDate?: string
): boolean {
  if (!creditCardEntries || creditCardEntries.length === 0) return true;

  const linkedEntry = creditCardEntries.find((entry) => entry.movementId === movementId);
  if (!linkedEntry) return true;

  const effective = asOfDate
    ? effectiveCreditCardEntriesAsOf(creditCardEntries, asOfDate)
    : effectiveCreditCardEntries(creditCardEntries);

  return effective.some((e) => e.id === linkedEntry.id);
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

// ---------------------------------------------------------------------------
// DEBT-5E: Credit Card Intelligence Adapter & Statement Alerts Read-Model
// ---------------------------------------------------------------------------

import type { CreditCardProfile } from "../types.js";
import { dueDateStatus } from "./dueDates.js";
import type { DueDateKind } from "./dueDates.js";
import { localDateString } from "./date.js";

export type CreditCardStatementCoverageStatus =
  | "known_unsettled"
  | "unknown_after_settlement_activity"
  | "no_positive_obligation";

export interface CreditCardStatementAttentionClassification {
  coverageStatus: CreditCardStatementCoverageStatus;
  actionable: boolean;
  statementOutstandingBalance: null;
}

/**
 * Pure helper to check if an entry occurred after the statement snapshot cutoff.
 */
export function isEntryPostStatementClose(
  entry: CreditCardEntry,
  statement: CreditCardStatement
): boolean {
  if (entry.entryDate > statement.statementDate) {
    return true;
  }
  if (entry.entryDate === statement.statementDate) {
    if (entry.createdAt && statement.createdAt) {
      return entry.createdAt > statement.createdAt;
    }
    return true;
  }
  return false;
}

/**
 * Pure helper to determine if a target entry belonged to the statement snapshot.
 */
export function entryBelongedToStatementSnapshot(
  targetEntry: CreditCardEntry,
  statement: CreditCardStatement
): boolean {
  if (targetEntry.entryDate < statement.statementDate) {
    return true;
  }
  if (targetEntry.entryDate === statement.statementDate) {
    if (targetEntry.createdAt && statement.createdAt) {
      return targetEntry.createdAt <= statement.createdAt;
    }
    return true;
  }
  return false;
}

/**
 * Classifies statement coverage/attention state for a given card & latest statement.
 */
export function classifyCreditCardStatementAttention({
  debt,
  statement,
  entries,
  currentCardBalance,
}: {
  debt: Debt;
  statement: CreditCardStatement;
  entries: CreditCardEntry[];
  currentCardBalance: number;
}): CreditCardStatementAttentionClassification {
  if (statement.statementBalance <= 0 || currentCardBalance <= 0) {
    return {
      coverageStatus: "no_positive_obligation",
      actionable: false,
      statementOutstandingBalance: null,
    };
  }

  // Source A: Effective non-reversal entries (effectiveCreditCardEntries excludes reversal rows and reversed entries)
  const effectiveEntries = effectiveCreditCardEntries(entries, debt.id);

  const hasEffectivePostCloseSettlement = effectiveEntries.some((entry) => {
    if (!isEntryPostStatementClose(entry, statement)) return false;

    // Type A1: Effective post-close payment
    if (entry.entryType === "payment") {
      return true;
    }

    // Type A2: Effective post-close credit targeting an entry that belonged to statement snapshot
    if (entry.entryType === "credit" && entry.creditOfEntryId) {
      const targetEntry = entries.find((e) => e.id === entry.creditOfEntryId);
      if (targetEntry && entryBelongedToStatementSnapshot(targetEntry, statement)) {
        return true;
      }
    }

    return false;
  });

  if (hasEffectivePostCloseSettlement) {
    return {
      coverageStatus: "unknown_after_settlement_activity",
      actionable: false,
      statementOutstandingBalance: null,
    };
  }

  // Source B: Raw reversal entries scoped to this debt
  const cardEntries = entries.filter((e) => e.debtId === debt.id);
  const rawReversals = cardEntries.filter((e) => e.entryType === "reversal");

  const hasPostCloseReversalOfSnapshotEntry = rawReversals.some((reversalEntry) => {
    if (!isEntryPostStatementClose(reversalEntry, statement)) return false;

    if (!reversalEntry.reversalOfEntryId) return false;
    const targetEntry = cardEntries.find((e) => e.id === reversalEntry.reversalOfEntryId);
    if (!targetEntry) return false;

    return entryBelongedToStatementSnapshot(targetEntry, statement);
  });

  if (hasPostCloseReversalOfSnapshotEntry) {
    return {
      coverageStatus: "unknown_after_settlement_activity",
      actionable: false,
      statementOutstandingBalance: null,
    };
  }

  return {
    coverageStatus: "known_unsettled",
    actionable: true,
    statementOutstandingBalance: null,
  };
}

export interface CreditCardIntelligenceAdapterItem {
  debtId: string;
  cardName: string;
  creditorName: string;
  currencyCode: string;
  status: Debt["status"];
  isArchived: boolean;

  currentBalance: number;
  openingPrincipalBalance: number;

  latestStatement: CreditCardStatement | null;
  latestStatementDate: string | null;
  latestStatementDueDate: string | null;
  latestStatementBalance: number | null;

  minimumPaymentAmount: number | null;
  minimumPaymentKnown: boolean;

  daysUntilStatementDue: number | null;
  statementDueStatus: "covered" | DueDateKind | "no_statement";
  coverageStatus: CreditCardStatementCoverageStatus | "no_statement";
  actionable: boolean;
  statementOutstandingBalance: null;

  creditLimit: number | null;
  availableCredit: number | null;
  utilizationRatio: number | null;
}

export function buildCreditCardIntelligenceItem({
  debt,
  profile,
  entries,
  statements,
  todayKey = localDateString(),
}: {
  debt: Debt;
  profile?: CreditCardProfile | null;
  entries: CreditCardEntry[];
  statements: CreditCardStatement[];
  todayKey?: string;
}): CreditCardIntelligenceAdapterItem {
  const currentBalance = currentCreditCardBalance(debt, entries);
  const latest = latestCreditCardStatement(statements, debt.id);

  const minimumPaymentAmount = latest?.minimumPaymentAmount ?? null;
  const minimumPaymentKnown = minimumPaymentAmount !== null;

  let daysUntilStatementDue: number | null = null;
  let statementDueStatus: "covered" | DueDateKind | "no_statement" = "no_statement";
  let coverageStatus: CreditCardStatementCoverageStatus | "no_statement" = "no_statement";
  let actionable = false;

  if (latest?.dueDate) {
    const ds = dueDateStatus(latest.dueDate, todayKey);
    daysUntilStatementDue = ds.days;
    statementDueStatus = ds.kind;

    const attention = classifyCreditCardStatementAttention({
      debt,
      statement: latest,
      entries,
      currentCardBalance: currentBalance,
    });
    coverageStatus = attention.coverageStatus;
    actionable = attention.actionable;
  }

  const creditLimit = profile?.creditLimit ?? null;
  const availableCredit = creditLimit !== null ? creditLimit - currentBalance : null;
  const utilizationRatio =
    creditLimit !== null && creditLimit > 0
      ? Math.max(currentBalance, 0) / creditLimit
      : null;

  return {
    debtId: debt.id,
    cardName: debt.name,
    creditorName: debt.creditorName,
    currencyCode: debt.currencyCode || "PEN",
    status: debt.status,
    isArchived: debt.isArchived,
    currentBalance,
    openingPrincipalBalance: debt.openingPrincipalBalance,
    latestStatement: latest,
    latestStatementDate: latest?.statementDate ?? null,
    latestStatementDueDate: latest?.dueDate ?? null,
    latestStatementBalance: latest?.statementBalance ?? null,
    minimumPaymentAmount,
    minimumPaymentKnown,
    daysUntilStatementDue,
    statementDueStatus,
    coverageStatus,
    actionable,
    statementOutstandingBalance: null,
    creditLimit,
    availableCredit,
    utilizationRatio,
  };
}

export interface CreditCardStatementAlertItem {
  debtId: string;
  cardName: string;
  creditorName: string;
  currencyCode: string;
  statementId: string;
  statementDate: string;
  dueDate: string;
  statementBalance: number;
  minimumPaymentAmount: number | null;
  minimumPaymentKnown: boolean;
  daysUntilDue: number;
  dueStatus: DueDateKind;
  dueLabel: string;
  dueTone: "red" | "orange" | "yellow" | "blue";
  coverageStatus: CreditCardStatementCoverageStatus;
  actionable: boolean;
  statementOutstandingBalance: null;
  dedupeKey: string;
}

export function buildCreditCardStatementAlerts({
  debts,
  creditCardProfiles = [],
  creditCardEntries = [],
  creditCardStatements = [],
  todayKey = localDateString(),
}: {
  debts: Debt[];
  creditCardProfiles?: CreditCardProfile[];
  creditCardEntries?: CreditCardEntry[];
  creditCardStatements?: CreditCardStatement[];
  todayKey?: string;
}): CreditCardStatementAlertItem[] {
  const alerts: CreditCardStatementAlertItem[] = [];

  const activeCardDebts = debts.filter(
    (d) => d.debtKind === "credit_card" && d.status === "active" && !d.isArchived
  );

  for (const debt of activeCardDebts) {
    const profile = creditCardProfiles.find((p) => p.debtId === debt.id);
    const item = buildCreditCardIntelligenceItem({
      debt,
      profile,
      entries: creditCardEntries,
      statements: creditCardStatements,
      todayKey,
    });

    if (!item.latestStatement || !item.latestStatementDueDate || item.coverageStatus === "no_statement") continue;

    const ds = dueDateStatus(item.latestStatementDueDate, todayKey);
    const dedupeKey = `card-statement-${debt.id}-${item.latestStatement.id}-${ds.kind}`;

    alerts.push({
      debtId: debt.id,
      cardName: debt.name,
      creditorName: debt.creditorName,
      currencyCode: debt.currencyCode || "PEN",
      statementId: item.latestStatement.id,
      statementDate: item.latestStatement.statementDate,
      dueDate: item.latestStatement.dueDate,
      statementBalance: item.latestStatement.statementBalance,
      minimumPaymentAmount: item.minimumPaymentAmount,
      minimumPaymentKnown: item.minimumPaymentKnown,
      daysUntilDue: ds.days,
      dueStatus: ds.kind,
      dueLabel: ds.label,
      dueTone: ds.tone,
      coverageStatus: item.coverageStatus as CreditCardStatementCoverageStatus,
      actionable: item.actionable,
      statementOutstandingBalance: null,
      dedupeKey,
    });
  }

  const priorityMap: Record<DueDateKind, number> = {
    overdue: 1,
    today: 2,
    tomorrow: 3,
    upcoming: 4,
    later: 5,
  };

  return alerts.sort((a, b) => {
    const prioA = priorityMap[a.dueStatus] ?? 99;
    const prioB = priorityMap[b.dueStatus] ?? 99;
    if (prioA !== prioB) return prioA - prioB;
    if (a.daysUntilDue !== b.daysUntilDue) return a.daysUntilDue - b.daysUntilDue;
    return a.cardName.localeCompare(b.cardName);
  });
}

export function selectUrgentCreditCardStatementAlertsForReminder(
  alerts: CreditCardStatementAlertItem[]
): CreditCardStatementAlertItem[] {
  return alerts.filter(
    (alert) => alert.actionable && ["overdue", "today", "tomorrow", "upcoming"].includes(alert.dueStatus)
  );
}

export interface CreditCardRefundCapacity {
  originalAmount: number;
  effectiveRefundedAmount: number;
  remainingRefundableAmount: number;
  isRefundable: boolean;
}

export function calculateCreditCardRefundCapacity(
  targetEntry: CreditCardEntry,
  cardEntries: CreditCardEntry[]
): CreditCardRefundCapacity {
  const originalAmount = Math.abs(targetEntry.liabilityDelta);

  const scopedEntries = cardEntries.filter((e) => e.debtId === targetEntry.debtId);
  const reversedIds = new Set<string>(
    scopedEntries
      .filter((e) => e.entryType === "reversal" && e.reversalOfEntryId !== null)
      .map((e) => e.reversalOfEntryId!)
  );

  const effectiveCredits = scopedEntries.filter(
    (e) =>
      e.entryType === "credit" &&
      e.creditOfEntryId === targetEntry.id &&
      !reversedIds.has(e.id)
  );

  const effectiveRefundedAmount = effectiveCredits.reduce(
    (sum, e) => sum + Math.abs(e.liabilityDelta),
    0
  );

  const remainingRefundableAmount = Math.max(0, originalAmount - effectiveRefundedAmount);
  const isRefundable = remainingRefundableAmount > 0.0001;

  return {
    originalAmount,
    effectiveRefundedAmount,
    remainingRefundableAmount,
    isRefundable,
  };
}

export function isCreditCardEntryEligibleForReversal(
  entry: CreditCardEntry,
  cardEntries: CreditCardEntry[]
): boolean {
  if (entry.entryType === "reversal") return false;

  const scopedEntries = cardEntries.filter((e) => e.debtId === entry.debtId);
  const isReversed = scopedEntries.some(
    (e) => e.entryType === "reversal" && e.reversalOfEntryId === entry.id
  );
  if (isReversed) return false;

  const refundCap = calculateCreditCardRefundCapacity(entry, cardEntries);
  if (refundCap.effectiveRefundedAmount > 0.0001) return false;

  return true;
}
