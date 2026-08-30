import { useMemo, useState } from "react";
import { ArrowRight, ShieldAlert } from "lucide-react";
import type { Debt, DebtContractAuthority, DebtEvent, DebtEventInstallmentAllocation, DebtFinancingContract, DebtInstallment, DebtInstallmentCarriedAllocation, DebtKind, DebtScheduleVersion, FinancialAccount } from "../types";
import { refinanceDebt } from "../services/dataRepository";
import { makeUuid } from "../utils/storage";
import { localDateString } from "../utils/date";
import { formatDebtKind, translateDebtError } from "../utils/debtViewModel";
import { formatDebtMoney } from "../utils/debtPresentation";
import { compareRefinancing, deriveUniversalDebtState } from "../utils/universalDebtContract";
import { mapUniversalDocumentRowsToSchedule, parseUniversalDebtExternalAiResponse, UNIVERSAL_EXTERNAL_AI_PROMPT } from "../utils/universalDebtDocumentImport";

interface DebtRefinanceFormProps {
  debt: Debt;
  currentPrincipal: number;
  accounts: FinancialAccount[];
  debtEvents?: DebtEvent[];
  scheduleVersions?: DebtScheduleVersion[];
  installments?: DebtInstallment[];
  allocations?: DebtEventInstallmentAllocation[];
  carriedAllocations?: DebtInstallmentCarriedAllocation[];
  debtFinancingContract?: DebtFinancingContract | null;
  canWriteDebt: boolean;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
  setToast: (toast: { message: string; type: "success" | "error" }) => void;
}

const DEBT_KIND_OPTIONS: DebtKind[] = ["bank_loan", "family_loan", "installment_purchase", "mortgage", "pledge", "other"];

function moneyOrConfirm(value: number | null | undefined, currency: string): string {
  return value == null ? "POR CONFIRMAR" : formatDebtMoney(value, currency);
}

export function DebtRefinanceForm({ debt, currentPrincipal, accounts, debtEvents = [], scheduleVersions = [], installments = [], allocations = [], carriedAllocations = [], debtFinancingContract = null, canWriteDebt, onSaved, onCancel, setToast }: DebtRefinanceFormProps) {
  const activeAccounts = accounts.filter((account) => account.isActive !== false && account.currencyCode === debt.currencyCode);
  const [effectiveDate, setEffectiveDate] = useState(localDateString(new Date()));
  const [targetName, setTargetName] = useState(`Refinanciación — ${debt.name}`);
  const [targetCreditor, setTargetCreditor] = useState("");
  const [targetKind, setTargetKind] = useState<DebtKind>(debt.debtKind === "credit_card" ? "other" : debt.debtKind);
  const [amountPaidByNewCreditor, setAmountPaidByNewCreditor] = useState(currentPrincipal.toFixed(2));
  const [cashContribution, setCashContribution] = useState("0");
  const [refinanceCosts, setRefinanceCosts] = useState("0");
  const [targetPrincipal, setTargetPrincipal] = useState(currentPrincipal.toFixed(2));
  const [targetStructure, setTargetStructure] = useState<"fixed_schedule" | "open_ended">(debt.repaymentStructure === "fixed_schedule" ? "fixed_schedule" : "open_ended");
  const [targetFrequency, setTargetFrequency] = useState(debt.paymentFrequency ?? "monthly");
  const [targetFirstDueDate, setTargetFirstDueDate] = useState(debt.firstDueDate ?? "");
  const [targetScheduleJson, setTargetScheduleJson] = useState("");
  const [targetInstallments, setTargetInstallments] = useState<ReturnType<typeof mapUniversalDocumentRowsToSchedule>>([]);
  const [targetScheduleSource, setTargetScheduleSource] = useState<"contractual" | "reconstructed" | "estimated" | "manual" | null>(null);
  const [targetContractAuthority, setTargetContractAuthority] = useState<DebtContractAuthority>("unknown");
  const [targetSchedulePending, setTargetSchedulePending] = useState(true);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(activeAccounts[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [attemptIds] = useState(() => ({ targetDebtId: makeUuid(), linkId: makeUuid(), sourceRefinanceEventId: makeUuid(), contributionMovementId: makeUuid(), refinanceCostsMovementId: makeUuid() }));

  const paidByNewCreditor = Number(amountPaidByNewCreditor || 0);
  const contribution = Number(cashContribution || 0);
  const costs = Number(refinanceCosts || 0);
  const newPrincipal = Number(targetPrincipal || 0);
  const settlementDifference = currentPrincipal - paidByNewCreditor - contribution;
  const settlementMatches = Number.isFinite(settlementDifference) && Math.abs(settlementDifference) <= 0.01;
  const currentScheduleId = scheduleVersions.filter((version) => version.debtId === debt.id).sort((a, b) => b.versionNumber - a.versionNumber)[0]?.id ?? null;
  const sourceState = useMemo(() => deriveUniversalDebtState({ debt, events: debtEvents, installments, allocations, carriedAllocations, currentScheduleId, scheduleAuthority: currentScheduleId ? scheduleVersions.find((version) => version.id === currentScheduleId)?.authority : null }), [debt, debtEvents, installments, allocations, carriedAllocations, currentScheduleId, scheduleVersions]);
  const targetProjectedTotal = !targetSchedulePending && targetInstallments.length > 0 && targetInstallments.every((row) => row.expectedAmount != null) ? targetInstallments.reduce((sum, row) => sum + (row.expectedAmount ?? 0), 0) : null;
  const targetInterest = !targetSchedulePending && targetInstallments.length > 0 && targetInstallments.every((row) => row.expectedInterest != null) ? targetInstallments.reduce((sum, row) => sum + (row.expectedInterest ?? 0), 0) : null;
  const targetFees = !targetSchedulePending && targetInstallments.length > 0 && targetInstallments.every((row) => row.expectedFees != null) ? targetInstallments.reduce((sum, row) => sum + (row.expectedFees ?? 0), 0) : null;
  const targetInsurance = !targetSchedulePending && targetInstallments.length > 0 && targetInstallments.every((row) => row.expectedInsurance != null) ? targetInstallments.reduce((sum, row) => sum + (row.expectedInsurance ?? 0), 0) : null;
  const targetFinalDueDate = !targetSchedulePending && targetInstallments.length > 0 ? targetInstallments.at(-1)?.dueDate ?? null : null;
  const comparison = compareRefinancing({ sourcePrincipal: sourceState.currentPrincipal || currentPrincipal, sourceRemainingPayments: sourceState.remainingProjectedTotalCash, sourceRemainingInterest: sourceState.remainingProjectedInterest, sourceRemainingFees: sourceState.remainingProjectedFees, sourceRemainingInsurance: sourceState.remainingProjectedInsurance, sourceRemainingInstallments: sourceState.futureInstallmentCount, sourceFinalDueDate: installments.at(-1)?.dueDate ?? null, targetPrincipal: newPrincipal, targetRemainingPayments: targetProjectedTotal, targetRemainingInterest: targetInterest, targetRemainingFees: targetFees, targetRemainingInsurance: targetInsurance, targetRemainingInstallments: targetInstallments.length || null, targetFinalDueDate, cashContribution: Number.isFinite(contribution) ? contribution : null, refinanceCosts: Number.isFinite(costs) ? costs : null });

  const loadTargetSchedule = () => {
    try {
      setScheduleError(null);
      const review = parseUniversalDebtExternalAiResponse(targetScheduleJson, newPrincipal);
      const mapped = mapUniversalDocumentRowsToSchedule(review);
      if (mapped.length === 0) throw new Error("El JSON V2 no contiene filas cargables.");
      setTargetInstallments(mapped);
      setTargetScheduleSource(review.scheduleSource);
      setTargetContractAuthority(review.normalized.authority);
      setTargetSchedulePending(false);
      if (mapped[0]?.dueDate) setTargetFirstDueDate(mapped[0].dueDate);
    } catch (error) {
      setScheduleError(error instanceof Error ? error.message : "No se pudo cargar el cronograma V2.");
    }
  };

  const markTargetSchedulePending = () => {
    setTargetInstallments([]);
    setTargetScheduleSource(null);
    setTargetContractAuthority("unknown");
    setTargetSchedulePending(true);
    setScheduleError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canWriteDebt || (typeof navigator !== "undefined" && !navigator.onLine)) { setToast({ message: "La refinanciación requiere conexión y permisos de escritura.", type: "error" }); return; }
    if (!targetName.trim() || !targetCreditor.trim() || !effectiveDate || !Number.isFinite(paidByNewCreditor) || paidByNewCreditor < 0 || !Number.isFinite(contribution) || contribution < 0 || !Number.isFinite(costs) || costs < 0 || !Number.isFinite(newPrincipal) || newPrincipal <= 0) { setToast({ message: "Completa los datos de la nueva obligación con importes válidos.", type: "error" }); return; }
    if (!settlementMatches) { setToast({ message: "La suma pagada por el nuevo acreedor y el aporte propio debe coincidir con el saldo principal.", type: "error" }); return; }
    if ((contribution > 0 || costs > 0) && !accountId) { setToast({ message: "Selecciona la cuenta desde la que saldrán el aporte propio y/o los costos.", type: "error" }); return; }
    if (targetStructure === "fixed_schedule" && !targetSchedulePending && targetInstallments.length === 0) { setToast({ message: "Carga el nuevo cronograma o marca explícitamente que queda pendiente.", type: "error" }); return; }

    setSubmitting(true);
    try {
      const targetContract = {
        contractAuthority: targetContractAuthority,
        principalBasis: "financed_principal_only",
        financedPrincipalAmount: newPrincipal,
        openingPrincipalAmount: newPrincipal,
        repaymentStructure: targetStructure,
        installmentAmountMode: targetStructure === "fixed_schedule" ? "fixed" : "variable",
        paymentFrequency: targetStructure === "fixed_schedule" ? targetFrequency : null,
        firstDueDate: targetStructure === "fixed_schedule" ? targetFirstDueDate || null : null,
        interest_calculation_mode: "unknown",
        authorityNotes: targetSchedulePending ? "Nueva obligación registrada; el cronograma del acreedor queda explícitamente pendiente." : "Nuevo cronograma importado; revisar evidencia contra el contrato.",
      };
      await refinanceDebt({ linkId: attemptIds.linkId, sourceDebtId: debt.id, sourceRefinanceEventId: attemptIds.sourceRefinanceEventId, targetDebtId: attemptIds.targetDebtId, effectiveDate, targetName: targetName.trim(), targetCreditorName: targetCreditor.trim(), targetDebtKind: targetKind, currencyCode: debt.currencyCode, targetOriginalPrincipal: newPrincipal, targetOpeningPrincipal: newPrincipal, targetInstallmentAmountMode: targetStructure === "fixed_schedule" ? "fixed" : "variable", targetPaymentFrequency: targetStructure === "fixed_schedule" ? targetFrequency : null, targetFirstDueDate: targetStructure === "fixed_schedule" ? targetFirstDueDate || null : null, targetNotes: notes.trim() || (targetSchedulePending ? "Nueva obligación creada por refinanciación; cronograma pendiente de importar." : "Nueva obligación creada por refinanciación."), amountPaidByNewCreditor: paidByNewCreditor, cashContributionAmount: contribution, targetFinancedPrincipalAmount: newPrincipal, targetInstallments: targetStructure === "fixed_schedule" && !targetSchedulePending ? targetInstallments : [], targetScheduleSource: targetStructure === "fixed_schedule" && !targetSchedulePending ? targetScheduleSource : null, targetContract, contributionMovementId: contribution > 0 ? attemptIds.contributionMovementId : null, contributionAccountId: contribution > 0 ? accountId : null, contributionDescription: contribution > 0 ? `Aporte propio para refinanciación — ${debt.name}` : null, contributionCategory: contribution > 0 ? "Pago de deuda" : null, refinanceCostsAmount: costs, refinanceCostsMovementId: costs > 0 ? attemptIds.refinanceCostsMovementId : null, refinanceCostsAccountId: costs > 0 ? accountId : null, refinanceCostsDescription: costs > 0 ? `Costos de cierre de refinanciación — ${debt.name}` : null, refinanceCostsCategory: costs > 0 ? "Costo financiero" : null, notes: notes.trim() || null });
      setToast({ message: "Refinanciación registrada; la deuda anterior conserva todo su historial.", type: "success" });
      await onSaved();
    } catch (error) { setToast({ message: translateDebtError(error), type: "error" }); } finally { setSubmitting(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/60 p-5 space-y-4" data-testid="debt-refinance-form">
      <div className="flex items-start gap-3"><div className="rounded-xl bg-indigo-600 p-2 text-white"><ArrowRight className="h-5 w-5" /></div><div><h3 className="text-lg font-black text-indigo-950">REFINANCIAR / COMPRA DE DEUDA</h3><p className="text-sm font-semibold text-indigo-900">La deuda nueva sustituye la obligación actual sin crear ingreso ni egreso por el monto que el nuevo acreedor paga directamente.</p></div></div>
      <div className="rounded-xl border border-indigo-200 bg-white p-4 text-sm"><div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><div><p className="text-xs text-slate-500">Deuda actual</p><p className="font-bold text-slate-900">{debt.name}</p></div><div><p className="text-xs text-slate-500">Acreedor actual</p><p className="font-bold text-slate-900">{debt.creditorName}</p></div><div><p className="text-xs text-slate-500">Saldo principal</p><p className="font-bold text-slate-900">{formatDebtMoney(currentPrincipal, debt.currencyCode)}</p></div></div></div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">Fecha efectiva *<input required type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>
        <label className="text-sm font-semibold text-slate-700">Nuevo acreedor *<input required value={targetCreditor} onChange={(event) => setTargetCreditor(event.target.value)} placeholder="Nombre o entidad" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>
        <label className="text-sm font-semibold text-slate-700">Nombre de la nueva deuda *<input required value={targetName} onChange={(event) => setTargetName(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>
        <label className="text-sm font-semibold text-slate-700">Tipo de deuda nueva<select value={targetKind} onChange={(event) => setTargetKind(event.target.value as DebtKind)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2">{DEBT_KIND_OPTIONS.map((kind) => <option key={kind} value={kind}>{formatDebtKind(kind)}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">Monto pagado por el nuevo acreedor *<input required type="number" min="0" step="0.01" value={amountPaidByNewCreditor} onChange={(event) => setAmountPaidByNewCreditor(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>
        <label className="text-sm font-semibold text-slate-700">Aporte propio en efectivo<input type="number" min="0" step="0.01" value={cashContribution} onChange={(event) => setCashContribution(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>
        <label className="text-sm font-semibold text-slate-700">Costos de cierre/refinanciación pagados en efectivo<input aria-label="Costos de cierre/refinanciación pagados en efectivo" type="number" min="0" step="0.01" value={refinanceCosts} onChange={(event) => setRefinanceCosts(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>
        <label className="text-sm font-semibold text-slate-700">Nuevo principal financiado *<input required type="number" min="0.01" step="0.01" value={targetPrincipal} onChange={(event) => setTargetPrincipal(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>
        <label className="text-sm font-semibold text-slate-700">Estructura nueva<select value={targetStructure} onChange={(event) => { const value = event.target.value as "fixed_schedule" | "open_ended"; setTargetStructure(value); if (value === "open_ended") markTargetSchedulePending(); }} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"><option value="open_ended">Abierta / sin cronograma cargado</option><option value="fixed_schedule">Con cronograma del acreedor</option></select></label>
        {targetStructure === "fixed_schedule" && <><label className="text-sm font-semibold text-slate-700">Frecuencia<select value={targetFrequency} onChange={(event) => setTargetFrequency(event.target.value as Debt["paymentFrequency"] & string)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"><option value="monthly">Mensual</option><option value="biweekly">Quincenal</option><option value="weekly">Semanal</option><option value="custom">Personalizada</option></select></label><label className="text-sm font-semibold text-slate-700">Primera fecha de vencimiento<input type="date" value={targetFirstDueDate} onChange={(event) => setTargetFirstDueDate(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label></>}
      </div>
      {targetStructure === "fixed_schedule" && <section className="rounded-xl border border-blue-200 bg-white p-4 space-y-3" data-testid="refinance-target-schedule"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-black uppercase tracking-wide text-blue-950">Nuevo cronograma del acreedor</p><p className="mt-1 text-xs text-slate-600">Puedes cargar el JSON V2 ya entregado por el acreedor o elegir explícitamente que queda pendiente.</p></div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${targetSchedulePending ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}>{targetSchedulePending ? "NUEVO CRONOGRAMA PENDIENTE" : `${targetInstallments.length} FILAS CARGADAS`}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-700">AUTORIDAD: {targetContractAuthority}</span></div></div><textarea aria-label="JSON V2 del nuevo cronograma" value={targetScheduleJson} onChange={(event) => setTargetScheduleJson(event.target.value)} rows={4} placeholder="Pega aquí el JSON CAJA_FAMILIAR_DEBT_DOCUMENT_V2 del nuevo acreedor." className="w-full rounded-xl border border-slate-300 p-3 font-mono text-xs text-slate-900" /><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void navigator.clipboard?.writeText(UNIVERSAL_EXTERNAL_AI_PROMPT)} className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-800">COPIAR PROMPT V2</button><button type="button" onClick={loadTargetSchedule} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white">CARGAR NUEVO CRONOGRAMA</button><button type="button" onClick={markTargetSchedulePending} className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-900">EL ACREEDOR TODAVÍA NO ME ENTREGA EL NUEVO CRONOGRAMA</button></div>{scheduleError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800">{scheduleError}</p>}</section>}
      {(contribution > 0 || costs > 0) && <label className="block text-sm font-semibold text-slate-700">Cuenta de aportes/costos *<select required value={accountId} onChange={(event) => setAccountId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"><option value="">Selecciona una cuenta</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currencyCode}</option>)}</select></label>}
      <label className="block text-sm font-semibold text-slate-700">Notas<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="Costos, condiciones o pendientes de confirmación" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3" data-testid="refinance-comparison-preview"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-black uppercase tracking-wide text-slate-900">PREVIEW ECONÓMICO ANTES DE GUARDAR</h4><span className={`rounded-full px-3 py-1 text-[11px] font-black ${comparison.status === "known" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{comparison.status === "known" ? "ESTIMACIÓN COMPLETA" : "ESTIMACIÓN PARCIAL / POR CONFIRMAR"}</span></div><div className="grid grid-cols-1 gap-4 md:grid-cols-2"><div className="rounded-lg bg-slate-50 p-3 text-xs space-y-1"><p className="font-black text-slate-900">CURRENT DEBT</p><p>Principal: <b>{moneyOrConfirm(sourceState.currentPrincipal || currentPrincipal, debt.currencyCode)}</b></p><p>Interés proyectado: <b>{moneyOrConfirm(sourceState.remainingProjectedInterest, debt.currencyCode)}</b></p><p>Fees: <b>{moneyOrConfirm(sourceState.remainingProjectedFees, debt.currencyCode)}</b></p><p>Seguro: <b>{moneyOrConfirm(sourceState.remainingProjectedInsurance, debt.currencyCode)}</b></p><p>Total proyectado: <b>{moneyOrConfirm(sourceState.remainingProjectedTotalCash, debt.currencyCode)}</b></p><p>Fecha final: <b>{installments.at(-1)?.dueDate ?? "POR CONFIRMAR"}</b></p></div><div className="rounded-lg bg-indigo-50 p-3 text-xs space-y-1"><p className="font-black text-indigo-950">NEW FINANCING</p><p>Principal: <b>{moneyOrConfirm(newPrincipal, debt.currencyCode)}</b></p><p>Interés proyectado: <b>{moneyOrConfirm(targetInterest, debt.currencyCode)}</b></p><p>Fees: <b>{moneyOrConfirm(targetFees, debt.currencyCode)}</b></p><p>Seguro: <b>{moneyOrConfirm(targetInsurance, debt.currencyCode)}</b></p><p>Costos de cierre: <b>{moneyOrConfirm(costs, debt.currencyCode)}</b></p><p>Aporte propio: <b>{moneyOrConfirm(contribution, debt.currencyCode)}</b></p><p>Total proyectado: <b>{moneyOrConfirm(comparison.targetTotal, debt.currencyCode)}</b></p><p>Fecha final: <b>{targetFinalDueDate ?? "POR CONFIRMAR"}</b></p></div></div><div className="rounded-lg border border-slate-200 p-3 text-sm font-bold">DIFERENCIA: {comparison.difference == null ? "POR CONFIRMAR" : `${formatDebtMoney(comparison.difference, debt.currencyCode)} · ${comparison.difference >= 0 ? "ahorro estimado" : "costo extra estimado"}`} · Pago: {comparison.monthlyPaymentDelta == null ? "POR CONFIRMAR" : formatDebtMoney(comparison.monthlyPaymentDelta, debt.currencyCode)} · Plazo: {comparison.termDelta == null ? "POR CONFIRMAR" : `${comparison.termDelta} cuotas`}</div>{comparison.warning && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">{comparison.warning}</p>}</section>
      <div className={`rounded-xl border px-3 py-2 text-sm font-semibold ${settlementMatches ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{settlementMatches ? "Liquidación balanceada: solo el aporte propio generará un movimiento real." : `Falta asignar ${formatDebtMoney(Math.abs(settlementDifference), debt.currencyCode)} para cuadrar la liquidación.`}</div>
      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />La oferta y sus costos siguen siendo reportados hasta que se confirme el nuevo contrato. No se afirma ahorro con datos incompletos.</div>
      <div className="flex justify-end gap-2"><button type="button" onClick={onCancel} disabled={submitting} className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600">Cancelar</button><button type="submit" disabled={submitting || !settlementMatches} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{submitting ? "Registrando..." : "Registrar refinanciación"}</button></div>
    </form>
  );
}
