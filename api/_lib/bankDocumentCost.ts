export interface BankDocumentCostConfig {
  softBudgetUsd: number;
  hardBudgetUsd: number;
  inputCostUsdPerMillionTokens: number;
  outputCostUsdPerMillionTokens: number;
  thinkingCostUsdPerMillionTokens: number;
  maxOutputTokens: number;
}

export interface BankDocumentTokenUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens?: number;
}

export interface BankDocumentCostEstimate {
  inputCostUsd: number;
  outputCostUsd: number;
  thinkingCostUsd: number;
  totalCostUsd: number;
}

export interface BankDocumentBudgetDecision {
  allowed: boolean;
  exceedsSoftBudget: boolean;
  estimatedCostUsd: number;
  hardBudgetUsd: number;
  errorCode?: "DOCUMENT_AI_COST_LIMIT";
  message?: string;
}

const COST_LIMIT_MESSAGE = "El documento es demasiado grande para analizarlo dentro del límite de costo configurado. Reduce páginas o divide el expediente.";

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function readBankDocumentCostConfig(environment: Record<string, string | undefined> = process.env): BankDocumentCostConfig {
  return {
    softBudgetUsd: positiveNumber(environment.BANK_DOCUMENT_AI_SOFT_BUDGET_USD, 0.05),
    hardBudgetUsd: positiveNumber(environment.BANK_DOCUMENT_AI_HARD_BUDGET_USD, 0.1),
    // Conservative configurable defaults. Override with the provider's current
    // published rates; never infer a price from the browser.
    inputCostUsdPerMillionTokens: positiveNumber(environment.BANK_DOCUMENT_AI_INPUT_COST_USD_PER_1M, 0.075),
    outputCostUsdPerMillionTokens: positiveNumber(environment.BANK_DOCUMENT_AI_OUTPUT_COST_USD_PER_1M, 0.3),
    thinkingCostUsdPerMillionTokens: positiveNumber(environment.BANK_DOCUMENT_AI_THINKING_COST_USD_PER_1M, 0.3),
    maxOutputTokens: Math.max(256, Math.floor(positiveNumber(environment.BANK_DOCUMENT_AI_MAX_OUTPUT_TOKENS, 2048))),
  };
}

export function estimateBankDocumentCost(usage: BankDocumentTokenUsage, config: BankDocumentCostConfig): BankDocumentCostEstimate {
  const inputCostUsd = usage.inputTokens / 1_000_000 * config.inputCostUsdPerMillionTokens;
  const outputCostUsd = usage.outputTokens / 1_000_000 * config.outputCostUsdPerMillionTokens;
  const thinkingCostUsd = (usage.thinkingTokens ?? 0) / 1_000_000 * config.thinkingCostUsdPerMillionTokens;
  return {
    inputCostUsd,
    outputCostUsd,
    thinkingCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd + thinkingCostUsd,
  };
}

export function decideBankDocumentBudget(
  usage: BankDocumentTokenUsage,
  config: BankDocumentCostConfig,
  accumulatedCostUsd = 0,
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
      errorCode: "DOCUMENT_AI_COST_LIMIT",
      message: COST_LIMIT_MESSAGE,
    };
  }
  return { allowed: true, exceedsSoftBudget, estimatedCostUsd, hardBudgetUsd: config.hardBudgetUsd };
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
    thinkingTokens: params.usage.thinkingTokens ?? 0,
    estimatedCostUsd: Number(params.estimatedCostUsd.toFixed(8)),
    actualCostUsd: params.actualCostUsd == null ? null : Number(params.actualCostUsd.toFixed(8)),
    status: params.status,
    userId: params.userId,
    householdId: params.householdId,
    createdAt: new Date().toISOString(),
  };
}
