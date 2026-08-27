import { describe, expect, it } from "vitest";
import { financialValidation } from "./bankDocumentFinancialValidation.js";
import { normalizeBankDocumentExtraction } from "./bankDocumentExtraction.js";
import { BANK_EXTERNAL_AI_ALFIN_FIXTURE } from "./bankExternalAiFixture.js";
import { evaluateBankDocumentCompleteness, type BankDocumentCompletenessContext } from "./bankDocumentCompleteness.js";

const completeContext: BankDocumentCompletenessContext = {
  onboardingMode: "NEW_DEBT",
  creditorName: "Entidad fixture",
  currencyCode: "PEN",
};

function extraction(raw: unknown = BANK_EXTERNAL_AI_ALFIN_FIXTURE) {
  return normalizeBankDocumentExtraction(raw).value;
}

function completeness(raw: unknown, context: BankDocumentCompletenessContext = completeContext) {
  const value = extraction(raw);
  return evaluateBankDocumentCompleteness(value, financialValidation(value), context);
}

describe("bank document completeness", () => {
  it("marks the complete 18/18 fixture as full with no required issues", () => {
    const result = completeness(BANK_EXTERNAL_AI_ALFIN_FIXTURE);
    expect(result.status).toBe("complete");
    expect(result.requiredIssues).toHaveLength(0);
    expect(result.scheduleCoverage).toMatchObject({ status: "full", expectedInstallments: 18, foundInstallments: 18, firstContractualInstallment: 1, lastContractualInstallment: 18, pendingOnly: false });
  });

  it("requires the last paid contractual installment for an existing debt", () => {
    const result = completeness(BANK_EXTERNAL_AI_ALFIN_FIXTURE, {
      onboardingMode: "EXISTING_DEBT",
      installmentsPaidBeforeTracking: null,
      creditorName: "Entidad fixture",
      currencyCode: "PEN",
    });
    expect(result.requiredIssues).toContainEqual({
      code: "LAST_PAID_INSTALLMENT_REQUIRED",
      field: "installmentsPaidBeforeTracking",
      severity: "required",
      title: "Falta la última cuota pagada",
      message: "Indicaste que ya vienes pagando este crédito, pero no sabemos cuál fue la última cuota contractual pagada.",
      action: "Busca en tu banca, comprobante o cronograma el número de la última cuota pagada. Si todavía no pagaste ninguna, selecciona «Es nuevo / todavía no he pagado cuotas».",
    });
    expect(result.requiredIssues).not.toContainEqual(expect.objectContaining({ code: "PAID_BEFORE_INVALID" }));
  });

  it("rejects zero for existing debt but keeps zero valid for new debt", () => {
    const existing = completeness(BANK_EXTERNAL_AI_ALFIN_FIXTURE, {
      onboardingMode: "EXISTING_DEBT",
      installmentsPaidBeforeTracking: 0,
      creditorName: "Entidad fixture",
      currencyCode: "PEN",
    });
    expect(existing.requiredIssues).toContainEqual(expect.objectContaining({ code: "LAST_PAID_INSTALLMENT_REQUIRED", field: "installmentsPaidBeforeTracking" }));

    const newDebt = completeness(BANK_EXTERNAL_AI_ALFIN_FIXTURE, {
      onboardingMode: "NEW_DEBT",
      installmentsPaidBeforeTracking: 0,
      creditorName: "Entidad fixture",
      currencyCode: "PEN",
    });
    expect(newDebt.requiredIssues).not.toContainEqual(expect.objectContaining({ code: "LAST_PAID_INSTALLMENT_REQUIRED" }));
  });

  it("keeps a derived current principal pending until the user confirms it", () => {
    const result = completeness(BANK_EXTERNAL_AI_ALFIN_FIXTURE, {
      onboardingMode: "EXISTING_DEBT",
      installmentsPaidBeforeTracking: 5,
      creditorName: "Entidad fixture",
      currencyCode: "PEN",
    });
    expect(result.requiredIssues).toContainEqual(expect.objectContaining({
      code: "CURRENT_PRINCIPAL_REQUIRED",
      message: expect.stringContaining("puede calcularlo usando el cronograma"),
      action: expect.stringContaining("Pulsa «Calcular»"),
    }));

    const confirmed = completeness(BANK_EXTERNAL_AI_ALFIN_FIXTURE, {
      onboardingMode: "EXISTING_DEBT",
      installmentsPaidBeforeTracking: 5,
      currentPrincipal: 3294.39,
      creditorName: "Entidad fixture",
      currencyCode: "PEN",
    });
    expect(confirmed.requiredIssues).toHaveLength(0);
  });

  it("does not mistake a term and regular payment for a found schedule", () => {
    const result = completeness({
      ...BANK_EXTERNAL_AI_ALFIN_FIXTURE,
      schedule: [],
      teaPercent: null,
      firstDueDate: "2026-06-10",
      regularInstallmentAmount: 347.67,
    });
    expect(result.scheduleCoverage).toMatchObject({ status: "not_found", expectedInstallments: 18, foundInstallments: 0 });
    expect(result.reviewIssues).toContainEqual(expect.objectContaining({ code: "SCHEDULE_EXPECTED_BUT_MISSING" }));
  });

  it("requires the missing rows in a normal 1..9 partial schedule", () => {
    const result = completeness({ ...BANK_EXTERNAL_AI_ALFIN_FIXTURE, schedule: BANK_EXTERNAL_AI_ALFIN_FIXTURE.schedule.slice(0, 9) });
    expect(result.scheduleCoverage).toMatchObject({ status: "partial", foundInstallments: 9, firstContractualInstallment: 1, lastContractualInstallment: 9, pendingOnly: false });
    expect(result.requiredIssues).toContainEqual(expect.objectContaining({ code: "SCHEDULE_PARTIAL" }));
  });

  it("accepts all pending rows 6..18 when current principal is known", () => {
    const value = extraction({ ...BANK_EXTERNAL_AI_ALFIN_FIXTURE, schedule: BANK_EXTERNAL_AI_ALFIN_FIXTURE.schedule.slice(5) });
    const result = evaluateBankDocumentCompleteness(value, financialValidation(value), {
      onboardingMode: "EXISTING_DEBT",
      installmentsPaidBeforeTracking: 5,
      currentPrincipal: 3294.39,
      creditorName: "Entidad fixture",
      currencyCode: "PEN",
    });
    expect(result.requiredIssues).toHaveLength(0);
    expect(result.scheduleCoverage).toMatchObject({ status: "partial", pendingOnly: true, firstContractualInstallment: 6, lastContractualInstallment: 18 });
    expect(result.reviewIssues).toContainEqual(expect.objectContaining({ code: "PENDING_ONLY_SCHEDULE" }));
  });

  it("does not treat a pending-only schedule as complete when last paid is unknown", () => {
    const result = completeness({ ...BANK_EXTERNAL_AI_ALFIN_FIXTURE, schedule: BANK_EXTERNAL_AI_ALFIN_FIXTURE.schedule.slice(5) }, {
      onboardingMode: "EXISTING_DEBT",
      installmentsPaidBeforeTracking: null,
      currentPrincipal: 3294.39,
      creditorName: "Entidad fixture",
      currencyCode: "PEN",
    });
    expect(result.requiredIssues).toContainEqual(expect.objectContaining({ code: "LAST_PAID_INSTALLMENT_REQUIRED" }));
    expect(result.reviewIssues).not.toContainEqual(expect.objectContaining({ code: "PENDING_ONLY_SCHEDULE" }));
  });

  it("requires current principal for pending rows when historical rows are unavailable", () => {
    const result = completeness({ ...BANK_EXTERNAL_AI_ALFIN_FIXTURE, schedule: BANK_EXTERNAL_AI_ALFIN_FIXTURE.schedule.slice(5) }, {
      onboardingMode: "EXISTING_DEBT",
      installmentsPaidBeforeTracking: 5,
      creditorName: "Entidad fixture",
      currencyCode: "PEN",
    });
    expect(result.requiredIssues).toContainEqual(expect.objectContaining({ code: "CURRENT_PRINCIPAL_REQUIRED" }));
    expect(result.requiredIssues).toContainEqual(expect.objectContaining({ code: "SCHEDULE_PARTIAL" }));
  });

  it("keeps an unreadable cell null and reports the exact row/cell as required", () => {
    const result = completeness({
      ...BANK_EXTERNAL_AI_ALFIN_FIXTURE,
      schedule: BANK_EXTERNAL_AI_ALFIN_FIXTURE.schedule.map((row, index) => index === 6 ? { ...row, principal: null } : row),
    });
    expect(result.requiredIssues).toContainEqual(expect.objectContaining({ code: "SCHEDULE_CELL_MISSING", field: "schedule[7].principal" }));
    expect(extraction({ ...BANK_EXTERNAL_AI_ALFIN_FIXTURE, schedule: BANK_EXTERNAL_AI_ALFIN_FIXTURE.schedule.map((row, index) => index === 6 ? { ...row, principal: null } : row) }).schedule[6]?.principal).toBeNull();
  });

  it("does not silently accept duplicate rows or invalid sequence/date order", () => {
    const duplicated = [...BANK_EXTERNAL_AI_ALFIN_FIXTURE.schedule, { ...BANK_EXTERNAL_AI_ALFIN_FIXTURE.schedule[7]! }];
    const result = completeness({ ...BANK_EXTERNAL_AI_ALFIN_FIXTURE, schedule: duplicated });
    expect(result.requiredIssues).toContainEqual(expect.objectContaining({ code: "DUPLICATE_SCHEDULE_ROW" }));

    const invalid = completeness({ ...BANK_EXTERNAL_AI_ALFIN_FIXTURE, schedule: BANK_EXTERNAL_AI_ALFIN_FIXTURE.schedule.map((row, index) => index === 1 ? { ...row, contractualInstallmentNumber: 4, dueDate: "2026-05-01" } : row) });
    expect(invalid.requiredIssues).toContainEqual(expect.objectContaining({ code: "SCHEDULE_INVALID_SEQUENCE" }));
    expect(invalid.requiredIssues).toContainEqual(expect.objectContaining({ code: "SCHEDULE_INVALID_DATES" }));
  });

  it("surfaces conflicts and mathematical inconsistency as review issues", () => {
    const result = completeness({
      ...BANK_EXTERNAL_AI_ALFIN_FIXTURE,
      fieldConflicts: [{ field: "teaPercent", values: [68.4, 68.04] }],
      schedule: BANK_EXTERNAL_AI_ALFIN_FIXTURE.schedule.map((row) => ({ ...row, insurance: 154.79 })),
    });
    expect(result.reviewIssues).toContainEqual(expect.objectContaining({ code: "CONFLICTING_TEA" }));
    expect(result.reviewIssues).toContainEqual(expect.objectContaining({ code: "RECONCILIATION_INCONSISTENT" }));
    expect(result.status).toBe("needs_review");
  });
});
