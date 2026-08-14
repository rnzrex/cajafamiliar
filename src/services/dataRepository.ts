import { AppData, CashCount, Category, Movement, RecurringPayment } from "../types";
import { defaultData, loadData, normalizeData, saveData } from "../utils/storage";
import { householdId, isSupabaseConfigured, supabase } from "./supabaseClient";

export type AppDataLoadSource = "local" | "remote" | "migrated" | "fallback";

export interface AppDataLoadResult {
  data: AppData;
  source: AppDataLoadSource;
}

export class MovementNotFoundError extends Error {
  constructor() {
    super("El movimiento no existe en Supabase.");
    this.name = "MovementNotFoundError";
  }
}

export async function loadAppData(): Promise<AppDataLoadResult> {
  const localData = loadData();
  if (!isSupabaseConfigured || !supabase) return { data: localData, source: "local" };

  try {
    const [settingsResult, movementsResult, categoriesResult, countsResult, paymentsResult] = await Promise.all([
      supabase.from("settings").select("*").eq("household_id", householdId).maybeSingle(),
      supabase.from("movements").select("*").eq("household_id", householdId).order("date", { ascending: false }),
      supabase.from("categories").select("*").eq("household_id", householdId).order("created_at", { ascending: true }),
      supabase.from("cash_counts").select("*").eq("household_id", householdId).order("created_at", { ascending: false }),
      supabase.from("recurring_payments").select("*").eq("household_id", householdId).order("created_at", { ascending: true }),
    ]);

    const queryError = [settingsResult, movementsResult, categoriesResult, countsResult, paymentsResult].find((result) => result.error)?.error;
    if (queryError) throw queryError;

    const hasRemoteData =
      (movementsResult.data?.length ?? 0) > 0 ||
      (categoriesResult.data?.length ?? 0) > 0 ||
      (countsResult.data?.length ?? 0) > 0 ||
      (paymentsResult.data?.length ?? 0) > 0 ||
      Boolean(settingsResult.data);

    if (!hasRemoteData) {
      await migrateInitialDataToEmptyRemote(localData);
      return { data: localData, source: "migrated" };
    }

    const remoteData = normalizeData({
      initialBalance: Number(settingsResult.data?.initial_balance ?? defaultData.initialBalance),
      movements: (movementsResult.data ?? []).map(fromMovementRow),
      categories: (categoriesResult.data ?? []).map(fromCategoryRow),
      cashCounts: (countsResult.data ?? []).map(fromCashCountRow),
      recurringPayments: (paymentsResult.data ?? []).map(fromRecurringPaymentRow),
    });

    saveData(remoteData);
    return { data: remoteData, source: "remote" };
  } catch (error) {
    console.warn("No se pudo cargar desde Supabase. Usando localStorage.", error);
    return { data: localData, source: "fallback" };
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

export class RecurringPaymentConflictError extends Error {
  constructor() {
    super("El pago recurrente cambió antes de completar la actualización.");
    this.name = "RecurringPaymentConflictError";
  }
}

export async function migrateInitialDataToEmptyRemote(data: AppData) {
  if (!isSupabaseConfigured || !supabase) return;

  const { error: householdError } = await supabase.from("households").upsert({ id: householdId, name: "Familia Ruiz Gallardo" });
  if (householdError) throw householdError;

  const { error: settingsError } = await supabase
    .from("settings")
    .upsert({ household_id: householdId, initial_balance: data.initialBalance, updated_at: new Date().toISOString() });
  if (settingsError) throw settingsError;

  if (data.categories.length > 0) await upsertInitialRows("categories", data.categories.map(toCategoryRow));
  if (data.cashCounts.length > 0) await upsertInitialRows("cash_counts", data.cashCounts.map(toCashCountRow));
  if (data.recurringPayments.length > 0) await upsertInitialRows("recurring_payments", data.recurringPayments.map(toRecurringPaymentRow));
  for (const movement of data.movements) await createMovement(movement);
}

async function upsertInitialRows(table: string, rows: Record<string, unknown>[]) {
  if (!supabase || rows.length === 0) return;
  const { error } = await supabase.from(table).upsert(rows);
  if (error) throw error;
}

export async function createMovement(movement: Movement) {
  if (!isSupabaseConfigured || !supabase) return;

  const { error } = await supabase.from("movements").insert(toMovementRow(movement));
  if (error) throw error;
}

export async function updateMovement(movement: Movement) {
  if (!isSupabaseConfigured || !supabase) return;

  const { data, error } = await supabase
    .from("movements")
    .update(toMovementRow(movement))
    .eq("id", movement.id)
    .eq("household_id", householdId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new MovementNotFoundError();
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

export async function getRecurringPayment(id: string): Promise<RecurringPayment | null> {
  if (!isSupabaseConfigured || !supabase) return null;

  const { data, error } = await supabase
    .from("recurring_payments")
    .select("*")
    .eq("id", id)
    .eq("household_id", householdId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new RecurringPaymentNotFoundError();
  return fromRecurringPaymentRow(data);
}

export async function updateRecurringPaymentDetails(payment: RecurringPayment): Promise<RecurringPayment> {
  if (!isSupabaseConfigured || !supabase) return payment;

  const { data, error } = await supabase
    .from("recurring_payments")
    .update({
      name: payment.name,
      amount: payment.amount,
      due_day: payment.dueDay,
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

export async function updateRecurringPaymentPaymentState(payment: RecurringPayment, expectedPayment: RecurringPayment): Promise<RecurringPayment> {
  if (!isSupabaseConfigured || !supabase) return payment;

  let updateQuery = supabase
    .from("recurring_payments")
    .update({
      status: payment.status,
      paid_at: payment.paidAt ?? null,
      paid_installments: payment.paid_installments,
      last_paid_month: payment.last_paid_month,
      last_paid_year: payment.last_paid_year,
      is_active: payment.is_active,
    })
    .eq("id", payment.id)
    .eq("household_id", householdId)
    .eq("status", expectedPayment.status)
    .eq("paid_installments", expectedPayment.paid_installments)
    .eq("is_active", expectedPayment.is_active);

  updateQuery = expectedPayment.last_paid_month === null ? updateQuery.is("last_paid_month", null) : updateQuery.eq("last_paid_month", expectedPayment.last_paid_month);
  updateQuery = expectedPayment.last_paid_year === null ? updateQuery.is("last_paid_year", null) : updateQuery.eq("last_paid_year", expectedPayment.last_paid_year);
  updateQuery = expectedPayment.paidAt ? updateQuery.eq("paid_at", expectedPayment.paidAt) : updateQuery.is("paid_at", null);

  const { data, error } = await updateQuery.select("*").maybeSingle();
  if (error) throw error;
  if (data) return fromRecurringPaymentRow(data);

  const { data: currentRow, error: currentError } = await supabase
    .from("recurring_payments")
    .select("id")
    .eq("id", payment.id)
    .eq("household_id", householdId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (currentRow) throw new RecurringPaymentConflictError();
  throw new RecurringPaymentNotFoundError();
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

function toMovementRow(movement: Movement) {
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

function toCashCountRow(count: CashCount) {
  return {
    id: count.id,
    household_id: householdId,
    created_at: count.createdAt,
    denominations: count.denominations,
    total: count.total,
    expected: count.expected,
    difference: count.difference,
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
  };
}

function toRecurringPaymentRow(payment: RecurringPayment) {
  return {
    id: payment.id,
    household_id: householdId,
    name: payment.name,
    amount: payment.amount,
    due_day: payment.dueDay,
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

function fromRecurringPaymentRow(row: Record<string, any>): RecurringPayment {
  return {
    id: row.id,
    name: row.name,
    amount: Number(row.amount),
    dueDay: Number(row.due_day),
    category: row.category,
    status: row.status,
    notes: row.notes ?? "",
    recurrence_type: row.recurrence_type,
    total_installments: row.total_installments,
    paid_installments: Number(row.paid_installments ?? 0),
    is_active: Boolean(row.is_active),
    last_paid_month: row.last_paid_month,
    last_paid_year: row.last_paid_year,
    paidAt: row.paid_at,
  };
}
