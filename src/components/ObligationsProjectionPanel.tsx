import { useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Info,
} from "lucide-react";
import type { ObligationProjectionResult } from "../utils/obligationProjection.js";
import { formatLocalDate } from "../utils/date.js";

interface ObligationsProjectionPanelProps {
  obligationProjection: ObligationProjectionResult;
  onOpenPayment?: (paymentId: string) => void;
  onOpenDebt?: (debtId: string) => void;
}

export function ObligationsProjectionPanel({
  obligationProjection,
  onOpenPayment,
  onOpenDebt,
}: ObligationsProjectionPanelProps) {
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  const {
    horizonMonths,
    monthSummaries,
    overduePriorItems,
    overduePriorSummary,
    unscheduledRecurringCount,
    activeDebtsWithoutPlanningCount,
  } = obligationProjection;

  const toggleExpand = (mKey: string) => {
    setExpandedMonth((prev) => (prev === mKey ? null : mKey));
  };

  return (
    <section className="space-y-6 rounded-3xl bg-white p-6 shadow-xl lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <CalendarClock className="h-6 w-6 text-blue-600 shrink-0" />
            <h3 className="text-xl font-extrabold text-slate-900">Próximas obligaciones</h3>
          </div>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            Salidas planificadas. No incluye ingresos futuros ni predice tu saldo.
          </p>
        </div>
      </div>

      {/* Bloque Vencido de Meses Anteriores */}
      {overduePriorItems.length > 0 && overduePriorSummary && (
        <div className="rounded-2xl border border-red-200 bg-red-50/70 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-red-800 font-extrabold text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Vencido de meses anteriores ({overduePriorItems.length})</span>
            </div>
            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-800">
              Urgente
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Object.values(overduePriorSummary).map((c) => (
              <div key={c.currencyCode} className="rounded-xl bg-white p-3.5 shadow-sm border border-red-100 space-y-1.5">
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800 inline-block">
                  {c.currencyCode}
                </span>

                <div className="text-xs space-y-1">
                  {c.knownAmount > 0 && (
                    <p className="font-semibold text-slate-700">
                      Conocido: <span className="font-extrabold text-red-700">{c.currencyCode} {c.knownAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </p>
                  )}
                  {c.estimatedAmount > 0 && (
                    <p className="font-semibold text-slate-700">
                      Estimado variable: <span className="font-extrabold text-amber-700">~{c.currencyCode} {c.estimatedAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </p>
                  )}
                  {c.unknownAmountCount > 0 && (
                    <p className="font-bold text-amber-800">
                      + {c.unknownAmountCount} {c.unknownAmountCount === 1 ? "monto por confirmar" : "montos por confirmar"}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grid de 3 Meses de Horizonte */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {horizonMonths.map((mKey) => {
          const summary = monthSummaries[mKey];
          if (!summary) return null;

          const isExpanded = expandedMonth === mKey;
          const monthItems = obligationProjection.items.filter((i) => i.monthKey === mKey);
          const hasCurrencies = Object.keys(summary.byCurrency).length > 0;

          return (
            <div
              key={mKey}
              className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-slate-50/60 p-5 space-y-4 hover:border-slate-300 transition"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-base font-black text-slate-900">{summary.label}</h4>
                  <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                    {summary.totalObligations} {summary.totalObligations === 1 ? "obligación" : "obligaciones"}
                  </span>
                </div>

                <p className="text-xs text-slate-500 font-medium">
                  {summary.recurringCount > 0 && `${summary.recurringCount} ${summary.recurringCount === 1 ? "pago" : "pagos"}`}
                  {summary.recurringCount > 0 && summary.debtCount > 0 && " · "}
                  {summary.debtCount > 0 && `${summary.debtCount} ${summary.debtCount === 1 ? "cuota de deuda" : "cuotas de deuda"}`}
                  {summary.totalObligations === 0 && "Sin obligaciones programadas"}
                </p>

                {hasCurrencies ? (
                  <div className="space-y-2.5 pt-1">
                    {Object.values(summary.byCurrency).map((c) => (
                      <div key={c.currencyCode} className="rounded-xl bg-white p-3 shadow-sm border border-slate-200/80 space-y-1 text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-extrabold text-blue-700">
                            {c.currencyCode}
                          </span>
                        </div>

                        {c.knownAmount > 0 && (
                          <div className="flex justify-between">
                            <span className="text-slate-500 font-medium">Conocido:</span>
                            <span className="font-extrabold text-slate-900">
                              {c.currencyCode} {c.knownAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        )}

                        {c.estimatedAmount > 0 && (
                          <div className="flex justify-between">
                            <span className="text-slate-500 font-medium">Estimado variable:</span>
                            <span className="font-extrabold text-amber-700">
                              ~{c.currencyCode} {c.estimatedAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        )}

                        {c.unknownAmountCount > 0 && (
                          <p className="text-amber-800 font-bold pt-0.5">
                            + {c.unknownAmountCount} {c.unknownAmountCount === 1 ? "monto por confirmar" : "montos por confirmar"}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">No hay montos registrados en este mes.</p>
                )}
              </div>

              {/* Botón Ver Detalle del Mes */}
              {monthItems.length > 0 && (
                <div className="pt-2 border-t border-slate-200/60">
                  <button
                    type="button"
                    onClick={() => toggleExpand(mKey)}
                    className="flex w-full items-center justify-between text-xs font-bold text-blue-700 hover:text-blue-900 transition py-1"
                  >
                    <span>{isExpanded ? "Ocultar detalle" : "Ver detalle del mes"}</span>
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>

                  {isExpanded && (
                    <div className="mt-3 space-y-2 pt-2 border-t border-slate-200/80 max-h-60 overflow-y-auto">
                      {monthItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            if (item.source === "recurring" && item.recurringPaymentId && onOpenPayment) {
                              onOpenPayment(item.recurringPaymentId);
                            } else if (item.source === "debt" && item.debtId && onOpenDebt) {
                              onOpenDebt(item.debtId);
                            }
                          }}
                          className="w-full text-left rounded-lg bg-white p-2.5 shadow-2xs border border-slate-200 hover:border-blue-400 transition"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-bold text-xs text-slate-900 truncate">{item.label}</span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${item.source === "recurring" ? "bg-purple-100 text-purple-800" : "bg-blue-100 text-blue-800"}`}>
                              {item.source === "recurring" ? "Pago" : "Deuda"}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">{item.detail}</p>
                          <div className="flex items-center justify-between mt-1 text-[11px]">
                            <span className="text-slate-400 font-medium">
                              {item.dueDate ? formatLocalDate(item.dueDate) : "Sin fecha"}
                            </span>
                            <span className="font-extrabold text-slate-800">
                              {item.amountKind === "unknown"
                                ? "Por confirmar"
                                : `${item.amountKind === "estimated" ? "~" : ""}${item.currencyCode} ${item.amount?.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Avisos de Datos No Proyectables */}
      {(unscheduledRecurringCount > 0 || activeDebtsWithoutPlanningCount > 0) && (
        <div className="rounded-2xl bg-amber-50 p-4 border border-amber-200 text-xs space-y-1.5 font-medium text-amber-900">
          <div className="flex items-center gap-2 font-bold text-amber-800">
            <Info className="h-4 w-4 shrink-0" />
            <span>Aviso de datos no proyectables</span>
          </div>
          {unscheduledRecurringCount > 0 && (
            <p>
              • {unscheduledRecurringCount} {unscheduledRecurringCount === 1 ? "pago recurrente sin fecha no está incluido" : "pagos recurrentes sin fecha no están incluidos"}.
            </p>
          )}
          {activeDebtsWithoutPlanningCount > 0 && (
            <p>
              • {activeDebtsWithoutPlanningCount} {activeDebtsWithoutPlanningCount === 1 ? "deuda activa sin cronograma no está incluida" : "deudas activas sin cronograma no están incluidas"}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
