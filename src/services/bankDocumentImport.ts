import { householdId, isSupabaseConfigured, supabase } from "./supabaseClient.js";
import type { BankDocumentAnalyzeResult } from "../../api/bank-document/analyze.js";

export interface BankDocumentImportFile {
  file: File;
  fileName: string;
  mediaType: string;
  size: number;
}

export class BankDocumentImportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BankDocumentImportError";
    this.code = code;
  }
}

async function accessToken(): Promise<string> {
  if (!isSupabaseConfigured || !supabase) throw new BankDocumentImportError("SUPABASE_NOT_CONFIGURED", "El análisis inteligente aún no está configurado.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new BankDocumentImportError("AUTH_REQUIRED", "Inicia sesión para analizar documentos.");
  return data.session.access_token;
}

async function apiJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const token = await accessToken();
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  });
  const parsed = await response.json().catch(() => ({})) as { error?: string; message?: string };
  if (!response.ok) throw new BankDocumentImportError(parsed.error ?? "DOCUMENT_AI_FAILED", parsed.message ?? "No pudimos leer correctamente este documento.");
  return parsed as T;
}

export async function createBankDocumentImportJob(files: BankDocumentImportFile[], signal?: AbortSignal): Promise<{ importId: string; paths: string[] }> {
  const result = await apiJson<{ ok: true; importId: string; paths: string[] }>("/api/bank-document/create-job", {
    householdId,
    files: files.map(({ fileName, mediaType, size }) => ({ fileName, mediaType, size })),
  }, signal);
  return { importId: result.importId, paths: result.paths };
}

export async function uploadAndAnalyzeBankDocuments(
  files: BankDocumentImportFile[],
  onProgress?: (uploaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<BankDocumentAnalyzeResult> {
  if (!supabase) throw new BankDocumentImportError("SUPABASE_NOT_CONFIGURED", "El análisis inteligente aún no está configurado.");
  const job = await createBankDocumentImportJob(files, signal);
  try {
    for (let index = 0; index < files.length; index++) {
      if (signal?.aborted) throw new DOMException("Importación cancelada", "AbortError");
      const { error } = await supabase.storage.from("bank-document-imports").upload(job.paths[index], files[index].file, {
        contentType: files[index].mediaType,
        upsert: false,
      });
      if (error) throw new BankDocumentImportError("DOCUMENT_UPLOAD_FAILED", "No pudimos subir uno de los documentos.");
      onProgress?.(index + 1, files.length);
    }
  } catch (error) {
    await apiJson<{ ok: true }>("/api/bank-document/cancel-job", { importId: job.importId, householdId, storagePaths: job.paths }).catch(() => undefined);
    throw error;
  }
  return apiJson<BankDocumentAnalyzeResult>("/api/bank-document/analyze", {
    importId: job.importId,
    householdId,
    storagePaths: job.paths,
  }, signal);
}
