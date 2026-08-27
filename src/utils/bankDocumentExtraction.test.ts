import { describe, expect, it } from "vitest";
import { mergeBankDocumentExtractions, normalizeBankDocumentExtraction, reviewFieldStatus } from "./bankDocumentExtraction.js";
import { reconcileBankContractSchedule } from "./bankContractReconciliation.js";

const base = {
  documents: [{ index: 0, fileName: "contrato.pdf", mediaType: "pdf" }],
  lenderName: "Banco de prueba",
  currencyCode: "PEN",
  contractDate: "2026-05-09",
  firstDueDate: "2026-06-10",
  financedAmount: 4100,
  totalInterest: 2003.41,
  totalInsurance: 154.79,
  termInstallments: 18,
  reportedBalance: { amount: 5770.09, inferredKind: "schedule_financial_balance", confidence: 0.98 },
  schedule: [{ contractualInstallmentNumber: 1, dueDate: "2026-06-10", principal: 140.58, interest: 194.41, insurance: 14.35, fees: 0, total: 347.67, reportedBalance: 3961.09 }],
};

describe("bank document extraction V5", () => {
  it("allow-lists contract fields and discards PII/raw OCR fields", () => {
    const result = normalizeBankDocumentExtraction({ ...base, dni: "12345678", rawOcr: "secret text" });
    expect(result.valid).toBe(true);
    expect(result.value).not.toHaveProperty("dni");
    expect(result.value).not.toHaveProperty("rawOcr");
    expect(result.value.reportedBalance.inferredKind).toBe("schedule_financial_balance");
    expect(reviewFieldStatus(result.value, "teaPercent")).toBe("not_found");
    expect(reviewFieldStatus(result.value, "schedule")).toBe("confirmed");
  });

  it("flags conflicting scalar values instead of picking a confident hallucination", () => {
    const left = normalizeBankDocumentExtraction({ ...base, teaPercent: 68.4 }).value;
    const right = normalizeBankDocumentExtraction({ ...base, documents: [{ index: 1, fileName: "anexo.png", mediaType: "png" }], teaPercent: 72.1 }).value;
    const merged = mergeBankDocumentExtractions([left, right]);
    expect(merged.teaPercent).toBeNull();
    expect(merged.fieldConflicts).toContainEqual({ field: "teaPercent", values: [68.4, 72.1] });
    expect(reviewFieldStatus(merged, "teaPercent")).toBe("review");
  });

  it("does not accept a hallucinated insurance total as reconciled math", () => {
    const result = normalizeBankDocumentExtraction({
      ...base,
      totalInsurance: 999.99,
      schedule: [{ ...base.schedule[0], insurance: 14.35 }],
    }).value;
    const reconciliation = reconcileBankContractSchedule(result.schedule, {
      reportedTotalInsurance: result.totalInsurance,
      reportedTotalContractAmount: result.schedule[0].total,
    });
    expect(reconciliation.status).toBe("inconsistent");
    expect(reconciliation.differences.insurance).toBe(-985.64);
  });

  it("preserves unknown monetary fields as null and flags same-length schedule conflicts", () => {
    const left = normalizeBankDocumentExtraction({ ...base, schedule: [{ ...base.schedule[0], principal: null }] }).value;
    const right = normalizeBankDocumentExtraction({ ...base, documents: [{ index: 1, fileName: "anexo.pdf", mediaType: "pdf" }], schedule: [{ ...base.schedule[0], total: 348.67 }] }).value;
    expect(left.schedule[0].principal).toBeNull();
    const merged = mergeBankDocumentExtractions([left, right]);
    expect(merged.fieldConflicts).toContainEqual({ field: "schedule[0].total", values: [347.67, 348.67] });
    expect(reviewFieldStatus(merged, "schedule")).toBe("review");
  });

  it("keeps evidence bounded and explicit without raw OCR", () => {
    const result = normalizeBankDocumentExtraction({
      ...base,
      evidence: [{ sourceDocumentIndex: 0, pageNumber: 2, columnOrHeader: "Capital", shortEvidenceLabel: "Fila 1" }],
      rawOcr: "DNI 12345678",
    });
    expect(result.value.evidence).toEqual([{ sourceDocumentIndex: 0, pageNumber: 2, columnOrHeader: "Capital", shortEvidenceLabel: "Fila 1" }]);
    expect(result.value).not.toHaveProperty("rawOcr");
  });
});
