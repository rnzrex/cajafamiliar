import type {
  AmortizationMethod,
  DebtContractAuthority,
  DebtDayCountBasis,
  DebtFeeRuleType,
  DebtInstallmentAmountMode,
  DebtInterestRateType,
  DebtKind,
  DebtPaymentFrequency,
  DebtPrincipalBasis,
  DebtScheduleInstallmentInput,
  PeriodicRateBasis,
  ScheduleSource,
} from "../types";
import {
  UNIVERSAL_EXTERNAL_AI_PROMPT,
  mapUniversalDocumentRowsToSchedule,
  type UniversalDebtDocumentImportReview,
} from "./universalDebtDocumentImport";

export const DOCUMENT_FIRST_EXTERNAL_AI_PROMPT = `${UNIVERSAL_EXTERNAL_AI_PROMPT}

REGLAS ADICIONALES PARA CREAR LA DEUDA DESDE EL DOCUMENTO:
Dentro de contract incluye también, solo cuando el documento lo permita sin inventar: debtKind (bank_loan, family_loan, installment_purchase, mortgage, pledge u other), debtName (nombre corto descriptivo de la obligación, sin PII), creditorName (nombre comercial del acreedor, sin datos personales), currencyCode (PEN o USD), contractDate, currentPrincipalAmount (solo si el documento declara explícitamente un saldo de capital vigente; no lo deduzcas de pagos que no aparecen), openingPrincipalAmount con la misma semántica, termInstallments y tceaPercent. Para financiamiento directo de un vendedor/inmobiliaria con precio del bien, cuota inicial y cronograma, usa installment_purchase salvo que el documento demuestre otra categoría. No uses credit_card para cronogramas fijos.

No decidas qué cuotas ya pagó realmente la persona salvo que el expediente lo demuestre de forma explícita. Caja Familiar preguntará esa historia real antes de guardar. La cuota inicial/down payment debe conservar rowRole=down_payment y no debe restarse por segunda vez del financedPrincipalAmount.`;

export type DocumentFirstSupportedDebtKind = Exclude<DebtKind, "credit_card">;
export type DocumentFirstOnboardingMode = "NEW_DEBT" | "EXISTING_DEBT";

export interface DocumentFirstDefaults {
  debtKind: DocumentFirstSupportedDebtKind;
  requiresSpecializedFlow: boolean;
  specializedReason: string | null;
  debtName: string;
  creditorName: string;
  currencyCode: "PEN" | "USD";
  contractDate: string | null;
  assetPrice: number | null;
  downPaymentAmount: number | null;
  financedPrincipalAmount: number | null;
  scheduledPrincipalAmount: number | null;
  principalBasis: DebtPrincipalBasis;
  repaymentStructure: "fixed_schedule" | "open_ended" | "unknown";
  amortizationMethod: AmortizationMethod;
  installmentAmountMode: DebtInstallmentAmountMode;
  paymentFrequency: DebtPaymentFrequency | null;
  customFrequencyDays: number | null;
  firstDueDate: string | null;
  termInstallments: number | null;
  interestRateType: DebtInterestRateType;
  interestRatePercent: number | null;
  interestRateBasis: string | null;
  dayCountBasis: DebtDayCountBasis;
  feeRuleType: DebtFeeRuleType;
  feeRule: Record<string, unknown>;
  prepaymentTerms: Record<string, unknown>;
  tceaPercent: number | null;
  explicitCurrentPrincipal: number | null;
  scheduleSource: ScheduleSource;
  authority: DebtContractAuthority;
  schedule: DebtScheduleInstallmentInput[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pick(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = raw[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function debtKind(value: unknown, raw: Record<string, unknown>): DocumentFirstSupportedDebtKind {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "bank_loan" || normalized === "family_loan" || normalized === "installment_purchase" || normalized === "mortgage" || normalized === "pledge" || normalized === "other") {
    return normalized;
  }
  const hasAssetStructure = finiteNumber(pick(raw, "assetPrice", "asset_price")) != null
    && finiteNumber(pick(raw, "financedPrincipalAmount", "financed_principal_amount", "financedAmount", "financed_amount")) != null;
  return hasAssetStructure ? "installment_purchase" : "other";
}

function currency(value: unknown): "PEN" | "USD" {
  const normalized = text(value).toUpperCase();
  return normalized === "USD" || normalized.includes("DOLAR") || normalized.includes("DÓLAR") ? "USD" : "PEN";
}

function principalBasis(value: unknown): DebtPrincipalBasis {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "asset_price_including_down_payment" || normalized === "financed_principal_only" || normalized === "reported_balance"
    ? normalized
    : "unknown";
}

function amortization(value: unknown): AmortizationMethod {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "fixed_installment" || normalized === "constant_principal" || normalized === "increasing_installment" || normalized === "decreasing_installment" || normalized === "irregular_contract" || normalized === "custom"
    ? normalized
    : "unknown";
}

function amountMode(value: unknown, schedule: DebtScheduleInstallmentInput[]): DebtInstallmentAmountMode {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "fixed" || normalized === "variable" || normalized === "unknown") return normalized;
  const amounts = schedule.map((row) => row.expectedAmount).filter((value): value is number => value != null);
  return amounts.length > 1 && amounts.every((value) => Math.abs(value - amounts[0]) <= 0.01) ? "fixed" : "variable";
}

function paymentFrequency(value: unknown): DebtPaymentFrequency | null {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "monthly" || normalized === "mensual") return "monthly";
  if (normalized === "biweekly" || normalized === "quincenal") return "biweekly";
  if (normalized === "weekly" || normalized === "semanal") return "weekly";
  if (normalized === "custom" || normalized === "personalizada") return "custom";
  return null;
}

function interestRateType(value: unknown): DebtInterestRateType {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "tna" || normalized === "nominal_annual" || normalized === "nominal_annual_simple") return "nominal_annual_simple";
  if (normalized === "tea" || normalized === "effective_annual") return "effective_annual";
  if (normalized === "periodic" || normalized === "effective_periodic") return "effective_periodic";
  if (normalized === "contract_schedule" || normalized === "contract_schedule_only") return "contract_schedule";
  if (normalized === "manual") return "manual";
  return "unknown";
}

function dayCountBasis(value: unknown): DebtDayCountBasis {
  const normalized = text(value).toLowerCase().replace(/[\s/-]+/g, "_");
  if (normalized.includes("360")) return "actual_days_360";
  if (normalized.includes("365")) return "actual_days_365";
  return "unknown";
}

function feeRuleType(value: unknown): DebtFeeRuleType {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "fixed" || normalized === "percentage" || normalized === "formula_known" || normalized === "contract_schedule_only"
    ? normalized
    : "unknown";
}

function repaymentStructure(value: unknown, schedule: DebtScheduleInstallmentInput[]): "fixed_schedule" | "open_ended" | "unknown" {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "fixed_schedule" || normalized === "open_ended" || normalized === "unknown") return normalized;
  return schedule.length > 0 ? "fixed_schedule" : "unknown";
}

function dateOrNull(value: unknown): string | null {
  const normalized = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function maxContractualInstallment(schedule: DebtScheduleInstallmentInput[]): number | null {
  if (schedule.length === 0) return null;
  return Math.max(...schedule.map((row) => row.contractualInstallmentNumber ?? row.installmentNumber));
}

export function extractDocumentFirstDefaults(review: UniversalDebtDocumentImportReview): DocumentFirstDefaults {
  const raw = review.contract;
  const schedule = mapUniversalDocumentRowsToSchedule(review);
  const detectedKind = debtKind(pick(raw, "debtKind", "debt_kind"), raw);
  const creditorName = text(pick(raw, "creditorName", "creditor_name", "creditorLabel", "creditor_label", "lenderName", "lender_name"));
  const debtName = text(pick(raw, "debtName", "debt_name", "obligationLabel", "obligation_label")) || (creditorName ? `Financiamiento ${creditorName}` : "Financiamiento");
  const financed = finiteNumber(pick(raw, "financedPrincipalAmount", "financed_principal_amount", "financedAmount", "financed_amount"));
  const explicitCurrent = finiteNumber(pick(raw, "currentPrincipalAmount", "current_principal_amount", "openingPrincipalAmount", "opening_principal_amount"));
  const source = review.scheduleSource ?? "manual";
  const structure = repaymentStructure(pick(raw, "repaymentStructure", "repayment_structure"), schedule);
  const unsupported = detectedKind === "bank_loan" || detectedKind === "pledge";
  const specializedReason = detectedKind === "bank_loan"
    ? "Los créditos bancarios mantienen su onboarding especializado porque necesitan perfil bancario, seguros y reglas BANK V3."
    : detectedKind === "pledge"
      ? "Los empeños necesitan registrar la garantía física y usan un flujo especializado."
      : null;

  return {
    debtKind: detectedKind,
    requiresSpecializedFlow: unsupported,
    specializedReason,
    debtName,
    creditorName,
    currencyCode: currency(pick(raw, "currencyCode", "currency_code", "currency")),
    contractDate: dateOrNull(pick(raw, "contractDate", "contract_date", "originDate", "origin_date")),
    assetPrice: finiteNumber(pick(raw, "assetPrice", "asset_price")),
    downPaymentAmount: finiteNumber(pick(raw, "downPaymentAmount", "down_payment_amount")),
    financedPrincipalAmount: financed,
    scheduledPrincipalAmount: finiteNumber(pick(raw, "scheduledPrincipalAmount", "scheduled_principal_amount")) ?? review.reconciliation.schedulePrincipal,
    principalBasis: principalBasis(pick(raw, "principalBasis", "principal_basis")),
    repaymentStructure: structure,
    amortizationMethod: amortization(pick(raw, "amortizationMethod", "amortization_method")),
    installmentAmountMode: amountMode(pick(raw, "installmentAmountMode", "installment_amount_mode"), schedule),
    paymentFrequency: paymentFrequency(pick(raw, "paymentFrequency", "payment_frequency")),
    customFrequencyDays: finiteNumber(pick(raw, "customFrequencyDays", "custom_frequency_days")),
    firstDueDate: dateOrNull(pick(raw, "firstDueDate", "first_due_date")) ?? schedule.find((row) => row.rowRole !== "down_payment")?.dueDate ?? schedule[0]?.dueDate ?? null,
    termInstallments: finiteNumber(pick(raw, "termInstallments", "term_installments", "plannedInstallmentCount", "planned_installment_count")) ?? maxContractualInstallment(schedule),
    interestRateType: interestRateType(pick(raw, "interestRateType", "interest_rate_type")),
    interestRatePercent: finiteNumber(pick(raw, "interestRatePercent", "interest_rate_percent")),
    interestRateBasis: text(pick(raw, "interestRateBasis", "interest_rate_basis")) || null,
    dayCountBasis: dayCountBasis(pick(raw, "dayCountBasis", "day_count_basis")),
    feeRuleType: feeRuleType(pick(raw, "feeRuleType", "fee_rule_type")),
    feeRule: isRecord(pick(raw, "feeRule", "fee_rule")) ? pick(raw, "feeRule", "fee_rule") as Record<string, unknown> : {},
    prepaymentTerms: isRecord(pick(raw, "prepaymentTerms", "prepayment_terms")) ? pick(raw, "prepaymentTerms", "prepayment_terms") as Record<string, unknown> : {},
    tceaPercent: finiteNumber(pick(raw, "tceaPercent", "tcea_percent")),
    explicitCurrentPrincipal: explicitCurrent,
    scheduleSource: source,
    authority: review.normalized.authority,
    schedule,
    warnings: [...review.warnings],
  };
}

export function deriveOpeningPrincipalFromDocument(
  defaults: Pick<DocumentFirstDefaults, "financedPrincipalAmount" | "explicitCurrentPrincipal" | "schedule">,
  onboardingMode: DocumentFirstOnboardingMode,
  lastPaidInstallment: number,
): number | null {
  if (defaults.explicitCurrentPrincipal != null && defaults.explicitCurrentPrincipal >= 0) return defaults.explicitCurrentPrincipal;
  const financed = defaults.financedPrincipalAmount;
  if (financed == null || !Number.isFinite(financed) || financed < 0) return null;
  if (onboardingMode === "NEW_DEBT" || lastPaidInstallment <= 0) return financed;

  const paidRows = defaults.schedule.filter((row) => {
    const contractualNumber = row.contractualInstallmentNumber ?? row.installmentNumber;
    return contractualNumber <= lastPaidInstallment && row.rowRole !== "down_payment";
  });
  if (paidRows.some((row) => row.expectedPrincipal == null || !Number.isFinite(row.expectedPrincipal))) return null;
  const paidFinancedPrincipal = paidRows.reduce((sum, row) => sum + (row.expectedPrincipal ?? 0), 0);
  return Math.max(0, Math.round((financed - paidFinancedPrincipal + Number.EPSILON) * 100) / 100);
}

export function scheduleWithPretracking(
  schedule: DebtScheduleInstallmentInput[],
  onboardingMode: DocumentFirstOnboardingMode,
  lastPaidInstallment: number,
): DebtScheduleInstallmentInput[] {
  return schedule.map((row) => ({
    ...row,
    isPaidBeforeTracking: onboardingMode === "EXISTING_DEBT"
      && (row.contractualInstallmentNumber ?? row.installmentNumber) <= lastPaidInstallment,
  }));
}

export function periodicRateBasis(value: string | null): PeriodicRateBasis | null {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "monthly" || normalized === "biweekly" || normalized === "weekly" || normalized === "daily" ? normalized : null;
}
