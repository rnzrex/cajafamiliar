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

const BENIGN_WARNING_PATTERNS = [
  /fila(?:\s+|\s+num(?:ero)?\s*)0.*(desembolso|apertura)|(desembolso|apertura).*fila(?:\s+|\s+num(?:ero)?\s*)0/i,
  /(copia|duplicad).*(hoja resumen|summary)|(hoja resumen|summary).*(copia|duplicad)/i,
  /contrato marco.*(otro|varios).*(producto|secci[oó]n)/i,
  /itf.*(no|sin).*(desglos|importe).*(cuota|fila)/i,
  /saldo.*(no demuestra|no prueba).*(pago|pagos)/i,
  /(p[oó]liza|seguro).*(auxiliar|separad).*(cronograma|cuota)/i,
  /((d[ií]a|fecha).*(preliminar|solicitad)|(preliminar|solicitad).*(d[ií]a|fecha)).*(cronograma|definitiv)/i,
];

/** Removes warnings that describe already-resolved document context. */
export function compactBankDocumentWarnings(warnings: string[]): string[] {
  return [...new Set(warnings.map((warning) => warning.trim()).filter(Boolean))]
    .filter((warning) => !BENIGN_WARNING_PATTERNS.some((pattern) => pattern.test(warning)))
    .slice(0, 8);
}
