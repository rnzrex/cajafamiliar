import { AppData, CashCount, Category, FinancialAccount, HouseholdMember, Movement, RecurringPayment } from "../types";
import { loadData, loadTrustedSnapshot, markTrustedSnapshot, normalizeData, saveData } from "../utils/storage";
import { householdId, isSupabaseConfigured, supabase } from "./supabaseClient";

export type AppDataLoadSource = "local" | "remote" | "fallback";

export interface AppDataLoadResult {
  data: AppData;
  source: AppDataLoadSource;
}

export class HouseholdNotProvisionedError extends Error {
  constructor() {
    super("El household no está provisionado en Supabase.");
    this.name = "HouseholdNotProvisionedError";
  }
}

export class TrustedOfflineSnapshotUnavailableError extends Error {
  constructor() {
    super("No existe una copia verificada de Caja Familiar para usar sin conexión.");
    this.name = "TrustedOfflineSnapshotUnavailableError";
  }
}

export class MovementNotFoundError extends Error {
  constructor() {
    super("El movimiento no existe en Supabase.");
    this.name = "MovementNotFoundError";
  }
}

export async function loadAppData(member?: HouseholdMember): Promise<AppDataLoadResult> {
  if (!isSupabaseConfigured || !supabase) return { data: loadData(), source: "local" };
  if (!member || member.householdId !== householdId) throw new TrustedOfflineSnapshotUnavailableError();

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const trustedSnapshot = loadTrustedSnapshot(member.householdId, member.userId);
    if (trustedSnapshot) return { data: trustedSnapshot, source: "fallback" };
    throw new TrustedOfflineSnapshotUnavailableError();
  }

  try {
    const [settingsResult, movementsResult, categoriesResult, countsResult, paymentsResult, accountsResult] = await Promise.all([
      supabase.from("settings").select("*").eq("household_id", householdId).maybeSingle(),
      supabase.from("movements").select("*").eq("household_id", householdId).order("date", { ascending: false }),
      supabase.from("categories").select("*").eq("household_id", householdId).order("created_at", { ascending: true }),
      supabase.from("cash_counts").select("*").eq("household_id", householdId).order("created_at", { ascending: false }),
      supabase.from("recurring_payments").select("*").eq("household_id", householdId).order("created_at", { ascending: true }),
      supabase.from("financial_accounts").select("*").eq("household_id", householdId).order("sort_order", { ascending: true }),
    ]);

    const queryError = [settingsResult, movementsResult, categoriesResult, countsResult, paymentsResult, accountsResult].find((result) => result.error)?.error;
    if (queryError) throw queryError;

    const hasRemoteData =
      (movementsResult.data?.length ?? 0) > 0 ||
      (categoriesResult.data?.length ?? 0) > 0 ||
      (countsResult.data?.length ?? 0) > 0 ||
      (paymentsResult.data?.length ?? 0) > 0 ||
      (accountsResult.data?.length ?? 0) > 0 ||
      Boolean(settingsResult.data);

    if (!hasRemoteData) throw new HouseholdNotProvisionedError();

    const remoteData = normalizeData({
      initialBalance: Number(settingsResult.data?.initial_balance ?? 0),
      movements: (movementsResult.data ?? []).map(fromMovementRow),
      categories: (categoriesResult.data ?? []).map(fromCategoryRow),
      cashCounts: (countsResult.data ?? []).map(fromCashCountRow),
      recurringPayments: (paymentsResult.data ?? []).map(fromRecurringPaymentRow),
      financialAccounts: (accountsResult.data ?? []).map(fromFinancialAccountRow),
    });

    saveData(remoteData);
    markTrustedSnapshot(member);
    return { data: remoteData, source: "remote" };
  } catch (error) {
    if (error instanceof HouseholdNotProvisionedError) throw error;
    const trustedSnapshot = loadTrustedSnapshot(member.householdId, member.userId);
    if (trustedSnapshot) {
      console.warn("No se pudo cargar desde Supabase. Usando el snapshot confiable local.", error);
      return { data: trustedSnapshot, source: "fallback" };
    }
    throw new TrustedOfflineSnapshotUnavailableError();
  }
}

export class CategoryNotFoundError extends Error {
  constructor() {
    super("La categoría no existe en Supabase.");
    this.name = "CategoryNotFoundError";
  }
}

export class RecurringPaymentNotFoundError extends Error {
  constructor() {
    super("El pago recurrente no existe en Supabase.");
    this.name = "RecurringPaymentNotFoundError";
  }
}

export class RecurringPaymentAuthenticationError extends Error {
  constructor() {
    super("Se necesita una sesión autenticada para completar el pago recurrente.");
    this.name = "RecurringPaymentAuthenticationError";
  }
}

export class HouseholdMemberNotProvisionedError extends Error {
  constructor() {
    super("El usuario no tiene un miembro del hogar provisionado.");
    this.name = "HouseholdMemberNotProvisionedError";
  }
}

export class RecurringPaymentAlreadyPaidError extends Error {
  constructor() {
    super("El pago recurrente ya fue completado y no se creó un segundo gasto.");
    this.name = "RecurringPaymentAlreadyPaidError";
  }
}

export class RecurringPaymentInactiveError extends Error {
  constructor() {
    super("El pago recurrente está inactivo.");
    this.name = "RecurringPaymentInactiveError";
  }
}

export class InvalidMovementError extends Error {
  constructor() {
    super("Los datos del gasto no son válidos.");
    this.name = "InvalidMovementError";
  }
}

export class FinancialAccountNotAvailableError extends Error {
  constructor() {
    super("La cuenta seleccionada ya no está disponible para registrar el gasto.");
    this.name = "FinancialAccountNotAvailableError";
  }
}

export class FinancialAccountMethodMismatchError extends Error {
  constructor() {
    super("El método de pago no es coherente con el tipo de la cuenta seleccionada.");
    this.name = "FinancialAccountMethodMismatchError";
  }
}

export class FinancialAccountNotFoundError extends Error {
  constructor() {
    super("La cuenta no existe en Supabase.");
    this.name = "FinancialAccountNotFoundError";
  }
}

export class FinancialAccountProtectedError extends Error {
  constructor() {
    super("La cuenta de Efectivo no se puede modificar ni archivar.");
    this.name = "FinancialAccountProtectedError";
  }
}

export async function createMovement(movement: Movement): Promise<Movement> {
  if (!isSupabaseConfigured || !supabase) return movement;

  const { data, error } = await supabase.from("movements").insert(toMovementRow(movement)).select("*").single();
  if (error) throw error;
  return fromMovementRow(data);
}

export async function createMovementIdempotent(movement: Movement): Promise<Movement> {
  if (!isSupabaseConfigured || !supabase) return movement;

  const { data, error } = await supabase.from("movements").insert(toMovementRow(movement)).select("*").maybeSingle();
  if (!error) {
    if (!data) throw new Error("Supabase no devolvió el movimiento creado.");
    return fromMovementRow(data);
  }

  if (error.code !== "23505") throw error;

  const { data: existingMovement, error: lookupError } = await supabase
    .from("movements")
    .select("*")
    .eq("id", movement.id)
    .eq("household_id", householdId)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (!existingMovement) throw error;
  return fromMovementRow(existingMovement);
}

export async function updateMovement(movement: Movement): Promise<Movement> {
  if (!isSupabaseConfigured || !supabase) return movement;

  const { data, error } = await supabase
    .from("movements")
    .update({
      type: movement.type,
      date: movement.date,
      amount: movement.amount,
      description: movement.description,
      method: movement.method,
      category: movement.category,
      account_id: movement.accountId ?? null,
    })
    .eq("id", movement.id)
    .eq("household_id", householdId)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new MovementNotFoundError();
  return fromMovementRow(data);
}

export async function deleteMovement(id: string) {
  if (!isSupabaseConfigured || !supabase) return;

  const { error } = await supabase.from("movements").delete().eq("id", id).eq("household_id", householdId).select("id");
  if (error) throw error;
}

export async function createCategory(category: Category): Promise<Category> {
  if (!isSupabaseConfigured || !supabase) return category;

  const { data, error } = await supabase.from("categories").insert(toCategoryRow(category)).select("*").single();
  if (error) throw error;
  return fromCategoryRow(data);
}

export async function updateCategoryDetails(category: Category): Promise<Category> {
  if (!isSupabaseConfigured || !supabase) return category;

  const { data, error } = await supabase
    .from("categories")
    .update({ name: category.name, type: category.type, color: category.color, icon: category.icon })
    .eq("id", category.id)
    .eq("household_id", householdId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new CategoryNotFoundError();
  return fromCategoryRow(data);
}

export async function setCategoryActive(category: Category, isActive: boolean): Promise<Category> {
  if (!isSupabaseConfigured || !supabase) return { ...category, is_active: isActive };

  const { data, error } = await supabase
    .from("categories")
    .update({ is_active: isActive })
    .eq("id", category.id)
    .eq("household_id", householdId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new CategoryNotFoundError();
  return fromCategoryRow(data);
}

export async function deleteCategory(id: string) {
  if (!isSupabaseConfigured || !supabase) return;

  const { error } = await supabase.from("categories").delete().eq("id", id).eq("household_id", householdId).select("id");
  if (error) throw error;
}

export async function createCashCount(count: CashCount): Promise<CashCount> {
  if (!isSupabaseConfigured || !supabase) return count;

  const { data, error } = await supabase.from("cash_counts").insert(toCashCountRow(count)).select("*").single();
  if (error) throw error;
  return fromCashCountRow(data);
}

export async function createRecurringPayment(payment: RecurringPayment): Promise<RecurringPayment> {
  if (!isSupabaseConfigured || !supabase) return payment;

  const { data, error } = await supabase.from("recurring_payments").insert(toRecurringPaymentRow(payment)).select("*").single();
  if (error) throw error;
  return fromRecurringPaymentRow(data);
}

export interface CompleteRecurringPaymentResult {
  payment: RecurringPayment;
  movement: Movement | null;
}

export async function completeRecurringPayment(payment: RecurringPayment, movement: Movement | null): Promise<CompleteRecurringPaymentResult | null> {
  if (!isSupabaseConfigured || !supabase) return null;

  const { data, error } = await supabase.rpc("complete_recurring_payment_v2", {
    p_payment_id: payment.id,
    p_create_expense: movement !== null,
    p_movement_id: movement?.id ?? null,
    p_movement_date: movement?.date ?? null,
    p_movement_amount: movement?.amount ?? null,
    p_movement_description: movement?.description ?? null,
    p_movement_method: movement?.method ?? null,
    p_movement_category: movement?.category ?? null,
    p_account_id: movement?.accountId ?? null,
  });

  if (error) {
    throw mapCompleteRecurringPaymentError(error.message) ?? error;
  }

  if (!data?.payment) throw new Error("La RPC no devolvió el pago recurrente.");

  return {
    payment: fromRecurringPaymentRow(data.payment),
    movement: data.movement ? fromMovementRow(data.movement) : null,
  };
}

export async function updateRecurringPaymentDetails(payment: RecurringPayment): Promise<RecurringPayment> {
  if (!isSupabaseConfigured || !supabase) return payment;

  const { data, error } = await supabase
    .from("recurring_payments")
    .update({
      name: payment.name,
      amount: payment.amount,
      amount_mode: payment.amount_mode,
      due_day: payment.dueDay,
      due_date: payment.dueDate,
      category: payment.category,
      notes: payment.notes,
      recurrence_type: payment.recurrence_type,
      total_installments: payment.total_installments,
    })
    .eq("id", payment.id)
    .eq("household_id", householdId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new RecurringPaymentNotFoundError();
  return fromRecurringPaymentRow(data);
}

export async function setRecurringPaymentActive(payment: RecurringPayment, isActive: boolean): Promise<RecurringPayment> {
  if (!isSupabaseConfigured || !supabase) return { ...payment, is_active: isActive };

  const { data, error } = await supabase
    .from("recurring_payments")
    .update({ is_active: isActive })
    .eq("id", payment.id)
    .eq("household_id", householdId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new RecurringPaymentNotFoundError();
  return fromRecurringPaymentRow(data);
}

export async function updateInitialBalance(value: number): Promise<number> {
  if (!isSupabaseConfigured || !supabase) return value;

  const { data, error } = await supabase
    .from("settings")
    .upsert({ household_id: householdId, initial_balance: value, updated_at: new Date().toISOString() })
    .select("*")
    .single();
  if (error) throw error;
  return Number(data.initial_balance);
}

export async function createFinancialAccount(account: FinancialAccount): Promise<FinancialAccount> {
  if (!isSupabaseConfigured || !supabase) return account;

  const balanceAccount: FinancialAccount = { ...account, reconciliationType: "balance" };
  const { data, error } = await supabase.from("financial_accounts").insert(toFinancialAccountRow(balanceAccount)).select("*").single();
  if (error) throw error;
  return fromFinancialAccountRow(data);
}

export async function updateFinancialAccountDetails(account: FinancialAccount): Promise<FinancialAccount> {
  if (!isSupabaseConfigured || !supabase) return account;
  if (account.reconciliationType === "cash") throw new FinancialAccountProtectedError();

  const { data, error } = await supabase
    .from("financial_accounts")
    .update({
      name: account.name,
      opening_balance: account.openingBalance,
      sort_order: account.sortOrder,
    })
    .eq("id", account.id)
    .eq("household_id", householdId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new FinancialAccountNotFoundError();
  return fromFinancialAccountRow(data);
}

export async function setFinancialAccountActive(account: FinancialAccount, isActive: boolean): Promise<FinancialAccount> {
  if (!isSupabaseConfigured || !supabase) return { ...account, isActive };
  if (!isActive && account.reconciliationType === "cash") throw new FinancialAccountProtectedError();

  const { data, error } = await supabase
    .from("financial_accounts")
    .update({ is_active: isActive })
    .eq("id", account.id)
    .eq("household_id", householdId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new FinancialAccountNotFoundError();
  return fromFinancialAccountRow(data);
}

function mapCompleteRecurringPaymentError(message: string) {
  switch (message) {
    case "AUTH_REQUIRED":
      return new RecurringPaymentAuthenticationError();
    case "PAYMENT_NOT_FOUND":
      return new RecurringPaymentNotFoundError();
    case "PAYMENT_ALREADY_PAID":
      return new RecurringPaymentAlreadyPaidError();
    case "PAYMENT_INACTIVE":
      return new RecurringPaymentInactiveError();
    case "MEMBER_NOT_PROVISIONED":
      return new HouseholdMemberNotProvisionedError();
    case "INVALID_MOVEMENT":
      return new InvalidMovementError();
    case "ACCOUNT_NOT_AVAILABLE":
      return new FinancialAccountNotAvailableError();
    case "ACCOUNT_METHOD_MISMATCH":
      return new FinancialAccountMethodMismatchError();
    default:
      return null;
  }
}

export function toMovementRow(movement: Movement) {
  return {
    id: movement.id,
    household_id: householdId,
    type: movement.type,
    date: movement.date,
    amount: movement.amount,
    description: movement.description,
    method: movement.method,
    category: movement.category,
    person: movement.person,
    registered_by_user_id: movement.registeredByUserId ?? null,
    account_id: movement.accountId ?? null,
    created_at: movement.createdAt ?? new Date().toISOString(),
  };
}

function fromMovementRow(row: Record<string, any>): Movement {
  return {
    id: row.id,
    type: row.type,
    date: row.date,
    amount: Number(row.amount),
    description: row.description,
    method: row.method,
    category: row.category,
    person: row.person,
    registeredByUserId: row.registered_by_user_id ?? null,
    accountId: row.account_id ?? null,
    createdAt: row.created_at,
  };
}

function toCategoryRow(category: Category) {
  return {
    id: category.id,
    household_id: householdId,
    name: category.name,
    type: category.type,
    color: category.color,
    icon: category.icon,
    is_active: category.is_active,
    created_at: category.created_at,
  };
}

function fromCategoryRow(row: Record<string, any>): Category {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    color: row.color,
    icon: row.icon,
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
  };
}

export function toCashCountRow(count: CashCount) {
  return {
    id: count.id,
    household_id: householdId,
    created_at: count.createdAt,
    denominations: count.denominations,
    total: count.total,
    expected: count.expected,
    difference: count.difference,
    account_id: count.accountId ?? null,
  };
}

function fromCashCountRow(row: Record<string, any>): CashCount {
  return {
    id: row.id,
    createdAt: row.created_at,
    denominations: row.denominations ?? {},
    total: Number(row.total),
    expected: Number(row.expected),
    difference: Number(row.difference),
    accountId: row.account_id ?? null,
  };
}

function fromFinancialAccountRow(row: Record<string, any>): FinancialAccount {
  return {
    id: row.id,
    name: row.name,
    reconciliationType: row.reconciliation_type === "balance" ? "balance" : "cash",
    openingBalance: Number(row.opening_balance ?? 0),
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toFinancialAccountRow(account: FinancialAccount) {
  return {
    id: account.id,
    household_id: householdId,
    name: account.name,
    reconciliation_type: account.reconciliationType,
    opening_balance: account.openingBalance,
    is_active: account.isActive,
    sort_order: account.sortOrder,
    created_at: account.createdAt,
    updated_at: account.updatedAt,
  };
}

function toRecurringPaymentRow(payment: RecurringPayment) {
  return {
    id: payment.id,
    household_id: householdId,
    name: payment.name,
    amount: payment.amount,
    amount_mode: payment.amount_mode,
    due_day: payment.dueDay,
    due_date: payment.dueDate,
    category: payment.category,
    status: payment.status,
    notes: payment.notes,
    recurrence_type: payment.recurrence_type,
    total_installments: payment.total_installments,
    paid_installments: payment.paid_installments,
    is_active: payment.is_active,
    last_paid_month: payment.last_paid_month,
    last_paid_year: payment.last_paid_year,
    paid_at: payment.paidAt,
  };
}

function fromRecurringPaymentRow(row: RecurringPaymentRow): RecurringPayment {
  return {
    id: row.id,
    name: row.name,
    amount: row.amount == null ? null : Number(row.amount),
    amount_mode: row.amount_mode === "variable" ? "variable" : "fixed",
    dueDay: row.due_day == null ? null : Number(row.due_day),
    dueDate: row.due_date ?? null,
    category: row.category,
    status: row.status === "pagado" ? "pagado" : "pendiente",
    notes: row.notes ?? "",
    recurrence_type: row.recurrence_type === "fixed" || row.recurrence_type === "one_time" ? row.recurrence_type : "indefinite",
    total_installments: row.total_installments == null ? null : Number(row.total_installments),
    paid_installments: row.paid_installments == null ? 0 : Number(row.paid_installments),
    is_active: Boolean(row.is_active),
    last_paid_month: row.last_paid_month == null ? null : Number(row.last_paid_month),
    last_paid_year: row.last_paid_year == null ? null : Number(row.last_paid_year),
    paidAt: row.paid_at ?? null,
  };
}

interface RecurringPaymentRow {
  id: string;
  name: string;
  amount: number | string | null;
  amount_mode?: string | null;
  due_day: number | string | null;
  due_date: string | null;
  category: string;
  status: string;
  notes?: string | null;
  recurrence_type: string;
  total_installments: number | string | null;
  paid_installments: number | string | null;
  is_active: boolean;
  last_paid_month: number | string | null;
  last_paid_year: number | string | null;
  paid_at: string | null;
}
