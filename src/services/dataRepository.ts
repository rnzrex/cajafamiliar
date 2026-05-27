import { AppData, CashCount, Category, Movement, RecurringPayment } from "../types";
import { defaultData, loadData, normalizeData, saveData } from "../utils/storage";
import { householdId, isSupabaseConfigured, supabase } from "./supabaseClient";

export async function loadAppData(): Promise<AppData> {
  const localData = loadData();
  if (!isSupabaseConfigured || !supabase) return localData;

  try {
    const [settingsResult, movementsResult, categoriesResult, countsResult, paymentsResult] = await Promise.all([
      supabase.from("settings").select("*").eq("household_id", householdId).maybeSingle(),
      supabase.from("movements").select("*").eq("household_id", householdId).order("date", { ascending: false }),
      supabase.from("categories").select("*").eq("household_id", householdId).order("created_at", { ascending: true }),
      supabase.from("cash_counts").select("*").eq("household_id", householdId).order("created_at", { ascending: false }),
      supabase.from("recurring_payments").select("*").eq("household_id", householdId).order("created_at", { ascending: true }),
    ]);

    const hasRemoteData =
      (movementsResult.data?.length ?? 0) > 0 ||
      (categoriesResult.data?.length ?? 0) > 0 ||
      (countsResult.data?.length ?? 0) > 0 ||
      (paymentsResult.data?.length ?? 0) > 0 ||
      Boolean(settingsResult.data);

    if (!hasRemoteData) {
      await saveAppData(localData);
      return localData;
    }

    const remoteData = normalizeData({
      initialBalance: Number(settingsResult.data?.initial_balance ?? defaultData.initialBalance),
      movements: (movementsResult.data ?? []).map(fromMovementRow),
      categories: (categoriesResult.data ?? []).map(fromCategoryRow),
      cashCounts: (countsResult.data ?? []).map(fromCashCountRow),
      recurringPayments: (paymentsResult.data ?? []).map(fromRecurringPaymentRow),
    });

    saveData(remoteData);
    return remoteData;
  } catch (error) {
    console.warn("No se pudo cargar desde Supabase. Usando localStorage.", error);
    return localData;
  }
}

export async function saveAppData(data: AppData) {
  const normalized = normalizeData(data);
  saveData(normalized);
  if (!isSupabaseConfigured || !supabase) return;

  try {
    await supabase.from("households").upsert({ id: householdId, name: "Familia Ruiz Gallardo" });
    await supabase.from("settings").upsert({ household_id: householdId, initial_balance: normalized.initialBalance, updated_at: new Date().toISOString() });

    await syncTable("movements", normalized.movements.map(toMovementRow), normalized.movements.map((item) => item.id));
    await syncTable("categories", normalized.categories.map(toCategoryRow), normalized.categories.map((item) => item.id));
    await syncTable("cash_counts", normalized.cashCounts.map(toCashCountRow), normalized.cashCounts.map((item) => item.id));
    await syncTable(
      "recurring_payments",
      normalized.recurringPayments.map(toRecurringPaymentRow),
      normalized.recurringPayments.map((item) => item.id)
    );
  } catch (error) {
    console.warn("No se pudo guardar en Supabase. Los datos quedaron en localStorage.", error);
  }
}

async function syncTable(table: string, rows: Record<string, unknown>[], ids: string[]) {
  if (!supabase) return;
  if (rows.length > 0) await supabase.from(table).upsert(rows);
  const deleteQuery = supabase.from(table).delete().eq("household_id", householdId);
  if (ids.length > 0) await deleteQuery.not("id", "in", `(${ids.map((id) => `"${id}"`).join(",")})`);
  else await deleteQuery;
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
