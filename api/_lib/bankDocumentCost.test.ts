import { describe, expect, it } from "vitest";
import { decideBankDocumentBudget, estimateBankDocumentCost, readBankDocumentCostConfig } from "./bankDocumentCost.js";

describe("bank document AI cost guard", () => {
  const config = readBankDocumentCostConfig({
    BANK_DOCUMENT_AI_SOFT_BUDGET_USD: "0.05",
    BANK_DOCUMENT_AI_HARD_BUDGET_USD: "0.10",
    BANK_DOCUMENT_AI_INPUT_COST_USD_PER_1M: "1",
    BANK_DOCUMENT_AI_OUTPUT_COST_USD_PER_1M: "1",
    BANK_DOCUMENT_AI_THINKING_COST_USD_PER_1M: "1",
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
});
