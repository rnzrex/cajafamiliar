export interface BankDocumentCapabilities {
  integratedAiAvailable: boolean;
  provider: "gemini";
  model: string;
}

const UNAVAILABLE: BankDocumentCapabilities = {
  integratedAiAvailable: false,
  provider: "gemini",
  model: "gemini-3.5-flash-lite",
};

export async function fetchBankDocumentCapabilities(signal?: AbortSignal): Promise<BankDocumentCapabilities> {
  if (typeof fetch !== "function") return UNAVAILABLE;
  try {
    const response = await fetch("/api/bank-document/capabilities", { method: "GET", signal, headers: { accept: "application/json" } });
    if (!response.ok) return UNAVAILABLE;
    const payload = await response.json() as Partial<BankDocumentCapabilities>;
    return {
      integratedAiAvailable: payload.integratedAiAvailable === true,
      provider: "gemini",
      model: typeof payload.model === "string" && payload.model.trim() ? payload.model : UNAVAILABLE.model,
    };
  } catch {
    return UNAVAILABLE;
  }
}
