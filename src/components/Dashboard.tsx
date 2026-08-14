import {
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Coins,
  CreditCard,
  PiggyBank,
  Scale,
} from "lucide-react";
import { CashCount, Movement, RecurringPayment } from "../types";
import { expectedCash, formatMoney, lastCashCount, monthlyTotals, paymentStatus, topExpenseCategory } from "../utils/calculations";

interface DashboardProps {
  movements: Movement[];
  cashCounts: CashCount[];
  recurringPayments: RecurringPayment[];
  initialBalance: number;
  onNavigate: (view: string) => void;
}

export function Dashboard({ movements, cashCounts, recurringPayments, initialBalance, onNavigate }: DashboardProps) {
  const expected = expectedCash(movements, initialBalance);
  const lastCount = lastCashCount(cashCounts);
  const hasCount = Boolean(lastCount);
  const difference = hasCount ? (lastCount?.total ?? 0) - expected : null;
  const totals = monthlyTotals(movements);
  const topCategory = topExpenseCategory(movements);
  const latestMovements = [...movements]
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 5);
  const relevantPayments = recurringPayments
    .map((payment) => ({ payment, status: paymentStatus(payment) }))
    .filter(({ payment, status }) => payment.is_active && status.tone !== "green" && status.days <= 3)
    .sort((a, b) => a.status.days - b.status.days);

  const secondaryStats = [
    { label: "Ingresos del mes", value: formatMoney(totals.income), icon: ArrowUpCircle, tone: "text-emerald-700 bg-emerald-50" },
    { label: "Egresos del mes", value: formatMoney(totals.expense), icon: ArrowDownCircle, tone: "text-red-700 bg-red-50" },
    { label: "Categoría con más gasto", value: topCategory, icon: CreditCard, tone: "text-amber-800 bg-amber-50" },
    { label: "Pagos próximos", value: `${relevantPayments.length}`, icon: CalendarClock, tone: "text-orange-800 bg-orange-50" },
  ];

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-3xl bg-blue-700 p-6 text-white shadow-lg sm:p-8">
        <div className="relative z-10 max-w-xl">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-blue-100">Saldo esperado</p>
          <h2 className="mt-3 text-2xl font-bold sm:text-3xl">Dinero que debería haber en caja</h2>
          <p className="mt-4 text-5xl font-black tracking-tight sm:text-6xl">{formatMoney(expected)}</p>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-blue-100">Calculado con el saldo inicial y los movimientos en efectivo.</p>
        </div>
        <PiggyBank className="absolute -right-6 -top-5 h-44 w-44 text-blue-500/40 sm:h-56 sm:w-56" aria-hidden="true" />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Uso diario</p>
            <h2 className="text-2xl font-bold text-slate-900">Acciones principales</h2>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <button type="button" onClick={() => onNavigate("registrar-gasto")} className="flex min-h-24 items-center justify-center gap-3 rounded-2xl bg-red-600 px-5 py-4 text-xl font-black text-white shadow-md ring-4 ring-red-100 transition hover:bg-red-700">
            <ArrowDownCircle className="h-8 w-8" />
            Registrar gasto
          </button>
          <button type="button" onClick={() => onNavigate("registrar-ingreso")} className="flex min-h-24 items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-5 py-4 text-xl font-black text-white shadow-md transition hover:bg-emerald-700">
            <ArrowUpCircle className="h-8 w-8" />
            Registrar ingreso
          </button>
          <button type="button" onClick={() => onNavigate("conteo")} className="flex min-h-24 items-center justify-center gap-3 rounded-2xl bg-slate-800 px-5 py-4 text-xl font-black text-white shadow-md transition hover:bg-slate-900">
            <Coins className="h-8 w-8" />
            Contar caja
          </button>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Actividad reciente</p>
            <h2 className="text-2xl font-bold text-slate-900">Últimos movimientos</h2>
          </div>
          <button type="button" onClick={() => onNavigate("movimientos")} className="flex min-h-12 items-center gap-1 rounded-xl px-3 text-base font-bold text-blue-700 hover:bg-blue-50">
            Ver todos
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        {latestMovements.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 p-5 text-slate-600">Aún no hay movimientos registrados.</p>
        ) : (
          <div className="space-y-2">
            {latestMovements.map((movement) => (
              <article key={movement.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-black ${movement.type === "ingreso" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                        {movement.type === "ingreso" ? "Ingreso" : "Gasto"}
                      </span>
                      <h3 className="truncate text-lg font-bold text-slate-900">{movement.description}</h3>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{formatMovementDate(movement.date)} · {movement.method}</p>
                    <p className="mt-1 text-sm text-slate-500">{movement.category} · {movement.person}</p>
                  </div>
                  <p className={`text-xl font-black sm:text-right ${movement.type === "ingreso" ? "text-emerald-700" : "text-red-700"}`}>
                    {movement.type === "ingreso" ? "+" : "-"}{formatMoney(movement.amount)}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {relevantPayments.length > 0 && (
        <section className="rounded-3xl border border-orange-100 bg-orange-50 p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <CalendarClock className="h-7 w-7 text-orange-700" />
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-orange-700">Atención</p>
              <h2 className="text-2xl font-bold text-orange-950">Próximos pagos</h2>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {relevantPayments.map(({ payment, status }) => (
              <article key={payment.id} className="rounded-2xl border border-orange-200 bg-white p-4">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <span className="inline-flex rounded-full bg-orange-100 px-3 py-1 text-sm font-bold text-orange-900">{status.label}</span>
                    <h3 className="mt-3 text-xl font-bold text-slate-900">{payment.name}</h3>
                    <p className="mt-1 text-sm font-semibold text-slate-600">{formatMoney(payment.amount)} · Día {payment.dueDay}</p>
                  </div>
                  <button type="button" onClick={() => onNavigate("pagos")} className="min-h-12 rounded-xl bg-orange-600 px-4 py-2 text-base font-bold text-white hover:bg-orange-700">
                    Ver pago
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <article className="rounded-3xl bg-white p-5 shadow-sm lg:col-span-1">
          <div className="mb-4 flex items-center gap-3">
            {hasCount ? <CheckCircle2 className="h-7 w-7 text-emerald-600" /> : <Scale className="h-7 w-7 text-slate-500" />}
            <h2 className="text-xl font-bold text-slate-900">Estado de caja</h2>
          </div>
          {hasCount ? (
            <>
              <p className="text-sm text-slate-600">Último total contado</p>
              <p className="mt-1 text-3xl font-black text-slate-900">{formatMoney(lastCount?.total ?? 0)}</p>
              <p className={`mt-3 font-bold ${difference === 0 ? "text-emerald-700" : difference! < 0 ? "text-red-700" : "text-amber-700"}`}>
                Diferencia: {formatMoney(difference ?? 0)}
              </p>
            </>
          ) : (
            <>
              <p className="text-xl font-black text-slate-900">Caja aún no contada</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">Haz un conteo para comparar el dinero físico con el saldo esperado.</p>
              <button type="button" onClick={() => onNavigate("conteo")} className="mt-4 min-h-12 rounded-xl bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700">
                Contar caja
              </button>
            </>
          )}
        </article>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-2">
          {secondaryStats.map((stat) => (
            <article key={stat.label} className={`rounded-3xl p-5 ${stat.tone}`}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-bold">{stat.label}</p>
                <stat.icon className="h-7 w-7" />
              </div>
              <p className="break-words text-2xl font-black">{stat.value}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function formatMovementDate(value: string) {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}
