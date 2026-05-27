import {
  ArrowDownCircle,
  ArrowUpCircle,
  BarChart3,
  CalendarClock,
  ClipboardList,
  Coins,
  CreditCard,
  Edit3,
  Home,
  PiggyBank,
  Scale,
} from "lucide-react";
import { CashCount, Movement, RecurringPayment } from "../types";
import { expectedCash, formatMoney, lastCashCount, monthlyTotals, paymentAlert, paymentStatus, topExpenseCategory } from "../utils/calculations";

interface DashboardProps {
  movements: Movement[];
  cashCounts: CashCount[];
  recurringPayments: RecurringPayment[];
  initialBalance: number;
  onNavigate: (view: string) => void;
}

const cardTone: Record<string, string> = {
  green: "border-green-100 bg-green-50 text-green-800",
  red: "border-red-100 bg-red-50 text-red-800",
  blue: "border-blue-100 bg-blue-50 text-blue-800",
  yellow: "border-yellow-100 bg-yellow-50 text-yellow-900",
  white: "border-slate-100 bg-white text-slate-800",
};

export function Dashboard({ movements, cashCounts, recurringPayments, initialBalance, onNavigate }: DashboardProps) {
  const expected = expectedCash(movements, initialBalance);
  const counted = lastCashCount(cashCounts)?.total ?? 0;
  const difference = counted - expected;
  const totals = monthlyTotals(movements);
  const topCategory = topExpenseCategory(movements);
  const pendingPayments = recurringPayments.filter((payment) => payment.is_active && paymentStatus(payment).tone !== "green");
  const urgentPayments = pendingPayments.filter((payment) => paymentStatus(payment).days <= 3).length;
  const alerts = recurringPayments
    .map((payment) => ({ payment, alert: paymentAlert(payment) }))
    .filter((item): item is { payment: RecurringPayment; alert: NonNullable<ReturnType<typeof paymentAlert>> } => Boolean(item.alert))
    .sort((a, b) => a.alert.days - b.alert.days);

  const stats = [
    { label: "Saldo esperado en caja", value: formatMoney(expected), icon: PiggyBank, tone: "blue" },
    { label: "Total contado fisicamente", value: formatMoney(counted), icon: Coins, tone: "white" },
    {
      label: "Diferencia",
      value: formatMoney(difference),
      icon: Scale,
      tone: difference < 0 ? "red" : difference > 0 ? "green" : "blue",
    },
    { label: "Ingresos del mes", value: formatMoney(totals.income), icon: ArrowUpCircle, tone: "green" },
    { label: "Egresos del mes", value: formatMoney(totals.expense), icon: ArrowDownCircle, tone: "red" },
    { label: "Categoria con mas gasto", value: topCategory, icon: CreditCard, tone: "yellow" },
    { label: "Pagos proximos pendientes", value: `${urgentPayments} de ${pendingPayments.length}`, icon: CalendarClock, tone: "yellow" },
  ];

  const actions = [
    { label: "Registrar ingreso", view: "registrar-ingreso", icon: ArrowUpCircle, className: "bg-green-600 hover:bg-green-700" },
    { label: "Registrar gasto", view: "registrar-gasto", icon: ArrowDownCircle, className: "bg-red-600 hover:bg-red-700" },
    { label: "Contar caja", view: "conteo", icon: Coins, className: "bg-blue-600 hover:bg-blue-700" },
    { label: "Ver movimientos", view: "movimientos", icon: ClipboardList, className: "bg-slate-700 hover:bg-slate-800" },
    { label: "Pagos recurrentes", view: "pagos", icon: CalendarClock, className: "bg-orange-500 hover:bg-orange-600" },
    { label: "Reportes", view: "reportes", icon: BarChart3, className: "bg-indigo-600 hover:bg-indigo-700" },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-blue-100 bg-white p-5 soft-shadow">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
            <Home className="h-8 w-8" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Bienvenida, familia Ruiz Gallardo</h2>
            <p className="mt-1 text-lg leading-relaxed text-slate-600">
              Rolando, Sara Veronica y Renzo: este es su espacio familiar para cuidar la caja, los gastos y los pagos del hogar.
            </p>
          </div>
        </div>
      </section>

      {alerts.length > 0 && (
        <section className="rounded-lg bg-white p-5 soft-shadow">
          <div className="mb-4 flex items-center gap-3">
            <CalendarClock className="h-7 w-7 text-red-600" />
            <h2 className="text-2xl font-bold text-slate-800">Notificaciones de pagos</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {alerts.map(({ payment, alert }) => {
              const tone =
                alert.kind === "vencido"
                  ? "border-red-300 bg-red-50 text-red-900"
                  : alert.kind === "hoy"
                    ? "border-red-200 bg-red-50 text-red-800"
                    : "border-orange-200 bg-orange-50 text-orange-900";
              const badge =
                alert.kind === "vencido" ? "Vencido" : alert.kind === "hoy" ? "Vence hoy" : "Vence manana";
              const message =
                alert.kind === "vencido"
                  ? `Pago vencido: ${payment.name} vencio el dia ${payment.dueDay}.`
                  : alert.kind === "hoy"
                    ? `Urgente: hoy vence ${payment.name} por aproximadamente ${formatMoney(payment.amount)}.`
                    : `Recordatorio: manana vence ${payment.name} por aproximadamente ${formatMoney(payment.amount)}.`;

              return (
                <article key={payment.id} className={`rounded-lg border p-4 ${tone}`}>
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <span className="inline-flex rounded-lg bg-white px-3 py-1 text-sm font-bold">{badge}</span>
                      <h3 className="mt-3 text-xl font-bold">{payment.name}</h3>
                      <p className="mt-1 text-base font-semibold">{message}</p>
                      <p className="mt-1 text-sm">
                        Monto: {formatMoney(payment.amount)} - Dia de vencimiento: {payment.dueDay}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate("pagos")}
                      className="min-h-12 rounded-lg bg-white px-4 py-2 text-lg font-bold text-slate-800 shadow-sm hover:bg-slate-50"
                    >
                      Ver pago
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <section key={stat.label} className={`soft-shadow rounded-lg border p-5 ${cardTone[stat.tone]}`}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-base font-semibold">{stat.label}</p>
              <stat.icon className="h-9 w-9 shrink-0" />
            </div>
            <p className="break-words text-3xl font-bold leading-tight">{stat.value}</p>
          </section>
        ))}
      </div>

      <section className="rounded-lg bg-white p-5 soft-shadow">
        <div className="mb-4 flex items-center gap-3">
          <Edit3 className="h-7 w-7 text-blue-600" />
          <h2 className="text-2xl font-bold text-slate-800">Acciones rapidas</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => onNavigate(action.view)}
              className={`flex min-h-20 items-center justify-center gap-3 rounded-lg px-5 py-4 text-xl font-bold text-white transition ${action.className}`}
            >
              <action.icon className="h-7 w-7" />
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
