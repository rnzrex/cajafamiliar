import type {
  DebtContractAuthority,
  DebtCreateInput,
  DebtFinancingContract,
  DebtKind,
  DebtScheduleInstallmentInput,
  HouseholdMember,
  ScheduleSource,
} from "../types";
import { householdId, isSupabaseConfigured, supabase } from "./supabaseClient";
import { loadAppData, type DebtCreateResult } from "./dataRepository";
import type { DocumentFirstHistoryMode, DocumentFirstOnboardingMode } from "../utils/debtDocumentFirstOnboarding";

export interface CreateDebtFromDocumentInput {
  member: HouseholdMember;
  debtId: string;
  onboardingMode: DocumentFirstOnboardingMode;
  debtKind: Exclude<DebtKind, "credit_card">;
  name: string;
  creditorName: string;
  currencyCode: "PEN" | "USD";
  originDate: string | null;
  trackingStartDate: string;
  originalPrincipal: number;
  openingPrincipalBalance: number;
  plannedInstallmentCount: number | null;
  plannedInstallmentAmount: number | null;
  installmentAmountMode: DebtCreateInput["installmentAmountMode"];
  paymentFrequency: DebtCreateInput["paymentFrequency"];
  customFrequencyDays: number | null;
  firstDueDate: string | null;
  teaPercent: number | null;
  tceaPercent: number | null;
  notes: string;
  repaymentStructure: DebtCreateInput["repaymentStructure"];
  interestCalculationMode: DebtCreateInput["interestCalculationMode"];
  periodicRatePercent: number | null;
  periodicRateBasis: DebtCreateInput["periodicRateBasis"];
  schedule: DebtScheduleInstallmentInput[];
  scheduleSource: ScheduleSource;
  scheduleAuthority: DebtContractAuthority;
  lastPaidInstallment: number;
  historyMode: DocumentFirstHistoryMode;
  contract: Partial<DebtFinancingContract>;
  documentKind: "contract" | "schedule" | "refinance" | "statement" | "other";
  documentAuthority: DebtContractAuthority;
  authorityEvidence: string;
  normalizedMetadata: Record<string, unknown>;
}

function scheduleRpcRows(rows: DebtScheduleInstallmentInput[]): Array<Record<string, unknown>> {
  return rows.map((row, index) => ({
    installment_number: index + 1,
    contractual_installment_number: row.contractualInstallmentNumber ?? row.installmentNumber ?? index + 1,
    is_paid_before_tracking: Boolean(row.isPaidBeforeTracking),
    due_date: row.dueDate,
    expected_amount: row.expectedAmount ?? null,
    expected_principal: row.expectedPrincipal ?? null,
    expected_interest: row.expectedInterest ?? null,
    expected_fees: row.expectedFees ?? null,
    expected_insurance: row.expectedInsurance ?? null,
    expected_taxes: row.expectedTaxes ?? null,
    reported_balance: row.reportedBalance ?? null,
    row_role: row.rowRole ?? "installment",
    phase: row.phase ?? null,
    evidence: row.evidence ?? {},
  }));
}

function contractRpcPayload(contract: Partial<DebtFinancingContract>, openingPrincipalBalance: number): Record<string, unknown> {
  return {
    contract_authority: contract.contractAuthority ?? "unknown",
    principal_basis: contract.principalBasis ?? "unknown",
    asset_price: contract.assetPrice ?? null,
    down_payment_amount: contract.downPaymentAmount ?? null,
    scheduled_principal_amount: contract.scheduledPrincipalAmount ?? null,
    financed_principal_amount: contract.financedPrincipalAmount ?? null,
    opening_principal_amount: openingPrincipalBalance,
    repayment_structure: contract.repaymentStructure ?? "fixed_schedule",
    amortization_method: contract.amortizationMethod ?? "unknown",
    installment_amount_mode: contract.installmentAmountMode ?? "unknown",
    payment_frequency: contract.paymentFrequency ?? null,
    custom_frequency_days: contract.customFrequencyDays ?? null,
    first_due_date: contract.firstDueDate ?? null,
    interest_rate_type: contract.interestRateType ?? "unknown",
    interest_rate_percent: contract.interestRatePercent ?? null,
    interest_rate_basis: contract.interestRateBasis ?? null,
    day_count_basis: contract.dayCountBasis ?? "unknown",
    fee_rule_type: contract.feeRuleType ?? "unknown",
    fee_rule: contract.feeRule ?? {},
    prepayment_terms: contract.prepaymentTerms ?? {},
    authority_notes: contract.authorityNotes ?? "",
  };
}

export async function createDebtFromDocument(input: CreateDebtFromDocumentInput): Promise<DebtCreateResult> {
  if (!isSupabaseConfigured || !supabase) throw new Error("El onboarding documental requiere conexión a Supabase.");
  if (input.member.householdId !== householdId) throw new Error("El hogar autenticado no coincide con la sesión activa.");

  const { data, error } = await supabase.rpc("create_debt_from_document_v1", {
    p_household_id: input.member.householdId,
    p_debt_id: input.debtId,
    p_onboarding_mode: input.onboardingMode,
    p_name: input.name,
    p_creditor_name: input.creditorName,
    p_debt_kind: input.debtKind,
    p_currency_code: input.currencyCode,
    p_origin_date: input.originDate,
    p_tracking_start_date: input.trackingStartDate,
    p_original_principal: input.originalPrincipal,
    p_opening_principal_balance: input.openingPrincipalBalance,
    p_planned_installment_count: input.plannedInstallmentCount,
    p_planned_installment_amount: input.plannedInstallmentAmount,
    p_installment_amount_mode: input.installmentAmountMode,
    p_payment_frequency: input.paymentFrequency,
    p_custom_frequency_days: input.customFrequencyDays,
    p_first_due_date: input.firstDueDate,
    p_tea_percent: input.teaPercent,
    p_tcea_percent: input.tceaPercent,
    p_notes: input.notes,
    p_installments: scheduleRpcRows(input.schedule),
    p_repayment_structure: input.repaymentStructure,
    p_interest_calculation_mode: input.interestCalculationMode,
    p_periodic_rate_percent: input.periodicRatePercent,
    p_periodic_rate_basis: input.periodicRateBasis,
    p_contract: contractRpcPayload(input.contract, input.openingPrincipalBalance),
    p_schedule_source: input.scheduleSource,
    p_schedule_authority: input.scheduleAuthority,
    p_last_paid_installment: input.lastPaidInstallment,
    p_history_mode: input.historyMode,
    p_document_kind: input.documentKind,
    p_document_authority: input.documentAuthority,
    p_authority_evidence: input.authorityEvidence,
    p_normalized_metadata: input.normalizedMetadata,
  });
  if (error) throw error;
  if (!data || typeof data !== "object") throw new Error("La creación documental no devolvió un resultado válido.");

  const refreshed = await loadAppData(input.member);
  const debt = refreshed.data.debts.find((item) => item.id === input.debtId);
  if (!debt) throw new Error("La deuda fue creada, pero no pudo recargarse desde Production.");
  const scheduleVersions = refreshed.data.debtScheduleVersions
    .filter((item) => item.debtId === input.debtId)
    .sort((a, b) => b.versionNumber - a.versionNumber);
  const scheduleVersion = scheduleVersions[0] ?? null;
  const installments = scheduleVersion
    ? refreshed.data.debtInstallments.filter((item) => item.debtId === input.debtId && item.scheduleVersionId === scheduleVersion.id)
    : [];
  const collaterals = refreshed.data.debtCollaterals.filter((item) => item.debtId === input.debtId);
  return { debt, scheduleVersion, installments, collaterals };
}
