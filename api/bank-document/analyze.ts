import type { SupabaseClient } from "@supabase/supabase-js";
import { fileExtension, isAllowedBankDocument, parseJsonBody } from "../_lib/bankDocumentSecurity.js";
import { assertHouseholdMembership, assertImportPathOwnership, authenticateBankDocumentRequest, BANK_DOCUMENT_BUCKET, cleanupBankDocumentObjects, createBankDocumentAdmin, readBankDocumentServerEnvironment, responseError } from "../_lib/bankDocumentServer.js";
import { decideBankDocumentBudget, estimateBankDocumentCost, readBankDocumentCostConfig, usageMetadata, type BankDocumentTokenUsage } from "../_lib/bankDocumentCost.js";
import { BankDocumentAIProvider, FakeBankDocumentProvider, GeminiBankDocumentProvider, type BankDocumentAIInputDocument, type BankDocumentAIRequest } from "../_lib/bankDocumentAi.js";
import { classifyReportedBalance, reconcileBankContractSchedule } from "../../src/utils/bankContractReconciliation.js";
import { reconstructBankContractSchedule, scheduleSourceForReconstruction } from "../../src/utils/bankContractReconstruction.js";
import { mergeBankDocumentExtractions, normalizeBankDocumentExtraction, type BankDocumentExtraction } from "../../src/utils/bankDocumentExtraction.js";
import { parseDebtScheduleFile } from "../../src/utils/debtScheduleFileParser.js";

interface RequestLike {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}

interface AnalyzeBody {
  importId: string;
  householdId: string;
  storagePaths: string[];
}

export interface BankDocumentAnalyzeResult {
  ok: true;
  importId: string;
  extraction: BankDocumentExtraction;
  reconciliation: ReturnType<typeof reconcileBankContractSchedule> | null;
  reconstruction: ReturnType<typeof reconstructBankContractSchedule> | null;
  reportedBalanceClassification: ReturnType<typeof classifyReportedBalance> | null;
  scheduleSource: "contractual" | "reconstructed" | "estimated";
  usage: { inputTokens: number; outputTokens: number; thinkingTokens: number; estimatedCostUsd: number };
}

function parseBody(body: unknown): AnalyzeBody | null {
  const parsed = parseJsonBody(body);
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as any;
  if (typeof candidate.importId !== "string" || typeof candidate.householdId !== "string" || !Array.isArray(candidate.storagePaths)) return null;
  if (!candidate.storagePaths.every((path: unknown) => typeof path === "string")) return null;
  return { importId: candidate.importId.trim(), householdId: candidate.householdId.trim(), storagePaths: candidate.storagePaths };
}

function mediaTypeForPath(path: string): BankDocumentAIInputDocument["mediaType"] | null {
  const extension = fileExtension(path);
  const mapping: Record<string, BankDocumentAIInputDocument["mediaType"]> = {
    pdf: "application/pdf",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    txt: "text/plain",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  return mapping[extension] ?? null;
}

async function downloadDocuments(admin: SupabaseClient, paths: string[]): Promise<BankDocumentAIInputDocument[]> {
  const documents: BankDocumentAIInputDocument[] = [];
  for (const path of paths) {
    const mediaType = mediaTypeForPath(path);
    if (!mediaType) throw new Error("INVALID_DOCUMENT_INPUT");
    const { data, error } = await admin.storage.from(BANK_DOCUMENT_BUCKET).download(path);
    if (error || !data) throw new Error("DOCUMENT_DOWNLOAD_FAILED");
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (!isAllowedBankDocument(path, mediaType, bytes.byteLength)) throw new Error("INVALID_DOCUMENT_INPUT");
    documents.push({ fileName: path.split("/").at(-1) ?? "documento", mediaType, bytes });
  }
  return documents;
}

export function structuredExtraction(documents: BankDocumentAIInputDocument[]): BankDocumentExtraction | null {
  if (documents.length === 0 || documents.some((document) => !["text/csv", "text/tab-separated-values", "text/plain", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"].includes(document.mediaType))) return null;
  const extractedSchedules = documents.map((document, index) => {
    const result = parseDebtScheduleFile(document.bytes);
    if (!result.valid) return null;
    return {
      document,
      index,
      result,
    };
  });
  if (extractedSchedules.some((item) => item == null)) return null;
  const normalized = extractedSchedules.map((item) => {
    const rows = item!.result.rows.map((row) => ({
      contractualInstallmentNumber: row.contractualInstallmentNumber,
      dueDate: row.dueDate,
      principal: row.expectedPrincipal,
      interest: row.expectedInterest,
      insurance: row.expectedInsurance,
      fees: row.expectedFees,
      total: row.expectedAmount,
      reportedBalance: row.reportedBalance ?? null,
    }));
    return normalizeBankDocumentExtraction({
      documents: [{ index: item!.index, fileName: item!.document.fileName, mediaType: fileExtension(item!.document.fileName) }],
      firstDueDate: rows[0]?.dueDate ?? null,
      termInstallments: rows.at(-1)?.contractualInstallmentNumber ?? rows.length,
      regularInstallmentAmount: rows[0]?.total ?? null,
      totalContractAmount: item!.result.totalContractSum,
      totalInterest: item!.result.totalInterest,
      totalInsurance: item!.result.totalInsurance,
      totalFees: item!.result.totalFees,
      schedule: rows,
    }).value;
  });
  const merged = mergeBankDocumentExtractions(normalized);
  if (documents.length > 1) merged.extractionWarnings.push("Se combinaron documentos estructurados; revisa cualquier conflicto entre cronogramas.");
  return merged;
}

function financialValidation(extraction: BankDocumentExtraction) {
  if (extraction.schedule.length > 0) {
    const reconciliation = reconcileBankContractSchedule(extraction.schedule.map((row) => ({
      contractualInstallmentNumber: row.contractualInstallmentNumber,
      dueDate: row.dueDate,
      principal: row.principal,
      interest: row.interest,
      insurance: row.insurance,
      fees: row.fees,
      total: row.total,
      reportedBalance: row.reportedBalance,
    })), {
      expectedInstallmentCount: extraction.termInstallments,
      reportedTotalPrincipal: extraction.originalPrincipal ?? extraction.financedAmount,
      reportedTotalInterest: extraction.totalInterest,
      reportedTotalInsurance: extraction.totalInsurance,
      reportedTotalFees: extraction.totalFees,
      reportedTotalContractAmount: extraction.totalContractAmount,
      knownRegularPayment: extraction.regularInstallmentAmount,
      knownFinalPayment: extraction.finalInstallmentAmount,
    });
    return { reconciliation, reconstruction: null, reportedBalanceClassification: null, scheduleSource: "contractual" as const };
  }
  if (extraction.contractDate && extraction.financedAmount != null && extraction.teaPercent != null && extraction.termInstallments != null && extraction.regularInstallmentAmount != null) {
    const firstDueDate = extraction.firstDueDate;
    if (firstDueDate) {
      const reconstruction = reconstructBankContractSchedule({
        originDate: extraction.contractDate,
        firstDueDate,
        ordinaryDueDay: extraction.ordinaryDueDay,
        financedAmount: extraction.financedAmount,
        teaPercent: extraction.teaPercent,
        termInstallments: extraction.termInstallments,
        regularInstallmentAmount: extraction.regularInstallmentAmount,
        finalInstallmentAmount: extraction.finalInstallmentAmount,
        totalContractAmount: extraction.totalContractAmount,
        totalInterest: extraction.totalInterest,
        totalInsurance: extraction.totalInsurance,
        installmentTotalMode: "total_installment_including_costs",
      });
      const reconciliation = reconcileBankContractSchedule(reconstruction.rows, {
        originalPrincipal: extraction.financedAmount,
        expectedInstallmentCount: extraction.termInstallments,
        reportedTotalPrincipal: extraction.financedAmount,
        reportedTotalInterest: extraction.totalInterest,
        reportedTotalInsurance: extraction.totalInsurance,
        reportedTotalContractAmount: extraction.totalContractAmount,
        knownRegularPayment: extraction.regularInstallmentAmount,
        knownFinalPayment: extraction.finalInstallmentAmount,
      });
      const reportedBalanceClassification = extraction.reportedBalance.amount == null
        ? null
        : classifyReportedBalance({
            reportedBalance: extraction.reportedBalance.amount,
            principalBalance: reconstruction.rows[0]?.remainingPrincipalBalance ?? 0,
            futureScheduleFinancialBalance: reconstruction.rows.slice(1).reduce((sum, row) => sum + row.principal + row.interest + row.fees, 0),
            futureTotalRemainingPayments: reconstruction.rows.slice(1).reduce((sum, row) => sum + row.total, 0),
          });
      if (reportedBalanceClassification && extraction.reportedBalance.inferredKind == null && reportedBalanceClassification.kind !== "unknown") {
        extraction.reportedBalance.inferredKind = reportedBalanceClassification.kind;
      } else if (reportedBalanceClassification && extraction.reportedBalance.inferredKind && extraction.reportedBalance.inferredKind !== reportedBalanceClassification.kind) {
        extraction.extractionWarnings.push("La etiqueta del saldo reportado no coincide con la clasificación matemática; confirma su significado.");
      }
      return { reconciliation, reconstruction, reportedBalanceClassification, scheduleSource: scheduleSourceForReconstruction(reconciliation.status, false) };
    }
  }
  return { reconciliation: null, reconstruction: null, reportedBalanceClassification: null, scheduleSource: "estimated" as const };
}

function providerForEnvironment(environment: ReturnType<typeof readBankDocumentServerEnvironment>): BankDocumentAIProvider {
  if (environment.providerMode === "fake") {
    return new FakeBankDocumentProvider({
      documents: [], lenderName: null, currencyCode: "PEN", contractDate: null, firstDueDate: null, contractNumber: null,
      financedAmount: null, originalPrincipal: null, totalContractAmount: null, totalInterest: null, totalInsurance: null,
      totalFees: null, teaPercent: null, tceaPercent: null, termInstallments: null, ordinaryDueDay: null,
      regularInstallmentAmount: null, finalInstallmentAmount: null, reportedBalance: { amount: null, label: null, inferredKind: null, confidence: null },
      insuranceTerms: [], schedule: [], extractionWarnings: [], fieldEvidence: {}, confidenceByField: {}, fieldConflicts: [],
    });
  }
  if (!environment.geminiApiKey) throw new Error("AI_NOT_CONFIGURED");
  return new GeminiBankDocumentProvider({ apiKey: environment.geminiApiKey, model: environment.model });
}

export async function analyzeBankDocumentRequest(params: {
  body: AnalyzeBody;
  admin: SupabaseClient;
  userId: string;
  provider?: BankDocumentAIProvider;
  environment?: ReturnType<typeof readBankDocumentServerEnvironment>;
}): Promise<BankDocumentAnalyzeResult> {
  const { body, admin, userId } = params;
  await assertHouseholdMembership(admin, body.householdId, userId);
  assertImportPathOwnership(body.storagePaths, body.householdId, userId, body.importId);
  const { data: job, error: jobError } = await admin.from("bank_document_import_jobs").select("*").eq("id", body.importId).eq("household_id", body.householdId).maybeSingle();
  if (jobError || !job || job.created_by_user_id !== userId) throw new Error("DOCUMENT_PATH_ACCESS_DENIED");
  const jobPaths = Array.isArray(job.storage_paths) ? job.storage_paths : [];
  if (jobPaths.length !== body.storagePaths.length || body.storagePaths.some((path) => !jobPaths.includes(path))) throw new Error("DOCUMENT_PATH_ACCESS_DENIED");
  await admin.from("bank_document_import_jobs").update({ status: "analyzing" }).eq("id", body.importId).eq("household_id", body.householdId);

  let usage: BankDocumentTokenUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
  try {
    const documents = await downloadDocuments(admin, body.storagePaths);
    const localExtraction = structuredExtraction(documents);
    let extraction: BankDocumentExtraction;
    const config = readBankDocumentCostConfig();
    if (localExtraction) {
      extraction = localExtraction;
    } else {
      const provider = params.provider ?? providerForEnvironment(params.environment ?? readBankDocumentServerEnvironment());
      const request: BankDocumentAIRequest = { documents };
      const tokenEstimate = await provider.countTokens(request);
      const budget = decideBankDocumentBudget({ inputTokens: tokenEstimate.inputTokens, outputTokens: config.maxOutputTokens, thinkingTokens: 512 }, config);
      if (!budget.allowed) throw new Error("DOCUMENT_AI_COST_LIMIT");
      const firstPass = await provider.analyze(request);
      usage = firstPass.usage;
      const normalizedFirst = normalizeBankDocumentExtraction(firstPass.extraction);
      if (!normalizedFirst.valid) throw new Error("DOCUMENT_EXTRACTION_INVALID");
      extraction = normalizedFirst.value;
      const validation = financialValidation(extraction);
      if (validation.reconciliation?.status === "inconsistent") {
        const repairRequest: BankDocumentAIRequest = {
          documents: [],
          repairContext: { previousExtraction: extraction, reconciliationErrors: validation.reconciliation.warnings },
        };
        const repairTokenEstimate = await provider.countTokens(repairRequest);
        const repairBudget = decideBankDocumentBudget({ inputTokens: repairTokenEstimate.inputTokens, outputTokens: config.maxOutputTokens, thinkingTokens: 512 }, config, estimateBankDocumentCost(usage, config).totalCostUsd);
        if (repairBudget.allowed) {
          const repaired = await provider.analyze(repairRequest);
          usage = {
            inputTokens: usage.inputTokens + repaired.usage.inputTokens,
            outputTokens: usage.outputTokens + repaired.usage.outputTokens,
            thinkingTokens: (usage.thinkingTokens ?? 0) + (repaired.usage.thinkingTokens ?? 0),
          };
          const normalizedRepair = normalizeBankDocumentExtraction(repaired.extraction);
          if (normalizedRepair.valid) extraction = normalizedRepair.value;
        }
      }
    }
    const validation = financialValidation(extraction);
    const estimate = estimateBankDocumentCost(usage, config);
    await admin.from("bank_document_import_jobs").update({
      status: "review",
      actual_cost_usd: estimate.totalCostUsd,
      estimated_cost_usd: estimate.totalCostUsd,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      thinking_tokens: usage.thinkingTokens ?? 0,
      completed_at: new Date().toISOString(),
    }).eq("id", body.importId).eq("household_id", body.householdId);
    return {
      ok: true,
      importId: body.importId,
      extraction,
      reconciliation: validation.reconciliation,
      reconstruction: validation.reconstruction,
      reportedBalanceClassification: validation.reportedBalanceClassification,
      scheduleSource: validation.scheduleSource,
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, thinkingTokens: usage.thinkingTokens ?? 0, estimatedCostUsd: estimate.totalCostUsd },
    };
  } catch (error) {
    const config = readBankDocumentCostConfig();
    const estimate = estimateBankDocumentCost(usage, config);
    await admin.from("bank_document_import_jobs").update({
      status: error instanceof Error && error.message === "DOCUMENT_AI_COST_LIMIT" ? "failed" : "failed",
      actual_cost_usd: estimate.totalCostUsd,
      estimated_cost_usd: estimate.totalCostUsd,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      thinking_tokens: usage.thinkingTokens ?? 0,
      error_code: error instanceof Error ? error.message : "DOCUMENT_AI_FAILED",
    }).eq("id", body.importId).eq("household_id", body.householdId);
    throw error;
  } finally {
    await cleanupBankDocumentObjects(admin, body.storagePaths).catch(() => undefined);
  }
}

export default async function handler(request: RequestLike, response: ResponseLike) {
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  let environment: ReturnType<typeof readBankDocumentServerEnvironment> | undefined;
  try {
    environment = readBankDocumentServerEnvironment();
    const admin = createBankDocumentAdmin(environment);
    const user = await authenticateBankDocumentRequest(admin, request.headers);
    const body = parseBody(request.body);
    if (!body || !body.importId || !body.householdId || body.storagePaths.length === 0) throw new Error("INVALID_DOCUMENT_INPUT");
    const result = await analyzeBankDocumentRequest({ body, admin, userId: user.id, environment });
    response.status(200).json(result);
  } catch (error) {
    const mapped = responseError(error);
    response.status(mapped.status).json(mapped.body);
  }
}
