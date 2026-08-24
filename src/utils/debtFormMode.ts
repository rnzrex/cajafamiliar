import type { DebtKind, DebtPaymentFrequency, DebtInstallmentAmountMode, DebtRepaymentStructure, DebtInterestCalculationMode, PeriodicRateBasis } from "../types";
import type { DebtCreateInput } from "../services/dataRepository";
import { localDateString } from "./date";

export function isCreditCardDebtKind(kind: DebtKind): boolean {
  return kind === "credit_card";
}

export const DEBT_KIND_OPTIONS: Array<{ value: DebtKind; label: string }> = [
  { value: "bank_loan", label: "Préstamo bancario" },
  { value: "family_loan", label: "Préstamo familiar" },
  { value: "installment_purchase", label: "Compra en cuotas" },
  { value: "mortgage", label: "Hipoteca" },
  { value: "pledge", label: "Empeño" },
  { value: "credit_card", label: "Tarjeta de crédito" },
  { value: "other", label: "Otra" },
];

export type SupportedCurrency = "PEN" | "USD";

export const SUPPORTED_CURRENCIES: Array<{ code: SupportedCurrency; symbol: string; label: string }> = [
  { code: "PEN", symbol: "S/", label: "PEN — S/ Sol peruano" },
  { code: "USD", symbol: "$", label: "USD — $ Dólar estadounidense" },
];

export function getCurrencySymbol(code: string): string {
  return code === "USD" ? "$" : "S/";
}

export function formatReviewDate(value?: string | null): string {
  if (!value || !value.trim()) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

export interface PledgeCollateralInput {
  pledgeItemDescription: string;
  pledgeRedemptionDeadline?: string | null;
  pledgeEstimatedValue?: string | number | null;
  pledgePledgedValue?: string | number | null;
}

export function buildPledgeCollateralList(
  primary: PledgeCollateralInput,
  extraCollaterals: Array<{
    description: string;
    pledgedValue: string;
    estimatedValue: string;
    redemptionDeadline: string;
  }> = []
) {
  const primaryItem = {
    description: primary.pledgeItemDescription.trim(),
    pledgedValue: primary.pledgePledgedValue ? Number(primary.pledgePledgedValue) : null,
    estimatedValue: primary.pledgeEstimatedValue ? Number(primary.pledgeEstimatedValue) : null,
    redemptionDeadline: primary.pledgeRedemptionDeadline || null,
  };

  const extras = extraCollaterals
    .filter((c) => c.description.trim().length > 0)
    .map((c) => ({
      description: c.description.trim(),
      pledgedValue: c.pledgedValue ? Number(c.pledgedValue) : null,
      estimatedValue: c.estimatedValue ? Number(c.estimatedValue) : null,
      redemptionDeadline: c.redemptionDeadline || null,
    }));

  return [primaryItem, ...extras];
}

export interface DebtOnboardingInputParams {
  debtId: string;
  debtKind: DebtKind;
  onboardingMode: "EXISTING_DEBT" | "NEW_DEBT";
  currencyCode: SupportedCurrency;
  name: string;
  creditorName: string;
  openingPrincipalBalance: string | number;
  originalPrincipal?: string | number | null;
  originDate?: string | null;
  trackingStartDate?: string | null;
  paymentFrequency?: DebtPaymentFrequency | null;
  customFrequencyDays?: string | number | null;
  firstDueDate?: string | null;
  plannedInstallmentCount?: string | number | null;
  plannedInstallmentAmount?: string | number | null;
  installmentAmountMode?: DebtInstallmentAmountMode;
  teaPercent?: string | number | null;
  tceaPercent?: string | number | null;
  notes?: string | null;
  pledgeItemDescription?: string;
  pledgeRedemptionDeadline?: string;
  pledgeEstimatedValue?: string;
  pledgePledgedValue?: string;
  installments?: any[];
  extraCollaterals?: any[];
  repaymentStructure?: DebtRepaymentStructure;
  interestCalculationMode?: DebtInterestCalculationMode;
  periodicRatePercent?: string | number | null;
  periodicRateBasis?: PeriodicRateBasis | null;
}

export function buildDebtCreateInputPayload(params: DebtOnboardingInputParams): DebtCreateInput {
  const isPledge = params.debtKind === "pledge";
  const isNewDebt = params.onboardingMode === "NEW_DEBT";
  const numOwed = Number(params.openingPrincipalBalance);

  const finalName = isPledge
    ? params.name.trim() || `Empeño: ${(params.pledgeItemDescription || "").trim()}`
    : params.name.trim();

  let finalOriginalPrincipal: number | null = null;
  if (isNewDebt) {
    finalOriginalPrincipal = numOwed;
  } else {
    finalOriginalPrincipal = params.originalPrincipal ? Number(params.originalPrincipal) : null;
  }

  const todayStr = localDateString(new Date());
  const finalOriginDate = isNewDebt && !params.originDate
    ? (params.trackingStartDate || todayStr)
    : (params.originDate || null);

  const collaterals = isPledge
    ? buildPledgeCollateralList(
        {
          pledgeItemDescription: params.pledgeItemDescription || "",
          pledgeRedemptionDeadline: params.pledgeRedemptionDeadline,
          pledgeEstimatedValue: params.pledgeEstimatedValue,
          pledgePledgedValue: params.pledgePledgedValue,
        },
        params.extraCollaterals || []
      )
    : (params.extraCollaterals || [])
        .filter((c) => c.description && c.description.trim().length > 0)
        .map((c) => ({
          description: c.description.trim(),
          pledgedValue: c.pledgedValue ? Number(c.pledgedValue) : null,
          estimatedValue: c.estimatedValue ? Number(c.estimatedValue) : null,
          redemptionDeadline: c.redemptionDeadline || null,
        }));

  return {
    debtId: params.debtId,
    name: finalName,
    creditorName: params.creditorName.trim(),
    debtKind: params.debtKind,
    currencyCode: params.currencyCode,
    originDate: finalOriginDate,
    trackingStartDate: params.trackingStartDate || todayStr,
    originalPrincipal: finalOriginalPrincipal,
    openingPrincipalBalance: numOwed,
    plannedInstallmentCount: params.repaymentStructure === "open_ended"
      ? null
      : (params.plannedInstallmentCount ? Number(params.plannedInstallmentCount) : null),
    plannedInstallmentAmount: params.plannedInstallmentAmount ? Number(params.plannedInstallmentAmount) : null,
    installmentAmountMode: params.installmentAmountMode || "unknown",
    paymentFrequency: params.paymentFrequency || null,
    customFrequencyDays: params.customFrequencyDays ? Number(params.customFrequencyDays) : null,
    firstDueDate: params.repaymentStructure === "open_ended" ? null : (params.firstDueDate || null),
    teaPercent: params.teaPercent ? Number(params.teaPercent) : null,
    tceaPercent: params.tceaPercent ? Number(params.tceaPercent) : null,
    notes: params.notes || "",
    installments: params.repaymentStructure === "open_ended"
      ? []
      : (params.installments || []).map((i) => ({
          installmentNumber: i.installmentNumber,
          dueDate: i.dueDate,
          expectedAmount: i.expectedAmount ? Number(i.expectedAmount) : null,
          expectedPrincipal: i.expectedPrincipal ? Number(i.expectedPrincipal) : null,
          expectedInterest: i.expectedInterest ? Number(i.expectedInterest) : null,
          expectedFees: i.expectedFees ? Number(i.expectedFees) : null,
          expectedInsurance: i.expectedInsurance ? Number(i.expectedInsurance) : null,
        })),
    collaterals,
    repaymentStructure: params.repaymentStructure ?? "unknown",
    interestCalculationMode: params.interestCalculationMode ?? "unknown",
    periodicRatePercent: params.periodicRatePercent ? Number(params.periodicRatePercent) : null,
    periodicRateBasis: params.periodicRateBasis ?? null,
  };
}

export function validateDebtFinancialTerms(input: {
  interestCalculationMode?: string | null;
  periodicRatePercent?: string | number | null;
  periodicRateBasis?: string | null;
  teaPercent?: string | number | null;
}): { valid: boolean; error?: string } {
  const mode = input.interestCalculationMode;
  if (mode === "contract_periodic_rate") {
    const rate = input.periodicRatePercent != null && input.periodicRatePercent !== "" ? Number(input.periodicRatePercent) : null;
    const basis = input.periodicRateBasis;
    if (rate == null || isNaN(rate) || rate <= 0 || !basis) {
      return {
        valid: false,
        error: "La tasa periódica contractual requiere un porcentaje mayor a 0 y una frecuencia válida (mensual, quincenal, semanal o diaria).",
      };
    }
  } else if (mode === "tea_estimate") {
    const tea = input.teaPercent != null && input.teaPercent !== "" ? Number(input.teaPercent) : null;
    if (tea == null || isNaN(tea) || tea <= 0) {
      return {
        valid: false,
        error: "La estimación por TEA requiere especificar una Tasa Efectiva Anual (TEA) mayor a 0%.",
      };
    }
  }
  return { valid: true };
}
