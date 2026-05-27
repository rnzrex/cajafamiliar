import { Save } from "lucide-react";
import { FormEvent, useState } from "react";
import { formatMoney } from "../utils/calculations";

interface InitialBalanceProps {
  initialBalance: number;
  onSave: (value: number) => void;
}

export function InitialBalance({ initialBalance, onSave }: InitialBalanceProps) {
  const [value, setValue] = useState(initialBalance.toString());

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSave(Number(value) || 0);
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg bg-white p-5 soft-shadow">
      <h2 className="text-2xl font-bold text-slate-800">Saldo inicial de caja</h2>
      <div className="my-5 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-lg font-semibold text-yellow-900">
        El saldo inicial es la base para calcular cuanto dinero deberia haber en caja.
      </div>
      <label className="space-y-2 text-lg font-semibold text-slate-700">
        Saldo actual configurado: {formatMoney(initialBalance)}
        <input type="number" min="0" step="0.1" value={value} onChange={(event) => setValue(event.target.value)} className="h-14 w-full rounded-lg border border-slate-200 px-4 text-xl" />
      </label>
      <button type="submit" className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-xl font-bold text-white hover:bg-blue-700 sm:w-auto">
        <Save className="h-6 w-6" />
        Guardar saldo inicial
      </button>
    </form>
  );
}
