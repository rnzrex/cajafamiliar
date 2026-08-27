import { describe, expect, it } from "vitest";
import { decideBankDocumentBudget, estimateBankDocumentCost, outputAllowanceForSchedule, readBankDocumentCostConfig } from "./bankDocumentCost.js";

describe("bank document AI cost guard", () => {
  const config = readBankDocumentCostConfig({
    BANK_DOCUMENT_AI_SOFT_BUDGET_USD: "0.05",
    BANK_DOCUMENT_AI_HARD_BUDGET_USD: "0.10",
    BANK_DOCUMENT_AI_INPUT_COST_USD_PER_1M: "1",
    BANK_DOCUMENT_AI_OUTPUT_COST_USD_PER_1M: "1",
    BANK_DOCUMENT_AI_MAX_OUTPUT_TOKENS: "2048",
  });

  it("allows a call under the soft budget and reports metadata cost", () => {
    const estimate = estimateBankDocumentCost({ inputTokens: 10_000, outputTokens: 10_000, thinkingTokens: 0 }, config);
    const decision = decideBankDocumentBudget({ inputTokens: 10_000, outputTokens: 10_000, thinkingTokens: 0 }, config);
    expect(estimate.totalCostUsd).toBe(0.02);
    expect(decision.allowed).toBe(true);
    expect(decision.exceedsSoftBudget).toBe(false);
  });

  it("blocks before provider execution when the hard budget would be exceeded", () => {
    const decision = decideBankDocumentBudget({ inputTokens: 80_000, outputTokens: 40_000, thinkingTokens: 0 }, config);
    expect(decision.allowed).toBe(false);
    expect(decision.errorCode).toBe("DOCUMENT_AI_COST_LIMIT");
    expect(decision.message).toContain("límite de costo configurado");
  });

  it("includes accumulated repair-call cost in the hard guard", () => {
    const decision = decideBankDocumentBudget({ inputTokens: 10_000, outputTokens: 10_000, thinkingTokens: 0 }, config, 0.09);
    expect(decision.allowed).toBe(false);
  });

  it("uses the published Gemini 3.5 Flash-Lite defaults and fails closed for unknown models", () => {
    const defaults = readBankDocumentCostConfig({});
    expect(defaults.model).toBe("gemini-3.5-flash-lite");
    expect(defaults.pricing).toEqual({ inputUsdPerMillion: 0.30, outputUsdPerMillion: 2.50 });
    expect(defaults.thinkingLevel).toBe("minimal");
    expect(() => readBankDocumentCostConfig({ BANK_DOCUMENT_AI_MODEL: "unknown-model" })).toThrow("BANK_DOCUMENT_AI_PRICING_UNKNOWN");
  });

  it("charges Gemini output including thinking exactly once", () => {
    const config = readBankDocumentCostConfig({});
    const estimate = estimateBankDocumentCost({ inputTokens: 1_000_000, outputTokens: 1_000_000, thinkingTokens: 500_000, billableOutputTokens: 1_500_000 }, config);
    expect(estimate.inputCostUsd).toBe(0.30);
    expect(estimate.outputCostUsd).toBe(3.75);
    expect(estimate.thinkingCostUsd).toBe(0);
    expect(estimate.totalCostUsd).toBe(4.05);
  });

  it("allocates output for long schedules and uses the same allowance for preflight", () => {
    const config = readBankDocumentCostConfig({ BANK_DOCUMENT_AI_MAX_OUTPUT_TOKENS: "16384", BANK_DOCUMENT_AI_MAX_SCHEDULE_INSTALLMENTS: "240", BANK_DOCUMENT_AI_OUTPUT_BASE_TOKENS: "1024", BANK_DOCUMENT_AI_OUTPUT_TOKENS_PER_INSTALLMENT: "32" });
    expect(outputAllowanceForSchedule(config, 18)).toBe(1600);
    expect(outputAllowanceForSchedule(config, 240)).toBe(8704);
    const decision = decideBankDocumentBudget({ inputTokens: 10_000, outputTokens: outputAllowanceForSchedule(config, 60), billableOutputTokens: outputAllowanceForSchedule(config, 60) }, config, 0, outputAllowanceForSchedule(config, 60));
    expect(decision.maxOutputTokens).toBe(outputAllowanceForSchedule(config, 60));
  });
});
