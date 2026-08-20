import { Download, Edit, RotateCcw, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Category, FinancialAccount, HouseholdMember, Movement, MovementFormInput } from "../types";
import { formatMoney } from "../utils/calculations";
import { UNASSIGNED_ACCOUNT_ID, accountNameForMovement } from "../utils/accountHelpers";
import { defaultMovementFilters, filterMovements } from "../utils/movementFilters";
import { MovementForm } from "./MovementForm";

interface MovementsListProps {
  movements: Movement[];
  pendingMovementIds: ReadonlySet<string>;
  categories: Category[];
  accounts: FinancialAccount[];
  currentMember?: HouseholdMember;
  onQuickCreateCategory: (category: Omit<Category, "id" | "created_at">) => Category | null | Promise<Category | null>;
  onSave: (movement: MovementFormInput, id?: string) => void | Promise<boolean>;
  onDelete: (id: string) => void | Promise<boolean>;
}

export function MovementsList({ movements, pendingMovementIds, categories, accounts, currentMember, onQuickCreateCategory, onSave, onDelete }: MovementsListProps) {
  const [filters, setFilters] = useState(defaultMovementFilters);
  const [editing, setEditing] = useState<Movement | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filtered = useMemo(() => filterMovements(movements, filters), [movements, filters]);

  useEffect(() => {
    if (editing && pendingMovementIds.has(editing.id)) setEditing(null);
  }, [editing, pendingMovementIds]);

  async function handleDelete(id: string) {
    if (deletingId !== null) return;
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleExport() {
    if (filtered.length === 0) {
      window.alert("No hay movimientos para descargar con los filtros actuales.");
      return;
    }

    try {
      const { exportMovementsExcel } = await import("../utils/excelExport");
      exportMovementsExcel(filtered);
    } catch {
      window.alert("No se pudo preparar el archivo Excel. Intenta nuevamente.");
    }
  }

  if (editing && !pendingMovementIds.has(editing.id)) {
    return (
      <MovementForm
        movement={editing}
        currentMember={currentMember}
        categories={categories}
        accounts={accounts}
        onQuickCreateCategory={onQuickCreateCategory}
        onSave={async (movement, id) => {
          const saved = await onSave(movement, id);
          const succeeded = saved !== false;
          if (succeeded) setEditing(null);
          return succeeded;
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <section className="space-y-4">
      <div className="rounded-3xl bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4">
          <h2 className="text-3xl font-black text-slate-900">Movimientos</h2>
          <p className="mt-1 text-slate-600">Busca y revisa tus ingresos y gastos sin perder los filtros actuales.</p>
        </div>

        <label className="relative block">
          <span className="sr-only">Buscar movimiento</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-slate-400" />
          <input
            value={filters.search}
            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
            placeholder="Buscar movimiento..."
            className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-12 pr-4 text-lg outline-none focus:border-blue-500 focus:bg-white"
          />
        </label>

        <button type="button" onClick={() => setFiltersOpen((current) => !current)} aria-expanded={filtersOpen} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 text-base font-black text-slate-700 hover:bg-slate-200 lg:hidden">
          <SlidersHorizontal className="h-5 w-5" />
          Filtros
          <span className="text-sm font-semibold">{filtersOpen ? "Ocultar" : "Mostrar"}</span>
        </button>

        <div className={`${filtersOpen ? "block" : "hidden"} mt-3 lg:block`}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1 text-base font-bold text-slate-700">
              Periodo
              <select value={filters.dateMode} onChange={(event) => setFilters((current) => ({ ...current, dateMode: event.target.value as typeof current.dateMode }))} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3">
                <option value="all">Todos los movimientos</option>
                <option value="month">Por mes</option>
                <option value="date">Fecha específica</option>
                <option value="range">Rango de fechas</option>
              </select>
            </label>
            {filters.dateMode === "month" && (
              <label className="space-y-1 text-base font-bold text-slate-700">
                Mes
                <input type="month" value={filters.month} onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))} className="h-12 w-full rounded-2xl border border-slate-200 px-3" />
              </label>
            )}
            {filters.dateMode === "date" && (
              <label className="space-y-1 text-base font-bold text-slate-700">
                Fecha
                <input type="date" value={filters.exactDate} onChange={(event) => setFilters((current) => ({ ...current, exactDate: event.target.value }))} className="h-12 w-full rounded-2xl border border-slate-200 px-3" />
              </label>
            )}
            {filters.dateMode === "range" && (
              <>
                <label className="space-y-1 text-base font-bold text-slate-700">
                  Fecha desde
                  <input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} className="h-12 w-full rounded-2xl border border-slate-200 px-3" />
                </label>
                <label className="space-y-1 text-base font-bold text-slate-700">
                  Fecha hasta
                  <input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} className="h-12 w-full rounded-2xl border border-slate-200 px-3" />
                </label>
              </>
            )}
            <label className="space-y-1 text-base font-bold text-slate-700">
              Categoría
              <select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3">
                <option value="todas">Todas</option>
                {categories.map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-base font-bold text-slate-700">
              Cuenta
              <select value={filters.accountId} onChange={(event) => setFilters((current) => ({ ...current, accountId: event.target.value }))} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3">
                <option value="">Todas</option>
                {accounts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.isActive ? item.name : `${item.name} (archivada)`}
                  </option>
                ))}
                <option value={UNASSIGNED_ACCOUNT_ID}>Sin cuenta (histórico)</option>
              </select>
            </label>
            <label className="space-y-1 text-base font-bold text-slate-700">
              Tipo
              <select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value as typeof current.type }))} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3">
                <option value="todos">Todos</option>
                <option value="ingreso">Ingreso</option>
                <option value="egreso">Gasto</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button type="button" onClick={() => void handleExport()} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-base font-black text-white hover:bg-emerald-700">
            <Download className="h-5 w-5" />
            Descargar Excel
          </button>
          <button type="button" onClick={() => setFilters(defaultMovementFilters())} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-slate-200 px-5 py-3 text-base font-black text-slate-700 hover:bg-slate-300">
            <RotateCcw className="h-5 w-5" />
            Limpiar filtros
          </button>
          <span className="text-base font-bold text-slate-600">{filtered.length} movimientos encontrados</span>
        </div>
      </div>

      <div className="space-y-3 lg:hidden">
        {filtered.map((movement) => (
          <article key={movement.id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`text-xs font-black uppercase tracking-wide ${movement.type === "ingreso" ? "text-emerald-700" : "text-red-700"}`}>{movement.type === "ingreso" ? "Ingreso" : "Gasto"}</p>
                  {pendingMovementIds.has(movement.id) && <PendingMovementBadge />}
                </div>
                <h3 className="mt-1 break-words text-lg font-black text-slate-900">{movement.description}</h3>
              </div>
              <p className={`shrink-0 text-xl font-black ${movement.type === "ingreso" ? "text-emerald-700" : "text-red-700"}`}>{movement.type === "ingreso" ? "+" : "-"}{formatMoney(movement.amount)}</p>
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-600">{formatMovementDate(movement.date)} · {accountNameForMovement(movement, accounts)}</p>
            <p className="mt-1 text-sm text-slate-500">{movement.category} · {movement.person}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" disabled={pendingMovementIds.has(movement.id)} onClick={() => setEditing(movement)} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-blue-100 px-3 text-base font-black text-blue-800 hover:bg-blue-200 disabled:cursor-not-allowed disabled:opacity-60">
                <Edit className="h-5 w-5" />
                Editar
              </button>
              <button type="button" disabled={pendingMovementIds.has(movement.id) || deletingId !== null} onClick={() => void handleDelete(movement.id)} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-red-100 px-3 text-base font-black text-red-800 hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-60">
                <Trash2 className="h-5 w-5" />
                {deletingId === movement.id ? "Eliminando..." : "Eliminar"}
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-3xl bg-white p-5 shadow-sm lg:block">
        <table className="w-full min-w-[900px] border-separate border-spacing-y-2">
          <thead>
            <tr className="text-left text-sm uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Descripción</th>
              <th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2">Cuenta</th>
              <th className="px-3 py-2">Monto</th>
              <th className="px-3 py-2">Persona</th>
              <th className="px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((movement) => (
              <tr key={movement.id} className="rounded-2xl bg-slate-50 text-base">
                <td className="rounded-l-2xl px-3 py-4">{movement.date}</td>
                <td className={`px-3 py-4 font-black ${movement.type === "ingreso" ? "text-emerald-700" : "text-red-700"}`}>
                  <div className="flex flex-col items-start gap-2">
                    <span>{movement.type === "ingreso" ? "Ingreso" : "Gasto"}</span>
                    {pendingMovementIds.has(movement.id) && <PendingMovementBadge />}
                  </div>
                </td>
                <td className="px-3 py-4">{movement.description}</td>
                <td className="px-3 py-4">{movement.category}</td>
                <td className="px-3 py-4">{accountNameForMovement(movement, accounts)}</td>
                <td className="px-3 py-4 font-black">{formatMoney(movement.amount)}</td>
                <td className="px-3 py-4">{movement.person}</td>
                <td className="rounded-r-2xl px-3 py-4">
                  <div className="flex gap-2">
                    <button type="button" disabled={pendingMovementIds.has(movement.id)} onClick={() => setEditing(movement)} className="flex min-h-12 items-center gap-2 rounded-xl bg-blue-100 px-3 text-sm font-black text-blue-800 hover:bg-blue-200 disabled:cursor-not-allowed disabled:opacity-60">
                      <Edit className="h-5 w-5" />
                      Editar
                    </button>
                    <button type="button" disabled={pendingMovementIds.has(movement.id) || deletingId !== null} onClick={() => void handleDelete(movement.id)} className="flex min-h-12 items-center gap-2 rounded-xl bg-red-100 px-3 text-sm font-black text-red-800 hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-60">
                      <Trash2 className="h-5 w-5" />
                      {deletingId === movement.id ? "Eliminando..." : "Eliminar"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && <p className="rounded-3xl bg-white p-8 text-center text-lg text-slate-500 shadow-sm">No hay movimientos para la búsqueda o los filtros elegidos.</p>}
    </section>
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
