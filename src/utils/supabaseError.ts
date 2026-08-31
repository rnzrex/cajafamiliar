const GENERIC_SUPABASE_ERROR = "No se pudo completar la operación en Caja Familiar.";

const FRIENDLY_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "Necesitas una sesión activa para completar esta operación.",
  HOUSEHOLD_ACCESS_DENIED: "No tienes acceso al hogar seleccionado.",
  INVALID_DEBT_INPUT: "Revisa los datos principales de la deuda y vuelve a intentarlo.",
  INVALID_INSTALLMENTS: "Revisa las filas del cronograma: fechas, números y montos deben ser válidos.",
  INVALID_COLLATERALS: "Revisa los datos de las garantías antes de guardar.",
  INVALID_DEBT_SCHEDULE: "El cronograma no pudo validarse. Revisa sus filas e inténtalo de nuevo.",
  DEBT_ALREADY_EXISTS: "La deuda ya existe. Recarga la información antes de volver a intentarlo.",
  DEBT_DOCUMENT_ONBOARDING_ID_CONFLICT: "El identificador de esta deuda ya fue usado con otros datos.",
};

export interface SupabaseErrorLike {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  status?: unknown;
}

export interface NormalizedSupabaseError {
  message: string;
  referenceCode?: string;
}

export class SafeSupabaseError extends Error {
  readonly referenceCode?: string;

  constructor(normalized: NormalizedSupabaseError) {
    super(normalized.message);
    this.name = "SafeSupabaseError";
    this.referenceCode = normalized.referenceCode;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function findKnownCode(error: SupabaseErrorLike): string | null {
  const candidates = [safeString(error.code), safeString(error.message)];
  return candidates
    .flatMap((candidate) => candidate ? Object.keys(FRIENDLY_MESSAGES).filter((code) => candidate.includes(code)) : [])
    .sort((a, b) => b.length - a.length)[0] ?? null;
}

function safeReferenceCode(error: SupabaseErrorLike): string | undefined {
  const code = safeString(error.code);
  if (!code || Object.prototype.hasOwnProperty.call(FRIENDLY_MESSAGES, code)) return undefined;
  return /^[A-Z0-9_]{3,32}$/.test(code) ? code : undefined;
}

export function normalizeSupabaseError(error: unknown): NormalizedSupabaseError {
  if (error instanceof SafeSupabaseError) {
    return { message: error.message, referenceCode: error.referenceCode };
  }

  const candidate = isRecord(error) ? error as SupabaseErrorLike : {};
  const knownCode = findKnownCode(candidate);
  if (knownCode) return { message: FRIENDLY_MESSAGES[knownCode] };

  const referenceCode = safeReferenceCode(candidate);
  return {
    message: referenceCode ? `${GENERIC_SUPABASE_ERROR} Código de referencia: ${referenceCode}.` : GENERIC_SUPABASE_ERROR,
    referenceCode,
  };
}

export function toSafeSupabaseError(error: unknown): SafeSupabaseError {
  return new SafeSupabaseError(normalizeSupabaseError(error));
}

export function getSafeSupabaseErrorMessage(error: unknown, fallback = GENERIC_SUPABASE_ERROR): string {
  if (error instanceof SafeSupabaseError) return error.message;
  if (isRecord(error) && ("code" in error || "message" in error || "details" in error || "hint" in error || "status" in error)) {
    return normalizeSupabaseError(error).message;
  }
  return fallback;
}
