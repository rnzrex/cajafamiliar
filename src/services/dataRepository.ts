import { AppData, CashCount, Category, Debt, DebtAllocationInput, DebtCollateral, DebtEvent, DebtEventInstallmentAllocation, DebtInstallment, DebtPaymentInput, DebtPayoffInput, DebtPrepaymentInput, DebtReversalInput, DebtScheduleInstallmentInput, DebtScheduleVersion, FinancialAccount, HouseholdMember, Movement, RecurringPayment } from "../types";
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

export class DebtMovementProtectedError extends Error {
  constructor() {
    super("Este movimiento está ligado a una deuda y solo puede corregirse desde el dominio de deudas.");
    this.name = "DebtMovementProtectedError";
  }
}

export class MovementContextImmutableError extends Error {
  constructor() {
    super("El contexto financiero del movimiento no puede cambiarse.");
    this.name = "MovementContextImmutableError";
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
    const [
      settingsResult,
      movementsResult,
      categoriesResult,
      countsResult,
      paymentsResult,
      accountsResult,
      debtsResult,
      debtEventsResult,
      debtScheduleVersionsResult,
      debtInstallmentsResult,
      debtAllocationsResult,
      debtCollateralsResult,
    ] = await Promise.all([
      supabase.from("settings").select("*").eq("household_id", householdId).maybeSingle(),
      supabase.from("movements").select("*").eq("household_id", householdId).order("date", { ascending: false }),
      supabase.from("categories").select("*").eq("household_id", householdId).order("created_at", { ascending: true }),
      supabase.from("cash_counts").select("*").eq("household_id", householdId).order("created_at", { ascending: false }),
      supabase.from("recurring_payments").select("*").eq("household_id", householdId).order("created_at", { ascending: true }),
      supabase.from("financial_accounts").select("*").eq("household_id", householdId).order("sort_order", { ascending: true }),
      supabase.from("debts").select("*").eq("household_id", householdId).order("created_at", { ascending: true }),
      supabase.from("debt_events").select("*").eq("household_id", householdId).order("event_date", { ascending: true }).order("created_at", { ascending: true }),
      supabase.from("debt_schedule_versions").select("*").eq("household_id", householdId).order("version_number", { ascending: true }),
      supabase.from("debt_installments").select("*").eq("household_id", householdId).order("due_date", { ascending: true }).order("installment_number", { ascending: true }),
      supabase.from("debt_event_installment_allocations").select("*").eq("household_id", householdId).order("created_at", { ascending: true }),
      supabase.from("debt_collaterals").select("*").eq("household_id", householdId).order("created_at", { ascending: true }),
    ]);

    const queryError = [
      settingsResult,
      movementsResult,
      categoriesResult,
      countsResult,
      paymentsResult,
      accountsResult,
      debtsResult,
      debtEventsResult,
      debtScheduleVersionsResult,
      debtInstallmentsResult,
      debtAllocationsResult,
      debtCollateralsResult,
    ].find((result) => result.error)?.error;
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
      debts: (debtsResult.data ?? []).map(fromDebtRow),
      debtEvents: (debtEventsResult.data ?? []).map(fromDebtEventRow),
      debtScheduleVersions: (debtScheduleVersionsResult.data ?? []).map(fromDebtScheduleVersionRow),
      debtInstallments: (debtInstallmentsResult.data ?? []).map(fromDebtInstallmentRow),
      debtEventInstallmentAllocations: (debtAllocationsResult.data ?? []).map(fromDebtEventInstallmentAllocationRow),
      debtCollaterals: (debtCollateralsResult.data ?? []).map(fromDebtCollateralRow),
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
  if (error) throw mapMovementWriteError(error) ?? error;
  return fromMovementRow(data);
}

export async function createMovementIdempotent(movement: Movement): Promise<Movement> {
  if (!isSupabaseConfigured || !supabase) return movement;

  const { data, error } = await supabase.from("movements").insert(toMovementRow(movement)).select("*").maybeSingle();
  if (!error) {
    if (!data) throw new Error("Supabase no devolvió el movimiento creado.");
    return fromMovementRow(data);
  }

  if (error.code !== "23505") throw mapMovementWriteError(error) ?? error;

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

  if (error) throw mapMovementWriteError(error) ?? error;
  if (!data) throw new MovementNotFoundError();
  return fromMovementRow(data);
}

export async function deleteMovement(id: string) {
  if (!isSupabaseConfigured || !supabase) return;

  const { error } = await supabase.from("movements").delete().eq("id", id).eq("household_id", householdId).select("id");
  if (error) throw mapMovementWriteError(error) ?? error;
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

export type DebtOperationErrorCode =
  | "AUTH_REQUIRED"
  | "HOUSEHOLD_ACCESS_DENIED"
  | "DEBT_NOT_FOUND"
  | "DEBT_ARCHIVED"
  | "DEBT_NOT_ACTIVE"
  | "DEBT_ALREADY_PAID_OFF"
  | "DEBT_PRINCIPAL_EXCEEDED"
  | "DEBT_PREPAYMENT_WOULD_PAY_OFF"
  | "INVALID_DEBT_PAYMENT"
  | "INVALID_DEBT_PREPAYMENT"
  | "INVALID_DEBT_PAYOFF"
  | "INVALID_DEBT_REVERSAL"
  | "INVALID_DEBT_SCHEDULE"
  | "INVALID_DEBT_ALLOCATIONS"
  | "DEBT_EVENT_ID_CONFLICT"
  | "DEBT_EVENT_NOT_FOUND"
  | "DEBT_EVENT_TYPE_UNSUPPORTED"
  | "DEBT_EVENT_ALREADY_REVERSED"
  | "DEBT_REVERSAL_SCHEDULE_REQUIRED"
  | "DEBT_REVERSAL_SCHEDULE_NOT_ALLOWED"
  | "DEBT_MOVEMENT_CONFLICT"
  | "DEBT_MOVEMENT_ALREADY_LINKED"
  | "DEBT_MOVEMENT_NOT_FOUND"
  | "DEBT_MOVEMENT_MUST_BE_EXPENSE"
  | "DEBT_MOVEMENT_AMOUNT_MISMATCH"
  | "DEBT_MOVEMENT_DATE_MISMATCH"
  | "DEBT_MOVEMENT_CONTEXT_REQUIRED"
  | "DEBT_MOVEMENT_ACCOUNT_REQUIRED"
  | "DEBT_MOVEMENT_ACCOUNT_NOT_FOUND"
  | "DEBT_MOVEMENT_ACCOUNT_METHOD_MISMATCH"
  | "ACCOUNT_NOT_AVAILABLE"
  | "DEBT_SERVICE_MOVEMENT_RPC_ONLY";

export class DebtOperationError extends Error {
  constructor(readonly code: DebtOperationErrorCode) {
    super(code);
    this.name = "DebtOperationError";
  }
}

export class DebtOperationUnavailableError extends Error {
  constructor() {
    super("Las operaciones Debt requieren una conexión online a Supabase.");
    this.name = "DebtOperationUnavailableError";
  }
}

export interface DebtFundOperationResult {
  idempotentReplay: boolean;
  debt: Debt;
  movement: Movement;
  event: DebtEvent;
  allocations: DebtEventInstallmentAllocation[];
  scheduleVersion: DebtScheduleVersion | null;
  installments: DebtInstallment[];
}

export interface DebtReversalResult {
  idempotentReplay: boolean;
  debt: Debt;
  event: DebtEvent;
  scheduleVersion: DebtScheduleVersion | null;
  installments: DebtInstallment[];
}

export function toDebtPaymentRpcArgs(input: DebtPaymentInput) {
  return {
    p_household_id: householdId,
    p_debt_id: input.debtId,
    p_event_id: input.eventId,
    p_movement_id: input.movementId,
    p_event_date: input.eventDate,
    p_cash_amount: input.cashAmount,
    p_account_id: input.accountId,
    p_description: input.description,
    p_category: input.category,
    p_principal_amount: input.principalAmount,
    p_interest_paid: input.interestPaid,
    p_fees_paid: input.feesPaid,
    p_insurance_paid: input.insurancePaid,
    p_other_cost_paid: input.otherCostPaid,
    p_breakdown_complete: input.breakdownComplete,
    p_allocations: input.allocations.map(toDebtAllocationRow),
  };
}

export function toDebtPrepaymentRpcArgs(input: DebtPrepaymentInput) {
  return {
    p_household_id: householdId,
    p_debt_id: input.debtId,
    p_event_id: input.eventId,
    p_movement_id: input.movementId,
    p_event_date: input.eventDate,
    p_cash_amount: input.cashAmount,
    p_account_id: input.accountId,
    p_description: input.description,
    p_category: input.category,
    p_principal_amount: input.principalAmount,
    p_interest_paid: input.interestPaid,
    p_fees_paid: input.feesPaid,
    p_insurance_paid: input.insurancePaid,
    p_other_cost_paid: input.otherCostPaid,
    p_breakdown_complete: input.breakdownComplete,
    p_schedule_installments: input.scheduleInstallments.map(toDebtScheduleInstallmentRow),
    p_schedule_notes: input.scheduleNotes ?? null,
  };
}

export function toDebtPayoffRpcArgs(input: DebtPayoffInput) {
  return {
    p_household_id: householdId,
    p_debt_id: input.debtId,
    p_event_id: input.eventId,
    p_movement_id: input.movementId,
    p_event_date: input.eventDate,
    p_cash_amount: input.cashAmount,
    p_account_id: input.accountId,
    p_description: input.description,
    p_category: input.category,
    p_interest_paid: input.interestPaid,
    p_fees_paid: input.feesPaid,
    p_insurance_paid: input.insurancePaid,
    p_other_cost_paid: input.otherCostPaid,
    p_breakdown_complete: input.breakdownComplete,
  };
}

export function toDebtReversalRpcArgs(input: DebtReversalInput) {
  return {
    p_household_id: householdId,
    p_debt_id: input.debtId,
    p_reversal_event_id: input.reversalEventId,
    p_target_event_id: input.targetEventId,
    p_event_date: input.eventDate,
    p_description: input.description,
    p_schedule_installments: input.scheduleInstallments.map(toDebtScheduleInstallmentRow),
    p_schedule_notes: input.scheduleNotes ?? null,
  };
}

export async function recordDebtPayment(input: DebtPaymentInput): Promise<DebtFundOperationResult> {
  return callDebtOperation("record_debt_payment_v1", toDebtPaymentRpcArgs(input), fromDebtFundOperationResult);
}

export async function recordDebtPrepayment(input: DebtPrepaymentInput): Promise<DebtFundOperationResult> {
  return callDebtOperation("record_debt_prepayment_v1", toDebtPrepaymentRpcArgs(input), fromDebtFundOperationResult);
}

export async function recordDebtPayoff(input: DebtPayoffInput): Promise<DebtFundOperationResult> {
  return callDebtOperation("record_debt_payoff_v1", toDebtPayoffRpcArgs(input), fromDebtFundOperationResult);
}

export async function reverseDebtEvent(input: DebtReversalInput): Promise<DebtReversalResult> {
  return callDebtOperation("reverse_debt_event_v1", toDebtReversalRpcArgs(input), fromDebtReversalResult);
}

function toDebtAllocationRow(input: DebtAllocationInput) {
  return {
    installment_id: input.installmentId,
    allocated_amount: input.allocatedAmount,
  };
}

function toDebtScheduleInstallmentRow(input: DebtScheduleInstallmentInput) {
  return {
    installment_number: input.installmentNumber,
    due_date: input.dueDate,
    expected_amount: input.expectedAmount ?? null,
    expected_principal: input.expectedPrincipal ?? null,
    expected_interest: input.expectedInterest ?? null,
    expected_fees: input.expectedFees ?? null,
    expected_insurance: input.expectedInsurance ?? null,
  };
}

async function callDebtOperation<T>(rpcName: string, args: Record<string, unknown>, normalize: (data: Record<string, any>) => T): Promise<T> {
  if (!isSupabaseConfigured || !supabase) throw new DebtOperationUnavailableError();

  const { data, error } = await supabase.rpc(rpcName, args);
  if (error) throw mapDebtOperationError(error.message) ?? error;
  if (!data || typeof data !== "object") throw new Error("La RPC Debt no devolvió un resultado válido.");
  return normalize(data as Record<string, any>);
}

function mapDebtOperationError(message: string): DebtOperationError | null {
  const code = debtOperationErrorCodes.find((candidate) => message.includes(candidate));
  return code ? new DebtOperationError(code) : null;
}

const debtOperationErrorCodes: DebtOperationErrorCode[] = [
  "AUTH_REQUIRED",
  "HOUSEHOLD_ACCESS_DENIED",
  "DEBT_NOT_FOUND",
  "DEBT_ARCHIVED",
  "DEBT_NOT_ACTIVE",
  "DEBT_ALREADY_PAID_OFF",
  "DEBT_PRINCIPAL_EXCEEDED",
  "DEBT_PREPAYMENT_WOULD_PAY_OFF",
  "INVALID_DEBT_PAYMENT",
  "INVALID_DEBT_PREPAYMENT",
  "INVALID_DEBT_PAYOFF",
  "INVALID_DEBT_REVERSAL",
  "INVALID_DEBT_SCHEDULE",
  "INVALID_DEBT_ALLOCATIONS",
  "DEBT_EVENT_ID_CONFLICT",
  "DEBT_EVENT_NOT_FOUND",
  "DEBT_EVENT_TYPE_UNSUPPORTED",
  "DEBT_EVENT_ALREADY_REVERSED",
  "DEBT_REVERSAL_SCHEDULE_REQUIRED",
  "DEBT_REVERSAL_SCHEDULE_NOT_ALLOWED",
  "DEBT_MOVEMENT_CONFLICT",
  "DEBT_MOVEMENT_ALREADY_LINKED",
  "DEBT_MOVEMENT_NOT_FOUND",
  "DEBT_MOVEMENT_MUST_BE_EXPENSE",
  "DEBT_MOVEMENT_AMOUNT_MISMATCH",
  "DEBT_MOVEMENT_DATE_MISMATCH",
  "DEBT_MOVEMENT_CONTEXT_REQUIRED",
  "DEBT_MOVEMENT_ACCOUNT_REQUIRED",
  "DEBT_MOVEMENT_ACCOUNT_NOT_FOUND",
  "DEBT_MOVEMENT_ACCOUNT_METHOD_MISMATCH",
  "ACCOUNT_NOT_AVAILABLE",
  "DEBT_SERVICE_MOVEMENT_RPC_ONLY",
];

function fromDebtFundOperationResult(row: Record<string, any>): DebtFundOperationResult {
  return {
    idempotentReplay: Boolean(row.idempotentReplay),
    debt: fromDebtRow(row.debt),
    movement: fromMovementRow(row.movement),
    event: fromDebtEventRow(row.event),
    allocations: Array.isArray(row.allocations) ? row.allocations.map(fromDebtEventInstallmentAllocationRow) : [],
    scheduleVersion: row.scheduleVersion == null ? null : fromDebtScheduleVersionRow(row.scheduleVersion),
    installments: Array.isArray(row.installments) ? row.installments.map(fromDebtInstallmentRow) : [],
  };
}

function fromDebtReversalResult(row: Record<string, any>): DebtReversalResult {
  return {
    idempotentReplay: Boolean(row.idempotentReplay),
    debt: fromDebtRow(row.debt),
    event: fromDebtEventRow(row.event),
    scheduleVersion: row.scheduleVersion == null ? null : fromDebtScheduleVersionRow(row.scheduleVersion),
    installments: Array.isArray(row.installments) ? row.installments.map(fromDebtInstallmentRow) : [],
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

function mapMovementWriteError(error: { message?: string }) {
  switch (error.message) {
    case "DEBT_MOVEMENT_PROTECTED":
      return new DebtMovementProtectedError();
    case "MOVEMENT_CONTEXT_IMMUTABLE":
      return new MovementContextImmutableError();
    default:
      return null;
  }
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
    movement_context: movement.movementContext,
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
    movementContext: row.movement_context === "debt_service" ? "debt_service" : "standard",
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

function fromDebtRow(row: Record<string, any>): Debt {
  return {
    id: row.id,
    name: row.name,
    creditorName: row.creditor_name,
    debtKind: row.debt_kind,
    currencyCode: row.currency_code,
    originDate: row.origin_date ?? null,
    trackingStartDate: row.tracking_start_date,
    originalPrincipal: row.original_principal == null ? null : Number(row.original_principal),
    openingPrincipalBalance: Number(row.opening_principal_balance),
    plannedInstallmentCount: row.planned_installment_count == null ? null : Number(row.planned_installment_count),
    plannedInstallmentAmount: row.planned_installment_amount == null ? null : Number(row.planned_installment_amount),
    installmentAmountMode: row.installment_amount_mode,
    paymentFrequency: row.payment_frequency ?? null,
    customFrequencyDays: row.custom_frequency_days == null ? null : Number(row.custom_frequency_days),
    firstDueDate: row.first_due_date ?? null,
    teaPercent: row.tea_percent == null ? null : Number(row.tea_percent),
    tceaPercent: row.tcea_percent == null ? null : Number(row.tcea_percent),
    notes: row.notes ?? "",
    status: row.status,
    isArchived: Boolean(row.is_archived),
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromDebtEventRow(row: Record<string, any>): DebtEvent {
  return {
    id: row.id,
    debtId: row.debt_id,
    eventDate: row.event_date,
    eventType: row.event_type,
    cashAmount: Number(row.cash_amount),
    principalDelta: Number(row.principal_delta),
    interestPaid: Number(row.interest_paid),
    feesPaid: Number(row.fees_paid),
    insurancePaid: Number(row.insurance_paid),
    otherCostPaid: Number(row.other_cost_paid),
    breakdownComplete: Boolean(row.breakdown_complete),
    movementId: row.movement_id ?? null,
    reversalOfEventId: row.reversal_of_event_id ?? null,
    description: row.description ?? "",
    registeredByUserId: row.registered_by_user_id,
    createdAt: row.created_at,
  };
}

function fromDebtScheduleVersionRow(row: Record<string, any>): DebtScheduleVersion {
  return {
    id: row.id,
    debtId: row.debt_id,
    versionNumber: Number(row.version_number),
    effectiveDate: row.effective_date,
    reason: row.reason,
    triggerEventId: row.trigger_event_id ?? null,
    notes: row.notes ?? "",
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
  };
}

function fromDebtInstallmentRow(row: Record<string, any>): DebtInstallment {
  return {
    id: row.id,
    scheduleVersionId: row.schedule_version_id,
    debtId: row.debt_id,
    installmentNumber: Number(row.installment_number),
    dueDate: row.due_date,
    expectedAmount: row.expected_amount == null ? null : Number(row.expected_amount),
    expectedPrincipal: row.expected_principal == null ? null : Number(row.expected_principal),
    expectedInterest: row.expected_interest == null ? null : Number(row.expected_interest),
    expectedFees: row.expected_fees == null ? null : Number(row.expected_fees),
    expectedInsurance: row.expected_insurance == null ? null : Number(row.expected_insurance),
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
  };
}

function fromDebtEventInstallmentAllocationRow(row: Record<string, any>): DebtEventInstallmentAllocation {
  return {
    id: row.id,
    eventId: row.event_id,
    installmentId: row.installment_id,
    debtId: row.debt_id,
    allocatedAmount: Number(row.allocated_amount),
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
  };
}

function fromDebtCollateralRow(row: Record<string, any>): DebtCollateral {
  return {
    id: row.id,
    debtId: row.debt_id,
    description: row.description,
    pledgedValue: row.pledged_value == null ? null : Number(row.pledged_value),
    estimatedValue: row.estimated_value == null ? null : Number(row.estimated_value),
    redemptionDeadline: row.redemption_deadline ?? null,
    status: row.status,
    notes: row.notes ?? "",
    createdByUserId: row.created_by_user_id,
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
