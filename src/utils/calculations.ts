import { CashCount, Movement, RecurringPayment } from "../types";

export const formatMoney = (value: number) =>
  new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    currencyDisplay: "symbol",
  })
    .format(value)
    .replace("PEN", "S/");

export const monthKey = (date: string) => date.slice(0, 7);

export function expectedCash(movements: Movement[], initialBalance: number) {
  return movements.reduce((total, movement) => {
    if (movement.method !== "efectivo") return total;
    return movement.type === "ingreso" ? total + movement.amount : total - movement.amount;
  }, initialBalance);
}

export function monthlyTotals(movements: Movement[], selectedMonth = monthKey(new Date().toISOString())) {
  return movements
    .filter((movement) => monthKey(movement.date) === selectedMonth)
    .reduce(
      (totals, movement) => {
        if (movement.type === "ingreso") totals.income += movement.amount;
        if (movement.type === "egreso") totals.expense += movement.amount;
        return totals;
      },
      { income: 0, expense: 0 }
    );
}

export function topExpenseCategory(movements: Movement[], selectedMonth = monthKey(new Date().toISOString())) {
  const totals = new Map<string, number>();
  movements
    .filter((movement) => movement.type === "egreso" && monthKey(movement.date) === selectedMonth)
    .forEach((movement) => totals.set(movement.category, (totals.get(movement.category) ?? 0) + movement.amount));

  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Sin gastos";
}

export function lastCashCount(cashCounts: CashCount[]) {
  return [...cashCounts].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function paymentStatus(payment: RecurringPayment) {
  if (!payment.is_active) return { label: "Finalizado", tone: "slate", days: 999 };
  if (isPaymentPaidThisMonth(payment)) return { label: "Pagado este mes", tone: "green", days: 0 };
  const now = startOfDay(new Date());
  const tomorrow = addDays(now, 1);
  const due = getRelevantDueDate(payment.dueDay, now, tomorrow);
  const diff = Math.round((due.getTime() - now.getTime()) / 86400000);

  if (diff < 0) return { label: "Vencido", tone: "red", days: diff };
  if (diff === 0) return { label: "Vence hoy", tone: "orange", days: diff };
  if (diff === 1) return { label: "Vence manana", tone: "yellow", days: diff };
  return { label: `Faltan ${diff} dias`, tone: "blue", days: diff };
}

export function paymentAlert(payment: RecurringPayment) {
  if (!payment.is_active || isPaymentPaidThisMonth(payment)) return null;
  const status = paymentStatus(payment);
  if (status.days < 0) return { kind: "vencido" as const, ...status };
  if (status.days === 0) return { kind: "hoy" as const, ...status };
  if (status.days === 1) return { kind: "manana" as const, ...status };
  return null;
}

export function isPaymentPaidThisMonth(payment: RecurringPayment, date = new Date()) {
  return payment.last_paid_month === date.getMonth() + 1 && payment.last_paid_year === date.getFullYear();
}

export function isPaymentFinished(payment: RecurringPayment) {
  return payment.recurrence_type === "fixed" && Boolean(payment.total_installments) && payment.paid_installments >= Number(payment.total_installments);
}

export function installmentLabel(payment: RecurringPayment) {
  if (payment.recurrence_type !== "fixed" || !payment.total_installments) return "Mensual indefinido";
  const visibleInstallment = Math.min(payment.paid_installments + (isPaymentPaidThisMonth(payment) ? 0 : 1), payment.total_installments);
  return `Cuota ${visibleInstallment} de ${payment.total_installments}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function safeMonthlyDate(year: number, month: number, day: number) {
  return new Date(year, month, Math.min(day, daysInMonth(year, month)));
}

function getRelevantDueDate(dueDay: number, today: Date, tomorrow: Date) {
  if (dueDay === tomorrow.getDate()) return tomorrow;
  return safeMonthlyDate(today.getFullYear(), today.getMonth(), dueDay);
}
