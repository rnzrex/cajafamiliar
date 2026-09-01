import { classifyReportedBalance, detectReportedBalanceContinuityIssues, reconcileBankContractSchedule, type BankScheduleContinuityIssue } from "./bankContractReconciliation.js";
import { reconstructBankContractSchedule, scheduleSourceForReconstruction } from "./bankContractReconstruction.js";
import type { BankDocumentExtraction } from "./bankDocumentExtraction.js";

export interface BankFinancialValidationResult {
  reconciliation: ReturnType<typeof reconcileBankContractSchedule> | null;
  reconstruction: ReturnType<typeof reconstructBankContractSchedule> | null;
  reportedBalanceClassification: ReturnType<typeof classifyReportedBalance> | null;
  continuityIssues: BankScheduleContinuityIssue[];
  scheduleSource: "contractual" | "reconstructed" | "estimated";
}

export function isPendingOnlyOfficialSchedule(extraction: BankDocumentExtraction): boolean {
  const firstContractualNumber = extraction.schedule[0]?.contractualInstallmentNumber;
  const lastContractualNumber = extraction.schedule.at(-1)?.contractualInstallmentNumber;
  return extraction.schedule.length > 0
    && extraction.termInstallments != null
    && firstContractualNumber != null
    && firstContractualNumber > 1
    && lastContractualNumber === extraction.termInstallments;
}

/**
 * Pure financial pipeline shared by integrated and external document imports.
 * It deliberately has no server, storage, network, or provider dependencies.
 */
export function financialValidation(extraction: BankDocumentExtraction): BankFinancialValidationResult {
  if (extraction.schedule.length > 0) {
    const rows = extraction.schedule.map((row) => ({
      contractualInstallmentNumber: row.contractualInstallmentNumber,
      dueDate: row.dueDate,
      principal: row.principal,
      interest: row.interest,
      insurance: row.insurance,
      fees: row.fees,
      total: row.total,
      reportedBalance: row.reportedBalance,
    }));
    const pendingOnlyOfficial = isPendingOnlyOfficialSchedule(extraction);
    const reconciliation = reconcileBankContractSchedule(rows, pendingOnlyOfficial
      ? {
          // A pending-only official import must validate its own structure and
          // endpoint, but must not compare rows K..N with contract totals 1..N.
          expectedInstallmentCount: extraction.termInstallments,
        }
      : {
          expectedInstallmentCount: extraction.termInstallments,
          reportedTotalPrincipal: extraction.originalPrincipal ?? extraction.financedAmount,
          reportedTotalInterest: extraction.totalInterest,
          reportedTotalInsurance: extraction.totalInsurance,
          reportedTotalFees: extraction.totalFees,
          reportedTotalContractAmount: extraction.totalContractAmount,
          knownRegularPayment: extraction.regularInstallmentAmount,
          knownFinalPayment: extraction.finalInstallmentAmount,
        });
    const continuityIssues = detectReportedBalanceContinuityIssues({
      originalPrincipal: extraction.originalPrincipal ?? extraction.financedAmount,
      rows,
    });
    // Authority comes from provenance, not from whether the bank's printed
    // arithmetic agrees with its aggregate controls. An official imported
    // table remains contractual even when reconciliation is inconsistent.
    return { reconciliation, reconstruction: null, reportedBalanceClassification: null, continuityIssues, scheduleSource: "contractual" };
  }

  const originalPrincipal = extraction.financedAmount ?? extraction.originalPrincipal;
  if (extraction.contractDate && originalPrincipal != null && extraction.teaPercent != null && extraction.termInstallments != null && (extraction.regularInstallmentAmount != null || extraction.totalContractAmount != null)) {
    const firstDueDate = extraction.firstDueDate;
    if (firstDueDate) {
      const reconstruction = reconstructBankContractSchedule({
        originDate: extraction.contractDate,
        firstDueDate,
        ordinaryDueDay: extraction.ordinaryDueDay,
        financedAmount: originalPrincipal,
        teaPercent: extraction.teaPercent,
        termInstallments: extraction.termInstallments,
        regularInstallmentAmount: extraction.regularInstallmentAmount,
        finalInstallmentAmount: extraction.finalInstallmentAmount,
        totalContractAmount: extraction.totalContractAmount,
        totalInterest: extraction.totalInterest,
        totalInsurance: extraction.totalInsurance,
        installmentTotalMode: extraction.installmentTotalMode ?? "unknown",
        dayCountBasis: extraction.dayCountBasis,
        dueDateAdjustmentRule: extraction.dueDateAdjustmentRule,
        // Auxiliary documentary policies are retained for auditability but
        // must not influence a reconstructed operational schedule.
        insuranceTerms: extraction.operationalInsuranceTerms ?? extraction.insuranceTerms,
      });
      const reconciliation = reconcileBankContractSchedule(reconstruction.rows, {
        originalPrincipal,
        expectedInstallmentCount: extraction.termInstallments,
        reportedTotalPrincipal: originalPrincipal,
        reportedTotalInterest: extraction.totalInterest,
        reportedTotalInsurance: extraction.totalInsurance,
        reportedTotalContractAmount: extraction.totalContractAmount,
        knownRegularPayment: extraction.regularInstallmentAmount,
        knownFinalPayment: extraction.finalInstallmentAmount,
      });
      const reportedBalanceClassification = extraction.reportedBalance.amount == null
        ? null
        : classifyReportedBalance({
            reportedBalance: extraction.reportedBalance.amount,
            principalBalance: reconstruction.rows[0]?.remainingPrincipalBalance ?? 0,
            futureScheduleFinancialBalance: reconstruction.rows.slice(1).reduce((sum, row) => sum + row.principal + row.interest + row.fees, 0),
            futureTotalRemainingPayments: reconstruction.rows.slice(1).reduce((sum, row) => sum + row.total, 0),
          });
      if (reportedBalanceClassification && extraction.reportedBalance.inferredKind == null && reportedBalanceClassification.kind !== "unknown") {
        extraction.reportedBalance.inferredKind = reportedBalanceClassification.kind;
      } else if (reportedBalanceClassification && extraction.reportedBalance.inferredKind && extraction.reportedBalance.inferredKind !== reportedBalanceClassification.kind) {
        extraction.extractionWarnings.push("La etiqueta del saldo reportado no coincide con la clasificación matemática; confirma su significado.");
      }
      return { reconciliation, reconstruction, reportedBalanceClassification, continuityIssues: [], scheduleSource: scheduleSourceForReconstruction(reconciliation.status, false) };
    }
  }
  return { reconciliation: null, reconstruction: null, reportedBalanceClassification: null, continuityIssues: [], scheduleSource: "estimated" as const };
}
