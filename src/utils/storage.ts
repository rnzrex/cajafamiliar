import { AppData, CashCount, Category, CreditCardEntry, CreditCardProfile, CreditCardStatement, Debt, DebtCollateral, DebtEvent, DebtEventInstallmentAllocation, DebtInstallment, DebtScheduleVersion, FinancialAccount, HouseholdMember, Movement, RecurringPayment, baseCategories } from "../types";
import { localDateString } from "./date";
import { isSupabaseConfigured } from "../services/supabaseClient";
import { normalizeDebtCollaterals, normalizeDebtEventInstallmentAllocations, normalizeDebtEvents, normalizeDebtInstallments, normalizeDebtScheduleVersions, normalizeDebts } from "./debtNormalizers";
import { normalizeCreditCardEntries, normalizeCreditCardProfiles, normalizeCreditCardStatements } from "./creditCardNormalizers";

const STORAGE_KEY = "caja-familiar-data";
const PREFERRED_PERSON_KEY = "caja-familiar-preferred-person";
const CUSTOM_PERSON_PREFIX = "custom:";
const OFFLINE_ACCESS_KEY = "caja-familiar-offline-access";
const TRUSTED_SNAPSHOT_KEY = "caja-familiar-trusted-snapshot";
const OFFLINE_CACHE_VERSION = 2 as const;

export interface AppDataSnapshotInput {
  movements: Movement[];
  cashCounts: CashCount[];
  recurringPayments: RecurringPayment[];
  categories: Category[];
  initialBalance: number;
  financialAccounts?: FinancialAccount[];
  debts?: Debt[];
  debtEvents?: DebtEvent[];
  debtScheduleVersions?: DebtScheduleVersion[];
  debtInstallments?: DebtInstallment[];
  debtEventInstallmentAllocations?: DebtEventInstallmentAllocation[];
  debtCollaterals?: DebtCollateral[];
  creditCardProfiles?: CreditCardProfile[];
  creditCardEntries?: CreditCardEntry[];
  creditCardStatements?: CreditCardStatement[];
}

export interface OfflineAccessRecord {
  version: typeof OFFLINE_CACHE_VERSION;
  householdId: string;
  userId: string;
  displayName: string;
  role: HouseholdMember["role"];
  snapshotReady: boolean;
}

interface TrustedSnapshotMetadata {
  version: typeof OFFLINE_CACHE_VERSION;
  householdId: string;
  userId: string;
  savedAt: number;
}

const today = new Date();
const isoToday = localDateString(today);

const sampleMovements: Movement[] = [
  {
    id: "mov-1",
    type: "ingreso",
    date: isoToday,
    amount: 500,
    description: "Ingreso negocio",
    method: "efectivo",
    category: "Negocio",
    person: "Mama",
    accountId: null,
    movementContext: "standard",
  },
  {
    id: "mov-2",
    type: "egreso",
    date: isoToday,
    amount: 80,
    description: "Compra mercado",
    method: "efectivo",
    category: "Mercado",
    person: "Papa",
    accountId: null,
    movementContext: "standard",
  },
  {
    id: "mov-3",
    type: "egreso",
    date: isoToday,
    amount: 45,
    description: "Pago telefono",
    method: "Yape",
    category: "Teléfono",
    person: "Mama",
    accountId: null,
    movementContext: "standard",
  },
  {
    id: "mov-4",
    type: "egreso",
    date: isoToday,
    amount: 60,
    description: "Cena familiar",
    method: "efectivo",
    category: "Comida / cenas",
    person: "Hijo",
    accountId: null,
    movementContext: "standard",
  },
  {
    id: "mov-5",
    type: "egreso",
    date: isoToday,
    amount: 300,
    description: "Prestamo banco",
    method: "transferencia",
    category: "Préstamos",
    person: "Papa",
    accountId: null,
    movementContext: "standard",
  },
  {
    id: "mov-6",
    type: "egreso",
    date: isoToday,
    amount: 15,
    description: "Compra cigarrillos",
    method: "efectivo",
    category: "Cigarrillos",
    person: "Papa",
    accountId: null,
    movementContext: "standard",
  },
];

const samplePayments: RecurringPayment[] = [
  {
    id: "pay-1",
    name: "Luz",
    amount: 120,
    amount_mode: "fixed",
    dueDay: Math.min(28, today.getDate() + 1),
    dueDate: null,
    category: "Luz",
    status: "pendiente",
    notes: "Revisar recibo antes de pagar.",
    recurrence_type: "indefinite",
    total_installments: null,
    paid_installments: 0,
    is_active: true,
    last_paid_month: null,
    last_paid_year: null,
  },
  {
    id: "pay-2",
    name: "Internet casa",
    amount: 95,
    amount_mode: "fixed",
    dueDay: today.getDate(),
    dueDate: null,
    category: "Internet",
    status: "pendiente",
    notes: "",
    recurrence_type: "indefinite",
    total_installments: null,
    paid_installments: 0,
    is_active: true,
    last_paid_month: null,
    last_paid_year: null,
  },
  {
    id: "pay-3",
    name: "Agua",
    amount: 55,
    amount_mode: "fixed",
    dueDay: Math.max(1, today.getDate() - 2),
    dueDate: null,
    category: "Agua",
    status: "pendiente",
    notes: "Puede estar vencido.",
    recurrence_type: "indefinite",
    total_installments: null,
    paid_installments: 0,
    is_active: true,
    last_paid_month: null,
    last_paid_year: null,
  },
];

export const defaultData: AppData = {
  movements: sampleMovements,
  cashCounts: [],
  recurringPayments: samplePayments,
  categories: baseCategories,
  initialBalance: 100,
  financialAccounts: [],
  debts: [],
  debtEvents: [],
  debtScheduleVersions: [],
  debtInstallments: [],
  debtEventInstallmentAllocations: [],
  debtCollaterals: [],
  creditCardProfiles: [],
  creditCardEntries: [],
  creditCardStatements: [],
};

export function loadCachedData(): AppData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isAppDataSnapshot(parsed)) return null;
    return normalizeData(parsed);
  } catch {
    return null;
  }
}

export function loadData(): AppData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const normalized = normalizeData(defaultData);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  try {
    const data = normalizeData({ ...defaultData, ...JSON.parse(raw) });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return data;
  } catch {
    const normalized = normalizeData(defaultData);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }
}

export function saveData(data: AppData): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearLocalAppData() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PREFERRED_PERSON_KEY);
    localStorage.removeItem(OFFLINE_ACCESS_KEY);
    localStorage.removeItem(TRUSTED_SNAPSHOT_KEY);
  } catch {
    // Local cache cleanup must not prevent logout from completing.
  }
}

export function loadOfflineAccessRecord(): OfflineAccessRecord | null {
  try {
    const raw = localStorage.getItem(OFFLINE_ACCESS_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== OFFLINE_CACHE_VERSION) return null;
    if (typeof parsed.householdId !== "string" || !parsed.householdId.trim() || typeof parsed.userId !== "string" || !parsed.userId.trim() || typeof parsed.displayName !== "string" || !parsed.displayName.trim()) return null;
    if (parsed.role !== "owner" && parsed.role !== "member") return null;
    if (typeof parsed.snapshotReady !== "boolean") return null;

    return {
      version: OFFLINE_CACHE_VERSION,
      householdId: parsed.householdId,
      userId: parsed.userId,
      displayName: parsed.displayName,
      role: parsed.role,
      snapshotReady: parsed.snapshotReady,
    };
  } catch {
    return null;
  }
}

export function saveOfflineAccessRecord(member: HouseholdMember) {
  try {
    const previous = loadOfflineAccessRecord();
    const keepsTrustedSnapshot =
      previous?.householdId === member.householdId &&
      previous.userId === member.userId &&
      loadTrustedSnapshot(member.householdId, member.userId) !== null;

    localStorage.setItem(
      OFFLINE_ACCESS_KEY,
      JSON.stringify({
        version: OFFLINE_CACHE_VERSION,
        householdId: member.householdId,
        userId: member.userId,
        displayName: member.displayName,
        role: member.role,
        snapshotReady: keepsTrustedSnapshot,
      } satisfies OfflineAccessRecord)
    );

    if (!keepsTrustedSnapshot) localStorage.removeItem(TRUSTED_SNAPSHOT_KEY);
  } catch {
    // Offline authorization is optional and must not block an online login.
  }
}

export function markTrustedSnapshot(member: HouseholdMember) {
  try {
    const record = loadOfflineAccessRecord();
    if (!record || record.householdId !== member.householdId || record.userId !== member.userId) return;
    if (!loadCachedData()) return;

    localStorage.setItem(
      TRUSTED_SNAPSHOT_KEY,
      JSON.stringify({
        version: OFFLINE_CACHE_VERSION,
        householdId: member.householdId,
        userId: member.userId,
        savedAt: Date.now(),
      } satisfies TrustedSnapshotMetadata)
    );
    localStorage.setItem(OFFLINE_ACCESS_KEY, JSON.stringify({ ...record, snapshotReady: true } satisfies OfflineAccessRecord));
  } catch {
    // A storage failure must not turn a successful remote read into a failed login.
  }
}

export function loadTrustedSnapshot(householdId: string, userId: string): AppData | null {
  const record = loadOfflineAccessRecord();
  if (!record || !record.snapshotReady || record.householdId !== householdId || record.userId !== userId) return null;

  try {
    const raw = localStorage.getItem(TRUSTED_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== OFFLINE_CACHE_VERSION) return null;
    if (parsed.householdId !== householdId || parsed.userId !== userId || !Number.isFinite(Number(parsed.savedAt))) return null;
    return loadCachedData();
  } catch {
    return null;
  }
}

export interface PreferredPerson {
  value: string;
  isCustom: boolean;
}

export function loadPreferredPerson(): PreferredPerson {
  try {
    const stored = localStorage.getItem(PREFERRED_PERSON_KEY)?.trim() ?? "";
    if (stored.startsWith(CUSTOM_PERSON_PREFIX)) {
      return { value: stored.slice(CUSTOM_PERSON_PREFIX.length).trim(), isCustom: true };
    }
    return { value: stored, isCustom: false };
  } catch {
    return { value: "", isCustom: false };
  }
}

export function savePreferredPerson(person: string, isCustom = false) {
  const value = person.trim();
  if (!value) return;
  if (isSupabaseConfigured && typeof navigator !== "undefined" && !navigator.onLine) return;

  try {
    localStorage.setItem(PREFERRED_PERSON_KEY, `${isCustom ? CUSTOM_PERSON_PREFIX : ""}${value}`);
  } catch {
    // The preference is optional and must never block movement registration.
  }
}

export function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function makeUuid() {
  return crypto.randomUUID();
}

export function normalizeData(data: AppDataSnapshotInput): AppData {
  const categories = normalizeCategories(data.categories ?? []);
  const movementCategoryMap: Record<string, string> = { Telefono: "Teléfono", Prestamos: "Préstamos", "TelÃ©fono": "Teléfono", "PrÃ©stamos": "Préstamos" };

  return {
    ...data,
    categories,
    financialAccounts: normalizeFinancialAccounts(data.financialAccounts ?? []),
    debts: normalizeDebts(data.debts ?? []),
    debtEvents: normalizeDebtEvents(data.debtEvents ?? []),
    debtScheduleVersions: normalizeDebtScheduleVersions(data.debtScheduleVersions ?? []),
    debtInstallments: normalizeDebtInstallments(data.debtInstallments ?? []),
    debtEventInstallmentAllocations: normalizeDebtEventInstallmentAllocations(data.debtEventInstallmentAllocations ?? []),
    debtCollaterals: normalizeDebtCollaterals(data.debtCollaterals ?? []),
    creditCardProfiles: normalizeCreditCardProfiles(data.creditCardProfiles ?? []),
    creditCardEntries: normalizeCreditCardEntries(data.creditCardEntries ?? []),
    creditCardStatements: normalizeCreditCardStatements(data.creditCardStatements ?? []),
    movements: data.movements.map((movement) => ({
      ...movement,
      category: movementCategoryMap[movement.category] ?? movement.category,
      accountId: movement.accountId ?? null,
      movementContext:
        movement.movementContext === "debt_service"
          ? "debt_service"
          : movement.movementContext === "credit_card_purchase"
          ? "credit_card_purchase"
          : movement.movementContext === "credit_card_payment"
          ? "credit_card_payment"
          : movement.movementContext === "credit_card_fee"
          ? "credit_card_fee"
          : movement.movementContext === "credit_card_credit"
          ? "credit_card_credit"
          : "standard",
      registeredByUserId: movement.registeredByUserId ?? null,
    })),
    cashCounts: (data.cashCounts ?? []).map((count) => ({
      ...count,
      accountId: count.accountId ?? null,
    })),
    recurringPayments: data.recurringPayments.map((payment) => ({
      ...payment,
      amount: payment.amount == null ? null : Number(payment.amount),
      amount_mode: payment.amount_mode === "variable" ? "variable" : "fixed",
      category: movementCategoryMap[payment.category] ?? payment.category,
      dueDay: payment.dueDay == null ? null : Number(payment.dueDay),
      dueDate: payment.dueDate ?? null,
      recurrence_type: payment.recurrence_type === "fixed" || payment.recurrence_type === "one_time" ? payment.recurrence_type : "indefinite",
      total_installments: payment.total_installments == null ? null : Number(payment.total_installments),
      paid_installments: payment.paid_installments == null ? 0 : Number(payment.paid_installments),
      is_active: payment.is_active ?? true,
      last_paid_month: payment.last_paid_month ?? null,
      last_paid_year: payment.last_paid_year ?? null,
      paidAt: payment.paidAt ?? null,
    })),
  };
}

function normalizeCategories(savedCategories: Category[]) {
  const byName = new Map<string, Category>();
  [...baseCategories, ...savedCategories].forEach((category) => {
    const normalizedName =
      category.name === "Telefono" || category.name === "TelÃ©fono"
        ? "Teléfono"
        : category.name === "Prestamos" || category.name === "PrÃ©stamos"
          ? "Préstamos"
          : category.name;
    const key = normalizeName(normalizedName);
    if (!byName.has(key)) {
      byName.set(key, {
        ...category,
        name: normalizedName,
        type: category.type ?? "ambos",
        is_active: category.is_active ?? true,
        created_at: category.created_at ?? new Date().toISOString(),
      });
    }
  });
  return [...byName.values()];
}

function isAppDataSnapshot(value: unknown): value is AppDataSnapshotInput {
  if (!isRecord(value)) return false;
  if (!Number.isFinite(Number(value.initialBalance))) return false;
  if (!Array.isArray(value.movements) || !Array.isArray(value.cashCounts) || !Array.isArray(value.recurringPayments) || !Array.isArray(value.categories)) return false;

  return (
    value.movements.every((movement) => isRecord(movement) && typeof movement.id === "string" && typeof movement.date === "string" && Number.isFinite(Number(movement.amount))) &&
    value.cashCounts.every((count) => isRecord(count) && typeof count.id === "string" && typeof count.createdAt === "string" && Number.isFinite(Number(count.total))) &&
    value.recurringPayments.every((payment) => isRecord(payment) && typeof payment.id === "string" && typeof payment.name === "string") &&
    value.categories.every((category) => isRecord(category) && typeof category.id === "string" && typeof category.name === "string") &&
    (value.financialAccounts === undefined || (Array.isArray(value.financialAccounts) && value.financialAccounts.every((account) => isRecord(account) && typeof account.id === "string" && typeof account.name === "string"))) &&
    (value.debts === undefined ||
      (Array.isArray(value.debts) &&
        value.debts.every(
          (debt) =>
            isRecord(debt) &&
            typeof debt.id === "string" &&
            debt.id.length > 0 &&
            typeof debt.name === "string" &&
            typeof debt.creditorName === "string" &&
            typeof debt.debtKind === "string" &&
            typeof debt.currencyCode === "string" &&
            debt.currencyCode.length > 0 &&
            typeof debt.trackingStartDate === "string" &&
            isPresentNumeric(debt.openingPrincipalBalance) &&
            typeof debt.installmentAmountMode === "string" &&
            typeof debt.status === "string" &&
            typeof debt.isArchived === "boolean" &&
            typeof debt.createdByUserId === "string" &&
            typeof debt.createdAt === "string" &&
            typeof debt.updatedAt === "string"
        ))) &&
    (value.debtEvents === undefined ||
      (Array.isArray(value.debtEvents) &&
        value.debtEvents.every(
          (event) =>
            isRecord(event) &&
            typeof event.id === "string" &&
            typeof event.debtId === "string" &&
            typeof event.eventDate === "string" &&
            typeof event.eventType === "string" &&
            isPresentNumeric(event.cashAmount) &&
            isPresentNumeric(event.principalDelta) &&
            typeof event.breakdownComplete === "boolean" &&
            typeof event.registeredByUserId === "string" &&
            typeof event.createdAt === "string"
        ))) &&
    (value.debtScheduleVersions === undefined ||
      (Array.isArray(value.debtScheduleVersions) &&
        value.debtScheduleVersions.every(
          (version) =>
            isRecord(version) &&
            typeof version.id === "string" &&
            typeof version.debtId === "string" &&
            isPresentNumeric(version.versionNumber) &&
            typeof version.effectiveDate === "string"
        ))) &&
    (value.debtInstallments === undefined ||
      (Array.isArray(value.debtInstallments) &&
        value.debtInstallments.every(
          (installment) =>
            isRecord(installment) &&
            typeof installment.id === "string" &&
            typeof installment.scheduleVersionId === "string" &&
            typeof installment.debtId === "string" &&
            isPresentNumeric(installment.installmentNumber) &&
            typeof installment.dueDate === "string"
        ))) &&
    (value.debtEventInstallmentAllocations === undefined ||
      (Array.isArray(value.debtEventInstallmentAllocations) &&
        value.debtEventInstallmentAllocations.every(
          (allocation) =>
            isRecord(allocation) &&
            typeof allocation.id === "string" &&
            typeof allocation.eventId === "string" &&
            typeof allocation.installmentId === "string" &&
            typeof allocation.debtId === "string" &&
            isPresentNumeric(allocation.allocatedAmount)
        ))) &&
    (value.debtCollaterals === undefined ||
      (Array.isArray(value.debtCollaterals) &&
        value.debtCollaterals.every(
          (collateral) =>
            isRecord(collateral) &&
            typeof collateral.id === "string" &&
            typeof collateral.debtId === "string" &&
            typeof collateral.description === "string" &&
            typeof collateral.status === "string" &&
            typeof collateral.createdByUserId === "string" &&
            typeof collateral.createdAt === "string" &&
            typeof collateral.updatedAt === "string"
        ))) &&
    (value.creditCardProfiles === undefined ||
      (Array.isArray(value.creditCardProfiles) &&
        value.creditCardProfiles.every(
          (profile) =>
            isRecord(profile) &&
            typeof profile.debtId === "string" &&
            typeof profile.createdByUserId === "string" &&
            typeof profile.createdAt === "string" &&
            typeof profile.updatedAt === "string"
        ))) &&
    (value.creditCardEntries === undefined ||
      (Array.isArray(value.creditCardEntries) &&
        value.creditCardEntries.every(
          (entry) =>
            isRecord(entry) &&
            typeof entry.id === "string" &&
            typeof entry.debtId === "string" &&
            typeof entry.entryDate === "string" &&
            typeof entry.entryType === "string" &&
            isPresentNumeric(entry.liabilityDelta) &&
            typeof entry.registeredByUserId === "string" &&
            typeof entry.createdAt === "string"
        ))) &&
    (value.creditCardStatements === undefined ||
      (Array.isArray(value.creditCardStatements) &&
        value.creditCardStatements.every(
          (statement) =>
            isRecord(statement) &&
            typeof statement.id === "string" &&
            typeof statement.debtId === "string" &&
            typeof statement.statementDate === "string" &&
            typeof statement.dueDate === "string" &&
            isPresentNumeric(statement.statementBalance) &&
            typeof statement.createdByUserId === "string" &&
            typeof statement.createdAt === "string"
        )))
  );
}

function normalizeFinancialAccounts(savedAccounts: FinancialAccount[]): FinancialAccount[] {
  return savedAccounts.map((account, index) => ({
    ...account,
    reconciliationType: account.reconciliationType === "balance" ? "balance" : "cash",
    openingBalance: Number.isFinite(Number(account.openingBalance)) ? Number(account.openingBalance) : 0,
    currencyCode: account.currencyCode ?? "PEN",
    isActive: account.isActive ?? true,
    sortOrder: account.sortOrder ?? index,
    createdAt: account.createdAt ?? new Date().toISOString(),
    updatedAt: account.updatedAt ?? new Date().toISOString(),
  }));
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function isPresentNumeric(value: unknown): value is string | number {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}

function normalizeName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
