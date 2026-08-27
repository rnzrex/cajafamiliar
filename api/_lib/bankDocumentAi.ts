import type { BankDocumentExtraction } from "../../src/utils/bankDocumentExtraction.js";
import { workbookToBoundedText } from "../../src/utils/debtScheduleFileParser.js";
import {
  readBankDocumentCostConfig,
  type BankDocumentCostConfig,
  type BankDocumentTokenUsage,
} from "./bankDocumentCost.js";

export type BankDocumentMediaType =
  | "application/pdf"
  | "application/vnd.ms-excel"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  | "text/csv"
  | "text/tab-separated-values"
  | "text/plain"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export interface BankDocumentAIInputDocument {
  /** Always a neutral alias at the provider boundary, never the client filename. */
  fileName: string;
  mediaType: BankDocumentMediaType;
  bytes: Uint8Array;
}

export interface BankDocumentAIRequest {
  documents: BankDocumentAIInputDocument[];
  repairContext?: {
    previousExtraction: unknown;
    reconciliationErrors: string[];
  };
  expectedScheduleInstallments?: number | null;
  /** Filled by the cost preflight and consumed verbatim by generateContent. */
  outputTokenAllowance?: number;
}

export interface BankDocumentAIResponse {
  extraction: unknown;
  usage: BankDocumentTokenUsage;
}

export interface BankDocumentAIProvider {
  readonly provider: string;
  readonly model: string;
  countTokens(request: BankDocumentAIRequest): Promise<Pick<BankDocumentTokenUsage, "inputTokens">>;
  analyze(request: BankDocumentAIRequest): Promise<BankDocumentAIResponse>;
}

export const BANK_DOCUMENT_EXTRACTION_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    documents: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          index: { type: "INTEGER" },
          fileName: { type: "STRING" },
          mediaType: { type: "STRING" },
        },
      },
    },
    lenderName: { type: "STRING", nullable: true },
    currencyCode: { type: "STRING", nullable: true },
    contractDate: { type: "STRING", nullable: true },
    firstDueDate: { type: "STRING", nullable: true },
    contractNumber: { type: "STRING", nullable: true },
    financedAmount: { type: "NUMBER", nullable: true },
    originalPrincipal: { type: "NUMBER", nullable: true },
    totalContractAmount: { type: "NUMBER", nullable: true },
    totalInterest: { type: "NUMBER", nullable: true },
    totalInsurance: { type: "NUMBER", nullable: true },
    totalFees: { type: "NUMBER", nullable: true },
    teaPercent: { type: "NUMBER", nullable: true },
    tceaPercent: { type: "NUMBER", nullable: true },
    termInstallments: { type: "INTEGER", nullable: true },
    ordinaryDueDay: { type: "INTEGER", nullable: true },
    regularInstallmentAmount: { type: "NUMBER", nullable: true },
    finalInstallmentAmount: { type: "NUMBER", nullable: true },
    dayCountBasis: { type: "STRING", nullable: true },
    dueDateAdjustmentRule: { type: "STRING", nullable: true },
    installmentTotalMode: { type: "STRING", nullable: true },
    reportedBalance: {
      type: "OBJECT",
      nullable: true,
      properties: {
        amount: { type: "NUMBER", nullable: true },
        label: { type: "STRING", nullable: true },
        inferredKind: { type: "STRING", nullable: true },
        confidence: { type: "NUMBER", nullable: true },
      },
    },
    insuranceTerms: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          insuranceType: { type: "STRING" },
          pricingMode: { type: "STRING" },
          ratePercent: { type: "NUMBER", nullable: true },
          fixedAmount: { type: "NUMBER", nullable: true },
          totalAmount: { type: "NUMBER", nullable: true },
          evidence: { type: "ARRAY" },
        },
      },
    },
    schedule: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          contractualInstallmentNumber: { type: "INTEGER" },
          dueDate: { type: "STRING" },
          principal: { type: "NUMBER", nullable: true },
          interest: { type: "NUMBER", nullable: true },
          insurance: { type: "NUMBER", nullable: true },
          fees: { type: "NUMBER", nullable: true },
          total: { type: "NUMBER", nullable: true },
          reportedBalance: { type: "NUMBER", nullable: true },
          evidence: { type: "ARRAY" },
        },
      },
    },
    extractionWarnings: { type: "ARRAY", items: { type: "STRING" } },
    fieldEvidence: { type: "OBJECT" },
    evidence: { type: "ARRAY" },
    confidenceByField: { type: "OBJECT" },
    fieldConflicts: { type: "ARRAY" },
  },
};

const EXTENSION_BY_MEDIA_TYPE: Record<BankDocumentMediaType, string> = {
  "application/pdf": "pdf",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "text/tab-separated-values": "tsv",
  "text/plain": "txt",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function providerAlias(document: BankDocumentAIInputDocument, index: number): string {
  return `document-${index + 1}.${EXTENSION_BY_MEDIA_TYPE[document.mediaType]}`;
}

function promptFor(request: BankDocumentAIRequest): string {
  const repair = request.repairContext
    ? `\nRepara únicamente con este JSON previo y estos errores matemáticos: ${JSON.stringify(request.repairContext)}`
    : "";
  return [
    "Extrae únicamente datos necesarios para reconstruir un contrato de préstamo bancario.",
    "Devuelve JSON compacto conforme al schema. Usa aliases document-1, document-2, etc.; nunca repitas nombres de archivos originales.",
    "No incluyas DNI, cuentas, nombres personales, números de seguro ni texto OCR.",
    "No inventes valores: usa null y agrega una advertencia breve si falta información.",
    "Conserva las filas oficiales del cronograma si existen. TCEA no es una tasa de interés.",
    "Para evidencia usa sólo sourceDocumentIndex, pageNumber, columnOrHeader y shortEvidenceLabel corto; nunca chain-of-thought.",
    "Si encuentras dos valores distintos para el mismo campo o una fila distinta entre cronogramas, devuelve fieldConflicts y no elijas silenciosamente.",
    repair,
  ].join("\n");
}

function parseModelJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim().replace(/^\`\`\`(?:json)?/i, "").replace(/\`\`\`$/i, "").trim();
  return JSON.parse(trimmed);
}

function isWorkbook(document: BankDocumentAIInputDocument): boolean {
  return document.mediaType === "application/vnd.ms-excel"
    || document.mediaType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

/**
 * XLS/XLSX is parsed deterministically first. If it cannot become a
 * contractual schedule, the bounded workbook representation is sent as text,
 * never as raw binary inlineData.
 */
export function prepareBankDocumentProviderDocuments(documents: BankDocumentAIInputDocument[]): BankDocumentAIInputDocument[] {
  return documents.map((document, index) => {
    const alias = providerAlias(document, index);
    if (!isWorkbook(document)) return { ...document, fileName: alias };
    const bounded = workbookToBoundedText(document.bytes);
    if (bounded == null) throw new Error("DOCUMENT_WORKBOOK_TEXT_FALLBACK_FAILED");
    return {
      fileName: alias.replace(/\.(?:xls|xlsx)$/i, ".txt"),
      mediaType: "text/plain",
      bytes: new TextEncoder().encode(`[sourceDocumentIndex=${index}]\n${bounded}`),
    };
  });
}

function totalBytes(documents: BankDocumentAIInputDocument[]): number {
  return documents.reduce((sum, document) => sum + document.bytes.byteLength, 0);
}

function inlineParts(request: BankDocumentAIRequest, documents: BankDocumentAIInputDocument[]): Array<Record<string, unknown>> {
  return [
    { text: promptFor(request) },
    ...documents.map((document) => ({
      inlineData: {
        mimeType: document.mediaType,
        data: Buffer.from(document.bytes).toString("base64"),
      },
    })),
  ];
}

interface GeminiFileReference {
  name: string;
  uri: string;
  mimeType: string;
}

export class GeminiBankDocumentProvider implements BankDocumentAIProvider {
  readonly provider = "gemini";
  readonly model: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly config: BankDocumentCostConfig;

  constructor(options: {
    apiKey: string;
    config?: BankDocumentCostConfig;
    model?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.apiKey = options.apiKey;
    this.config = options.config ?? readBankDocumentCostConfig({
      BANK_DOCUMENT_AI_MODEL: options.model ?? "gemini-3.5-flash-lite",
    });
    this.model = this.config.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private endpoint(action: "countTokens" | "generateContent"): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:${action}`;
  }

  private async uploadFile(document: BankDocumentAIInputDocument): Promise<GeminiFileReference> {
    const startResponse = await this.fetchImpl("https://generativelanguage.googleapis.com/upload/v1beta/files", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey,
        "x-goog-upload-protocol": "resumable",
        "x-goog-upload-command": "start",
        "x-goog-upload-header-content-length": String(document.bytes.byteLength),
        "x-goog-upload-header-content-type": document.mediaType,
      },
      body: JSON.stringify({ file: { display_name: document.fileName } }),
    });
    if (!startResponse.ok) throw new Error("PROVIDER_FILE_UPLOAD_FAILED");
    const uploadUrl = startResponse.headers.get("x-goog-upload-url");
    if (!uploadUrl) throw new Error("PROVIDER_FILE_UPLOAD_URL_MISSING");
    const uploadResponse = await this.fetchImpl(uploadUrl, {
      method: "POST",
      headers: {
        "content-length": String(document.bytes.byteLength),
        "x-goog-api-key": this.apiKey,
        "x-goog-upload-offset": "0",
        "x-goog-upload-command": "upload, finalize",
      },
      body: Buffer.from(document.bytes),
    });
    if (!uploadResponse.ok) throw new Error("PROVIDER_FILE_UPLOAD_FAILED");
    const body = await uploadResponse.json() as { file?: { name?: unknown; uri?: unknown; mimeType?: unknown; mime_type?: unknown } };
    const file = body.file;
    if (typeof file?.name !== "string" || typeof file.uri !== "string") throw new Error("PROVIDER_FILE_UPLOAD_INVALID");
    return {
      name: file.name,
      uri: file.uri,
      mimeType: typeof file.mimeType === "string" ? file.mimeType : typeof file.mime_type === "string" ? file.mime_type : document.mediaType,
    };
  }

  private async deleteFile(name: string): Promise<void> {
    await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/${name}`, {
      method: "DELETE",
      headers: { "x-goog-api-key": this.apiKey },
    });
  }

  private async withParts<T>(
    request: BankDocumentAIRequest,
    callback: (parts: Array<Record<string, unknown>>) => Promise<T>,
  ): Promise<T> {
    const documents = prepareBankDocumentProviderDocuments(request.documents);
    if (totalBytes(documents) <= this.config.inlineMaxBytes) {
      return callback(inlineParts(request, documents));
    }

    const uploaded: GeminiFileReference[] = [];
    try {
      for (const document of documents) uploaded.push(await this.uploadFile(document));
      const parts: Array<Record<string, unknown>> = [
        { text: promptFor(request) },
        ...uploaded.map((file) => ({
          fileData: { mimeType: file.mimeType, fileUri: file.uri },
        })),
      ];
      return await callback(parts);
    } finally {
      await Promise.all(uploaded.map((file) => this.deleteFile(file.name).catch(() => undefined)));
    }
  }

  async countTokens(request: BankDocumentAIRequest): Promise<Pick<BankDocumentTokenUsage, "inputTokens">> {
    return this.withParts(request, async (parts) => {
      const response = await this.fetchImpl(this.endpoint("countTokens"), {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({ contents: [{ role: "user", parts }] }),
      });
      if (!response.ok) throw new Error("PROVIDER_COUNT_TOKENS_FAILED");
      const body = await response.json() as Record<string, unknown>;
      const inputTokens = Number(body.totalTokens ?? body.total_token_count);
      if (!Number.isFinite(inputTokens) || inputTokens < 0) throw new Error("PROVIDER_COUNT_TOKENS_INVALID");
      return { inputTokens };
    });
  }

  async analyze(request: BankDocumentAIRequest): Promise<BankDocumentAIResponse> {
    return this.withParts(request, async (parts) => {
      const response = await this.fetchImpl(this.endpoint("generateContent"), {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: BANK_DOCUMENT_EXTRACTION_RESPONSE_SCHEMA,
            maxOutputTokens: request.outputTokenAllowance ?? this.config.maxOutputTokens,
            thinkingConfig: { thinkingLevel: this.config.thinkingLevel },
          },
        }),
      });
      if (!response.ok) throw new Error("PROVIDER_GENERATE_FAILED");
      const body = await response.json() as Record<string, any>;
      const candidate = body.candidates?.[0];
      const finishReason = candidate?.finishReason ?? candidate?.finish_reason;
      if (finishReason === "MAX_TOKENS") throw new Error("DOCUMENT_AI_OUTPUT_TRUNCATED");
      const text = candidate?.content?.parts?.map((part: any) => part.text).filter(Boolean).join("");
      if (!text) throw new Error("DOCUMENT_EXTRACTION_INVALID");
      let extraction: unknown;
      try {
        extraction = parseModelJson(text);
      } catch {
        throw new Error("DOCUMENT_AI_OUTPUT_TRUNCATED");
      }
      if (request.expectedScheduleInstallments != null && request.expectedScheduleInstallments > 0) {
        const schedule = extraction && typeof extraction === "object" && Array.isArray((extraction as any).schedule)
          ? (extraction as any).schedule
          : [];
        if (schedule.length < request.expectedScheduleInstallments) throw new Error("DOCUMENT_AI_OUTPUT_TRUNCATED");
      }
      const usage = body.usageMetadata ?? {};
      const outputTokens = Number(usage.candidatesTokenCount ?? usage.candidates_token_count ?? 0);
      const thinkingTokens = Number(usage.thoughtsTokenCount ?? usage.thinkingTokenCount ?? usage.thoughts_token_count ?? 0);
      return {
        extraction,
        usage: {
          inputTokens: Number(usage.promptTokenCount ?? usage.prompt_token_count ?? 0),
          outputTokens,
          // Gemini exposes candidates and thoughts separately. Charge their
          // sum once at the output rate; never add a second thinking charge.
          billableOutputTokens: outputTokens + thinkingTokens,
          thinkingTokens,
        },
      };
    });
  }
}

export class FakeBankDocumentProvider implements BankDocumentAIProvider {
  readonly provider = "fake";
  readonly model = "fake-bank-document-v5";
  countTokensCalls = 0;
  analyzeCalls = 0;
  lastCountTokensRequest: BankDocumentAIRequest | null = null;
  lastAnalyzeRequest: BankDocumentAIRequest | null = null;

  constructor(private readonly response: BankDocumentExtraction, private readonly tokenCount = 1200) {}

  async countTokens(request: BankDocumentAIRequest): Promise<Pick<BankDocumentTokenUsage, "inputTokens">> {
    this.countTokensCalls += 1;
    this.lastCountTokensRequest = request;
    return { inputTokens: this.tokenCount };
  }

  async analyze(request: BankDocumentAIRequest): Promise<BankDocumentAIResponse> {
    this.analyzeCalls += 1;
    this.lastAnalyzeRequest = request;
    return {
      extraction: structuredClone(this.response),
      usage: { inputTokens: this.tokenCount, outputTokens: 800, billableOutputTokens: 800, thinkingTokens: 0 },
    };
  }
}
