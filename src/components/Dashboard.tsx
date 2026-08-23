import {
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Coins,
  CreditCard,
  Landmark,
  PiggyBank,
  Scale,
} from "lucide-react";
import { CashCount, CreditCardEntry, Debt, DebtEvent, FinancialAccount, Movement, RecurringPayment } from "../types";
import type { DebtInstallmentPlanningItem } from "../utils/debtPlanning";
import { selectDebtPlanningAttentionItems } from "../utils/debtPlanning";
import type { ObligationProjectionResult } from "../utils/obligationProjection";
import { ObligationsProjectionPanel } from "./ObligationsProjectionPanel";
import { expectedCash, formatMoney, formatMoneyByCurrency, lastCashCount, monthKey, paymentAmountLabel, paymentScheduleLabel, paymentStatus } from "../utils/calculations";
import { accountNameForMovement, expectedAccountBalance, getActiveCashAccount } from "../utils/accountHelpers";
import { getMovementEconomics, movementLabel, resolveMovementCurrencyCode } from "../utils/movementEconomics";
import { localMonthString, formatLocalDate } from "../utils/date";
import { movementTotalsByCurrency } from "../utils/movementFilters";

interface DashboardProps {
  movements: Movement[];
  debtEvents: DebtEvent[];
  creditCardEntries?: CreditCardEntry[];
  pendingMovementIds: ReadonlySet<string>;
  cashCounts: CashCount[];
  recurringPayments: RecurringPayment[];
  debtPlanningItems?: DebtInstallmentPlanningItem[];
  obligationProjection: ObligationProjectionResult;
  initialBalance: number;
  accounts: FinancialAccount[];
  debts?: Debt[];
  onNavigate: (view: string) => void;
  onOpenPayment: (id: string) => void;
  onOpenDebt?: (debtId: string) => void;
}

export function Dashboard({
  movements,
  debtEvents,
  creditCardEntries = [],
  pendingMovementIds,
  cashCounts,
  recurringPayments,
  debtPlanningItems = [],
  obligationProjection,
  initialBalance,
  accounts,
  debts = [],
  onNavigate,
  onOpenPayment,
  onOpenDebt,
}: DashboardProps) {
  const cashAccount = getActiveCashAccount(accounts);
  const cashCurrency = cashAccount?.currencyCode ?? "PEN";
  const expected = expectedCash(movements, cashAccount ? cashAccount.openingBalance : initialBalance, cashAccount?.id ?? null, creditCardEntries);
  const lastCount = lastCashCount(cashCounts);
  const hasCount = Boolean(lastCount);
  const difference = hasCount ? (lastCount?.total ?? 0) - expected : null;

  const currentMonthStr = localMonthString();
  const monthlyMovements = movements.filter((m) => monthKey(m.date) === currentMonthStr);
  const monthlyCurrencyTotals = movementTotalsByCurrency(monthlyMovements, debtEvents, creditCardEntries, accounts, debts);
  const currenciesPresent = Object.keys(monthlyCurrencyTotals.byCurrency);

  const formatMonthlyStat = (field: "income" | "cashOutflow" | "expense") => {
    if (currenciesPresent.length === 0) return formatMoneyByCurrency(0, "PEN");
    if (currenciesPresent.length === 1) {
      const code = currenciesPresent[0];
      return formatMoneyByCurrency(monthlyCurrencyTotals.byCurrency[code][field], code);
    }
    return currenciesPresent
      .map((code) => `${code}: ${formatMoneyByCurrency(monthlyCurrencyTotals.byCurrency[code][field], code)}`)
      .join(" · ");
  };

  const getTopExpenseCategoryPerCurrency = () => {
    if (currenciesPresent.length === 0) return "Sin gastos";
    const parts: string[] = [];

    for (const code of currenciesPresent) {
      const currMovements = monthlyMovements.filter(
        (m) => resolveMovementCurrencyCode(m, accounts, debts, debtEvents, creditCardEntries) === code
      );
      const categoryMap = new Map<string, number>();
      for (const m of currMovements) {
        if (m.type !== "egreso") continue;
        const econ = getMovementEconomics(m, debtEvents, creditCardEntries).economicExpense;
        categoryMap.set(m.category, (categoryMap.get(m.category) ?? 0) + econ);
      }
      let topCat = "Sin gastos";
      let topAmt = 0;
      for (const [cat, amt] of categoryMap.entries()) {
        if (amt > topAmt) {
          topAmt = amt;
          topCat = cat;
        }
      }
      parts.push(currenciesPresent.length === 1 ? topCat : `${code}: ${topCat}`);
    }

    return parts.join(" · ");
  };

  const latestMovements = [...movements]
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 5);
  const attentionPayments = recurringPayments
    .map((payment) => ({ payment, status: paymentStatus(payment) }))
    .filter(({ payment, status }) => payment.is_active && ["overdue", "today", "tomorrow", "upcoming"].includes(status.kind))
    .sort((a, b) => a.status.days - b.status.days);
  const relevantPayments = attentionPayments.slice(0, 3);

  const relevantDebtItems = selectDebtPlanningAttentionItems(debtPlanningItems, 3);

  const secondaryStats = [
    { label: "Ingresos del mes", value: formatMonthlyStat("income"), icon: ArrowUpCircle, tone: "text-emerald-700 bg-emerald-50" },
    { label: "Salidas de dinero", value: formatMonthlyStat("cashOutflow"), icon: ArrowDownCircle, tone: "text-red-700 bg-red-50" },
    { label: "Gastos del mes", value: formatMonthlyStat("expense"), icon: CreditCard, tone: "text-amber-800 bg-amber-50" },
    { label: "Categoría con más gasto", value: getTopExpenseCategoryPerCurrency(), icon: CreditCard, tone: "text-amber-800 bg-amber-50" },
    { label: "Pagos próximos", value: `${attentionPayments.length}`, icon: CalendarClock, tone: "text-orange-800 bg-orange-50" },
  ];

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-3xl bg-blue-700 p-6 text-white shadow-lg sm:p-8">
        <div className="relative z-10 max-w-xl">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-blue-100">Saldo esperado</p>
          <h2 className="mt-3 text-2xl font-bold sm:text-3xl">Dinero que debería haber en caja</h2>
          <p className="mt-4 text-5xl font-black tracking-tight sm:text-6xl">{formatMoneyByCurrency(expected, cashCurrency)}</p>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-blue-100">{cashAccount ? `Calculado con el saldo inicial y los movimientos de la cuenta ${cashAccount.name}.` : "Calculado con el saldo inicial y los movimientos en efectivo."}</p>
        </div>
        <PiggyBank className="absolute -right-6 -top-5 h-44 w-44 text-blue-500/40 sm:h-56 sm:w-56" aria-hidden="true" />
      </section>

      {monthlyCurrencyTotals.unresolvedMovements.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          Hay {monthlyCurrencyTotals.unresolvedMovements.length} movimientos cuya moneda no pudo determinarse.
        </div>
      )}

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

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Cuentas</p>
            <h2 className="text-2xl font-bold text-slate-900">Tus cuentas</h2>
          </div>
          <button type="button" onClick={() => onNavigate("cuentas")} className="flex min-h-12 items-center gap-1 rounded-xl px-3 text-base font-bold text-blue-700 hover:bg-blue-50">
            Gestionar
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        {accounts.filter((account) => account.isActive).length === 0 ? (
          <button type="button" onClick={() => onNavigate("cuentas")} className="w-full rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50 p-5 text-left font-bold text-blue-800 hover:bg-blue-100">
            Crea tu primera cuenta para organizar el dinero de la familia.
          </button>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts
              .filter((account) => account.isActive)
              .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
              .map((account) => (
                <button key={account.id} type="button" onClick={() => onNavigate("cuentas")} className="rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition hover:bg-slate-50">
                  <p className="text-sm font-bold text-slate-500">{account.name}</p>
                  <p className="mt-2 text-2xl font-black text-slate-900">{formatMoneyByCurrency(expectedAccountBalance(movements, account.id, account.openingBalance, creditCardEntries), account.currencyCode)}</p>
                </button>
              ))}
          </div>
        )}
      </section>

      {(relevantPayments.length > 0 || relevantDebtItems.length > 0) && (
        <section className="rounded-3xl border border-orange-100 bg-orange-50 p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-3">
            <CalendarClock className="h-7 w-7 text-orange-700 shrink-0" />
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-orange-700">Atención</p>
              <h2 className="text-2xl font-bold text-orange-950">Obligaciones que requieren atención</h2>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {relevantPayments.map(({ payment, status }) => (
              <article key={payment.id} className="rounded-2xl border border-orange-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <span className="inline-flex rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-900">{status.label}</span>
                    <h3 className="mt-2 text-lg font-bold text-slate-900">{payment.name}</h3>
                    <p className="mt-1 text-xs font-semibold text-slate-600">{paymentAmountLabel(payment)} · {paymentScheduleLabel(payment)}</p>
                  </div>
                  <button type="button" onClick={() => onOpenPayment(payment.id)} className="min-h-11 rounded-xl bg-orange-600 px-4 py-2 text-sm font-bold text-white hover:bg-orange-700 transition shrink-0">
                    Ver pago
                  </button>
                </div>
              </article>
            ))}

            {relevantDebtItems.map((item) => (
              <article key={item.installmentId} className="rounded-2xl border border-purple-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-3 py-1 text-xs font-bold text-purple-900">
                      <Landmark className="h-3 w-3" /> {item.dueLabel}
                    </span>
                    <h3 className="mt-2 text-lg font-bold text-slate-900">{item.debtName} (Cuota #{item.installmentNumber})</h3>
                    <p className="mt-1 text-xs font-semibold text-slate-600">
                      {item.amountKnown ? (
                        <>Pendiente: <span className="font-bold text-slate-900">{item.currencyCode} {item.remainingAmount?.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span> · Vence: {formatLocalDate(item.dueDate)}</>
                      ) : (
                        <>Monto por confirmar · Vence: {formatLocalDate(item.dueDate)}</>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => (onOpenDebt ? onOpenDebt(item.debtId) : onNavigate("deudas"))}
                    className="min-h-11 rounded-xl bg-purple-700 px-4 py-2 text-sm font-bold text-white hover:bg-purple-800 transition shrink-0"
                  >
                    Ver deuda
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

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
            {latestMovements.map((movement) => {
              const movCurrency = resolveMovementCurrencyCode(movement, accounts, debts, debtEvents, creditCardEntries);
              return (
                <article key={movement.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-black ${movement.type === "ingreso" ? "bg-emerald-100 text-emerald-800" : movement.movementContext === "debt_service" ? "bg-blue-100 text-blue-800" : "bg-red-100 text-red-800"}`}>
                          {movementLabel(movement)}
                        </span>
                        {pendingMovementIds.has(movement.id) && <PendingMovementBadge />}
                        <h3 className="truncate text-lg font-bold text-slate-900">{movement.description}</h3>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{formatMovementDate(movement.date)} · {accountNameForMovement(movement, accounts)}</p>
                      <p className="mt-1 text-sm text-slate-500">{movement.category} · {movement.person}</p>
                    </div>
                    <p className={`text-xl font-black sm:text-right ${movement.type === "ingreso" ? "text-emerald-700" : "text-red-700"}`}>
                      {movement.type === "ingreso" ? "+" : "-"}
                      {movCurrency ? formatMoneyByCurrency(movement.amount, movCurrency) : `${movement.amount} (Moneda sin resolver)`}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <ObligationsProjectionPanel
        obligationProjection={obligationProjection}
        onOpenPayment={onOpenPayment}
        onOpenDebt={onOpenDebt}
      />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <article className="rounded-3xl bg-white p-5 shadow-sm lg:col-span-1">
          <div className="mb-4 flex items-center gap-3">
            {hasCount ? <CheckCircle2 className="h-7 w-7 text-emerald-600" /> : <Scale className="h-7 w-7 text-slate-500" />}
            <h2 className="text-xl font-bold text-slate-900">Estado de caja</h2>
          </div>
          {hasCount ? (
            <>
              <p className="text-sm text-slate-600">Último total contado</p>
              <p className="mt-1 text-3xl font-black text-slate-900">{formatMoneyByCurrency(lastCount?.total ?? 0, cashCurrency)}</p>
              <p className={`mt-3 font-bold ${difference === 0 ? "text-emerald-700" : difference! < 0 ? "text-red-700" : "text-amber-700"}`}>
                Diferencia: {formatMoneyByCurrency(difference ?? 0, cashCurrency)}
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

function PendingMovementBadge() {
  return <span role="status" className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-800">Pendiente de sincronizar</span>;
}

function formatMovementDate(value: string) {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}
