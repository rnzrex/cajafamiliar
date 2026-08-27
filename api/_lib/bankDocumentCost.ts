export type BankDocumentThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface BankDocumentModelPricing {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export interface BankDocumentCostConfig {
  model: string;
  thinkingLevel: BankDocumentThinkingLevel;
  softBudgetUsd: number;
  hardBudgetUsd: number;
  pricing: BankDocumentModelPricing;
  maxOutputTokens: number;
  maxScheduleInstallments: number;
  outputBaseTokens: number;
  outputTokensPerInstallment: number;
  inlineMaxBytes: number;
}

export interface BankDocumentTokenUsage {
  inputTokens: number;
  /** Provider-reported candidate/output tokens, excluding separate thoughts when exposed. */
  outputTokens: number;
  /** Provider-reported reasoning tokens, retained for observability only. */
  thinkingTokens?: number;
  /** Authoritative billable output category. Gemini charges candidates + thoughts once. */
  billableOutputTokens?: number;
}

export interface BankDocumentCostEstimate {
  inputCostUsd: number;
  outputCostUsd: number;
  /** Always zero: Gemini output pricing includes thinking tokens. */
  thinkingCostUsd: number;
  billableOutputTokens: number;
  totalCostUsd: number;
}

export interface BankDocumentBudgetDecision {
  allowed: boolean;
  exceedsSoftBudget: boolean;
  estimatedCostUsd: number;
  hardBudgetUsd: number;
  maxOutputTokens: number;
  errorCode?: "DOCUMENT_AI_COST_LIMIT";
  message?: string;
}

export const GEMINI_MODEL_PRICING: Record<string, BankDocumentModelPricing> = {
  "gemini-3.5-flash-lite": {
    inputUsdPerMillion: 0.30,
    outputUsdPerMillion: 2.50,
  },
};

const COST_LIMIT_MESSAGE = "El documento es demasiado grande para analizarlo dentro del límite de costo configurado. Reduce páginas o divide el expediente.";
const UNKNOWN_PRICING_MESSAGE = "El modelo de análisis no tiene una tarifa segura configurada.";

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function positiveInteger(value: string | undefined, fallback: number, minimum: number): number {
  return Math.max(minimum, Math.floor(positiveNumber(value, fallback)));
}

export function readBankDocumentCostConfig(environment: Record<string, string | undefined> = process.env): BankDocumentCostConfig {
  const model = environment.BANK_DOCUMENT_AI_MODEL?.trim() || "gemini-3.5-flash-lite";
  const publishedPricing = GEMINI_MODEL_PRICING[model];
  if (!publishedPricing) throw new Error("BANK_DOCUMENT_AI_PRICING_UNKNOWN");

  const thinkingLevel = environment.BANK_DOCUMENT_AI_THINKING_LEVEL?.trim() || "minimal";
  if (!(thinkingLevel === "minimal" || thinkingLevel === "low" || thinkingLevel === "medium" || thinkingLevel === "high")) {
    throw new Error("BANK_DOCUMENT_AI_THINKING_LEVEL_INVALID");
  }

  return {
    model,
    thinkingLevel,
    softBudgetUsd: positiveNumber(environment.BANK_DOCUMENT_AI_SOFT_BUDGET_USD, 0.05),
    hardBudgetUsd: positiveNumber(environment.BANK_DOCUMENT_AI_HARD_BUDGET_USD, 0.10),
    pricing: {
      inputUsdPerMillion: positiveNumber(environment.BANK_DOCUMENT_AI_INPUT_COST_USD_PER_1M, publishedPricing.inputUsdPerMillion),
      outputUsdPerMillion: positiveNumber(environment.BANK_DOCUMENT_AI_OUTPUT_COST_USD_PER_1M, publishedPricing.outputUsdPerMillion),
    },
    // This is a single provider/cost setting. The request allowance is resolved
    // below from this cap and the expected schedule length.
    maxOutputTokens: positiveInteger(environment.BANK_DOCUMENT_AI_MAX_OUTPUT_TOKENS, 16_384, 256),
    maxScheduleInstallments: positiveInteger(environment.BANK_DOCUMENT_AI_MAX_SCHEDULE_INSTALLMENTS, 240, 1),
    outputBaseTokens: positiveInteger(environment.BANK_DOCUMENT_AI_OUTPUT_BASE_TOKENS, 1_024, 256),
    outputTokensPerInstallment: positiveInteger(environment.BANK_DOCUMENT_AI_OUTPUT_TOKENS_PER_INSTALLMENT, 32, 1),
    inlineMaxBytes: positiveInteger(environment.BANK_DOCUMENT_AI_INLINE_MAX_BYTES, 20 * 1024 * 1024, 1),
  };
}

export function outputAllowanceForSchedule(
  config: BankDocumentCostConfig,
  expectedScheduleInstallments?: number | null,
): number {
  const installments = expectedScheduleInstallments != null && Number.isInteger(expectedScheduleInstallments) && expectedScheduleInstallments > 0
    ? Math.min(expectedScheduleInstallments, config.maxScheduleInstallments)
    : config.maxScheduleInstallments;
  return Math.min(
    config.maxOutputTokens,
    Math.max(256, config.outputBaseTokens + installments * config.outputTokensPerInstallment),
  );
}

export function estimateBankDocumentCost(usage: BankDocumentTokenUsage, config: BankDocumentCostConfig): BankDocumentCostEstimate {
  const billableOutputTokens = Math.max(0, usage.billableOutputTokens ?? usage.outputTokens + (usage.thinkingTokens ?? 0));
  const inputCostUsd = usage.inputTokens / 1_000_000 * config.pricing.inputUsdPerMillion;
  const outputCostUsd = billableOutputTokens / 1_000_000 * config.pricing.outputUsdPerMillion;
  return {
    inputCostUsd,
    outputCostUsd,
    thinkingCostUsd: 0,
    billableOutputTokens,
    totalCostUsd: inputCostUsd + outputCostUsd,
  };
}

export function decideBankDocumentBudget(
  usage: BankDocumentTokenUsage,
  config: BankDocumentCostConfig,
  accumulatedCostUsd = 0,
  maxOutputTokens = usage.billableOutputTokens ?? usage.outputTokens,
): BankDocumentBudgetDecision {
  const estimate = estimateBankDocumentCost(usage, config);
  const estimatedCostUsd = accumulatedCostUsd + estimate.totalCostUsd;
  const exceedsSoftBudget = estimatedCostUsd > config.softBudgetUsd;
  if (estimatedCostUsd > config.hardBudgetUsd) {
    return {
      allowed: false,
      exceedsSoftBudget,
      estimatedCostUsd,
      hardBudgetUsd: config.hardBudgetUsd,
      maxOutputTokens,
      errorCode: "DOCUMENT_AI_COST_LIMIT",
      message: COST_LIMIT_MESSAGE,
    };
  }
  return { allowed: true, exceedsSoftBudget, estimatedCostUsd, hardBudgetUsd: config.hardBudgetUsd, maxOutputTokens };
}

export function usageMetadata(params: {
  provider: string;
  model: string;
  usage: BankDocumentTokenUsage;
  estimatedCostUsd: number;
  actualCostUsd?: number | null;
  status: "completed" | "failed" | "cost_limited";
  userId: string;
  householdId: string;
}) {
  return {
    provider: params.provider,
    model: params.model,
    inputTokens: params.usage.inputTokens,
    outputTokens: params.usage.outputTokens,
    billableOutputTokens: params.usage.billableOutputTokens ?? params.usage.outputTokens + (params.usage.thinkingTokens ?? 0),
    thinkingTokens: params.usage.thinkingTokens ?? 0,
    estimatedCostUsd: Number(params.estimatedCostUsd.toFixed(8)),
    actualCostUsd: params.actualCostUsd == null ? null : Number(params.actualCostUsd.toFixed(8)),
    status: params.status,
    userId: params.userId,
    householdId: params.householdId,
    createdAt: new Date().toISOString(),
  };
}

export { COST_LIMIT_MESSAGE, UNKNOWN_PRICING_MESSAGE };
