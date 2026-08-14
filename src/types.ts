export type MovementType = "ingreso" | "egreso";
export type PaymentMethod = "efectivo" | "Yape" | "transferencia" | "tarjeta";
export type RecurringStatus = "pendiente" | "pagado";
export type RecurrenceType = "indefinite" | "fixed" | "one_time";
export type PaymentAmountMode = "fixed" | "variable";
export type CategoryType = MovementType | "ambos";

export interface HouseholdMember {
  householdId: string;
  userId: string;
  displayName: string;
  role: "owner" | "member";
}

export interface Movement {
  id: string;
  type: MovementType;
  date: string;
  amount: number;
  description: string;
  method: PaymentMethod;
  category: string;
  person: string;
  registeredByUserId?: string | null;
  createdAt?: string;
}

export type MovementFormInput = Omit<Movement, "id" | "person" | "registeredByUserId"> & { person?: string };
export type MovementDraft = Partial<Omit<Movement, "id">>;

export interface CashCount {
  id: string;
  createdAt: string;
  denominations: Record<string, number>;
  total: number;
  expected: number;
  difference: number;
}

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  color?: string;
  icon?: string;
  is_active: boolean;
  created_at: string;
}

export interface RecurringPayment {
  id: string;
  name: string;
  amount: number | null;
  amount_mode: PaymentAmountMode;
  dueDay: number | null;
  dueDate: string | null;
  category: string;
  status: RecurringStatus;
  notes: string;
  recurrence_type: RecurrenceType;
  total_installments: number | null;
  paid_installments: number;
  is_active: boolean;
  last_paid_month: number | null;
  last_paid_year: number | null;
  paidAt?: string | null;
}

export interface AppData {
  movements: Movement[];
  cashCounts: CashCount[];
  recurringPayments: RecurringPayment[];
  categories: Category[];
  initialBalance: number;
}

export const baseCategories: Category[] = [
  { id: "cat-comida-cenas", name: "Comida / cenas", type: "egreso", color: "#ef4444", icon: "utensils", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-mercado", name: "Mercado", type: "egreso", color: "#22c55e", icon: "shopping-basket", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-luz", name: "Luz", type: "egreso", color: "#f59e0b", icon: "lightbulb", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-agua", name: "Agua", type: "egreso", color: "#0ea5e9", icon: "droplet", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-telefono", name: "Teléfono", type: "egreso", color: "#6366f1", icon: "phone", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-internet", name: "Internet", type: "egreso", color: "#2563eb", icon: "wifi", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-prestamos", name: "Préstamos", type: "egreso", color: "#7c3aed", icon: "landmark", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-transporte", name: "Transporte", type: "egreso", color: "#f97316", icon: "car", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-salud", name: "Salud", type: "egreso", color: "#14b8a6", icon: "heart-pulse", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-ocio", name: "Ocio", type: "egreso", color: "#db2777", icon: "party-popper", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-cigarrillos", name: "Cigarrillos", type: "egreso", color: "#64748b", icon: "circle", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-compras-personales", name: "Compras personales", type: "egreso", color: "#a855f7", icon: "shopping-bag", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-casa", name: "Casa", type: "egreso", color: "#0891b2", icon: "home", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-negocio", name: "Negocio", type: "ambos", color: "#16a34a", icon: "briefcase", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-otros", name: "Otros", type: "ambos", color: "#94a3b8", icon: "more-horizontal", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
];

export const paymentMethods: PaymentMethod[] = ["efectivo", "Yape", "transferencia", "tarjeta"];
