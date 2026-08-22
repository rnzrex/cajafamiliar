import { useState } from "react";
import {
  AlertTriangle,
  Calculator,
  Calendar,
  CheckCircle2,
  Clock,
  HelpCircle,
  Info,
  Percent,
  ShieldCheck,
  TrendingDown,
} from "lucide-react";
import type { DebtIntelligenceItem } from "../utils/debtIntelligence";
import { simulateDebtPrincipalPrepayment } from "../utils/debtSimulation";
import {
  debtLimitationLabel,
  dueStatusLabel,
  formatDebtMoney,
  simulationStatusCopy,
} from "../utils/debtPresentation";

export interface DebtAnalysisPanelProps {
  intelligence: DebtIntelligenceItem;
}

export function DebtAnalysisPanel({ intelligence }: DebtAnalysisPanelProps) {
  const [simAmountInput, setSimAmountInput] = useState<string>("");

  const parsedSimAmount = parseFloat(simAmountInput);
  const isInputProvided = simAmountInput.trim() !== "" && !Number.isNaN(parsedSimAmount);

  const simulation = isInputProvided
    ? simulateDebtPrincipalPrepayment(intelligence, parsedSimAmount)
    : null;

  const nextStatusInfo = dueStatusLabel(intelligence.nextInstallmentDueStatus);

  return (
    <div className="space-y-6">
      {/* 1. Resumen de Saldos & Economía General */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h4 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-blue-600" />
            Análisis de Saldo e Inteligencia
          </h4>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
            {intelligence.currencyCode}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Saldo principal actual</p>
            <p className="mt-1 text-xl font-black text-slate-900">
              {formatDebtMoney(intelligence.currentPrincipal, intelligence.currencyCode)}
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Principal original</p>
            <p className="mt-1 text-xl font-bold text-slate-700">
              {intelligence.originalPrincipal != null
                ? formatDebtMoney(intelligence.originalPrincipal, intelligence.currencyCode)
                : "Sin registro"}
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Reducción por fondos</p>
            <p className="mt-1 text-xl font-bold text-emerald-700">
              {formatDebtMoney(intelligence.recordedFundPrincipalReduction, intelligence.currencyCode)}
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Ajustes / Refinanciación</p>
            <p className="mt-1 text-xl font-bold text-indigo-700">
              {formatDebtMoney(intelligence.nonFundPrincipalDelta, intelligence.currencyCode)}
            </p>
          </div>
        </div>

        {intelligence.balanceReductionPercentFromOriginal != null && (
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 bg-slate-100 px-3 py-2 rounded-xl">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>
              Reducción del saldo respecto al principal original:{" "}
              <strong className="text-slate-900">{intelligence.balanceReductionPercentFromOriginal.toFixed(1)}%</strong>
            </span>
          </div>
        )}
      </section>

      {/* 2. Histórico Económico Registrado */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <h4 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide">
          Histórico Económico Registrado
        </h4>
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">
          <div className="rounded-xl border border-slate-100 p-2.5">
            <p className="text-slate-400 font-bold">Salida de caja</p>
            <p className="font-bold text-slate-900 mt-1">
              {formatDebtMoney(intelligence.historicalEconomics.cashOutflow, intelligence.currencyCode)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 p-2.5">
            <p className="text-slate-400 font-bold">Reducción principal</p>
            <p className="font-bold text-emerald-700 mt-1">
              {formatDebtMoney(intelligence.historicalEconomics.principalReduction, intelligence.currencyCode)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 p-2.5">
            <p className="text-slate-400 font-bold">Costo económico</p>
            <p className="font-bold text-amber-700 mt-1">
              {formatDebtMoney(intelligence.historicalEconomics.economicExpense, intelligence.currencyCode)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 p-2.5">
            <p className="text-slate-400 font-bold">Costos detallados</p>
            <p className="font-bold text-indigo-700 mt-1">
              {formatDebtMoney(intelligence.historicalEconomics.knownDetailedCosts, intelligence.currencyCode)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 p-2.5">
            <p className="text-slate-400 font-bold">Costo no clasificado</p>
            <p className="font-bold text-slate-700 mt-1">
              {formatDebtMoney(intelligence.historicalEconomics.unclassifiedDebtCost, intelligence.currencyCode)}
            </p>
          </div>
        </div>

        {intelligence.historicalEconomics.inconsistentEventCount > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800 border border-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span>Hay registros cuyo desglose económico necesita revisión.</span>
          </div>
        )}
      </section>

      {/* 3. Próxima Obligación & Tasas & Cronograma */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <h4 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide flex items-center gap-2">
            <Clock className="h-4 w-4 text-purple-600" />
            Próximas Obligaciones
          </h4>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center py-1 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Cuotas en mora:</span>
              <span className={`font-bold ${intelligence.overdueInstallmentCount > 0 ? "text-red-600" : "text-slate-700"}`}>
                {intelligence.overdueInstallmentCount}
              </span>
            </div>
            {intelligence.nextInstallmentNumber != null ? (
              <>
                <div className="flex justify-between items-center py-1 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Próxima cuota N°:</span>
                  <span className="font-bold text-slate-900">{intelligence.nextInstallmentNumber}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Vencimiento próxima:</span>
                  <span className="font-bold text-slate-900">{intelligence.nextInstallmentDueDate}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Estado próxima:</span>
                  <span className="font-bold text-slate-900">{nextStatusInfo.label}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Monto próxima cuota:</span>
                  <span className="font-bold text-slate-900">
                    {intelligence.nextInstallmentAmountKnown && intelligence.nextInstallmentRemainingAmount != null
                      ? formatDebtMoney(intelligence.nextInstallmentRemainingAmount, intelligence.currencyCode)
                      : "Monto por confirmar"}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-slate-500 italic py-1">Sin próxima cuota programada.</p>
            )}
            <div className="flex justify-between items-center py-1 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Conocido a 30 días:</span>
              <span className="font-bold text-purple-900">
                {formatDebtMoney(intelligence.next30KnownAmount, intelligence.currencyCode)}
              </span>
            </div>
            {intelligence.next30UnknownAmountCount > 0 && (
              <div className="flex justify-between items-center py-1">
                <span className="text-slate-500 font-medium">Montos por confirmar (30d):</span>
                <span className="font-bold text-amber-700">{intelligence.next30UnknownAmountCount}</span>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <h4 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide flex items-center gap-2">
            <Percent className="h-4 w-4 text-blue-600" />
            Tasas, Cronograma y Garantías
          </h4>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center py-1 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Tasa registrada:</span>
              <span className="font-bold text-slate-900">
                {intelligence.ratePercent != null
                  ? `${intelligence.ratePercent}% ${intelligence.rateBasis.toUpperCase()}`
                  : "Sin tasa registrada"}
              </span>
            </div>

            <div className="py-1 border-b border-slate-100 space-y-1">
              <span className="text-slate-500 font-medium block">Última fecha del cronograma:</span>
              {intelligence.currentScheduleLastDueDate != null ? (
                <p className="text-slate-800 font-semibold leading-tight">
                  Según el cronograma actual, la última cuota registrada vence el{" "}
                  <strong className="text-slate-900">{intelligence.currentScheduleLastDueDate}</strong>.
                </p>
              ) : (
                <p className="text-slate-500 italic">No hay fecha registrada.</p>
              )}
            </div>

            <div className="py-1 space-y-1">
              <span className="text-slate-500 font-medium block">Garantía:</span>
              {intelligence.hasActiveCollateral ? (
                <div className="flex items-center gap-2 text-emerald-800 font-bold">
                  <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>
                    Garantía activa ({intelligence.activeCollateralCount})
                    {intelligence.nearestRedemptionDeadline && ` · Vence: ${intelligence.nearestRedemptionDeadline}`}
                  </span>
                </div>
              ) : (
                <p className="text-slate-500 italic">Sin garantía activa.</p>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* 4. Información pendiente (Limitations) */}
      {intelligence.readiness.limitations.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-2">
          <h4 className="text-xs font-extrabold uppercase tracking-wide text-amber-900 flex items-center gap-1.5">
            <Info className="h-4 w-4 text-amber-600" />
            Información pendiente
          </h4>
          <ul className="list-disc list-inside text-xs text-amber-800 space-y-1 font-medium">
            {intelligence.readiness.limitations.map((lim) => (
              <li key={lim}>{debtLimitationLabel(lim)}</li>
            ))}
          </ul>
        </section>
      )}

      {/* 5. Subsección: Simulador de Abono al Capital */}
      <section className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-blue-100 p-2 text-blue-700">
            <Calculator className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-base font-extrabold text-slate-900">Simular abono al capital</h4>
            <p className="text-xs text-slate-500">
              Calcula el efecto matemático de aplicar un monto directamente al principal.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="sim-amount-input" className="block text-xs font-bold text-slate-700">
            Monto que se aplicaría al capital
          </label>
          <div className="relative max-w-xs">
            <input
              id="sim-amount-input"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={simAmountInput}
              onChange={(e) => setSimAmountInput(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-bold text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <p className="text-xs text-slate-500 flex items-center gap-1">
            <HelpCircle className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            Este monto representa capital aplicado, no necesariamente el desembolso total.
          </p>
        </div>

        {/* Simulation Output Card */}
        {simulation && (
          <div className="rounded-xl border border-blue-200 bg-white p-4 space-y-3 text-xs">
            <p className="font-bold text-slate-900">{simulationStatusCopy(simulation.status)}</p>

            {simulation.status === "valid_prepayment" && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-slate-700 font-medium">
                  <div>
                    Saldo actual: <strong className="text-slate-900">{formatDebtMoney(simulation.currentPrincipal, simulation.currencyCode)}</strong>
                  </div>
                  <div>
                    Saldo principal simulado:{" "}
                    <strong className="text-blue-700">
                      {formatDebtMoney(simulation.simulatedPrincipal, simulation.currencyCode)}
                    </strong>
                  </div>
                  <div>
                    Reducción: <strong className="text-emerald-700">{simulation.principalReductionPercentOfCurrent?.toFixed(1)}%</strong>
                  </div>
                </div>
                <div className="rounded-lg bg-amber-50 p-2 text-amber-800 border border-amber-100 flex items-start gap-1.5">
                  <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>No calcula ahorro exacto de intereses, nueva cuota, nueva fecha ni desembolso total.</span>
                </div>
              </div>
            )}

            {simulation.status === "payoff_candidate" && (
              <div className="space-y-2">
                <div className="rounded-lg bg-emerald-50 p-2.5 text-emerald-900 border border-emerald-200">
                  <p className="font-bold">
                    El principal quedaría matemáticamente en 0 si este monto se aplicara íntegramente al capital.
                  </p>
                </div>
                <div className="rounded-lg bg-amber-50 p-2 text-amber-800 border border-amber-100 flex items-start gap-1.5">
                  <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    El monto real de liquidación puede ser distinto por intereses, seguros, comisiones u otros cargos.
                  </span>
                </div>
              </div>
            )}

            {simulation.status === "exceeds_current_principal" && (
              <div className="rounded-lg bg-red-50 p-2.5 text-red-800 border border-red-200 font-bold">
                El monto aplicado al capital supera el principal actual.
              </div>
            )}

            {simulation.status === "unsupported_debt_kind" && (
              <div className="rounded-lg bg-slate-100 p-2.5 text-slate-700 font-medium">
                Las tarjetas de crédito tendrán un simulador específico en una fase posterior.
              </div>
            )}

            {["invalid_amount", "no_outstanding_principal", "not_active", "archived"].includes(simulation.status) && (
              <div className="rounded-lg bg-slate-100 p-2.5 text-slate-700 font-medium">
                {simulationStatusCopy(simulation.status)}
              </div>
            )}

            {simAmountInput !== "" && (
              <div className="pt-2 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSimAmountInput("")}
                  className="text-xs font-bold text-slate-500 hover:text-slate-800"
                >
                  Limpiar simulación
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
