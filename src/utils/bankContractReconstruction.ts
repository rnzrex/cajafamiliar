import type { BankScheduleRowForReconciliation } from "./bankContractReconciliation.js";

export type BankInterestDayCountBasis = "actual_days_360" | "actual_days_365";
export type BankDueDateAdjustmentRule = "none" | "sunday_to_monday" | "weekend_to_next_business_day" | "contractual_dates" | "unknown";
export type BankInstallmentTotalMode = "financial_installment_plus_costs" | "total_installment_including_costs" | "unknown";
export type BankInsuranceInferenceMode = "percent_outstanding_balance" | "percent_original_principal" | "fixed_per_installment" | "fixed_total_even" | "fixed_total_upfront" | "schedule_only_unknown" | "ambiguous";

export interface BankContractInsuranceEvidence {
  pricingMode?: "percent_outstanding_balance" | "percent_original_principal" | "fixed_amount" | "contract_schedule" | "unknown";
  ratePercent?: number | null;
  fixedAmount?: number | null;
  totalAmount?: number | null;
}

export interface BankContractReconstructionInput {
  originDate: string;
  firstDueDate: string;
  ordinaryDueDay?: number | null;
  financedAmount: number;
  teaPercent: number;
  termInstallments: number;
  regularInstallmentAmount?: number | null;
  finalInstallmentAmount?: number | null;
  totalContractAmount?: number | null;
  totalInterest?: number | null;
  totalInsurance?: number | null;
  totalFees?: number | null;
  insuranceRatePercent?: number | null;
  insuranceInferenceMode?: BankInsuranceInferenceMode;
  insuranceTerms?: BankContractInsuranceEvidence[];
  fixedInsurancePerInstallment?: number | null;
  fixedInsuranceTotalEven?: number | null;
  fixedInsuranceTotalUpfront?: number | null;
  fixedFeesPerInstallment?: number | null;
  dayCountBasis?: BankInterestDayCountBasis | null;
  dueDateAdjustmentRule?: BankDueDateAdjustmentRule | null;
  installmentTotalMode?: BankInstallmentTotalMode | null;
  contractualDueDates?: string[] | null;
  contractualRows?: BankScheduleRowForReconciliation[] | null;
  /** Optional official rows used to score formula candidates without guessing. */
  observedRows?: BankScheduleRowForReconciliation[] | null;
}

export interface ReconstructedBankScheduleRow extends BankScheduleRowForReconciliation {
  contractualInstallmentNumber: number;
  dueDate: string;
  principal: number;
  interest: number;
  insurance: number;
  fees: number;
  total: number;
  remainingPrincipalBalance: number;
  interestDays: number;
}

export interface InferredBankTerms {
  dayCountBasis: BankInterestDayCountBasis;
  dueDateAdjustmentRule: BankDueDateAdjustmentRule;
  installmentTotalMode: BankInstallmentTotalMode;
  insuranceMode: BankInsuranceInferenceMode;
  insuranceRatePercent: number | null;
  regularInstallmentAmount: number | null;
}

export interface BankContractReconstructionResult {
  rows: ReconstructedBankScheduleRow[];
  inferredTerms: InferredBankTerms;
  totalPrincipal: number;
  totalInterest: number;
  totalInsurance: number;
  totalFees: number;
  totalContractAmount: number;
  finalPrincipalBalance: number;
  score: number;
  warnings: string[];
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (!value || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`Fecha inválida: ${value}`);
  return parsed;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addMonthsClamped(value: string, months: number): string {
  const source = parseIsoDate(value);
  const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(source.getUTCDate(), lastDay));
  return isoDate(target);
}

function addDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function dateDifferenceInDays(from: string, to: string): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86_400_000);
}

function adjustDueDate(value: string, rule: BankDueDateAdjustmentRule): string {
  const date = parseIsoDate(value);
  const day = date.getUTCDay();
  if (rule === "sunday_to_monday" && day === 0) return addDays(value, 1);
  if (rule === "weekend_to_next_business_day" && day === 6) return addDays(value, 2);
  if (rule === "weekend_to_next_business_day" && day === 0) return addDays(value, 1);
  return value;
}

function generatedDueDates(input: BankContractReconstructionInput, rule: BankDueDateAdjustmentRule): string[] {
  if (input.contractualDueDates?.length === input.termInstallments) return input.contractualDueDates;
  return Array.from({ length: input.termInstallments }, (_, index) => adjustDueDate(addMonthsClamped(input.firstDueDate, index), rule));
}

function effectiveInterestRate(teaPercent: number, days: number, basis: BankInterestDayCountBasis): number {
  return Math.pow(1 + teaPercent / 100, days / (basis === "actual_days_360" ? 360 : 365)) - 1;
}

function financialAnnuity(principal: number, teaPercent: number, term: number, basis: BankInterestDayCountBasis): number {
  const periodicRate = effectiveInterestRate(teaPercent, 30, basis);
  if (periodicRate <= 0) return principal / term;
  const factor = Math.pow(1 + periodicRate, term);
  return (principal * periodicRate * factor) / (factor - 1);
}

function insuranceForRow(
  balance: number,
  originalPrincipal: number,
  index: number,
  ratePercent: number | null,
  mode: BankInsuranceInferenceMode,
  input: BankContractReconstructionInput,
): number {
  if (mode === "percent_outstanding_balance" && ratePercent != null) return round2(balance * ratePercent / 100);
  if (mode === "percent_original_principal" && ratePercent != null) return round2(originalPrincipal * ratePercent / 100);
  if (mode === "fixed_per_installment") return round2(input.fixedInsurancePerInstallment ?? 0);
  if (mode === "fixed_total_even") {
    const total = input.fixedInsuranceTotalEven ?? 0;
    const regular = round2(total / input.termInstallments);
    return index === input.termInstallments - 1 ? round2(total - regular * (input.termInstallments - 1)) : regular;
  }
  if (mode === "fixed_total_upfront") return index === 0 ? round2(input.fixedInsuranceTotalUpfront ?? 0) : 0;
  return 0;
}

function buildRows(
  input: BankContractReconstructionInput,
  dayBasis: BankInterestDayCountBasis,
  dateRule: BankDueDateAdjustmentRule,
  insuranceRatePercent: number | null,
  insuranceMode: BankInsuranceInferenceMode,
  includeWarnings = true,
): { rows: ReconstructedBankScheduleRow[]; totalPrincipal: number; totalInterest: number; totalInsurance: number; totalFees: number; totalContractAmount: number; warnings: string[] } {
  const dates = generatedDueDates(input, dateRule);
  const feesPerInstallment = round2(input.fixedFeesPerInstallment ?? 0);
  const totalMode = input.installmentTotalMode ?? "total_installment_including_costs";
  const regular = input.regularInstallmentAmount != null
    ? round2(input.regularInstallmentAmount)
    : input.totalContractAmount != null
      ? round2(input.totalContractAmount / input.termInstallments)
      : round2(financialAnnuity(input.financedAmount, input.teaPercent, input.termInstallments, dayBasis));
  const financialPayment = round2(financialAnnuity(input.financedAmount, input.teaPercent, input.termInstallments, dayBasis));
  let balance = round2(input.financedAmount);
  const rows: ReconstructedBankScheduleRow[] = [];
  const warnings: string[] = [];

  for (let index = 0; index < input.termInstallments; index++) {
    const previousDate = index === 0 ? input.originDate : dates[index - 1];
    const dueDate = dates[index];
    const days = dateDifferenceInDays(previousDate, dueDate);
    const interest = round2(balance * effectiveInterestRate(input.teaPercent, days, dayBasis));
    const insurance = insuranceForRow(balance, input.financedAmount, index, insuranceRatePercent, insuranceMode, input);
    const fees = feesPerInstallment;
    const targetPayment = index === input.termInstallments - 1 && input.finalInstallmentAmount != null
      ? round2(input.finalInstallmentAmount)
      : regular;
    let principal: number;
    if (index === input.termInstallments - 1) {
      principal = round2(balance);
    } else if (totalMode === "financial_installment_plus_costs") {
      principal = round2(financialPayment - interest);
    } else {
      principal = round2(targetPayment - interest - insurance - fees);
    }
    if (principal < 0) {
      if (includeWarnings) warnings.push(`La cuota ${index + 1} no cubre el interés y los costos conocidos.`);
      principal = 0;
    }
    principal = Math.min(principal, balance);
    const total = index === input.termInstallments - 1
      ? round2(principal + interest + insurance + fees)
      : totalMode === "financial_installment_plus_costs"
        ? round2(financialPayment + insurance + fees)
        : round2(principal + interest + insurance + fees);
    balance = round2(Math.max(0, balance - principal));
    rows.push({
      contractualInstallmentNumber: index + 1,
      dueDate,
      principal,
      interest,
      insurance,
      fees,
      total,
      remainingPrincipalBalance: balance,
      interestDays: days,
    });
  }

  return {
    rows,
    totalPrincipal: round2(rows.reduce((sum, row) => sum + row.principal, 0)),
    totalInterest: round2(rows.reduce((sum, row) => sum + row.interest, 0)),
    totalInsurance: round2(rows.reduce((sum, row) => sum + row.insurance, 0)),
    totalFees: round2(rows.reduce((sum, row) => sum + row.fees, 0)),
    totalContractAmount: round2(rows.reduce((sum, row) => sum + row.total, 0)),
    warnings,
  };
}

function inferOutstandingRate(input: BankContractReconstructionInput, dayBasis: BankInterestDayCountBasis, dateRule: BankDueDateAdjustmentRule): number | null {
  if (input.insuranceRatePercent != null) return input.insuranceRatePercent;
  if (input.totalInsurance == null || input.totalInsurance < 0) return null;
  let low = 0;
  let high = 10;
  for (let iteration = 0; iteration < 80; iteration++) {
    const candidate = (low + high) / 2;
    const result = buildRows(input, dayBasis, dateRule, candidate, "percent_outstanding_balance", false);
    if (result.totalInsurance < input.totalInsurance) low = candidate;
    else high = candidate;
  }
  return round2((low + high) / 2);
}

function insuranceModeFromEvidence(input: BankContractReconstructionInput): BankInsuranceInferenceMode | null {
  const modes = Array.from(new Set((input.insuranceTerms ?? []).flatMap((term) => {
    if (term.pricingMode === "percent_outstanding_balance") return ["percent_outstanding_balance" as const];
    if (term.pricingMode === "percent_original_principal") return ["percent_original_principal" as const];
    if (term.pricingMode === "fixed_amount" && term.fixedAmount != null && term.totalAmount == null) return ["fixed_per_installment" as const];
    return [];
  })));
  return modes.length === 1 ? modes[0] : modes.length > 1 ? "ambiguous" : null;
}

interface InsuranceCandidate {
  mode: BankInsuranceInferenceMode;
  ratePercent: number | null;
  fixedInsurancePerInstallment: number | null;
  fixedInsuranceTotalEven: number | null;
  fixedInsuranceTotalUpfront: number | null;
}

function insuranceCandidates(input: BankContractReconstructionInput, basis: BankInterestDayCountBasis, rule: BankDueDateAdjustmentRule): InsuranceCandidate[] {
  const explicitMode = input.insuranceInferenceMode;
  if (explicitMode && explicitMode !== "ambiguous") {
    return [{
      mode: explicitMode,
      ratePercent: input.insuranceRatePercent ?? (explicitMode === "percent_outstanding_balance" ? inferOutstandingRate(input, basis, rule) : explicitMode === "percent_original_principal" && input.totalInsurance != null ? round2(input.totalInsurance / input.financedAmount * 100) : null),
      fixedInsurancePerInstallment: input.fixedInsurancePerInstallment ?? null,
      fixedInsuranceTotalEven: input.fixedInsuranceTotalEven ?? null,
      fixedInsuranceTotalUpfront: input.fixedInsuranceTotalUpfront ?? null,
    }];
  }
  const evidenceMode = insuranceModeFromEvidence(input);
  if (evidenceMode) {
    return insuranceCandidates({ ...input, insuranceInferenceMode: evidenceMode }, basis, rule);
  }
  if (input.insuranceRatePercent != null) return [{ mode: "percent_outstanding_balance", ratePercent: input.insuranceRatePercent, fixedInsurancePerInstallment: null, fixedInsuranceTotalEven: null, fixedInsuranceTotalUpfront: null }];
  if (input.totalInsurance == null) return [{ mode: "schedule_only_unknown", ratePercent: null, fixedInsurancePerInstallment: null, fixedInsuranceTotalEven: null, fixedInsuranceTotalUpfront: null }];
  const total = input.totalInsurance;
  return [
    { mode: "percent_outstanding_balance", ratePercent: inferOutstandingRate(input, basis, rule), fixedInsurancePerInstallment: null, fixedInsuranceTotalEven: null, fixedInsuranceTotalUpfront: null },
    { mode: "percent_original_principal", ratePercent: round2(total / input.financedAmount * 100), fixedInsurancePerInstallment: null, fixedInsuranceTotalEven: null, fixedInsuranceTotalUpfront: null },
    { mode: "fixed_per_installment", ratePercent: null, fixedInsurancePerInstallment: total / input.termInstallments, fixedInsuranceTotalEven: null, fixedInsuranceTotalUpfront: null },
    { mode: "fixed_total_even", ratePercent: null, fixedInsurancePerInstallment: null, fixedInsuranceTotalEven: total, fixedInsuranceTotalUpfront: null },
    { mode: "fixed_total_upfront", ratePercent: null, fixedInsurancePerInstallment: null, fixedInsuranceTotalEven: null, fixedInsuranceTotalUpfront: total },
  ];
}

function candidateScore(input: BankContractReconstructionInput, result: ReturnType<typeof buildRows>): number {
  const differences: number[] = [];
  if (input.totalInterest != null) differences.push(Math.abs(result.totalInterest - input.totalInterest));
  if (input.totalInsurance != null) differences.push(Math.abs(result.totalInsurance - input.totalInsurance));
  if (input.totalContractAmount != null) differences.push(Math.abs(result.totalContractAmount - input.totalContractAmount));
  if (input.regularInstallmentAmount != null) differences.push(Math.abs(result.rows[0]?.total - input.regularInstallmentAmount));
  if (input.finalInstallmentAmount != null) differences.push(Math.abs((result.rows.at(-1)?.total ?? 0) - input.finalInstallmentAmount));
  for (const observed of input.observedRows ?? []) {
    const actual = result.rows.find((row) => row.contractualInstallmentNumber === observed.contractualInstallmentNumber);
    if (!actual) {
      differences.push(100);
      continue;
    }
    if (observed.dueDate) differences.push(Math.abs(dateDifferenceInDays(actual.dueDate, observed.dueDate)));
    for (const field of ["principal", "interest", "insurance", "fees", "total"] as const) {
      if (observed[field] != null) differences.push(Math.abs(actual[field] - observed[field]!));
    }
  }
  return differences.reduce((sum, value) => sum + value, 0);
}

function validateInput(input: BankContractReconstructionInput): void {
  if (!input.originDate || !input.firstDueDate) throw new Error("El contrato requiere fecha de origen y primer vencimiento.");
  parseIsoDate(input.originDate);
  parseIsoDate(input.firstDueDate);
  if (!Number.isFinite(input.financedAmount) || input.financedAmount <= 0) throw new Error("El monto financiado debe ser mayor a cero.");
  if (!Number.isFinite(input.teaPercent) || input.teaPercent < 0) throw new Error("La TEA debe ser un porcentaje válido.");
  if (!Number.isInteger(input.termInstallments) || input.termInstallments <= 0) throw new Error("El plazo debe ser un entero mayor a cero.");
  if (input.contractualDueDates && input.contractualDueDates.length !== input.termInstallments) throw new Error("Las fechas contractuales deben cubrir todas las cuotas.");
}

export function reconstructBankContractSchedule(input: BankContractReconstructionInput): BankContractReconstructionResult {
  validateInput(input);
  if (input.contractualRows?.length === input.termInstallments) {
    if (input.contractualRows.some((row) => [row.principal, row.interest, row.insurance, row.fees, row.total].some((value) => value == null))) {
      throw new Error("INSUFFICIENT_RECONSTRUCTION_DATA");
    }
    const rows = input.contractualRows.map((row, index) => ({
      ...row,
      contractualInstallmentNumber: row.contractualInstallmentNumber || index + 1,
      principal: row.principal!,
      interest: row.interest!,
      insurance: row.insurance!,
      fees: row.fees!,
      total: row.total!,
      remainingPrincipalBalance: row.remainingPrincipalBalance ?? 0,
      interestDays: index === 0 ? dateDifferenceInDays(input.originDate, row.dueDate) : dateDifferenceInDays(input.contractualRows![index - 1].dueDate, row.dueDate),
    }));
    return {
      rows,
      inferredTerms: {
        dayCountBasis: input.dayCountBasis ?? "actual_days_360",
        dueDateAdjustmentRule: "contractual_dates",
        installmentTotalMode: input.installmentTotalMode ?? "unknown",
        insuranceMode: input.insuranceInferenceMode ?? "schedule_only_unknown",
        insuranceRatePercent: input.insuranceRatePercent ?? null,
        regularInstallmentAmount: input.regularInstallmentAmount ?? null,
      },
      totalPrincipal: round2(rows.reduce((sum, row) => sum + row.principal, 0)),
      totalInterest: round2(rows.reduce((sum, row) => sum + row.interest, 0)),
      totalInsurance: round2(rows.reduce((sum, row) => sum + row.insurance, 0)),
      totalFees: round2(rows.reduce((sum, row) => sum + row.fees, 0)),
      totalContractAmount: round2(rows.reduce((sum, row) => sum + row.total, 0)),
      finalPrincipalBalance: round2(rows.at(-1)?.remainingPrincipalBalance ?? 0),
      score: 1,
      warnings: [],
    };
  }

  const dayBases: BankInterestDayCountBasis[] = input.dayCountBasis ? [input.dayCountBasis] : ["actual_days_360", "actual_days_365"];
  const dateRules: BankDueDateAdjustmentRule[] = input.contractualDueDates
    ? ["contractual_dates"]
    : input.dueDateAdjustmentRule && input.dueDateAdjustmentRule !== "unknown"
      ? [input.dueDateAdjustmentRule]
      : ["none", "sunday_to_monday", "weekend_to_next_business_day"];
  const totalModes: BankInstallmentTotalMode[] = input.installmentTotalMode && input.installmentTotalMode !== "unknown"
    ? [input.installmentTotalMode]
    : ["total_installment_including_costs", "financial_installment_plus_costs"];
  const candidates = dayBases.flatMap((basis) => dateRules.flatMap((rule) => totalModes.flatMap((totalMode) => insuranceCandidates(input, basis, rule).map((insurance) => {
    const candidateInput = {
      ...input,
      installmentTotalMode: totalMode,
      fixedInsurancePerInstallment: insurance.fixedInsurancePerInstallment ?? input.fixedInsurancePerInstallment,
      fixedInsuranceTotalEven: insurance.fixedInsuranceTotalEven ?? input.fixedInsuranceTotalEven,
      fixedInsuranceTotalUpfront: insurance.fixedInsuranceTotalUpfront ?? input.fixedInsuranceTotalUpfront,
    };
    const rows = buildRows(candidateInput, basis, rule, insurance.ratePercent, insurance.mode);
    return { basis, rule, totalMode, insurance, rows, score: candidateScore(input, rows) };
  }))));
  const ordered = candidates.sort((left, right) => left.score - right.score);
  const best = ordered[0];
  const tiedInsuranceCandidates = ordered.filter((candidate) => Math.abs(candidate.score - best.score) <= 0.01);
  const insuranceAmbiguous = input.insuranceInferenceMode === "ambiguous"
    || (!input.insuranceInferenceMode
    && !insuranceModeFromEvidence(input)
    && tiedInsuranceCandidates.length > 1
    && !input.observedRows?.length);
  const selectedInsuranceMode = insuranceAmbiguous ? "ambiguous" : best.insurance.mode;
  const selectedRows = insuranceAmbiguous
    ? buildRows({ ...input, installmentTotalMode: best.totalMode }, best.basis, best.rule, null, "ambiguous")
    : best.rows;
  const warnings = [...selectedRows.warnings];
  if (selectedInsuranceMode === "ambiguous") warnings.push("Hay varias fórmulas de seguro compatibles; no se eligió una fórmula arbitrariamente. Revisa el contrato.");
  if (selectedInsuranceMode === "schedule_only_unknown") warnings.push("No se pudo inferir la distribución del seguro; el cronograma reconstruido queda estimado.");
  if (best.score > 0.05) warnings.push("La reconstrucción tiene diferencias frente a los controles informados; requiere revisión.");
  return {
    rows: selectedRows.rows,
    inferredTerms: {
      dayCountBasis: best.basis,
      dueDateAdjustmentRule: best.rule,
      installmentTotalMode: best.totalMode,
      insuranceMode: selectedInsuranceMode,
      insuranceRatePercent: selectedInsuranceMode === "ambiguous" ? null : best.insurance.ratePercent,
      regularInstallmentAmount: input.regularInstallmentAmount ?? null,
    },
    totalPrincipal: selectedRows.totalPrincipal,
    totalInterest: selectedRows.totalInterest,
    totalInsurance: selectedRows.totalInsurance,
    totalFees: selectedRows.totalFees,
    totalContractAmount: selectedRows.totalContractAmount,
    finalPrincipalBalance: selectedRows.rows.at(-1)?.remainingPrincipalBalance ?? 0,
    score: round2(Math.max(0, 1 - best.score / Math.max(1, input.totalContractAmount ?? selectedRows.totalContractAmount))),
    warnings,
  };
}

export function scheduleSourceForReconstruction(
  reconciliationStatus: "exact" | "within_tolerance" | "inconsistent" | "insufficient_data",
  hasOfficialRows: boolean,
): "contractual" | "reconstructed" | "estimated" {
  if (hasOfficialRows) return "contractual";
  if (reconciliationStatus === "exact" || reconciliationStatus === "within_tolerance") return "reconstructed";
  return "estimated";
}
