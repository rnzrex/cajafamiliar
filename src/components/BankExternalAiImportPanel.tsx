import { useMemo, useState } from "react";
import { Clipboard, FileText, Sparkles, Trash2 } from "lucide-react";
import type { BankDocumentExtraction } from "../utils/bankDocumentExtraction.js";
import { buildBankExternalAiPrompt, normalizeBankExternalAiResponse, type BankExternalAiImportResult } from "../utils/bankExternalAiImport.js";
import type { BankFinancialValidationResult } from "../utils/bankDocumentFinancialValidation.js";
import { evaluateBankDocumentCompleteness, type BankDocumentCompletenessContext } from "../utils/bankDocumentCompleteness.js";
import { BankDocumentReviewPanel } from "./BankDocumentReviewPanel.js";

interface BankExternalAiImportPanelProps {
  onExtractionReady: (extraction: BankDocumentExtraction, result: BankFinancialValidationResult) => void;
  setToast: (toast: { message: string; type: "success" | "error" }) => void;
  completenessContext?: BankDocumentCompletenessContext;
}

export function BankExternalAiImportPanel({ onExtractionReady, setToast, completenessContext = {} }: BankExternalAiImportPanelProps) {
  const [responseText, setResponseText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<BankExternalAiImportResult | null>(null);
  const prompt = useMemo(() => buildBankExternalAiPrompt(), []);

  async function copyPrompt() {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      const unavailable = "Tu navegador no permite copiar automáticamente. Selecciona y copia el prompt manualmente.";
      setMessage(unavailable);
      setToast({ message: unavailable, type: "error" });
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      const copied = "Prompt copiado. Pégalo junto con tu contrato en la IA que prefieras.";
      setMessage(copied);
      setToast({ message: copied, type: "success" });
    } catch {
      const failed = "No pudimos copiar el prompt. Selecciónalo y cópialo manualmente.";
      setMessage(failed);
      setToast({ message: failed, type: "error" });
    }
  }

  function interpretResponse() {
    const result = normalizeBankExternalAiResponse(responseText);
    if (!result.ok) {
      setMessage(result.message);
      setToast({ message: result.message, type: "error" });
      return;
    }
    setImportResult(result);
    onExtractionReady(result.extraction, result.validation);
    const status = result.validation.reconciliation?.status;
    const statusLabel = status === "exact" ? "validación matemática exacta" : status === "within_tolerance" ? "validación dentro de tolerancia" : status === "inconsistent" ? "REVISAR: la validación matemática es inconsistente" : "revisión pendiente por datos insuficientes";
    const ready = `Respuesta interpretada con IA externa: ${statusLabel}. Revisa antes de guardar.`;
    setMessage(ready);
    setToast({ message: ready, type: status === "inconsistent" ? "error" : "success" });
  }

  function clear() {
    setResponseText("");
    setMessage(null);
    setImportResult(null);
  }

  return (
    <section className="rounded-2xl border-2 border-indigo-300 bg-gradient-to-br from-indigo-50 via-white to-slate-50 p-5 shadow-sm" aria-labelledby="bank-external-ai-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-700" aria-hidden="true" />
            <h3 id="bank-external-ai-title" className="text-sm font-black uppercase tracking-wide text-indigo-950">Analizar con IA externa</h3>
            <span className="rounded-full bg-indigo-600 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-white">Recomendado</span>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-indigo-950">Usa ChatGPT, Gemini, Claude u otra IA compatible. Este método no consume créditos de IA de Caja Familiar.</p>
        </div>
        <FileText className="hidden h-8 w-8 text-indigo-300 sm:block" aria-hidden="true" />
      </div>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
        <p className="font-black">Tu contrato puede contener información personal y financiera.</p>
        <p className="mt-1">La IA externa que utilices tendrá sus propias políticas y límites. Si puedes, oculta DNI, números de cuenta y otros identificadores antes de subirlo.</p>
        <p className="mt-2 font-bold">Este método no consume créditos de IA de Caja Familiar.</p>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-black uppercase tracking-wide text-slate-700">Prompt oficial · CAJA_FAMILIAR_BANK_DOCUMENT_V1</p>
          <button type="button" onClick={() => void copyPrompt()} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-black text-white shadow hover:bg-indigo-700">
            <Clipboard className="h-4 w-4" /> COPIAR PROMPT PARA IA
          </button>
        </div>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-3 text-[11px] leading-5 text-slate-700">{prompt}</pre>
      </div>

      <div className="mt-4 space-y-2">
        <label htmlFor="external-ai-response" className="block text-xs font-black uppercase tracking-wide text-slate-700">Pega la respuesta completa de la IA externa</label>
        <textarea
          id="external-ai-response"
          aria-label="Respuesta de la IA externa"
          value={responseText}
          onChange={(event) => { setResponseText(event.target.value); setImportResult(null); }}
          rows={8}
          placeholder='{"schema":"CAJA_FAMILIAR_BANK_DOCUMENT_V1","extraction":{...}}'
          className="w-full rounded-xl border border-slate-300 bg-white p-3 font-mono text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
        />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={clear} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-slate-50">
            <Trash2 className="h-4 w-4" /> LIMPIAR
          </button>
          <button type="button" onClick={interpretResponse} disabled={!responseText.trim()} className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-black text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">INTERPRETAR RESPUESTA</button>
        </div>
        <p className="text-[11px] text-slate-500">La respuesta se valida y normaliza localmente. No se guarda automáticamente: primero debes revisar y confirmar.</p>
      </div>
      {message && <p role="status" className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs font-bold text-indigo-950">{message}</p>}
      {importResult && (
        <div className="mt-4">
          <BankDocumentReviewPanel
            extraction={importResult.extraction}
            validation={importResult.validation}
            completeness={evaluateBankDocumentCompleteness(importResult.extraction, importResult.validation, completenessContext)}
            sourceLabel="Analizado con IA externa"
          />
        </div>
      )}
    </section>
  );
}
