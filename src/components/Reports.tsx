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
import { Category, Movement, paymentMethods } from "../types";
import { expectedCash, formatMoney } from "../utils/calculations";
import { exportReportExcel } from "../utils/excelExport";
import { defaultMovementFilters, filterMovements } from "../utils/movementFilters";

interface ReportsProps {
  movements: Movement[];
  categories: Category[];
  initialBalance: number;
}

const colors = ["#2563eb", "#16a34a", "#dc2626", "#f59e0b", "#7c3aed", "#0f766e", "#db2777", "#64748b"];

export function Reports({ movements, categories, initialBalance }: ReportsProps) {
  const [filters, setFilters] = useState(defaultMovementFilters);
  const filteredMovements = useMemo(() => filterMovements(movements, filters), [movements, filters]);
  const expenses = filteredMovements.filter((movement) => movement.type === "egreso");
  const incomes = filteredMovements.filter((movement) => movement.type === "ingreso");

  const byCategory = groupBy(expenses, "category");
  const byMethod = groupBy(expenses, "method");
  const incomeExpense = [
    { name: "Ingresos", monto: incomes.reduce((sum, movement) => sum + movement.amount, 0) },
    { name: "Egresos", monto: expenses.reduce((sum, movement) => sum + movement.amount, 0) },
  ];
  const topFive = [...byCategory].sort((a, b) => b.monto - a.monto).slice(0, 5);
  const cashEvolution = buildCashEvolution(filteredMovements, initialBalance);

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
            Metodo
            <select value={filters.method} onChange={(event) => setFilters((current) => ({ ...current, method: event.target.value as typeof current.method }))} className="h-12 w-full rounded-lg border border-slate-200 bg-white px-3">
              <option value="todos">Todos</option>
              {paymentMethods.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
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
          <button type="button" onClick={() => exportReportExcel(filteredMovements, filters)} className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-green-600 px-5 py-3 text-lg font-bold text-white hover:bg-green-700">
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

        <ChartCard title="Ingresos vs egresos">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={incomeExpense}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Bar dataKey="monto" radius={[8, 8, 0, 0]}>
                <Cell fill="#16a34a" />
                <Cell fill="#dc2626" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Gastos por metodo de pago">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={byMethod}>
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

function groupBy(items: Movement[], key: "category" | "method") {
  const totals = new Map<string, number>();
  items.forEach((item) => totals.set(item[key], (totals.get(item[key]) ?? 0) + item.amount));
  return [...totals.entries()].map(([name, monto]) => ({ name, monto }));
}

function buildCashEvolution(movements: Movement[], initialBalance: number) {
  const cashMovements = movements.filter((movement) => movement.method === "efectivo").sort((a, b) => a.date.localeCompare(b.date));
  const grouped = new Map<string, Movement[]>();
  cashMovements.forEach((movement) => grouped.set(movement.date, [...(grouped.get(movement.date) ?? []), movement]));

  let balance = initialBalance;
  const result = [{ date: "Inicio", saldo: initialBalance }];
  [...grouped.entries()].forEach(([date, dayMovements]) => {
    balance = expectedCash(dayMovements, balance);
    result.push({ date: date.slice(5), saldo: balance });
  });

  return result;
}
