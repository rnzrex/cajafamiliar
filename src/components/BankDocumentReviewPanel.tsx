import type { BankDocumentExtraction } from "../utils/bankDocumentExtraction.js";
import { reviewFieldStatus } from "../utils/bankDocumentExtraction.js";
import type { BankFinancialValidationResult } from "../utils/bankDocumentFinancialValidation.js";
import type { BankDocumentCompletenessIssue, BankDocumentCompletenessResult } from "../utils/bankDocumentCompleteness.js";
import { BankSchedulePreview } from "./BankSchedulePreview.js";

interface BankDocumentReviewPanelProps {
  extraction: BankDocumentExtraction;
  validation: BankFinancialValidationResult;
  completeness: BankDocumentCompletenessResult;
  sourceLabel?: string;
}

function amount(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function issueList(issues: BankDocumentCompletenessIssue[], tone: "required" | "review" | "optional") {
  if (issues.length === 0) return null;
  const styles = tone === "required"
    ? "border-red-200 bg-red-50 text-red-950"
    : tone === "review"
      ? "border-amber-200 bg-amber-50 text-amber-950"
      : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <ul className="space-y-2">
      {issues.map((item) => (
        <li key={`${item.code}-${item.field}-${item.message}`} className={`rounded-xl border p-3 ${styles}`}>
          <p className="text-xs font-black uppercase tracking-wide">{item.title}</p>
          <p className="mt-1 text-xs">{item.message}</p>
          <p className="mt-1 text-xs font-bold">Qué buscar: {item.action}</p>
        </li>
      ))}
    </ul>
  );
}

function coverageCopy(completeness: BankDocumentCompletenessResult): { title: string; message: string; className: string } {
  const coverage = completeness.scheduleCoverage;
  if (coverage.status === "full") {
    return { title: "CRONOGRAMA COMPLETO", message: `Encontramos las ${coverage.foundInstallments} de ${coverage.expectedInstallments} cuotas.`, className: "border-emerald-200 bg-emerald-50 text-emerald-950" };
  }
  if (coverage.status === "partial" && coverage.pendingOnly) {
    return { title: "CRONOGRAMA PENDIENTE", message: `Encontramos todas las cuotas pendientes: ${coverage.firstContractualInstallment} a ${coverage.lastContractualInstallment}.`, className: "border-blue-200 bg-blue-50 text-blue-950" };
  }
  if (coverage.status === "partial") {
    return { title: "CRONOGRAMA PARCIAL", message: `Encontramos ${coverage.foundInstallments} de ${coverage.expectedInstallments ?? "las"} cuotas.`, className: "border-amber-200 bg-amber-50 text-amber-950" };
  }
  if (coverage.status === "not_found") {
    return { title: "NO ENCONTRAMOS EL CRONOGRAMA", message: coverage.expectedInstallments != null ? `El contrato indica ${coverage.expectedInstallments} cuotas, pero no recibimos filas del cronograma.` : "No encontramos filas contractuales del cronograma.", className: "border-red-200 bg-red-50 text-red-950" };
  }
  return { title: "CRONOGRAMA DETECTADO", message: `Encontramos ${coverage.foundInstallments} filas; falta confirmar el plazo total.`, className: "border-amber-200 bg-amber-50 text-amber-950" };
}

function FieldBadge({ label, field, extraction }: { label: string; field: string; extraction: BankDocumentExtraction }) {
  const status = field === "schedule" && extraction.schedule.length > 0 ? "CONFIRMADO" : reviewFieldStatus(extraction, field);
  const labelMap = { confirmed: "CONFIRMADO", review: "REVISAR", not_found: "NO ENCONTRADO" } as const;
  const className = status === "confirmed"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : status === "review"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-slate-200 bg-white text-slate-500";
  return <span className={`rounded-lg border px-2 py-1.5 text-[11px] font-black ${className}`}>{label}: {status === "CONFIRMADO" ? status : labelMap[status]}</span>;
}

export function BankDocumentReviewPanel({ extraction, validation, completeness, sourceLabel }: BankDocumentReviewPanelProps) {
  const coverage = coverageCopy(completeness);
  const reconciliationStatus = validation.reconciliation?.status;
  const source = validation.scheduleSource === "contractual" ? "contractual" : validation.scheduleSource === "reconstructed" ? "reconstructed" : "estimated";
  return (
    <section className="space-y-4 rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm" aria-labelledby="bank-document-analysis-result">
      <div>
        <p id="bank-document-analysis-result" className="text-sm font-black uppercase tracking-wide text-indigo-950">Resultado del análisis</p>
        <p className="mt-1 text-xs text-slate-600">La confianza de la IA no sustituye la comprobación matemática ni tu confirmación.</p>
        {sourceLabel && <p className="mt-2 inline-flex rounded-full border border-indigo-300 bg-indigo-50 px-2 py-1 text-[11px] font-black uppercase tracking-wide text-indigo-800">{sourceLabel}</p>}
      </div>

      <section aria-labelledby="bank-document-found-title" className="space-y-3">
        <p id="bank-document-found-title" className="text-xs font-black uppercase tracking-wide text-slate-700">Datos encontrados</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <FieldBadge label="Banco" field="lenderName" extraction={extraction} />
          <FieldBadge label="Moneda" field="currencyCode" extraction={extraction} />
          <FieldBadge label="Monto financiado" field="financedAmount" extraction={extraction} />
          <FieldBadge label="TEA" field="teaPercent" extraction={extraction} />
          <FieldBadge label="Cronograma" field="schedule" extraction={extraction} />
          <FieldBadge label="Saldo reportado" field="reportedBalance" extraction={extraction} />
        </div>
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 sm:grid-cols-4">
          <span>Banco: <strong>{extraction.lenderName ?? "—"}</strong></span>
          <span>Moneda: <strong>{extraction.currencyCode ?? "—"}</strong></span>
          <span>Principal: <strong>{amount(extraction.originalPrincipal ?? extraction.financedAmount)}</strong></span>
          <span>TEA: <strong>{extraction.teaPercent == null ? "—" : `${amount(extraction.teaPercent)}%`}</strong></span>
          <span>Seguro total: <strong>{amount(extraction.totalInsurance)}</strong></span>
          <span>Plazo: <strong>{extraction.termInstallments == null ? "—" : `${extraction.termInstallments} cuotas`}</strong></span>
          <span>Saldo reportado: <strong>{amount(extraction.reportedBalance.amount)}</strong></span>
          <span>Fuente: <strong>{source}</strong></span>
        </div>
      </section>

      <section aria-labelledby="bank-document-coverage-title" className={`rounded-xl border p-3 ${coverage.className}`}>
        <p id="bank-document-coverage-title" className="text-xs font-black uppercase tracking-wide">{coverage.title}</p>
        <p className="mt-1 text-sm font-bold">{coverage.message}</p>
        {coverage.title === "NO ENCONTRAMOS EL CRONOGRAMA" && <p className="mt-1 text-xs">Vuelve a ejecutar el prompt asegurándote de adjuntar todas las páginas del cronograma.</p>}
      </section>

      {extraction.schedule.length > 0 && (
        <section aria-labelledby="bank-document-schedule-preview-title" className="space-y-3">
          <div>
            <p id="bank-document-schedule-preview-title" className="text-xs font-black uppercase tracking-wide text-slate-700">Cronograma importado</p>
            <p className="mt-1 text-xs font-bold text-indigo-800">{extraction.schedule.length} cuotas detectadas e importadas</p>
          </div>
          <BankSchedulePreview rows={extraction.schedule} compact showBalance ariaLabel="Vista previa del cronograma importado" />
        </section>
      )}

      <section aria-labelledby="bank-document-missing-title" className="space-y-3">
        <div>
          <p id="bank-document-missing-title" className="text-xs font-black uppercase tracking-wide text-slate-700">Datos que faltan o necesitan revisión</p>
          {completeness.requiredIssues.length === 0 && <p className="mt-1 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-900">Tenemos la información necesaria para continuar.</p>}
        </div>
        {completeness.requiredIssues.length > 0 && <div><p className="mb-2 text-[11px] font-black uppercase text-red-700">Obligatorio antes de guardar</p>{issueList(completeness.requiredIssues, "required")}</div>}
        {completeness.reviewIssues.length > 0 && <div><p className="mb-2 text-[11px] font-black uppercase text-amber-700">Revisar</p>{issueList(completeness.reviewIssues, "review")}</div>}
        {completeness.optionalMissing.length > 0 && <details className="rounded-xl border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-[11px] font-black uppercase tracking-wide text-slate-600">Opcional · {completeness.optionalMissing.length}</summary><div className="mt-2">{issueList(completeness.optionalMissing, "optional")}</div></details>}
      </section>

      {reconciliationStatus && <p role="status" className="text-xs font-bold text-slate-700">Validación matemática: {reconciliationStatus === "exact" ? "exacta" : reconciliationStatus === "within_tolerance" ? "dentro de tolerancia" : reconciliationStatus === "inconsistent" ? "REVISAR" : "datos insuficientes"}. Fuente financiera: {source}.</p>}
    </section>
  );
}
