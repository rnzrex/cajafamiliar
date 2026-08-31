import { describe, expect, it } from "vitest";
import { deriveOpeningPrincipalFromOfficialSchedule, detectReportedBalanceContinuityIssues } from "./bankContractReconciliation.js";
import { evaluateBankDocumentCompleteness } from "./bankDocumentCompleteness.js";
import { evaluateBankDocumentContinuation, compactBankDocumentWarnings } from "./bankDocumentContinuation.js";
import { normalizeBankDocumentExtraction } from "./bankDocumentExtraction.js";
import { financialValidation } from "./bankDocumentFinancialValidation.js";
import { BANK_RIPLEY_SANITIZED_FIXTURE } from "./bankRipleyRegressionFixture.js";

function normalizedFixture(overrides: Partial<typeof BANK_RIPLEY_SANITIZED_FIXTURE> = {}) {
  return normalizeBankDocumentExtraction({ ...BANK_RIPLEY_SANITIZED_FIXTURE, ...overrides }).value;
}

describe("bank document-first zero-rework / Ripley regression", () => {
  it("keeps an official inconsistent schedule contractual and resolves final dates", () => {
    const extraction = normalizedFixture();
    const validation = financialValidation(extraction);

    expect(validation.reconciliation?.status).toBe("inconsistent");
    expect(validation.scheduleSource).toBe("contractual");
    expect(validation.continuityIssues.map((issue) => issue.contractualInstallmentNumber)).toEqual([1]);
    expect(extraction.ordinaryDueDay).toBe(24);
    expect(extraction.dueDateAdjustmentRule).toBe("contractual_dates");
    expect(extraction.firstDueDate).toBe("2026-05-24");
    expect(extraction.fieldConflicts).toEqual([]);
  });

  it("does not treat a NUM 0 disbursement row as an installment", () => {
    const extraction = normalizedFixture({
      schedule: [{ contractualInstallmentNumber: 0, dueDate: "2026-04-22", principal: 5000, interest: 0, insurance: 0, fees: 0, total: 0, reportedBalance: 5000 }, ...BANK_RIPLEY_SANITIZED_FIXTURE.schedule],
    });

    expect(extraction.schedule).toHaveLength(24);
    expect(extraction.schedule[0]?.contractualInstallmentNumber).toBe(1);
  });

  it.each([
    [3, 4626.37],
    [4, 4485.70],
    [5, 4339.21],
  ])("uses exact contractual row K reported balance for lastPaid=%s", (lastPaid, expected) => {
    const extraction = normalizedFixture();
    expect(deriveOpeningPrincipalFromOfficialSchedule({
      originalPrincipal: extraction.originalPrincipal,
      rows: extraction.schedule,
      lastPaidContractualInstallment: lastPaid,
    })).toEqual({ amount: expected, source: "reported_balance" });
  });

  it("falls back to principal derivation only when row K has no reported balance", () => {
    const extraction = normalizedFixture({
      schedule: BANK_RIPLEY_SANITIZED_FIXTURE.schedule.map((row) => ({ ...row, reportedBalance: null })),
    });

    expect(deriveOpeningPrincipalFromOfficialSchedule({
      originalPrincipal: extraction.originalPrincipal,
      rows: extraction.schedule,
      lastPaidContractualInstallment: 3,
    })).toEqual({ amount: 4562.56, source: "principal_derivation" });

    expect(deriveOpeningPrincipalFromOfficialSchedule({
      originalPrincipal: extraction.originalPrincipal,
      rows: extraction.schedule.slice(3),
      lastPaidContractualInstallment: 3,
    })).toEqual({ amount: null, source: "unavailable" });
  });

  it("isolates the row 1 historical reported-balance anomaly", () => {
    const extraction = normalizedFixture();
    const issues = detectReportedBalanceContinuityIssues({
      originalPrincipal: extraction.originalPrincipal,
      rows: extraction.schedule,
    });

    expect(issues).toEqual([expect.objectContaining({
      contractualInstallmentNumber: 1,
      expectedReportedBalance: 4832.91,
      actualReportedBalance: 4896.72,
      difference: 63.81,
    })]);
  });

  it("allows an existing debt to continue from a valid K cut-off while preserving review", () => {
    const extraction = normalizedFixture();
    const validation = financialValidation(extraction);
    const continuation = evaluateBankDocumentContinuation({
      extraction,
      validation,
      onboardingMode: "EXISTING_DEBT",
      lastPaidContractualInstallment: 3,
    });
    const completeness = evaluateBankDocumentCompleteness(extraction, validation, {
      onboardingMode: "EXISTING_DEBT",
      installmentsPaidBeforeTracking: 3,
      currentPrincipal: 4626.37,
      creditorName: extraction.lenderName,
      currencyCode: "PEN",
    });

    expect(continuation.canContinue).toBe(true);
    expect(continuation.historicalAnomaly).toBe(true);
    expect(continuation.historicalIssues).toHaveLength(1);
    expect(continuation.futureIssues).toHaveLength(0);
    expect(completeness.requiredIssues).toHaveLength(0);
    expect(completeness.reviewIssues).toContainEqual(expect.objectContaining({ code: "HISTORICAL_SCHEDULE_ANOMALY" }));
  });

  it("fails closed when the same continuity anomaly is in the future", () => {
    const extraction = normalizedFixture({
      schedule: BANK_RIPLEY_SANITIZED_FIXTURE.schedule.map((row, index) => index === 3 ? { ...row, reportedBalance: 4490 } : row),
    });
    const validation = financialValidation(extraction);
    const continuation = evaluateBankDocumentContinuation({
      extraction,
      validation,
      onboardingMode: "EXISTING_DEBT",
      lastPaidContractualInstallment: 3,
    });

    expect(continuation.canContinue).toBe(false);
    expect(continuation.futureIssues).toContainEqual(expect.objectContaining({ contractualInstallmentNumber: 4 }));
    expect(evaluateBankDocumentCompleteness(extraction, validation, {
      onboardingMode: "EXISTING_DEBT",
      installmentsPaidBeforeTracking: 3,
      currentPrincipal: 4626.37,
      creditorName: extraction.lenderName,
      currencyCode: "PEN",
    }).requiredIssues).toContainEqual(expect.objectContaining({ code: "FUTURE_SCHEDULE_ANOMALY" }));
  });

  it.each([
    ["principal", { principal: null }],
    ["interest", { interest: null }],
    ["insurance", { insurance: null }],
    ["fees", { fees: null }],
    ["total", { total: null }],
  ])("fails closed for a missing future %s cell", (_field, patch) => {
    const extraction = normalizedFixture({
      schedule: BANK_RIPLEY_SANITIZED_FIXTURE.schedule.map((row, index) => index === 3 ? { ...row, ...patch } : row),
    });
    const continuation = evaluateBankDocumentContinuation({
      extraction,
      validation: financialValidation(extraction),
      onboardingMode: "EXISTING_DEBT",
      lastPaidContractualInstallment: 3,
    });

    expect(continuation.canContinue).toBe(false);
    expect(continuation.futureMissingFields.some((field) => field.endsWith(`.${_field}`))).toBe(true);
  });

  it("fails closed for future sequence and duplicate conflicts", () => {
    const brokenSequence = normalizedFixture({
      schedule: BANK_RIPLEY_SANITIZED_FIXTURE.schedule.map((row, index) => index === 3 ? { ...row, contractualInstallmentNumber: 6 } : row),
    });
    expect(evaluateBankDocumentContinuation({
      extraction: brokenSequence,
      validation: financialValidation(brokenSequence),
      onboardingMode: "EXISTING_DEBT",
      lastPaidContractualInstallment: 3,
    }).canContinue).toBe(false);

    const futureConflict = normalizedFixture({
      fieldConflicts: [{ field: "schedule[3].principal", values: [140.67, 140.68] }],
    });
    const continuation = evaluateBankDocumentContinuation({
      extraction: futureConflict,
      validation: financialValidation(futureConflict),
      onboardingMode: "EXISTING_DEBT",
      lastPaidContractualInstallment: 3,
    });
    expect(continuation.canContinue).toBe(false);
    expect(continuation.blockingConflicts).toContain("schedule[3].principal");
  });

  it("keeps credit-life insurance semantics separate from schedule totals", () => {
    const extraction = normalizedFixture();
    const creditLife = extraction.insuranceTerms.find((insurance) => insurance.insuranceType === "credit_life");
    const auxiliary = extraction.insuranceTerms.find((insurance) => insurance.insuranceType === "other");

    expect(creditLife).toMatchObject({ pricingMode: "percent_outstanding_balance", ratePercent: 0.3, fixedAmount: null, totalAmount: 217.04, isRequired: null });
    expect(auxiliary).toMatchObject({ totalAmount: 9, fixedAmount: null, isRequired: false });
    expect(Number(extraction.schedule.reduce((sum, row) => sum + (row.total ?? 0), 0).toFixed(2))).toBe(7968.59);
    expect(Number(extraction.schedule.reduce((sum, row) => sum + (row.insurance ?? 0), 0).toFixed(2))).toBe(217.04);
  });

  it("suppresses benign document warnings without hiding actionable future warnings", () => {
    const warnings = compactBankDocumentWarnings([
      ...BANK_RIPLEY_SANITIZED_FIXTURE.extractionWarnings,
      "La cuota futura 4 tiene una diferencia de saldo que debe revisarse.",
    ]);

    expect(warnings).toEqual(["La cuota futura 4 tiene una diferencia de saldo que debe revisarse."]);
  });
});
