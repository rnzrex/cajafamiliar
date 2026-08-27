import { cleanupExpiredBankDocumentJobs } from "../_lib/bankDocumentCleanup.js";
import { createBankDocumentAdmin, readBankDocumentServerEnvironment } from "../_lib/bankDocumentServer.js";

interface CronRequest { method?: string; headers: Record<string, string | string[] | undefined>; }
interface CronResponse { status(code: number): CronResponse; json(body: unknown): void; }

export default async function handler(request: CronRequest, response: CronResponse) {
  if (request.method !== "GET") { response.status(405).json({ ok: false, error: "method_not_allowed" }); return; }
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.authorization;
  const authorizationValue = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!cronSecret || authorizationValue !== `Bearer ${cronSecret}`) { response.status(401).json({ ok: false, error: "unauthorized" }); return; }
  try {
    const admin = createBankDocumentAdmin(readBankDocumentServerEnvironment());
    response.status(200).json({ ok: true, ...(await cleanupExpiredBankDocumentJobs(admin)) });
  } catch { response.status(500).json({ ok: false, error: "job_failed" }); }
}
