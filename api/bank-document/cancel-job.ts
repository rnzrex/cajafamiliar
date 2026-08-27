import { assertHouseholdMembership, assertImportPathOwnership, authenticateBankDocumentRequest, createBankDocumentAdmin, readBankDocumentServerEnvironment, responseError } from "../_lib/bankDocumentServer.js";
import { deleteBankDocumentImportJob } from "../_lib/bankDocumentCleanup.js";
import { parseJsonBody } from "../_lib/bankDocumentSecurity.js";

interface RequestLike { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown; }
interface ResponseLike { status(code: number): ResponseLike; json(body: unknown): void; }

export default async function handler(request: RequestLike, response: ResponseLike) {
  if (request.method !== "POST") { response.status(405).json({ ok: false, error: "method_not_allowed" }); return; }
  try {
    const environment = readBankDocumentServerEnvironment();
    const admin = createBankDocumentAdmin(environment);
    const user = await authenticateBankDocumentRequest(admin, request.headers);
    const body = parseJsonBody(request.body);
    const importId = typeof body?.importId === "string" ? body.importId.trim() : "";
    const householdId = typeof body?.householdId === "string" ? body.householdId.trim() : "";
    const storagePaths = Array.isArray(body?.storagePaths) ? body.storagePaths.filter((path): path is string => typeof path === "string") : [];
    if (!importId || !householdId || storagePaths.length === 0) throw new Error("INVALID_DOCUMENT_INPUT");
    await assertHouseholdMembership(admin, householdId, user.id);
    assertImportPathOwnership(storagePaths, householdId, user.id, importId);
    const { data: job, error } = await admin.from("bank_document_import_jobs").select("id,household_id,created_by_user_id,storage_paths").eq("id", importId).eq("household_id", householdId).maybeSingle();
    if (error || !job || job.created_by_user_id !== user.id) throw new Error("DOCUMENT_PATH_ACCESS_DENIED");
    await deleteBankDocumentImportJob(admin, job as any);
    response.status(200).json({ ok: true });
  } catch (error) {
    const mapped = responseError(error);
    response.status(mapped.status).json(mapped.body);
  }
}
