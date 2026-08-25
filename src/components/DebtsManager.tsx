import { useState } from "react";
import { Plus, Landmark, Search, Archive, Compass, Calendar, BarChart3, Clock } from "lucide-react";
import type {
  Debt,
  DebtEvent,
  DebtScheduleVersion,
  DebtInstallment,
  DebtEventInstallmentAllocation,
  DebtCollateral,
  FinancialAccount,
  Category,
  HouseholdMember,
  CreditCardProfile,
  CreditCardEntry,
  CreditCardStatement,
} from "../types.js";
import type { DebtInstallmentPlanningItem, DebtPlanningAlertSummary } from "../utils/debtPlanning.js";
import type { DebtIntelligenceItem, DebtPortfolioIntelligence } from "../utils/debtIntelligence.js";
import type { DebtStrategyResult } from "../utils/debtStrategy.js";
import { formatDebtKind, formatDebtStatus } from "../utils/debtViewModel.js";
import { formatDebtMoney } from "../utils/debtPresentation.js";
import { buildAllDebtNextActions } from "../utils/debtAttention.js";
import { DebtAttentionPanel } from "./DebtAttentionPanel.js";
import { DebtPlanningPanel } from "./DebtPlanningPanel.js";
import { DebtPortfolioIntelligencePanel } from "./DebtPortfolioIntelligencePanel.js";
import { DebtStrategyPanel } from "./DebtStrategyPanel.js";

export interface DebtsManagerProps {
  debts: Debt[];
  debtEvents: DebtEvent[];
  scheduleVersions: DebtScheduleVersion[];
  installments: DebtInstallment[];
  allocations: DebtEventInstallmentAllocation[];
  collaterals: DebtCollateral[];
  accounts: FinancialAccount[];
  categories: Category[];
  currentMember?: HouseholdMember;
  creditCardProfiles?: CreditCardProfile[];
  creditCardEntries?: CreditCardEntry[];
  cardStatements?: CreditCardStatement[];
  debtPlanningItems: DebtInstallmentPlanningItem[];
  debtPlanningAlertSummary: DebtPlanningAlertSummary;
  pendingBankScheduleDebtNames?: string[];
  debtPortfolioIntelligence: DebtPortfolioIntelligence;
  debtStrategies: DebtStrategyResult;
  intelligenceItems: DebtIntelligenceItem[];
  onOpenNewDebt: () => void;
  onSelectDebt: (debt: Debt) => void;
  onSelectDebtId?: (debtId: string) => void;
}

export function DebtsManager({
  debts,
  creditCardProfiles = [],
  creditCardEntries = [],
  cardStatements = [],
  debtPlanningItems,
  debtPlanningAlertSummary,
  pendingBankScheduleDebtNames = [],
  debtPortfolioIntelligence,
  debtStrategies,
  intelligenceItems,
  onOpenNewDebt,
  onSelectDebt,
  onSelectDebtId,
}: DebtsManagerProps) {
  const [tab, setTab] = useState<"unarchived" | "strategy" | "archived">("unarchived");
  const [searchQuery, setSearchQuery] = useState("");

  const handleSelectDebtId = (debtId: string) => {
    if (onSelectDebtId) {
      onSelectDebtId(debtId);
      return;
    }
    const found = debts.find((d) => d.id === debtId);
    if (found) onSelectDebt(found);
  };

  const nextActions = buildAllDebtNextActions({
    debts,
    intelligenceItems,
    creditCardProfiles,
    creditCardEntries,
    cardStatements,
  });

  const nextActionMap = new Map(nextActions.map((a) => [a.debtId, a]));
  const intelligenceMap = new Map(intelligenceItems.map((item) => [item.debtId, item]));

  const filteredDebts = debts.filter((debt) => {
    const matchesTab = tab === "archived" ? debt.isArchived : !debt.isArchived;
    const matchesQuery =
      debt.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      debt.creditorName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTab && matchesQuery;
  });

  return (
    <section className="space-y-6">
      {/* 1. Header */}
      <div className="flex flex-col gap-4 rounded-3xl bg-white p-6 shadow-xl sm:flex-row sm:items-center sm:justify-between lg:p-8">
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-blue-100 p-3 text-blue-700 shrink-0">
              <Landmark className="h-7 w-7" />
            </div>
            <div>
              <h2 className="text-2xl font-extrabold text-slate-900">Gestión de Deudas</h2>
              <p className="text-xs sm:text-sm text-slate-500">Control de obligaciones, tarjetas, cronogramas y estrategias de pago</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenNewDebt}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white shadow-md hover:bg-blue-700 transition active:scale-95"
        >
          <Plus className="h-5 w-5" /> Registrar deuda
        </button>
      </div>

      {/* 2. Deterministic Attention Section ("Requiere tu atención") */}
      <DebtAttentionPanel actions={nextActions} onSelectDebtId={handleSelectDebtId} />

      {/* 3. Navigation Tabs & Search */}
      <div className="rounded-3xl bg-white p-6 shadow-xl lg:p-8 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTab("unarchived")}
              className={`min-h-[44px] rounded-xl px-4 py-2.5 text-sm font-extrabold transition ${
                tab === "unarchived" ? "bg-blue-600 text-white shadow" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              No archivadas ({debts.filter((d) => !d.isArchived).length})
            </button>
            <button
              type="button"
              onClick={() => setTab("strategy")}
              className={`min-h-[44px] flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-extrabold transition ${
                tab === "strategy" ? "bg-blue-600 text-white shadow" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              <Compass className="h-4 w-4" /> Panorama & Estrategia
            </button>
            <button
              type="button"
              onClick={() => setTab("archived")}
              className={`min-h-[44px] rounded-xl px-4 py-2.5 text-sm font-extrabold transition ${
                tab === "archived" ? "bg-blue-600 text-white shadow" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Archivadas ({debts.filter((d) => d.isArchived).length})
            </button>
          </div>

          {tab !== "strategy" && (
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por nombre o acreedor..."
                className="w-full rounded-xl border border-slate-300 pl-10 pr-4 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* 4. Strategy & Analysis Tab */}
        {tab === "strategy" && (
          <div className="space-y-6">
            <DebtPortfolioIntelligencePanel portfolio={debtPortfolioIntelligence} />
            <DebtPlanningPanel
              debtPlanningItems={debtPlanningItems}
              debtPlanningAlertSummary={debtPlanningAlertSummary}
              pendingBankScheduleDebtNames={pendingBankScheduleDebtNames}
              onSelectDebtId={handleSelectDebtId}
            />
            <DebtStrategyPanel
              strategies={debtStrategies}
              intelligenceItems={intelligenceItems}
              onSelectDebtId={handleSelectDebtId}
            />
          </div>
        )}

        {/* 5. Main Debt List Cards Grid */}
        {tab !== "strategy" && (
          <div>
            {filteredDebts.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 p-12 text-center">
                <Archive className="h-12 w-12 text-slate-300 mb-3" />
                <p className="text-base font-bold text-slate-700">
                  {tab === "archived" ? "No hay deudas archivadas" : "No tienes deudas registradas"}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {tab === "archived"
                    ? "Las deudas archivadas aparecerán aquí."
                    : "Intenta registrar una nueva obligación o ajustar los filtros de búsqueda."}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredDebts.map((debt) => {
                  const intelItem = intelligenceMap.get(debt.id);
                  const nextAction = nextActionMap.get(debt.id);

                  const principalDisplay = intelItem
                    ? formatDebtMoney(intelItem.currentPrincipal, intelItem.currencyCode)
                    : "Saldo no disponible";

                  const badgeLabel = nextAction?.badgeLabel || formatDebtStatus(debt.status);
                  const badgeTone = nextAction?.badgeTone || (debt.status === "active" ? "emerald" : "slate");

                  const badgeStyle =
                    badgeTone === "red"
                      ? "bg-red-100 text-red-900 border-red-200"
                      : badgeTone === "orange"
                      ? "bg-orange-100 text-orange-900 border-orange-200"
                      : badgeTone === "amber"
                      ? "bg-amber-100 text-amber-900 border-amber-200"
                      : badgeTone === "blue"
                      ? "bg-blue-100 text-blue-900 border-blue-200"
                      : badgeTone === "emerald"
                      ? "bg-emerald-100 text-emerald-900 border-emerald-200"
                      : "bg-slate-100 text-slate-700 border-slate-200";

                  return (
                    <button
                      key={debt.id}
                      type="button"
                      onClick={() => onSelectDebt(debt)}
                      className="w-full text-left group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-blue-500 hover:shadow-md transition active:scale-[0.99]"
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-700">
                            {formatDebtKind(debt.debtKind)}
                          </span>
                          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-extrabold ${badgeStyle}`}>
                            {badgeLabel}
                          </span>
                        </div>

                        <div>
                          <h3 className="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition">
                            {debt.name}
                          </h3>
                          <p className="text-xs text-slate-500">Acreedor: {debt.creditorName}</p>
                        </div>

                        {nextAction && nextAction.kind !== "none" && (
                          <div className="rounded-xl bg-slate-50 p-2.5 text-xs text-slate-600 space-y-0.5 border border-slate-100">
                            <p className="font-extrabold text-slate-800 flex items-center gap-1">
                              <Clock className="h-3 w-3 text-slate-400 shrink-0" />
                              {nextAction.title}
                            </p>
                            <p className="text-slate-500 line-clamp-1">{nextAction.detail}</p>
                          </div>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between w-full">
                        <div>
                          <p className="text-xs font-semibold text-slate-400">
                            {debt.debtKind === "credit_card" ? "Saldo actual" : "Saldo principal"}
                          </p>
                          <p className="text-lg font-extrabold text-slate-900">{principalDisplay}</p>
                        </div>
                        <span className="text-sm font-bold text-blue-600 group-hover:translate-x-1 transition">
                          Ver detalle &rarr;
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
