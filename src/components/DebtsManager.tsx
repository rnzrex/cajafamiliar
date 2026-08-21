import { useState } from "react";
import { Plus, Landmark, Search, Archive, AlertCircle } from "lucide-react";
import type { Debt, DebtEvent, DebtScheduleVersion, DebtInstallment, DebtEventInstallmentAllocation, DebtCollateral, FinancialAccount, Category, HouseholdMember } from "../types";
import type { DebtInstallmentPlanningItem, DebtPlanningAlertSummary } from "../utils/debtPlanning";
import { currentDebtPrincipal } from "../utils/debtCalculations";
import { formatDebtKind, formatDebtStatus } from "../utils/debtViewModel";
import { DebtPlanningPanel } from "./DebtPlanningPanel";

interface DebtsManagerProps {
  debts: Debt[];
  debtEvents: DebtEvent[];
  scheduleVersions: DebtScheduleVersion[];
  installments: DebtInstallment[];
  allocations: DebtEventInstallmentAllocation[];
  collaterals: DebtCollateral[];
  accounts: FinancialAccount[];
  categories: Category[];
  currentMember?: HouseholdMember;
  debtPlanningItems: DebtInstallmentPlanningItem[];
  debtPlanningAlertSummary: DebtPlanningAlertSummary;
  onOpenNewDebt: () => void;
  onSelectDebt: (debt: Debt) => void;
  onSelectDebtId?: (debtId: string) => void;
}

export function DebtsManager({
  debts,
  debtEvents,
  debtPlanningItems,
  debtPlanningAlertSummary,
  onOpenNewDebt,
  onSelectDebt,
  onSelectDebtId,
}: DebtsManagerProps) {
  const [tab, setTab] = useState<"unarchived" | "archived">("unarchived");
  const [searchQuery, setSearchQuery] = useState("");

  const handleSelectDebtId = (debtId: string) => {
    if (onSelectDebtId) {
      onSelectDebtId(debtId);
      return;
    }
    const found = debts.find((d) => d.id === debtId);
    if (found) onSelectDebt(found);
  };

  const filteredDebts = debts.filter((debt) => {
    const matchesTab = tab === "unarchived" ? !debt.isArchived : debt.isArchived;
    const matchesQuery =
      debt.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      debt.creditorName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTab && matchesQuery;
  });

  const totalActivePrincipal = debts
    .filter((d) => !d.isArchived && d.status === "active")
    .reduce((sum, d) => sum + currentDebtPrincipal(d, debtEvents), 0);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 rounded-3xl bg-white p-6 shadow-xl sm:flex-row sm:items-center sm:justify-between lg:p-8">
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-blue-100 p-3 text-blue-700">
              <Landmark className="h-7 w-7" />
            </div>
            <div>
              <h2 className="text-2xl font-extrabold text-slate-900">Gestión de Deudas</h2>
              <p className="text-sm text-slate-500">Control de obligaciones, cronogramas, pagos y amortizaciones</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenNewDebt}
          className="flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white shadow-md hover:bg-blue-700 transition"
        >
          <Plus className="h-5 w-5" /> Registrar deuda
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-3xl bg-white p-6 shadow-md">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Principal total activo</p>
          <p className="mt-2 text-3xl font-extrabold text-slate-900">
            S/ {totalActivePrincipal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="rounded-3xl bg-white p-6 shadow-md">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Deudas activas</p>
          <p className="mt-2 text-3xl font-extrabold text-blue-600">
            {debts.filter((d) => !d.isArchived && d.status === "active").length}
          </p>
        </div>
        <div className="rounded-3xl bg-white p-6 shadow-md">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Deudas pagadas / archivadas</p>
          <p className="mt-2 text-3xl font-extrabold text-emerald-600">
            {debts.filter((d) => d.isArchived || d.status === "paid_off").length}
          </p>
        </div>
      </div>

      <DebtPlanningPanel
        debtPlanningItems={debtPlanningItems}
        debtPlanningAlertSummary={debtPlanningAlertSummary}
        onSelectDebtId={handleSelectDebtId}
      />

      <div className="rounded-3xl bg-white p-6 shadow-xl lg:p-8 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTab("unarchived")}
              className={`rounded-xl px-5 py-2.5 font-bold transition ${tab === "unarchived" ? "bg-blue-600 text-white shadow" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
              No archivadas
            </button>
            <button
              type="button"
              onClick={() => setTab("archived")}
              className={`rounded-xl px-5 py-2.5 font-bold transition ${tab === "archived" ? "bg-blue-600 text-white shadow" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
              Archivadas
            </button>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3.5 top-3 h-5 w-5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nombre o acreedor..."
              className="w-full rounded-xl border border-slate-300 pl-11 pr-4 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>
        </div>

        {filteredDebts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 p-12 text-center">
            <Archive className="h-12 w-12 text-slate-300 mb-3" />
            <p className="text-base font-bold text-slate-700">No se encontraron deudas</p>
            <p className="text-sm text-slate-500 mt-1">Intenta registrar una nueva obligación o cambiar el filtro de búsqueda.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredDebts.map((debt) => {
              const principal = currentDebtPrincipal(debt, debtEvents);
              return (
                <div
                  key={debt.id}
                  onClick={() => onSelectDebt(debt)}
                  className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-blue-500 hover:shadow-md transition cursor-pointer"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-700">{formatDebtKind(debt.debtKind)}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${debt.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>
                        {formatDebtStatus(debt.status)}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition">{debt.name}</h3>
                    <p className="text-xs text-slate-500">Acreedor: {debt.creditorName}</p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-slate-400">Saldo principal</p>
                      <p className="text-lg font-extrabold text-slate-900">
                        {debt.currencyCode} {principal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-blue-600 group-hover:translate-x-1 transition">Ver detalle &rarr;</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
