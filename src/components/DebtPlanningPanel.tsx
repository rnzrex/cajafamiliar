import { useState } from "react";
import {
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  HelpCircle,
} from "lucide-react";
import type {
  DebtInstallmentPlanningItem,
  DebtPlanningAlertSummary,
} from "../utils/debtPlanning.js";
import {
  formatMonthKeyLabel,
  getNextMonthKey,
  getPrevMonthKey,
  groupDebtPlanningItemsForAgenda,
  summarizeDebtPlanningMonth,
} from "../utils/debtPlanning.js";
import { formatLocalDate, localMonthString } from "../utils/date.js";

interface DebtPlanningPanelProps {
  debtPlanningItems: DebtInstallmentPlanningItem[];
  debtPlanningAlertSummary: DebtPlanningAlertSummary;
  pendingBankScheduleDebtNames?: string[];
  onSelectDebtId: (debtId: string) => void;
}

export function DebtPlanningPanel({
  debtPlanningItems,
  debtPlanningAlertSummary,
  pendingBankScheduleDebtNames = [],
  onSelectDebtId,
}: DebtPlanningPanelProps) {
  const [selectedMonth, setSelectedMonth] = useState<string>(localMonthString());
  const currentMonthKey = localMonthString();

  const monthSummary = summarizeDebtPlanningMonth(debtPlanningItems, selectedMonth);
  const monthItems = debtPlanningItems.filter((item) => item.dueDate.startsWith(selectedMonth));
  const agendaGroups = groupDebtPlanningItemsForAgenda(monthItems);

  const isCurrentMonth = selectedMonth === currentMonthKey;

  return (
    <section className="space-y-6 rounded-3xl bg-white p-6 shadow-xl lg:p-8">
      {/* Top Banner: Resumen de Alertas Compacto */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Clock className="h-5 w-5 text-blue-600 shrink-0" />
            <h3 className="text-base font-bold text-slate-900">Estado de obligaciones</h3>
          </div>
          {debtPlanningAlertSummary.total === 0 ? (
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              <span>No tienes cuotas que requieran atención inmediata.</span>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 text-xs font-bold">
              {debtPlanningAlertSummary.overdue > 0 && (
                <span className="rounded-full bg-red-100 px-3 py-1 text-red-800">
                  {debtPlanningAlertSummary.overdue} {debtPlanningAlertSummary.overdue === 1 ? "vencida" : "vencidas"}
                </span>
              )}
              {debtPlanningAlertSummary.today > 0 && (
                <span className="rounded-full bg-orange-100 px-3 py-1 text-orange-800">
                  {debtPlanningAlertSummary.today} {debtPlanningAlertSummary.today === 1 ? "vence hoy" : "vencen hoy"}
                </span>
              )}
              {debtPlanningAlertSummary.tomorrow > 0 && (
                <span className="rounded-full bg-yellow-100 px-3 py-1 text-yellow-800">
                  {debtPlanningAlertSummary.tomorrow} {debtPlanningAlertSummary.tomorrow === 1 ? "vence mañana" : "vencen mañana"}
                </span>
              )}
              {debtPlanningAlertSummary.upcoming > 0 && (
                <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-800">
                  {debtPlanningAlertSummary.upcoming} en 7 días
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {pendingBankScheduleDebtNames.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-black">Cronograma posterior pendiente</p>
          <p className="mt-1">La Agenda no muestra cuotas nuevas ni proyecta un cronograma que el banco todavía no confirmó.</p>
          <p className="mt-2 font-semibold">{pendingBankScheduleDebtNames.join(" · ")}</p>
        </div>
      )}

      {/* Header Nivel 2: Navegación de Mes */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-xl font-extrabold text-slate-900">Planificación y Agenda</h3>
          <p className="text-xs font-medium text-slate-500">Cronograma de cuotas por mes</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedMonth(getPrevMonthKey(selectedMonth))}
            aria-label="Mes anterior"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <span className="min-w-[140px] text-center text-base font-black text-slate-900">
            {formatMonthKeyLabel(selectedMonth)}
          </span>

          <button
            type="button"
            onClick={() => setSelectedMonth(getNextMonthKey(selectedMonth))}
            aria-label="Mes siguiente"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          {!isCurrentMonth && (
            <button
              type="button"
              onClick={() => setSelectedMonth(currentMonthKey)}
              className="ml-2 min-h-[44px] rounded-xl bg-blue-50 px-3.5 text-xs font-bold text-blue-700 hover:bg-blue-100 transition"
            >
              Este mes
            </button>
          )}
        </div>
      </div>

      {/* Tarjeta de Resumen Mensual */}
      <div className="rounded-3xl border border-slate-200 bg-slate-50/60 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Resumen de carga — {formatMonthKeyLabel(selectedMonth)}
          </p>

          <span className="rounded-full bg-slate-200/80 px-2.5 py-0.5 text-xs font-bold text-slate-700">
            {monthSummary.totalInstallments} {monthSummary.totalInstallments === 1 ? "cuota" : "cuotas"}
          </span>
        </div>

        {monthSummary.hasMultipleCurrencies ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 italic font-semibold">
              Obligaciones en múltiples monedas (desglosadas por moneda):
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {Object.values(monthSummary.byCurrency).map((c) => (
                <div key={c.currencyCode} className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-extrabold text-blue-800">
                      Moneda: {c.currencyCode}
                    </span>
                    <span className="text-xs text-slate-500 font-medium">
                      {c.totalInstallments} {c.totalInstallments === 1 ? "cuota" : "cuotas"}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs pt-1">
                    <div>
                      <p className="text-slate-400 font-medium">Pendiente</p>
                      <p className="font-extrabold text-slate-900">
                        {c.currencyCode} {c.pendingKnownAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400 font-medium">Cubierto</p>
                      <p className="font-extrabold text-emerald-700">
                        {c.currencyCode} {c.coveredKnownAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400 font-medium">Vencido</p>
                      <p className={`font-extrabold ${c.overdueKnownAmount > 0 ? "text-red-700" : "text-slate-700"}`}>
                        {c.currencyCode} {c.overdueKnownAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>

                  {c.unknownAmountInstallments > 0 && (
                    <p className="text-xs text-amber-700 font-bold pt-1">
                      + {c.unknownAmountInstallments} {c.unknownAmountInstallments === 1 ? "cuota sin monto definido" : "cuotas sin monto definido"}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {monthSummary.unknownAmountInstallments > 0 && (
              <div className="rounded-2xl bg-amber-50 p-3 text-xs font-bold text-amber-800 flex items-center gap-2">
                <HelpCircle className="h-4 w-4 shrink-0" />
                <span>
                  Total global: {monthSummary.unknownAmountInstallments} {monthSummary.unknownAmountInstallments === 1 ? "cuota con monto por confirmar" : "cuotas con monto por confirmar"}.
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200/80">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Pendiente conocido</p>
              <p className="mt-1 text-2xl font-black text-slate-900">
                {monthSummary.currencyCode ?? "PEN"} {(monthSummary.pendingKnownAmount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>

            <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200/80">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Ya cubierto</p>
              <p className="mt-1 text-2xl font-black text-emerald-700">
                {monthSummary.currencyCode ?? "PEN"} {(monthSummary.coveredKnownAmount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>

            <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200/80">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Vencido en el mes</p>
              <p className={`mt-1 text-2xl font-black ${(monthSummary.overdueKnownAmount ?? 0) > 0 ? "text-red-700" : "text-slate-800"}`}>
                {monthSummary.currencyCode ?? "PEN"} {(monthSummary.overdueKnownAmount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>

            <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200/80">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Montos por confirmar</p>
              {monthSummary.unknownAmountInstallments > 0 ? (
                <div>
                  <p className="mt-1 text-2xl font-black text-amber-700">
                    {monthSummary.unknownAmountInstallments}
                  </p>
                  <p className="text-xs text-amber-800 font-semibold mt-0.5">
                    {monthSummary.unknownAmountInstallments === 1 ? "cuota sin monto definido" : "cuotas sin monto definido"}
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-sm font-bold text-slate-500">
                  Todas con monto definido
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Lista de Agenda del Mes */}
      <div className="space-y-4">
        {agendaGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 p-8 text-center bg-slate-50/50">
            <Calendar className="h-10 w-10 text-slate-300 mb-2" />
            <p className="text-sm font-bold text-slate-700">No hay cuotas programadas para este mes.</p>
            <p className="text-xs text-slate-500 mt-1">Navega a otros meses usando los botones superiores.</p>
          </div>
        ) : (
          agendaGroups.map((group) => (
            <div key={group.key} className="space-y-3">
              <div className="flex items-center gap-2 pt-2">
                <span className={`h-2.5 w-2.5 rounded-full ${toneDotClass(group.tone)}`} />
                <h4 className="text-sm font-extrabold tracking-wide uppercase text-slate-600">
                  {group.label} ({group.items.length})
                </h4>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {group.items.map((item) => (
                  <button
                    key={item.installmentId}
                    type="button"
                    onClick={() => onSelectDebtId(item.debtId)}
                    className="w-full text-left group relative flex min-h-[52px] flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-500 hover:shadow-md transition cursor-pointer"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="font-extrabold text-slate-900 group-hover:text-blue-600 transition">
                          {item.debtName}
                        </span>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold shrink-0 ${toneBadgeClass(item.dueTone)}`}>
                          {item.dueLabel}
                        </span>
                      </div>

                      <p className="text-xs text-slate-500">
                        {item.creditorName && `Acreedor: ${item.creditorName} · `}
                        Cuota #{item.installmentNumber} · Vence: {formatLocalDate(item.dueDate)}
                      </p>
                    </div>

                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs w-full">
                      <div>
                        {item.amountKnown ? (
                          <div className="space-y-0.5">
                            <p className="font-semibold text-slate-700">
                              Esperado: <span className="font-bold text-slate-900">{item.currencyCode} {item.expectedAmount?.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                            </p>
                            <p className="text-slate-500">
                              Aplicado: {item.currencyCode} {item.allocatedAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                              {item.remainingAmount !== null && (
                                <span className="ml-2 font-bold text-blue-700">
                                  · Pendiente: {item.currencyCode} {item.remainingAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                                </span>
                              )}
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 font-bold text-amber-700">
                              <HelpCircle className="h-3.5 w-3.5" /> Monto por confirmar
                            </span>
                            <p className="text-slate-500">
                              Aplicado: {item.currencyCode} {item.allocatedAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                        )}
                      </div>

                      <span className="font-bold text-blue-600 group-hover:translate-x-0.5 transition shrink-0 ml-2">
                        Ver &rarr;
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function toneBadgeClass(tone: "green" | "red" | "orange" | "yellow" | "blue") {
  if (tone === "red") return "bg-red-100 text-red-800";
  if (tone === "orange") return "bg-orange-100 text-orange-800";
  if (tone === "yellow") return "bg-yellow-100 text-yellow-800";
  if (tone === "green") return "bg-emerald-100 text-emerald-800";
  return "bg-blue-100 text-blue-800";
}

function toneDotClass(tone: "green" | "red" | "orange" | "yellow" | "blue") {
  if (tone === "red") return "bg-red-500";
  if (tone === "orange") return "bg-orange-500";
  if (tone === "yellow") return "bg-yellow-500";
  if (tone === "green") return "bg-emerald-500";
  return "bg-blue-500";
}
