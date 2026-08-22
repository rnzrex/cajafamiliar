import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import { Category, CreditCardEntry, Debt, DebtEvent, FinancialAccount, Movement } from "../types";
import { expectedCash, formatMoney, formatMoneyByCurrency } from "../utils/calculations";
import { UNASSIGNED_ACCOUNT_ID, getActiveCashAccount } from "../utils/accountHelpers";
import { defaultMovementFilters, filterMovements, movementTotals, movementTotalsByCurrency, type MovementFilters } from "../utils/movementFilters";
import { getMovementEconomics, resolveMovementCurrencyCode } from "../utils/movementEconomics";

interface ReportsProps {
  movements: Movement[];
  debtEvents: DebtEvent[];
  creditCardEntries?: CreditCardEntry[];
  categories: Category[];
  accounts: FinancialAccount[];
  debts?: Debt[];
  initialBalance: number;
}

const colors = ["#2563eb", "#16a34a", "#dc2626", "#f59e0b", "#7c3aed", "#0f766e", "#db2777", "#64748b"];

export async function exportReportFromReports(
  movements: Movement[],
  filters: MovementFilters,
  accounts: FinancialAccount[],
  debtEvents: DebtEvent[],
  creditCardEntries: CreditCardEntry[] = [],
  debts: Debt[] = []
) {
  const { exportReportExcel } = await import("../utils/excelExport");
  if (creditCardEntries.length > 0 || debts.length > 0) {
    exportReportExcel(movements, filters, accounts, debtEvents, creditCardEntries, debts);
  } else {
    exportReportExcel(movements, filters, accounts, debtEvents);
  }
}

export function Reports({ movements, debtEvents, creditCardEntries = [], categories, accounts, debts = [], initialBalance }: ReportsProps) {
  const [filters, setFilters] = useState(defaultMovementFilters);
  const [selectedCurrency, setSelectedCurrency] = useState<string>("all");

  const filteredMovements = useMemo(() => filterMovements(movements, filters, accounts), [movements, filters, accounts]);

  const currencyTotalsResult = useMemo(
    () => movementTotalsByCurrency(filteredMovements, debtEvents, creditCardEntries, accounts, debts),
    [filteredMovements, debtEvents, creditCardEntries, accounts, debts]
  );

  const availableCurrencies = useMemo(() => Object.keys(currencyTotalsResult.byCurrency), [currencyTotalsResult]);

  const activeCurrency = useMemo(() => {
    if (selectedCurrency !== "all" && availableCurrencies.includes(selectedCurrency)) {
      return selectedCurrency;
    }
    return availableCurrencies[0] || "PEN";
  }, [selectedCurrency, availableCurrencies]);

  const scopedMovements = useMemo(() => {
    if (availableCurrencies.length <= 1 || selectedCurrency === "all") {
      return filteredMovements;
    }
    return filteredMovements.filter(
      (m) => resolveMovementCurrencyCode(m, accounts, debts, debtEvents, creditCardEntries) === selectedCurrency
    );
  }, [filteredMovements, availableCurrencies, selectedCurrency, accounts, debts, debtEvents, creditCardEntries]);

  const currentTotals = useMemo(() => {
    if (availableCurrencies.length <= 1) {
      return currencyTotalsResult.byCurrency[availableCurrencies[0]] || {
        currencyCode: "PEN",
        income: 0,
        cashOutflow: 0,
        expense: 0,
        balance: 0,
        economicBalance: 0,
      };
    }
    if (selectedCurrency !== "all" && currencyTotalsResult.byCurrency[selectedCurrency]) {
      return currencyTotalsResult.byCurrency[selectedCurrency];
    }
    return currencyTotalsResult.byCurrency[activeCurrency] || {
      currencyCode: activeCurrency,
      income: 0,
      cashOutflow: 0,
      expense: 0,
      balance: 0,
      economicBalance: 0,
    };
  }, [currencyTotalsResult, availableCurrencies, selectedCurrency, activeCurrency]);

  const expenses = scopedMovements
    .filter((movement) => movement.type === "egreso")
    .map((movement) => ({ ...movement, amount: getMovementEconomics(movement, debtEvents, creditCardEntries).economicExpense }));
  const incomes = scopedMovements.filter((movement) => movement.type === "ingreso");
  const cashAccount = getActiveCashAccount(accounts);

  const byCategory = groupBy(expenses, "category").filter((item) => item.monto > 0);
  const byAccount = groupBy(expenses, "accountId", accounts).filter((item) => item.monto > 0);
  const incomeExpense = [
    { name: "Ingresos", monto: incomes.reduce((sum, movement) => sum + movement.amount, 0) },
    { name: "Salidas de dinero", monto: currentTotals.cashOutflow },
    { name: "Gastos", monto: currentTotals.expense },
  ];
  const topFive = [...byCategory].sort((a, b) => b.monto - a.monto).slice(0, 5);
  const cashEvolution = buildCashEvolution(scopedMovements, cashAccount?.openingBalance ?? initialBalance, cashAccount?.id ?? null, creditCardEntries);

  async function handleExport() {
    if (filteredMovements.length === 0) {
      window.alert("No hay movimientos para descargar con los filtros actuales.");
      return;
    }

    try {
      await exportReportFromReports(filteredMovements, filters, accounts, debtEvents, creditCardEntries, debts);
    } catch {
      window.alert("No se pudo preparar el archivo Excel. Intenta nuevamente.");
    }
  }

  return (
    <section className="space-y-5">
      <div className="rounded-lg bg-white p-5 soft-shadow">
        <h2 className="mb-4 text-2xl font-bold text-slate-800">Filtros del reporte</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1 font-semibold text-slate-700">
            Periodo
            <select value={filters.dateMode} onChange={(event) => setFilters((current) => ({ ...current, dateMode: event.target.value as typeof current.dateMode }))} className="h-12 w-full rounded-lg border border-slate-200 bg-white px-3">
              <option value="all">Reporte total</option>
              <option value="month">Por mes</option>
              <option value="date">Fecha especifica</option>
              <option value="range">Rango de fechas</option>
            </select>
          </label>
          {filters.dateMode === "month" && (
            <label className="space-y-1 font-semibold text-slate-700">
              Mes
              <input type="month" value={filters.month} onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))} className="h-12 w-full rounded-lg border border-slate-200 px-3" />
            </label>
          )}
          {filters.dateMode === "date" && (
            <label className="space-y-1 font-semibold text-slate-700">
              Fecha
              <input type="date" value={filters.exactDate} onChange={(event) => setFilters((current) => ({ ...current, exactDate: event.target.value }))} className="h-12 w-full rounded-lg border border-slate-200 px-3" />
            </label>
          )}
          {filters.dateMode === "range" && (
            <>
              <label className="space-y-1 font-semibold text-slate-700">
                Fecha desde
                <input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} className="h-12 w-full rounded-lg border border-slate-200 px-3" />
              </label>
              <label className="space-y-1 font-semibold text-slate-700">
                Fecha hasta
                <input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} className="h-12 w-full rounded-lg border border-slate-200 px-3" />
              </label>
            </>
          )}
          <label className="space-y-1 font-semibold text-slate-700">
            Categoria
            <select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))} className="h-12 w-full rounded-lg border border-slate-200 bg-white px-3">
              <option value="todas">Todas</option>
              {categories.map((item) => (
                <option key={item.id} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 font-semibold text-slate-700">
            Cuenta
            <select value={filters.accountId} onChange={(event) => setFilters((current) => ({ ...current, accountId: event.target.value }))} className="h-12 w-full rounded-lg border border-slate-200 bg-white px-3">
              <option value="">Todas</option>
              {accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.isActive ? item.name : `${item.name} (archivada)`}
                </option>
              ))}
              <option value={UNASSIGNED_ACCOUNT_ID}>Sin cuenta (historico)</option>
            </select>
          </label>
          <label className="space-y-1 font-semibold text-slate-700">
            Tipo
            <select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value as typeof current.type }))} className="h-12 w-full rounded-lg border border-slate-200 bg-white px-3">
              <option value="todos">Todos</option>
              <option value="ingreso">Ingreso</option>
              <option value="egreso">Egreso</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={() => void handleExport()} className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-green-600 px-5 py-3 text-lg font-bold text-white hover:bg-green-700">
            <Download className="h-5 w-5" />
            Descargar reporte Excel
          </button>
          <button type="button" onClick={() => setFilters(defaultMovementFilters())} className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-slate-200 px-5 py-3 text-lg font-bold text-slate-700 hover:bg-slate-300">
            <RotateCcw className="h-5 w-5" />
            Limpiar filtros
          </button>
          <span className="flex items-center text-base font-semibold text-slate-600">{filteredMovements.length} movimientos incluidos</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartCard title="Gastos por categoria">
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={byCategory} dataKey="monto" nameKey="name" outerRadius={105} label>
                {byCategory.map((_, index) => (
                  <Cell key={index} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Flujo y gasto económico">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={incomeExpense}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Bar dataKey="monto" radius={[8, 8, 0, 0]}>
                <Cell fill="#16a34a" />
                <Cell fill="#dc2626" />
                <Cell fill="#f59e0b" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Gastos por cuenta">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={byAccount}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Bar dataKey="monto" fill="#2563eb" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Top 5 categorias de mayor gasto">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topFive} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis dataKey="name" type="category" width={125} />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Bar dataKey="monto" fill="#f59e0b" radius={[0, 8, 8, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard title="Evolucion diaria del saldo de caja">
        <ResponsiveContainer width="100%" height={330}>
          <AreaChart data={cashEvolution}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip formatter={(value) => formatMoney(Number(value))} />
            <Area type="monotone" dataKey="saldo" fill="#bfdbfe" stroke="#2563eb" strokeWidth={3} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>
    </section>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="rounded-lg bg-white p-5 soft-shadow">
      <h2 className="mb-4 text-xl font-bold text-slate-800">{title}</h2>
      {children}
    </article>
  );
}

function groupBy(items: Movement[], key: "category" | "accountId", accounts: FinancialAccount[] = []) {
  const totals = new Map<string, number>();
  items.forEach((item) => {
    const groupKey = key === "accountId" ? (item.accountId ?? UNASSIGNED_ACCOUNT_ID) : item[key];
    totals.set(groupKey, (totals.get(groupKey) ?? 0) + item.amount);
  });
  return [...totals.entries()].map(([name, monto]) => ({ name: key === "accountId" ? readableAccountName(name, accounts) : name, monto }));
}

function readableAccountName(key: string, accounts: FinancialAccount[]) {
  if (key === UNASSIGNED_ACCOUNT_ID) return "Sin cuenta (historico)";
  return accounts.find((account) => account.id === key)?.name ?? "Sin cuenta (historico)";
}

export function buildCashEvolution(
  movements: Movement[],
  initialBalance: number,
  cashAccountId: string | null,
  creditCardEntries: CreditCardEntry[] = []
) {
  const cashMovements = movements
    .filter((movement) => (cashAccountId ? movement.accountId === cashAccountId : movement.method === "efectivo"))
    .sort((a, b) => a.date.localeCompare(b.date));
  const grouped = new Map<string, Movement[]>();
  cashMovements.forEach((movement) => grouped.set(movement.date, [...(grouped.get(movement.date) ?? []), movement]));

  let balance = initialBalance;
  const result = [{ date: "Inicio", saldo: initialBalance }];
  [...grouped.entries()].forEach(([date, dayMovements]) => {
    balance = expectedCash(dayMovements, balance, cashAccountId, creditCardEntries);
    result.push({ date: date.slice(5), saldo: balance });
  });

  return result;
}
