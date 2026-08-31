import { useEffect, useRef, useState } from "react";
import { Check, FileSearch, LoaderCircle, Sparkles, Upload, X } from "lucide-react";
import type { BankDocumentExtraction } from "../utils/bankDocumentExtraction.js";
import { normalizeBankDocumentExtraction } from "../utils/bankDocumentExtraction.js";
import { mergeBankDocumentExtractions } from "../utils/bankDocumentExtraction.js";
import { financialValidation } from "../utils/bankDocumentFinancialValidation.js";
import type { BankFinancialValidationResult } from "../utils/bankDocumentFinancialValidation.js";
import { parseDebtScheduleFile } from "../utils/debtScheduleFileParser.js";
import { uploadAndAnalyzeBankDocuments, type BankDocumentImportFile } from "../services/bankDocumentImport.js";
import { fetchBankDocumentCapabilities } from "../services/bankDocumentCapabilities.js";

type ImportStage = "idle" | "uploading" | "analyzing" | "validating" | "ready" | "error";

interface BankDocumentImportPanelProps {
  onExtractionReady: (extraction: BankDocumentExtraction, result: BankFinancialValidationResult) => void;
}

const ACCEPT = ".pdf,.xlsx,.xls,.csv,.tsv,.txt,.jpg,.jpeg,.png,.webp";
const STRUCTURED_EXTENSIONS = new Set(["xlsx", "xls", "csv", "tsv", "txt"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

function extension(fileName: string): string {
  return fileName.toLowerCase().split(".").pop() ?? "";
}

function mediaType(file: File): string {
  const ext = extension(file.name);
  const byExtension: Record<string, string> = {
    pdf: "application/pdf",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    txt: "text/plain",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  // Browsers often report CSV/TSV/XLS files as application/octet-stream or
  // text/plain. The extension is the safer source for the server allowlist.
  return byExtension[ext] ?? file.type;
}

async function validateImageFile(file: File): Promise<string | null> {
  if (!IMAGE_EXTENSIONS.has(extension(file.name)) || typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const pixels = bitmap.width * bitmap.height;
    bitmap.close();
    if (pixels < 400 * 400) return "La fotografía tiene una resolución muy baja. Toma el documento completo con buena luz y sin reflejos.";
    return null;
  } catch {
    return "No pudimos abrir la fotografía. Verifica que el archivo no esté corrupto.";
  }
}

export function BankDocumentImportPanel({ onExtractionReady }: BankDocumentImportPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [stage, setStage] = useState<ImportStage>("idle");
  const [files, setFiles] = useState<BankDocumentImportFile[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [resultSummary, setResultSummary] = useState<string | null>(null);
  const [integratedAiAvailable, setIntegratedAiAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void fetchBankDocumentCapabilities().then((capabilities) => {
      if (active) setIntegratedAiAvailable(capabilities.integratedAiAvailable);
    });
    return () => { active = false; };
  }, []);

  async function handleFiles(selected: FileList | null) {
    if (!selected || selected.length === 0 || stage === "uploading" || stage === "analyzing") return;
    const nextFiles = Array.from(selected).map((file) => ({ file, fileName: file.name, mediaType: mediaType(file), size: file.size }));
    if (nextFiles.length > 8) {
      setStage("error");
      setMessage("Puedes analizar hasta 8 documentos por importación.");
      return;
    }
    if (nextFiles.some((file) => file.size <= 0 || file.size > 20 * 1024 * 1024)) {
      setStage("error");
      setMessage("Cada documento debe pesar más de 0 bytes y hasta 20 MB.");
      return;
    }
    for (const file of nextFiles) {
      const imageError = await validateImageFile(file.file);
      if (imageError) {
        setStage("error");
        setMessage(imageError);
        return;
      }
    }
    setFiles(nextFiles);
    setMessage(null);
    setResultSummary(null);
    try {
      const localResults = [] as Array<{ file: BankDocumentImportFile; result: ReturnType<typeof parseDebtScheduleFile> }>;
      for (const file of nextFiles) {
        if (!STRUCTURED_EXTENSIONS.has(extension(file.fileName))) break;
        localResults.push({ file, result: parseDebtScheduleFile(await file.file.arrayBuffer()) });
      }
      if (localResults.length === nextFiles.length && localResults.every(({ result }) => result.valid)) {
        setStage("validating");
        const normalized = localResults.map(({ file, result }, index) => normalizeBankDocumentExtraction({
          documents: [{ index, fileName: file.fileName, mediaType: extension(file.fileName) }],
          firstDueDate: result.firstDueDate,
          termInstallments: result.rows.at(-1)?.contractualInstallmentNumber ?? result.rows.length,
          regularInstallmentAmount: result.rows[0]?.expectedAmount ?? null,
          totalContractAmount: result.totalContractSum,
          totalInterest: result.totalInterest,
          totalInsurance: result.totalInsurance,
          totalFees: result.totalFees,
          schedule: result.rows.map((row) => ({
            contractualInstallmentNumber: row.contractualInstallmentNumber,
            dueDate: row.dueDate,
            principal: row.expectedPrincipal,
            interest: row.expectedInterest,
            insurance: row.expectedInsurance,
            fees: row.expectedFees,
            total: row.expectedAmount,
            reportedBalance: row.reportedBalance ?? null,
          })),
        }));
        if (normalized.some((item) => !item.valid)) throw new Error("DOCUMENT_EXTRACTION_INVALID");
        const merged = mergeBankDocumentExtractions(normalized.map((item) => item.value));
        const validation = financialValidation(merged);
        setStage("ready");
        setResultSummary(`Cronograma estructurado leído localmente: ${merged.schedule.length} cuotas. No se consumió IA.`);
        onExtractionReady(merged, validation);
        return;
      }

      setStage("uploading");
      const controller = new AbortController();
      abortRef.current = controller;
      const analyzed = await uploadAndAnalyzeBankDocuments(nextFiles, (uploaded, total) => {
        setMessage(`Subiendo documento ${uploaded} de ${total}...`);
        if (uploaded === total) setStage("analyzing");
      }, controller.signal);
      setStage("validating");
      // The API response predates the client-only continuity classification;
      // recompute the pure financial result locally so both import paths share
      // the same contractual-authority and cut-off policy.
      onExtractionReady(analyzed.extraction, financialValidation(analyzed.extraction));
      setStage("ready");
      setResultSummary(analyzed.extraction.schedule.length > 0
        ? `Encontramos ${analyzed.extraction.schedule.length} cuotas y comprobamos los cálculos antes de mostrarte el resultado.`
        : "Datos contractuales extraídos y listos para revisión.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStage("idle");
        setMessage("Importación cancelada. Los archivos temporales se eliminarán automáticamente.");
        return;
      }
      setStage("error");
      setMessage(error instanceof Error && error.message !== "DOCUMENT_AI_FAILED" ? error.message : "No pudimos leer correctamente este documento.");
    } finally {
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
    if (stage === "uploading" || stage === "analyzing" || stage === "validating") setMessage("Cancelando importación...");
  }

  function clear() {
    setFiles([]);
    setStage("idle");
    setMessage(null);
    setResultSummary(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const busy = stage === "uploading" || stage === "analyzing" || stage === "validating";
  return (
    <section className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-4 shadow-sm" aria-labelledby="bank-document-import-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileSearch className="h-5 w-5 text-indigo-700" aria-hidden="true" />
            <h3 id="bank-document-import-title" className="text-sm font-black uppercase tracking-wide text-indigo-950">Importar automáticamente con IA</h3>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-indigo-900">Sube contrato.pdf, cronograma.xlsx, una foto o varios documentos juntos. Primero intentamos leer Excel/CSV sin IA; los PDF y fotos pasan por un análisis privado con revisión matemática.</p>
          {integratedAiAvailable === false && <p className="mt-2 text-xs font-bold text-amber-800">IA integrada no configurada. Disponible cuando configures la API. Puedes analizar el documento con una IA externa mientras tanto.</p>}
          {integratedAiAvailable === true && <p className="mt-2 text-xs font-bold text-emerald-800">IA integrada configurada para análisis automático.</p>}
        </div>
        <Sparkles className="hidden h-8 w-8 text-indigo-300 sm:block" aria-hidden="true" />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-black text-white shadow hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {busy ? (stage === "uploading" ? "Subiendo..." : stage === "analyzing" ? "Analizando..." : "Comprobando cálculos...") : "Elegir documentos"}
        </button>
        {busy ? <button type="button" onClick={cancel} className="inline-flex items-center gap-1 rounded-xl border border-amber-300 bg-white px-3 py-2.5 text-xs font-bold text-amber-800 hover:bg-amber-50"><X className="h-4 w-4" /> Cancelar</button> : files.length > 0 && <button type="button" onClick={clear} className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"><X className="h-4 w-4" /> Limpiar</button>}
        <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(event) => void handleFiles(event.target.files)} />
      </div>
      <p className="mt-3 text-[11px] font-semibold text-slate-500">PDF · XLSX · XLS · CSV · TSV · TXT · JPG · JPEG · PNG · WEBP · hasta 8 archivos, 20 MB cada uno.</p>
      <p className="mt-1 text-[11px] text-slate-500">Para fotos: encuadra el documento completo, con buena luz y sin reflejos.</p>
      {files.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{files.map((file) => <span key={`${file.fileName}-${file.size}`} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">{file.fileName}</span>)}</div>}
      {message && <p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900">{message}</p>}
      {resultSummary && <p role="status" className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-900"><Check className="mt-0.5 h-4 w-4 shrink-0" />{resultSummary}</p>}
    </section>
  );
}
