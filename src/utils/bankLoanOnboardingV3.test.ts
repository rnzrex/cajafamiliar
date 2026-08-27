import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { Debt, DebtInstallment, DebtScheduleVersion } from "../types";
import { applyInitialBankLoanBaseline, baselineConsistencyWarning, bankLoanScheduleConsistencyError } from "./bankLoanBaseline";
import { addMonthsClamped, generateEstimatedDebtSchedule } from "./debtEstimation";
import { effectivePeriodicRateFromTea } from "./debtInterestEngine";
import { parseContractualScheduleText } from "./debtScheduleParser";
import { parseDebtScheduleFile } from "./debtScheduleFileParser";
import { buildDebtPlanningItems } from "./debtPlanning";
import { validateDebtAllocations } from "./debtViewModel";
import { buildDebtIntelligenceItems } from "./debtIntelligence";
import { resolveContractualDetailNextPayment } from "./debtDetailNextPayment";

function scheduleLine(number: number, date = `2026-${String(number).padStart(2, "0")}-15`): string {
  return `${number}\t${date}\t100.00\t60.00\t30.00\t5.00\t5.00`;
}

function xlsxSchedule(numbers: number[]): ArrayBuffer {
  const rows = [
    ["N° cuota", "Fecha vencimiento", "Total cuota", "Amortización", "Interés", "Seguro Desgravamen", "Gastos"],
    ...numbers.map((number) => [number, new Date(Date.UTC(2026, number + 7, 15)), 100, 60, 30, 5, 5]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Cronograma");
  return XLSX.write(workbook, { bookType: "xlsx", type: "array" });
}

function fixedScheduleInstallments(debtId: string, scheduleVersionId: string, count: number): DebtInstallment[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `installment-${index + 1}`,
    scheduleVersionId,
    debtId,
    installmentNumber: index + 1,
    contractualInstallmentNumber: index + 1,
    isPaidBeforeTracking: index < 5,
    dueDate: addMonthsClamped("2026-01-15", index),
    expectedAmount: 100,
    expectedPrincipal: 60,
    expectedInterest: 30,
    expectedFees: 5,
    expectedInsurance: 5,
    createdByUserId: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
  }));
}

describe("BANK LOAN ONBOARDING V3", () => {
  it("reconstructs the complete original schedule from financed amount, not current balance", () => {
    const estimate = generateEstimatedDebtSchedule({
      financedAmount: 10_000,
      teaPercent: 60.1,
      termInstallments: 18,
      paymentFrequency: "monthly",
      firstDueDate: "2026-09-15",
      amortizationMethod: "fixed_installment",
      installmentsPaidBeforeTracking: 5,
    });
    const smallerEstimate = generateEstimatedDebtSchedule({
      financedAmount: 7_000,
      teaPercent: 60.1,
      termInstallments: 18,
      paymentFrequency: "monthly",
      firstDueDate: "2026-09-15",
      amortizationMethod: "fixed_installment",
      installmentsPaidBeforeTracking: 5,
    });
    const periodicRate = effectivePeriodicRateFromTea({ teaPercent: 60.1, frequency: "monthly" }).rateDecimal;

    expect(estimate.rows).toHaveLength(18);
    expect(estimate.rows[0].installmentNumber).toBe(1);
    expect(estimate.rows.at(-1)?.installmentNumber).toBe(18);
    expect(estimate.totalPrincipal).toBe(10_000);
    expect(estimate.rows[0].expectedInterest).toBe(Math.round(10_000 * periodicRate * 100) / 100);
    expect(estimate.financialInstallmentAmount).toBeGreaterThan(smallerEstimate.financialInstallmentAmount);
    expect(estimate.remainingPrincipalBalanceAfterPaidBeforeTracking).toBeLessThan(10_000);
    expect(estimate.remainingPrincipalBalanceAfterPaidBeforeTracking).not.toBe(smallerEstimate.remainingPrincipalBalanceAfterPaidBeforeTracking);
  });

  it("preserves an unknown paid-before baseline instead of treating it as zero", () => {
    const estimate = generateEstimatedDebtSchedule({
      financedAmount: 10_000,
      teaPercent: 60.1,
      termInstallments: 18,
      paymentFrequency: "monthly",
      firstDueDate: "2026-09-15",
      amortizationMethod: "fixed_installment",
      installmentsPaidBeforeTracking: null,
    });

    expect(estimate.remainingPrincipalBalanceAfterPaidBeforeTracking).toBeNull();
  });

  it.each([
    ["per_installment", 10, 180, false],
    ["total_credit_even", 180, 180, false],
  ] as const)("keeps insurance total exact for %s", (rateBasis, amount, expectedTotal, unknown) => {
    const estimate = generateEstimatedDebtSchedule({
      financedAmount: 10_000,
      teaPercent: 0,
      termInstallments: 18,
      paymentFrequency: "monthly",
      firstDueDate: "2026-09-15",
      amortizationMethod: "constant_principal",
      fixedInsuranceAmount: rateBasis === "per_installment" ? amount : 0,
      fixedInsuranceTotalAmount: rateBasis === "per_installment" ? 0 : amount,
      fixedInsuranceRateBasis: rateBasis,
    });

    expect(estimate.totalInsurance).toBe(expectedTotal);
    expect(estimate.hasUnknownInsuranceDistribution).toBe(unknown);
  });

  it("adjusts the last even-distributed insurance row to cents", () => {
    const estimate = generateEstimatedDebtSchedule({
      financedAmount: 1_000,
      teaPercent: 0,
      termInstallments: 3,
      paymentFrequency: "monthly",
      firstDueDate: "2026-09-15",
      amortizationMethod: "constant_principal",
      fixedInsuranceTotalAmount: 100,
      fixedInsuranceRateBasis: "total_credit_even",
    });

    expect(estimate.rows.map((row) => row.expectedInsurance)).toEqual([33.33, 33.33, 33.34]);
    expect(estimate.totalInsurance).toBe(100);
  });

  it("supports upfront and unknown total insurance without inventing installments", () => {
    const upfront = generateEstimatedDebtSchedule({
      financedAmount: 1_000,
      teaPercent: 0,
      termInstallments: 3,
      paymentFrequency: "monthly",
      firstDueDate: "2026-09-15",
      amortizationMethod: "constant_principal",
      fixedInsuranceTotalAmount: 180,
      fixedInsuranceRateBasis: "total_credit_upfront",
    });
    const unknown = generateEstimatedDebtSchedule({
      financedAmount: 1_000,
      teaPercent: 0,
      termInstallments: 3,
      paymentFrequency: "monthly",
      firstDueDate: "2026-09-15",
      amortizationMethod: "constant_principal",
      fixedInsuranceTotalAmount: 180,
      fixedInsuranceRateBasis: "total_credit_unknown",
    });

    expect(upfront.rows.map((row) => row.expectedInsurance)).toEqual([180, 0, 0]);
    expect(upfront.totalInsurance).toBe(180);
    expect(unknown.rows.every((row) => row.expectedInsurance === 0)).toBe(true);
    expect(unknown.totalInsurance).toBe(0);
    expect(unknown.undistributedInsuranceTotal).toBe(180);
    expect(unknown.hasUnknownInsuranceDistribution).toBe(true);
  });

  it("preserves mixed fixed-insurance bases in separate estimator buckets", () => {
    const evenAndUpfront = generateEstimatedDebtSchedule({
      financedAmount: 1_000,
      teaPercent: 0,
      termInstallments: 18,
      paymentFrequency: "monthly",
      firstDueDate: "2026-09-15",
      amortizationMethod: "constant_principal",
      fixedInsuranceTotalEvenAmount: 180,
      fixedInsuranceTotalUpfrontAmount: 200,
    });
    const unknownAndEven = generateEstimatedDebtSchedule({
      financedAmount: 1_000,
      teaPercent: 0,
      termInstallments: 18,
      paymentFrequency: "monthly",
      firstDueDate: "2026-09-15",
      amortizationMethod: "constant_principal",
      fixedInsuranceTotalEvenAmount: 180,
      fixedInsuranceTotalUnknownAmount: 90,
    });
    const perInstallmentAndEven = generateEstimatedDebtSchedule({
      financedAmount: 1_000,
      teaPercent: 0,
      termInstallments: 18,
      paymentFrequency: "monthly",
      firstDueDate: "2026-09-15",
      amortizationMethod: "constant_principal",
      fixedInsurancePerInstallmentAmount: 5,
      fixedInsuranceTotalEvenAmount: 180,
    });
    const sameBasis = generateEstimatedDebtSchedule({
      financedAmount: 1_000,
      teaPercent: 0,
      termInstallments: 18,
      paymentFrequency: "monthly",
      firstDueDate: "2026-09-15",
      amortizationMethod: "constant_principal",
      fixedInsuranceTotalEvenAmount: 100 + 80,
    });

    expect(evenAndUpfront.rows[0].expectedInsurance).toBe(210);
    expect(evenAndUpfront.rows.slice(1).every((row) => row.expectedInsurance === 10)).toBe(true);
    expect(evenAndUpfront.totalInsurance).toBe(380);
    expect(unknownAndEven.totalInsurance).toBe(180);
    expect(unknownAndEven.undistributedInsuranceTotal).toBe(90);
    expect(unknownAndEven.rows.every((row) => row.expectedInsurance === 10)).toBe(true);
    expect(perInstallmentAndEven.totalInsurance).toBe(270);
    expect(perInstallmentAndEven.rows.every((row) => row.expectedInsurance === 15)).toBe(true);
    expect(sameBasis.totalInsurance).toBe(180);
    expect(sameBasis.rows[0].expectedInsurance).toBe(10);
  });

  it("marks only a complete initial schedule as pre-tracking baseline", () => {
    const complete = applyInitialBankLoanBaseline(
      Array.from({ length: 18 }, (_, index) => ({ contractualInstallmentNumber: index + 1, isPaidBeforeTracking: false })),
      5
    );
    const partial = applyInitialBankLoanBaseline(
      Array.from({ length: 13 }, (_, index) => ({ contractualInstallmentNumber: index + 6, isPaidBeforeTracking: false })),
      5
    );
    const incompleteFromOne = applyInitialBankLoanBaseline(
      Array.from({ length: 10 }, (_, index) => ({ contractualInstallmentNumber: index + 1, isPaidBeforeTracking: false })),
      5,
      18
    );

    expect(complete.filter((row) => row.isPaidBeforeTracking)).toHaveLength(5);
    expect(complete[5].isPaidBeforeTracking).toBe(false);
    expect(partial.every((row) => !row.isPaidBeforeTracking)).toBe(true);
    expect(incompleteFromOne.every((row) => !row.isPaidBeforeTracking)).toBe(true);
    expect(baselineConsistencyWarning(5, 7)).toContain("próxima cuota es la 6");
  });

  it("derives and blocks the partial-schedule baseline invariant live", () => {
    const rows = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, index) => ({
      installmentNumber: index + 1,
      contractualInstallmentNumber: start + index,
    }));
    const base = {
      onboardingMode: "EXISTING_DEBT" as const,
      installmentsPaidBeforeTracking: 5,
      plannedInstallmentCount: 18,
      scheduleSource: "contractual" as const,
    };

    expect(bankLoanScheduleConsistencyError({ ...base, installments: rows(1, 18) })).toBeNull();
    expect(bankLoanScheduleConsistencyError({ ...base, installments: rows(6, 18) })).toBeNull();
    expect(bankLoanScheduleConsistencyError({ ...base, installments: rows(7, 18) })).toBe(
      "Dijiste que la próxima cuota es la 6, pero el cronograma comienza en la 7. Corrige la última cuota pagada o el cronograma."
    );
    expect(bankLoanScheduleConsistencyError({ ...base, installmentsPaidBeforeTracking: 4, installments: rows(6, 18) })).toContain("próxima cuota es la 5");
    expect(bankLoanScheduleConsistencyError({ ...base, installmentsPaidBeforeTracking: 4, installments: rows(6, 18) })).not.toBeNull();
    expect(bankLoanScheduleConsistencyError({ ...base, installmentsPaidBeforeTracking: 5, installments: rows(6, 18) })).toBeNull();
    expect(bankLoanScheduleConsistencyError({ ...base, scheduleSource: "estimated", installments: rows(6, 18) })).toContain("contrato completo");
  });

  it("excludes pre-tracking installments from planning and starts at contractual 6", () => {
    const debtId = "debt-1";
    const scheduleVersionId = "schedule-1";
    const debt = {
      id: debtId,
      name: "Crédito existente",
      creditorName: "Banco",
      debtKind: "bank_loan",
      currencyCode: "PEN",
      originDate: "2026-01-01",
      trackingStartDate: "2026-08-26",
      originalPrincipal: 10_000,
      openingPrincipalBalance: 7_000,
      plannedInstallmentCount: 18,
      plannedInstallmentAmount: 700,
      installmentAmountMode: "fixed",
      paymentFrequency: "monthly",
      customFrequencyDays: null,
      firstDueDate: "2026-01-15",
      teaPercent: 60.1,
      tceaPercent: null,
      notes: "",
      status: "active",
      isArchived: false,
      createdByUserId: "user-1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      repaymentStructure: "fixed_schedule",
      interestCalculationMode: "contract_schedule",
    } as Debt;
    const version = {
      id: scheduleVersionId,
      debtId,
      versionNumber: 1,
      effectiveDate: "2026-08-26",
      reason: "initial",
      scheduleSource: "contractual",
      isAuthoritative: true,
      triggerEventId: null,
      notes: "",
      createdByUserId: "user-1",
      createdAt: "2026-08-26T00:00:00Z",
    } as DebtScheduleVersion;

    const items = buildDebtPlanningItems([debt], [], [version], fixedScheduleInstallments(debtId, scheduleVersionId, 18), [], "2026-08-26");
    expect(items).toHaveLength(13);
    expect(items[0].installmentNumber).toBe(6);
    expect(items[0].contractualInstallmentNumber).toBe(6);
    expect(items.at(-1)?.contractualInstallmentNumber).toBe(18);
  });

  it("rejects client allocations over a pre-tracking installment", () => {
    const result = validateDebtAllocations(
      [{ installmentId: "historical", allocatedAmount: 100 }],
      [{
        id: "historical",
        scheduleVersionId: "schedule-1",
        debtId: "debt-1",
        installmentNumber: 1,
        contractualInstallmentNumber: 1,
        isPaidBeforeTracking: true,
        dueDate: "2026-01-15",
        expectedAmount: 100,
        expectedPrincipal: 80,
        expectedInterest: 20,
        expectedFees: 0,
        expectedInsurance: 0,
        createdByUserId: "user-1",
        createdAt: "2026-01-01T00:00:00Z",
      }],
      100,
      [],
      []
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("ya estaba pagada");
  });

  it("imports full and partial XLSX schedules and preserves contractual numbering", () => {
    const full = parseDebtScheduleFile(xlsxSchedule(Array.from({ length: 18 }, (_, index) => index + 1)));
    const partial = parseDebtScheduleFile(xlsxSchedule(Array.from({ length: 13 }, (_, index) => index + 6)));

    expect(full.valid).toBe(true);
    expect(full.rows).toHaveLength(18);
    expect(full.rows[0].contractualInstallmentNumber).toBe(1);
    expect(partial.valid).toBe(true);
    expect(partial.rows).toHaveLength(13);
    expect(partial.rows[0].installmentNumber).toBe(1);
    expect(partial.rows[0].contractualInstallmentNumber).toBe(6);
    expect(partial.rows.at(-1)?.contractualInstallmentNumber).toBe(18);

    expect(bankLoanScheduleConsistencyError({
      onboardingMode: "EXISTING_DEBT",
      installmentsPaidBeforeTracking: 5,
      plannedInstallmentCount: 18,
      scheduleSource: "contractual",
      installments: partial.rows,
    })).toBeNull();
  });

  it("imports CSV/TSV text and supports explicit manual column mapping", () => {
    const csv = new TextEncoder().encode([
      ["Cuota", "Fecha", "Total", "Capital", "Interes", "Seguro", "Gastos"].join(","),
      [6, "2026-09-15", 100, 60, 30, 5, 5].join(","),
    ].join("\n"));
    const csvResult = parseDebtScheduleFile(csv);
    expect(csvResult.valid).toBe(true);
    expect(csvResult.rows[0].contractualInstallmentNumber).toBe(6);

    const tsv = new TextEncoder().encode([
      ["Número", "Vence", "Importe", "Amortización", "Intereses", "Desgravamen", "Comisión"].join("\t"),
      [7, "2026-10-15", 100, 60, 30, 5, 5].join("\t"),
    ].join("\n"));
    const detected = parseDebtScheduleFile(tsv);
    const manuallyMapped = parseDebtScheduleFile(tsv, {
      installmentNumber: 0,
      dueDate: 1,
      expectedAmount: 2,
      expectedPrincipal: 3,
      expectedInterest: 4,
      expectedInsurance: 5,
      expectedFees: 6,
    });
    expect(detected.valid).toBe(false);
    expect(detected.missingColumns.length).toBeGreaterThan(0);
    expect(manuallyMapped.valid).toBe(true);
    expect(manuallyMapped.rows[0].contractualInstallmentNumber).toBe(7);
    expect(bankLoanScheduleConsistencyError({
      onboardingMode: "EXISTING_DEBT",
      installmentsPaidBeforeTracking: 5,
      plannedInstallmentCount: 18,
      scheduleSource: "contractual",
      installments: manuallyMapped.rows,
    })).not.toBeNull();
  });

  it("keeps planning, intelligence, and detail on contractual installment 6", () => {
    const debtId = "debt-detail-1";
    const scheduleVersionId = "schedule-detail-1";
    const debt = {
      id: debtId,
      name: "Crédito existente",
      creditorName: "Banco",
      debtKind: "bank_loan",
      currencyCode: "PEN",
      originDate: "2026-01-01",
      trackingStartDate: "2026-08-26",
      originalPrincipal: 10_000,
      openingPrincipalBalance: 7_000,
      plannedInstallmentCount: 18,
      plannedInstallmentAmount: 700,
      installmentAmountMode: "fixed",
      paymentFrequency: "monthly",
      customFrequencyDays: null,
      firstDueDate: "2026-01-15",
      teaPercent: null,
      tceaPercent: null,
      notes: "",
      status: "active",
      isArchived: false,
      createdByUserId: "user-1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      repaymentStructure: "fixed_schedule",
      interestCalculationMode: "contract_schedule",
    } as Debt;
    const version = {
      id: scheduleVersionId,
      debtId,
      versionNumber: 1,
      effectiveDate: "2026-08-26",
      reason: "initial",
      scheduleSource: "contractual",
      isAuthoritative: true,
      triggerEventId: null,
      notes: "",
      createdByUserId: "user-1",
      createdAt: "2026-08-26T00:00:00Z",
    } as DebtScheduleVersion;
    const installments = fixedScheduleInstallments(debtId, scheduleVersionId, 18);
    const planning = buildDebtPlanningItems([debt], [], [version], installments, [], "2026-08-26");
    const intelligence = buildDebtIntelligenceItems({
      debts: [debt],
      debtEvents: [],
      debtScheduleVersions: [version],
      debtInstallments: installments,
      debtCollaterals: [],
      debtPlanningItems: planning,
      todayKey: "2026-08-26",
    })[0];
    const detail = resolveContractualDetailNextPayment({
      debt,
      debtIntelligence: intelligence,
      currentScheduleId: scheduleVersionId,
      scheduleSource: "contractual",
      installments,
    });

    expect(planning[0].contractualInstallmentNumber).toBe(6);
    expect(intelligence.nextInstallmentNumber).toBe(6);
    expect(detail?.source).toBe("contractual_schedule");
    expect(detail?.installmentNumber).toBe(6);
    expect(detail?.dueDate).toBe(installments[5].dueDate);
    expect(detail?.dueDate).not.toBe(debt.firstDueDate);
  });

  it("rejects duplicate or out-of-order contractual schedule rows", () => {
    const duplicate = parseContractualScheduleText([scheduleLine(6), scheduleLine(6, "2026-10-15")].join("\n"));
    const outOfOrder = parseContractualScheduleText([scheduleLine(6), scheduleLine(8, "2026-10-15")].join("\n"));

    expect(duplicate.valid).toBe(false);
    expect(duplicate.errors.join(" ")).toContain("duplicado");
    expect(outOfOrder.valid).toBe(false);
    expect(outOfOrder.errors.join(" ")).toContain("continua");
  });

  it("reports missing spreadsheet columns instead of fabricating values", () => {
    const rows = [
      ["Cuota", "Fecha", "Total", "Capital", "Interés", "Gastos"],
      [1, "2026-09-15", 100, 60, 30, 10],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Cronograma");
    const result = parseDebtScheduleFile(XLSX.write(workbook, { bookType: "xlsx", type: "array" }));

    expect(result.valid).toBe(false);
    expect(result.missingColumns).toContain("expectedInsurance");
    expect(result.rows).toHaveLength(0);
  });
});
