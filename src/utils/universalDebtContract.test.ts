import { describe, expect, it } from "vitest";
import type { Debt, DebtEvent, DebtInstallment } from "../types";
import { detectDebtPaymentExcess } from "./debtViewModel";
import { calculateKnownDebtFee, calculateNominalAnnualSimpleInterest, compareRefinancing, deriveUniversalDebtState, isFixedScheduleDebt, validateUniversalScheduleArithmetic } from "./universalDebtContract";
import { classifyDebtDocumentAuthority, normalizeUniversalDebtDocument, reconcileUniversalDebtDocument } from "./universalDebtDocument";
import { createDirectRealEstateFixture } from "./universalDebtFixture";
import { simulateUniversalDebtPrepayment } from "./universalDebtSimulation";
import { mapUniversalDocumentRowsToSchedule, parseUniversalDebtExternalAiResponse } from "./universalDebtDocumentImport";

const debt: Debt = {
  id: "debt-universal-1", name: "Financiamiento", creditorName: "Proveedor", debtKind: "installment_purchase", currencyCode: "PEN",
  originDate: "2027-01-10", trackingStartDate: "2027-01-10", originalPrincipal: 1000, openingPrincipalBalance: 1000,
  plannedInstallmentCount: 10, plannedInstallmentAmount: 120, installmentAmountMode: "fixed", paymentFrequency: "monthly",
  customFrequencyDays: null, firstDueDate: "2027-02-10", teaPercent: null, tceaPercent: null, notes: "", status: "active",
  isArchived: false, createdByUserId: "user-1", createdAt: "2027-01-01T00:00:00Z", updatedAt: "2027-01-01T00:00:00Z",
  repaymentStructure: "fixed_schedule", interestCalculationMode: "contract_periodic_rate", periodicRatePercent: null,
  periodicRateBasis: null, minimumPrincipalPayment: null,
};

function event(overrides: Partial<DebtEvent>): DebtEvent {
  return { id: "event-1", debtId: debt.id, eventDate: "2027-02-10", eventType: "payment", cashAmount: 100, principalDelta: -100, interestPaid: 0, feesPaid: 0, insurancePaid: 0, otherCostPaid: 0, breakdownComplete: true, movementId: "movement-1", reversalOfEventId: null, description: "Pago", registeredByUserId: "user-1", createdAt: "2027-02-10T00:00:00Z", ...overrides };
}

describe("universal debt contract engine", () => {
  it("calculates TNA nominal simple using actual days and preserves null when basis is unknown", () => {
    expect(calculateNominalAnnualSimpleInterest({ principal: 1000, annualRatePercent: 23, elapsedDays: 30, dayCountBasis: "actual_days_360" })).toBe(19.17);
    expect(calculateNominalAnnualSimpleInterest({ principal: 1000, annualRatePercent: 23, elapsedDays: 30, dayCountBasis: "actual_days_365" })).toBe(18.9);
    expect(calculateNominalAnnualSimpleInterest({ principal: 1000, annualRatePercent: 23, elapsedDays: 30, dayCountBasis: "unknown" })).toBeNull();
  });

  it("does not turn an unknown fee formula into zero", () => {
    expect(calculateKnownDebtFee({ ruleType: "unknown", rule: {}, baseAmount: 1000 })).toBeNull();
    expect(calculateKnownDebtFee({ ruleType: "percentage", rule: { percent: 1.5 }, baseAmount: 1000 })).toBe(15);
  });

  it("detects overpayment without choosing a creditor allocation", () => {
    expect(detectDebtPaymentExcess({ cashAmount: 125, contractualAmount: 100 })).toBe(25);
    expect(detectDebtPaymentExcess({ cashAmount: 100.01, contractualAmount: 100 })).toBe(0);
    expect(detectDebtPaymentExcess({ cashAmount: 125, contractualAmount: null })).toBeNull();
  });

  it("derives a structure-driven state with reversal-aware principal", () => {
    const snapshot = deriveUniversalDebtState({ debt, events: [event({}), event({ id: "reversal-1", eventType: "reversal", cashAmount: 0, principalDelta: 0, breakdownComplete: false, movementId: null, reversalOfEventId: "event-1" })] });
    expect(snapshot.currentPrincipal).toBe(1000);
    expect(snapshot.effectiveEventCount).toBe(0);
    expect(isFixedScheduleDebt(debt)).toBe(true);
  });

  it("keeps refinancing comparison unknown instead of claiming savings", () => {
    expect(compareRefinancing({ sourcePrincipal: 1000, sourceRemainingPayments: null, targetPrincipal: 900, targetRemainingPayments: 1100, cashContribution: 0 }).status).toBe("insufficient_info");
    expect(compareRefinancing({ sourcePrincipal: 1000, sourceRemainingPayments: 1300, targetPrincipal: 900, targetRemainingPayments: 1100, cashContribution: 0 })).toMatchObject({ status: "known", difference: 200 });
  });

  it("normalizes universal document rows without collapsing null into zero", () => {
    const normalized = normalizeUniversalDebtDocument({ kind: "schedule", authority: classifyDebtDocumentAuthority({ contractualDocument: false, officialButNonContractual: true }), rows: [{ due_date: "2027-01-10", expected_principal: "100", expected_interest: "0" }] });
    expect(normalized.rows[0].expectedPrincipal).toBe(100);
    expect(normalized.rows[0].expectedAmount).toBeNull();
    expect(reconcileUniversalDebtDocument(normalized.rows, 100).status).toBe("exact");
  });

  it("ships the sanitized 129-row direct-real-estate fixture with the requested phases", () => {
    const fixture = createDirectRealEstateFixture();
    expect(fixture.rows).toHaveLength(129);
    expect(fixture.assetPrice).toBe(85000);
    expect(fixture.downPaymentAmount).toBe(8500);
    expect(fixture.financedPrincipalAmount).toBe(76500);
    expect(fixture.rows[0]).toMatchObject({ rowRole: "down_payment", expectedAmount: 8500, expectedPrincipal: 8500, reportedBalance: 76500 });
    expect(fixture.rows.slice(1, 9).every((row) => row.expectedAmount === 1062.5 && row.expectedInterest === 0)).toBe(true);
    expect(fixture.rows[8].reportedBalance).toBe(68000);
    expect(fixture.rows[9].phase).toBe("tna_actual_days_360");
    expect(fixture.rows[9]).toMatchObject({ expectedPrincipal: 141.97, expectedInterest: 1303.33, expectedFees: 155.06, expectedAmount: 1600.36, reportedBalance: 67858.03 });
    expect(fixture.rows[10]).toMatchObject({ expectedPrincipal: 95.97, expectedInterest: 1343.97, expectedFees: 160.42, expectedAmount: 1600.36, reportedBalance: 67762.06 });
    expect(fixture.rows[128]).toMatchObject({ expectedPrincipal: 1566.43, expectedInterest: 31.02, expectedFees: 3.71, expectedAmount: 1601.16, reportedBalance: 0 });
    expect(fixture.rows.reduce((sum, row) => sum + (row.expectedPrincipal ?? 0), 0)).toBeCloseTo(85000, 8);
    expect(fixture.rows.reduce((sum, row) => sum + (row.expectedInterest ?? 0), 0)).toBeCloseTo(110837.54, 8);
    expect(fixture.rows.reduce((sum, row) => sum + (row.expectedFees ?? 0), 0)).toBeCloseTo(13206.46, 8);
    expect(fixture.rows.reduce((sum, row) => sum + (row.expectedAmount ?? 0), 0)).toBeCloseTo(209044, 8);
  });

  it.each([28, 29, 30, 31, 47])( "calculates TNA simple interest for irregular period %i", (days) => {
    expect(calculateNominalAnnualSimpleInterest({ principal: 68000, annualRatePercent: 23, elapsedDays: days, dayCountBasis: "actual_days_360" })).toBe(
      Math.round(68000 * 0.23 * days / 360 * 100) / 100,
    );
  });

  it("keeps proforma authority separate from exact reconciliation and preserves null", () => {
    const normalized = normalizeUniversalDebtDocument({
      kind: "schedule",
      authority: classifyDebtDocumentAuthority({ contractualDocument: false, officialButNonContractual: true }),
      rows: [
        { due_date: "2027-01-10", opening_balance: "1000", expected_principal: "1000", expected_interest: "0", reported_balance: "0", evidence: { source: "proforma" } },
        { due_date: "2027-02-10", expected_amount: null, expected_principal: null },
      ],
    });
    expect(normalized.authority).toBe("official_noncontractual");
    expect(normalized.rows[0]).toMatchObject({ openingBalance: 1000, endingBalance: 0, authority: "official_noncontractual", evidence: { source: "proforma" } });
    expect(normalized.rows[1].expectedAmount).toBeNull();
    expect(reconcileUniversalDebtDocument(normalized.rows, 1000).status).toBe("exact");
  });

  it("includes a known tax exactly once while preserving unknown tax as reviewable", () => {
    expect(validateUniversalScheduleArithmetic({ expectedAmount: 110, expectedPrincipal: 80, expectedInterest: 20, expectedFees: 5, expectedInsurance: 0, expectedTaxes: 5 })).toBe(true);
    expect(validateUniversalScheduleArithmetic({ expectedAmount: 105, expectedPrincipal: 80, expectedInterest: 20, expectedFees: 5, expectedInsurance: 0 })).toBe(true);
    expect(validateUniversalScheduleArithmetic({ expectedAmount: 110, expectedPrincipal: 80, expectedInterest: 20, expectedFees: 5, expectedInsurance: 0, expectedTaxes: 4 })).toBe(false);
  });

  it("uses effective direct allocations for partial and carried residuals", () => {
    const installment: DebtInstallment = { id: "installment-1", scheduleVersionId: "schedule-1", debtId: debt.id, installmentNumber: 1, dueDate: "2027-02-10", expectedAmount: 1000, expectedPrincipal: 800, expectedInterest: 150, expectedFees: 50, expectedInsurance: 0, createdByUserId: "user-1", createdAt: "2027-01-01T00:00:00Z" };
    const partial = deriveUniversalDebtState({ debt, events: [event({ id: "partial-event", cashAmount: 400, principalDelta: -400, eventDate: "2027-02-01" })], installments: [installment], allocations: [{ id: "allocation-1", eventId: "partial-event", installmentId: installment.id, debtId: debt.id, allocatedAmount: 400, createdByUserId: "user-1", createdAt: "2027-02-01T00:00:00Z" }] });
    expect(partial.nextInstallmentAmount).toBe(600);
    expect(partial.remainingProjectedTotalCash).toBe(600);
    expect(partial.remainingProjectedInterest).toBeNull();
    const carried = deriveUniversalDebtState({ debt, events: [event({ id: "old-event", eventDate: "2027-01-15" })], installments: [installment], allocations: [{ id: "old-allocation", eventId: "old-event", installmentId: "another-installment", debtId: debt.id, allocatedAmount: 250, createdByUserId: "user-1", createdAt: "2027-01-15T00:00:00Z" }], carriedAllocations: [{ id: "carried-1", restoredInstallmentId: installment.id, sourceEventId: "old-event", sourceAllocationId: "old-allocation", debtId: debt.id, householdId: "household-1", allocatedAmount: 250, createdByUserId: "user-1", createdAt: "2027-02-01T00:00:00Z" }] });
    expect(carried.nextInstallmentAmount).toBe(750);
  });

  it("simulates a non-bank fixed debt with TNA actual/360 and refuses schedule-only terms", () => {
    const result = simulateUniversalDebtPrepayment({ effect: "reduce_term", principalBeforeOperation: 1000, principalPaid: 100, operationDate: "2027-01-01", currentSchedule: [{ installmentNumber: 1, contractualInstallmentNumber: 1, dueDate: "2027-02-01", expectedAmount: 600, expectedPrincipal: 500, expectedInterest: 100, expectedFees: 0, expectedInsurance: 0, expectedTaxes: 0 }, { installmentNumber: 2, contractualInstallmentNumber: 2, dueDate: "2027-03-01", expectedAmount: 600, expectedPrincipal: 500, expectedInterest: 100, expectedFees: 0, expectedInsurance: 0, expectedTaxes: 0 }], contract: { repaymentStructure: "fixed_schedule", interestRateType: "nominal_annual_simple", interestRatePercent: 36, interestRateBasis: null, dayCountBasis: "actual_days_360", feeRuleType: "fixed", feeRule: { amount: 0 }, prepaymentTerms: {} } });
    expect(result.principalAfter).toBe(900);
    expect(result.status).toBe("calculated");
    expect(result.rows[0].interest).toBe(27.9);
    const unknown = simulateUniversalDebtPrepayment({ effect: "reduce_installment", principalBeforeOperation: 1000, principalPaid: 100, operationDate: "2027-01-01", currentSchedule: [{ installmentNumber: 1, contractualInstallmentNumber: 1, dueDate: "2027-02-01", expectedAmount: 600, expectedPrincipal: 500, expectedInterest: 100, expectedFees: null, expectedInsurance: 0, expectedTaxes: 0 }], contract: { repaymentStructure: "fixed_schedule", interestRateType: "contract_schedule", interestRatePercent: null, interestRateBasis: null, dayCountBasis: "unknown", feeRuleType: "unknown", feeRule: {}, prepaymentTerms: {} } });
    expect(unknown.status).toBe("insufficient_data");
    expect(unknown.canPersist).toBe(false);
  });

  it.each([
    ["effective_annual", null],
    ["effective_periodic", "monthly"],
  ] as const)("simulates non-bank fixed debt with %s", (interestRateType, interestRateBasis) => {
    const result = simulateUniversalDebtPrepayment({
      effect: "reduce_term",
      principalBeforeOperation: 1000,
      principalPaid: 100,
      operationDate: "2027-01-01",
      currentSchedule: [
        { installmentNumber: 1, contractualInstallmentNumber: 1, dueDate: "2027-02-01", expectedAmount: 600, expectedPrincipal: 500, expectedInterest: 100, expectedFees: 0, expectedInsurance: 0, expectedTaxes: 0 },
        { installmentNumber: 2, contractualInstallmentNumber: 2, dueDate: "2027-03-01", expectedAmount: 600, expectedPrincipal: 500, expectedInterest: 100, expectedFees: 0, expectedInsurance: 0, expectedTaxes: 0 },
      ],
      contract: { repaymentStructure: "fixed_schedule", interestRateType, interestRatePercent: 12, interestRateBasis, dayCountBasis: "unknown", feeRuleType: "fixed", feeRule: { amount: 0 }, prepaymentTerms: {} },
    });
    expect(result.status).toBe("calculated");
    expect(result.canPersist).toBe(true);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("passes the 129-row fixture through the same V2 parser and mapper used by the UI", () => {
    const fixture = createDirectRealEstateFixture();
    const review = parseUniversalDebtExternalAiResponse(JSON.stringify({ schema: "CAJA_FAMILIAR_DEBT_DOCUMENT_V2", kind: "schedule", authority: "official_noncontractual", contract: { assetPrice: fixture.assetPrice, downPaymentAmount: fixture.downPaymentAmount, financedPrincipalAmount: fixture.financedPrincipalAmount, scheduledPrincipalAmount: fixture.scheduledPrincipalAmount, interestRateType: "nominal_annual_simple", interestRatePercent: 23, dayCountBasis: "actual_days_360" }, rows: fixture.rows }), fixture.scheduledPrincipalAmount);
    const mapped = mapUniversalDocumentRowsToSchedule(review);
    expect(review.isAuthoritative).toBe(false);
    expect(review.warnings.join(" ")).toContain("PROFORMA");
    expect(mapped).toHaveLength(129);
    expect(review.reconciliation.status).toBe("exact");
    expect(mapped[0]).toMatchObject({ expectedPrincipal: 8500, expectedAmount: 8500 });
    expect(mapped[8]?.expectedInterest).toBe(0);
    expect(mapped[9]).toMatchObject({ expectedInterest: 1303.33 });
    expect(mapped.reduce((sum, row) => sum + (row.expectedAmount ?? 0), 0)).toBeCloseTo(209044, 8);
  });
});
