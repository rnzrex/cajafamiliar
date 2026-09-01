import type {
  BankDocumentScheduleExtractionRow,
  BankInsuranceExtraction,
} from "./bankDocumentExtraction.js";

const INSURANCE_RECONCILIATION_TOLERANCE = 0.05;
const MIN_MATCHING_INSURANCE_ROWS = 2;
const MIN_MATCH_RATIO = 0.8;

export interface BankInsuranceTermsNormalizationInput {
  insuranceTerms: BankInsuranceExtraction[];
  schedule: BankDocumentScheduleExtractionRow[];
  extractionWarnings: string[];
}

export interface BankInsuranceTermsNormalizationResult {
  /** Every documentary term, including policies that do not affect instalments. */
  documentaryInsuranceTerms: BankInsuranceExtraction[];
  /** Only terms safe to persist and pass to the debt/prepayment engines. */
  operationalInsuranceTerms: BankInsuranceExtraction[];
}

function normalizedText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isFinitePositive(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

function isFiniteNonNegative(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value >= 0;
}

function insurancePairs(schedule: BankDocumentScheduleExtractionRow[]): Array<{ previousBalance: number; insurance: number }> {
  const rows = [...schedule]
    .filter((row) => Number.isInteger(row.contractualInstallmentNumber))
    .sort((left, right) => left.contractualInstallmentNumber - right.contractualInstallmentNumber);
  const pairs: Array<{ previousBalance: number; insurance: number }> = [];
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]!;
    const current = rows[index]!;
    if (current.contractualInstallmentNumber !== previous.contractualInstallmentNumber + 1) continue;
    if (!isFinitePositive(previous.reportedBalance) || !isFiniteNonNegative(current.insurance)) continue;
    pairs.push({ previousBalance: previous.reportedBalance, insurance: current.insurance });
  }
  return pairs;
}

function hasContradictoryFormulaEvidence(warnings: string[]): boolean {
  const text = normalizedText(warnings.join(" "));
  return /(?:seguro|desgravamen|poliza|proteccion de pagos).{0,120}(?:monto|importe|cargo).{0,60}(?:fijo|fija|flat|unico|unica|adelantad)/.test(text)
    || /(?:fijo|fija|flat|unico|unica|adelantad).{0,120}(?:seguro|desgravamen|poliza|proteccion de pagos)/.test(text);
}

/**
 * Infers only the documented credit-life formula that the official schedule
 * itself demonstrates. The first scheduled row is intentionally ignored: it
 * may cover an irregular opening period and cannot veto later evidence.
 */
export function inferBankInsurancePricingFromSchedule(
  insurance: BankInsuranceExtraction,
  schedule: BankDocumentScheduleExtractionRow[],
  extractionWarnings: string[] = [],
): BankInsuranceExtraction {
  if (
    insurance.insuranceType !== "credit_life"
    || insurance.pricingMode !== "unknown"
    || insurance.ratePercent == null
    || !Number.isFinite(insurance.ratePercent)
    || insurance.ratePercent <= 0
    || insurance.fixedAmount != null
    || insurance.affectsInstallmentSchedule === false
    || hasContradictoryFormulaEvidence(extractionWarnings)
    || schedule.length === 0
  ) return insurance;

  const pairs = insurancePairs(schedule);
  if (pairs.length < MIN_MATCHING_INSURANCE_ROWS) return insurance;

  const matchingPairs = pairs.filter(({ previousBalance, insurance: amount }) =>
    Math.abs(previousBalance * insurance.ratePercent! / 100 - amount) <= INSURANCE_RECONCILIATION_TOLERANCE,
  );
  const matchRatio = matchingPairs.length / pairs.length;
  if (matchingPairs.length < MIN_MATCHING_INSURANCE_ROWS || matchRatio < MIN_MATCH_RATIO) return insurance;

  return { ...insurance, pricingMode: "percent_outstanding_balance" };
}

function hasAuxiliaryLabel(term: BankInsuranceExtraction): boolean {
  const label = normalizedText(term.label);
  return term.insuranceType === "other" && /proteccion de pagos|seguro auxiliar|poliza auxiliar|seguro separado|poliza separada/.test(label);
}

function hasSeparateCertificateEvidence(warnings: string[]): boolean {
  const text = normalizedText(warnings.join(" "));
  return /(?:certificado|poliza).{0,100}(?:separado|separada|independiente|aparte)|(?:separado|separada|independiente|aparte).{0,100}(?:certificado|poliza)/.test(text);
}

function hasZeroScheduleEvidence(warnings: string[]): boolean {
  const text = normalizedText(warnings.join(" "));
  return /(?:cronograma|cuota|cuotas).{0,160}(?:seguro|poliza|proteccion de pagos).{0,160}(?:\ben\s*0(?:[.,]0{1,2})?\b|\b0(?:[.,]0{1,2})?\b|sin\s+(?:importe|cargo|costo))/.test(text)
    || /(?:seguro|poliza|proteccion de pagos).{0,160}(?:en\s*0(?:[.,]0{1,2})?\b|sin\s+(?:importe|cargo|costo)).{0,160}(?:cronograma|cuota|cuotas)/.test(text);
}

function inferAffectsInstallmentSchedule(
  term: BankInsuranceExtraction,
  warnings: string[],
  formulaWasInferred: boolean,
): boolean | null {
  if (term.affectsInstallmentSchedule === true || term.affectsInstallmentSchedule === false) return term.affectsInstallmentSchedule;
  if (formulaWasInferred) return true;
  if (hasAuxiliaryLabel(term) && hasSeparateCertificateEvidence(warnings) && hasZeroScheduleEvidence(warnings)) return false;
  return null;
}

/**
 * Normalizes old and new external-AI JSON without requiring another provider
 * call. Unknown terms remain operational (fail closed); only explicit or
 * strongly evidenced auxiliary policies are excluded from calculations.
 */
export function normalizeBankOperationalInsuranceTerms(
  input: BankInsuranceTermsNormalizationInput,
): BankInsuranceTermsNormalizationResult {
  const documentaryInsuranceTerms = input.insuranceTerms.map((term) => {
    const inferredPricing = inferBankInsurancePricingFromSchedule(term, input.schedule, input.extractionWarnings);
    const formulaWasInferred = term.pricingMode === "unknown" && inferredPricing.pricingMode === "percent_outstanding_balance";
    return {
      ...inferredPricing,
      affectsInstallmentSchedule: inferAffectsInstallmentSchedule(inferredPricing, input.extractionWarnings, formulaWasInferred),
    };
  });
  return {
    documentaryInsuranceTerms,
    operationalInsuranceTerms: documentaryInsuranceTerms.filter((term) => term.affectsInstallmentSchedule !== false),
  };
}
