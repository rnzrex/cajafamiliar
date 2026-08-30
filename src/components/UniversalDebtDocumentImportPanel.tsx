import { useState } from "react";
import type { Debt, DebtFinancingContract, DebtScheduleInstallmentInput } from "../types";
import { createDebtDocumentImportJob, importDebtScheduleUniversal, saveDebtFinancingContract } from "../services/dataRepository";
import { makeUuid } from "../utils/storage";
import { localDateString } from "../utils/date";
import { formatDebtMoney } from "../utils/debtPresentation";
import { UNIVERSAL_EXTERNAL_AI_PROMPT, mapUniversalDocumentRowsToSchedule, parseUniversalDebtExternalAiResponse, type UniversalDebtDocumentImportReview } from "../utils/universalDebtDocumentImport";

interface UniversalDebtDocumentImportPanelProps {
  debt: Debt;
  expectedPrincipal?: number | null;
  canWriteDebt: boolean;
  setToast: (toast: { message: string; type: "success" | "error" }) => void;
  onSaved: () => Promise<void> | void;
}

function pick(value: Record<string, unknown>, camel: string, snake: string): unknown {
  return value[camel] ?? value[snake] ?? null;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
  return value == null || value === "" ? null : String(value);
}

function canonicalRateType(value: unknown): DebtFinancingContract["interestRateType"] {
  const normalized = String(value ?? "unknown").toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "tna" || normalized === "nominal_annual" || normalized === "nominal_annual_simple") return "nominal_annual_simple";
  if (normalized === "tea" || normalized === "effective_annual") return "effective_annual";
  if (normalized === "periodic" || normalized === "effective_periodic") return "effective_periodic";
  if (normalized === "contract_schedule_only" || normalized === "contract_schedule") return "contract_schedule";
  if (normalized === "manual") return "manual";
  return "unknown";
}

function canonicalDayCount(value: unknown): DebtFinancingContract["dayCountBasis"] {
  const normalized = String(value ?? "unknown").toLowerCase().replace(/[\s/-]+/g, "_");
  if (normalized.includes("360")) return "actual_days_360";
  if (normalized.includes("365")) return "actual_days_365";
  return "unknown";
}

function contractFromReview(review: UniversalDebtDocumentImportReview, debt: Debt): Partial<DebtFinancingContract> {
  const raw = review.contract;
  const structure = pick(raw, "repaymentStructure", "repayment_structure");
  const authority = review.normalized.authority;
  return {
    contractAuthority: authority,
    principalBasis: (pick(raw, "principalBasis", "principal_basis") as DebtFinancingContract["principalBasis"] | null) ?? "unknown",
    assetPrice: numberOrNull(pick(raw, "assetPrice", "asset_price")),
    downPaymentAmount: numberOrNull(pick(raw, "downPaymentAmount", "down_payment_amount")),
    scheduledPrincipalAmount: numberOrNull(pick(raw, "scheduledPrincipalAmount", "scheduled_principal_amount")),
    financedPrincipalAmount: numberOrNull(pick(raw, "financedPrincipalAmount", "financed_principal_amount")),
    openingPrincipalAmount: numberOrNull(pick(raw, "openingPrincipalAmount", "opening_principal_amount")) ?? debt.openingPrincipalBalance,
    repaymentStructure: structure === "open_ended" || structure === "fixed_schedule" || structure === "unknown" ? structure : review.normalized.rows.length > 0 ? "fixed_schedule" : debt.repaymentStructure ?? "unknown",
    amortizationMethod: (pick(raw, "amortizationMethod", "amortization_method") as DebtFinancingContract["amortizationMethod"] | null) ?? "unknown",
    installmentAmountMode: (pick(raw, "installmentAmountMode", "installment_amount_mode") as DebtFinancingContract["installmentAmountMode"] | null) ?? debt.installmentAmountMode,
    paymentFrequency: (pick(raw, "paymentFrequency", "payment_frequency") as DebtFinancingContract["paymentFrequency"] | null) ?? debt.paymentFrequency ?? null,
    customFrequencyDays: numberOrNull(pick(raw, "customFrequencyDays", "custom_frequency_days")),
    firstDueDate: stringOrNull(pick(raw, "firstDueDate", "first_due_date")),
    interestRateType: canonicalRateType(pick(raw, "interestRateType", "interest_rate_type")),
    interestRatePercent: numberOrNull(pick(raw, "interestRatePercent", "interest_rate_percent")),
    interestRateBasis: stringOrNull(pick(raw, "interestRateBasis", "interest_rate_basis")),
    dayCountBasis: canonicalDayCount(pick(raw, "dayCountBasis", "day_count_basis")),
    feeRuleType: (pick(raw, "feeRuleType", "fee_rule_type") as DebtFinancingContract["feeRuleType"] | null) ?? "unknown",
    feeRule: (pick(raw, "feeRule", "fee_rule") as Record<string, unknown> | null) ?? {},
    prepaymentTerms: (pick(raw, "prepaymentTerms", "prepayment_terms") as Record<string, unknown> | null) ?? {},
    authorityNotes: authority === "official_noncontractual" ? "Proforma/documento oficial no contractual; requiere contrato firmado o cronograma contractual que lo superseda." : "Importado desde IA externa; revisar evidencia contra el documento original.",
  };
}

export function UniversalDebtDocumentImportPanel({ debt, expectedPrincipal = null, canWriteDebt, setToast, onSaved }: UniversalDebtDocumentImportPanelProps) {
  const [responseText, setResponseText] = useState("");
  const [review, setReview] = useState<UniversalDebtDocumentImportReview | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importEventId] = useState(() => makeUuid());

  const analyze = () => {
    try {
      setErrorMessage(null);
      setReview(parseUniversalDebtExternalAiResponse(responseText, expectedPrincipal));
    } catch (error) {
      setReview(null);
      setErrorMessage(error instanceof Error ? error.message : "No se pudo interpretar el JSON V2.");
    }
  };

  const confirmImport = async () => {
    if (!review || review.normalized.rows.length === 0 || !review.scheduleSource) {
      setErrorMessage("El JSON debe contener filas con una fuente revisable (contractual, reconstruida, estimada o manual).");
      return;
    }
    if (!canWriteDebt || (typeof navigator !== "undefined" && !navigator.onLine)) {
      setToast({ message: "La importación universal requiere conexión y permisos de escritura.", type: "error" });
      return;
    }
    setSaving(true);
    try {
      const schedule: DebtScheduleInstallmentInput[] = mapUniversalDocumentRowsToSchedule(review);
      if (schedule.length === 0) throw new Error("No hay filas con fecha de vencimiento para cargar.");
      await saveDebtFinancingContract({ debtId: debt.id, contract: contractFromReview(review, debt) });
      await importDebtScheduleUniversal({
        debtId: debt.id,
        eventId: importEventId,
        eventDate: localDateString(new Date()),
        scheduleInstallments: schedule,
        scheduleSource: review.scheduleSource,
        scheduleNotes: review.warnings.join(" ") || null,
      });
      await createDebtDocumentImportJob({
        debtId: debt.id,
        documentKind: review.normalized.kind === "refinance" ? "refinance" : "schedule",
        documentAuthority: review.normalized.authority,
        provider: "external_ai",
        model: null,
        fileCount: 0,
        storagePaths: [],
        normalizedMetadata: {
          schema: review.normalized.schema,
          authority: review.normalized.authority,
          authorityEvidence: review.authorityEvidence,
          isAuthoritative: review.isAuthoritative,
          reconciliation: review.reconciliation,
          rowCount: schedule.length,
          warnings: review.warnings,
          rows: review.normalized.rows.map((row) => ({ sourceRowNumber: row.sourceRowNumber, contractualInstallmentNumber: row.contractualInstallmentNumber, dueDate: row.dueDate, expectedAmount: row.expectedAmount, expectedPrincipal: row.expectedPrincipal, expectedInterest: row.expectedInterest, expectedFees: row.expectedFees, expectedInsurance: row.expectedInsurance, expectedTaxes: row.expectedTaxes, rowRole: row.rowRole, phase: row.phase })),
        },
      });
      setToast({ message: review.normalized.authority === "official_noncontractual" ? "Proforma importada como documento no contractual; el cronograma queda por confirmar." : `Cronograma universal importado: ${schedule.length} filas.`, type: "success" });
      await onSaved();
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : "No se pudo guardar la importación universal.", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const authorityLabel = review?.normalized.authority === "contractual"
    ? "CRONOGRAMA CONTRACTUAL / AUTORIZADO"
    : review?.normalized.authority === "official_noncontractual"
      ? "PROFORMA / NO CONTRACTUAL"
      : review?.normalized.authority === "user_reported"
        ? "REPORTADO POR EL USUARIO / REVISAR"
        : review?.normalized.authority === "estimated"
          ? "ESTIMADO / NO AUTORIZADO"
          : "AUTORIDAD POR CONFIRMAR";

  return (
    <section className="rounded-2xl border-2 border-violet-200 bg-violet-50/50 p-5 space-y-4" data-testid="universal-document-import-panel">
      <div>
        <p className="text-xs font-black uppercase tracking-wider text-violet-700">IMPORTACIÓN UNIVERSAL DE DOCUMENTOS V2</p>
        <h3 className="mt-1 text-lg font-black text-violet-950">Contrato, proforma y cronograma de cualquier acreedor</h3>
        <p className="mt-1 text-sm text-violet-900">Usa una IA externa solo para extraer datos. Caja Familiar normaliza, reconcilia y te pide confirmar antes de guardar.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void navigator.clipboard?.writeText(UNIVERSAL_EXTERNAL_AI_PROMPT)} className="rounded-xl border border-violet-300 bg-white px-4 py-2 text-xs font-black text-violet-800 hover:bg-violet-100">COPIAR PROMPT V2</button>
        <span className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-800">Sin API key · PDF / imágenes / Excel / CSV / TSV / TXT</span>
      </div>
      <textarea aria-label="Respuesta JSON de IA externa V2" value={responseText} onChange={(event) => { setResponseText(event.target.value); setErrorMessage(null); }} rows={7} placeholder='Pega aquí el JSON CAJA_FAMILIAR_DEBT_DOCUMENT_V2 devuelto por ChatGPT, Gemini, Claude u otra IA.' className="w-full rounded-xl border border-violet-300 bg-white p-3 font-mono text-xs text-slate-900 focus:border-violet-600 focus:outline-none" />
      <button type="button" onClick={analyze} className="rounded-xl bg-violet-700 px-4 py-2 text-xs font-black text-white hover:bg-violet-800">ANALIZAR CON IA EXTERNA</button>
      {errorMessage && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-800">{errorMessage}</div>}
      {review && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-black text-slate-900">REVISIÓN ANTES DE GUARDAR</p><span className={`rounded-full px-3 py-1 text-[11px] font-black ${review.isAuthoritative ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{authorityLabel}</span></div>
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4"><div><p className="text-slate-500">Filas normalizadas</p><p className="font-black">{review.normalized.rows.length}</p></div><div><p className="text-slate-500">Filas cargables</p><p className="font-black">{mapUniversalDocumentRowsToSchedule(review).length}</p></div><div><p className="text-slate-500">Capital del documento</p><p className="font-black">{review.reconciliation.schedulePrincipal == null ? "POR CONFIRMAR" : formatDebtMoney(review.reconciliation.schedulePrincipal, debt.currencyCode)}</p></div><div><p className="text-slate-500">Reconciliación</p><p className="font-black">{review.reconciliation.status === "exact" || review.reconciliation.status === "within_tolerance" ? "EXACTA" : review.reconciliation.status === "insufficient_data" ? "POR CONFIRMAR" : "INCONSISTENTE"}</p></div></div>
          {review.warnings.map((warning) => <p key={warning} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">{warning}</p>)}
          <p className="text-xs font-semibold text-slate-700">Se cargarán todas las filas con fecha; las filas de resumen se conservan en la revisión y no se convierten en cuotas.</p>
          <button type="button" disabled={saving || review.reconciliation.status === "inconsistent"} onClick={() => void confirmImport()} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? "GUARDANDO CRONOGRAMA..." : "CONFIRMAR Y GUARDAR TODAS LAS FILAS"}</button>
        </div>
      )}
    </section>
  );
}
