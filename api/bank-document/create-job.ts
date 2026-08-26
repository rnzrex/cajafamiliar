import { randomUUID } from "node:crypto";
import { assertHouseholdMembership, authenticateBankDocumentRequest, createBankDocumentAdmin, readBankDocumentServerEnvironment, responseError } from "../_lib/bankDocumentServer.js";
import { MAX_BANK_DOCUMENT_FILES, isAllowedBankDocument, parseJsonBody, safeStorageFileName } from "../_lib/bankDocumentSecurity.js";

interface RequestLike {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}

export default async function handler(request: RequestLike, response: ResponseLike) {
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  try {
    const environment = readBankDocumentServerEnvironment();
    const admin = createBankDocumentAdmin(environment);
    const user = await authenticateBankDocumentRequest(admin, request.headers);
    const body = parseJsonBody(request.body);
    const householdId = body && typeof body === "object" && typeof (body as any).householdId === "string" ? (body as any).householdId.trim() : "";
    const files = body && typeof body === "object" && Array.isArray((body as any).files) ? (body as any).files : [];
    if (!householdId || files.length === 0 || files.length > MAX_BANK_DOCUMENT_FILES) throw new Error("INVALID_DOCUMENT_INPUT");
    await assertHouseholdMembership(admin, householdId, user.id);

    const importId = randomUUID();
    const paths = files.map((file: any, index: number) => {
      const fileName = typeof file?.fileName === "string" ? file.fileName.trim() : "";
      const mediaType = typeof file?.mediaType === "string" ? file.mediaType : "";
      const size = Number(file?.size);
      if (!isAllowedBankDocument(fileName, mediaType, size)) throw new Error("INVALID_DOCUMENT_INPUT");
      return `${householdId}/${user.id}/${importId}/${safeStorageFileName(fileName, `${index}-${randomUUID().slice(0, 8)}`)}`;
    });
    const { error } = await admin.from("bank_document_import_jobs").insert({
      id: importId,
      household_id: householdId,
      created_by_user_id: user.id,
      status: "created",
      provider: environment.providerMode,
      model: environment.model,
      file_count: files.length,
      storage_paths: paths,
    });
    if (error) throw new Error("DOCUMENT_JOB_CREATE_FAILED");
    response.status(201).json({ ok: true, importId, paths, bucket: "bank-document-imports" });
  } catch (error) {
    const mapped = responseError(error);
    response.status(mapped.status).json(mapped.body);
  }
}
