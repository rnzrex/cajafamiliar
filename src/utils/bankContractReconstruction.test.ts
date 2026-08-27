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

const expectedFixtureRows = [
  ["2026-06-10", 138.91, 194.41, 14.35, 347.67],
  ["2026-07-10", 157.99, 175.82, 13.86, 347.67],
  ["2026-08-10", 159.79, 174.57, 13.31, 347.67],
  ["2026-09-10", 167.69, 167.23, 12.75, 347.67],
  ["2026-10-10", 181.23, 154.28, 12.16, 347.67],
  ["2026-11-10", 184.92, 151.22, 11.53, 347.67],
  ["2026-12-10", 198.77, 138.02, 10.88, 347.67],
  ["2027-01-11", 199.47, 138.01, 10.19, 347.67],
  ["2027-02-10", 217.83, 120.35, 9.49, 347.67],
  ["2027-03-10", 235.79, 103.15, 8.73, 347.67],
  ["2027-04-10", 236.14, 103.63, 7.90, 347.67],
  ["2027-05-10", 250.86, 89.73, 7.08, 347.67],
  ["2027-06-10", 260.20, 81.27, 6.20, 347.67],
  ["2027-07-10", 275.34, 67.04, 5.29, 347.67],
  ["2027-08-10", 286.66, 56.69, 4.32, 347.67],
  ["2027-09-10", 300.82, 43.53, 3.32, 347.67],
  ["2027-10-11", 315.67, 29.73, 2.27, 347.67],
  ["2027-11-10", 331.92, 14.73, 1.16, 347.81],
] as const;

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

  it("matches every contractual fixture row within one cent", () => {
    const result = reconstructBankContractSchedule(fixtureInput);
    expect(result.rows).toHaveLength(18);
    result.rows.forEach((row, index) => {
      const [dueDate, principal, interest, insurance, total] = expectedFixtureRows[index];
      expect(row.contractualInstallmentNumber).toBe(index + 1);
      expect(row.dueDate).toBe(dueDate);
      expect(Math.abs(row.principal - principal)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(row.interest - interest)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(row.insurance - insurance)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(row.total - total)).toBeLessThanOrEqual(0.01);
    });
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

  it("distinguishes exact, within_tolerance, inconsistent and insufficient", () => {
    const result = reconstructBankContractSchedule(fixtureInput);
    const controls = {
      originalPrincipal: 4100,
      expectedInstallmentCount: 18,
      reportedTotalPrincipal: 4100,
      reportedTotalInterest: 2003.41,
      reportedTotalInsurance: 154.79,
      reportedTotalContractAmount: 6258.2,
      knownRegularPayment: 347.67,
      knownFinalPayment: 347.81,
    };
    expect(reconcileBankContractSchedule(result.rows, controls).status).toBe("exact");
    expect(reconcileBankContractSchedule(result.rows, { ...controls, reportedTotalInterest: 2003.43 }).status).toBe("within_tolerance");
    expect(reconcileBankContractSchedule(result.rows, { ...controls, reportedTotalInterest: 2003.50 }).status).toBe("inconsistent");
    expect(reconcileBankContractSchedule(result.rows.map((row, index) => index === 4 ? { ...row, principal: null } : row), controls).status).toBe("insufficient_data");
  });

  it("supports each explicit insurance candidate and refuses an unknown formula", () => {
    const modes = [
      "percent_outstanding_balance",
      "percent_original_principal",
      "fixed_per_installment",
      "fixed_total_even",
      "fixed_total_upfront",
    ] as const;
    for (const mode of modes) {
      const result = reconstructBankContractSchedule({
        ...fixtureInput,
        insuranceInferenceMode: mode,
        insuranceRatePercent: mode.startsWith("percent_") ? 0.35 : null,
        fixedInsurancePerInstallment: mode === "fixed_per_installment" ? 8 : null,
        fixedInsuranceTotalEven: mode === "fixed_total_even" ? 144 : null,
        fixedInsuranceTotalUpfront: mode === "fixed_total_upfront" ? 144 : null,
      });
      expect(result.inferredTerms.insuranceMode).toBe(mode);
    }
    const ambiguous = reconstructBankContractSchedule({ ...fixtureInput, insuranceInferenceMode: "ambiguous" });
    expect(ambiguous.inferredTerms.insuranceMode).toBe("ambiguous");
    expect(ambiguous.inferredTerms.insuranceRatePercent).toBeNull();
    expect(ambiguous.warnings.join(" ")).toContain("varias fórmulas");
  });

  it("uses complete observed rows to identify the formula that reproduces the fixture", () => {
    const source = reconstructBankContractSchedule({ ...fixtureInput, insuranceInferenceMode: "percent_outstanding_balance" });
    const result = reconstructBankContractSchedule({ ...fixtureInput, observedRows: source.rows });
    expect(result.inferredTerms.insuranceMode).toBe("percent_outstanding_balance");
    expect(result.inferredTerms.insuranceRatePercent).toBeCloseTo(0.35, 2);
  });

  it("does not invent an insurance formula from a total alone", () => {
    const result = reconstructBankContractSchedule({
      originDate: "2026-01-01",
      firstDueDate: "2026-02-01",
      financedAmount: 10_000,
      teaPercent: 24,
      termInstallments: 12,
      totalInsurance: 120,
    });

    expect(result.inferredTerms.insuranceMode).toBe("ambiguous");
    expect(result.inferredTerms.insuranceRatePercent).toBeNull();
    expect(result.warnings.join(" ")).toContain("no se eligió una fórmula");
  });
});
