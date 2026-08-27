export interface BankDocumentCapabilities {
  integratedAiAvailable: boolean;
  provider: "gemini";
  model: string;
}

export function readBankDocumentCapabilities(environment: Record<string, string | undefined> = process.env): BankDocumentCapabilities {
  return {
    integratedAiAvailable: Boolean(environment.GEMINI_API_KEY?.trim()),
    provider: "gemini",
    model: environment.BANK_DOCUMENT_AI_MODEL?.trim() || "gemini-3.5-flash-lite",
  };
}

interface RequestLike {
  method?: string;
}

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}

export default function handler(request: RequestLike, response: ResponseLike): void {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  response.status(200).json(readBankDocumentCapabilities());
}
