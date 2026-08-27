export const BANK_DOCUMENT_BUCKET = "bank-document-imports";
export const MAX_BANK_DOCUMENT_FILES = 8;
export const MAX_BANK_DOCUMENT_BYTES = 20 * 1024 * 1024;

export const ALLOWED_BANK_DOCUMENT_EXTENSIONS = new Set(["pdf", "xlsx", "xls", "csv", "tsv", "txt", "jpg", "jpeg", "png", "webp"]);
export const ALLOWED_BANK_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/tab-separated-values",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function readBearerToken(headers: Record<string, string | string[] | undefined>): string | null {
  const authorization = headers.authorization ?? headers.Authorization;
  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token ? token : null;
}

export function fileExtension(fileName: string): string {
  return fileName.toLowerCase().split(".").pop() ?? "";
}

export function isAllowedBankDocument(fileName: string, mediaType: string, size: number): boolean {
  return size > 0 && size <= MAX_BANK_DOCUMENT_BYTES && ALLOWED_BANK_DOCUMENT_EXTENSIONS.has(fileExtension(fileName)) && ALLOWED_BANK_DOCUMENT_MIME_TYPES.has(mediaType);
}

export function safeStorageFileName(fileName: string, randomPart: string): string {
  const extension = fileExtension(fileName);
  // The original filename may contain PII. Keep only the allow-listed
  // extension and an opaque request-scoped suffix in the persisted path.
  return `document-${randomPart}.${extension}`;
}

export function isOwnedBankDocumentPath(path: string, householdId: string, userId: string, importId: string): boolean {
  const parts = path.split("/");
  return parts.length === 4
    && parts[0] === householdId
    && parts[1] === userId
    && parts[2] === importId
    && parts[3].length > 0
    && !parts.some((part) => part === "" || part === "." || part === "..")
    && !path.includes("\\");
}

export function parseJsonBody(body: unknown): Record<string, unknown> | null {
  if (body && typeof body === "object") return body as Record<string, unknown>;
  if (typeof body !== "string" || body.length > 100_000) return null;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function safeErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) return error.message;
  return "DOCUMENT_AI_FAILED";
}
