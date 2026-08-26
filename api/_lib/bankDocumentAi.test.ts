import { describe, expect, it } from "vitest";
import { FakeBankDocumentProvider, GeminiBankDocumentProvider } from "./bankDocumentAi.js";
import type { BankDocumentExtraction } from "../../src/utils/bankDocumentExtraction.js";

const extraction: BankDocumentExtraction = {
  documents: [{ index: 0, fileName: "contrato.pdf", mediaType: "pdf" }],
  lenderName: null, currencyCode: "PEN", contractDate: null, firstDueDate: null, contractNumber: null,
  financedAmount: null, originalPrincipal: null, totalContractAmount: null, totalInterest: null, totalInsurance: null,
  totalFees: null, teaPercent: null, tceaPercent: null, termInstallments: null, ordinaryDueDay: null,
  regularInstallmentAmount: null, finalInstallmentAmount: null,
  reportedBalance: { amount: null, label: null, inferredKind: null, confidence: null }, insuranceTerms: [], schedule: [],
  extractionWarnings: [], fieldEvidence: {}, confidenceByField: {}, fieldConflicts: [],
};

describe("bank document AI providers", () => {
  it("supports deterministic fake provider injection without a client secret", async () => {
    const provider = new FakeBankDocumentProvider(extraction);
    expect((await provider.countTokens({ documents: [] })).inputTokens).toBeGreaterThan(0);
    await provider.analyze({ documents: [] });
    expect(provider.countTokensCalls).toBe(1);
    expect(provider.analyzeCalls).toBe(1);
  });

  it("uses structured JSON REST generation and keeps the key out of request bodies", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = String(init?.body ?? "");
      calls.push({ url, body });
      if (url.includes(":countTokens")) return new Response(JSON.stringify({ totalTokens: 12 }), { status: 200 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(extraction) }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, thoughtsTokenCount: 1 } }), { status: 200 });
    };
    const provider = new GeminiBankDocumentProvider({ apiKey: "test-only-key", fetchImpl });
    await provider.countTokens({ documents: [] });
    const result = await provider.analyze({ documents: [] });
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 4, thinkingTokens: 1 });
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.body.includes("test-only-key") === false)).toBe(true);
    expect(calls[1].url).toContain("gemini-3.5-flash-lite");
  });
});
