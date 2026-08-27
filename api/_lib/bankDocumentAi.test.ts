import { describe, expect, it } from "vitest";
import { FakeBankDocumentProvider, GeminiBankDocumentProvider, prepareBankDocumentProviderDocuments } from "./bankDocumentAi.js";
import { readBankDocumentCostConfig } from "./bankDocumentCost.js";
import * as XLSX from "xlsx";
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
    const calls: Array<{ url: string; body: string; headers: Headers }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = String(init?.body ?? "");
      calls.push({ url, body, headers: new Headers(init?.headers) });
      if (url.includes(":countTokens")) return new Response(JSON.stringify({ totalTokens: 12 }), { status: 200 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(extraction) }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, thoughtsTokenCount: 1 } }), { status: 200 });
    };
    const provider = new GeminiBankDocumentProvider({ apiKey: "test-only-key", fetchImpl, config: readBankDocumentCostConfig({ BANK_DOCUMENT_AI_MAX_OUTPUT_TOKENS: "4096", BANK_DOCUMENT_AI_INLINE_MAX_BYTES: "100000" }) });
    await provider.countTokens({ documents: [] });
    const result = await provider.analyze({ documents: [], outputTokenAllowance: 321 });
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 4, billableOutputTokens: 5, thinkingTokens: 1 });
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.body.includes("test-only-key") === false)).toBe(true);
    expect(calls.every((call) => call.url.includes("test-only-key") === false)).toBe(true);
    expect(calls.every((call) => call.headers.get("x-goog-api-key") === "test-only-key")).toBe(true);
    expect(calls[1].url).toContain("gemini-3.5-flash-lite");
    expect(JSON.parse(calls[1].body).generationConfig).toMatchObject({ maxOutputTokens: 321, thinkingConfig: { thinkingLevel: "minimal" } });
  });

  it("rejects MAX_TOKENS and malformed JSON instead of accepting a partial schedule", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{\\\"schedule\\\":[" }] } }] }), { status: 200 });
    const provider = new GeminiBankDocumentProvider({ apiKey: "test-only-key", fetchImpl });
    await expect(provider.analyze({ documents: [] })).rejects.toThrow("DOCUMENT_AI_OUTPUT_TRUNCATED");
  });

  it("converts XLS/XLSX to bounded text with sheet, header and row provenance", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Fecha", "Total"], ["2026-08-10", 100]]), "Cronograma");
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const prepared = prepareBankDocumentProviderDocuments([{ fileName: "Credito-Juan.xlsx", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes }]);
    expect(prepared[0].mediaType).toBe("text/plain");
    expect(prepared[0].fileName).toBe("document-1.txt");
    expect(new TextDecoder().decode(prepared[0].bytes)).toContain("sheetName=Cronograma");
    expect(new TextDecoder().decode(prepared[0].bytes)).toContain("row=1");
    expect(new TextDecoder().decode(prepared[0].bytes)).not.toContain("Credito-Juan");
  });

  it("uses Files API for oversized payloads and deletes uploaded files after success", async () => {
    const calls: Array<{ url: string; method: string; body: string; headers: Headers }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : "", headers: new Headers(init?.headers) });
      if (url.includes("/upload/v1beta/files")) return new Response(null, { status: 200, headers: { "x-goog-upload-url": "https://upload.test/opaque" } });
      if (url === "https://upload.test/opaque") return new Response(JSON.stringify({ file: { name: "files/opaque", uri: "https://generativelanguage.googleapis.com/v1beta/files/opaque", mimeType: "application/pdf" } }), { status: 200 });
      if (init?.method === "DELETE") return new Response("{}", { status: 200 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(extraction) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }), { status: 200 });
    };
    const provider = new GeminiBankDocumentProvider({ apiKey: "test-only-key", fetchImpl, config: readBankDocumentCostConfig({ BANK_DOCUMENT_AI_INLINE_MAX_BYTES: "1" }) });
    await provider.analyze({ documents: [{ fileName: "DNI-Renzo.pdf", mediaType: "application/pdf", bytes: new Uint8Array([1, 2]) }] });
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
    const generate = calls.find((call) => call.url.includes(":generateContent"));
    expect(generate?.body).toContain("fileData");
    expect(generate?.body).not.toContain("inlineData");
    expect(calls.every((call) => call.url.includes("test-only-key") === false)).toBe(true);
    expect(calls.every((call) => call.body.includes("DNI-Renzo") === false)).toBe(true);
    expect(calls.every((call) => call.headers.get("x-goog-api-key") === "test-only-key")).toBe(true);
  });

  it("deletes Files API objects when generation fails", async () => {
    const methods: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      methods.push(init?.method ?? "GET");
      if (url.includes("/upload/v1beta/files")) return new Response(null, { status: 200, headers: { "x-goog-upload-url": "https://upload.test/opaque" } });
      if (url === "https://upload.test/opaque") return new Response(JSON.stringify({ file: { name: "files/opaque", uri: "uri", mimeType: "application/pdf" } }), { status: 200 });
      if (init?.method === "DELETE") return new Response("{}", { status: 200 });
      return new Response("no", { status: 500 });
    };
    const provider = new GeminiBankDocumentProvider({ apiKey: "test-only-key", fetchImpl, config: readBankDocumentCostConfig({ BANK_DOCUMENT_AI_INLINE_MAX_BYTES: "1" }) });
    await expect(provider.analyze({ documents: [{ fileName: "secret.pdf", mediaType: "application/pdf", bytes: new Uint8Array([1, 2]) }] })).rejects.toThrow("PROVIDER_GENERATE_FAILED");
    expect(methods.filter((method) => method === "DELETE")).toHaveLength(1);
  });
});
