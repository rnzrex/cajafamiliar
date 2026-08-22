import { ArrowRight, ChevronDown, Compass, Flame, ShieldAlert, Snowflake, Zap } from "lucide-react";
import type { DebtIntelligenceItem } from "../utils/debtIntelligence";
import type { DebtStrategyResult } from "../utils/debtStrategy";
import {
  avalancheComparisonModeLabel,
  cashFlowUnrankedReasonLabel,
  dueStatusLabel,
  formatDebtMoney,
} from "../utils/debtPresentation";

export interface DebtStrategyPanelProps {
  strategies: DebtStrategyResult;
  intelligenceItems: DebtIntelligenceItem[];
  onSelectDebtId: (debtId: string) => void;
}

export function DebtStrategyPanel({
  strategies,
  intelligenceItems,
  onSelectDebtId,
}: DebtStrategyPanelProps) {
  const { snowball, avalanche, urgency, cashFlowRelief30d } = strategies;

  return (
    <section className="space-y-4 rounded-3xl bg-white p-6 shadow-xl lg:p-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="rounded-2xl bg-purple-50 p-2.5 text-purple-600">
          <Compass className="h-6 w-6" />
        </div>
        <div>
          <h3 className="text-xl font-extrabold text-slate-900">Estrategias de priorización</h3>
          <p className="text-xs text-slate-500">
            Cada método responde una pregunta distinta; no existe una recomendación automática única.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {/* 1. Urgencia (Open by default) */}
        <details className="group rounded-2xl border border-slate-200 bg-slate-50/50 p-4 transition" open>
          <summary className="flex cursor-pointer items-center justify-between font-bold text-slate-900 list-none">
            <div className="flex items-center gap-2.5">
              <Zap className="h-5 w-5 text-amber-500" />
              <span>Urgencia</span>
            </div>
            <ChevronDown className="h-5 w-5 text-slate-400 group-open:rotate-180 transition" />
          </summary>
          <div className="mt-3 pt-3 border-t border-slate-200/60 space-y-3 text-sm">
            <p className="text-xs text-slate-600">Prioriza la obligación pendiente con fecha más antigua.</p>
            {urgency.rankedCandidates.length === 0 ? (
              <p className="text-xs italic text-slate-500">No hay deudas activas con próxima cuota pendiente.</p>
            ) : (
              <div className="space-y-2">
                {urgency.rankedCandidates.map((c) => {
                  const statusInfo = dueStatusLabel(c.nextInstallmentDueStatus);
                  return (
                    <button
                      key={c.debtId}
                      type="button"
                      onClick={() => onSelectDebtId(c.debtId)}
                      className="w-full flex items-center justify-between rounded-xl bg-white p-3 text-left shadow-sm border border-slate-100 hover:border-blue-400 hover:bg-blue-50/30 transition group/btn"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-black text-amber-800">
                          #{c.urgencyRank}
                        </span>
                        <div>
                          <p className="font-bold text-slate-900 group-hover/btn:text-blue-600 transition">
                            {c.debtName}
                          </p>
                          <p className="text-xs text-slate-500">Vence: {c.nextInstallmentDueDate}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span
                          className={`inline-block rounded-md px-2 py-0.5 text-xs font-bold ${
                            statusInfo.tone === "red"
                              ? "bg-red-100 text-red-800"
                              : statusInfo.tone === "orange"
                              ? "bg-orange-100 text-orange-800"
                              : statusInfo.tone === "yellow"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {statusInfo.label}
                        </span>
                        {c.nextInstallmentRemainingAmount != null && (
                          <p className="text-xs font-bold text-slate-700 mt-0.5">
                            {formatDebtMoney(c.nextInstallmentRemainingAmount, c.currencyCode)}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {urgency.unrankedDebtIds.length > 0 && (
              <p className="text-xs text-slate-500 pt-1">
                {urgency.unrankedDebtIds.length} {urgency.unrankedDebtIds.length === 1 ? "deuda no tiene" : "deudas no tienen"} una próxima obligación rankeable.
              </p>
            )}
          </div>
        </details>

        {/* 2. Bola de nieve */}
        <details className="group rounded-2xl border border-slate-200 bg-slate-50/50 p-4 transition">
          <summary className="flex cursor-pointer items-center justify-between font-bold text-slate-900 list-none">
            <div className="flex items-center gap-2.5">
              <Snowflake className="h-5 w-5 text-blue-500" />
              <span>Bola de nieve</span>
            </div>
            <ChevronDown className="h-5 w-5 text-slate-400 group-open:rotate-180 transition" />
          </summary>
          <div className="mt-3 pt-3 border-t border-slate-200/60 space-y-3 text-sm">
            <p className="text-xs text-slate-600">Prioriza el menor saldo principal. Las monedas se comparan por separado.</p>
            {Object.keys(snowball.byCurrency).length === 0 ? (
              <p className="text-xs italic text-slate-500">No hay deudas activas para rankear en bola de nieve.</p>
            ) : (
              Object.entries(snowball.byCurrency).map(([curr, candidates]) => (
                <div key={curr} className="space-y-2">
                  <span className="text-xs font-extrabold uppercase tracking-wide text-blue-700">Moneda: {curr}</span>
                  {candidates.map((c) => (
                    <button
                      key={c.debtId}
                      type="button"
                      onClick={() => onSelectDebtId(c.debtId)}
                      className="w-full flex items-center justify-between rounded-xl bg-white p-3 text-left shadow-sm border border-slate-100 hover:border-blue-400 hover:bg-blue-50/30 transition group/btn"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-black text-blue-800">
                          #{c.rankWithinCurrency}
                        </span>
                        <span className="font-bold text-slate-900 group-hover/btn:text-blue-600 transition">
                          {c.debtName}
                        </span>
                      </div>
                      <span className="font-extrabold text-slate-900">
                        {formatDebtMoney(c.currentPrincipal, c.currencyCode)}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </details>

        {/* 3. Avalancha */}
        <details className="group rounded-2xl border border-slate-200 bg-slate-50/50 p-4 transition">
          <summary className="flex cursor-pointer items-center justify-between font-bold text-slate-900 list-none">
            <div className="flex items-center gap-2.5">
              <Flame className="h-5 w-5 text-red-500" />
              <span>Avalancha</span>
            </div>
            <ChevronDown className="h-5 w-5 text-slate-400 group-open:rotate-180 transition" />
          </summary>
          <div className="mt-3 pt-3 border-t border-slate-200/60 space-y-3 text-sm">
            <p className="text-xs text-slate-600">Prioriza la mayor tasa registrada comparable.</p>
            {Object.keys(avalanche.byCurrency).length === 0 ? (
              <p className="text-xs italic text-slate-500">No hay deudas activas para rankear en avalancha.</p>
            ) : (
              Object.entries(avalanche.byCurrency).map(([curr, strat]) => (
                <div key={curr} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wide text-red-700">Moneda: {curr}</span>
                    <span className="text-xs font-medium text-slate-500">
                      {avalancheComparisonModeLabel(strat.comparisonMode)}
                    </span>
                  </div>

                  {/* TCEA Cohort */}
                  {strat.tceaCandidates.length > 0 && (
                    <div className="space-y-1.5 pl-2 border-l-2 border-red-300">
                      <span className="text-xs font-bold text-slate-600 uppercase">Tasa TCEA</span>
                      {strat.tceaCandidates.map((c) => (
                        <button
                          key={c.debtId}
                          type="button"
                          onClick={() => onSelectDebtId(c.debtId)}
                          className="w-full flex items-center justify-between rounded-xl bg-white p-2.5 text-left shadow-sm border border-slate-100 hover:border-red-400 hover:bg-red-50/30 transition group/btn"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-xs font-black text-red-800">
                              #{c.rankWithinBasis}
                            </span>
                            <span className="font-bold text-slate-900 group-hover/btn:text-red-600 transition">
                              {c.debtName}
                            </span>
                          </div>
                          <span className="font-extrabold text-red-700">{c.ratePercent}% TCEA</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* TEA Cohort */}
                  {strat.teaCandidates.length > 0 && (
                    <div className="space-y-1.5 pl-2 border-l-2 border-orange-300">
                      <span className="text-xs font-bold text-slate-600 uppercase">Tasa TEA</span>
                      {strat.teaCandidates.map((c) => (
                        <button
                          key={c.debtId}
                          type="button"
                          onClick={() => onSelectDebtId(c.debtId)}
                          className="w-full flex items-center justify-between rounded-xl bg-white p-2.5 text-left shadow-sm border border-slate-100 hover:border-orange-400 hover:bg-orange-50/30 transition group/btn"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-100 text-xs font-black text-orange-800">
                              #{c.rankWithinBasis}
                            </span>
                            <span className="font-bold text-slate-900 group-hover/btn:text-orange-600 transition">
                              {c.debtName}
                            </span>
                          </div>
                          <span className="font-extrabold text-orange-700">{c.ratePercent}% TEA</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {strat.unknownRateDebtIds.length > 0 && (
                    <p className="text-xs text-slate-500">
                      {strat.unknownRateDebtIds.length} {strat.unknownRateDebtIds.length === 1 ? "deuda sin tasa no participa" : "deudas sin tasa no participan"} en este ranking.
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </details>

        {/* 4. Alivio próximos 30 días */}
        <details className="group rounded-2xl border border-slate-200 bg-slate-50/50 p-4 transition">
          <summary className="flex cursor-pointer items-center justify-between font-bold text-slate-900 list-none">
            <div className="flex items-center gap-2.5">
              <ShieldAlert className="h-5 w-5 text-emerald-600" />
              <span>Alivio próximos 30 días</span>
            </div>
            <ChevronDown className="h-5 w-5 text-slate-400 group-open:rotate-180 transition" />
          </summary>
          <div className="mt-3 pt-3 border-t border-slate-200/60 space-y-3 text-sm">
            <p className="text-xs text-slate-600">
              Prioriza las deudas con mayor obligación conocida en los próximos 30 días.
            </p>
            {Object.keys(cashFlowRelief30d.byCurrency).length === 0 ? (
              <p className="text-xs italic text-slate-500">No hay deudas activas para rankear en alivio 30d.</p>
            ) : (
              Object.entries(cashFlowRelief30d.byCurrency).map(([curr, strat]) => (
                <div key={curr} className="space-y-2">
                  <span className="text-xs font-extrabold uppercase tracking-wide text-emerald-700">Moneda: {curr}</span>
                  {strat.rankedCandidates.map((c) => (
                    <button
                      key={c.debtId}
                      type="button"
                      onClick={() => onSelectDebtId(c.debtId)}
                      className="w-full flex items-center justify-between rounded-xl bg-white p-3 text-left shadow-sm border border-slate-100 hover:border-emerald-400 hover:bg-emerald-50/30 transition group/btn"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-black text-emerald-800">
                          #{c.rankWithinCurrency}
                        </span>
                        <span className="font-bold text-slate-900 group-hover/btn:text-emerald-600 transition">
                          {c.debtName}
                        </span>
                      </div>
                      <span className="font-extrabold text-emerald-800">
                        {formatDebtMoney(c.relief30dKnownAmount, c.currencyCode)}
                      </span>
                    </button>
                  ))}

                  {strat.unrankedItems.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      <span className="text-xs font-semibold text-slate-400">Sin rankear a 30 días:</span>
                      {strat.unrankedItems.map((u) => (
                        <div key={u.debtId} className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-600">
                          <span className="font-bold">{u.debtName}</span>
                          <span>{cashFlowUnrankedReasonLabel(u.unrankedReason)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </details>
      </div>
    </section>
  );
}
