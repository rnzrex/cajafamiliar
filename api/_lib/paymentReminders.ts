import webpush from "web-push";
import type {
  CreditCardEntry,
  CreditCardProfile,
  CreditCardStatement,
  Debt,
  DebtEvent,
  DebtEventInstallmentAllocation,
  DebtInstallment,
  DebtScheduleVersion,
  RecurringPayment,
} from "../../src/types.js";
import { formatMoneyByCurrency, paymentAlert } from "../../src/utils/calculations.js";
import { localDateString } from "../../src/utils/date.js";
import type { DebtInstallmentPlanningItem } from "../../src/utils/debtPlanning.js";
import {
  buildDebtPlanningItems,
  selectDebtPlanningAttentionItems,
} from "../../src/utils/debtPlanning.js";
import {
  buildCreditCardStatementAlerts,
  selectUrgentCreditCardStatementAlertsForReminder,
  type CreditCardStatementAlertItem,
} from "../../src/utils/creditCardCalculations.js";
import { createSupabaseAdmin, readServerEnvironment } from "./supabaseAdmin.js";

/**
 * Historical stable identifier for the single daily urgent obligation push delivery.
 * Unique index on (subscription_id, notification_date, notification_type) guarantees
 * at most ONE push delivery per subscription per day. DO NOT alter this string.
 */
export const NOTIFICATION_TYPE = "urgent-payments-v1";

interface PushSubscriptionRow {
  id: string;
  household_id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expires_at?: string | null;
}

interface HouseholdMemberRow {
  household_id: string;
  user_id: string;
  display_name: string;
}

interface RecurringPaymentRow {
  id: string;
  household_id: string;
  name: string;
  amount: number | null;
  amount_mode: string;
  due_day: number | null;
  due_date: string | null;
  category: string;
  status: string;
  notes: string | null;
  recurrence_type: string;
  total_installments: number | null;
  paid_installments: number | null;
  is_active: boolean;
  last_paid_month: number | null;
  last_paid_year: number | null;
  paid_at: string | null;
}

export interface ObligationReminderPayloadInput {
  urgentRecurringPayments: RecurringPayment[];
  urgentDebtInstallments: DebtInstallmentPlanningItem[];
  urgentCardAlerts?: CreditCardStatementAlertItem[];
  today: string;
}

export interface ObligationReminderPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface ReminderSummary {
  subscriptions: number;
  sent: number;
  skipped: number;
  failed: number;
  deactivated: number;
  recurringUrgent: number;
  debtUrgent: number;
  cardUrgent?: number;
}

/**
 * Pure helper to build the consolidated push notification payload
 * for urgent recurring payments, debt installments, and card statement alerts.
 */
export function buildObligationReminderPayload({
  urgentRecurringPayments,
  urgentDebtInstallments,
  urgentCardAlerts = [],
  today,
}: ObligationReminderPayloadInput): ObligationReminderPayload {
  const numRecurring = urgentRecurringPayments.length;
  const numDebt = urgentDebtInstallments.length;
  const numCard = urgentCardAlerts.length;
  const total = numRecurring + numDebt + numCard;

  let body = "";
  let url = "/?view=dashboard";

  if (numCard === 0) {
    if (numRecurring > 0 && numDebt === 0) {
      body =
        numRecurring === 1
          ? "Tienes 1 pago que requiere atención."
          : `Tienes ${numRecurring} pagos que requieren atención.`;
      url =
        numRecurring === 1
          ? `/?view=pagos&payment=${encodeURIComponent(urgentRecurringPayments[0].id)}`
          : "/?view=pagos";
    } else if (numDebt > 0 && numRecurring === 0) {
      body =
        numDebt === 1
          ? "Tienes 1 cuota de deuda que requiere atención."
          : `Tienes ${numDebt} cuotas de deuda que requieren atención.`;
      url =
        numDebt === 1
          ? `/?view=deudas&debt=${encodeURIComponent(urgentDebtInstallments[0].debtId)}`
          : "/?view=deudas";
    } else if (numRecurring > 0 && numDebt > 0) {
      const recurringText = numRecurring === 1 ? "1 pago" : `${numRecurring} pagos`;
      const debtText = numDebt === 1 ? "1 cuota de deuda" : `${numDebt} cuotas de deuda`;
      body = `Tienes ${total} obligaciones que requieren atención: ${recurringText} y ${debtText}.`;
      url = "/?view=dashboard";
    }
  } else {
    if (total === 1 && numCard === 1) {
      const card = urgentCardAlerts[0];
      const minPayText = card.minimumPaymentKnown
        ? `. Pago mínimo: ${formatMoneyByCurrency(card.minimumPaymentAmount!, card.currencyCode)}`
        : " (pago mínimo no registrado)";
      body = `${card.cardName} — estado de cuenta vence. ${minPayText}`;
      url = "/?view=deudas";
    } else {
      const parts: string[] = [];
      if (numRecurring > 0) parts.push(numRecurring === 1 ? "1 pago" : `${numRecurring} pagos`);
      if (numDebt > 0) parts.push(numDebt === 1 ? "1 cuota de deuda" : `${numDebt} cuotas de deuda`);
      if (numCard > 0) parts.push(numCard === 1 ? "1 estado de cuenta de tarjeta" : `${numCard} estados de cuenta de tarjeta`);

      const textSummary = parts.length === 2 ? parts.join(" y ") : parts.join(", ");
      body = `Tienes ${total} obligaciones que requieren atención: ${textSummary}.`;
      url = "/?view=dashboard";
    }
  }

  return {
    title: "Caja Familiar",
    body,
    url,
    tag: `urgent-payments-${today}`,
  };
}

export async function runPaymentReminderJob(): Promise<ReminderSummary> {
  const environment = readServerEnvironment();
  const admin = createSupabaseAdmin(environment);
  const today = localDateString();
  webpush.setVapidDetails(environment.vapidSubject, environment.vapidPublicKey, environment.vapidPrivateKey);

  const subscriptions = await loadSubscriptions(admin, environment.appOrigin);
  const urgentPaymentsByHousehold = await loadUrgentPayments(admin, subscriptions);
  const urgentDebtsByHousehold = await loadUrgentDebtInstallments(admin, subscriptions, today);
  const urgentCardAlertsByHousehold = await loadUrgentCardStatementAlerts(admin, subscriptions, today);

  let totalRecurringUrgent = 0;
  for (const list of urgentPaymentsByHousehold.values()) {
    totalRecurringUrgent += list.length;
  }
  let totalDebtUrgent = 0;
  for (const list of urgentDebtsByHousehold.values()) {
    totalDebtUrgent += list.length;
  }
  let totalCardUrgent = 0;
  for (const list of urgentCardAlertsByHousehold.values()) {
    totalCardUrgent += list.length;
  }

  const summary: ReminderSummary = {
    subscriptions: subscriptions.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    deactivated: 0,
    recurringUrgent: totalRecurringUrgent,
    debtUrgent: totalDebtUrgent,
    cardUrgent: totalCardUrgent,
  };

  for (const subscription of subscriptions) {
    const urgentPayments = urgentPaymentsByHousehold.get(subscription.household_id) ?? [];
    const urgentDebts = urgentDebtsByHousehold.get(subscription.household_id) ?? [];
    const urgentCards = urgentCardAlertsByHousehold.get(subscription.household_id) ?? [];

    if (urgentPayments.length === 0 && urgentDebts.length === 0 && urgentCards.length === 0) {
      summary.skipped += 1;
      continue;
    }

    const delivery = await claimDelivery(admin, subscription, today);
    if (delivery === "duplicate") {
      summary.skipped += 1;
      continue;
    }

    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: urgentPayments,
      urgentDebtInstallments: urgentDebts,
      urgentCardAlerts: urgentCards,
      today,
    });

    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          expirationTime: subscription.expires_at ? Date.parse(subscription.expires_at) : null,
        },
        JSON.stringify(payload)
      );

      const { error: deliveryError } = await admin
        .from("push_notification_deliveries")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", delivery.id);
      if (deliveryError) throw deliveryError;

      await markSubscriptionSuccess(admin, subscription.id);
      summary.sent += 1;
    } catch (error) {
      const errorCode = normalizePushErrorCode(error);
      await admin
        .from("push_notification_deliveries")
        .update({ status: "failed", error_code: errorCode })
        .eq("id", delivery.id);
      await markSubscriptionFailure(admin, subscription.id);

      if (isExpiredPushError(error)) {
        await admin
          .from("push_subscriptions")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("id", subscription.id);
        summary.deactivated += 1;
      }
      summary.failed += 1;
    }
  }

  return summary;
}

async function loadSubscriptions(
  admin: ReturnType<typeof createSupabaseAdmin>,
  appOrigin: string
): Promise<PushSubscriptionRow[]> {
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id,household_id,user_id,endpoint,p256dh,auth,expires_at")
    .eq("is_active", true)
    .eq("app_origin", appOrigin);
  if (error) throw error;
  const rows = (data ?? []) as PushSubscriptionRow[];
  if (rows.length === 0) return rows;

  const householdIds = [...new Set(rows.map((row) => row.household_id))];
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const { data: members, error: memberError } = await admin
    .from("household_members")
    .select("household_id,user_id,display_name")
    .in("household_id", householdIds)
    .in("user_id", userIds);
  if (memberError) throw memberError;

  const authorizedMembers = new Set(
    ((members ?? []) as HouseholdMemberRow[])
      .filter((member) => Boolean(member.display_name?.trim()))
      .map((member) => `${member.household_id}:${member.user_id}`)
  );
  return rows.filter((row) => authorizedMembers.has(`${row.household_id}:${row.user_id}`));
}

async function loadUrgentPayments(
  admin: ReturnType<typeof createSupabaseAdmin>,
  subscriptions: PushSubscriptionRow[]
) {
  const householdIds = [...new Set(subscriptions.map((subscription) => subscription.household_id))];
  const grouped = new Map<string, RecurringPayment[]>();
  if (householdIds.length === 0) return grouped;

  const { data, error } = await admin
    .from("recurring_payments")
    .select(
      "id,household_id,name,amount,amount_mode,due_day,due_date,category,status,notes,recurrence_type,total_installments,paid_installments,is_active,last_paid_month,last_paid_year,paid_at"
    )
    .in("household_id", householdIds);
  if (error) throw error;

  for (const row of (data ?? []) as RecurringPaymentRow[]) {
    const payment = toRecurringPayment(row);
    if (!paymentAlert(payment)) continue;
    const householdPayments = grouped.get(row.household_id) ?? [];
    householdPayments.push(payment);
    grouped.set(row.household_id, householdPayments);
  }
  return grouped;
}

async function loadUrgentDebtInstallments(
  admin: ReturnType<typeof createSupabaseAdmin>,
  subscriptions: PushSubscriptionRow[],
  today: string
) {
  const householdIds = [...new Set(subscriptions.map((s) => s.household_id))];
  const grouped = new Map<string, DebtInstallmentPlanningItem[]>();
  if (householdIds.length === 0) return grouped;

  const [debtsRes, versionsRes, installmentsRes, eventsRes, allocationsRes] = await Promise.all([
    admin.from("debts").select("*").in("household_id", householdIds),
    admin.from("debt_schedule_versions").select("*").in("household_id", householdIds),
    admin.from("debt_installments").select("*").in("household_id", householdIds),
    admin.from("debt_events").select("*").in("household_id", householdIds),
    admin.from("debt_event_installment_allocations").select("*").in("household_id", householdIds),
  ]);

  if (debtsRes.error) throw debtsRes.error;
  if (versionsRes.error) throw versionsRes.error;
  if (installmentsRes.error) throw installmentsRes.error;
  if (eventsRes.error) throw eventsRes.error;
  if (allocationsRes.error) throw allocationsRes.error;

  const rawDebts = debtsRes.data ?? [];
  const rawVersions = versionsRes.data ?? [];
  const rawInstallments = installmentsRes.data ?? [];
  const rawEvents = eventsRes.data ?? [];
  const rawAllocations = allocationsRes.data ?? [];

  for (const householdId of householdIds) {
    const debts = rawDebts.filter((r: any) => r.household_id === householdId).map(fromDebtRow);
    const versions = rawVersions.filter((r: any) => r.household_id === householdId).map(fromDebtScheduleVersionRow);
    const installments = rawInstallments.filter((r: any) => r.household_id === householdId).map(fromDebtInstallmentRow);
    const events = rawEvents.filter((r: any) => r.household_id === householdId).map(fromDebtEventRow);
    const allocations = rawAllocations.filter((r: any) => r.household_id === householdId).map(fromDebtEventInstallmentAllocationRow);

    const urgentItems = selectUrgentDebtInstallmentsForReminder(
      debts,
      events,
      versions,
      installments,
      allocations,
      today
    );

    grouped.set(householdId, urgentItems);
  }

  return grouped;
}

async function loadUrgentCardStatementAlerts(
  admin: ReturnType<typeof createSupabaseAdmin>,
  subscriptions: PushSubscriptionRow[],
  today: string
) {
  const householdIds = [...new Set(subscriptions.map((s) => s.household_id))];
  const grouped = new Map<string, CreditCardStatementAlertItem[]>();
  if (householdIds.length === 0) return grouped;

  const [debtsRes, profilesRes, entriesRes, statementsRes] = await Promise.all([
    admin.from("debts").select("*").in("household_id", householdIds).eq("debt_kind", "credit_card"),
    admin.from("credit_card_profiles").select("*").in("household_id", householdIds),
    admin.from("credit_card_entries").select("*").in("household_id", householdIds),
    admin.from("credit_card_statements").select("*").in("household_id", householdIds),
  ]);

  if (debtsRes.error) throw debtsRes.error;
  if (profilesRes.error) throw profilesRes.error;
  if (entriesRes.error) throw entriesRes.error;
  if (statementsRes.error) throw statementsRes.error;

  const rawDebts = debtsRes.data ?? [];
  const rawProfiles = profilesRes.data ?? [];
  const rawEntries = entriesRes.data ?? [];
  const rawStatements = statementsRes.data ?? [];

  for (const householdId of householdIds) {
    const debts = rawDebts.filter((r: any) => r.household_id === householdId).map(fromDebtRow);
    const profiles = rawProfiles.filter((r: any) => r.household_id === householdId).map(fromCreditCardProfileRow);
    const entries = rawEntries.filter((r: any) => r.household_id === householdId).map(fromCreditCardEntryRow);
    const statements = rawStatements.filter((r: any) => r.household_id === householdId).map(fromCreditCardStatementRow);

    const alerts = buildCreditCardStatementAlerts({
      debts,
      creditCardProfiles: profiles,
      creditCardEntries: entries,
      creditCardStatements: statements,
      todayKey: today,
    });

    const urgentAlerts = selectUrgentCreditCardStatementAlertsForReminder(alerts);
    grouped.set(householdId, urgentAlerts);
  }

  return grouped;
}

/**
 * Pure helper to compute urgent debt planning items for push reminders.
 * Reuses buildDebtPlanningItems SSOT and selectDebtPlanningAttentionItems.
 */
export function selectUrgentDebtInstallmentsForReminder(
  debts: Debt[],
  debtEvents: DebtEvent[],
  scheduleVersions: DebtScheduleVersion[],
  installments: DebtInstallment[],
  allocations: DebtEventInstallmentAllocation[],
  today: string
): DebtInstallmentPlanningItem[] {
  const planningItems = buildDebtPlanningItems(
    debts,
    debtEvents,
    scheduleVersions,
    installments,
    allocations,
    today
  );
  return selectDebtPlanningAttentionItems(planningItems, planningItems.length);
}

async function claimDelivery(
  admin: ReturnType<typeof createSupabaseAdmin>,
  subscription: PushSubscriptionRow,
  notificationDate: string
) {
  const { data, error } = await admin
    .from("push_notification_deliveries")
    .insert({
      subscription_id: subscription.id,
      household_id: subscription.household_id,
      user_id: subscription.user_id,
      notification_date: notificationDate,
      notification_type: NOTIFICATION_TYPE,
      status: "claimed",
    })
    .select("id")
    .maybeSingle();

  if (error?.code === "23505") return "duplicate" as const;
  if (error) throw error;
  if (!data) throw new Error("PUSH_DELIVERY_CLAIM_FAILED");
  return { id: data.id as string };
}

async function markSubscriptionSuccess(
  admin: ReturnType<typeof createSupabaseAdmin>,
  subscriptionId: string
) {
  await admin
    .from("push_subscriptions")
    .update({ last_success_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", subscriptionId);
}

async function markSubscriptionFailure(
  admin: ReturnType<typeof createSupabaseAdmin>,
  subscriptionId: string
) {
  await admin
    .from("push_subscriptions")
    .update({ last_failure_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", subscriptionId);
}

function toRecurringPayment(row: RecurringPaymentRow): RecurringPayment {
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
    recurrence_type:
      row.recurrence_type === "fixed" || row.recurrence_type === "one_time"
        ? row.recurrence_type
        : "indefinite",
    total_installments: row.total_installments == null ? null : Number(row.total_installments),
    paid_installments: row.paid_installments == null ? 0 : Number(row.paid_installments),
    is_active: Boolean(row.is_active),
    last_paid_month: row.last_paid_month == null ? null : Number(row.last_paid_month),
    last_paid_year: row.last_paid_year == null ? null : Number(row.last_paid_year),
    paidAt: row.paid_at ?? null,
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

function fromDebtEventInstallmentAllocationRow(
  row: Record<string, any>
): DebtEventInstallmentAllocation {
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

function isExpiredPushError(error: unknown) {
  return getPushStatusCode(error) === 404 || getPushStatusCode(error) === 410;
}

function normalizePushErrorCode(error: unknown) {
  const statusCode = getPushStatusCode(error);
  if (statusCode) return `HTTP_${statusCode}`;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Za-z0-9_-]+$/.test(error.code)
  )
    return error.code.slice(0, 64).toUpperCase();
  return "PUSH_SEND_FAILED";
}

function getPushStatusCode(error: unknown) {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null;
  return typeof error.statusCode === "number" ? error.statusCode : null;
}

export function fromCreditCardProfileRow(row: Record<string, any>): CreditCardProfile {
  return {
    debtId: row.debt_id,
    creditLimit: row.credit_limit == null ? null : Number(row.credit_limit),
    closingDay: row.closing_day == null ? null : Number(row.closing_day),
    dueDay: row.due_day == null ? null : Number(row.due_day),
    last4: row.last4 ?? null,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function fromCreditCardEntryRow(row: Record<string, any>): CreditCardEntry {
  return {
    id: row.id,
    debtId: row.debt_id,
    entryDate: row.entry_date,
    entryType: row.entry_type,
    liabilityDelta: Number(row.liability_delta),
    movementId: row.movement_id ?? null,
    reversalOfEntryId: row.reversal_of_entry_id ?? null,
    creditOfEntryId: row.credit_of_entry_id ?? null,
    description: row.description ?? "",
    registeredByUserId: row.registered_by_user_id,
    createdAt: row.created_at,
  };
}

export function fromCreditCardStatementRow(row: Record<string, any>): CreditCardStatement {
  return {
    id: row.id,
    debtId: row.debt_id,
    statementDate: row.statement_date,
    dueDate: row.due_date,
    statementBalance: Number(row.statement_balance),
    minimumPaymentAmount: row.minimum_payment_amount == null ? null : Number(row.minimum_payment_amount),
    closingEntryId: row.closing_entry_id ?? null,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
