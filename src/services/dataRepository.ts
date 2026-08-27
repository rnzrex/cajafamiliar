import { fetchAllSupabaseRows } from "./supabasePagination.js";
import { HouseholdNotProvisionedError, RemoteAppDataLoadError, TrustedOfflineSnapshotUnavailableError, MovementReconciledError, ReconciliationIdConflictError, MovementCorrectionConflictError, MovementNotReconciledError, MovementCorrectionIdConflictError } from "./dataRepositoryErrors.js";
import { AppData, CashCount, Category, CreditCardEntry, CreditCardProfile, CreditCardPurchaseInput, CreditCardPurchaseResult, CreditCardPaymentInput, CreditCardPaymentResult, CreditCardFeeInput, CreditCardFeeResult, CreditCardCreditInput, CreditCardCreditResult, CreditCardReversalInput, CreditCardReversalResult, CreditCardStatement, CreditCardStatementCloseInput, CreditCardStatementCloseResult, CreditCardDebtCreateInput, CreditCardDebtCreateResult, CreditCardProfileSaveInput, CreditCardProfileSaveResult, Debt, DebtAllocationInput, DebtCollateral, DebtCollateralInput, DebtCreateInput, DebtEvent, DebtEventInstallmentAllocation, DebtInstallment, DebtInstallmentAdvanceInput, DebtPaymentInput, DebtPayoffInput, DebtPrepaymentInput, DebtReversalInput, DebtScheduleInstallmentInput, DebtScheduleVersion, FinancialAccount, HouseholdMember, Movement, RecurringPayment, DebtKind, DebtInstallmentAmountMode, DebtPaymentFrequency, AccountReconciliation, AccountReconciliationMovement, RecordAccountReconciliationInput, RecordAccountReconciliationResult, MovementCorrection, DebtRepaymentStructure, DebtInterestCalculationMode, PeriodicRateBasis, BankLoanSubtype, AmortizationMethod, DebtInsuranceType, DebtInsurancePricingMode, ScheduleSource, BankLoanProfile, DebtInsuranceTerms, BankInterestDayCountBasis, BankDueDateAdjustmentRule, BankInstallmentTotalMode, BankReportedBalanceKind } from "../types.js";
import { loadData, loadTrustedSnapshot, markTrustedSnapshot, normalizeData, saveData } from "../utils/storage.js";
import { householdId, isSupabaseConfigured, supabase } from "./supabaseClient.js";

export type AppDataLoadSource = "local" | "remote" | "fallback";

export interface AppDataLoadResult {
  data: AppData;
  source: AppDataLoadSource;
}

export * from "./dataRepositoryErrors.js";

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
      movementsRows,
      categoriesRows,
      countsRows,
      paymentsRows,
      accountsRows,
      debtsRows,
      bankLoanProfilesRows,
      debtInsuranceTermsRows,
      debtEventsRows,
      debtScheduleVersionsRows,
      debtInstallmentsRows,
      debtAllocationsRows,
      debtCollateralsRows,
      creditCardProfilesRows,
      creditCardEntriesRows,
      creditCardStatementsRows,
      accountReconciliationsRows,
      accountReconciliationMovementsRows,
      movementCorrectionsRows,
    ] = await Promise.all([
      supabase.from("settings").select("*").eq("household_id", householdId).maybeSingle(),
      fetchAllSupabaseRows({
        supabase,
        table: "movements",
        householdId,
        orders: [
          { column: "date", ascending: false },
          { column: "created_at", ascending: false },
          { column: "id", ascending: false },
        ],
      }),
      fetchAllSupabaseRows({
        supabase,
        table: "categories",
        householdId,
        orders: [
          { column: "created_at", ascending: true },
          { column: "id", ascending: true },
        ],
      }),
      fetchAllSupabaseRows({
        supabase,
        table: "cash_counts",
        householdId,
        orders: [
          { column: "created_at", ascending: false },
          { column: "id", ascending: false },
        ],
      }),
      fetchAllSupabaseRows({
        supabase,
        table: "recurring_payments",
        householdId,
        orders: [
          { column: "created_at", ascending: true },
          { column: "id", ascending: true },
        ],
      }),
      fetchAllSupabaseRows({
        supabase,
        table: "financial_accounts",
        householdId,
        orders: [
          { column: "sort_order", ascending: true },
          { column: "created_at", ascending: true },
          { column: "id", ascending: true },
        ],
      }),
      fetchAllSupabaseRows({
        supabase,
        table: "debts",
        householdId,
        orders: [
          { column: "created_at", ascending: true },
          { column: "id", ascending: true },
        ],
      }),
      fetchAllSupabaseRows({
        supabase,
        table: "bank_loan_profiles",
        householdId,
        orders: [
          { column: "created_at", ascending: true },
          { column: "debt_id", ascending: true },
        ],
        pkField: "debt_id",
      }),
      fetchAllSupabaseRows({
        supabase,
        table: "debt_insurance_terms",
        householdId,
        orders: [
          { column: "created_at", ascending: true },
          { column: "id", ascending: true },
        ],
      }),
      fetchAllSupabaseRows({
        supabase,
        table: "debt_events",
        householdId,
        orders: [
          { column: "event_date", ascending: true },
          { column: "created_at", ascending: true },
          { column: "id", ascending: true },
        ],
      }),
      fetchAllSupabaseRows({
        supabase,
        table: "debt_schedule_versions",
        householdId,
        orders: [
          { column: "version_number", ascending: true },
          { column: "created_at", ascending: true },
          { column: "id", ascending: true },
        ],
      }),
      fetchAllSupabaseRows({
        supabase,
        table: "debt_installments",
        householdId,
        orders: [
          { column: "due_date", ascending: true },
          { column: "installment_number", ascending: true },
          { column: "id", ascending: true },
        ],
      }),
      fetchAllSupabaseRows({
        supabase,
        table: "debt_event_installment_allocations",
        householdId,
        orders: [
          { column: "created_at", ascending: true },
          { column: "id", ascending: true },
        ],
      }),
      fetchAllSupabaseRows({
        supabase,
        table: "debt_collaterals",
        householdId,
        orders: [
          { column: "created_at", ascending: true },
          { column: "id", ascending: true },
        ],
      }),
      fetchAllSupabaseRows({
        supabase,
        table: "credit_card_profiles",
        householdId,
        orders: [
          { column: "created_at", ascending: true },
          { column: "debt_id", ascending: true },
        ],
        pkField: "debt_id",
      }),
      fetchAllSupabaseRows({
        supabase,
        table: "credit_card_entries",
        householdId,
        orders: [
          { column: "entry_date", ascending: true },
          { column: "created_at", ascending: true },
          { column: "id", ascending: true },
        ],
      }),
      fetchAllSupabaseRows({
        supabase,
        table: "credit_card_statements",
        householdId,
        orders: [
          { column: "statement_date", ascending: true },
          { column: "created_at", ascending: true },
          { column: "id", ascending: true },
        ],
      }),
      fetchAllSupabaseRows({
        supabase,
        table: "account_reconciliations",
        householdId,
        orders: [
          { column: "created_at", ascending: false },
          { column: "id", ascending: false },
        ],
      }),
      fetchAllSupabaseRows({
        supabase,
        table: "account_reconciliation_movements",
        householdId,
        orders: [
          { column: "created_at", ascending: false },
          { column: "id", ascending: false },
        ],
      }),
      fetchAllSupabaseRows({
        supabase,
        table: "movement_corrections",
        householdId,
        orders: [
          { column: "created_at", ascending: false },
          { column: "id", ascending: false },
        ],
      }),
    ]);

    if (settingsResult.error) {
      throw new RemoteAppDataLoadError("settings", settingsResult.error);
    }

    const hasRemoteData =
      movementsRows.length > 0 ||
      categoriesRows.length > 0 ||
      countsRows.length > 0 ||
      paymentsRows.length > 0 ||
      accountsRows.length > 0 ||
      Boolean(settingsResult.data);

    if (!hasRemoteData) throw new HouseholdNotProvisionedError();

    const remoteData = normalizeData({
      initialBalance: Number(settingsResult.data?.initial_balance ?? 0),
      movements: movementsRows.map(fromMovementRow),
      categories: categoriesRows.map(fromCategoryRow),
      cashCounts: countsRows.map(fromCashCountRow),
      recurringPayments: paymentsRows.map(fromRecurringPaymentRow),
      financialAccounts: accountsRows.map(fromFinancialAccountRow),
      debts: debtsRows.map(fromDebtRow),
      bankLoanProfiles: (bankLoanProfilesRows ?? []).map(fromBankLoanProfileRow),
      debtInsuranceTerms: (debtInsuranceTermsRows ?? []).map(fromDebtInsuranceTermsRow),
      debtEvents: debtEventsRows.map(fromDebtEventRow),
      debtScheduleVersions: debtScheduleVersionsRows.map(fromDebtScheduleVersionRow),
      debtInstallments: debtInstallmentsRows.map(fromDebtInstallmentRow),
      debtEventInstallmentAllocations: debtAllocationsRows.map(fromDebtEventInstallmentAllocationRow),
      debtCollaterals: debtCollateralsRows.map(fromDebtCollateralRow),
      creditCardProfiles: creditCardProfilesRows.map(fromCreditCardProfileRow),
      creditCardEntries: creditCardEntriesRows.map(fromCreditCardEntryRow),
      creditCardStatements: creditCardStatementsRows.map(fromCreditCardStatementRow),
      accountReconciliations: (accountReconciliationsRows ?? []).map(fromAccountReconciliationRow),
      accountReconciliationMovements: (accountReconciliationMovementsRows ?? []).map(fromAccountReconciliationMovementRow),
      movementCorrections: (movementCorrectionsRows ?? []).map(fromMovementCorrectionRow),
    });

    const snapshotPersisted = saveData(remoteData);
    if (snapshotPersisted) {
      markTrustedSnapshot(member);
    }
    return { data: remoteData, source: "remote" };
  } catch (error) {
    if (error instanceof HouseholdNotProvisionedError || error instanceof RemoteAppDataLoadError) {
      throw error;
    }
    throw new RemoteAppDataLoadError("unknown", error);
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

  if (payment.linked_debt_id || payment.linkedDebtId) {
    throw new Error("No se puede registrar un gasto directo para un pago de deuda vinculada.");
  }

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
  | "DEBT_ALREADY_EXISTS"
  | "INVALID_DEBT_INPUT"
  | "INVALID_INSTALLMENTS"
  | "INVALID_COLLATERALS"
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
  | "DEBT_NOT_BANK_LOAN"
  | "DEBT_SCHEDULE_NOT_FOUND"
  | "DEBT_EVENT_ALREADY_REVERSED"
  | "DEBT_REVERSAL_SCHEDULE_REQUIRED"
  | "DEBT_REVERSAL_SCHEDULE_NOT_ALLOWED"
  | "DEBT_REVERSAL_SCHEDULE_CONFLICT"
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

export interface DebtScheduleUpdateInput {
  debtId: string;
  eventId: string;
  eventDate: string;
  reason: "rate_change" | "manual_adjustment";
  scheduleInstallments: DebtScheduleInstallmentInput[];
  scheduleNotes?: string | null;
}

export interface BankPrepaymentScheduleUpdateInput {
  debtId: string;
  prepaymentEventId: string;
  effectiveDate: string;
  scheduleInstallments: DebtScheduleInstallmentInput[];
  scheduleNotes?: string | null;
}

export interface DebtScheduleUpdateResult {
  idempotentReplay: boolean;
  debt: Debt;
  event: DebtEvent;
  scheduleVersion: DebtScheduleVersion;
  installments: DebtInstallment[];
}


export interface DebtUpdateMetadataInput {
  debtId: string;
  name: string;
  creditorName: string;
  notes: string;
}

export interface DebtUpdateTermsInput {
  debtId: string;
  repaymentStructure?: DebtRepaymentStructure | null;
  interestCalculationMode?: DebtInterestCalculationMode | null;
  periodicRatePercent?: number | null;
  periodicRateBasis?: PeriodicRateBasis | null;
  teaPercent?: number | null;
  tceaPercent?: number | null;
  paymentFrequency?: DebtPaymentFrequency | null;
  customFrequencyDays?: number | null;
  interestAccrualAnchorDate?: string | null;
  clearPeriodicRate?: boolean;
  clearTea?: boolean;
  clearTcea?: boolean;
  clearFrequency?: boolean;
  clearAnchor?: boolean;
  firstDueDate?: string | null;
  clearFirstDueDate?: boolean;
  minimumPrincipalPayment?: number | null;
  clearMinimumPrincipalPayment?: boolean;
}

export interface DebtSetArchivedInput {
  debtId: string;
  isArchived: boolean;
}

export interface DebtCreateResult {
  debt: Debt;
  scheduleVersion: DebtScheduleVersion | null;
  installments: DebtInstallment[];
  collaterals: DebtCollateral[];
}

export function toCreateDebtRpcArgs(input: DebtCreateInput) {
  return {
    p_household_id: householdId,
    p_debt_id: input.debtId,
    p_name: input.name,
    p_creditor_name: input.creditorName,
    p_debt_kind: input.debtKind,
    p_currency_code: input.currencyCode,
    p_origin_date: input.originDate ?? null,
    p_tracking_start_date: input.trackingStartDate,
    p_original_principal: input.originalPrincipal ?? null,
    p_opening_principal_balance: input.openingPrincipalBalance,
    p_planned_installment_count: input.plannedInstallmentCount ?? null,
    p_planned_installment_amount: input.plannedInstallmentAmount ?? null,
    p_installment_amount_mode: input.installmentAmountMode,
    p_payment_frequency: input.paymentFrequency ?? null,
    p_custom_frequency_days: input.customFrequencyDays ?? null,
    p_first_due_date: input.firstDueDate ?? null,
    p_tea_percent: input.teaPercent ?? null,
    p_tcea_percent: input.tceaPercent ?? null,
    p_notes: input.notes ?? "",
    p_installments: (input.installments ?? []).map(toDebtScheduleInstallmentRow),
    p_collaterals: (input.collaterals ?? []).map((c) => ({
      description: c.description,
      pledged_value: c.pledgedValue ?? null,
      estimated_value: c.estimatedValue ?? null,
      redemption_deadline: c.redemptionDeadline ?? null,
    })),
    p_repayment_structure: input.repaymentStructure ?? "unknown",
    p_interest_calculation_mode: input.interestCalculationMode ?? "unknown",
    p_periodic_rate_percent: input.periodicRatePercent ?? null,
    p_periodic_rate_basis: input.periodicRateBasis ?? null,
    p_minimum_principal_payment: input.minimumPrincipalPayment ?? null,
  };
}

export async function createDebt(input: DebtCreateInput): Promise<DebtCreateResult> {
  if (!isSupabaseConfigured || !supabase) throw new DebtOperationUnavailableError();
  const { data, error } = await supabase.rpc("create_debt_v2", toCreateDebtRpcArgs(input));
  if (error) throw mapDebtOperationError(error.message) ?? error;
  if (!data || typeof data !== "object") throw new Error("La RPC create_debt_v2 no devolvió un resultado válido.");
  const row = data as Record<string, any>;
  return {
    debt: fromDebtRow(row.debt),
    scheduleVersion: row.scheduleVersion && row.scheduleVersion !== "null" ? fromDebtScheduleVersionRow(row.scheduleVersion) : null,
    installments: Array.isArray(row.installments) ? row.installments.map(fromDebtInstallmentRow) : [],
    collaterals: Array.isArray(row.collaterals) ? row.collaterals.map(fromDebtCollateralRow) : [],
  };
}

export interface BankLoanCreateInput extends DebtCreateInput {
  loanSubtype: BankLoanSubtype;
  onboardingMode?: "EXISTING_DEBT" | "NEW_DEBT";
  installmentsPaidBeforeTracking?: number;
  contractNumber?: string | null;
  amortizationMethod: AmortizationMethod;
  disbursedAmount?: number | null;
  assetPrice?: number | null;
  downPaymentAmount?: number | null;
  financedAmount?: number | null;
  termInstallments?: number | null;
  interestDayCountBasis?: BankInterestDayCountBasis | null;
  dueDateAdjustmentRule?: BankDueDateAdjustmentRule | null;
  installmentTotalMode?: BankInstallmentTotalMode | null;
  reportedBalanceKind?: BankReportedBalanceKind | null;
  reportedBalanceAmount?: number | null;
  gracePeriodType?: "none" | "total" | "partial";
  gracePeriodInstallments?: number | null;
  balloonPaymentAmount?: number | null;
  insurances?: Array<{
    insuranceType: DebtInsuranceType;
    label: string;
    pricingMode: DebtInsurancePricingMode;
    ratePercent?: number | null;
    fixedAmount?: number | null;
    rateBasis?: string | null;
    isRequired?: boolean;
    provider?: string | null;
    policyReference?: string | null;
    notes?: string;
  }>;
  scheduleSource?: ScheduleSource;
}

export async function createBankLoan(input: BankLoanCreateInput): Promise<DebtCreateResult> {
  if (!isSupabaseConfigured || !supabase) throw new DebtOperationUnavailableError();
  if (input.onboardingMode === "EXISTING_DEBT" && (!Number.isInteger(input.installmentsPaidBeforeTracking) || (input.installmentsPaidBeforeTracking ?? 0) < 1)) {
    throw new Error("Indica cuál fue la última cuota contractual que ya pagaste.");
  }
  const rpcArgs = {
    ...toCreateDebtRpcArgs(input),
    p_profile: {
      loan_subtype: input.loanSubtype,
      contract_number: input.contractNumber ?? null,
      amortization_method: input.amortizationMethod,
      disbursed_amount: input.disbursedAmount ?? null,
      asset_price: input.assetPrice ?? null,
      down_payment_amount: input.downPaymentAmount ?? null,
      financed_amount: input.financedAmount ?? null,
      term_installments: input.termInstallments ?? null,
      installments_paid_before_tracking: input.installmentsPaidBeforeTracking,
      interest_day_count_basis: input.interestDayCountBasis ?? null,
      due_date_adjustment_rule: input.dueDateAdjustmentRule ?? "unknown",
      installment_total_mode: input.installmentTotalMode ?? "unknown",
      reported_balance_kind: input.reportedBalanceKind ?? null,
      reported_balance_amount: input.reportedBalanceAmount ?? null,
      grace_period_type: input.gracePeriodType ?? "none",
      grace_period_installments: input.gracePeriodInstallments ?? null,
      balloon_payment_amount: input.balloonPaymentAmount ?? null,
    },
    p_insurances: (input.insurances ?? []).map((ins) => ({
      insurance_type: ins.insuranceType,
      label: ins.label,
      pricing_mode: ins.pricingMode,
      rate_percent: ins.ratePercent ?? null,
      fixed_amount: ins.fixedAmount ?? null,
      rate_basis: ins.rateBasis ?? null,
      is_required: ins.isRequired ?? true,
      provider: ins.provider ?? null,
      policy_reference: ins.policyReference ?? null,
      notes: ins.notes ?? "",
    })),
    p_schedule_source: input.scheduleSource ?? "manual",
  };

  const { data, error } = await supabase.rpc("create_bank_loan_v1", rpcArgs);
  if (error) throw mapDebtOperationError(error.message) ?? error;
  if (!data || typeof data !== "object") throw new Error("La RPC create_bank_loan_v1 no devolvió un resultado válido.");
  const row = data as Record<string, any>;
  return {
    debt: fromDebtRow(row.debt),
    scheduleVersion: row.scheduleVersion && row.scheduleVersion !== "null" ? fromDebtScheduleVersionRow(row.scheduleVersion) : null,
    installments: Array.isArray(row.installments) ? row.installments.map(fromDebtInstallmentRow) : [],
    collaterals: Array.isArray(row.collaterals) ? row.collaterals.map(fromDebtCollateralRow) : [],
  };
}

export async function updateDebtMetadata(input: DebtUpdateMetadataInput): Promise<Debt> {
  if (!isSupabaseConfigured || !supabase) throw new DebtOperationUnavailableError();
  const { data, error } = await supabase.rpc("update_debt_metadata_v1", {
    p_household_id: householdId,
    p_debt_id: input.debtId,
    p_name: input.name,
    p_creditor_name: input.creditorName,
    p_notes: input.notes,
  });
  if (error) throw mapDebtOperationError(error.message) ?? error;
  if (!data || typeof data !== "object") throw new Error("La RPC update_debt_metadata_v1 no devolvió un resultado válido.");
  return fromDebtRow(data);
}

export async function updateDebtTerms(input: DebtUpdateTermsInput): Promise<Debt> {
  if (!isSupabaseConfigured || !supabase) throw new DebtOperationUnavailableError();
  const { data, error } = await supabase.rpc("update_debt_terms_v2", {
    p_household_id: householdId,
    p_debt_id: input.debtId,
    p_repayment_structure: input.repaymentStructure ?? null,
    p_interest_calculation_mode: input.interestCalculationMode ?? null,
    p_periodic_rate_percent: input.periodicRatePercent ?? null,
    p_periodic_rate_basis: input.periodicRateBasis ?? null,
    p_tea_percent: input.teaPercent ?? null,
    p_tcea_percent: input.tceaPercent ?? null,
    p_payment_frequency: input.paymentFrequency ?? null,
    p_custom_frequency_days: input.customFrequencyDays ?? null,
    p_clear_periodic_rate: Boolean(input.clearPeriodicRate),
    p_clear_tea: Boolean(input.clearTea),
    p_clear_tcea: Boolean(input.clearTcea),
    p_clear_frequency: Boolean(input.clearFrequency),
    p_first_due_date: input.firstDueDate ?? null,
    p_clear_first_due_date: Boolean(input.clearFirstDueDate),
    p_minimum_principal_payment: input.minimumPrincipalPayment ?? null,
    p_clear_minimum_principal_payment: Boolean(input.clearMinimumPrincipalPayment),
  });
  if (error) throw mapDebtOperationError(error.message) ?? error;
  if (!data || typeof data !== "object") throw new Error("La RPC update_debt_terms_v2 no devolvió un resultado válido.");
  return fromDebtRow(data);
}

export async function setDebtArchived(input: DebtSetArchivedInput): Promise<Debt> {
  if (!isSupabaseConfigured || !supabase) throw new DebtOperationUnavailableError();
  const { data, error } = await supabase.rpc("set_debt_archived_v1", {
    p_household_id: householdId,
    p_debt_id: input.debtId,
    p_is_archived: input.isArchived,
  });
  if (error) throw mapDebtOperationError(error.message) ?? error;
  if (!data || typeof data !== "object") throw new Error("La RPC set_debt_archived_v1 no devolvió un resultado válido.");
  return fromDebtRow(data);
}

export interface DeletePristineDebtInput {
  debtId: string;
}

export async function deletePristineDebt(input: DeletePristineDebtInput): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) throw new DebtOperationUnavailableError();
  const { data, error } = await supabase.rpc("delete_pristine_debt_v1", {
    p_household_id: householdId,
    p_debt_id: input.debtId,
  });
  if (error) throw mapDebtOperationError(error.message) ?? error;
  if (!data || typeof data !== "object" || (data as any).deleted !== true || (data as any).success !== true) {
    throw new Error("La RPC delete_pristine_debt_v1 no devolvió un resultado válido.");
  }
  return true;
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
    p_extra_principal_amount: input.extraPrincipalAmount ?? 0,
    p_prepayment_effect: input.prepaymentEffect ?? null,
    p_breakdown_complete: input.breakdownComplete,
    p_allocations: input.allocations.map(toDebtAllocationRow),
    p_schedule_installments: (input.scheduleInstallments ?? []).map(toDebtScheduleInstallmentRow),
    p_schedule_notes: input.scheduleNotes ?? null,
    p_schedule_source: input.scheduleSource ?? null,
  };
}

export function toDebtScheduleUpdateRpcArgs(input: DebtScheduleUpdateInput) {
  return {
    p_household_id: householdId,
    p_debt_id: input.debtId,
    p_event_id: input.eventId,
    p_event_date: input.eventDate,
    p_reason: input.reason,
    p_schedule_installments: input.scheduleInstallments.map(toDebtScheduleInstallmentRow),
    p_schedule_notes: input.scheduleNotes ?? null,
  };
}

export function toBankPrepaymentScheduleUpdateRpcArgs(input: BankPrepaymentScheduleUpdateInput) {
  return {
    p_household_id: householdId,
    p_debt_id: input.debtId,
    p_prepayment_event_id: input.prepaymentEventId,
    p_effective_date: input.effectiveDate,
    p_schedule_installments: input.scheduleInstallments.map(toDebtScheduleInstallmentRow),
    p_schedule_notes: input.scheduleNotes ?? null,
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
    p_prepayment_effect: input.prepaymentEffect ?? null,
    p_breakdown_complete: input.breakdownComplete,
    p_schedule_installments: input.scheduleInstallments.map(toDebtScheduleInstallmentRow),
    p_schedule_notes: input.scheduleNotes ?? null,
    p_schedule_source: input.scheduleSource ?? null,
  };
}

export function toDebtInstallmentAdvanceRpcArgs(input: DebtInstallmentAdvanceInput) {
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
  return callDebtOperation("record_debt_payment_v3", toDebtPaymentRpcArgs(input), fromDebtFundOperationResult);
}

export async function recordDebtPrepayment(input: DebtPrepaymentInput): Promise<DebtFundOperationResult> {
  return callDebtOperation("record_debt_prepayment_v3", toDebtPrepaymentRpcArgs(input), fromDebtFundOperationResult);
}

export async function recordDebtPayoff(input: DebtPayoffInput): Promise<DebtFundOperationResult> {
  return callDebtOperation("record_debt_payoff_v1", toDebtPayoffRpcArgs(input), fromDebtFundOperationResult);
}

export async function recordDebtInstallmentAdvance(input: DebtInstallmentAdvanceInput): Promise<DebtFundOperationResult> {
  return callDebtOperation("record_debt_installment_advance_v1", toDebtInstallmentAdvanceRpcArgs(input), fromDebtFundOperationResult);
}

export async function reverseDebtEvent(input: DebtReversalInput): Promise<DebtReversalResult> {
  return callDebtOperation("reverse_debt_event_v1", toDebtReversalRpcArgs(input), fromDebtReversalResult);
}

export async function updateDebtContractualSchedule(input: DebtScheduleUpdateInput): Promise<DebtScheduleUpdateResult> {
  return callDebtOperation("update_debt_contractual_schedule_v1", toDebtScheduleUpdateRpcArgs(input), fromDebtScheduleUpdateResult);
}

export async function updateBankPrepaymentSchedule(input: BankPrepaymentScheduleUpdateInput): Promise<DebtScheduleUpdateResult> {
  return callDebtOperation("update_bank_prepayment_schedule_v1", toBankPrepaymentScheduleUpdateRpcArgs(input), fromDebtScheduleUpdateResult);
}

export class CreditCardOperationError extends Error {
  constructor(public code: string) {
    super(`Operación de tarjeta de crédito fallida: ${code}`);
    this.name = "CreditCardOperationError";
  }
}

export function mapCreditCardOperationError(message: string): CreditCardOperationError | null {
  const codes = [
    "AUTH_REQUIRED",
    "HOUSEHOLD_ACCESS_DENIED",
    "DEBT_NOT_FOUND",
    "DEBT_ALREADY_EXISTS",
    "DEBT_NOT_CREDIT_CARD",
    "DEBT_ARCHIVED",
    "DEBT_NOT_ACTIVE",
    "CREDIT_CARD_PROFILE_NOT_FOUND",
    "INVALID_CREDIT_CARD_PROFILE",
    "INVALID_CREDIT_CARD_PURCHASE",
    "INVALID_CREDIT_CARD_PAYMENT",
    "INVALID_CREDIT_CARD_STATEMENT",
    "INVALID_CREDIT_CARD_FEE",
    "INVALID_CREDIT_CARD_CREDIT",
    "INVALID_CREDIT_CARD_REVERSAL",
    "TARGET_ENTRY_NOT_FOUND",
    "REVERSAL_TARGET_INVALID",
    "TARGET_ALREADY_REVERSED",
    "CREDIT_CARD_CREDIT_TARGET_INVALID",
    "CREDIT_CARD_REFUND_EXCEEDS_TARGET",
    "CREDIT_CARD_TARGET_HAS_EFFECTIVE_CREDITS",
    "ACCOUNT_NOT_FOUND",
    "ACCOUNT_INACTIVE",
    "ACCOUNT_CURRENCY_MISMATCH",
    "CREDIT_CARD_ENTRY_ID_CONFLICT",
    "CREDIT_CARD_MOVEMENT_ALREADY_LINKED",
    "CREDIT_CARD_STATEMENT_CONFLICT",
    "CREDIT_CARD_MOVEMENT_RPC_ONLY",
  ];
  const matched = codes.find((code) => message.includes(code));
  return matched ? new CreditCardOperationError(matched) : null;
}

export function toCreateCreditCardDebtRpcArgs(input: CreditCardDebtCreateInput) {
  return {
    p_household_id: householdId,
    p_debt_id: input.debtId,
    p_name: input.name,
    p_creditor_name: input.creditorName,
    p_currency_code: input.currencyCode,
    p_origin_date: input.originDate ?? null,
    p_tracking_start_date: input.trackingStartDate,
    p_opening_balance: input.openingBalance,
    p_credit_limit: input.creditLimit ?? null,
    p_closing_day: input.closingDay ?? null,
    p_due_day: input.dueDay ?? null,
    p_last4: input.last4 ?? null,
    p_tea_percent: input.teaPercent ?? null,
    p_tcea_percent: input.tceaPercent ?? null,
    p_notes: input.notes ?? "",
  };
}

export async function createCreditCardDebt(input: CreditCardDebtCreateInput): Promise<CreditCardDebtCreateResult> {
  if (!isSupabaseConfigured || !supabase) throw new DebtOperationUnavailableError();

  const { data, error } = await supabase.rpc("create_credit_card_debt_v1", toCreateCreditCardDebtRpcArgs(input));
  if (error) {
    const mapped = mapCreditCardOperationError(error.message) || mapDebtOperationError(error.message);
    if (mapped) throw mapped;
    throw error;
  }
  if (!data || typeof data !== "object") throw new Error("La RPC create_credit_card_debt_v1 no devolvió un resultado válido.");
  const res = data as any;
  return {
    success: true,
    debtId: input.debtId,
    debt: fromDebtRow(res.debt),
    profile: fromCreditCardProfileRow(res.profile),
  };
}

export function toSaveCreditCardProfileRpcArgs(input: CreditCardProfileSaveInput) {
  return {
    p_household_id: householdId,
    p_debt_id: input.debtId,
    p_credit_limit: input.creditLimit ?? null,
    p_closing_day: input.closingDay ?? null,
    p_due_day: input.dueDay ?? null,
    p_last4: input.last4 ?? null,
  };
}

export async function saveCreditCardProfile(input: CreditCardProfileSaveInput): Promise<CreditCardProfileSaveResult> {
  if (!isSupabaseConfigured || !supabase) throw new DebtOperationUnavailableError();

  const { data, error } = await supabase.rpc("save_credit_card_profile_v1", toSaveCreditCardProfileRpcArgs(input));
  if (error) {
    const mapped = mapCreditCardOperationError(error.message) || mapDebtOperationError(error.message);
    if (mapped) throw mapped;
    throw error;
  }
  if (!data || typeof data !== "object") throw new Error("La RPC save_credit_card_profile_v1 no devolvió un resultado válido.");
  return {
    success: true,
    profile: fromCreditCardProfileRow(data),
  };
}

export function toCreditCardPurchaseRpcArgs(input: CreditCardPurchaseInput) {
  return {
    p_household_id: householdId,
    p_debt_id: input.debtId,
    p_entry_id: input.entryId,
    p_movement_id: input.movementId,
    p_purchase_date: input.purchaseDate,
    p_amount: input.amount,
    p_description: input.description,
    p_category: input.category,
  };
}

export async function recordCreditCardPurchase(input: CreditCardPurchaseInput): Promise<CreditCardPurchaseResult> {
  if (!isSupabaseConfigured || !supabase) throw new DebtOperationUnavailableError();

  const { data, error } = await supabase.rpc("record_credit_card_purchase_v1", toCreditCardPurchaseRpcArgs(input));
  if (error) {
    const mapped = mapCreditCardOperationError(error.message);
    if (mapped) throw mapped;
    throw error;
  }
  if (!data || typeof data !== "object") throw new Error("La RPC record_credit_card_purchase_v1 no devolvió un resultado válido.");
  return {
    success: Boolean((data as any).success),
    entryId: String((data as any).entry_id),
    movementId: String((data as any).movement_id),
    idempotent: Boolean((data as any).idempotent),
  };
}

export function toCreditCardPaymentRpcArgs(input: CreditCardPaymentInput) {
  return {
    p_household_id: householdId,
    p_debt_id: input.debtId,
    p_entry_id: input.entryId,
    p_movement_id: input.movementId,
    p_payment_date: input.paymentDate,
    p_amount: input.amount,
    p_account_id: input.accountId,
    p_description: input.description,
    p_category: input.category,
  };
}

export async function recordCreditCardPayment(input: CreditCardPaymentInput): Promise<CreditCardPaymentResult> {
  if (!isSupabaseConfigured || !supabase) throw new DebtOperationUnavailableError();

  const { data, error } = await supabase.rpc("record_credit_card_payment_v1", toCreditCardPaymentRpcArgs(input));
  if (error) {
    const mapped = mapCreditCardOperationError(error.message);
    if (mapped) throw mapped;
    throw error;
  }
  if (!data || typeof data !== "object") throw new Error("La RPC record_credit_card_payment_v1 no devolvió un resultado válido.");
  return {
    success: Boolean((data as any).success),
    entryId: String((data as any).entry_id),
    movementId: String((data as any).movement_id),
    idempotent: Boolean((data as any).idempotent),
  };
}

export function toCreditCardFeeRpcArgs(input: CreditCardFeeInput) {
  return {
    p_household_id: householdId,
    p_debt_id: input.debtId,
    p_entry_id: input.entryId,
    p_movement_id: input.movementId,
    p_fee_date: input.feeDate,
    p_amount: input.amount,
    p_description: input.description,
    p_category: input.category,
  };
}

export async function recordCreditCardFee(input: CreditCardFeeInput): Promise<CreditCardFeeResult> {
  if (!isSupabaseConfigured || !supabase) throw new DebtOperationUnavailableError();

  const { data, error } = await supabase.rpc("record_credit_card_fee_v1", toCreditCardFeeRpcArgs(input));
  if (error) {
    const mapped = mapCreditCardOperationError(error.message);
    if (mapped) throw mapped;
    throw error;
  }
  if (!data || typeof data !== "object") throw new Error("La RPC record_credit_card_fee_v1 no devolvió un resultado válido.");
  return {
    success: Boolean((data as any).success),
    entryId: String((data as any).entry_id),
    movementId: String((data as any).movement_id),
    idempotent: Boolean((data as any).idempotent),
  };
}

export function toCreditCardReversalRpcArgs(input: CreditCardReversalInput) {
  return {
    p_household_id: householdId,
    p_debt_id: input.debtId,
    p_reversal_entry_id: input.reversalEntryId,
    p_target_entry_id: input.targetEntryId,
    p_reversal_date: input.reversalDate,
    p_description: input.description,
  };
}

export async function reverseCreditCardEntry(input: CreditCardReversalInput): Promise<CreditCardReversalResult> {
  if (!isSupabaseConfigured || !supabase) throw new DebtOperationUnavailableError();

  const { data, error } = await supabase.rpc("reverse_credit_card_entry_v1", toCreditCardReversalRpcArgs(input));
  if (error) {
    const mapped = mapCreditCardOperationError(error.message);
    if (mapped) throw mapped;
    throw error;
  }
  if (!data || typeof data !== "object") throw new Error("La RPC reverse_credit_card_entry_v1 no devolvió un resultado válido.");
  return {
    success: Boolean((data as any).success),
    entryId: String((data as any).entry_id),
    reversalOfEntryId: String((data as any).reversal_of_entry_id),
    idempotent: Boolean((data as any).idempotent),
  };
}

export function toCreditCardCreditRpcArgs(input: CreditCardCreditInput) {
  return {
    p_household_id: householdId,
    p_debt_id: input.debtId,
    p_entry_id: input.entryId,
    p_movement_id: input.movementId,
    p_target_entry_id: input.targetEntryId,
    p_credit_date: input.creditDate,
    p_amount: input.amount,
    p_description: input.description,
  };
}

export async function recordCreditCardCredit(input: CreditCardCreditInput): Promise<CreditCardCreditResult> {
  if (!isSupabaseConfigured || !supabase) throw new DebtOperationUnavailableError();

  const { data, error } = await supabase.rpc("record_credit_card_credit_v1", toCreditCardCreditRpcArgs(input));
  if (error) {
    const mapped = mapCreditCardOperationError(error.message);
    if (mapped) throw mapped;
    throw error;
  }
  if (!data || typeof data !== "object") throw new Error("La RPC record_credit_card_credit_v1 no devolvió un resultado válido.");
  return {
    success: Boolean((data as any).success),
    entryId: String((data as any).entry_id),
    movementId: String((data as any).movement_id),
    idempotent: Boolean((data as any).idempotent),
  };
}

export function toCreditCardStatementCloseRpcArgs(input: CreditCardStatementCloseInput) {
  return {
    p_household_id: householdId,
    p_debt_id: input.debtId,
    p_statement_id: input.statementId,
    p_statement_date: input.statementDate,
    p_due_date: input.dueDate,
    p_minimum_payment_amount: input.minimumPaymentAmount ?? null,
  };
}

export async function closeCreditCardStatement(input: CreditCardStatementCloseInput): Promise<CreditCardStatementCloseResult> {
  if (!isSupabaseConfigured || !supabase) throw new DebtOperationUnavailableError();

  const { data, error } = await supabase.rpc("close_credit_card_statement_v1", toCreditCardStatementCloseRpcArgs(input));
  if (error) {
    const mapped = mapCreditCardOperationError(error.message);
    if (mapped) throw mapped;
    throw error;
  }
  if (!data || typeof data !== "object") throw new Error("La RPC close_credit_card_statement_v1 no devolvió un resultado válido.");
  return {
    success: Boolean((data as any).success),
    statementId: String((data as any).statement_id),
    statementBalance: Number((data as any).statement_balance),
    minimumPaymentAmount: (data as any).minimum_payment_amount != null ? Number((data as any).minimum_payment_amount) : null,
    idempotent: Boolean((data as any).idempotent),
  };
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
    contractual_installment_number: input.contractualInstallmentNumber ?? input.installmentNumber,
    is_paid_before_tracking: input.isPaidBeforeTracking ?? false,
    due_date: input.dueDate,
    expected_amount: input.expectedAmount ?? null,
    expected_principal: input.expectedPrincipal ?? null,
    expected_interest: input.expectedInterest ?? null,
    expected_fees: input.expectedFees ?? null,
    expected_insurance: input.expectedInsurance ?? null,
    reported_balance: input.reportedBalance ?? null,
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
  "DEBT_ALREADY_EXISTS",
  "INVALID_DEBT_INPUT",
  "INVALID_INSTALLMENTS",
  "INVALID_COLLATERALS",
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
  "DEBT_NOT_BANK_LOAN",
  "DEBT_SCHEDULE_NOT_FOUND",
  "DEBT_EVENT_ALREADY_REVERSED",
  "DEBT_REVERSAL_SCHEDULE_REQUIRED",
  "DEBT_REVERSAL_SCHEDULE_NOT_ALLOWED",
  "DEBT_REVERSAL_SCHEDULE_CONFLICT",
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

function fromDebtScheduleUpdateResult(row: Record<string, any>): DebtScheduleUpdateResult {
  if (!row.scheduleVersion) throw new Error("La RPC de cronograma no devolvió una versión válida.");
  return {
    idempotentReplay: Boolean(row.idempotentReplay),
    debt: fromDebtRow(row.debt),
    event: fromDebtEventRow(row.event),
    scheduleVersion: fromDebtScheduleVersionRow(row.scheduleVersion),
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
  if (error.message?.includes("MOVEMENT_RECONCILED") || error.message === "MOVEMENT_RECONCILED") {
    return new MovementReconciledError();
  }
  switch (error.message) {
    case "DEBT_MOVEMENT_PROTECTED":
      return new DebtMovementProtectedError();
    case "MOVEMENT_CONTEXT_IMMUTABLE":
      return new MovementContextImmutableError();
    case "MOVEMENT_RECONCILED":
      return new MovementReconciledError();
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
    movementContext:
      row.movement_context === "debt_service"
        ? "debt_service"
        : row.movement_context === "credit_card_purchase"
        ? "credit_card_purchase"
        : row.movement_context === "credit_card_payment"
        ? "credit_card_payment"
        : row.movement_context === "credit_card_fee"
        ? "credit_card_fee"
        : row.movement_context === "credit_card_credit"
        ? "credit_card_credit"
        : "standard",
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
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
    currencyCode: String(row.currency_code ?? "PEN"),
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
    repaymentStructure: row.repayment_structure ?? "unknown",
    interestCalculationMode: row.interest_calculation_mode ?? "unknown",
    periodicRatePercent: row.periodic_rate_percent == null ? null : Number(row.periodic_rate_percent),
    periodicRateBasis: row.periodic_rate_basis ?? null,
    minimumPrincipalPayment: row.minimum_principal_payment == null ? null : Number(row.minimum_principal_payment),
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
    extraPrincipalAmount: row.extra_principal_amount == null ? 0 : Number(row.extra_principal_amount),
    prepaymentEffect: row.prepayment_effect ?? null,
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
    scheduleSource: row.schedule_source || "manual",
    isAuthoritative: row.is_authoritative != null ? Boolean(row.is_authoritative) : true,
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
    reportedBalance: row.reported_balance == null ? null : Number(row.reported_balance),
    contractualInstallmentNumber: row.contractual_installment_number == null
      ? Number(row.installment_number)
      : Number(row.contractual_installment_number),
    isPaidBeforeTracking: Boolean(row.is_paid_before_tracking),
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

export function fromBankLoanProfileRow(row: Record<string, any>): BankLoanProfile {
  return {
    debtId: row.debt_id,
    householdId: row.household_id,
    loanSubtype: row.loan_subtype,
    contractNumber: row.contract_number ?? null,
    amortizationMethod: row.amortization_method,
    disbursedAmount: row.disbursed_amount != null ? Number(row.disbursed_amount) : null,
    assetPrice: row.asset_price != null ? Number(row.asset_price) : null,
    downPaymentAmount: row.down_payment_amount != null ? Number(row.down_payment_amount) : null,
    financedAmount: row.financed_amount != null ? Number(row.financed_amount) : null,
    termInstallments: row.term_installments != null ? Number(row.term_installments) : null,
    installmentsPaidBeforeTracking: row.installments_paid_before_tracking == null
      ? 0
      : Number(row.installments_paid_before_tracking),
    interestDayCountBasis: row.interest_day_count_basis ?? null,
    dueDateAdjustmentRule: row.due_date_adjustment_rule ?? "unknown",
    installmentTotalMode: row.installment_total_mode ?? "unknown",
    reportedBalanceKind: row.reported_balance_kind ?? null,
    reportedBalanceAmount: row.reported_balance_amount == null ? null : Number(row.reported_balance_amount),
    gracePeriodType: row.grace_period_type ?? "none",
    gracePeriodInstallments: row.grace_period_installments != null ? Number(row.grace_period_installments) : null,
    balloonPaymentAmount: row.balloon_payment_amount != null ? Number(row.balloon_payment_amount) : null,
    notes: row.notes ?? "",
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function fromDebtInsuranceTermsRow(row: Record<string, any>): DebtInsuranceTerms {
  return {
    id: row.id,
    debtId: row.debt_id,
    householdId: row.household_id,
    insuranceType: row.insurance_type,
    label: row.label,
    pricingMode: row.pricing_mode,
    ratePercent: row.rate_percent != null ? Number(row.rate_percent) : null,
    fixedAmount: row.fixed_amount != null ? Number(row.fixed_amount) : null,
    rateBasis: row.rate_basis ?? null,
    isRequired: Boolean(row.is_required),
    provider: row.provider ?? null,
    policyReference: row.policy_reference ?? null,
    notes: row.notes ?? "",
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function fromCreditCardProfileRow(row: Record<string, any>): CreditCardProfile {
  return {
    debtId: String(row.debt_id),
    creditLimit: row.credit_limit != null ? Number(row.credit_limit) : null,
    closingDay: row.closing_day != null ? Number(row.closing_day) : null,
    dueDay: row.due_day != null ? Number(row.due_day) : null,
    last4: row.last4 ?? null,
    createdByUserId: String(row.created_by_user_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function fromCreditCardEntryRow(row: Record<string, any>): CreditCardEntry {
  return {
    id: String(row.id),
    debtId: String(row.debt_id),
    entryDate: String(row.entry_date),
    entryType: row.entry_type,
    liabilityDelta: Number(row.liability_delta),
    movementId: row.movement_id ?? null,
    creditOfEntryId: row.credit_of_entry_id ?? null,
    reversalOfEntryId: row.reversal_of_entry_id ?? null,
    description: String(row.description ?? ""),
    registeredByUserId: String(row.registered_by_user_id),
    createdAt: String(row.created_at),
  };
}

export function fromCreditCardStatementRow(row: Record<string, any>): CreditCardStatement {
  return {
    id: String(row.id),
    debtId: String(row.debt_id),
    statementDate: String(row.statement_date),
    dueDate: String(row.due_date),
    statementBalance: Number(row.statement_balance),
    minimumPaymentAmount: row.minimum_payment_amount != null ? Number(row.minimum_payment_amount) : null,
    closingEntryId: row.closing_entry_id ?? null,
    createdByUserId: String(row.created_by_user_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function toFinancialAccountRow(account: FinancialAccount) {
  return {
    id: account.id,
    household_id: householdId,
    name: account.name,
    reconciliation_type: account.reconciliationType,
    opening_balance: account.openingBalance,
    currency_code: account.currencyCode ?? "PEN",
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
    linked_debt_id: payment.linked_debt_id ?? payment.linkedDebtId ?? null,
    starts_on: payment.starts_on ?? payment.startsOn ?? null,
    currency_code: payment.currency_code ?? payment.currencyCode ?? "PEN",
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
    linked_debt_id: row.linked_debt_id ?? null,
    linkedDebtId: row.linked_debt_id ?? null,
    starts_on: row.starts_on ?? null,
    startsOn: row.starts_on ?? null,
    currency_code: row.currency_code ?? "PEN",
    currencyCode: row.currency_code ?? "PEN",
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
  linked_debt_id?: string | null;
  starts_on?: string | null;
  currency_code?: string | null;
}

export function fromAccountReconciliationRow(row: Record<string, any>): AccountReconciliation {
  return {
    id: String(row.id),
    householdId: String(row.household_id),
    accountId: String(row.account_id),
    reconciliationType: row.reconciliation_type === "balance" ? "balance" : "cash",
    currencyCode: String(row.currency_code ?? "PEN"),
    openingBalanceSnapshot: Number(row.opening_balance_snapshot),
    expectedBalance: Number(row.expected_balance),
    actualBalance: Number(row.actual_balance),
    difference: Number(row.difference),
    status: row.status === "matched" ? "matched" : "mismatch",
    denominations: row.denominations ?? null,
    registeredByUserId: String(row.registered_by_user_id),
    createdAt: String(row.created_at),
  };
}

export function fromAccountReconciliationMovementRow(row: Record<string, any>): AccountReconciliationMovement {
  return {
    id: String(row.id),
    householdId: String(row.household_id),
    reconciliationId: String(row.reconciliation_id),
    movementId: String(row.movement_id),
    balanceContribution: Number(row.balance_contribution),
    movementUpdatedAtSnapshot: String(row.movement_updated_at_snapshot),
    movementSnapshot: row.movement_snapshot ?? {},
    createdAt: String(row.created_at),
  };
}

export async function recordAccountReconciliation(input: RecordAccountReconciliationInput): Promise<RecordAccountReconciliationResult> {
  if (!isSupabaseConfigured || !supabase) {
    throw new DebtOperationUnavailableError();
  }

  const { data, error } = await supabase.rpc("record_account_reconciliation_v1", {
    p_household_id: householdId,
    p_reconciliation_id: input.reconciliationId,
    p_account_id: input.accountId,
    p_actual_balance: input.actualBalance ?? null,
    p_denominations: input.denominations ?? null,
  });

  if (error) {
    if (error.message?.includes("MOVEMENT_RECONCILED")) throw new MovementReconciledError();
    if (error.message?.includes("RECONCILIATION_ID_CONFLICT")) throw new ReconciliationIdConflictError();
    if (error.message?.includes("ACCOUNT_NOT_FOUND")) throw new FinancialAccountNotFoundError();
    throw new Error(error.message || "Error al registrar la conciliación.");
  }

  return {
    success: Boolean(data?.success),
    reconciliationId: String(data?.reconciliation_id),
    status: data?.status === "matched" ? "matched" : "mismatch",
    openingBalanceSnapshot: Number(data?.opening_balance_snapshot),
    expectedBalance: Number(data?.expected_balance),
    actualBalance: Number(data?.actual_balance),
    difference: Number(data?.difference),
    movementsCount: Number(data?.movements_count),
    idempotent: Boolean(data?.idempotent),
  };
}

export function fromMovementCorrectionRow(row: Record<string, any>): MovementCorrection {
  return {
    id: String(row.id),
    householdId: String(row.household_id),
    movementId: String(row.movement_id),
    correctionId: String(row.correction_id),
    requestSnapshot: row.request_snapshot ?? {},
    beforeSnapshot: row.before_snapshot ?? {},
    afterSnapshot: row.after_snapshot ?? {},
    reason: String(row.reason),
    registeredByUserId: String(row.registered_by_user_id),
    createdAt: String(row.created_at),
  };
}

export interface CorrectReconciledMovementInput {
  movementId: string;
  correctionId: string;
  expectedUpdatedAt: string;
  date: string;
  amount: number;
  description: string;
  method: string;
  category: string;
  person?: string | null;
  accountId?: string | null;
  reason: string;
}

export interface CorrectReconciledMovementResult {
  movement: Movement;
  correction: MovementCorrection;
  idempotent?: boolean;
}

function mapMovementCorrectionError(error: { message?: string }) {
  if (error.message?.includes("MOVEMENT_CORRECTION_ID_CONFLICT") || error.message === "MOVEMENT_CORRECTION_ID_CONFLICT") {
    return new MovementCorrectionIdConflictError();
  }
  if (error.message?.includes("MOVEMENT_CORRECTION_CONFLICT") || error.message === "MOVEMENT_CORRECTION_CONFLICT") {
    return new MovementCorrectionConflictError();
  }
  if (error.message?.includes("MOVEMENT_NOT_RECONCILED") || error.message === "MOVEMENT_NOT_RECONCILED") {
    return new MovementNotReconciledError();
  }
  if (error.message?.includes("MOVEMENT_RECONCILED") || error.message === "MOVEMENT_RECONCILED") {
    return new MovementReconciledError();
  }
  switch (error.message) {
    case "DEBT_MOVEMENT_PROTECTED":
      return new DebtMovementProtectedError();
    case "CREDIT_CARD_MOVEMENT_PROTECTED":
      return new DebtMovementProtectedError();
    case "MOVEMENT_CONTEXT_IMMUTABLE":
      return new MovementContextImmutableError();
    default:
      return null;
  }
}

export async function correctReconciledMovementV1(
  input: CorrectReconciledMovementInput
): Promise<CorrectReconciledMovementResult> {
  if (!isSupabaseConfigured || !supabase) {
    throw new DebtOperationUnavailableError();
  }

  if (!input.correctionId) {
    throw new Error("El ID de corrección es obligatorio.");
  }

  const { data, error } = await supabase.rpc("correct_reconciled_movement_v1", {
    p_household_id: householdId,
    p_movement_id: input.movementId,
    p_correction_id: input.correctionId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_date: input.date,
    p_amount: input.amount,
    p_description: input.description,
    p_method: input.method,
    p_category: input.category,
    p_person: input.person ?? null,
    p_account_id: input.accountId ?? null,
    p_reason: input.reason,
  });

  if (error) {
    const mapped = mapMovementCorrectionError(error);
    throw mapped ?? new Error(error.message || "Error al corregir el movimiento conciliado.");
  }

  if (!data || (!data.after_snapshot && !data.movement) || !data.correction) {
    throw new Error("Supabase no devolvió la corrección esperada.");
  }

  const movementRow = data.after_snapshot ?? data.movement;

  return {
    movement: fromMovementRow(movementRow),
    correction: fromMovementCorrectionRow(data.correction),
    idempotent: Boolean(data.idempotent),
  };
}
