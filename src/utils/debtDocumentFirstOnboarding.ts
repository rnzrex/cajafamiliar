import type {
  AmortizationMethod,
  DebtContractAuthority,
  DebtDayCountBasis,
  DebtFeeRuleType,
  DebtInstallmentAmountMode,
  DebtInterestRateType,
  DebtKind,
  DebtPaymentFrequency,
  DebtPrincipalBasis,
  DebtScheduleInstallmentInput,
  PeriodicRateBasis,
  ScheduleSource,
} from "../types";
import {
  UNIVERSAL_EXTERNAL_AI_PROMPT,
  mapUniversalDocumentRowsToSchedule,
  type UniversalDebtDocumentImportReview,
} from "./universalDebtDocumentImport";
import { reconcileUniversalDebtDocument, type UniversalDebtDocumentRow } from "./universalDebtDocument";

const DOCUMENT_FIRST_NUMBERING_PROMPT = `

REGLAS CRÍTICAS PARA UNA PROFORMA CON CRONOGRAMA:
- contractualInstallmentNumber debe salir ÚNICAMENTE de la columna numérica claramente identificada como Cuota, N° cuota, Nro. cuota, Installment o Installment number.
- Nunca derives contractualInstallmentNumber de códigos CI001, LS001, CASH, códigos de fila, conceptos, operaciones o referencias internas.
- Si la tabla numera las cuotas 1..N, conserva exactamente esa numeración y sourceRowNumber en el orden de la tabla.
- Si rowRole es CASH y el documento lo presenta como pago inicial, usa rowRole=down_payment.
- Para financiamiento directo con precio del bien: cuando esté explícito, assetPrice - downPaymentAmount = financedPrincipalAmount.
- No sumes cuotas introductorias de capital a downPaymentAmount: son conceptos distintos.
- Si el cronograma incluye la fila down_payment, scheduledPrincipalAmount puede ser el precio total del bien aunque financedPrincipalAmount sea menor.
- termInstallments es el plazo de cuotas posteriores cuando el documento así lo indique; no lo confundas con el total de filas extraídas.
- Antes de devolver JSON verifica números contractuales únicos, suma del capital, relación precio/cuota inicial/principal financiado, filas totales y ausencia de duplicados.`;

export const DOCUMENT_FIRST_EXTERNAL_AI_PROMPT = `${UNIVERSAL_EXTERNAL_AI_PROMPT}

REGLAS ADICIONALES PARA CREAR LA DEUDA DESDE EL DOCUMENTO:
Dentro de contract incluye también, solo cuando el documento lo permita sin inventar: debtKind (bank_loan, family_loan, installment_purchase, mortgage, pledge u other), debtName (nombre corto descriptivo de la obligación, sin PII), creditorName (nombre comercial del acreedor, sin datos personales), currencyCode (PEN o USD), contractDate, currentPrincipalAmount (solo si el documento declara explícitamente un saldo de capital vigente; no lo deduzcas de pagos que no aparecen), openingPrincipalAmount con la misma semántica, termInstallments y tceaPercent. Para financiamiento directo de un vendedor/inmobiliaria con precio del bien, cuota inicial y cronograma, usa installment_purchase salvo que el documento demuestre otra categoría. No uses credit_card para cronogramas fijos.

No decidas qué cuotas ya pagó realmente la persona salvo que el expediente lo demuestre de forma explícita. Caja Familiar preguntará esa historia real antes de guardar. La cuota inicial/down payment debe conservar rowRole=down_payment y no debe restarse por segunda vez del financedPrincipalAmount. No confundas "todavía no he pagado nada de este cronograma" con "la cuota inicial no existe": el usuario puede haber pagado solo la cuota inicial. Para la historia consecutiva, marca únicamente cuotas contractuales completamente pagadas y consecutivas desde la número 1; pagos parciales o no consecutivos requieren un saldo de capital vigente informado por el acreedor y revisión manual.
${DOCUMENT_FIRST_NUMBERING_PROMPT}`;

export type DocumentFirstSupportedDebtKind = Exclude<DebtKind, "credit_card">;
export type DocumentFirstOnboardingMode = "NEW_DEBT" | "EXISTING_DEBT";
export type DocumentFirstHistoryMode = "NO_ROWS_PAID" | "DOWN_PAYMENT_ONLY" | "CONSECUTIVE_FULLY_PAID";

export interface DocumentFirstSemanticReview extends UniversalDebtDocumentImportReview {
  canonicalContract: Record<string, unknown>;
  blockingIssues: string[];
  normalizationWarnings: string[];
}

export interface DocumentFirstDefaults {
  debtKind: DocumentFirstSupportedDebtKind;
  requiresSpecializedFlow: boolean;
  specializedReason: string | null;
  debtName: string;
  creditorName: string;
  currencyCode: "PEN" | "USD";
  contractDate: string | null;
  assetPrice: number | null;
  downPaymentAmount: number | null;
  financedPrincipalAmount: number | null;
  scheduledPrincipalAmount: number | null;
  principalBasis: DebtPrincipalBasis;
  repaymentStructure: "fixed_schedule" | "open_ended" | "unknown";
  amortizationMethod: AmortizationMethod;
  installmentAmountMode: DebtInstallmentAmountMode;
  paymentFrequency: DebtPaymentFrequency | null;
  customFrequencyDays: number | null;
  firstDueDate: string | null;
  termInstallments: number | null;
  interestRateType: DebtInterestRateType;
  interestRatePercent: number | null;
  interestRateBasis: string | null;
  dayCountBasis: DebtDayCountBasis;
  feeRuleType: DebtFeeRuleType;
  feeRule: Record<string, unknown>;
  prepaymentTerms: Record<string, unknown>;
  tceaPercent: number | null;
  explicitCurrentPrincipal: number | null;
  scheduleSource: ScheduleSource;
  authority: DebtContractAuthority;
  schedule: DebtScheduleInstallmentInput[];
  totalScheduleRows: number;
  postInitialObligationRows: number;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pick(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = raw[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function debtKind(value: unknown, raw: Record<string, unknown>): DocumentFirstSupportedDebtKind {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "bank_loan" || normalized === "family_loan" || normalized === "installment_purchase" || normalized === "mortgage" || normalized === "pledge" || normalized === "other") {
    return normalized;
  }
  const hasAssetStructure = finiteNumber(pick(raw, "assetPrice", "asset_price")) != null
    && finiteNumber(pick(raw, "financedPrincipalAmount", "financed_principal_amount", "financedAmount", "financed_amount")) != null;
  return hasAssetStructure ? "installment_purchase" : "other";
}

function currency(value: unknown): "PEN" | "USD" {
  const normalized = text(value).toUpperCase();
  return normalized === "USD" || normalized.includes("DOLAR") || normalized.includes("DÓLAR") ? "USD" : "PEN";
}

function principalBasis(value: unknown): DebtPrincipalBasis {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "asset_price_including_down_payment" || normalized === "financed_principal_only" || normalized === "reported_balance"
    ? normalized
    : "unknown";
}

function amortization(value: unknown): AmortizationMethod {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "fixed_installment" || normalized === "constant_principal" || normalized === "increasing_installment" || normalized === "decreasing_installment" || normalized === "irregular_contract" || normalized === "custom"
    ? normalized
    : "unknown";
}

function amountMode(value: unknown, schedule: DebtScheduleInstallmentInput[]): DebtInstallmentAmountMode {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "fixed" || normalized === "variable" || normalized === "unknown") return normalized;
  const amounts = schedule.map((row) => row.expectedAmount).filter((value): value is number => value != null);
  return amounts.length > 1 && amounts.every((value) => Math.abs(value - amounts[0]) <= 0.01) ? "fixed" : "variable";
}

function paymentFrequency(value: unknown): DebtPaymentFrequency | null {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "monthly" || normalized === "mensual") return "monthly";
  if (normalized === "biweekly" || normalized === "quincenal") return "biweekly";
  if (normalized === "weekly" || normalized === "semanal") return "weekly";
  if (normalized === "custom" || normalized === "personalizada") return "custom";
  return null;
}

function interestRateType(value: unknown): DebtInterestRateType {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "tna" || normalized === "nominal_annual" || normalized === "nominal_annual_simple") return "nominal_annual_simple";
  if (normalized === "tea" || normalized === "effective_annual") return "effective_annual";
  if (normalized === "periodic" || normalized === "effective_periodic") return "effective_periodic";
  if (normalized === "contract_schedule" || normalized === "contract_schedule_only") return "contract_schedule";
  if (normalized === "manual") return "manual";
  return "unknown";
}

function dayCountBasis(value: unknown): DebtDayCountBasis {
  const normalized = text(value).toLowerCase().replace(/[\s/-]+/g, "_");
  if (normalized.includes("360")) return "actual_days_360";
  if (normalized.includes("365")) return "actual_days_365";
  return "unknown";
}

function feeRuleType(value: unknown): DebtFeeRuleType {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "fixed" || normalized === "percentage" || normalized === "formula_known" || normalized === "contract_schedule_only"
    ? normalized
    : "unknown";
}

function repaymentStructure(value: unknown, schedule: DebtScheduleInstallmentInput[]): "fixed_schedule" | "open_ended" | "unknown" {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "fixed_schedule" || normalized === "open_ended" || normalized === "unknown") return normalized;
  return schedule.length > 0 ? "fixed_schedule" : "unknown";
}

function dateOrNull(value: unknown): string | null {
  const normalized = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function maxContractualInstallment(schedule: DebtScheduleInstallmentInput[]): number | null {
  if (schedule.length === 0) return null;
  return Math.max(...schedule.map((row) => row.contractualInstallmentNumber ?? row.installmentNumber));
}

function contractualInstallmentNumber(row: DebtScheduleInstallmentInput): number {
  return row.contractualInstallmentNumber ?? row.installmentNumber;
}

function nonSummarySchedule(schedule: DebtScheduleInstallmentInput[]): DebtScheduleInstallmentInput[] {
  return schedule.filter((row) => row.rowRole !== "summary");
}

function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sameCents(left: number | null, right: number | null): boolean {
  return left != null && right != null && Math.abs(left - right) <= 0.01;
}

function semanticRows(review: UniversalDebtDocumentImportReview): UniversalDebtDocumentRow[] {
  return review.normalized.rows.filter((row) => row.rowRole !== "summary");
}

function safeSourceOrder(review: UniversalDebtDocumentImportReview, rows: UniversalDebtDocumentRow[]): boolean {
  if (rows.length === 0 || review.normalized.rows.some((row) => row.rowRole === "summary")) return false;
  if (rows.some((row) => row.dueDate == null || Number.isNaN(Date.parse(`${row.dueDate}T00:00:00Z`)))) return false;
  if (rows.some((row) => row.sourceRowNumberValid === false)) return false;
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].sourceRowNumber !== index + 1) return false;
    if (index > 0 && String(rows[index - 1].dueDate) > String(rows[index].dueDate)) return false;
  }
  return true;
}

function hasNumberingProblem(rows: UniversalDebtDocumentRow[]): boolean {
  if (rows.length === 0) return true;
  const numbers = rows.map((row) => row.contractualInstallmentNumber);
  return numbers.some((number) => number == null)
    || new Set(numbers).size !== numbers.length
    || numbers.some((number, index) => number !== index + 1);
}

function schedulePrincipal(rows: UniversalDebtDocumentRow[]): number | null {
  if (rows.length === 0 || rows.some((row) => row.expectedPrincipal == null || !Number.isFinite(row.expectedPrincipal))) return null;
  return roundCents(rows.reduce((sum, row) => sum + (row.expectedPrincipal ?? 0), 0));
}

/**
 * Document-first-only semantic gate. The source contract stays untouched in
 * review.contract; canonicalContract contains only safe, reviewable fixes.
 */
export function normalizeDocumentFirstReview(review: UniversalDebtDocumentImportReview): DocumentFirstSemanticReview {
  const blockingIssues: string[] = [];
  const normalizationWarnings: string[] = [];
  const canonicalContract: Record<string, unknown> = { ...review.contract };
  const rows = semanticRows(review);
  let normalizedRows = [...review.normalized.rows];

  if (hasNumberingProblem(rows)) {
    const safe = safeSourceOrder(review, rows);
    const explicitNumbers = rows.map((row) => row.contractualInstallmentNumber);
    const allExplicitNumbers = explicitNumbers.every((number): number is number => number != null);
    const uniqueExplicitNumbers = new Set(explicitNumbers).size === explicitNumbers.length;
    const hasExplicitOutlier = rows.some((row) => row.contractualInstallmentNumber != null
      && (row.contractualInstallmentNumber < 1 || row.contractualInstallmentNumber > rows.length))
      || (allExplicitNumbers && uniqueExplicitNumbers && explicitNumbers.some((number, index) => number !== index + 1));
    if (safe && !hasExplicitOutlier) {
      normalizedRows = normalizedRows.map((row) => row.rowRole === "summary"
        ? row
        : { ...row, contractualInstallmentNumber: row.sourceRowNumber });
      normalizationWarnings.push("Se normalizó la numeración contractual usando el orden explícito de las filas porque la IA devolvió números duplicados o inválidos.");
    } else {
      blockingIssues.push("La numeración contractual está duplicada o no es válida y no cumple las condiciones seguras para usar el orden de las filas; requiere revisión manual.");
    }
  }

  const canonicalRows = normalizedRows.filter((row) => row.rowRole !== "summary");
  const downPayments = canonicalRows.filter((row) => row.rowRole === "down_payment");
  if (downPayments.length > 1) {
    blockingIssues.push("El documento contiene varias filas de cuota inicial; no se puede determinar cuál es la cuota inicial real.");
  }

  const rawAssetPrice = finiteNumber(pick(review.contract, "assetPrice", "asset_price"));
  const rawFinancedPrincipal = finiteNumber(pick(review.contract, "financedPrincipalAmount", "financed_principal_amount", "financedAmount", "financed_amount"));
  const rawDownPayment = finiteNumber(pick(review.contract, "downPaymentAmount", "down_payment_amount"));
  const rawScheduledPrincipal = finiteNumber(pick(review.contract, "scheduledPrincipalAmount", "scheduled_principal_amount"));
  const basis = principalBasis(pick(review.contract, "principalBasis", "principal_basis"));
  const downPaymentRowPrincipal = downPayments.length === 1 && downPayments[0].expectedPrincipal != null && Number.isFinite(downPayments[0].expectedPrincipal)
    ? roundCents(downPayments[0].expectedPrincipal)
    : null;
  const derivedDownPayment = rawAssetPrice != null && rawFinancedPrincipal != null
    ? roundCents(rawAssetPrice - rawFinancedPrincipal)
    : null;

  if (basis === "asset_price_including_down_payment") {
    if (rawAssetPrice != null && rawFinancedPrincipal != null && derivedDownPayment != null && derivedDownPayment < -0.01) {
      blockingIssues.push("El precio del bien es menor que el principal financiado; no se puede reconciliar la cuota inicial.");
    }
    if (rawAssetPrice != null && rawFinancedPrincipal != null && downPaymentRowPrincipal != null && derivedDownPayment != null && !sameCents(derivedDownPayment, downPaymentRowPrincipal)) {
      blockingIssues.push("La cuota inicial de la fila down_payment no coincide con precio del bien menos principal financiado.");
    } else if (derivedDownPayment != null && downPaymentRowPrincipal != null && sameCents(derivedDownPayment, downPaymentRowPrincipal)) {
      if (rawDownPayment == null || !sameCents(rawDownPayment, derivedDownPayment)) {
        normalizationWarnings.push(`Se corrigió la cuota inicial informada por la IA de ${rawDownPayment ?? "POR CONFIRMAR"} a ${derivedDownPayment.toFixed(2)} con dos evidencias independientes: diferencia del bien/principal financiado y fila down_payment.`);
      }
      canonicalContract.downPaymentAmount = derivedDownPayment;
    } else if (rawDownPayment == null && derivedDownPayment != null) {
      canonicalContract.downPaymentAmount = derivedDownPayment;
      normalizationWarnings.push(`Se calculó la cuota inicial como ${derivedDownPayment.toFixed(2)} usando precio del bien menos principal financiado; la fila down_payment debe permanecer visible para confirmación.`);
    } else if (rawDownPayment == null && downPaymentRowPrincipal != null) {
      canonicalContract.downPaymentAmount = downPaymentRowPrincipal;
      normalizationWarnings.push(`Se tomó la cuota inicial ${downPaymentRowPrincipal.toFixed(2)} de la fila down_payment porque faltaba el valor contractual.`);
    }
    const canonicalDownPayment = finiteNumber(canonicalContract.downPaymentAmount);
    if (rawAssetPrice != null && rawFinancedPrincipal != null && canonicalDownPayment != null && !sameCents(rawAssetPrice, canonicalDownPayment + rawFinancedPrincipal)) {
      blockingIssues.push("Precio del bien, cuota inicial y principal financiado no reconcilian dentro de un centavo.");
    }
    if (downPayments.length === 1 && (canonicalRows.findIndex((row) => row.rowRole === "down_payment") !== 0 || (downPayments[0].contractualInstallmentNumber ?? 0) !== 1)) {
      blockingIssues.push("La fila down_payment debe ser la primera fila contractual número 1.");
    }
  }

  const completeSchedulePrincipal = schedulePrincipal(canonicalRows);
  if (completeSchedulePrincipal != null) {
    const canonicalDownPayment = finiteNumber(canonicalContract.downPaymentAmount);
    const includesDownPayment = downPayments.length === 1;
    if (basis === "asset_price_including_down_payment" && rawAssetPrice != null && includesDownPayment) {
      if (!sameCents(completeSchedulePrincipal, rawAssetPrice)) {
        blockingIssues.push(`La suma del capital del cronograma (${completeSchedulePrincipal.toFixed(2)}) no coincide con el precio del bien (${rawAssetPrice.toFixed(2)}).`);
      } else {
        canonicalContract.scheduledPrincipalAmount = rawAssetPrice;
        if (rawScheduledPrincipal == null || !sameCents(rawScheduledPrincipal, rawAssetPrice)) {
          normalizationWarnings.push(`Se corrigió el principal programado informado por la IA de ${rawScheduledPrincipal ?? "POR CONFIRMAR"} a ${rawAssetPrice.toFixed(2)} con la suma completa del capital del cronograma.`);
        }
      }
    } else if (rawScheduledPrincipal != null && !sameCents(rawScheduledPrincipal, completeSchedulePrincipal)) {
      blockingIssues.push(`El principal programado informado (${rawScheduledPrincipal.toFixed(2)}) contradice la suma completa del cronograma (${completeSchedulePrincipal.toFixed(2)}).`);
    } else if (rawScheduledPrincipal == null) {
      canonicalContract.scheduledPrincipalAmount = completeSchedulePrincipal;
    }
    if (basis === "asset_price_including_down_payment" && rawAssetPrice != null && canonicalDownPayment != null && rawFinancedPrincipal != null && !sameCents(rawAssetPrice, canonicalDownPayment + rawFinancedPrincipal)) {
      blockingIssues.push("La identidad de financiamiento del bien no reconcilia con el cronograma completo.");
    }
  }

  if (canonicalRows.some((row) => row.dueDate == null)) {
    blockingIssues.push("El cronograma contiene filas financieras sin fecha de vencimiento; no se puede crear una cuota incompleta.");
  }

  const finalScheduledPrincipal = finiteNumber(canonicalContract.scheduledPrincipalAmount);
  const reconciliation = reconcileUniversalDebtDocument(
    normalizedRows,
    finalScheduledPrincipal ?? review.reconciliation.expectedPrincipal,
  );
  if (reconciliation.status === "inconsistent") {
    blockingIssues.push("La reconciliación estructural del cronograma sigue siendo inconsistente después de la normalización.");
  }

  return {
    ...review,
    normalized: { ...review.normalized, rows: normalizedRows },
    reconciliation,
    canonicalContract,
    blockingIssues: [...new Set(blockingIssues)],
    normalizationWarnings: [...new Set(normalizationWarnings)],
  };
}

export function findDownPaymentInstallmentNumber(schedule: DebtScheduleInstallmentInput[]): number | null {
  const downPayments = nonSummarySchedule(schedule).filter((row) => row.rowRole === "down_payment");
  if (downPayments.length !== 1) return null;
  const number = contractualInstallmentNumber(downPayments[0]);
  return Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * V1 only persists a deterministic history boundary. It must never turn a
 * partial or non-consecutive payment report into a false "last paid" number.
 */
export function validateDocumentFirstHistorySelection(
  schedule: DebtScheduleInstallmentInput[],
  historyMode: DocumentFirstHistoryMode,
  lastPaidInstallment: number,
): string | null {
  if (!Number.isInteger(lastPaidInstallment) || lastPaidInstallment < 0) {
    return "La historia debe usar un número entero de cuota no negativo.";
  }

  const rows = nonSummarySchedule(schedule);
  const numbers = rows.map(contractualInstallmentNumber);
  if (new Set(numbers).size !== numbers.length) {
    return "El cronograma tiene números contractuales duplicados; requiere revisión manual.";
  }

  if (historyMode === "NO_ROWS_PAID") {
    return lastPaidInstallment === 0 ? null : "La opción sin filas pagadas debe usar límite 0.";
  }

  if (historyMode === "DOWN_PAYMENT_ONLY") {
    const downPaymentNumber = findDownPaymentInstallmentNumber(schedule);
    if (downPaymentNumber == null || downPaymentNumber !== 1) {
      return "Solo se puede marcar la cuota inicial pagada cuando existe una única fila down_payment contractual número 1.";
    }
    if (lastPaidInstallment !== downPaymentNumber) {
      return "La opción cuota inicial pagada debe marcar únicamente la fila down_payment.";
    }
    if (rows.some((row) => contractualInstallmentNumber(row) <= lastPaidInstallment && row.rowRole !== "down_payment")) {
      return "La cuota inicial no puede representar también una cuota contractual ordinaria.";
    }
    return null;
  }

  if (lastPaidInstallment < 1) {
    return "Para registrar cuotas pagadas, indica la última cuota completa y consecutiva desde la número 1.";
  }
  const numberSet = new Set(numbers);
  for (let number = 1; number <= lastPaidInstallment; number += 1) {
    if (!numberSet.has(number)) {
      return "Solo se pueden marcar filas pagadas cuando son completas y consecutivas desde la cuota 1. Los pagos parciales o no consecutivos requieren saldo del acreedor y revisión manual.";
    }
  }
  return null;
}

export function extractDocumentFirstDefaults(review: UniversalDebtDocumentImportReview & Partial<Pick<DocumentFirstSemanticReview, "canonicalContract" | "normalizationWarnings">>): DocumentFirstDefaults {
  const raw = review.canonicalContract ?? review.contract;
  const schedule = mapUniversalDocumentRowsToSchedule(review);
  const detectedKind = debtKind(pick(raw, "debtKind", "debt_kind"), raw);
  const creditorName = text(pick(raw, "creditorName", "creditor_name", "creditorLabel", "creditor_label", "lenderName", "lender_name"));
  const debtName = text(pick(raw, "debtName", "debt_name", "obligationLabel", "obligation_label")) || (creditorName ? `Financiamiento ${creditorName}` : "Financiamiento");
  const financed = finiteNumber(pick(raw, "financedPrincipalAmount", "financed_principal_amount", "financedAmount", "financed_amount"));
  const explicitCurrent = finiteNumber(pick(raw, "currentPrincipalAmount", "current_principal_amount", "openingPrincipalAmount", "opening_principal_amount"));
  const source = review.scheduleSource ?? "manual";
  const structure = repaymentStructure(pick(raw, "repaymentStructure", "repayment_structure"), schedule);
  const unsupported = detectedKind === "bank_loan" || detectedKind === "pledge";
  const hasDownPayment = schedule.some((row) => row.rowRole === "down_payment");
  const postInitialObligationRows = hasDownPayment
    ? schedule.filter((row) => contractualInstallmentNumber(row) > 1).length
    : schedule.length;
  const specializedReason = detectedKind === "bank_loan"
    ? "Los créditos bancarios mantienen su onboarding especializado porque necesitan perfil bancario, seguros y reglas BANK V3."
    : detectedKind === "pledge"
      ? "Los empeños necesitan registrar la garantía física y usan un flujo especializado."
      : null;

  return {
    debtKind: detectedKind,
    requiresSpecializedFlow: unsupported,
    specializedReason,
    debtName,
    creditorName,
    currencyCode: currency(pick(raw, "currencyCode", "currency_code", "currency")),
    contractDate: dateOrNull(pick(raw, "contractDate", "contract_date", "originDate", "origin_date")),
    assetPrice: finiteNumber(pick(raw, "assetPrice", "asset_price")),
    downPaymentAmount: finiteNumber(pick(raw, "downPaymentAmount", "down_payment_amount")),
    financedPrincipalAmount: financed,
    scheduledPrincipalAmount: finiteNumber(pick(raw, "scheduledPrincipalAmount", "scheduled_principal_amount")) ?? review.reconciliation.schedulePrincipal,
    principalBasis: principalBasis(pick(raw, "principalBasis", "principal_basis")),
    repaymentStructure: structure,
    amortizationMethod: amortization(pick(raw, "amortizationMethod", "amortization_method")),
    installmentAmountMode: amountMode(pick(raw, "installmentAmountMode", "installment_amount_mode"), schedule),
    paymentFrequency: paymentFrequency(pick(raw, "paymentFrequency", "payment_frequency")),
    customFrequencyDays: finiteNumber(pick(raw, "customFrequencyDays", "custom_frequency_days")),
    firstDueDate: dateOrNull(pick(raw, "firstDueDate", "first_due_date")) ?? schedule.find((row) => row.rowRole !== "down_payment")?.dueDate ?? schedule[0]?.dueDate ?? null,
    termInstallments: finiteNumber(pick(raw, "termInstallments", "term_installments", "plannedInstallmentCount", "planned_installment_count")) ?? maxContractualInstallment(schedule),
    interestRateType: interestRateType(pick(raw, "interestRateType", "interest_rate_type")),
    interestRatePercent: finiteNumber(pick(raw, "interestRatePercent", "interest_rate_percent")),
    interestRateBasis: text(pick(raw, "interestRateBasis", "interest_rate_basis")) || null,
    dayCountBasis: dayCountBasis(pick(raw, "dayCountBasis", "day_count_basis")),
    feeRuleType: feeRuleType(pick(raw, "feeRuleType", "fee_rule_type")),
    feeRule: isRecord(pick(raw, "feeRule", "fee_rule")) ? pick(raw, "feeRule", "fee_rule") as Record<string, unknown> : {},
    prepaymentTerms: isRecord(pick(raw, "prepaymentTerms", "prepayment_terms")) ? pick(raw, "prepaymentTerms", "prepayment_terms") as Record<string, unknown> : {},
    tceaPercent: finiteNumber(pick(raw, "tceaPercent", "tcea_percent")),
    explicitCurrentPrincipal: explicitCurrent,
    scheduleSource: source,
    authority: review.normalized.authority,
    schedule,
    totalScheduleRows: schedule.length,
    postInitialObligationRows,
    warnings: [...new Set([...review.warnings, ...(review.normalizationWarnings ?? [])])],
  };
}

export function deriveOpeningPrincipalFromDocument(
  defaults: Pick<DocumentFirstDefaults, "financedPrincipalAmount" | "explicitCurrentPrincipal" | "schedule">,
  onboardingMode: DocumentFirstOnboardingMode,
  lastPaidInstallment: number,
): number | null {
  if (defaults.explicitCurrentPrincipal != null && defaults.explicitCurrentPrincipal >= 0) return defaults.explicitCurrentPrincipal;
  const financed = defaults.financedPrincipalAmount;
  if (financed == null || !Number.isFinite(financed) || financed < 0) return null;
  if (onboardingMode === "NEW_DEBT" || lastPaidInstallment <= 0) return financed;

  const paidRows = defaults.schedule.filter((row) => {
    const contractualNumber = row.contractualInstallmentNumber ?? row.installmentNumber;
    return contractualNumber <= lastPaidInstallment && row.rowRole !== "down_payment";
  });
  if (paidRows.some((row) => row.expectedPrincipal == null || !Number.isFinite(row.expectedPrincipal))) return null;
  const paidFinancedPrincipal = paidRows.reduce((sum, row) => sum + (row.expectedPrincipal ?? 0), 0);
  return Math.max(0, Math.round((financed - paidFinancedPrincipal + Number.EPSILON) * 100) / 100);
}

export function scheduleWithPretracking(
  schedule: DebtScheduleInstallmentInput[],
  onboardingMode: DocumentFirstOnboardingMode,
  lastPaidInstallment: number,
  historyMode: DocumentFirstHistoryMode = onboardingMode === "NEW_DEBT" ? "NO_ROWS_PAID" : "CONSECUTIVE_FULLY_PAID",
): DebtScheduleInstallmentInput[] {
  const downPaymentNumber = historyMode === "DOWN_PAYMENT_ONLY" ? findDownPaymentInstallmentNumber(schedule) : null;
  return schedule.map((row) => ({
    ...row,
    isPaidBeforeTracking: onboardingMode === "EXISTING_DEBT"
      && historyMode !== "NO_ROWS_PAID"
      && (historyMode === "DOWN_PAYMENT_ONLY"
        ? downPaymentNumber != null && contractualInstallmentNumber(row) === downPaymentNumber && row.rowRole === "down_payment"
        : contractualInstallmentNumber(row) <= lastPaidInstallment),
  }));
}

export function periodicRateBasis(value: string | null): PeriodicRateBasis | null {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "monthly" || normalized === "biweekly" || normalized === "weekly" || normalized === "daily" ? normalized : null;
}
