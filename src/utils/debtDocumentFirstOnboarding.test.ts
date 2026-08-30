import { describe, expect, it } from "vitest";
import { CAJA_FAMILIAR_DEBT_DOCUMENT_V2 } from "./universalDebtDocument";
import { parseUniversalDebtExternalAiResponse } from "./universalDebtDocumentImport";
import { createDirectRealEstateFixture } from "./universalDebtFixture";
import {
  DOCUMENT_FIRST_EXTERNAL_AI_PROMPT,
  deriveOpeningPrincipalFromDocument,
  extractDocumentFirstDefaults,
  findDownPaymentInstallmentNumber,
  scheduleWithPretracking,
  validateDocumentFirstHistorySelection,
} from "./debtDocumentFirstOnboarding";

function realEstateReview() {
  const fixture = createDirectRealEstateFixture();
  return parseUniversalDebtExternalAiResponse(JSON.stringify({
    schema: CAJA_FAMILIAR_DEBT_DOCUMENT_V2,
    kind: "schedule",
    authority: "official_noncontractual",
    authorityEvidence: "proforma_non_binding",
    contract: {
      debtKind: "installment_purchase",
      debtName: "Financiamiento de inmueble",
      creditorName: "ACREEDOR INMOBILIARIO",
      currencyCode: "PEN",
      contractDate: "2027-01-10",
      assetPrice: fixture.assetPrice,
      downPaymentAmount: fixture.downPaymentAmount,
      financedPrincipalAmount: fixture.financedPrincipalAmount,
      scheduledPrincipalAmount: fixture.scheduledPrincipalAmount,
      principalBasis: "asset_price_including_down_payment",
      repaymentStructure: "fixed_schedule",
      amortizationMethod: "irregular_contract",
      installmentAmountMode: "variable",
      paymentFrequency: "monthly",
      firstDueDate: fixture.rows[0].dueDate,
      termInstallments: 129,
      interestRateType: "nominal_annual_simple",
      interestRatePercent: 23,
      dayCountBasis: "actual_days_360",
      feeRuleType: "contract_schedule_only",
      feeRule: {},
      prepaymentTerms: { futureInterestDiscount: true, futureFeesDiscount: true, taxPercent: null },
      tceaPercent: 29,
    },
    rows: fixture.rows.map((row) => ({
      sourceRowNumber: row.sourceRowNumber,
      contractualInstallmentNumber: row.contractualInstallmentNumber,
      dueDate: row.dueDate,
      openingBalance: row.openingBalance,
      expectedAmount: row.expectedAmount,
      expectedPrincipal: row.expectedPrincipal,
      expectedInterest: row.expectedInterest,
      expectedFees: row.expectedFees,
      expectedInsurance: row.expectedInsurance,
      expectedTaxes: row.expectedTaxes,
      reportedBalance: row.reportedBalance,
      rowRole: row.rowRole,
      phase: row.phase,
      evidence: row.evidence,
    })),
  }));
}

describe("document-first debt onboarding", () => {
  it("requests onboarding identity and real-history semantics in the external prompt", () => {
    expect(DOCUMENT_FIRST_EXTERNAL_AI_PROMPT).toContain("debtKind");
    expect(DOCUMENT_FIRST_EXTERNAL_AI_PROMPT).toContain("creditorName");
    expect(DOCUMENT_FIRST_EXTERNAL_AI_PROMPT).toContain("currentPrincipalAmount");
    expect(DOCUMENT_FIRST_EXTERNAL_AI_PROMPT).toContain("No decidas qué cuotas ya pagó realmente");
    expect(DOCUMENT_FIRST_EXTERNAL_AI_PROMPT).toContain("no debe restarse por segunda vez");
    expect(DOCUMENT_FIRST_EXTERNAL_AI_PROMPT).toContain("pagado solo la cuota inicial");
    expect(DOCUMENT_FIRST_EXTERNAL_AI_PROMPT).toContain("parciales o no consecutivos");
  });

  it("extracts the 129-row proforma into creation defaults without collapsing authority", () => {
    const defaults = extractDocumentFirstDefaults(realEstateReview());
    expect(defaults.debtKind).toBe("installment_purchase");
    expect(defaults.currencyCode).toBe("PEN");
    expect(defaults.assetPrice).toBe(85000);
    expect(defaults.downPaymentAmount).toBe(8500);
    expect(defaults.financedPrincipalAmount).toBe(76500);
    expect(defaults.scheduledPrincipalAmount).toBe(85000);
    expect(defaults.principalBasis).toBe("asset_price_including_down_payment");
    expect(defaults.interestRateType).toBe("nominal_annual_simple");
    expect(defaults.interestRatePercent).toBe(23);
    expect(defaults.dayCountBasis).toBe("actual_days_360");
    expect(defaults.feeRuleType).toBe("contract_schedule_only");
    expect(defaults.authority).toBe("official_noncontractual");
    expect(defaults.scheduleSource).toBe("reconstructed");
    expect(defaults.schedule).toHaveLength(129);
  });

  it("uses financed principal for a new debt and never subtracts the down payment twice", () => {
    const defaults = extractDocumentFirstDefaults(realEstateReview());
    expect(deriveOpeningPrincipalFromDocument(defaults, "NEW_DEBT", 0)).toBe(76500);
    expect(deriveOpeningPrincipalFromDocument(defaults, "EXISTING_DEBT", 1)).toBe(76500);
    expect(deriveOpeningPrincipalFromDocument(defaults, "EXISTING_DEBT", 9)).toBe(68000);
  });

  it("marks historical schedule rows as pretracking without manufacturing payment events", () => {
    const defaults = extractDocumentFirstDefaults(realEstateReview());
    const schedule = scheduleWithPretracking(defaults.schedule, "EXISTING_DEBT", 9, "CONSECUTIVE_FULLY_PAID");
    expect(schedule.slice(0, 9).every((row) => row.isPaidBeforeTracking)).toBe(true);
    expect(schedule[9].isPaidBeforeTracking).toBe(false);
    expect(schedule[0]).toMatchObject({ rowRole: "down_payment", expectedPrincipal: 8500 });
  });

  it("models a paid down payment without reducing the financed principal", () => {
    const defaults = extractDocumentFirstDefaults(realEstateReview());
    expect(findDownPaymentInstallmentNumber(defaults.schedule)).toBe(1);
    expect(validateDocumentFirstHistorySelection(defaults.schedule, "NO_ROWS_PAID", 0)).toBeNull();
    expect(validateDocumentFirstHistorySelection(defaults.schedule, "DOWN_PAYMENT_ONLY", 1)).toBeNull();
    const schedule = scheduleWithPretracking(defaults.schedule, "EXISTING_DEBT", 1, "DOWN_PAYMENT_ONLY");
    expect(schedule[0].isPaidBeforeTracking).toBe(true);
    expect(schedule[1].isPaidBeforeTracking).toBe(false);
    expect(deriveOpeningPrincipalFromDocument(defaults, "EXISTING_DEBT", 1)).toBe(76500);
  });

  it("rejects partial or non-consecutive history instead of silently marking rows", () => {
    const defaults = extractDocumentFirstDefaults(realEstateReview());
    const nonConsecutive = defaults.schedule.filter((row) => (row.contractualInstallmentNumber ?? row.installmentNumber) !== 2);
    expect(validateDocumentFirstHistorySelection(nonConsecutive, "CONSECUTIVE_FULLY_PAID", 9)).toContain("consecutivas");
    expect(validateDocumentFirstHistorySelection(defaults.schedule, "CONSECUTIVE_FULLY_PAID", 0)).toContain("última cuota");
  });

  it("preserves positive, explicit-zero, and unknown tax semantics", () => {
    const review = parseUniversalDebtExternalAiResponse(JSON.stringify({
      schema: CAJA_FAMILIAR_DEBT_DOCUMENT_V2,
      kind: "schedule",
      authority: "contractual",
      authorityEvidence: "official_schedule",
      contract: { debtKind: "family_loan", creditorName: "ACREEDOR", financedPrincipalAmount: 100 },
      rows: [
        { sourceRowNumber: 1, contractualInstallmentNumber: 1, dueDate: "2027-01-01", expectedAmount: 116, expectedPrincipal: 100, expectedInterest: 10, expectedFees: 5, expectedInsurance: 0, expectedTaxes: 1, rowRole: "installment" },
        { sourceRowNumber: 2, contractualInstallmentNumber: 2, dueDate: "2027-02-01", expectedAmount: 100, expectedPrincipal: 100, expectedInterest: 0, expectedFees: 0, expectedInsurance: 0, expectedTaxes: 0, rowRole: "installment" },
        { sourceRowNumber: 3, contractualInstallmentNumber: 3, dueDate: "2027-03-01", expectedAmount: 100, expectedPrincipal: 100, expectedInterest: 0, expectedFees: 0, expectedInsurance: 0, expectedTaxes: null, rowRole: "installment" },
      ],
    }));
    const defaults = extractDocumentFirstDefaults(review);
    expect(defaults.schedule.map((row) => row.expectedTaxes)).toEqual([1, 0, null]);
  });

  it("routes bank documents to the existing specialized BANK onboarding", () => {
    const review = parseUniversalDebtExternalAiResponse(JSON.stringify({
      schema: CAJA_FAMILIAR_DEBT_DOCUMENT_V2,
      kind: "contract",
      authority: "contractual",
      authorityEvidence: "signed_contract",
      contract: { debtKind: "bank_loan", creditorName: "BANCO", currencyCode: "PEN", financedPrincipalAmount: 1000, repaymentStructure: "fixed_schedule" },
      rows: [{ sourceRowNumber: 1, contractualInstallmentNumber: 1, dueDate: "2027-02-01", expectedAmount: 100, expectedPrincipal: 80, expectedInterest: 20, expectedFees: 0, expectedInsurance: 0, expectedTaxes: 0, rowRole: "installment" }],
    }));
    const defaults = extractDocumentFirstDefaults(review);
    expect(defaults.debtKind).toBe("bank_loan");
    expect(defaults.requiresSpecializedFlow).toBe(true);
  });
});
