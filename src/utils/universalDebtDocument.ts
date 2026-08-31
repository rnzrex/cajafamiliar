import type { DebtContractAuthority } from "../types";
import { roundCurrency } from "./universalDebtContract";

export const CAJA_FAMILIAR_DEBT_DOCUMENT_V2 = "CAJA_FAMILIAR_DEBT_DOCUMENT_V2" as const;

export type UniversalDebtDocumentKind = "contract" | "schedule" | "refinance" | "statement" | "other";

export interface UniversalDebtDocumentRow {
  sourceRowNumber: number;
  /** Whether the source row number came from a valid positive input value. */
  sourceRowNumberValid?: boolean;
  contractualInstallmentNumber: number | null;
  dueDate: string | null;
  openingBalance: number | null;
  expectedAmount: number | null;
  expectedPrincipal: number | null;
  expectedInterest: number | null;
  expectedFees: number | null;
  expectedInsurance: number | null;
  expectedTaxes: number | null;
  reportedBalance: number | null;
  endingBalance: number | null;
  rowRole: "down_payment" | "installment" | "summary" | "unknown";
  phase: string | null;
  authority: DebtContractAuthority;
  evidence: Record<string, unknown>;
}

export interface NormalizedDebtDocument {
  schema: typeof CAJA_FAMILIAR_DEBT_DOCUMENT_V2;
  kind: UniversalDebtDocumentKind;
  authority: DebtContractAuthority;
  rows: UniversalDebtDocumentRow[];
  warnings: string[];
  droppedRows: number[];
}

export function classifyDebtDocumentAuthority(input: {
  contractualDocument: boolean;
  officialButNonContractual?: boolean;
  userReported?: boolean;
  estimated?: boolean;
}): DebtContractAuthority {
  if (input.estimated) return "estimated";
  if (input.contractualDocument) return "contractual";
  if (input.officialButNonContractual) return "official_noncontractual";
  if (input.userReported) return "user_reported";
  return "unknown";
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? roundCurrency(parsed) : null;
}

function nullablePositiveInteger(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeUniversalDebtDocument(input: {
  kind: UniversalDebtDocumentKind;
  authority: DebtContractAuthority;
  rows: Array<Record<string, unknown>>;
}): NormalizedDebtDocument {
  const warnings: string[] = [];
  const droppedRows: number[] = [];
  const rows: UniversalDebtDocumentRow[] = [];
  input.rows.forEach((raw, index) => {
    const rawSourceRowNumber = raw.sourceRowNumber ?? raw.source_row_number;
    const sourceRowNumberValid = nullablePositiveInteger(rawSourceRowNumber) != null;
    const sourceRowNumber = nullablePositiveInteger(rawSourceRowNumber ?? index + 1) ?? index + 1;
    const dueDate = raw.dueDate == null && raw.due_date == null ? null : String(raw.dueDate ?? raw.due_date);
    const hasFinancialValue = ["expectedAmount", "expected_amount", "expectedPrincipal", "expected_principal", "reportedBalance", "reported_balance"]
      .some((key) => raw[key] != null && raw[key] !== "");
    if (!hasFinancialValue && dueDate == null) {
      droppedRows.push(sourceRowNumber);
      return;
    }
    const expectedAmount = nullableNumber(raw.expectedAmount ?? raw.expected_amount);
    const openingBalance = nullableNumber(raw.openingBalance ?? raw.opening_balance);
    const expectedPrincipal = nullableNumber(raw.expectedPrincipal ?? raw.expected_principal);
    const expectedInterest = nullableNumber(raw.expectedInterest ?? raw.expected_interest);
    const expectedFees = nullableNumber(raw.expectedFees ?? raw.expected_fees);
    const expectedInsurance = nullableNumber(raw.expectedInsurance ?? raw.expected_insurance);
    const expectedTaxes = nullableNumber(raw.expectedTaxes ?? raw.expected_taxes);
    const reportedBalance = nullableNumber(raw.reportedBalance ?? raw.reported_balance);
    const endingBalance = nullableNumber(raw.endingBalance ?? raw.ending_balance ?? raw.reportedBalance ?? raw.reported_balance);
    if ([expectedAmount, expectedPrincipal, expectedInterest, expectedFees, expectedInsurance, expectedTaxes, reportedBalance].some((value) => value != null && value < 0)) {
      warnings.push(`Fila ${sourceRowNumber}: se conservaron valores para revisión porque contiene importes negativos.`);
    }
    rows.push({
      sourceRowNumber,
      sourceRowNumberValid,
      contractualInstallmentNumber: nullablePositiveInteger(raw.contractualInstallmentNumber ?? raw.contractual_installment_number ?? raw.installmentNumber ?? raw.installment_number),
      dueDate,
      openingBalance,
      expectedAmount,
      expectedPrincipal,
      expectedInterest,
      expectedFees,
      expectedInsurance,
      expectedTaxes,
      reportedBalance,
      endingBalance,
      rowRole: raw.rowRole === "down_payment" || raw.row_role === "down_payment" ? "down_payment" : raw.rowRole === "installment" || raw.row_role === "installment" ? "installment" : raw.rowRole === "summary" || raw.row_role === "summary" ? "summary" : "unknown",
      phase: raw.phase == null ? null : String(raw.phase),
      authority: input.authority,
      evidence: raw.evidence && typeof raw.evidence === "object" && !Array.isArray(raw.evidence) ? raw.evidence as Record<string, unknown> : {},
    });
  });
  if (rows.some((row) => row.expectedAmount == null)) warnings.push("Hay cuotas sin total; no se interpreta null como cero.");
  if (rows.some((row) => row.expectedPrincipal == null)) warnings.push("Hay cuotas sin capital; la reconciliación de principal queda incompleta.");
  return { schema: CAJA_FAMILIAR_DEBT_DOCUMENT_V2, kind: input.kind, authority: input.authority, rows, warnings, droppedRows };
}

export function reconcileUniversalDebtDocument(rows: UniversalDebtDocumentRow[], expectedPrincipal: number | null | undefined): {
  status: "exact" | "within_tolerance" | "inconsistent" | "insufficient_data";
  schedulePrincipal: number | null;
  expectedPrincipal: number | null;
  difference: number | null;
} {
  const knownRows = rows.filter((row) => row.rowRole !== "summary" && row.expectedPrincipal != null);
  const schedulePrincipal = knownRows.length === 0 ? null : roundCurrency(knownRows.reduce((sum, row) => sum + (row.expectedPrincipal ?? 0), 0));
  const expected = expectedPrincipal == null || !Number.isFinite(expectedPrincipal) ? null : roundCurrency(expectedPrincipal);
  if (schedulePrincipal == null || expected == null) return { status: "insufficient_data", schedulePrincipal, expectedPrincipal: expected, difference: null };
  const difference = roundCurrency(schedulePrincipal - expected);
  if (difference === 0) return { status: "exact", schedulePrincipal, expectedPrincipal: expected, difference };
  if (Math.abs(difference) <= 0.01) return { status: "within_tolerance", schedulePrincipal, expectedPrincipal: expected, difference };
  return { status: "inconsistent", schedulePrincipal, expectedPrincipal: expected, difference };
}
