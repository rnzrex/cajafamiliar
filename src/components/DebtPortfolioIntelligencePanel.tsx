import { AlertCircle, Landmark, ShieldCheck, Clock, FileQuestion, Percent, Calendar } from "lucide-react";
import type { DebtPortfolioIntelligence } from "../utils/debtIntelligence";
import { formatDebtMoney } from "../utils/debtPresentation";

export interface DebtPortfolioIntelligencePanelProps {
  portfolio: DebtPortfolioIntelligence;
}

export function DebtPortfolioIntelligencePanel({ portfolio }: DebtPortfolioIntelligencePanelProps) {
  const currencyEntries = Object.values(portfolio.byCurrency);
  const hasMissingDataNotice =
    portfolio.unratedDebtCount > 0 ||
    portfolio.debtsWithoutCurrentScheduleCount > 0 ||
    portfolio.debtsWithUnknownInstallmentsCount > 0;

  return (
    <section className="space-y-4 rounded-3xl bg-white p-6 shadow-xl lg:p-8">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-indigo-50 p-2.5 text-indigo-600">
            <Landmark className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-xl font-extrabold text-slate-900">Panorama de deudas</h3>
            <p className="text-xs text-slate-500">Resumen derivado de saldos, cronogramas y pagos registrados.</p>
          </div>
        </div>
        {hasMissingDataNotice && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 border border-amber-200">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
            <span>Algunas comparaciones son parciales porque faltan datos.</span>
          </div>
        )}
      </div>

      {/* Grid of Key Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Active Debts */}
        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Deudas activas</p>
          <p className="mt-1 text-2xl font-extrabold text-slate-900">{portfolio.totalActiveDebts}</p>
        </div>

        {/* Principal Activo Por Moneda */}
        <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Principal activo por moneda</p>
          <div className="mt-1 space-y-0.5">
            {currencyEntries.length === 0 ? (
              <p className="text-sm font-bold text-slate-500">Sin deudas activas</p>
            ) : (
              currencyEntries.map((entry) => (
                <p key={entry.currencyCode} className="text-lg font-extrabold text-blue-900">
                  {formatDebtMoney(entry.totalCurrentPrincipal, entry.currencyCode)}
                </p>
              ))
            )}
          </div>
        </div>

        {/* Obligaciones conocidas próximos 30 días */}
        <div className="rounded-2xl border border-purple-100 bg-purple-50/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-purple-700">Próximos 30 días (Conocido)</p>
          <div className="mt-1 space-y-0.5">
            {currencyEntries.length === 0 ? (
              <p className="text-sm font-bold text-slate-500">0.00</p>
            ) : (
              currencyEntries.map((entry) => (
                <p key={entry.currencyCode} className="text-lg font-extrabold text-purple-900">
                  {formatDebtMoney(entry.next30KnownAmount, entry.currencyCode)}
                </p>
              ))
            )}
          </div>
        </div>

        {/* Garantías activas */}
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Garantías activas</p>
          <p className="mt-1 text-2xl font-extrabold text-emerald-900">{portfolio.debtsWithActiveCollateralCount}</p>
        </div>
      </div>

      {/* Observations / Pendings Badges */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
        {portfolio.unratedDebtCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
            <Percent className="h-3.5 w-3.5 text-slate-500" />
            {portfolio.unratedDebtCount} {portfolio.unratedDebtCount === 1 ? "deuda sin tasa" : "deudas sin tasa"}
          </span>
        )}
        {portfolio.debtsWithoutCurrentScheduleCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
            <Calendar className="h-3.5 w-3.5 text-slate-500" />
            {portfolio.debtsWithoutCurrentScheduleCount} {portfolio.debtsWithoutCurrentScheduleCount === 1 ? "deuda sin cronograma" : "deudas sin cronograma"}
          </span>
        )}
        {portfolio.debtsWithUnknownInstallmentsCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
            <FileQuestion className="h-3.5 w-3.5 text-slate-500" />
            {portfolio.debtsWithUnknownInstallmentsCount} {portfolio.debtsWithUnknownInstallmentsCount === 1 ? "deuda con cuotas por confirmar" : "deudas con cuotas por confirmar"}
          </span>
        )}
        {portfolio.debtsWithActiveCollateralCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            {portfolio.debtsWithActiveCollateralCount} {portfolio.debtsWithActiveCollateralCount === 1 ? "deuda respaldada por garantía" : "deudas respaldadas por garantía"}
          </span>
        )}
      </div>
    </section>
  );
}
