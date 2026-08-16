import { runPaymentReminderJob } from "../_lib/paymentReminders";

interface CronRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface CronResponse {
  status(code: number): CronResponse;
  json(body: unknown): void;
}

export default async function handler(request: CronRequest, response: CronResponse) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    response.status(500).json({ ok: false, error: "not_configured" });
    return;
  }

  const authorization = request.headers.authorization;
  const authorizationValue = Array.isArray(authorization) ? authorization[0] : authorization;
  if (authorizationValue !== `Bearer ${cronSecret}`) {
    response.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  try {
    const summary = await runPaymentReminderJob();
    response.status(200).json({ ok: true, ...summary });
  } catch {
    response.status(500).json({ ok: false, error: "job_failed" });
  }
}
