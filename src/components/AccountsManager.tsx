import { ArchiveRestore, Archive, Pencil, Plus, Save, Wallet, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { FinancialAccount, Movement } from "../types";
import { formatMoney } from "../utils/calculations";
import { accountDisplayName, expectedAccountBalance, getActiveCashAccount } from "../utils/accountHelpers";

const accountTypeLabels: Record<FinancialAccount["reconciliationType"], string> = {
  cash: "Efectivo",
  balance: "Banco / billetera",
};

interface AccountsManagerProps {
  accounts: FinancialAccount[];
  movements: Movement[];
  onSave: (account: Omit<FinancialAccount, "id" | "createdAt" | "updatedAt">, id?: string) => FinancialAccount | null | Promise<FinancialAccount | null>;
  onToggle: (id: string, isActive: boolean) => boolean | Promise<boolean>;
  onEditInitialBalance: () => void;
}

export function AccountsManager({ accounts, movements, onSave, onToggle, onEditInitialBalance }: AccountsManagerProps) {
  const [editing, setEditing] = useState<FinancialAccount | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const sorted = [...accounts].sort((a, b) => {
    if (a.reconciliationType !== b.reconciliationType) return a.reconciliationType === "cash" ? -1 : 1;
    return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  });
  const activeAccounts = sorted.filter((account) => account.isActive);
  const archivedAccounts = sorted.filter((account) => !account.isActive);
  const hasCashAccount = Boolean(getActiveCashAccount(accounts));

  function openCreateForm() {
    setEditing(null);
    setName("");
    setOpeningBalance("");
    setShowForm(true);
  }

  function openEditForm(account: FinancialAccount) {
    setEditing(account);
    setName(account.name);
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
          reconciliationType: "balance",
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
            <p className="mt-1 text-slate-600">Organiza el dinero de la familia en efectivo y cuentas de banco o billetera.</p>
          </div>
          <button type="button" onClick={openCreateForm} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-base font-black text-white shadow-md hover:bg-blue-700">
            <Plus className="h-5 w-5" />
            Nueva cuenta
          </button>
        </div>

        <p className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">
          Los movimientos antiguos sin cuenta seguirán apareciendo en el historial y no se asignarán automáticamente.
        </p>

        {!hasCashAccount && (
          <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-base font-bold text-amber-900">
            La cuenta de Efectivo no está disponible. Recarga la página o intenta nuevamente más tarde.
          </p>
        )}

        <section className="mt-6" aria-label="Cuentas activas">
          <h3 className="text-xl font-black text-slate-900">Cuentas activas</h3>
          {activeAccounts.length === 0 && <p className="mt-2 rounded-2xl bg-slate-50 p-4 text-slate-600">Aún no hay cuentas activas.</p>}
          <div className="mt-3 space-y-3">
            {activeAccounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                balance={expectedAccountBalance(movements, account.id, account.openingBalance)}
                onEdit={() => openEditForm(account)}
                onToggle={() => void handleToggle(account)}
                onEditInitialBalance={onEditInitialBalance}
              />
            ))}
          </div>
        </section>

        <section className="mt-8" aria-label="Cuentas archivadas">
          <h3 className="text-xl font-black text-slate-900">Cuentas archivadas</h3>
          {archivedAccounts.length === 0 && <p className="mt-2 rounded-2xl bg-slate-50 p-4 text-slate-600">No hay cuentas archivadas.</p>}
          <div className="mt-3 space-y-3">
            {archivedAccounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                balance={expectedAccountBalance(movements, account.id, account.openingBalance)}
                onEdit={() => openEditForm(account)}
                onToggle={() => void handleToggle(account)}
                onEditInitialBalance={onEditInitialBalance}
              />
            ))}
          </div>
        </section>
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
                <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. BCP / Yape" className="h-14 w-full rounded-2xl border border-slate-200 px-4 text-lg" />
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

function AccountCard({
  account,
  balance,
  onEdit,
  onToggle,
  onEditInitialBalance,
}: {
  account: FinancialAccount;
  balance: number;
  onEdit: () => void;
  onToggle: () => void;
  onEditInitialBalance: () => void;
}) {
  const isCash = account.reconciliationType === "cash";

  return (
    <article className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Wallet className="h-5 w-5 text-blue-700" />
            <h4 className="truncate text-xl font-black text-slate-900">{accountDisplayName(account)}</h4>
            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-black uppercase tracking-wide text-blue-800">{accountTypeLabels[account.reconciliationType]}</span>
            {!account.isActive && <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-black text-slate-700">Archivada</span>}
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-600">Saldo esperado: {formatMoney(balance)}</p>
          <p className="text-sm font-semibold text-slate-600">Saldo inicial: {formatMoney(account.openingBalance)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isCash ? (
            <button type="button" onClick={onEditInitialBalance} className="flex min-h-10 items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-black text-blue-800 shadow-sm hover:bg-blue-50">
              <Pencil className="h-4 w-4" />
              Editar saldo inicial
            </button>
          ) : (
            <>
              <button type="button" onClick={onEdit} className="flex min-h-10 items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-black text-blue-800 shadow-sm hover:bg-blue-50">
                <Pencil className="h-4 w-4" />
                Editar
              </button>
              <button type="button" onClick={onToggle} className="flex min-h-10 items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-100">
                {account.isActive ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
                {account.isActive ? "Archivar" : "Reactivar"}
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}