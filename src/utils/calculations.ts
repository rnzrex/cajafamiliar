import type { CashCount, CreditCardEntry, DebtEvent, Movement, RecurringPayment } from "../types.js";
import { formatLocalDate, localDateString, localMonthString, parseLocalDate } from "./date.js";
import { getMovementEconomics } from "./movementEconomics.js";
import { isCreditCardMovementEffective } from "./creditCardCalculations.js";
import { dueDateStatus as genericDueDateStatus } from "./dueDates.js";

export type PaymentStatusKind = "overdue" | "today" | "tomorrow" | "upcoming" | "later" | "paid" | "completed" | "inactive";

export interface PaymentStatus {
  kind: PaymentStatusKind;
  label: string;
  tone: "red" | "orange" | "yellow" | "blue" | "green" | "slate";
  days: number;
  dueDate?: string;
}

const penFormatter = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
  currencyDisplay: "symbol",
});

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  currencyDisplay: "narrowSymbol",
});

export const formatMoneyByCurrency = (value: number, currencyCode?: string) => {
  const code = (currencyCode || "PEN").toUpperCase();
  if (code === "USD") {
    return usdFormatter.format(value);
  }
  return penFormatter.format(value).replace("PEN", "S/");
};

export const formatMoney = (value: number) => formatMoneyByCurrency(value, "PEN");

export const monthKey = (date: string) => date.slice(0, 7);

export function expectedCash(
  movements: Movement[],
  initialBalance: number,
  cashAccountId?: string | null,
  creditCardEntries: CreditCardEntry[] = []
) {
  return movements.reduce((total, movement) => {
    const belongsToCash = cashAccountId != null ? (movement.accountId === cashAccountId || (movement.accountId == null && movement.method === "efectivo")) : movement.method === "efectivo";
    if (!belongsToCash) return total;
    if (creditCardEntries.length > 0 && !isCreditCardMovementEffective(movement.id, creditCardEntries)) {
      return total;
    }
    return movement.type === "ingreso" ? total + movement.amount : total - movement.amount;
  }, initialBalance);
}

export function monthlyTotals(
  movements: Movement[],
  selectedMonth = localMonthString(),
  debtEvents: DebtEvent[] = [],
  creditCardEntries: CreditCardEntry[] = []
) {
  return movements
    .filter((movement) => monthKey(movement.date) === selectedMonth)
    .reduce(
      (totals, movement) => {
        if (movement.type === "ingreso") {
          totals.income += movement.amount;
        } else {
          const economics = getMovementEconomics(movement, debtEvents, creditCardEntries);
          totals.cashOutflow += economics.cashOutflow;
          totals.expense += economics.economicExpense;
        }
        return totals;
      },
      { income: 0, cashOutflow: 0, expense: 0 }
    );
}

export function topExpenseCategory(
  movements: Movement[],
  selectedMonth = localMonthString(),
  debtEvents: DebtEvent[] = [],
  creditCardEntries: CreditCardEntry[] = []
) {
  const totals = new Map<string, number>();
  movements
    .filter((movement) => movement.type === "egreso" && monthKey(movement.date) === selectedMonth)
    .forEach((movement) => {
      const expense = getMovementEconomics(movement, debtEvents, creditCardEntries).economicExpense;
      if (expense > 0) totals.set(movement.category, (totals.get(movement.category) ?? 0) + expense);
    });

  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Sin gastos";
}

export function lastCashCount(cashCounts: CashCount[]) {
  return [...cashCounts].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/**
 * Pure helper to determine if a recurring payment's obligation is covered for a given target month (YYYY-MM).
 *
 * For DEBT-LINKED recurring payments:
 * - Current/target month is covered iff (last_paid_year, last_paid_month) >= target (year, month)
 *   AND the recurring obligation has already started in or before the target month.
 * - Stale persisted payment.status = 'pagado' is IGNORED for current-cycle truth.
 *
 * For ORDINARY/MANUAL recurring payments:
 * - Current/target month is covered iff (last_paid_year, last_paid_month) === target (year, month).
 */
export function isRecurringPaymentCoveredForMonth(
  payment: RecurringPayment,
  targetMonthKey: string = localMonthString()
): boolean {
  if (payment.last_paid_year == null || payment.last_paid_month == null) {
    return false;
  }

  const [tYear, tMonth] = targetMonthKey.split("-").map(Number);
  if (!tYear || !tMonth) return false;

  const linkedDebtId = payment.linked_debt_id ?? payment.linkedDebtId ?? null;
  const startsOn = payment.starts_on ?? payment.startsOn ?? null;

  if (linkedDebtId) {
    if (startsOn && startsOn.slice(0, 7) > targetMonthKey) {
      return false;
    }
    if (payment.last_paid_year > tYear) return true;
    if (payment.last_paid_year === tYear && payment.last_paid_month >= tMonth) return true;
    return false;
  }

  return payment.last_paid_year === tYear && payment.last_paid_month === tMonth;
}

export function paymentStatus(payment: RecurringPayment): PaymentStatus {
  const todayKey = localDateString();
  const today = parseLocalDate(todayKey);

  if (!today) return { kind: "later", label: "Fecha por confirmar", tone: "blue", days: 999 };

  if (payment.recurrence_type === "one_time") {
    if (payment.status === "pagado") return { kind: "completed", label: "Pagado", tone: "green", days: 999 };
    if (!payment.is_active) return { kind: "inactive", label: "Archivado", tone: "slate", days: 999 };
    return dueDateStatus(payment.dueDate, today);
  }

  if (isPaymentFinished(payment)) return { kind: "completed", label: "Finalizado", tone: "green", days: 999 };
  if (!payment.is_active) return { kind: "inactive", label: "Archivado", tone: "slate", days: 999 };

  const currentMonthKey = todayKey.slice(0, 7);
  const isCovered = isRecurringPaymentCoveredForMonth(payment, currentMonthKey);

  if (isCovered) {
    const dueDate = monthlyDueDate(payment.dueDay, todayKey);
    return { kind: "paid", label: "Pagado este mes", tone: "green", days: 0, dueDate: dueDate ?? undefined };
  }

  const startsOn = payment.starts_on ?? payment.startsOn;
  if (startsOn && todayKey < startsOn) {
    return dueDateStatus(startsOn, today);
  }

  const dueDate = monthlyDueDate(payment.dueDay, todayKey);
  if (!dueDate) return { kind: "later", label: "Fecha por confirmar", tone: "blue", days: 999 };
  return dueDateStatus(dueDate, today);
}

export function paymentAlert(payment: RecurringPayment) {
  const status = paymentStatus(payment);
  return status.kind === "overdue" || status.kind === "today" || status.kind === "tomorrow" ? status : null;
}

export interface PaymentAlertSummary {
  overdue: number;
  today: number;
  tomorrow: number;
  total: number;
}

export function paymentAlertSummary(payments: RecurringPayment[]): PaymentAlertSummary {
  return payments.reduce(
    (summary, payment) => {
      const alert = paymentAlert(payment);
      if (!alert) return summary;

      if (alert.kind === "overdue") summary.overdue += 1;
      if (alert.kind === "today") summary.today += 1;
      if (alert.kind === "tomorrow") summary.tomorrow += 1;
      summary.total += 1;
      return summary;
    },
    { overdue: 0, today: 0, tomorrow: 0, total: 0 }
  );
}

export function isPaymentPaidThisMonth(payment: RecurringPayment, date = new Date()) {
  const month = localMonthString(date);
  return isRecurringPaymentCoveredForMonth(payment, month);
}

export function isPaymentFinished(payment: RecurringPayment) {
  return payment.recurrence_type === "fixed" && Boolean(payment.total_installments) && payment.paid_installments >= Number(payment.total_installments);
}

export function installmentLabel(payment: RecurringPayment) {
  if (payment.recurrence_type !== "fixed" || !payment.total_installments) return "Mensual indefinido";
  const visibleInstallment = Math.min(payment.paid_installments + (isPaymentPaidThisMonth(payment) ? 0 : 1), payment.total_installments);
  return `Cuota ${visibleInstallment} de ${payment.total_installments}`;
}

export function paymentAmountLabel(payment: RecurringPayment) {
  if (payment.amount_mode === "variable") {
    return payment.amount == null ? "Monto por confirmar" : `Monto variable · Aprox. ${formatMoney(payment.amount)}`;
  }
  return payment.amount == null ? "Monto por confirmar" : formatMoney(payment.amount);
}

export function paymentScheduleLabel(payment: RecurringPayment) {
  if (payment.recurrence_type === "one_time") return payment.dueDate ? formatLocalDate(payment.dueDate) : "Fecha por confirmar";
  if (payment.dueDay == null) return "Fecha por confirmar";
  const monthlySchedule = `Día ${payment.dueDay} de cada mes`;
  return payment.recurrence_type === "fixed" ? `${installmentLabel(payment)} · ${monthlySchedule}` : monthlySchedule;
}

/**
 * Adapter: converts the generic dueDateStatus (todayKey-based) to the
 * legacy internal signature (Date-based) used by paymentStatus().
 * PaymentStatus is a superset of DueDateStatus (adds "green"/"slate" tones),
 * so we widen the return type here.
 */
function dueDateStatus(dueDate: string | null, today: Date): PaymentStatus {
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, "0");
  const d = String(today.getUTCDate()).padStart(2, "0");
  const todayKey = `${y}-${m}-${d}`;
  const result = genericDueDateStatus(dueDate, todayKey);
  return result as PaymentStatus;
}

export function monthlyDueDate(dueDay: number | null, todayKey: string) {
  if (dueDay == null) return null;
  const [year, month] = todayKey.split("-").map(Number);
  if (!year || !month) return null;
  const lastDay = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(dueDay, lastDay)).padStart(2, "0")}`;
}
