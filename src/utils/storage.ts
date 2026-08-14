import { AppData, Category, Movement, RecurringPayment, baseCategories } from "../types";
import { localDateString } from "./date";

const STORAGE_KEY = "caja-familiar-data";
const PREFERRED_PERSON_KEY = "caja-familiar-preferred-person";
const CUSTOM_PERSON_PREFIX = "custom:";

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
  } catch {
    // Local cache cleanup must not prevent logout from completing.
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

function normalizeName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
