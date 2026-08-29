import { describe, expect, it } from "vitest";
import { BANK_EXTERNAL_AI_ALFIN_FIXTURE } from "./bankExternalAiFixture.js";
import { simulateBankPrepayment } from "./bankPrepaymentSimulation.js";

const alfinSchedule = BANK_EXTERNAL_AI_ALFIN_FIXTURE.schedule.map((row, index) => ({
  installmentNumber: index + 1,
  contractualInstallmentNumber: row.contractualInstallmentNumber,
  dueDate: row.dueDate,
  expectedAmount: row.total,
  expectedPrincipal: row.principal,
  expectedInterest: row.interest,
  expectedFees: row.fees,
  expectedInsurance: row.insurance,
}));

const alfinInput = {
  principalBeforeOperation: 3294.39,
  principalPaid: 184.92,
  extraPrincipalPaid: 500,
  operationDate: "2026-11-10",
  originalPrincipal: 4100,
  originalTermInstallments: 18,
  teaPercent: 68.4,
  dayCountBasis: "actual_days_360" as const,
  installmentTotalMode: "total_installment_including_costs" as const,
  dueDateAdjustmentRule: "sunday_to_monday" as const,
  amortizationMethod: "fixed_installment" as const,
  currentScheduleSource: "contractual" as const,
  currentScheduleAuthoritative: true,
  currentSchedule: alfinSchedule,
  insuranceTerms: [{
    pricingMode: "percent_outstanding_balance" as const,
    ratePercent: 0.35,
    fixedAmount: null,
    rateBasis: "per_installment",
    isRequired: true,
  }],
};

describe("bank prepayment simulation", () => {
  it("recalculates ALFIN reduce_term from the post-operation principal", () => {
    const result = simulateBankPrepayment({ ...alfinInput, effect: "reduce_term" });

    expect(result.status).toBe("calculated");
    expect(result.principalAfter).toBe(2609.47);
    expect(result.oldRemainingInstallments).toBe(12);
    expect(result.newRemainingInstallments).toBe(10);
    expect(result.oldRegularInstallment).toBe(347.67);
    expect(result.newRegularInstallment).toBe(347.67);
    expect(result.rows[0]).toMatchObject({
      contractualInstallmentNumber: 7,
      dueDate: "2026-12-10",
      principal: 222.71,
      interest: 115.83,
      insurance: 9.13,
      total: 347.67,
    });
    expect(result.newFinalDueDate).toBe("2027-09-10");
    expect(result.rows.at(-1)?.remainingPrincipalBalance).toBe(0);
  });

  it("recalculates ALFIN reduce_installment while preserving dates and count", () => {
    const result = simulateBankPrepayment({ ...alfinInput, effect: "reduce_installment" });

    expect(result.status).toBe("calculated");
    expect(result.principalAfter).toBe(2609.47);
    expect(result.newRemainingInstallments).toBe(12);
    expect(result.newRegularInstallment).toBeCloseTo(291.77, 2);
    expect(result.rows[0]).toMatchObject({
      contractualInstallmentNumber: 7,
      dueDate: "2026-12-10",
      interest: 115.83,
      insurance: 9.13,
      principal: 166.81,
      total: 291.77,
    });
    expect(result.rows.at(-1)).toMatchObject({
      dueDate: "2027-11-10",
      principal: 278.45,
      interest: 12.36,
      insurance: 0.97,
      total: 291.78,
      remainingPrincipalBalance: 0,
    });
  });

  it("uses actual/365 when requested and preserves contractual Sunday adjustment dates", () => {
    const result = simulateBankPrepayment({ ...alfinInput, effect: "reduce_term", dayCountBasis: "actual_days_365" });
    expect(result.status).toBe("calculated");
    expect(result.rows[0]?.dueDate).toBe("2026-12-10");
    expect(result.rows.some((row) => row.dueDate === "2027-01-11")).toBe(true);
  });

  it("warns and refuses persistence when future insurance pricing is unknown", () => {
    const result = simulateBankPrepayment({
      ...alfinInput,
      effect: "reduce_installment",
      insuranceTerms: [{ pricingMode: "contract_schedule", ratePercent: null, fixedAmount: null, rateBasis: null, isRequired: true }],
    });
    expect(result.status).toBe("calculated_with_warnings");
    expect(result.canPersist).toBe(false);
    expect(result.warnings.join(" ")).toContain("seguro futuro depende del banco");
  });

  it("refuses false precision when the rate or future dates are missing", () => {
    const noRate = simulateBankPrepayment({ ...alfinInput, effect: "reduce_term", teaPercent: null, dayCountBasis: null });
    expect(noRate.status).toBe("insufficient_data");
    expect(noRate.rows).toEqual([]);

    const noDates = simulateBankPrepayment({ ...alfinInput, effect: "reduce_installment", currentSchedule: [] });
    expect(noDates.status).toBe("insufficient_data");
  });

  it("refuses standalone principal prepayment without a regular installment", () => {
    const result = simulateBankPrepayment({ ...alfinInput, effect: "reduce_term", principalPaid: 0, extraPrincipalPaid: 500 });
    expect(result.principalAfter).toBeNull();
    expect(result.status).toBe("insufficient_data");
    expect(result.rows).toEqual([]);
    expect(result.canPersist).toBe(false);
    expect(result.warnings).toContain("Un prepago independiente puede cambiar el tratamiento del interés del período. Registra el abono y espera/carga el cronograma actualizado del banco.");
  });

  it("applies known fixed insurance rules without inventing a schedule", () => {
    const even = simulateBankPrepayment({
      ...alfinInput,
      effect: "reduce_installment",
      insuranceTerms: [{ pricingMode: "fixed_amount", ratePercent: null, fixedAmount: 120, rateBasis: "total_credit_even", isRequired: true }],
    });
    expect(even.status).toBe("calculated");
    expect(even.rows[0]?.insurance).toBe(6.67);
    expect(even.rows.at(-1)?.insurance).toBe(6.61);

    const upfront = simulateBankPrepayment({
      ...alfinInput,
      effect: "reduce_term",
      insuranceTerms: [{ pricingMode: "fixed_amount", ratePercent: null, fixedAmount: 120, rateBasis: "total_credit_upfront", isRequired: true }],
    });
    expect(upfront.status).toBe("calculated");
    expect(upfront.rows.every((row) => row.insurance === 0)).toBe(true);
  });

  it("does not redistribute total-credit-even insurance after a prepayment", () => {
    const result = simulateBankPrepayment({
      ...alfinInput,
      effect: "reduce_term",
      insuranceTerms: [{ pricingMode: "fixed_amount", ratePercent: null, fixedAmount: 120, rateBasis: "total_credit_even", isRequired: true }],
    });
    expect(result.status).toBe("calculated");
    expect(result.rows.map((row) => row.insurance)).toEqual(Array(10).fill(6.67));
  });

  it("keeps per-installment fixed insurance on every future row", () => {
    const result = simulateBankPrepayment({
      ...alfinInput,
      effect: "reduce_term",
      insuranceTerms: [{ pricingMode: "fixed_amount", ratePercent: null, fixedAmount: 7, rateBasis: "per_installment", isRequired: true }],
    });
    expect(result.status).toBe("calculated");
    expect(result.rows.every((row) => row.insurance === 7)).toBe(true);
  });

  it("does not invent a fixed insurance charge when the basis is unknown", () => {
    const result = simulateBankPrepayment({
      ...alfinInput,
      effect: "reduce_term",
      insuranceTerms: [{ pricingMode: "fixed_amount", ratePercent: null, fixedAmount: 7, rateBasis: null, isRequired: true }],
    });
    expect(result.status).toBe("calculated_with_warnings");
    expect(result.canPersist).toBe(false);
    expect(result.newEstimatedInterest).toBeNull();
    expect(result.estimatedInterestSavings).toBeNull();
    expect(result.rows.every((row) => row.insurance === 0)).toBe(true);
    expect(result.warnings).toContain("El seguro futuro depende del banco; no se inventó una fórmula.");
  });

  it("allows zero future fees but refuses positive unknown fees", () => {
    const zeroFees = simulateBankPrepayment({ ...alfinInput, effect: "reduce_term" });
    expect(zeroFees.status).toBe("calculated");

    const positiveFees = simulateBankPrepayment({
      ...alfinInput,
      effect: "reduce_term",
      currentSchedule: alfinSchedule.map((row) => ({ ...row, expectedFees: 3 })),
    });
    expect(positiveFees.status).toBe("calculated_with_warnings");
    expect(positiveFees.canPersist).toBe(false);
    expect(positiveFees.newEstimatedInterest).toBeNull();
    expect(positiveFees.estimatedInterestSavings).toBeNull();
    expect(positiveFees.warnings).toContain("Las comisiones futuras dependen del banco y no tenemos una regla contractual suficiente para recalcularlas.");
  });

  it("blocks standalone mid-period prepayment and future allocations", () => {
    const midPeriod = simulateBankPrepayment({
      ...alfinInput,
      effect: "reduce_term",
      principalPaid: 0,
      extraPrincipalPaid: 500,
      operationDate: "2026-11-15",
    });
    expect(midPeriod.status).toBe("insufficient_data");
    expect(midPeriod.canPersist).toBe(false);
    expect(midPeriod.warnings).toContain("Un prepago independiente puede cambiar el tratamiento del interés del período. Registra el abono y espera/carga el cronograma actualizado del banco.");

    const allocated = simulateBankPrepayment({
      ...alfinInput,
      effect: "reduce_term",
      hasAllocatedFutureInstallments: true,
    });
    expect(allocated.status).toBe("insufficient_data");
    expect(allocated.warnings).toContain("Hay cuotas futuras adelantadas. Necesitamos confirmar cómo el banco las tratará junto con el prepago.");
  });

  it("blocks an off-cycle payment with extra principal but accepts the contractual due date", () => {
    const offCycle = simulateBankPrepayment({
      ...alfinInput,
      effect: "reduce_term",
      principalPaid: 184.92,
      extraPrincipalPaid: 500,
      operationDate: "2026-11-15",
      hasContractualDueDateForPayment: false,
    });
    expect(offCycle.status).toBe("insufficient_data");
    expect(offCycle.canPersist).toBe(false);
    expect(offCycle.warnings).toContain("El pago con abono al capital ocurrió fuera del vencimiento contractual y no conocemos con certeza cómo el banco tratará el interés del período. Usa el nuevo cronograma del banco.");

    const dueDate = simulateBankPrepayment({ ...alfinInput, effect: "reduce_term", hasContractualDueDateForPayment: true });
    expect(dueDate.status).toBe("calculated");
  });

  it("does not chain a simulation from an estimated or non-authoritative schedule", () => {
    const result = simulateBankPrepayment({
      ...alfinInput,
      effect: "reduce_term",
      currentScheduleSource: "estimated",
      currentScheduleAuthoritative: false,
    });
    expect(result.status).toBe("insufficient_data");
    expect(result.canPersist).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.warnings).toContain("El cronograma vigente todavía no es contractual del banco. Carga el cronograma oficial antes de generar una nueva simulación de prepago.");
  });

  it("keeps financial-installment-plus-costs distinct from total-installment mode", () => {
    const result = simulateBankPrepayment({
      ...alfinInput,
      effect: "reduce_term",
      installmentTotalMode: "financial_installment_plus_costs",
    });
    expect(result.status).toBe("calculated");
    expect(result.rows[0]!.total).toBeCloseTo(result.rows[0]!.principal + result.rows[0]!.interest + result.rows[0]!.insurance + result.rows[0]!.fees, 2);
  });

  it("reports the recalculated all-in total for financial-installment-plus-costs reduce_term", () => {
    const result = simulateBankPrepayment({
      ...alfinInput,
      effect: "reduce_term",
      installmentTotalMode: "financial_installment_plus_costs",
      insuranceTerms: [{
        pricingMode: "percent_outstanding_balance",
        ratePercent: 0.35,
        fixedAmount: null,
        rateBasis: "per_installment",
        isRequired: true,
      }],
    });
    expect(result.status).toBe("calculated");
    expect(result.newRegularInstallment).toBe(result.rows[0]!.total);
    expect(result.rows[0]!.insurance).toBeLessThan(alfinSchedule[6]!.expectedInsurance!);
    expect(result.newRegularInstallment).not.toBe(result.oldRegularInstallment);
  });

  it("refuses unsupported amortization and incomplete future charges", () => {
    const unsupported = simulateBankPrepayment({ ...alfinInput, effect: "reduce_term", amortizationMethod: "constant_principal" });
    expect(unsupported.status).toBe("insufficient_data");
    expect(unsupported.canPersist).toBe(false);

    const missingFees = simulateBankPrepayment({
      ...alfinInput,
      effect: "reduce_installment",
      currentSchedule: alfinSchedule.map((row) => ({ ...row, expectedFees: null })),
    });
    expect(missingFees.status).toBe("calculated_with_warnings");
    expect(missingFees.canPersist).toBe(false);
  });

  it("never persists a projection that would cancel the debt or lose contractual numbers", () => {
    const full = simulateBankPrepayment({ ...alfinInput, effect: "reduce_term", principalPaid: 2794.39, extraPrincipalPaid: 500 });
    expect(full.status).toBe("insufficient_data");
    expect(full.principalAfter).toBeNull();

    const normal = simulateBankPrepayment({ ...alfinInput, effect: "reduce_term" });
    expect(normal.rows.every((row) => row.contractualInstallmentNumber >= 7)).toBe(true);
  });
});
