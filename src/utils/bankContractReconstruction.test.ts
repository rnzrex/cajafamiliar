import { describe, expect, it } from "vitest";
import { classifyReportedBalance, deriveCurrentPrincipalBalance, reconcileBankContractSchedule } from "./bankContractReconciliation.js";
import { reconstructBankContractSchedule, scheduleSourceForReconstruction } from "./bankContractReconstruction.js";

const fixtureInput = {
  originDate: "2026-05-09",
  firstDueDate: "2026-06-10",
  ordinaryDueDay: 10,
  financedAmount: 4100,
  teaPercent: 68.4,
  termInstallments: 18,
  regularInstallmentAmount: 347.67,
  finalInstallmentAmount: 347.81,
  totalContractAmount: 6258.2,
  totalInterest: 2003.41,
  totalInsurance: 154.79,
  installmentTotalMode: "total_installment_including_costs" as const,
};

describe("bank contract reconstruction V4", () => {
  it("reconstructs the anonymized 18-installment fixture without hardcoded terms", () => {
    const result = reconstructBankContractSchedule(fixtureInput);

    expect(result.rows).toHaveLength(18);
    expect(result.inferredTerms.dayCountBasis).toBe("actual_days_360");
    expect(result.inferredTerms.dueDateAdjustmentRule).toBe("sunday_to_monday");
    expect(result.inferredTerms.installmentTotalMode).toBe("total_installment_including_costs");
    expect(result.inferredTerms.insuranceRatePercent).toBeCloseTo(0.35, 2);
    expect(result.rows[0]).toMatchObject({ dueDate: "2026-06-10", interest: 194.41, insurance: 14.35, total: 347.67 });
    expect(result.rows[7].dueDate).toBe("2027-01-11");
    expect(result.rows[16].dueDate).toBe("2027-10-11");
    expect(result.rows[17].total).toBe(347.81);
    expect(result.totalPrincipal).toBe(4100);
    expect(result.totalInterest).toBe(2003.41);
    expect(result.totalInsurance).toBe(154.79);
    expect(result.totalContractAmount).toBe(6258.2);
    expect(result.rows.every((row) => Math.abs(row.principal + row.interest + row.insurance + row.fees - row.total) <= 0.01)).toBe(true);
  });

  it("infers the installment total mode when the contract does not label it", () => {
    const { installmentTotalMode: _ignored, ...withoutMode } = fixtureInput;
    const result = reconstructBankContractSchedule(withoutMode);
    expect(result.inferredTerms.installmentTotalMode).toBe("total_installment_including_costs");
  });

  it("classifies the bank schedule balance separately from principal", () => {
    const result = reconstructBankContractSchedule(fixtureInput);
    const first = result.rows[0];
    const futureRows = result.rows.slice(1);
    const classification = classifyReportedBalance({
      reportedBalance: 5770.09,
      principalBalance: first.remainingPrincipalBalance,
      futureScheduleFinancialBalance: futureRows.reduce((sum, row) => sum + row.principal + row.interest + row.fees, 0),
      futureTotalRemainingPayments: futureRows.reduce((sum, row) => sum + row.total, 0),
    });

    expect(first.remainingPrincipalBalance).toBe(3961.09);
    expect(classification.kind).toBe("schedule_financial_balance");
    expect(classification.kind).not.toBe("principal_balance");
  });

  it("derives current principal from paid contractual installments", () => {
    const result = reconstructBankContractSchedule(fixtureInput);
    expect(deriveCurrentPrincipalBalance(4100, result.rows, 5)).toBe(3294.39);
    expect(result.rows[5].contractualInstallmentNumber).toBe(6);
  });

  it("reconciles the fixture and marks it reconstructed, not official", () => {
    const result = reconstructBankContractSchedule(fixtureInput);
    const reconciliation = reconcileBankContractSchedule(result.rows, {
      originalPrincipal: 4100,
      expectedInstallmentCount: 18,
      reportedTotalPrincipal: 4100,
      reportedTotalInterest: 2003.41,
      reportedTotalInsurance: 154.79,
      reportedTotalContractAmount: 6258.2,
      knownRegularPayment: 347.67,
      knownFinalPayment: 347.81,
    });

    expect(reconciliation.status).toBe("exact");
    expect(scheduleSourceForReconstruction(reconciliation.status, false)).toBe("reconstructed");
    expect(scheduleSourceForReconstruction(reconciliation.status, true)).toBe("contractual");
  });
});
