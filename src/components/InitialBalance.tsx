import { Save } from "lucide-react";
import { FormEvent, useState } from "react";
import { formatMoney } from "../utils/calculations";

interface InitialBalanceProps {
  initialBalance: number;
  onSave: (value: number) => void | Promise<boolean>;
}

export function InitialBalance({ initialBalance, onSave }: InitialBalanceProps) {
  const [value, setValue] = useState(initialBalance.toString());
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    try {
      await onSave(Number(value) || 0);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg bg-white p-5 soft-shadow">
      <h2 className="text-2xl font-bold text-slate-800">Saldo inicial de caja</h2>
      <div className="my-5 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-lg font-semibold text-yellow-900">
        El saldo inicial es la base para calcular cuanto dinero deberia haber en caja.
      </div>
      <label className="space-y-2 text-lg font-semibold text-slate-700">
        Saldo actual configurado: {formatMoney(initialBalance)}
        <input type="number" min="0" step="0.01" value={value} onChange={(event) => setValue(event.target.value)} className="h-14 w-full rounded-lg border border-slate-200 px-4 text-xl" />
      </label>
      <button disabled={isSaving} type="submit" className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-xl font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">
        <Save className="h-6 w-6" />
        {isSaving ? "Guardando..." : "Guardar saldo inicial"}
      </button>
    </form>
  );
}
