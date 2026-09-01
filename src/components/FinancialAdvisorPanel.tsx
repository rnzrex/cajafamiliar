import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Landmark, MessageCircle, ShieldCheck, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { formatMoneyByCurrency } from "../utils/calculations.js";
import {
  simulateFinancialAdvisorExtraCash,
  type AdvisorAmountSummary,
  type AdvisorDebtComparison,
  type AdvisorExtraCashScenario,
  type AdvisorObligationWindow,
  type FinancialAdvisorResult,
} from "../utils/financialAdvisor.js";
import { answerFinancialAdvisorQuestion, parseFinancialAdvisorQuestion, QUICK_SUGGESTIONS } from "../utils/financialAdvisorQuestions.js";

interface FinancialAdvisorPanelProps {
  result: FinancialAdvisorResult;
  onNavigate: (view: string) => void;
}

const QUALITY_LABELS = {
  complete: "ANÁLISIS COMPLETO",
  partial: "ANÁLISIS PARCIAL",
  insufficient: "ANÁLISIS INSUFICIENTE",
} as const;

function amountLabel(summary: AdvisorAmountSummary): string {
  const parts = [`Conocido: ${formatMoneyByCurrency(summary.knownAmount, summary.currencyCode)}`];
  if (summary.estimatedAmount > 0) parts.push(`Estimado: ~${formatMoneyByCurrency(summary.estimatedAmount, summary.currencyCode)}`);
  if (summary.unknownAmountCount > 0) parts.push(`${summary.unknownAmountCount} monto${summary.unknownAmountCount === 1 ? "" : "s"} por confirmar`);
  return parts.join(" · ");
}

function WindowCard({ window }: { window: AdvisorObligationWindow }) {
  return (
    <article data-testid={`advisor-window-${window.key}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock className="h-5 w-5 text-blue-600" />
        <h3 className="font-bold text-slate-900">{window.label}</h3>
      </div>
      {Object.values(window.byCurrency).length === 0 ? (
        <p className="text-sm text-slate-500">Sin obligaciones proyectadas.</p>
      ) : (
        <div className="space-y-2">
          {Object.values(window.byCurrency).map((summary) => (
            <div key={summary.currencyCode} className="rounded-xl bg-slate-50 p-3">
              <p className="text-sm font-bold text-slate-800">{summary.currencyCode}</p>
              <p className="text-sm text-slate-600">{amountLabel(summary)}</p>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function comparisonLabel(comparison: AdvisorDebtComparison): string {
  if (comparison.mode === "tcea_full") return "Comparación TCEA completa";
  if (comparison.mode === "tea_full") return "Comparación TEA completa";
  if (comparison.mode === "partial") return "Comparación parcial";
  return "Sin comparación de costo";
}

function ExtraCashSummary({ scenario }: { scenario: AdvisorExtraCashScenario }) {
  return (
    <div className="mt-4 rounded-2xl bg-blue-50 p-4 text-blue-950" data-testid="advisor-extra-cash-result">
      <p className="font-bold">Resultado de la simulación</p>
      <p className="mt-1 text-sm">
        Reserva primero: <strong>{formatMoneyByCurrency(scenario.reservedForObligations, scenario.currencyCode)}</strong>.
        Queda potencialmente disponible: <strong>{formatMoneyByCurrency(scenario.availableForDecision, scenario.currencyCode)}</strong>.
      </p>
      {scenario.unknownObligationCount > 0 && (
        <p className="mt-2 text-sm font-semibold text-amber-800">Hay {scenario.unknownObligationCount} obligación(es) cuyo monto necesita confirmación.</p>
      )}
      {scenario.selectedDebtName && scenario.simulation && scenario.simulation.status !== "exceeds_current_principal" && (
        <div className="mt-3 rounded-xl bg-white p-3 text-sm">
          <p className="font-bold">Opción para simular: {scenario.selectedDebtName}</p>
          <p>Principal actual: {formatMoneyByCurrency(scenario.simulation.currentPrincipal, scenario.currencyCode)}</p>
          <p>Principal simulado: {formatMoneyByCurrency(scenario.simulation.simulatedPrincipal ?? 0, scenario.currencyCode)}</p>
          <p className="mt-1 text-slate-600">El ahorro exacto de intereses y el nuevo cronograma dependen del recálculo contractual del acreedor.</p>
        </div>
      )}
      {scenario.warnings.map((warning) => (
        <p key={warning} className="mt-2 text-xs text-slate-700">{warning}</p>
      ))}
    </div>
  );
}

export function FinancialAdvisorPanel({ result, onNavigate }: FinancialAdvisorPanelProps) {
  const [extraAmount, setExtraAmount] = useState("");
  const [extraCurrency, setExtraCurrency] = useState("PEN");
  const [extraScenario, setExtraScenario] = useState<AdvisorExtraCashScenario | null>(null);
  const [question, setQuestion] = useState("");
  const [questionAnswer, setQuestionAnswer] = useState<string | null>(null);
  const currencies = useMemo(
    () => Array.from(new Set(["PEN", "USD", ...Object.keys(result.liquidityByCurrency), ...Object.keys(result.reserveRequirementsByCurrency)])).filter((item) => item !== "UNKNOWN"),
    [result.liquidityByCurrency, result.reserveRequirementsByCurrency]
  );
  const qualityTone = result.dataQuality.status === "complete" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-950";

  function runExtraCash() {
    const parsedAmount = Number(extraAmount.replace(",", "."));
    setExtraScenario(simulateFinancialAdvisorExtraCash(result, parsedAmount, extraCurrency));
  }

  function ask(rawQuestion = question) {
    const parsed = parseFinancialAdvisorQuestion(rawQuestion);
    const scenario = parsed.intent === "extra_cash" && parsed.amount != null
      ? simulateFinancialAdvisorExtraCash(result, parsed.amount, parsed.currencyCode ?? "PEN")
      : null;
    if (scenario) setExtraScenario(scenario);
    setQuestionAnswer(answerFinancialAdvisorQuestion(parsed, result, scenario).answer);
  }

  return (
    <section data-testid="financial-advisor-panel" className="mx-auto max-w-7xl space-y-6">
      <header className="rounded-3xl bg-gradient-to-br from-blue-700 via-blue-700 to-indigo-800 p-6 text-white shadow-lg lg:p-8">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-100">ASESOR</p>
        <h2 className="mt-2 text-3xl font-bold lg:text-4xl">TU ASESOR FINANCIERO</h2>
        <p className="mt-3 max-w-2xl text-base text-blue-100">Analizo tu caja, obligaciones, deudas y tarjetas para ayudarte a tomar mejores decisiones.</p>
        <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-blue-100"><ShieldCheck className="h-5 w-5" />V1 determinística y solo de lectura</div>
      </header>

      <section data-testid="advisor-priority" className="rounded-3xl border border-blue-200 bg-white p-5 shadow-sm lg:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-blue-600">Decisiones concretas</p>
            <h2 className="text-2xl font-bold text-slate-900">TU PRIORIDAD DE HOY</h2>
          </div>
          <Landmark className="hidden h-8 w-8 text-blue-600 sm:block" />
        </div>
        {result.recommendations.length === 0 ? (
          <p className="rounded-2xl bg-emerald-50 p-4 text-emerald-900">No hay una prioridad financiera urgente demostrable con los datos actuales.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {result.recommendations.map((recommendation) => (
              <article key={recommendation.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-800">{recommendation.priority}</span>
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900">{recommendation.title}</h3>
                    <p className="mt-1 text-sm text-slate-600">{recommendation.reason}</p>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{recommendation.confidence} · {recommendation.type}</p>
                    {(recommendation.debtId || recommendation.cardId || recommendation.paymentId) && (
                      <button type="button" onClick={() => onNavigate(recommendation.cardId ? "tarjetas" : recommendation.paymentId ? "pagos" : "deudas")} className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-blue-700 hover:text-blue-900">
                        Ver detalle <ArrowRight className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2"><Wallet className="h-6 w-6 text-blue-600" /><h2 className="text-2xl font-bold text-slate-900">LIQUIDEZ CONOCIDA</h2></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Object.values(result.liquidityByCurrency).map((summary) => (
            <article key={summary.currencyCode} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-bold uppercase tracking-wide text-slate-500">{summary.currencyCode}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{formatMoneyByCurrency(summary.knownAmount, summary.currencyCode)}</p>
              <p className="mt-1 text-sm text-slate-600">{summary.balanceStatus === "known" ? "Saldo conocido" : "Cobertura parcial"}</p>
            </article>
          ))}
          {Object.keys(result.liquidityByCurrency).length === 0 && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">No hay cuentas activas con saldo demostrable.</p>}
        </div>
      </section>

      <section>
        <div className="mb-3"><p className="text-sm font-bold uppercase tracking-wide text-blue-600">Reservas por fecha y moneda</p><h2 className="text-2xl font-bold text-slate-900">DINERO QUE DEBES TENER LISTO</h2></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(Object.values(result.windows) as AdvisorObligationWindow[]).map((window) => <WindowCard key={window.key} window={window} />)}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
          <div className="mb-4 flex items-center gap-2"><Landmark className="h-6 w-6 text-indigo-600" /><div><p className="text-sm font-bold uppercase tracking-wide text-indigo-600">Perspectivas existentes</p><h2 className="text-2xl font-bold text-slate-900">¿QUÉ DEUDA CONVIENE ATACAR?</h2></div></div>
          {result.debtComparisons.length === 0 ? <p className="text-sm text-slate-600">No hay deudas activas comparables.</p> : <div className="space-y-3">
            {result.debtComparisons.map((comparison) => {
              const winner = result.debtPriorities.find((item) => item.debtId === comparison.recommendedDebtId);
              return <div key={comparison.currencyCode} className="rounded-2xl bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold text-slate-900">{comparison.currencyCode} · {comparisonLabel(comparison)}</p>{winner && <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-800">{winner.debtName}</span>}</div>
                <p className="mt-1 text-sm text-slate-600">{comparison.explanation}</p>
                {comparison.unknownRateDebtIds.length > 0 && <p className="mt-2 text-xs font-semibold text-amber-800">Hay deudas sin tasa comparable; no se consideran 0%.</p>}
              </div>;
            })}
            {result.debtPriorities.slice(0, 3).map((debt) => <div key={debt.debtId} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 pt-3 text-sm"><span className="font-bold text-slate-800">{debt.debtName}</span><span className="text-slate-600">Urgencia {debt.urgencyRank ? `#${debt.urgencyRank}` : "—"}</span><span className="text-slate-600">Avalancha {debt.avalancheRank ? `#${debt.avalancheRank}` : "—"}</span><span className="text-slate-600">Flujo {debt.cashFlowReliefRank ? `#${debt.cashFlowReliefRank}` : "—"}</span></div>)}
          </div>}
        </article>

        <article data-testid="advisor-extra-cash" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
          <p className="text-sm font-bold uppercase tracking-wide text-emerald-600">Simulación sin efectos reales</p>
          <h2 className="mt-1 text-2xl font-bold text-slate-900">SI TUVIERAS DINERO EXTRA</h2>
          <p className="mt-2 text-sm text-slate-600">Reserva primero obligaciones inmediatas. Solo el remanente puede evaluarse para una reducción de principal.</p>
          <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
            <label className="sr-only" htmlFor="advisor-extra-amount">Monto extra</label>
            <input id="advisor-extra-amount" inputMode="decimal" value={extraAmount} onChange={(event) => setExtraAmount(event.target.value)} placeholder="Monto" className="min-h-12 rounded-xl border border-slate-300 px-3 text-lg" />
            <label className="sr-only" htmlFor="advisor-extra-currency">Moneda</label>
            <select id="advisor-extra-currency" value={extraCurrency} onChange={(event) => setExtraCurrency(event.target.value)} className="min-h-12 rounded-xl border border-slate-300 bg-white px-3 font-bold"><option value="PEN">PEN</option>{currencies.filter((currency) => currency !== "PEN").map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select>
          </div>
          <button type="button" onClick={runExtraCash} className="mt-3 min-h-12 w-full rounded-xl bg-emerald-600 px-4 font-bold text-white hover:bg-emerald-700">Simular reserva y prepago</button>
          {extraScenario && <ExtraCashSummary scenario={extraScenario} />}
        </article>
      </section>

      <section data-testid="advisor-questions" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
        <div className="flex items-center gap-2"><MessageCircle className="h-6 w-6 text-blue-600" /><div><p className="text-sm font-bold uppercase tracking-wide text-blue-600">Consulta local</p><h2 className="text-2xl font-bold text-slate-900">PREGÚNTALE A TU ASESOR</h2></div></div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row"><label className="sr-only" htmlFor="advisor-question-input">Pregunta</label><input id="advisor-question-input" data-testid="advisor-question-input" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") ask(); }} placeholder="Escribe una pregunta..." className="min-h-12 flex-1 rounded-xl border border-slate-300 px-3" /><button type="button" onClick={() => ask()} className="min-h-12 rounded-xl bg-blue-700 px-5 font-bold text-white hover:bg-blue-800">Consultar</button></div>
        <div className="mt-3 flex flex-wrap gap-2">{QUICK_SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" onClick={() => { setQuestion(suggestion); ask(suggestion); }} className="rounded-full border border-blue-200 bg-blue-50 px-3 py-2 text-left text-sm font-semibold text-blue-900 hover:bg-blue-100">{suggestion}</button>)}</div>
        {questionAnswer && <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-slate-800" role="status"><p className="font-semibold">{questionAnswer}</p></div>}
      </section>

      <section className={`rounded-2xl border p-4 ${qualityTone}`} data-testid="advisor-data-quality">
        <div className="flex items-start gap-3"><div className="mt-0.5">{result.dataQuality.status === "complete" ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}</div><div><h2 className="font-bold">{QUALITY_LABELS[result.dataQuality.status]}</h2><p className="mt-1 text-sm">{result.dataQuality.status === "complete" ? "Las recomendaciones usan datos conocidos y reglas determinísticas." : `Falta información en ${result.dataQuality.missingDataCount} aspecto(s). Las recomendaciones pueden cambiar cuando completes esos datos.`}</p>{result.dataQuality.messages.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm">{result.dataQuality.messages.slice(0, 4).map((message) => <li key={message}>{message}</li>)}</ul>}</div></div>
      </section>
    </section>
  );
}
