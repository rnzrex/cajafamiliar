import { AppData, Category, HouseholdMember, Movement, RecurringPayment, baseCategories } from "../types";
import { localDateString } from "./date";
import { isSupabaseConfigured } from "../services/supabaseClient";

const STORAGE_KEY = "caja-familiar-data";
const PREFERRED_PERSON_KEY = "caja-familiar-preferred-person";
const CUSTOM_PERSON_PREFIX = "custom:";
const OFFLINE_ACCESS_KEY = "caja-familiar-offline-access";
const TRUSTED_SNAPSHOT_KEY = "caja-familiar-trusted-snapshot";
const OFFLINE_CACHE_VERSION = 1 as const;

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

export function saveData(data: AppData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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

export function normalizeData(data: AppData): AppData {
  const categories = normalizeCategories(data.categories ?? []);
  const movementCategoryMap: Record<string, string> = { Telefono: "Teléfono", Prestamos: "Préstamos", "TelÃ©fono": "Teléfono", "PrÃ©stamos": "Préstamos" };

  return {
    ...data,
    categories,
    movements: data.movements.map((movement) => ({
      ...movement,
      category: movementCategoryMap[movement.category] ?? movement.category,
      registeredByUserId: movement.registeredByUserId ?? null,
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

function isAppDataSnapshot(value: unknown): value is AppData {
  if (!isRecord(value)) return false;
  if (!Number.isFinite(Number(value.initialBalance))) return false;
  if (!Array.isArray(value.movements) || !Array.isArray(value.cashCounts) || !Array.isArray(value.recurringPayments) || !Array.isArray(value.categories)) return false;

  return (
    value.movements.every((movement) => isRecord(movement) && typeof movement.id === "string" && typeof movement.date === "string" && Number.isFinite(Number(movement.amount))) &&
    value.cashCounts.every((count) => isRecord(count) && typeof count.id === "string" && typeof count.createdAt === "string" && Number.isFinite(Number(count.total))) &&
    value.recurringPayments.every((payment) => isRecord(payment) && typeof payment.id === "string" && typeof payment.name === "string") &&
    value.categories.every((category) => isRecord(category) && typeof category.id === "string" && typeof category.name === "string")
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function normalizeName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
