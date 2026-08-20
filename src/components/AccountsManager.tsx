import { ArchiveRestore, Pencil, Plus, Save, Wallet, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { AccountReconciliationType, FinancialAccount, Movement } from "../types";
import { formatMoney } from "../utils/calculations";
import { accountDisplayName, expectedAccountBalance, isDefaultCashAccount } from "../utils/accountHelpers";

const typeLabels: Record<AccountReconciliationType, string> = {
  cash: "Cuenta de efectivo",
  balance: "Cuenta de saldo",
};

interface AccountsManagerProps {
  accounts: FinancialAccount[];
  movements: Movement[];
  onSave: (account: Omit<FinancialAccount, "id" | "createdAt" | "updatedAt">, id?: string) => FinancialAccount | null | Promise<FinancialAccount | null>;
  onToggle: (id: string, isActive: boolean) => boolean | Promise<boolean>;
}

export function AccountsManager({ accounts, movements, onSave, onToggle }: AccountsManagerProps) {
  const [editing, setEditing] = useState<FinancialAccount | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountReconciliationType>("balance");
  const [openingBalance, setOpeningBalance] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const sorted = [...accounts].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  function openCreateForm() {
    setEditing(null);
    setName("");
    setType("balance");
    setOpeningBalance("");
    setShowForm(true);
  }

  function openEditForm(account: FinancialAccount) {
    setEditing(account);
    setName(account.name);
    setType(account.reconciliationType);
    setOpeningBalance(account.openingBalance.toString());
    setShowForm(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    try {
      const saved = await onSave(
        {
          name: name.trim(),
          reconciliationType: type,
          openingBalance: Number(openingBalance) || 0,
          isActive: editing?.isActive ?? true,
          sortOrder: editing?.sortOrder ?? sorted.length,
        },
        editing?.id
      );
      if (saved) setShowForm(false);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggle(account: FinancialAccount) {
    if (isDefaultCashAccount(account)) return;
    const verb = account.isActive ? "archivar" : "reactivar";
    if (account.isActive && !window.confirm(`Seguro que deseas archivar la cuenta "${account.name}"? Los movimientos históricos se conservan.`)) return;
    const saved = await onToggle(account.id, !account.isActive);
    if (saved) setEditing(null);
  }

  return (
    <section className="space-y-5">
      <div className="rounded-3xl bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-3xl font-black text-slate-900">Cuentas</h2>
            <p className="mt-1 text-slate-600">Organiza el dinero de la familia por cuentas de efectivo o saldo.</p>
          </div>
          <button type="button" onClick={openCreateForm} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-base font-black text-white shadow-md hover:bg-blue-700">
            <Plus className="h-5 w-5" />
            Nueva cuenta
          </button>
        </div>

        {sorted.length === 0 && <p className="rounded-2xl bg-slate-50 p-5 text-slate-600">Aún no hay cuentas. Crea la cuenta de Efectivo para controlar la caja física.</p>}

        <div className="mt-4 space-y-3">
          {sorted.map((account) => {
            const balance = expectedAccountBalance(movements, account.id, account.openingBalance);
            return (
              <article key={account.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Wallet className="h-5 w-5 text-blue-700" />
                      <h3 className="truncate text-xl font-black text-slate-900">{accountDisplayName(account)}</h3>
                      {!account.isActive && <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-black text-slate-700">Archivada</span>}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-600">{typeLabels[account.reconciliationType]} · Saldo inicial {formatMoney(account.openingBalance)}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <strong className="text-xl font-black text-slate-900">{formatMoney(balance)}</strong>
                    <button type="button" onClick={() => openEditForm(account)} className="flex min-h-10 items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-black text-blue-800 shadow-sm hover:bg-blue-50">
                      <Pencil className="h-4 w-4" />
                      Editar
                    </button>
                    <button
                      type="button"
                      disabled={isDefaultCashAccount(account)}
                      onClick={() => void handleToggle(account)}
                      className="flex min-h-10 items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ArchiveRestore className="h-4 w-4" />
                      {account.isActive ? "Archivar" : "Restaurar"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {sorted.some(isDefaultCashAccount) && (
          <p className="mt-4 text-sm text-slate-500">La cuenta Efectivo se mantiene siempre activa porque respalda el conteo de caja.</p>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-label={editing ? "Editar cuenta" : "Nueva cuenta"}>
          <form onSubmit={handleSubmit} className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-2xl font-black text-slate-900">{editing ? "Editar cuenta" : "Nueva cuenta"}</h3>
              <button type="button" onClick={() => setShowForm(false)} className="rounded-full bg-slate-100 p-3 text-slate-600 hover:bg-slate-200" aria-label="Cerrar formulario de cuenta">
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="space-y-4">
              <label className="block space-y-2 text-base font-bold text-slate-700">
                Nombre
                <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Cuenta Yape" className="h-14 w-full rounded-2xl border border-slate-200 px-4 text-lg" />
              </label>
              <label className="block space-y-2 text-base font-bold text-slate-700">
                Tipo
                <select value={type} onChange={(event) => setType(event.target.value as AccountReconciliationType)} className="h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-lg">
                  <option value="cash">{typeLabels.cash}</option>
                  <option value="balance">{typeLabels.balance}</option>
                </select>
              </label>
              <label className="block space-y-2 text-base font-bold text-slate-700">
                Saldo inicial
                <div className="flex h-16 items-center rounded-2xl border border-slate-200 bg-slate-50 px-4">
                  <span className="mr-2 text-xl font-black text-slate-500">S/</span>
                  <input min="0" step="0.01" inputMode="decimal" type="number" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} placeholder="0.00" className="h-full min-w-0 flex-1 bg-transparent text-2xl font-black text-slate-900 outline-none" />
                </div>
              </label>
              <button disabled={isSaving} type="submit" className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-lg font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
                <Save className="h-5 w-5" />
                {isSaving ? "Guardando..." : editing ? "Guardar cambios" : "Crear cuenta"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}