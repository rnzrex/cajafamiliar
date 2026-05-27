import { Save } from "lucide-react";
import { useMemo, useState } from "react";
import { CashCount, Movement } from "../types";
import { expectedCash, formatMoney } from "../utils/calculations";

const denominations = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];

interface CashCounterProps {
  movements: Movement[];
  initialBalance: number;
  cashCounts: CashCount[];
  onSave: (cashCount: Omit<CashCount, "id">) => void;
}

export function CashCounter({ movements, initialBalance, cashCounts, onSave }: CashCounterProps) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const expected = expectedCash(movements, initialBalance);
  const total = useMemo(() => denominations.reduce((sum, denomination) => sum + denomination * (counts[denomination] ?? 0), 0), [counts]);
  const difference = total - expected;

  function saveCount() {
    onSave({
      createdAt: new Date().toISOString(),
      denominations: counts,
      total,
      expected,
      difference,
    });
  }

  const message =
    Math.abs(difference) < 0.01
      ? { text: "La caja cuadra correctamente", className: "bg-blue-50 text-blue-800" }
      : difference < 0
        ? { text: `Faltan ${formatMoney(Math.abs(difference))}`, className: "bg-red-50 text-red-800" }
        : { text: `Sobran ${formatMoney(difference)}`, className: "bg-green-50 text-green-800" };

  return (
    <section className="space-y-5">
      <div className="rounded-lg bg-white p-5 soft-shadow">
        <h2 className="text-2xl font-bold text-slate-800">Conteo de caja</h2>
        <p className="mt-1 text-slate-600">Ingresa cuantas monedas o billetes tienes fisicamente.</p>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="text-left text-sm uppercase tracking-wide text-slate-500">
                <th className="py-3">Denominacion</th>
                <th className="py-3">Cantidad</th>
                <th className="py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {denominations.map((denomination) => (
                <tr key={denomination} className="border-t border-slate-100">
                  <td className="py-3 text-xl font-bold text-slate-700">{formatMoney(denomination)}</td>
                  <td className="py-3">
                    <input
                      min="0"
                      type="number"
                      value={counts[denomination] ?? ""}
                      onChange={(event) => setCounts((current) => ({ ...current, [denomination]: Number(event.target.value) || 0 }))}
                      className="h-14 w-32 rounded-lg border border-slate-200 px-4 text-xl"
                    />
                  </td>
                  <td className="py-3 text-right text-xl font-semibold">{formatMoney(denomination * (counts[denomination] ?? 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-slate-600">Total contado</p>
            <p className="text-3xl font-bold">{formatMoney(total)}</p>
          </div>
          <div className="rounded-lg bg-blue-50 p-4 text-blue-800">
            <p>Saldo esperado</p>
            <p className="text-3xl font-bold">{formatMoney(expected)}</p>
          </div>
          <div className={`rounded-lg p-4 text-xl font-bold ${message.className}`}>{message.text}</div>
        </div>

        <button type="button" onClick={saveCount} className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-xl font-bold text-white hover:bg-blue-700 sm:w-auto">
          <Save className="h-6 w-6" />
          Guardar conteo
        </button>
      </div>

      <div className="rounded-lg bg-white p-5 soft-shadow">
        <h3 className="text-xl font-bold text-slate-800">Conteos guardados</h3>
        <div className="mt-3 space-y-2">
          {cashCounts.length === 0 && <p className="text-slate-500">Aun no hay conteos guardados.</p>}
          {[...cashCounts]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 6)
            .map((count) => (
              <div key={count.id} className="grid grid-cols-1 gap-2 rounded-lg bg-slate-50 p-3 md:grid-cols-4">
                <span>{new Date(count.createdAt).toLocaleString("es-PE")}</span>
                <strong>Contado: {formatMoney(count.total)}</strong>
                <span>Esperado: {formatMoney(count.expected)}</span>
                <span className={count.difference < 0 ? "text-red-700" : "text-green-700"}>Diferencia: {formatMoney(count.difference)}</span>
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}
