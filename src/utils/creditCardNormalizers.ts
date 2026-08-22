import type { CreditCardEntry, CreditCardEntryType, CreditCardProfile } from "../types";

export function normalizeCreditCardProfile(item: unknown): CreditCardProfile | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;

  const debtId = typeof raw.debtId === "string" ? raw.debtId : typeof raw.debt_id === "string" ? raw.debt_id : null;
  if (!debtId) return null;

  const creditLimitRaw = raw.creditLimit ?? raw.credit_limit;
  const creditLimit = typeof creditLimitRaw === "number" && !isNaN(creditLimitRaw) && creditLimitRaw > 0 ? creditLimitRaw : null;

  const closingDayRaw = raw.closingDay ?? raw.closing_day;
  const closingDay =
    typeof closingDayRaw === "number" && !isNaN(closingDayRaw) && closingDayRaw >= 1 && closingDayRaw <= 31 ? closingDayRaw : null;

  const dueDayRaw = raw.dueDay ?? raw.due_day;
  const dueDay = typeof dueDayRaw === "number" && !isNaN(dueDayRaw) && dueDayRaw >= 1 && dueDayRaw <= 31 ? dueDayRaw : null;

  const last4Raw = raw.last4;
  const last4 = typeof last4Raw === "string" && /^[0-9]{4}$/.test(last4Raw) ? last4Raw : null;

  const createdByUserId =
    typeof raw.createdByUserId === "string"
      ? raw.createdByUserId
      : typeof raw.created_by_user_id === "string"
      ? raw.created_by_user_id
      : "system";

  const createdAt =
    typeof raw.createdAt === "string"
      ? raw.createdAt
      : typeof raw.created_at === "string"
      ? raw.created_at
      : new Date().toISOString();

  const updatedAt =
    typeof raw.updatedAt === "string"
      ? raw.updatedAt
      : typeof raw.updated_at === "string"
      ? raw.updated_at
      : createdAt;

  return {
    debtId,
    creditLimit,
    closingDay,
    dueDay,
    last4,
    createdByUserId,
    createdAt,
    updatedAt,
  };
}

export function normalizeCreditCardProfiles(items: unknown[]): CreditCardProfile[] {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeCreditCardProfile).filter((profile): profile is CreditCardProfile => profile !== null);
}

const validEntryTypes = new Set<CreditCardEntryType>(["purchase", "payment", "finance_charge", "credit", "reversal"]);

export function normalizeCreditCardEntry(item: unknown): CreditCardEntry | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;

  const id = typeof raw.id === "string" ? raw.id : null;
  const debtId = typeof raw.debtId === "string" ? raw.debtId : typeof raw.debt_id === "string" ? raw.debt_id : null;
  if (!id || !debtId) return null;

  const entryDate =
    typeof raw.entryDate === "string" ? raw.entryDate : typeof raw.entry_date === "string" ? raw.entry_date : null;
  if (!entryDate) return null;

  const entryTypeRaw = raw.entryType ?? raw.entry_type;
  const entryType = typeof entryTypeRaw === "string" && validEntryTypes.has(entryTypeRaw as CreditCardEntryType)
    ? (entryTypeRaw as CreditCardEntryType)
    : null;
  if (!entryType) return null;

  const liabilityDeltaRaw = raw.liabilityDelta ?? raw.liability_delta;
  const liabilityDelta = typeof liabilityDeltaRaw === "number" && !isNaN(liabilityDeltaRaw) ? liabilityDeltaRaw : null;
  if (liabilityDelta === null) return null;

  const movementIdRaw = raw.movementId ?? raw.movement_id;
  const movementId = typeof movementIdRaw === "string" ? movementIdRaw : null;

  const reversalOfEntryIdRaw = raw.reversalOfEntryId ?? raw.reversal_of_entry_id;
  const reversalOfEntryId = typeof reversalOfEntryIdRaw === "string" ? reversalOfEntryIdRaw : null;

  const description = typeof raw.description === "string" ? raw.description : "";

  const registeredByUserId =
    typeof raw.registeredByUserId === "string"
      ? raw.registeredByUserId
      : typeof raw.registered_by_user_id === "string"
      ? raw.registered_by_user_id
      : "system";

  const createdAt =
    typeof raw.createdAt === "string"
      ? raw.createdAt
      : typeof raw.created_at === "string"
      ? raw.created_at
      : new Date().toISOString();

  return {
    id,
    debtId,
    entryDate,
    entryType,
    liabilityDelta,
    movementId,
    reversalOfEntryId,
    description,
    registeredByUserId,
    createdAt,
  };
}

export function normalizeCreditCardEntries(items: unknown[]): CreditCardEntry[] {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeCreditCardEntry).filter((entry): entry is CreditCardEntry => entry !== null);
}
