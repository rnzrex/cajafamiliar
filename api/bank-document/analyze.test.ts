import { describe, expect, it, vi } from "vitest";
import { analyzeBankDocumentRequest, structuredExtraction } from "./analyze.js";
import { FakeBankDocumentProvider } from "../_lib/bankDocumentAi.js";
import type { BankDocumentExtraction } from "../../src/utils/bankDocumentExtraction.js";
import { parseDebtScheduleFile } from "../../src/utils/debtScheduleFileParser.js";

const householdId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const importId = "33333333-3333-4333-8333-333333333333";

function fakeAdmin(bytes: Uint8Array, path: string) {
  const updates: Record<string, unknown>[] = [];
  const removed: string[][] = [];
  const job = { id: importId, household_id: householdId, created_by_user_id: userId, storage_paths: [path] };
  const admin = {
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: job, error: null }),
        update: (values: Record<string, unknown>) => { updates.push(values); return chain; },
      };
      return chain;
    },
    storage: {
      from: () => ({
        download: async () => ({ data: new Blob([bytes as any]), error: null }),
        remove: async (paths: string[]) => { removed.push(paths); return { error: null }; },
      }),
    },
  };
  return { admin: admin as any, updates, removed, job };
}

const emptyExtraction: BankDocumentExtraction = {
  documents: [{ index: 0, fileName: "contrato.pdf", mediaType: "pdf" }],
  lenderName: null, currencyCode: "PEN", contractDate: null, firstDueDate: null, contractNumber: null,
  financedAmount: null, originalPrincipal: null, totalContractAmount: null, totalInterest: null, totalInsurance: null,
  totalFees: null, teaPercent: null, tceaPercent: null, termInstallments: null, ordinaryDueDay: null,
  regularInstallmentAmount: null, finalInstallmentAmount: null,
  reportedBalance: { amount: null, label: null, inferredKind: null, confidence: null }, insuranceTerms: [], schedule: [],
  extractionWarnings: [], fieldEvidence: {}, confidenceByField: {}, fieldConflicts: [],
};

describe("bank document analyze endpoint orchestration", () => {
  it("uses deterministic CSV parsing and deletes private objects after review", async () => {
    const path = `${householdId}/${userId}/${importId}/cronograma.csv`;
    const csv = "Cuota,Fecha,Total,Capital,Interés,Seguro,Gastos\n1,2026-06-10,100,80,10,5,5";
    const fake = fakeAdmin(new TextEncoder().encode(csv), path);
    const parsed = parseDebtScheduleFile(new TextEncoder().encode(csv));
    expect(parsed.valid).toBe(true);
    expect(structuredExtraction([{
      fileName: "cronograma.csv",
      mediaType: "text/csv",
      bytes: new TextEncoder().encode(csv),
    }])).not.toBeNull();
    const result = await analyzeBankDocumentRequest({
      body: { importId, householdId, storagePaths: [path] },
      admin: fake.admin,
      userId,
    });
    expect(result.scheduleSource).toBe("contractual");
    expect(result.extraction.schedule).toHaveLength(1);
    expect(fake.removed).toEqual([[path]]);
    expect(fake.updates.some((update) => update.status === "review")).toBe(true);
  });

  it("blocks a hard-budget overage before fake provider analyze and still cleans up", async () => {
    vi.stubEnv("BANK_DOCUMENT_AI_SOFT_BUDGET_USD", "0.05");
    vi.stubEnv("BANK_DOCUMENT_AI_HARD_BUDGET_USD", "0.10");
    vi.stubEnv("BANK_DOCUMENT_AI_INPUT_COST_USD_PER_1M", "1");
    vi.stubEnv("BANK_DOCUMENT_AI_OUTPUT_COST_USD_PER_1M", "1");
    vi.stubEnv("BANK_DOCUMENT_AI_THINKING_COST_USD_PER_1M", "1");
    const path = `${householdId}/${userId}/${importId}/contrato.pdf`;
    const fake = fakeAdmin(new Uint8Array(128), path);
    const provider = new FakeBankDocumentProvider(emptyExtraction, 200_000);
    await expect(analyzeBankDocumentRequest({
      body: { importId, householdId, storagePaths: [path] },
      admin: fake.admin,
      userId,
      provider,
    })).rejects.toThrow("DOCUMENT_AI_COST_LIMIT");
    expect(provider.analyzeCalls).toBe(0);
    expect(fake.removed).toEqual([[path]]);
    expect(fake.updates.some((update) => update.status === "failed" && update.error_code === "DOCUMENT_AI_COST_LIMIT")).toBe(true);
    vi.unstubAllEnvs();
  });

  it("allows one extraction pass but blocks a repair pass that would cross the hard budget", async () => {
    vi.stubEnv("BANK_DOCUMENT_AI_SOFT_BUDGET_USD", "0.05");
    vi.stubEnv("BANK_DOCUMENT_AI_HARD_BUDGET_USD", "0.10");
    vi.stubEnv("BANK_DOCUMENT_AI_INPUT_COST_USD_PER_1M", "1");
    vi.stubEnv("BANK_DOCUMENT_AI_OUTPUT_COST_USD_PER_1M", "1");
    vi.stubEnv("BANK_DOCUMENT_AI_THINKING_COST_USD_PER_1M", "1");
    const path = `${householdId}/${userId}/${importId}/contrato.pdf`;
    const fake = fakeAdmin(new Uint8Array(128), path);
    const provider = new FakeBankDocumentProvider({
      ...emptyExtraction,
      termInstallments: 2,
      totalContractAmount: 999,
      schedule: [{ contractualInstallmentNumber: 1, dueDate: "2026-06-10", principal: 80, interest: 10, insurance: 5, fees: 5, total: 100, reportedBalance: null }],
    }, 80_000);
    await analyzeBankDocumentRequest({
      body: { importId, householdId, storagePaths: [path] },
      admin: fake.admin,
      userId,
      provider,
    }).catch(() => undefined);
    expect(provider.analyzeCalls).toBe(1);
    expect(provider.countTokensCalls).toBe(2);
    expect(fake.removed).toEqual([[path]]);
    vi.unstubAllEnvs();
  });
});
