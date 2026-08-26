export type BankReconciliationStatus = "exact" | "within_tolerance" | "inconsistent" | "insufficient_data";

export interface BankScheduleRowForReconciliation {
  contractualInstallmentNumber: number;
  dueDate: string;
  principal: number | null;
  interest: number | null;
  insurance: number | null;
  fees: number | null;
  total: number | null;
  reportedBalance?: number | null;
  remainingPrincipalBalance?: number | null;
}

export interface BankReconciliationControls {
  originalPrincipal?: number | null;
  expectedInstallmentCount?: number | null;
  reportedTotalPrincipal?: number | null;
  reportedTotalInterest?: number | null;
  reportedTotalInsurance?: number | null;
  reportedTotalFees?: number | null;
  reportedTotalContractAmount?: number | null;
  knownRegularPayment?: number | null;
  knownFinalPayment?: number | null;
  reportedFinalPrincipalBalance?: number | null;
}

export interface BankReconciliationOptions {
  rowTolerance?: number;
  aggregateTolerance?: number;
}

export interface BankReconciliationDifferences {
  principal: number | null;
  interest: number | null;
  insurance: number | null;
  fees: number | null;
  total: number | null;
  finalPrincipalBalance: number | null;
  installmentCount: number | null;
  regularPayment: number | null;
  finalPayment: number | null;
  dateOrder: number;
  rowArithmetic: number;
}

export interface BankContractReconciliationResult {
  status: BankReconciliationStatus;
  score: number;
  differences: BankReconciliationDifferences;
  warnings: string[];
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function difference(actual: number, expected: number | null | undefined): number | null {
  return expected == null || !Number.isFinite(expected) ? null : round2(actual - expected);
}

function within(value: number | null, tolerance: number): boolean {
  return value == null || Math.abs(value) <= tolerance;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

export function reconcileBankContractSchedule(
  rows: BankScheduleRowForReconciliation[],
  controls: BankReconciliationControls = {},
  options: BankReconciliationOptions = {},
): BankContractReconciliationResult {
  const rowTolerance = options.rowTolerance ?? 0.01;
  const aggregateTolerance = options.aggregateTolerance ?? 0.05;
  if (rows.length === 0) {
    return {
      status: "insufficient_data",
      score: 0,
      differences: {
        principal: null,
        interest: null,
        insurance: null,
        fees: null,
        total: null,
        finalPrincipalBalance: null,
        installmentCount: null,
        regularPayment: null,
        finalPayment: null,
        dateOrder: 0,
        rowArithmetic: 0,
      },
      warnings: ["No hay filas de cronograma para reconciliar."],
    };
  }

  const warnings: string[] = [];
  let principal = 0;
  let interest = 0;
  let insurance = 0;
  let fees = 0;
  let total = 0;
  let rowArithmetic = 0;
  let dateOrder = 0;
  let completeRows = true;
  let regularPaymentDifference: number | null = null;

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const rowPrincipal = finiteOrNull(row.principal);
    const rowInterest = finiteOrNull(row.interest);
    const rowInsurance = finiteOrNull(row.insurance);
    const rowFees = finiteOrNull(row.fees);
    const rowTotal = finiteOrNull(row.total);
    if ([rowPrincipal, rowInterest, rowInsurance, rowFees, rowTotal].some((value) => value == null)) {
      completeRows = false;
    } else {
      principal += rowPrincipal!;
      interest += rowInterest!;
      insurance += rowInsurance!;
      fees += rowFees!;
      total += rowTotal!;
      rowArithmetic = Math.max(rowArithmetic, Math.abs(round2(rowPrincipal! + rowInterest! + rowInsurance! + rowFees! - rowTotal!)));
    }
    if (index > 0) {
      if (row.contractualInstallmentNumber !== rows[index - 1].contractualInstallmentNumber + 1) dateOrder += 1;
      if (row.dueDate <= rows[index - 1].dueDate) dateOrder += 1;
    }
    if (controls.knownRegularPayment != null && index < rows.length - 1 && rowTotal != null) {
      regularPaymentDifference = Math.max(
        Math.abs(round2(rowTotal - controls.knownRegularPayment)),
        regularPaymentDifference ?? 0,
      );
    }
  }

  const lastTotal = finiteOrNull(rows.at(-1)?.total);
  const finalBalance = finiteOrNull(rows.at(-1)?.remainingPrincipalBalance);
  const aggregateDifferences: BankReconciliationDifferences = {
    principal: completeRows ? difference(round2(principal), controls.reportedTotalPrincipal) : null,
    interest: completeRows ? difference(round2(interest), controls.reportedTotalInterest) : null,
    insurance: completeRows ? difference(round2(insurance), controls.reportedTotalInsurance) : null,
    fees: completeRows ? difference(round2(fees), controls.reportedTotalFees) : null,
    total: completeRows ? difference(round2(total), controls.reportedTotalContractAmount) : null,
    finalPrincipalBalance: difference(finalBalance ?? 0, controls.reportedFinalPrincipalBalance),
    // A pending-only import can contain internal rows 1..N while contractual
    // numbering starts after already-paid installments. Compare the contract's
    // last number so a valid 6..18 import is not mistaken for a 13-installment
    // contract; continuity is still checked independently above.
    installmentCount: difference(rows.at(-1)?.contractualInstallmentNumber ?? rows.length, controls.expectedInstallmentCount),
    regularPayment: regularPaymentDifference == null ? null : round2(regularPaymentDifference),
    finalPayment: difference(lastTotal ?? 0, controls.knownFinalPayment),
    dateOrder,
    rowArithmetic,
  };

  const checkedDifferences = Object.entries(aggregateDifferences)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number");
  const violations = checkedDifferences.filter(([key, value]) => Math.abs(value) > (key === "dateOrder" || key === "rowArithmetic" ? rowTolerance : aggregateTolerance)).length;
  if (!completeRows) warnings.push("Faltan importes en una o más filas; la reconciliación es incompleta.");
  if (rowArithmetic > rowTolerance) warnings.push("Una o más cuotas no suman capital, interés, seguro y gastos.");
  if (dateOrder > 0) warnings.push("El orden de cuotas o fechas no es continuo.");
  if (regularPaymentDifference != null && regularPaymentDifference > aggregateTolerance) warnings.push("La cuota regular no coincide con el control informado.");

  const hasControls = Object.values(controls).some((value) => value != null);
  const score = checkedDifferences.length === 0
    ? (completeRows && dateOrder === 0 && rowArithmetic <= rowTolerance ? 1 : 0)
    : round2(Math.max(0, 1 - checkedDifferences.reduce((sum, [, value]) => sum + Math.min(1, Math.abs(value) / Math.max(aggregateTolerance, 0.01)), 0) / checkedDifferences.length));

  let status: BankReconciliationStatus;
  if (!hasControls && !completeRows) status = "insufficient_data";
  else if (!completeRows || violations > 0) status = "inconsistent";
  else if (checkedDifferences.some(([key, value]) => Math.abs(value) > (key === "dateOrder" || key === "rowArithmetic" ? rowTolerance : aggregateTolerance)) || dateOrder > 0 || rowArithmetic > rowTolerance) status = "within_tolerance";
  else status = "exact";

  return { status, score, differences: aggregateDifferences, warnings };
}

export interface ReportedBalanceClassificationInput {
  reportedBalance: number;
  principalBalance: number;
  futureScheduleFinancialBalance: number;
  futureTotalRemainingPayments: number;
  tolerance?: number;
}

export interface ReportedBalanceClassification {
  kind: "principal_balance" | "schedule_financial_balance" | "total_remaining_payments" | "unknown";
  confidence: "high" | "medium" | "low";
  differences: {
    principalBalance: number;
    scheduleFinancialBalance: number;
    totalRemainingPayments: number;
  };
  warnings: string[];
}

export function classifyReportedBalance(input: ReportedBalanceClassificationInput): ReportedBalanceClassification {
  const tolerance = input.tolerance ?? 0.02;
  const differences = {
    principalBalance: round2(input.reportedBalance - input.principalBalance),
    scheduleFinancialBalance: round2(input.reportedBalance - input.futureScheduleFinancialBalance),
    totalRemainingPayments: round2(input.reportedBalance - input.futureTotalRemainingPayments),
  };
  const candidates = (Object.entries(differences) as Array<[keyof typeof differences, number]>)
    .sort(([, left], [, right]) => Math.abs(left) - Math.abs(right));
  const [winner, winnerDifference] = candidates[0];
  const kind = winner === "principalBalance"
    ? "principal_balance"
    : winner === "scheduleFinancialBalance"
      ? "schedule_financial_balance"
      : winner === "totalRemainingPayments"
        ? "total_remaining_payments"
        : "unknown";
  const warnings: string[] = [];
  if (Math.abs(winnerDifference) > tolerance) warnings.push("El saldo informado no coincide con una interpretación conocida del cronograma.");
  if (kind !== "principal_balance") warnings.push("El saldo mostrado por el banco no se utilizará silenciosamente como capital pendiente.");
  return {
    kind: Math.abs(winnerDifference) <= tolerance ? kind : "unknown",
    confidence: Math.abs(winnerDifference) <= tolerance ? "high" : "low",
    differences,
    warnings,
  };
}

export function deriveCurrentPrincipalBalance(
  originalPrincipal: number,
  rows: Array<Pick<BankScheduleRowForReconciliation, "principal">>,
  lastPaidContractualInstallment: number,
): number {
  if (!Number.isFinite(originalPrincipal) || originalPrincipal < 0) throw new Error("El principal original debe ser válido.");
  if (!Number.isInteger(lastPaidContractualInstallment) || lastPaidContractualInstallment < 0) throw new Error("La última cuota pagada debe ser un entero no negativo.");
  const principalPaid = rows
    .slice(0, lastPaidContractualInstallment)
    .reduce((sum, row) => sum + (Number.isFinite(row.principal) ? Number(row.principal) : 0), 0);
  return round2(Math.max(0, originalPrincipal - principalPaid));
}
