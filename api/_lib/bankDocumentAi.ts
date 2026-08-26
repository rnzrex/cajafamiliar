import type { BankDocumentExtraction } from "../../src/utils/bankDocumentExtraction.js";
import type { BankDocumentTokenUsage } from "./bankDocumentCost.js";

export interface BankDocumentAIInputDocument {
  fileName: string;
  mediaType: "application/pdf" | "application/vnd.ms-excel" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "text/csv" | "text/tab-separated-values" | "text/plain" | "image/jpeg" | "image/png" | "image/webp";
  bytes: Uint8Array;
}

export interface BankDocumentAIRequest {
  documents: BankDocumentAIInputDocument[];
  repairContext?: {
    previousExtraction: unknown;
    reconciliationErrors: string[];
  };
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
    documents: { type: "ARRAY", items: { type: "OBJECT", properties: { index: { type: "INTEGER" }, fileName: { type: "STRING" }, mediaType: { type: "STRING" } } } },
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
    reportedBalance: { type: "OBJECT", nullable: true, properties: { amount: { type: "NUMBER", nullable: true }, label: { type: "STRING", nullable: true }, inferredKind: { type: "STRING", nullable: true }, confidence: { type: "NUMBER", nullable: true } } },
    insuranceTerms: { type: "ARRAY", items: { type: "OBJECT", properties: { label: { type: "STRING" }, insuranceType: { type: "STRING" }, pricingMode: { type: "STRING" }, ratePercent: { type: "NUMBER", nullable: true }, fixedAmount: { type: "NUMBER", nullable: true }, totalAmount: { type: "NUMBER", nullable: true } } } },
    schedule: { type: "ARRAY", items: { type: "OBJECT", properties: { contractualInstallmentNumber: { type: "INTEGER" }, dueDate: { type: "STRING" }, principal: { type: "NUMBER", nullable: true }, interest: { type: "NUMBER", nullable: true }, insurance: { type: "NUMBER", nullable: true }, fees: { type: "NUMBER", nullable: true }, total: { type: "NUMBER", nullable: true }, reportedBalance: { type: "NUMBER", nullable: true } } } },
    extractionWarnings: { type: "ARRAY", items: { type: "STRING" } },
    fieldEvidence: { type: "OBJECT" },
    confidenceByField: { type: "OBJECT" },
  },
};

function promptFor(request: BankDocumentAIRequest): string {
  const repair = request.repairContext
    ? `\nRepara únicamente con este JSON previo y estos errores matemáticos: ${JSON.stringify(request.repairContext)}`
    : "";
  return [
    "Extrae únicamente datos necesarios para reconstruir un contrato de préstamo bancario.",
    "Devuelve JSON compacto conforme al schema. No incluyas DNI, cuentas, nombres personales, números de seguro ni texto OCR.",
    "No inventes valores: usa null y agrega una advertencia breve si falta información.",
    "Conserva las filas oficiales del cronograma si existen. TCEA no es una tasa de interés.",
    "Para evidencia usa sólo pageNumber, columnOrHeader y shortEvidenceLabel corto; nunca chain-of-thought.",
    repair,
  ].join("\n");
}

function toParts(request: BankDocumentAIRequest): Array<Record<string, unknown>> {
  return [
    { text: promptFor(request) },
    ...request.documents.map((document) => ({
      inlineData: {
        mimeType: document.mediaType,
        data: Buffer.from(document.bytes).toString("base64"),
      },
    })),
  ];
}

function parseModelJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  return JSON.parse(trimmed);
}

export class GeminiBankDocumentProvider implements BankDocumentAIProvider {
  readonly provider = "gemini";
  readonly model: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { apiKey: string; model?: string; fetchImpl?: typeof fetch }) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "gemini-3.5-flash-lite";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private endpoint(action: "countTokens" | "generateContent") {
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:${action}?key=${encodeURIComponent(this.apiKey)}`;
  }

  async countTokens(request: BankDocumentAIRequest): Promise<Pick<BankDocumentTokenUsage, "inputTokens">> {
    const response = await this.fetchImpl(this.endpoint("countTokens"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: toParts(request) }] }),
    });
    if (!response.ok) throw new Error("PROVIDER_COUNT_TOKENS_FAILED");
    const body = await response.json() as Record<string, unknown>;
    const inputTokens = Number(body.totalTokens ?? body.total_token_count);
    if (!Number.isFinite(inputTokens) || inputTokens < 0) throw new Error("PROVIDER_COUNT_TOKENS_INVALID");
    return { inputTokens };
  }

  async analyze(request: BankDocumentAIRequest): Promise<BankDocumentAIResponse> {
    const response = await this.fetchImpl(this.endpoint("generateContent"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: toParts(request) }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: BANK_DOCUMENT_EXTRACTION_RESPONSE_SCHEMA,
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 512 },
        },
      }),
    });
    if (!response.ok) throw new Error("PROVIDER_GENERATE_FAILED");
    const body = await response.json() as Record<string, any>;
    const text = body.candidates?.[0]?.content?.parts?.map((part: any) => part.text).filter(Boolean).join("");
    const extraction = parseModelJson(text);
    const usage = body.usageMetadata ?? {};
    return {
      extraction,
      usage: {
        inputTokens: Number(usage.promptTokenCount ?? 0),
        outputTokens: Number(usage.candidatesTokenCount ?? 0),
        thinkingTokens: Number(usage.thoughtsTokenCount ?? usage.thinkingTokenCount ?? 0),
      },
    };
  }
}

export class FakeBankDocumentProvider implements BankDocumentAIProvider {
  readonly provider = "fake";
  readonly model = "fake-bank-document-v5";
  countTokensCalls = 0;
  analyzeCalls = 0;

  constructor(private readonly response: BankDocumentExtraction, private readonly tokenCount = 1200) {}

  async countTokens(_request: BankDocumentAIRequest): Promise<Pick<BankDocumentTokenUsage, "inputTokens">> {
    this.countTokensCalls += 1;
    return { inputTokens: this.tokenCount };
  }

  async analyze(_request: BankDocumentAIRequest): Promise<BankDocumentAIResponse> {
    this.analyzeCalls += 1;
    return { extraction: structuredClone(this.response), usage: { inputTokens: this.tokenCount, outputTokens: 800, thinkingTokens: 0 } };
  }
}
