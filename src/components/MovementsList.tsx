import { Download, Edit, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Category, Movement, paymentMethods } from "../types";
import { formatMoney } from "../utils/calculations";
import { exportMovementsExcel } from "../utils/excelExport";
import { defaultMovementFilters, filterMovements } from "../utils/movementFilters";
import { MovementForm } from "./MovementForm";

interface MovementsListProps {
  movements: Movement[];
  categories: Category[];
  onQuickCreateCategory: (category: Omit<Category, "id" | "created_at">) => Category | null;
  onSave: (movement: Omit<Movement, "id">, id?: string) => void;
  onDelete: (id: string) => void;
}

export function MovementsList({ movements, categories, onQuickCreateCategory, onSave, onDelete }: MovementsListProps) {
  const [filters, setFilters] = useState(defaultMovementFilters);
  const [editing, setEditing] = useState<Movement | null>(null);

  const filtered = useMemo(() => filterMovements(movements, filters), [movements, filters]);

  if (editing) {
    return (
      <MovementForm
        movement={editing}
        categories={categories}
        onQuickCreateCategory={onQuickCreateCategory}
        onSave={(movement, id) => {
          onSave(movement, id);
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <section className="rounded-lg bg-white p-5 soft-shadow">
      <div className="mb-5">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Movimientos</h2>
          <p className="mt-1 text-slate-600">Solo los movimientos en efectivo afectan el saldo esperado de caja.</p>
        </div>
      </div>

      <div className="mb-5 rounded-lg border border-slate-100 bg-slate-50 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1 font-semibold text-slate-700">
            Periodo
            <select value={filters.dateMode} onChange={(event) => setFilters((current) => ({ ...current, dateMode: event.target.value as typeof current.dateMode }))} className="h-12 w-full rounded-lg border border-slate-200 bg-white px-3">
              <option value="all">Todos los movimientos</option>
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
          <button type="button" onClick={() => exportMovementsExcel(filtered)} className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-green-600 px-5 py-3 text-lg font-bold text-white hover:bg-green-700">
            <Download className="h-5 w-5" />
            Descargar Excel
          </button>
          <button type="button" onClick={() => setFilters(defaultMovementFilters())} className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-slate-200 px-5 py-3 text-lg font-bold text-slate-700 hover:bg-slate-300">
            <RotateCcw className="h-5 w-5" />
            Limpiar filtros
          </button>
          <span className="flex items-center text-base font-semibold text-slate-600">{filtered.length} movimientos visibles</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-separate border-spacing-y-2">
          <thead>
            <tr className="text-left text-sm uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Descripcion</th>
              <th className="px-3 py-2">Categoria</th>
              <th className="px-3 py-2">Metodo</th>
              <th className="px-3 py-2">Monto</th>
              <th className="px-3 py-2">Persona</th>
              <th className="px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((movement) => (
              <tr key={movement.id} className="rounded-lg bg-slate-50 text-base">
                <td className="rounded-l-lg px-3 py-4">{movement.date}</td>
                <td className={`px-3 py-4 font-bold ${movement.type === "ingreso" ? "text-green-700" : "text-red-700"}`}>{movement.type}</td>
                <td className="px-3 py-4">{movement.description}</td>
                <td className="px-3 py-4">{movement.category}</td>
                <td className="px-3 py-4">{movement.method}</td>
                <td className="px-3 py-4 font-bold">{formatMoney(movement.amount)}</td>
                <td className="px-3 py-4">{movement.person}</td>
                <td className="rounded-r-lg px-3 py-4">
                  <div className="flex gap-2">
                    <button type="button" title="Editar" onClick={() => setEditing(movement)} className="rounded-lg bg-blue-100 p-3 text-blue-700 hover:bg-blue-200">
                      <Edit className="h-5 w-5" />
                    </button>
                    <button type="button" title="Eliminar" onClick={() => onDelete(movement.id)} className="rounded-lg bg-red-100 p-3 text-red-700 hover:bg-red-200">
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && <p className="py-8 text-center text-lg text-slate-500">No hay movimientos para los filtros elegidos.</p>}
    </section>
  );
}
