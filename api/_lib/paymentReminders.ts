import webpush from "web-push";
import type { RecurringPayment } from "../../src/types.js";
import { paymentAlert } from "../../src/utils/calculations.js";
import { localDateString } from "../../src/utils/date.js";
import { createSupabaseAdmin, readServerEnvironment } from "./supabaseAdmin.js";

const NOTIFICATION_TYPE = "urgent-payments-v1";

interface PushSubscriptionRow {
  id: string;
  household_id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expires_at: string | null;
}

interface HouseholdMemberRow {
  household_id: string;
  user_id: string;
  display_name: string | null;
}

interface RecurringPaymentRow {
  id: string;
  household_id: string;
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

interface ReminderSummary {
  subscriptions: number;
  sent: number;
  skipped: number;
  failed: number;
  deactivated: number;
}

export async function runPaymentReminderJob(): Promise<ReminderSummary> {
  const environment = readServerEnvironment();
  const admin = createSupabaseAdmin(environment);
  const today = localDateString();
  webpush.setVapidDetails(environment.vapidSubject, environment.vapidPublicKey, environment.vapidPrivateKey);

  const subscriptions = await loadSubscriptions(admin, environment.appOrigin);
  const urgentByHousehold = await loadUrgentPayments(admin, subscriptions);
  const summary: ReminderSummary = { subscriptions: subscriptions.length, sent: 0, skipped: 0, failed: 0, deactivated: 0 };

  for (const subscription of subscriptions) {
    const urgentPayments = urgentByHousehold.get(subscription.household_id) ?? [];
    if (urgentPayments.length === 0) {
      summary.skipped += 1;
      continue;
    }

    const delivery = await claimDelivery(admin, subscription, today);
    if (delivery === "duplicate") {
      summary.skipped += 1;
      continue;
    }

    const payload = {
      title: "Caja Familiar",
      body: urgentPayments.length === 1 ? "Tienes 1 pago que requiere atención." : `Tienes ${urgentPayments.length} pagos que requieren atención.`,
      url: urgentPayments.length === 1 ? `/?view=pagos&payment=${encodeURIComponent(urgentPayments[0].id)}` : "/?view=pagos",
      tag: `urgent-payments-${today}`,
    };

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
        await admin.from("push_subscriptions").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", subscription.id);
        summary.deactivated += 1;
      }
      summary.failed += 1;
    }
  }

  return summary;
}

async function loadSubscriptions(admin: ReturnType<typeof createSupabaseAdmin>, appOrigin: string): Promise<PushSubscriptionRow[]> {
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

async function loadUrgentPayments(admin: ReturnType<typeof createSupabaseAdmin>, subscriptions: PushSubscriptionRow[]) {
  const householdIds = [...new Set(subscriptions.map((subscription) => subscription.household_id))];
  const grouped = new Map<string, RecurringPayment[]>();
  if (householdIds.length === 0) return grouped;

  const { data, error } = await admin
    .from("recurring_payments")
    .select("id,household_id,name,amount,amount_mode,due_day,due_date,category,status,notes,recurrence_type,total_installments,paid_installments,is_active,last_paid_month,last_paid_year,paid_at")
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

async function claimDelivery(admin: ReturnType<typeof createSupabaseAdmin>, subscription: PushSubscriptionRow, notificationDate: string) {
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

async function markSubscriptionSuccess(admin: ReturnType<typeof createSupabaseAdmin>, subscriptionId: string) {
  await admin
    .from("push_subscriptions")
    .update({ last_success_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", subscriptionId);
}

async function markSubscriptionFailure(admin: ReturnType<typeof createSupabaseAdmin>, subscriptionId: string) {
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
    recurrence_type: row.recurrence_type === "fixed" || row.recurrence_type === "one_time" ? row.recurrence_type : "indefinite",
    total_installments: row.total_installments == null ? null : Number(row.total_installments),
    paid_installments: row.paid_installments == null ? 0 : Number(row.paid_installments),
    is_active: Boolean(row.is_active),
    last_paid_month: row.last_paid_month == null ? null : Number(row.last_paid_month),
    last_paid_year: row.last_paid_year == null ? null : Number(row.last_paid_year),
    paidAt: row.paid_at ?? null,
  };
}

function isExpiredPushError(error: unknown) {
  return getPushStatusCode(error) === 404 || getPushStatusCode(error) === 410;
}

function normalizePushErrorCode(error: unknown) {
  const statusCode = getPushStatusCode(error);
  if (statusCode) return `HTTP_${statusCode}`;
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Za-z0-9_-]+$/.test(error.code)) return error.code.slice(0, 64).toUpperCase();
  return "PUSH_SEND_FAILED";
}

function getPushStatusCode(error: unknown) {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null;
  return typeof error.statusCode === "number" ? error.statusCode : null;
}
