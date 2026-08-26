import { parseDateStr, parsePeruvianNumeric } from "./debtScheduleParser.js";

export interface BankDocumentDescriptor {
  index: number;
  fileName: string;
  mediaType: "pdf" | "xlsx" | "xls" | "csv" | "tsv" | "txt" | "jpg" | "jpeg" | "png" | "webp";
}

export interface BankExtractionEvidence {
  sourceDocumentIndex: number;
  pageNumber?: number | null;
  columnOrHeader?: string | null;
  shortEvidenceLabel: string;
}

export interface BankDocumentScheduleExtractionRow {
  contractualInstallmentNumber: number;
  dueDate: string;
  principal: number | null;
  interest: number | null;
  insurance: number | null;
  fees: number | null;
  total: number | null;
  reportedBalance: number | null;
}

export interface BankReportedBalanceExtraction {
  amount: number | null;
  label: string | null;
  inferredKind: "principal_balance" | "schedule_financial_balance" | "total_remaining_payments" | "unknown" | null;
  confidence: number | null;
}

export interface BankInsuranceExtraction {
  label: string;
  insuranceType: "credit_life" | "vehicle" | "property" | "other";
  pricingMode: "fixed_amount" | "percent_outstanding_balance" | "percent_original_principal" | "contract_schedule" | "unknown";
  ratePercent: number | null;
  fixedAmount: number | null;
  totalAmount: number | null;
  evidence?: BankExtractionEvidence[];
}

export interface BankDocumentExtraction {
  documents: BankDocumentDescriptor[];
  lenderName: string | null;
  currencyCode: "PEN" | "USD" | null;
  contractDate: string | null;
  firstDueDate: string | null;
  contractNumber: string | null;
  financedAmount: number | null;
  originalPrincipal: number | null;
  totalContractAmount: number | null;
  totalInterest: number | null;
  totalInsurance: number | null;
  totalFees: number | null;
  teaPercent: number | null;
  tceaPercent: number | null;
  termInstallments: number | null;
  ordinaryDueDay: number | null;
  regularInstallmentAmount: number | null;
  finalInstallmentAmount: number | null;
  reportedBalance: BankReportedBalanceExtraction;
  insuranceTerms: BankInsuranceExtraction[];
  schedule: BankDocumentScheduleExtractionRow[];
  extractionWarnings: string[];
  fieldEvidence: Record<string, BankExtractionEvidence[]>;
  confidenceByField: Record<string, number>;
  fieldConflicts: Array<{ field: string; values: Array<string | number> }>;
}

export interface ExtractionNormalizationResult {
  valid: boolean;
  value: BankDocumentExtraction;
  errors: string[];
}

const MEDIA_TYPES = new Set<BankDocumentDescriptor["mediaType"]>(["pdf", "xlsx", "xls", "csv", "tsv", "txt", "jpg", "jpeg", "png", "webp"]);
const SAFE_WARNINGS_LIMIT = 12;

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const valueTrimmed = value.trim();
  return valueTrimmed ? valueTrimmed.slice(0, 180) : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = parsePeruvianNumeric(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function integerOrNull(value: unknown): number | null {
  const parsed = numberOrNull(value);
  return parsed != null && Number.isInteger(parsed) ? parsed : null;
}

function safeEvidence(value: unknown): BankExtractionEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const sourceDocumentIndex = integerOrNull((entry as Record<string, unknown>).sourceDocumentIndex);
    const shortEvidenceLabel = textOrNull((entry as Record<string, unknown>).shortEvidenceLabel);
    if (sourceDocumentIndex == null || sourceDocumentIndex < 0 || !shortEvidenceLabel) return [];
    return [{
      sourceDocumentIndex,
      pageNumber: integerOrNull((entry as Record<string, unknown>).pageNumber),
      columnOrHeader: textOrNull((entry as Record<string, unknown>).columnOrHeader),
      shortEvidenceLabel,
    }];
  });
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return parseDateStr(value);
}

function normalizeMediaType(value: unknown, fileName: string): BankDocumentDescriptor["mediaType"] | null {
  const explicit = textOrNull(value)?.toLowerCase() ?? "";
  if (MEDIA_TYPES.has(explicit as BankDocumentDescriptor["mediaType"])) return explicit as BankDocumentDescriptor["mediaType"];
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  return MEDIA_TYPES.has(extension as BankDocumentDescriptor["mediaType"]) ? extension as BankDocumentDescriptor["mediaType"] : null;
}

function emptyExtraction(): BankDocumentExtraction {
  return {
    documents: [],
    lenderName: null,
    currencyCode: null,
    contractDate: null,
    firstDueDate: null,
    contractNumber: null,
    financedAmount: null,
    originalPrincipal: null,
    totalContractAmount: null,
    totalInterest: null,
    totalInsurance: null,
    totalFees: null,
    teaPercent: null,
    tceaPercent: null,
    termInstallments: null,
    ordinaryDueDay: null,
    regularInstallmentAmount: null,
    finalInstallmentAmount: null,
    reportedBalance: { amount: null, label: null, inferredKind: null, confidence: null },
    insuranceTerms: [],
    schedule: [],
    extractionWarnings: [],
    fieldEvidence: {},
    confidenceByField: {},
    fieldConflicts: [],
  };
}

export function normalizeBankDocumentExtraction(raw: unknown): ExtractionNormalizationResult {
  const output = emptyExtraction();
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") return { valid: false, value: output, errors: ["La extracción no tiene un formato válido."] };
  const source = raw as Record<string, unknown>;
  const rawDocuments = Array.isArray(source.documents) ? source.documents : [];
  output.documents = rawDocuments.slice(0, 12).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const fileName = textOrNull(item.fileName) ?? `documento-${index + 1}`;
    const mediaType = normalizeMediaType(item.mediaType, fileName);
    if (!mediaType) return [];
    return [{ index: integerOrNull(item.index) ?? index, fileName, mediaType }];
  });

  output.lenderName = textOrNull(source.lenderName);
  output.currencyCode = source.currencyCode === "PEN" || source.currencyCode === "USD" ? source.currencyCode : null;
  output.contractDate = normalizeDate(source.contractDate);
  output.firstDueDate = normalizeDate(source.firstDueDate);
  output.contractNumber = textOrNull(source.contractNumber);
  output.financedAmount = numberOrNull(source.financedAmount);
  output.originalPrincipal = numberOrNull(source.originalPrincipal);
  output.totalContractAmount = numberOrNull(source.totalContractAmount);
  output.totalInterest = numberOrNull(source.totalInterest);
  output.totalInsurance = numberOrNull(source.totalInsurance);
  output.totalFees = numberOrNull(source.totalFees);
  output.teaPercent = numberOrNull(source.teaPercent);
  output.tceaPercent = numberOrNull(source.tceaPercent);
  output.termInstallments = integerOrNull(source.termInstallments);
  output.ordinaryDueDay = integerOrNull(source.ordinaryDueDay);
  output.regularInstallmentAmount = numberOrNull(source.regularInstallmentAmount);
  output.finalInstallmentAmount = numberOrNull(source.finalInstallmentAmount);

  if (source.reportedBalance && typeof source.reportedBalance === "object") {
    const reported = source.reportedBalance as Record<string, unknown>;
    const inferredKind = reported.inferredKind;
    output.reportedBalance = {
      amount: numberOrNull(reported.amount),
      label: textOrNull(reported.label),
      inferredKind: inferredKind === "principal_balance" || inferredKind === "schedule_financial_balance" || inferredKind === "total_remaining_payments" || inferredKind === "unknown" ? inferredKind : null,
      confidence: numberOrNull(reported.confidence),
    };
  }

  output.insuranceTerms = Array.isArray(source.insuranceTerms) ? source.insuranceTerms.slice(0, 8).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const pricingMode = item.pricingMode;
    const insuranceType = item.insuranceType;
    return [{
      label: textOrNull(item.label) ?? "Seguro",
      insuranceType: insuranceType === "credit_life" || insuranceType === "vehicle" || insuranceType === "property" || insuranceType === "other" ? insuranceType : "other",
      pricingMode: pricingMode === "fixed_amount" || pricingMode === "percent_outstanding_balance" || pricingMode === "percent_original_principal" || pricingMode === "contract_schedule" || pricingMode === "unknown" ? pricingMode : "unknown",
      ratePercent: numberOrNull(item.ratePercent),
      fixedAmount: numberOrNull(item.fixedAmount),
      totalAmount: numberOrNull(item.totalAmount),
      evidence: safeEvidence(item.evidence),
    }];
  }) : [];

  output.schedule = Array.isArray(source.schedule) ? source.schedule.slice(0, 600).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const contractualInstallmentNumber = integerOrNull(item.contractualInstallmentNumber) ?? index + 1;
    const dueDate = normalizeDate(item.dueDate);
    if (contractualInstallmentNumber <= 0 || !dueDate) return [];
    return [{
      contractualInstallmentNumber,
      dueDate,
      principal: numberOrNull(item.principal),
      interest: numberOrNull(item.interest),
      insurance: numberOrNull(item.insurance),
      fees: numberOrNull(item.fees),
      total: numberOrNull(item.total),
      reportedBalance: numberOrNull(item.reportedBalance),
    }];
  }) : [];

  output.extractionWarnings = Array.isArray(source.extractionWarnings)
    ? source.extractionWarnings.flatMap((warning) => textOrNull(warning) ? [textOrNull(warning)!] : []).slice(0, SAFE_WARNINGS_LIMIT)
    : [];
  if (source.fieldEvidence && typeof source.fieldEvidence === "object") {
    for (const [field, value] of Object.entries(source.fieldEvidence as Record<string, unknown>).slice(0, 80)) {
      const evidence = safeEvidence(value);
      if (evidence.length > 0) output.fieldEvidence[field] = evidence;
    }
  }
  if (source.confidenceByField && typeof source.confidenceByField === "object") {
    for (const [field, value] of Object.entries(source.confidenceByField as Record<string, unknown>).slice(0, 80)) {
      const confidence = numberOrNull(value);
      if (confidence != null) output.confidenceByField[field] = Math.min(1, Math.max(0, confidence > 1 ? confidence / 100 : confidence));
    }
  }
  if (Array.isArray(source.fieldConflicts)) {
    output.fieldConflicts = source.fieldConflicts.slice(0, 30).flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const field = textOrNull(item.field);
      const values = Array.isArray(item.values) ? item.values.flatMap((value) => typeof value === "number" || typeof value === "string" ? [value] : []) : [];
      return field && values.length > 1 ? [{ field, values: values.slice(0, 6) }] : [];
    });
  }
  if (output.schedule.length === 0 && output.termInstallments == null && output.financedAmount == null && output.totalContractAmount == null) {
    errors.push("El documento no contiene suficientes datos contractuales reconocibles.");
  }
  return { valid: errors.length === 0, value: output, errors };
}

function sameScalar(left: unknown, right: unknown): boolean {
  if (left == null || right == null) return false;
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) <= 0.01;
  return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
}

export function mergeBankDocumentExtractions(extractions: BankDocumentExtraction[]): BankDocumentExtraction {
  const normalized = extractions.length > 0 ? extractions : [emptyExtraction()];
  const merged = emptyExtraction();
  merged.documents = normalized.flatMap((item) => item.documents).filter((item, index, all) => all.findIndex((candidate) => candidate.index === item.index && candidate.fileName === item.fileName) === index);
  const scalarFields: Array<keyof Pick<BankDocumentExtraction, "lenderName" | "currencyCode" | "contractDate" | "firstDueDate" | "contractNumber" | "financedAmount" | "originalPrincipal" | "totalContractAmount" | "totalInterest" | "totalInsurance" | "totalFees" | "teaPercent" | "tceaPercent" | "termInstallments" | "ordinaryDueDay" | "regularInstallmentAmount" | "finalInstallmentAmount">> = [
    "lenderName", "currencyCode", "contractDate", "firstDueDate", "contractNumber", "financedAmount", "originalPrincipal", "totalContractAmount", "totalInterest", "totalInsurance", "totalFees", "teaPercent", "tceaPercent", "termInstallments", "ordinaryDueDay", "regularInstallmentAmount", "finalInstallmentAmount",
  ];
  for (const field of scalarFields) {
    const values = normalized.map((item) => item[field]).filter((value) => value != null);
    const unique: Array<string | number> = [];
    for (const value of values) {
      if (!unique.some((candidate) => sameScalar(candidate, value))) unique.push(value as string | number);
    }
    if (unique.length === 1) merged[field] = unique[0] as never;
    if (unique.length > 1) {
      merged.fieldConflicts.push({ field, values: unique });
      merged.extractionWarnings.push(`Encontramos valores diferentes para ${field}. Revisa cuál corresponde al contrato.`);
    }
    const evidence = normalized.flatMap((item) => item.fieldEvidence[field] ?? []);
    if (evidence.length > 0) merged.fieldEvidence[field] = evidence.slice(0, 6);
    const confidences = normalized.map((item) => item.confidenceByField[field]).filter((value): value is number => value != null);
    if (confidences.length > 0) merged.confidenceByField[field] = Math.max(...confidences);
  }
  const reportedBalances = normalized.map((item) => item.reportedBalance).filter((item) => item.amount != null);
  if (reportedBalances.length > 0) {
    const first = reportedBalances[0];
    merged.reportedBalance = first;
    if (reportedBalances.some((item) => !sameScalar(item.amount, first.amount))) {
      merged.fieldConflicts.push({ field: "reportedBalance.amount", values: reportedBalances.flatMap((item) => item.amount == null ? [] : [item.amount]) });
    }
  }
  merged.insuranceTerms = normalized.flatMap((item) => item.insuranceTerms).slice(0, 12);
  const schedules = normalized.map((item) => item.schedule).filter((rows) => rows.length > 0).sort((left, right) => right.length - left.length);
  merged.schedule = schedules[0] ?? [];
  if (schedules.length > 1 && schedules.some((rows) => rows.length !== merged.schedule.length)) merged.extractionWarnings.push("Los documentos contienen cronogramas de distinto tamaño; se requiere revisión.");
  merged.extractionWarnings = [...new Set(normalized.flatMap((item) => item.extractionWarnings).concat(merged.extractionWarnings))].slice(0, SAFE_WARNINGS_LIMIT);
  return merged;
}

export type BankReviewFieldStatus = "confirmed" | "review" | "not_found";

export function reviewFieldStatus(extraction: BankDocumentExtraction, field: string): BankReviewFieldStatus {
  if (extraction.fieldConflicts.some((conflict) => conflict.field === field || conflict.field.startsWith(`${field}.`))) return "review";
  const value = field.split(".").reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : null, extraction);
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return "not_found";
  return "confirmed";
}
