import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { BANK_DOCUMENT_BUCKET, isOwnedBankDocumentPath, readBearerToken } from "./bankDocumentSecurity.js";

export { BANK_DOCUMENT_BUCKET } from "./bankDocumentSecurity.js";

export interface BankDocumentServerEnvironment {
  supabaseUrl: string;
  serviceRoleKey: string;
  geminiApiKey: string | null;
  providerMode: "gemini" | "fake";
  model: string;
}

export class BankDocumentServerConfigurationError extends Error {
  constructor() {
    super("BANK_DOCUMENT_SERVER_NOT_CONFIGURED");
    this.name = "BankDocumentServerConfigurationError";
  }
}

export function readBankDocumentServerEnvironment(environment: Record<string, string | undefined> = process.env): BankDocumentServerEnvironment {
  const supabaseUrl = environment.SUPABASE_URL?.trim();
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const providerMode = environment.BANK_DOCUMENT_AI_PROVIDER === "fake" ? "fake" : "gemini";
  const geminiApiKey = environment.GEMINI_API_KEY?.trim() || null;
  if (!supabaseUrl || !serviceRoleKey) throw new BankDocumentServerConfigurationError();
  return {
    supabaseUrl,
    serviceRoleKey,
    geminiApiKey,
    providerMode,
    model: environment.BANK_DOCUMENT_AI_MODEL?.trim() || "gemini-3.5-flash-lite",
  };
}

export function createBankDocumentAdmin(environment: BankDocumentServerEnvironment): SupabaseClient {
  return createClient(environment.supabaseUrl, environment.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function authenticateBankDocumentRequest(
  admin: SupabaseClient,
  headers: Record<string, string | string[] | undefined>,
): Promise<User> {
  const token = readBearerToken(headers);
  if (!token) throw new Error("AUTH_REQUIRED");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Error("AUTH_REQUIRED");
  return data.user;
}

export async function assertHouseholdMembership(admin: SupabaseClient, householdId: string, userId: string): Promise<void> {
  const { data, error } = await admin
    .from("household_members")
    .select("household_id,user_id")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error("HOUSEHOLD_ACCESS_DENIED");
}

export function assertImportPathOwnership(paths: string[], householdId: string, userId: string, importId: string): void {
  if (paths.length === 0 || paths.length > 8 || paths.some((path) => !isOwnedBankDocumentPath(path, householdId, userId, importId))) {
    throw new Error("DOCUMENT_PATH_ACCESS_DENIED");
  }
}

export async function cleanupBankDocumentObjects(admin: SupabaseClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await admin.storage.from(BANK_DOCUMENT_BUCKET).remove(paths);
}

export function responseError(error: unknown): { status: number; body: { ok: false; error: string; message?: string } } {
  const code = error instanceof Error ? error.message : "DOCUMENT_AI_FAILED";
  if (code === "AUTH_REQUIRED") return { status: 401, body: { ok: false, error: code } };
  if (code === "HOUSEHOLD_ACCESS_DENIED" || code === "DOCUMENT_PATH_ACCESS_DENIED") return { status: 403, body: { ok: false, error: code } };
  if (code === "INVALID_DOCUMENT_INPUT" || code === "DOCUMENT_EXTRACTION_INVALID") return { status: 400, body: { ok: false, error: code } };
  if (code === "DOCUMENT_AI_COST_LIMIT") return { status: 413, body: { ok: false, error: code, message: "El documento es demasiado grande para analizarlo dentro del límite de costo configurado. Reduce páginas o divide el expediente." } };
  if (code === "AI_NOT_CONFIGURED") return { status: 503, body: { ok: false, error: code, message: "El análisis inteligente aún no está configurado." } };
  return { status: 500, body: { ok: false, error: "DOCUMENT_AI_FAILED" } };
}
