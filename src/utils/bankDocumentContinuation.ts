import type { BankDocumentExtraction, BankDocumentScheduleExtractionRow } from "./bankDocumentExtraction.js";
import type { BankFinancialValidationResult } from "./bankDocumentFinancialValidation.js";
import type { BankScheduleContinuityIssue } from "./bankContractReconciliation.js";

export interface BankDocumentContinuationInput {
  extraction: BankDocumentExtraction;
  validation: BankFinancialValidationResult;
  onboardingMode: "EXISTING_DEBT" | "NEW_DEBT";
  lastPaidContractualInstallment: number | null | undefined;
}

export interface BankDocumentContinuationResult {
  canContinue: boolean;
  historicalAnomaly: boolean;
  historicalIssues: BankScheduleContinuityIssue[];
  futureIssues: BankScheduleContinuityIssue[];
  futureMissingFields: string[];
  blockingConflicts: string[];
}

const REQUIRED_PENDING_FIELDS: Array<keyof Pick<BankDocumentScheduleExtractionRow, "principal" | "interest" | "insurance" | "fees" | "total">> = [
  "principal", "interest", "insurance", "fees", "total",
];

function isFiniteNonNegative(value: number | null | undefined): boolean {
  return value != null && Number.isFinite(value) && value >= 0;
}

function rowsAreContinuous(rows: BankDocumentScheduleExtractionRow[]): boolean {
  return rows.length > 0 && rows.every((row, index) => index === 0 || row.contractualInstallmentNumber === rows[index - 1]!.contractualInstallmentNumber + 1);
}

function datesAreIncreasing(rows: BankDocumentScheduleExtractionRow[]): boolean {
  return rows.length > 0 && rows.every((row, index) => index === 0 || row.dueDate > rows[index - 1]!.dueDate);
}

function isBenignDueDayConflict(field: string): boolean {
  return new Set(["ordinaryDueDay", "dueDay", "paymentDay", "preliminaryDueDay"]).has(field);
}

function conflictIsFuture(field: string, rows: BankDocumentScheduleExtractionRow[], lastPaid: number): boolean {
  const match = field.match(/^schedule\[(\d+)\]/);
  if (!match) return true;
  const row = rows[Number(match[1])];
  return row == null || row.contractualInstallmentNumber > lastPaid;
}

/**
 * Separates an historical document anomaly from an unsafe future contract
 * anomaly. It is intentionally pure so the save gate and regression tests use
 * the same policy as the review UI.
 */
export function evaluateBankDocumentContinuation(input: BankDocumentContinuationInput): BankDocumentContinuationResult {
  const rows = input.extraction.schedule;
  const lastPaid = input.lastPaidContractualInstallment;
  const validLastPaid = Number.isInteger(lastPaid) && (lastPaid ?? 0) >= 1;
  const historicalIssues = validLastPaid
    ? input.validation.continuityIssues.filter((issue) => issue.contractualInstallmentNumber <= (lastPaid ?? 0))
    : [];
  const futureIssues = validLastPaid
    ? input.validation.continuityIssues.filter((issue) => issue.contractualInstallmentNumber > (lastPaid ?? 0))
    : input.validation.continuityIssues;
  const futureMissingFields = validLastPaid
    ? rows
      .filter((row) => row.contractualInstallmentNumber > (lastPaid ?? 0))
      .flatMap((row) => REQUIRED_PENDING_FIELDS
        .filter((field) => row[field] == null || !Number.isFinite(row[field] as number))
        .map((field) => `schedule[${rows.indexOf(row)}].${field}`))
    : [];
  const blockingConflicts = input.extraction.fieldConflicts
    .filter((conflict) => !isBenignDueDayConflict(conflict.field))
    .filter((conflict) => !validLastPaid || conflictIsFuture(conflict.field, rows, lastPaid ?? 0))
    .map((conflict) => conflict.field);

  const expectedInstallments = input.extraction.termInstallments;
  const first = rows[0]?.contractualInstallmentNumber ?? null;
  const last = rows.at(-1)?.contractualInstallmentNumber ?? null;
  const structurallyFull = expectedInstallments != null
    && rows.length === expectedInstallments
    && first === 1
    && last === expectedInstallments
    && rowsAreContinuous(rows)
    && datesAreIncreasing(rows);
  const structurallyPendingOnly = input.onboardingMode === "EXISTING_DEBT"
    && validLastPaid
    && expectedInstallments != null
    && first === (lastPaid ?? 0) + 1
    && last === expectedInstallments
    && rowsAreContinuous(rows)
    && datesAreIncreasing(rows);
  const cutOffRow = validLastPaid ? rows.find((row) => row.contractualInstallmentNumber === lastPaid) : undefined;
  const hasReliableCutOffBalance = isFiniteNonNegative(cutOffRow?.reportedBalance);
  const canAnchorAtCutOff = input.onboardingMode === "EXISTING_DEBT"
    && validLastPaid
    && hasReliableCutOffBalance
    && (structurallyFull || structurallyPendingOnly)
    && futureIssues.length === 0
    && futureMissingFields.length === 0
    && blockingConflicts.length === 0;
  const inconsistent = input.validation.reconciliation?.status === "inconsistent";
  const structurallySafe = (structurallyFull || structurallyPendingOnly)
    && futureIssues.length === 0
    && futureMissingFields.length === 0
    && blockingConflicts.length === 0;
  const canContinueWithoutMathAnomaly = input.onboardingMode === "NEW_DEBT"
    ? structurallyFull && structurallySafe
    : structurallySafe;

  return {
    // An incomplete or structurally unsafe official schedule must not pass
    // merely because aggregate reconciliation downgraded to insufficient_data.
    // Existing debt gets the narrower historical exception only when row K is
    // an explicit, reliable cut-off and every future row remains coherent.
    canContinue: inconsistent ? canAnchorAtCutOff : canContinueWithoutMathAnomaly,
    historicalAnomaly: Boolean(inconsistent && canAnchorAtCutOff && (historicalIssues.length > 0 || input.validation.reconciliation?.status === "inconsistent")),
    historicalIssues,
    futureIssues,
    futureMissingFields,
    blockingConflicts,
  };
}

export function bankHistoricalAnomalyWarning(): string {
  return "El documento bancario contiene una diferencia aritmética en una cuota histórica. Caja Familiar conserva el cronograma original y comenzará desde el saldo contractual confirmado después de tu última cuota pagada.";
}

function normalizedWarning(warning: string): string {
  return warning
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isAuxiliaryInsuranceWarning(warning: string): boolean {
  return /proteccion de pagos|seguro auxiliar|poliza auxiliar|certificado separado|poliza separada/.test(warning);
}

function isBenignWarning(warning: string): boolean {
  const normalized = normalizedWarning(warning);
  const rowZero = /fila\b.*\bnum(?:ero)?\s*\.?\s*0\b.*(?:desembolso|apertura)|(?:desembolso|apertura).*fila\b.*\bnum(?:ero)?\s*\.?\s*0\b/.test(normalized);
  const duplicateSummary = /(?:copia|duplicad|repetid).{0,120}(?:hoja resumen|summary|pagina|documento)|(?:hoja resumen|summary).{0,120}(?:copia|duplicad|repetid)/.test(normalized);
  const otherProducts = /contrato\s+(?:general|marco)/.test(normalized)
    && /(?:otro|vario|producto|seccion|secciones)/.test(normalized);
  const itfWithoutAmount = /\bitf\b/.test(normalized)
    && /(?:no|sin).{0,60}(?:desglos|importe|cuota|fila)/.test(normalized);
  const programmedBalanceWarning = /saldo(?:\s+de)?(?:\s+capital)?/.test(normalized)
    && /(?:no demuestra|no demuestran|no prueba|no prueban)/.test(normalized)
    && /(?:saldo vigente|cuota|pago)/.test(normalized);
  const separateAuxiliarySchedule = isAuxiliaryInsuranceWarning(normalized)
    && /(?:cronograma|cuota|en\s*0|certificado separado|poliza separada)/.test(normalized);
  const preliminaryDay = /(?:solicitud(?:\s+de\s+credito)?|preliminar|aplicacion)/.test(normalized)
    && /(?:dia|fecha)/.test(normalized)
    && /(?:cronograma|definitiv)/.test(normalized);
  const auxiliaryObligationConflict = isAuxiliaryInsuranceWarning(normalized)
    && /(?:obligatori|voluntari)/.test(normalized)
    && /(?:clausula|certificado|poliza|seguro)/.test(normalized);
  return rowZero
    || duplicateSummary
    || otherProducts
    || itfWithoutAmount
    || programmedBalanceWarning
    || separateAuxiliarySchedule
    || preliminaryDay
    || auxiliaryObligationConflict;
}

function isHistoricalArithmeticDuplicate(warning: string): boolean {
  const normalized = normalizedWarning(warning);
  if (/(?:diferencia aritmetica.*historica|cuota historica)/.test(normalized)) return false;
  const hasArithmeticSignal = /(?:diferencia|discrepancia|descuadre|no coincide|no concuerda|!=|<>)/.test(normalized);
  const hasHistoricalSignal = /(?:histor|capital|principal|saldo|cuota|pagad|\b\d{3,}[.,]\d{2}\b)/.test(normalized);
  return hasArithmeticSignal && hasHistoricalSignal;
}

export interface BankDocumentWarningCompactionOptions {
  /** Suppress the raw historical balance discrepancy after the canonical review issue is present. */
  suppressHistoricalArithmetic?: boolean;
}

/** Removes warnings that describe already-resolved document context. */
export function compactBankDocumentWarnings(
  warnings: string[],
  options: BankDocumentWarningCompactionOptions = {},
): string[] {
  return [...new Set(warnings.map((warning) => warning.trim()).filter(Boolean))]
    .filter((warning) => !isBenignWarning(warning))
    .filter((warning) => !(options.suppressHistoricalArithmetic && isHistoricalArithmeticDuplicate(warning)))
    .slice(0, 8);
}
