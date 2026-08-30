import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Clipboard, FileSearch, ShieldAlert } from "lucide-react";
import type { DebtKind, HouseholdMember } from "../types";
import type { DebtCreateResult } from "../services/dataRepository";
import { createDebtFromDocument } from "../services/debtDocumentFirstOnboarding";
import { localDateString } from "../utils/date";
import { makeUuid } from "../utils/storage";
import { parseUniversalDebtExternalAiResponse, type UniversalDebtDocumentImportReview } from "../utils/universalDebtDocumentImport";
import {
  DOCUMENT_FIRST_EXTERNAL_AI_PROMPT,
  deriveOpeningPrincipalFromDocument,
  extractDocumentFirstDefaults,
  periodicRateBasis,
  scheduleWithPretracking,
  type DocumentFirstOnboardingMode,
} from "../utils/debtDocumentFirstOnboarding";

interface DebtDocumentFirstOnboardingProps {
  currentMember?: HouseholdMember;
  canWriteDebt?: boolean;
  onSaved: (result: DebtCreateResult) => void | Promise<void>;
  onCancel: () => void;
  onBack: () => void;
  onUseSpecializedFlow: (kind: DebtKind) => void;
  setToast: (toast: { message: string; type: "success" | "error" }) => void;
}

function money(value: number | null, currencyCode: "PEN" | "USD"): string {
  if (value == null || !Number.isFinite(value)) return "POR CONFIRMAR";
  const symbol = currencyCode === "USD" ? "$" : "S/";
  return `${symbol} ${value.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function numericInput(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const GENERIC_KIND_OPTIONS: Array<{ value: "installment_purchase" | "mortgage" | "family_loan" | "other"; label: string }> = [
  { value: "installment_purchase", label: "Financiamiento / compra a cuotas" },
  { value: "mortgage", label: "Hipoteca / financiamiento inmobiliario" },
  { value: "family_loan", label: "Préstamo familiar o privado" },
  { value: "other", label: "Otro financiamiento con cronograma" },
];

export function DebtDocumentFirstOnboarding({ currentMember, canWriteDebt = true, onSaved, onCancel, onBack, onUseSpecializedFlow, setToast }: DebtDocumentFirstOnboardingProps) {
  const [debtId] = useState(() => makeUuid());
  const [responseText, setResponseText] = useState("");
  const [review, setReview] = useState<UniversalDebtDocumentImportReview | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [onboardingMode, setOnboardingMode] = useState<DocumentFirstOnboardingMode | null>(null);
  const [lastPaidInstallment, setLastPaidInstallment] = useState("0");
  const [currentPrincipalOverride, setCurrentPrincipalOverride] = useState("");
  const [nameOverride, setNameOverride] = useState("");
  const [creditorOverride, setCreditorOverride] = useState("");
  const [debtKindOverride, setDebtKindOverride] = useState<"installment_purchase" | "mortgage" | "family_loan" | "other" | null>(null);
  const [saving, setSaving] = useState(false);

  const defaults = useMemo(() => review ? extractDocumentFirstDefaults(review) : null, [review]);
  const lastPaid = onboardingMode === "EXISTING_DEBT" ? Math.max(0, Math.trunc(Number(lastPaidInstallment) || 0)) : 0;
  const derivedOpeningPrincipal = defaults && onboardingMode
    ? deriveOpeningPrincipalFromDocument(defaults, onboardingMode, lastPaid)
    : null;
  const manualCurrentPrincipal = numericInput(currentPrincipalOverride);
  const effectiveOpeningPrincipal = manualCurrentPrincipal ?? derivedOpeningPrincipal;
  const selectedDebtKind = debtKindOverride ?? (defaults && !defaults.requiresSpecializedFlow && (defaults.debtKind === "installment_purchase" || defaults.debtKind === "mortgage" || defaults.debtKind === "family_loan" || defaults.debtKind === "other") ? defaults.debtKind : "installment_purchase");
  const effectiveName = nameOverride.trim() || defaults?.debtName || "Financiamiento";
  const effectiveCreditor = creditorOverride.trim() || defaults?.creditorName || "";

  const analyze = () => {
    try {
      setErrorMessage(null);
      const parsed = parseUniversalDebtExternalAiResponse(responseText);
      const extracted = extractDocumentFirstDefaults(parsed);
      if (extracted.schedule.length === 0) throw new Error("El JSON no contiene filas de cronograma con fecha de vencimiento.");
      setReview(parsed);
      setNameOverride(extracted.debtName);
      setCreditorOverride(extracted.creditorName);
      if (!extracted.requiresSpecializedFlow && (extracted.debtKind === "installment_purchase" || extracted.debtKind === "mortgage" || extracted.debtKind === "family_loan" || extracted.debtKind === "other")) setDebtKindOverride(extracted.debtKind);
      setOnboardingMode(null);
      setLastPaidInstallment("0");
      setCurrentPrincipalOverride("");
    } catch (error) {
      setReview(null);
      setErrorMessage(error instanceof Error ? error.message : "No se pudo interpretar el JSON V2.");
    }
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(DOCUMENT_FIRST_EXTERNAL_AI_PROMPT);
      setToast({ message: "Prompt V2 copiado. Adjunta tu documento a la IA externa y luego pega aquí el JSON.", type: "success" });
    } catch {
      setToast({ message: "No se pudo copiar automáticamente. Selecciona el prompt desde el portapapeles del navegador.", type: "error" });
    }
  };

  const save = async () => {
    if (!review || !defaults) return;
    if (!currentMember) {
      setToast({ message: "No hay una sesión de hogar válida para crear la deuda.", type: "error" });
      return;
    }
    if (!canWriteDebt || (typeof navigator !== "undefined" && !navigator.onLine)) {
      setToast({ message: "La creación de deuda requiere conexión y permisos de escritura.", type: "error" });
      return;
    }
    if (defaults.requiresSpecializedFlow) {
      setToast({ message: defaults.specializedReason ?? "Este documento debe continuar por un flujo especializado.", type: "error" });
      return;
    }
    if (!onboardingMode) {
      setToast({ message: "Indica si la deuda es nueva o si ya la vienes pagando.", type: "error" });
      return;
    }
    if (!effectiveCreditor) {
      setToast({ message: "Confirma el acreedor antes de guardar.", type: "error" });
      return;
    }
    if (defaults.repaymentStructure !== "fixed_schedule") {
      setToast({ message: "Este onboarding documental V1 requiere un financiamiento con cronograma fijo.", type: "error" });
      return;
    }
    const maxContractual = Math.max(...defaults.schedule.map((row) => row.contractualInstallmentNumber ?? row.installmentNumber));
    if (onboardingMode === "EXISTING_DEBT" && (!Number.isInteger(lastPaid) || lastPaid < 0 || lastPaid >= maxContractual)) {
      setToast({ message: `La última cuota pagada debe estar entre 0 y ${Math.max(0, maxContractual - 1)}.`, type: "error" });
      return;
    }
    if (effectiveOpeningPrincipal == null || !Number.isFinite(effectiveOpeningPrincipal) || effectiveOpeningPrincipal <= 0) {
      setToast({ message: "No pudimos determinar el capital pendiente. Indícalo en la revisión antes de guardar.", type: "error" });
      return;
    }
    const originalPrincipal = defaults.financedPrincipalAmount ?? effectiveOpeningPrincipal;
    if (!Number.isFinite(originalPrincipal) || originalPrincipal <= 0) {
      setToast({ message: "El documento no permite determinar el principal financiado.", type: "error" });
      return;
    }

    const schedule = scheduleWithPretracking(defaults.schedule, onboardingMode, lastPaid);
    const nextRow = schedule.find((row) => !row.isPaidBeforeTracking && row.rowRole !== "down_payment") ?? schedule.find((row) => !row.isPaidBeforeTracking);
    const rateBasis = periodicRateBasis(defaults.interestRateBasis);
    setSaving(true);
    try {
      const result = await createDebtFromDocument({
        member: currentMember,
        debtId,
        onboardingMode,
        debtKind: selectedDebtKind,
        name: effectiveName,
        creditorName: effectiveCreditor,
        currencyCode: defaults.currencyCode,
        originDate: defaults.contractDate,
        trackingStartDate: localDateString(new Date()),
        originalPrincipal,
        openingPrincipalBalance: effectiveOpeningPrincipal,
        plannedInstallmentCount: defaults.termInstallments ?? maxContractual,
        plannedInstallmentAmount: nextRow?.expectedAmount ?? null,
        installmentAmountMode: defaults.installmentAmountMode,
        paymentFrequency: defaults.paymentFrequency,
        customFrequencyDays: defaults.customFrequencyDays,
        firstDueDate: defaults.firstDueDate,
        teaPercent: defaults.interestRateType === "effective_annual" ? defaults.interestRatePercent : null,
        tceaPercent: defaults.tceaPercent,
        notes: review.normalized.authority === "official_noncontractual" ? "Creada desde proforma/documento oficial no contractual mediante onboarding documental V2." : "Creada desde documento mediante onboarding documental V2.",
        repaymentStructure: "fixed_schedule",
        interestCalculationMode: "contract_schedule",
        periodicRatePercent: defaults.interestRateType === "effective_periodic" ? defaults.interestRatePercent : null,
        periodicRateBasis: defaults.interestRateType === "effective_periodic" ? rateBasis : null,
        schedule,
        scheduleSource: defaults.scheduleSource,
        scheduleAuthority: defaults.authority,
        lastPaidInstallment: lastPaid,
        contract: {
          contractAuthority: defaults.authority,
          principalBasis: defaults.principalBasis,
          assetPrice: defaults.assetPrice,
          downPaymentAmount: defaults.downPaymentAmount,
          scheduledPrincipalAmount: defaults.scheduledPrincipalAmount,
          financedPrincipalAmount: defaults.financedPrincipalAmount,
          openingPrincipalAmount: effectiveOpeningPrincipal,
          repaymentStructure: "fixed_schedule",
          amortizationMethod: defaults.amortizationMethod,
          installmentAmountMode: defaults.installmentAmountMode,
          paymentFrequency: defaults.paymentFrequency,
          customFrequencyDays: defaults.customFrequencyDays,
          firstDueDate: defaults.firstDueDate,
          interestRateType: defaults.interestRateType,
          interestRatePercent: defaults.interestRatePercent,
          interestRateBasis: defaults.interestRateBasis,
          dayCountBasis: defaults.dayCountBasis,
          feeRuleType: defaults.feeRuleType,
          feeRule: defaults.feeRule,
          prepaymentTerms: defaults.prepaymentTerms,
          authorityNotes: defaults.authority === "official_noncontractual" ? "Documento oficial/proforma no contractual; debe ser supersedido por contrato o cronograma contractual cuando exista." : "Importado y confirmado desde documento V2.",
        },
        documentKind: review.normalized.kind,
        documentAuthority: defaults.authority,
        authorityEvidence: review.authorityEvidence,
        normalizedMetadata: {
          schema: review.normalized.schema,
          source: "document_first_onboarding_v1",
          authority: defaults.authority,
          authorityEvidence: review.authorityEvidence,
          isAuthoritative: review.isAuthoritative,
          reconciliation: review.reconciliation,
          rowCount: schedule.length,
          warnings: review.warnings,
          principalSemantics: {
            assetPrice: defaults.assetPrice,
            downPaymentAmount: defaults.downPaymentAmount,
            financedPrincipalAmount: defaults.financedPrincipalAmount,
            scheduledPrincipalAmount: defaults.scheduledPrincipalAmount,
            principalBasis: defaults.principalBasis,
          },
        },
      });
      setToast({ message: `Deuda creada desde el documento con ${result.installments.length} filas de cronograma.`, type: "success" });
      await onSaved(result);
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : "No se pudo crear la deuda desde el documento.", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mx-auto max-w-4xl rounded-3xl bg-white p-6 shadow-xl lg:p-8">
      <div className="mb-6 flex items-center gap-3 border-b border-slate-100 pb-4">
        <button type="button" onClick={onBack} className="rounded-full bg-slate-100 p-2 text-slate-700 hover:bg-slate-200" aria-label="Volver"><ArrowLeft className="h-5 w-5" /></button>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Crear deuda desde un documento</h2>
          <p className="text-sm text-slate-500">Primero extraemos el contrato y cronograma. No se crea nada hasta tu confirmación final.</p>
        </div>
      </div>

      {!review && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5">
            <div className="flex items-start gap-3"><FileSearch className="mt-0.5 h-6 w-6 shrink-0 text-violet-700" /><div><p className="font-black text-violet-950">1. COPIA EL PROMPT Y SUBE TU ARCHIVO A LA IA</p><p className="mt-1 text-sm text-violet-900">Adjunta tu PDF, imágenes, Excel, CSV, TSV o TXT a ChatGPT, Gemini, Claude u otra IA junto con este prompt. La IA debe devolverte únicamente JSON V2.</p></div></div>
            <button type="button" onClick={() => void copyPrompt()} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-black text-white hover:bg-violet-800"><Clipboard className="h-4 w-4" /> COPIAR PROMPT V2</button>
          </div>
          <div className="rounded-2xl border border-slate-200 p-5">
            <p className="font-black text-slate-900">2. PEGA AQUÍ EL JSON DEVUELTO</p>
            <p className="mt-1 text-sm text-slate-500">Caja Familiar lo normalizará, comprobará la aritmética y rellenará la deuda automáticamente antes de guardar.</p>
            <textarea aria-label="JSON V2 del documento" value={responseText} onChange={(event) => { setResponseText(event.target.value); setErrorMessage(null); }} rows={10} placeholder='Pega aquí CAJA_FAMILIAR_DEBT_DOCUMENT_V2' className="mt-3 w-full rounded-xl border border-slate-300 p-3 font-mono text-xs text-slate-900 focus:border-violet-600 focus:outline-none" />
            {errorMessage && <p role="alert" className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{errorMessage}</p>}
            <button type="button" onClick={analyze} disabled={!responseText.trim()} className="mt-3 rounded-xl bg-blue-600 px-5 py-2.5 font-black text-white hover:bg-blue-700 disabled:opacity-50">ANALIZAR Y RELLENAR DEUDA</button>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-4"><button type="button" onClick={onCancel} className="rounded-xl px-4 py-2.5 font-bold text-slate-600 hover:bg-slate-100">Cancelar</button></div>
        </div>
      )}

      {review && defaults && (
        <div className="space-y-5">
          <div className={`rounded-2xl border p-5 ${defaults.authority === "contractual" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-xs font-black uppercase tracking-wider text-slate-600">DOCUMENTO ANALIZADO</p><p className="mt-1 text-lg font-black text-slate-950">{defaults.authority === "contractual" ? "CONTRACTUAL" : defaults.authority === "official_noncontractual" ? "PROFORMA / NO CONTRACTUAL" : defaults.authority === "estimated" ? "ESTIMADO" : defaults.authority === "user_reported" ? "REPORTADO POR EL USUARIO" : "AUTORIDAD POR CONFIRMAR"}</p></div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700">{defaults.schedule.length} FILAS</span>
            </div>
            {defaults.authority === "official_noncontractual" && <p className="mt-3 text-sm font-semibold text-amber-950">Este documento sirve para proyectar la deuda, pero no tiene fuerza contractual por sí solo. Podrás reemplazarlo luego por el contrato o cronograma contractual.</p>}
            <p className="mt-2 text-xs text-slate-700">Reconciliación: <strong>{review.reconciliation.status === "exact" || review.reconciliation.status === "within_tolerance" ? "EXACTA" : review.reconciliation.status === "inconsistent" ? "INCONSISTENTE" : "POR CONFIRMAR"}</strong> · Evidencia de autoridad: <strong>{review.authorityEvidence}</strong></p>
          </div>

          {defaults.requiresSpecializedFlow ? (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
              <div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" /><div><p className="font-black text-blue-950">Este documento usa un flujo especializado</p><p className="mt-1 text-sm text-blue-900">{defaults.specializedReason}</p></div></div>
              <button type="button" onClick={() => onUseSpecializedFlow(defaults.debtKind)} className="mt-4 rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-black text-white">ABRIR FLUJO ESPECIALIZADO</button>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-200 p-5 space-y-4">
                <div><p className="font-black text-slate-900">DATOS QUE CAJA FAMILIAR VA A CREAR</p><p className="text-sm text-slate-500">La IA los propuso; puedes corregir nombre, acreedor y tipo antes de confirmar.</p></div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="text-sm font-bold text-slate-700">Nombre de la deuda<input value={nameOverride} onChange={(event) => setNameOverride(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal text-slate-900" /></label>
                  <label className="text-sm font-bold text-slate-700">Acreedor<input value={creditorOverride} onChange={(event) => setCreditorOverride(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal text-slate-900" /></label>
                  <label className="text-sm font-bold text-slate-700">Tipo de deuda<select value={selectedDebtKind} onChange={(event) => setDebtKindOverride(event.target.value as typeof selectedDebtKind)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal text-slate-900">{GENERIC_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Moneda</p><p className="font-black text-slate-900">{defaults.currencyCode}</p></div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Valor del bien</p><p className="font-black">{money(defaults.assetPrice, defaults.currencyCode)}</p></div>
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Cuota inicial</p><p className="font-black">{money(defaults.downPaymentAmount, defaults.currencyCode)}</p></div>
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Principal programado</p><p className="font-black">{money(defaults.scheduledPrincipalAmount, defaults.currencyCode)}</p></div>
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Principal financiado</p><p className="font-black">{money(defaults.financedPrincipalAmount, defaults.currencyCode)}</p></div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
                  <div><p className="text-xs text-slate-500">Tasa</p><p className="font-bold">{defaults.interestRatePercent == null ? "POR CONFIRMAR" : `${defaults.interestRatePercent}% · ${defaults.interestRateType}`}</p></div>
                  <div><p className="text-xs text-slate-500">Base de días</p><p className="font-bold">{defaults.dayCountBasis}</p></div>
                  <div><p className="text-xs text-slate-500">Regla de gastos</p><p className="font-bold">{defaults.feeRuleType}</p></div>
                  <div><p className="text-xs text-slate-500">Plazo / filas</p><p className="font-bold">{defaults.termInstallments ?? defaults.schedule.length}</p></div>
                </div>
              </div>

              <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 space-y-4">
                <div><p className="font-black text-indigo-950">SOLO FALTA TU HISTORIA REAL</p><p className="mt-1 text-sm text-indigo-900">El documento conoce el contrato, pero no debe inventar qué pagos hiciste realmente.</p></div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button type="button" onClick={() => { setOnboardingMode("NEW_DEBT"); setLastPaidInstallment("0"); setCurrentPrincipalOverride(""); }} className={`rounded-xl border p-4 text-left ${onboardingMode === "NEW_DEBT" ? "border-indigo-600 bg-white ring-2 ring-indigo-600/20" : "border-indigo-200 bg-indigo-50/50"}`}><p className="font-black text-slate-900">Es nueva / todavía no he pagado cuotas</p><p className="mt-1 text-xs text-slate-600">El saldo inicial será el principal financiado que muestre el documento.</p></button>
                  <button type="button" onClick={() => setOnboardingMode("EXISTING_DEBT")} className={`rounded-xl border p-4 text-left ${onboardingMode === "EXISTING_DEBT" ? "border-indigo-600 bg-white ring-2 ring-indigo-600/20" : "border-indigo-200 bg-indigo-50/50"}`}><p className="font-black text-slate-900">Ya la vengo pagando</p><p className="mt-1 text-xs text-slate-600">Indica la última cuota realmente pagada; Caja Familiar calculará el capital cuando sea seguro.</p></button>
                </div>
                {onboardingMode === "EXISTING_DEBT" && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-indigo-950">Última cuota contractual realmente pagada<input type="number" min="0" step="1" value={lastPaidInstallment} onChange={(event) => { setLastPaidInstallment(event.target.value); setCurrentPrincipalOverride(""); }} className="mt-1 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2.5 font-normal text-slate-900" /><span className="mt-1 block text-xs font-normal text-indigo-800">Usa 0 si todavía no pagaste ninguna cuota del cronograma.</span></label><label className="text-sm font-bold text-indigo-950">Capital pendiente informado por el acreedor (opcional)<input type="number" min="0" step="0.01" value={currentPrincipalOverride} onChange={(event) => setCurrentPrincipalOverride(event.target.value)} placeholder={derivedOpeningPrincipal == null ? "Necesario si no se puede calcular" : `Calculado: ${derivedOpeningPrincipal.toFixed(2)}`} className="mt-1 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2.5 font-normal text-slate-900" /><span className="mt-1 block text-xs font-normal text-indigo-800">Si lo dejas vacío, usamos el cálculo seguro del cronograma. La cuota inicial no se resta dos veces.</span></label></div>}
                {onboardingMode && <div className="rounded-xl border border-indigo-200 bg-white p-4"><p className="text-xs text-slate-500">Capital con el que empezará Caja Familiar</p><p className="text-xl font-black text-indigo-950">{money(effectiveOpeningPrincipal, defaults.currencyCode)}</p>{onboardingMode === "EXISTING_DEBT" && manualCurrentPrincipal == null && derivedOpeningPrincipal != null && <p className="mt-1 text-xs font-semibold text-indigo-700">Calculado desde principal financiado menos capital de cuotas pagadas; filas de cuota inicial/down payment quedan excluidas del descuento.</p>}</div>}
              </div>

              {review.warnings.length > 0 && <div className="space-y-2">{review.warnings.map((warning) => <p key={warning} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">{warning}</p>)}</div>}

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" /><div><p className="font-black text-emerald-950">Nada se ha guardado todavía</p><p className="mt-1 text-sm text-emerald-900">Al confirmar se creará en una sola operación la deuda, su contrato financiero, el cronograma y la trazabilidad del documento. No se crea ingreso, movimiento de caja ni pago histórico.</p></div></div></div>

              <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between"><button type="button" onClick={() => { setReview(null); setErrorMessage(null); }} className="rounded-xl px-4 py-2.5 font-bold text-slate-600 hover:bg-slate-100">Volver a analizar</button><div className="flex gap-3"><button type="button" onClick={onCancel} className="rounded-xl px-4 py-2.5 font-bold text-slate-600 hover:bg-slate-100">Cancelar</button><button type="button" onClick={() => void save()} disabled={saving || !onboardingMode || review.reconciliation.status === "inconsistent"} className="rounded-xl bg-emerald-600 px-5 py-2.5 font-black text-white shadow hover:bg-emerald-700 disabled:opacity-50">{saving ? "CREANDO..." : "CONFIRMAR Y CREAR DEUDA"}</button></div></div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
