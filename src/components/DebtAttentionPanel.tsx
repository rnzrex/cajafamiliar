import { AlertCircle, CheckCircle2, ChevronRight, Clock } from "lucide-react";
import type { DebtNextAction } from "../utils/debtAttention.js";
import { getUrgentDebtAttentionItems } from "../utils/debtAttention.js";
import { formatDebtMoney } from "../utils/debtPresentation.js";

export interface DebtAttentionPanelProps {
  actions: DebtNextAction[];
  onSelectDebtId: (debtId: string) => void;
}

export function DebtAttentionPanel({ actions, onSelectDebtId }: DebtAttentionPanelProps) {
  const urgentItems = getUrgentDebtAttentionItems(actions);

  if (urgentItems.length === 0) {
    return (
      <div className="rounded-3xl border border-emerald-200/80 bg-emerald-50/50 p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-emerald-100 p-2.5 text-emerald-700 shrink-0">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-slate-900">No hay pagos urgentes en este momento</h3>
            <p className="text-xs font-medium text-slate-600 mt-0.5">
              Todas tus obligaciones registradas se encuentran al día o no tienen pagos pendientes inmediatos.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-3xl border border-amber-200/90 bg-amber-50/40 p-5 shadow-lg lg:p-6 space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="rounded-2xl bg-amber-100 p-2.5 text-amber-800 shrink-0">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-extrabold text-slate-900">Requiere tu atención</h3>
            <p className="text-xs text-slate-600">
              Pagos vencidos, cuotas próximas y datos que necesitan verificación
            </p>
          </div>
        </div>

        <span className="self-start sm:self-auto rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">
          {urgentItems.length} {urgentItems.length === 1 ? "pendiente" : "pendientes"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {urgentItems.map((item) => {
          const badgeStyle =
            item.badgeTone === "red"
              ? "bg-red-100 text-red-900 border-red-200"
              : item.badgeTone === "orange"
              ? "bg-orange-100 text-orange-900 border-orange-200"
              : "bg-amber-100 text-amber-900 border-amber-200";

          return (
            <button
              key={item.debtId}
              type="button"
              onClick={() => onSelectDebtId(item.debtId)}
              className="w-full min-h-[44px] text-left group flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm hover:border-amber-500 hover:shadow-md transition active:scale-[0.99]"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-black ${badgeStyle}`}>
                    {item.badgeLabel}
                  </span>
                  {item.dueDate && (
                    <span className="text-xs font-bold text-slate-400 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {item.dueDate}
                    </span>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-extrabold text-slate-900 group-hover:text-amber-700 transition">
                    {item.title}
                  </h4>
                  <p className="text-xs font-semibold text-slate-600">{item.debtName} — <span className="text-slate-400 font-normal">{item.creditorName}</span></p>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">{item.detail}</p>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between w-full">
                <div>
                  {item.resolvedAmount != null ? (
                    <p className="text-base font-black text-slate-900">
                      {formatDebtMoney(item.resolvedAmount, item.currencyCode)}
                    </p>
                  ) : item.isAmountUnknown ? (
                    <p className="text-xs font-bold text-amber-700 italic">
                      {item.reason || "Monto por confirmar"}
                    </p>
                  ) : (
                    <p className="text-xs font-medium text-slate-400">—</p>
                  )}
                </div>

                <span className="text-xs font-bold text-amber-700 flex items-center gap-0.5 group-hover:translate-x-1 transition">
                  {item.actionLabel}
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
