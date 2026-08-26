import type { SupabaseClient } from "@supabase/supabase-js";
import { BANK_DOCUMENT_BUCKET, isOwnedBankDocumentPath } from "./bankDocumentSecurity.js";

interface BankDocumentJobRow {
  id: string;
  household_id: string;
  created_by_user_id: string;
  storage_paths: unknown;
}

export async function deleteBankDocumentImportJob(admin: SupabaseClient, job: BankDocumentJobRow): Promise<void> {
  const paths = Array.isArray(job.storage_paths)
    ? job.storage_paths.filter((path): path is string => typeof path === "string" && isOwnedBankDocumentPath(path, job.household_id, job.created_by_user_id, job.id))
    : [];
  if (paths.length > 0) await admin.storage.from(BANK_DOCUMENT_BUCKET).remove(paths);
  await admin.from("bank_document_import_jobs").update({ status: "deleted", completed_at: new Date().toISOString() }).eq("id", job.id).eq("household_id", job.household_id);
}

export async function cleanupExpiredBankDocumentJobs(admin: SupabaseClient, limit = 100): Promise<{ scanned: number; deleted: number }> {
  const { data, error } = await admin
    .from("bank_document_import_jobs")
    .select("id,household_id,created_by_user_id,storage_paths")
    .lt("expires_at", new Date().toISOString())
    .neq("status", "deleted")
    .limit(limit);
  if (error) throw new Error("DOCUMENT_CLEANUP_QUERY_FAILED");
  let deleted = 0;
  for (const row of (data ?? []) as BankDocumentJobRow[]) {
    await deleteBankDocumentImportJob(admin, row);
    deleted += 1;
  }
  return { scanned: data?.length ?? 0, deleted };
}
