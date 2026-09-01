import { deriveOpeningPrincipalFromOfficialSchedule } from "./bankContractReconciliation.js";
import type { BankDocumentExtraction, BankDocumentScheduleExtractionRow } from "./bankDocumentExtraction.js";
import type { BankFinancialValidationResult } from "./bankDocumentFinancialValidation.js";
import { compactBankDocumentWarnings } from "./bankDocumentContinuation.js";
import { evaluateBankDocumentContinuation } from "./bankDocumentContinuation.js";

export type BankDocumentCompletenessStatus = "complete" | "needs_review" | "missing_required_data";
export type BankScheduleCoverageStatus = "full" | "partial" | "not_found" | "unknown";

export interface BankDocumentCompletenessIssue {
  code: string;
  field: string;
  severity: "required" | "review" | "optional";
  title: string;
  message: string;
  action: string;
}

export interface BankScheduleCoverage {
  status: BankScheduleCoverageStatus;
  expectedInstallments: number | null;
  foundInstallments: number;
  firstContractualInstallment: number | null;
  lastContractualInstallment: number | null;
  pendingOnly: boolean;
}

export interface BankDocumentCompletenessContext {
  onboardingMode?: "EXISTING_DEBT" | "NEW_DEBT";
  installmentsPaidBeforeTracking?: number | null;
  currentPrincipal?: number | null;
  creditorName?: string | null;
  currencyCode?: string | null;
}

export interface BankDocumentCompletenessResult {
  status: BankDocumentCompletenessStatus;
  requiredIssues: BankDocumentCompletenessIssue[];
  reviewIssues: BankDocumentCompletenessIssue[];
  optionalMissing: BankDocumentCompletenessIssue[];
  scheduleCoverage: BankScheduleCoverage;
}

const REQUIRED_ROW_FIELDS: Array<keyof Pick<BankDocumentScheduleExtractionRow, "principal" | "interest" | "insurance" | "fees" | "total">> = [
  "principal", "interest", "insurance", "fees", "total",
];

function issue(
  code: string,
  field: string,
  severity: BankDocumentCompletenessIssue["severity"],
  title: string,
  message: string,
  action: string,
): BankDocumentCompletenessIssue {
  return { code, field, severity, title, message, action };
}

function finiteNonNegative(value: number | null | undefined): boolean {
  return value != null && Number.isFinite(value) && value >= 0;
}

function uniqueIssues(issues: BankDocumentCompletenessIssue[]): BankDocumentCompletenessIssue[] {
  return issues.filter((item, index, all) => all.findIndex((candidate) => candidate.code === item.code && candidate.field === item.field && candidate.message === item.message) === index);
}

function scheduleNumbersAreContinuous(rows: BankDocumentScheduleExtractionRow[]): boolean {
  return rows.every((row, index) => index === 0 || row.contractualInstallmentNumber === rows[index - 1]!.contractualInstallmentNumber + 1);
}

function scheduleDatesAreIncreasing(rows: BankDocumentScheduleExtractionRow[]): boolean {
  return rows.every((row, index) => index === 0 || row.dueDate > rows[index - 1]!.dueDate);
}

function sameMoney(left: number | null, right: number | null): boolean {
  return left != null && right != null && Math.abs(left - right) <= 0.01;
}

function hasExplicitScheduleReference(extraction: BankDocumentExtraction): boolean {
  const warningText = extraction.extractionWarnings.join(" ").toLowerCase();
  const evidenceText = Object.entries(extraction.fieldEvidence)
    .flatMap(([field, evidence]) => [field, ...evidence.map((item) => item.shortEvidenceLabel)])
    .join(" ")
    .toLowerCase();
  return /(cronograma|plan de pagos|calendario de cuotas|tabla de amortizaci[oó]n|schedule)/i.test(`${warningText} ${evidenceText}`);
}

function currentPrincipalIsKnown(extraction: BankDocumentExtraction, context: BankDocumentCompletenessContext): boolean {
  if (finiteNonNegative(context.currentPrincipal)) return true;
  if (extraction.reportedBalance.inferredKind === "principal_balance" && finiteNonNegative(extraction.reportedBalance.amount)) return true;
  return deriveOpeningPrincipalFromOfficialSchedule({
    originalPrincipal: extraction.originalPrincipal ?? extraction.financedAmount,
    rows: extraction.schedule,
    lastPaidContractualInstallment: context.onboardingMode === "EXISTING_DEBT" ? context.installmentsPaidBeforeTracking : 0,
  }).amount != null;
}

function deriveHistoricalPrincipalIfPossible(extraction: BankDocumentExtraction, context: BankDocumentCompletenessContext): number | null {
  const originalPrincipal = extraction.originalPrincipal ?? extraction.financedAmount;
  const isExisting = context.onboardingMode === "EXISTING_DEBT";
  const paidBefore = isExisting ? context.installmentsPaidBeforeTracking : 0;
  if (isExisting && (paidBefore == null || !Number.isInteger(paidBefore) || paidBefore < 1)) return null;
  const normalizedPaidBefore = paidBefore ?? 0;
  if (originalPrincipal == null || !finiteNonNegative(originalPrincipal) || !Number.isInteger(normalizedPaidBefore) || normalizedPaidBefore < 0 || normalizedPaidBefore === 0) return originalPrincipal ?? null;
  return deriveOpeningPrincipalFromOfficialSchedule({
    originalPrincipal,
    rows: extraction.schedule,
    lastPaidContractualInstallment: normalizedPaidBefore,
  }).amount;
}

function scheduleCoverage(extraction: BankDocumentExtraction): BankScheduleCoverage {
  const rows = extraction.schedule;
  const expectedInstallments = Number.isInteger(extraction.termInstallments) && (extraction.termInstallments ?? 0) > 0 ? extraction.termInstallments : null;
  const firstContractualInstallment = rows[0]?.contractualInstallmentNumber ?? null;
  const lastContractualInstallment = rows.at(-1)?.contractualInstallmentNumber ?? null;
  if (rows.length === 0) {
    return { status: "not_found", expectedInstallments, foundInstallments: 0, firstContractualInstallment, lastContractualInstallment, pendingOnly: false };
  }
  const continuous = scheduleNumbersAreContinuous(rows);
  const full = expectedInstallments != null
    && rows.length === expectedInstallments
    && firstContractualInstallment === 1
    && lastContractualInstallment === expectedInstallments
    && continuous;
  const pendingOnly = expectedInstallments != null
    && firstContractualInstallment != null
    && firstContractualInstallment > 1
    && lastContractualInstallment === expectedInstallments
    && continuous;
  return {
    status: expectedInstallments == null ? "unknown" : full ? "full" : "partial",
    expectedInstallments,
    foundInstallments: rows.length,
    firstContractualInstallment,
    lastContractualInstallment,
    pendingOnly,
  };
}

export function evaluateBankDocumentCompleteness(
  extraction: BankDocumentExtraction,
  validation: BankFinancialValidationResult,
  context: BankDocumentCompletenessContext = {},
): BankDocumentCompletenessResult {
  const requiredIssues: BankDocumentCompletenessIssue[] = [];
  const reviewIssues: BankDocumentCompletenessIssue[] = [];
  const optionalMissing: BankDocumentCompletenessIssue[] = [];
  const coverage = scheduleCoverage(extraction);
  const isExisting = context.onboardingMode === "EXISTING_DEBT";
  const paidBefore = isExisting ? context.installmentsPaidBeforeTracking : 0;
  const originalPrincipal = extraction.originalPrincipal ?? extraction.financedAmount;

  if (!extraction.lenderName && !context.creditorName?.trim()) {
    requiredIssues.push(issue("LENDER_REQUIRED", "lenderName", "required", "Falta el banco o acreedor", "No encontramos el nombre de la entidad financiera.", "Confirma el banco en tu contrato o escríbelo manualmente antes de guardar."));
  }
  if (!extraction.currencyCode && !context.currencyCode?.trim()) {
    requiredIssues.push(issue("CURRENCY_REQUIRED", "currencyCode", "required", "Falta la moneda", "No pudimos identificar si el crédito está expresado en PEN o USD.", "Busca la moneda en la carátula o el cronograma y confírmala en el formulario."));
  }
  if (!finiteNonNegative(originalPrincipal)) {
    requiredIssues.push(issue("ORIGINAL_PRINCIPAL_REQUIRED", "originalPrincipal", "required", "Falta el principal original", "No encontramos el monto financiado o principal original del crédito.", "Busca el monto financiado en la hoja resumen, contrato o constancia emitida por el banco."));
  }

  if (coverage.status === "not_found") {
    const explicitReference = hasExplicitScheduleReference(extraction);
    const missingScheduleIssue = issue(
      "SCHEDULE_EXPECTED_BUT_MISSING",
      "schedule",
      explicitReference && validation.reconstruction == null ? "required" : "review",
      "No encontramos el cronograma de pagos",
      extraction.termInstallments != null
        ? `El contrato indica ${extraction.termInstallments} cuotas, pero no recibimos filas del cronograma.`
        : "No encontramos filas contractuales del cronograma en los documentos proporcionados.",
      "Vuelve a ejecutar el prompt incluyendo todas las páginas del cronograma. Si no lo tienes, solicita el plan de pagos al banco.",
    );
    (missingScheduleIssue.severity === "required" ? requiredIssues : reviewIssues).push(missingScheduleIssue);
  } else {
    if (!scheduleNumbersAreContinuous(extraction.schedule)) {
      requiredIssues.push(issue("SCHEDULE_INVALID_SEQUENCE", "schedule", "required", "El orden de cuotas necesita revisión", "Las cuotas no forman una secuencia contractual continua.", "Revisa el número de cuota y vuelve a importar el expediente completo sin filas duplicadas u omitidas."));
    }
    if (!scheduleDatesAreIncreasing(extraction.schedule)) {
      requiredIssues.push(issue("SCHEDULE_INVALID_DATES", "schedule", "required", "Las fechas del cronograma necesitan revisión", "Las fechas de vencimiento no están en orden creciente.", "Confirma las fechas en el documento bancario y vuelve a importar las páginas correctas."));
    }

    const duplicateRows = new Map<string, BankDocumentScheduleExtractionRow>();
    for (const row of extraction.schedule) {
      const key = `${row.contractualInstallmentNumber}|${row.dueDate}|${row.total == null ? "null" : row.total.toFixed(2)}`;
      const previous = duplicateRows.get(key);
      if (!previous) {
        duplicateRows.set(key, row);
        continue;
      }
      const exactDuplicate = REQUIRED_ROW_FIELDS.every((field) => sameMoney(previous[field], row[field]));
      requiredIssues.push(issue(
        exactDuplicate ? "DUPLICATE_SCHEDULE_ROW" : "DUPLICATE_SCHEDULE_CONFLICT",
        `schedule[${row.contractualInstallmentNumber}]`,
        "required",
        exactDuplicate ? "Encontramos una cuota duplicada" : "Encontramos una cuota duplicada con valores diferentes",
        exactDuplicate
          ? `La cuota ${row.contractualInstallmentNumber} aparece más de una vez en el expediente.`
          : `La cuota ${row.contractualInstallmentNumber} aparece repetida con importes diferentes; no podemos elegir una silenciosamente.`,
        "Revisa las fotografías o páginas repetidas y conserva una sola fila inequívoca del cronograma.",
      ));
    }

    for (const row of extraction.schedule) {
      for (const field of REQUIRED_ROW_FIELDS) {
        if (row[field] == null) {
          requiredIssues.push(issue(
            "SCHEDULE_CELL_MISSING",
            `schedule[${row.contractualInstallmentNumber}].${field}`,
            "required",
            `Falta un dato en la cuota ${row.contractualInstallmentNumber}`,
            `La cuota ${row.contractualInstallmentNumber} no tiene ${field} identificado con seguridad; la fila se conserva sin inventar el valor.`,
            "Busca esa celda en otra página o solicita el dato exacto al banco.",
          ));
        }
      }
    }

    if (coverage.expectedInstallments != null && coverage.status === "partial") {
      const pendingWithCurrentPrincipal = coverage.pendingOnly
        && isExisting
        && Number.isInteger(paidBefore)
        && (paidBefore ?? 0) >= 1
        && coverage.firstContractualInstallment === (paidBefore ?? 0) + 1
        && currentPrincipalIsKnown(extraction, context);
      if (!pendingWithCurrentPrincipal) {
        requiredIssues.push(issue(
          "SCHEDULE_PARTIAL",
          "schedule",
          "required",
          "El cronograma está incompleto",
          coverage.pendingOnly
            ? `Encontramos las cuotas ${coverage.firstContractualInstallment} a ${coverage.lastContractualInstallment} de ${coverage.expectedInstallments}, pero falta confirmar el capital pendiente actual.`
            : `Encontramos ${coverage.foundInstallments} de ${coverage.expectedInstallments} cuotas del crédito.`,
          coverage.pendingOnly
            ? "Busca el saldo de capital vigente o completa las cuotas históricas para calcularlo."
            : "Incluye las páginas faltantes del cronograma o solicita el plan completo al banco.",
        ));
      } else {
        reviewIssues.push(issue("PENDING_ONLY_SCHEDULE", "schedule", "review", "Encontramos todas las cuotas pendientes", `El cronograma pendiente va de la cuota ${coverage.firstContractualInstallment} a la ${coverage.lastContractualInstallment}.`, "Confirma que la última cuota pagada y el capital actual sean correctos."));
      }
    }
  }

  if (isExisting) {
    if (paidBefore == null || !Number.isInteger(paidBefore) || paidBefore < 1) {
      requiredIssues.push(issue(
        "LAST_PAID_INSTALLMENT_REQUIRED",
        "installmentsPaidBeforeTracking",
        "required",
        "Falta la última cuota pagada",
        "Indicaste que ya vienes pagando este crédito, pero no sabemos cuál fue la última cuota contractual pagada.",
        "Busca en tu banca, comprobante o cronograma el número de la última cuota pagada. Si todavía no pagaste ninguna, selecciona «Es nuevo / todavía no he pagado cuotas».",
      ));
    }
    const derivedPrincipal = deriveHistoricalPrincipalIfPossible(extraction, context);
    // A deterministic derivation is only a suggestion until the user confirms
    // it in the form, so `currentPrincipal` remains the completeness source of
    // truth for the required issue.
    const currentPrincipalKnown = currentPrincipalIsKnown(extraction, context);
    if (!currentPrincipalKnown) {
      const hasDerivedSuggestion = finiteNonNegative(derivedPrincipal);
      requiredIssues.push(issue(
        "CURRENT_PRINCIPAL_REQUIRED",
        "openingPrincipalBalance",
        "required",
        "Falta el capital pendiente actual",
        hasDerivedSuggestion
          ? "El banco no indicó claramente el capital pendiente actual, pero Caja Familiar puede calcularlo usando el cronograma y la última cuota pagada."
          : coverage.pendingOnly
            ? `El cronograma comienza en la cuota ${coverage.firstContractualInstallment} y no tenemos las cuotas históricas para calcular el capital actual.`
            : "No pudimos determinar cuánto capital queda pendiente hoy.",
        hasDerivedSuggestion
          ? `Pulsa «Calcular» en Situación actual para usar ${derivedPrincipal!.toFixed(2)}.`
          : "Busca Saldo Capital / Capital Pendiente en tu banca, estado de cuenta o constancia de deuda; si no aparece, consulta al banco.",
      ));
    }
    if (paidBefore != null && Number.isInteger(paidBefore) && extraction.termInstallments != null && paidBefore >= extraction.termInstallments) {
      requiredIssues.push(issue("LAST_PAID_INSTALLMENT_INVALID", "installmentsPaidBeforeTracking", "required", "La última cuota pagada no es válida", "La última cuota pagada debe ser menor al total de cuotas del crédito.", "Confirma el número de la última cuota pagada y compáralo con el plazo contractual."));
    }
  }

  if (extraction.termInstallments == null && validation.reconstruction == null && extraction.schedule.length === 0) {
    requiredIssues.push(issue("TERM_REQUIRED", "termInstallments", "required", "Falta el plazo total", "No encontramos el número total de cuotas del crédito.", "Busca el plazo en el contrato o consulta al banco."));
  }
  const continuation = evaluateBankDocumentContinuation({
    extraction,
    validation,
    onboardingMode: context.onboardingMode ?? "NEW_DEBT",
    lastPaidContractualInstallment: context.installmentsPaidBeforeTracking,
  });
  if (validation.reconstruction == null && validation.reconciliation?.status === "inconsistent") {
    if (continuation.historicalAnomaly) {
      reviewIssues.push(issue("HISTORICAL_SCHEDULE_ANOMALY", "schedule", "review", "Diferencia aritmética histórica", "El documento bancario contiene una diferencia aritmética en una cuota histórica. Conservamos el cronograma original y usaremos el saldo contractual posterior a tu última cuota pagada.", "Confirma la última cuota pagada y el saldo de corte mostrado en el formulario."));
    } else {
      reviewIssues.push(issue("RECONCILIATION_INCONSISTENT", "schedule", "review", "Los importes necesitan revisión", "Los importes del cronograma no coinciden con los totales o controles del contrato.", "Revisa las filas, totales, seguros y gastos antes de guardar."));
    }
    if (continuation.futureIssues.length > 0) {
      requiredIssues.push(issue("FUTURE_SCHEDULE_ANOMALY", "schedule", "required", "La diferencia afecta cuotas pendientes", "Encontramos una diferencia de continuidad en una cuota que todavía falta pagar.", "Confirma la fila futura y corrige o vuelve a importar el cronograma antes de guardar."));
    }
  }
  for (const conflict of extraction.fieldConflicts) {
    const fieldLabel = conflict.field.toLowerCase().includes("tea") ? "TEA" : conflict.field;
    reviewIssues.push(issue(conflict.field.toLowerCase().includes("tea") ? "CONFLICTING_TEA" : "DOCUMENT_CONFLICT", conflict.field, "review", `Hay valores distintos para ${fieldLabel}`, `Los documentos muestran más de un valor para ${fieldLabel}; no elegimos uno silenciosamente.`, "Compara las páginas y confirma el valor correcto o consulta al banco."));
  }
  if (extraction.reportedBalance.amount != null && (!extraction.reportedBalance.inferredKind || extraction.reportedBalance.inferredKind === "unknown")) {
    reviewIssues.push(issue("BALANCE_KIND_UNKNOWN", "reportedBalance", "review", "El saldo necesita clasificación", "Encontramos un valor llamado saldo, pero no podemos asegurar si corresponde al capital pendiente.", "Busca una etiqueta como Saldo Capital / Capital Pendiente o consulta al banco."));
  }
  if (extraction.tceaPercent == null) {
    optionalMissing.push(issue("TCEA_OPTIONAL", "tceaPercent", "optional", "TCEA no identificada", "La TCEA no es necesaria para guardar un cronograma oficial completo.", "Puedes consultarla en la hoja resumen si quieres conservarla."));
  }
  const actionableWarnings = compactBankDocumentWarnings(extraction.extractionWarnings, {
    suppressHistoricalArithmetic: continuation.historicalAnomaly && continuation.futureIssues.length === 0,
  });
  if (actionableWarnings.length > 0) {
    reviewIssues.push(...actionableWarnings.map((warning) => issue("EXTRACTION_WARNING", "extractionWarnings", "review", "Revisión documental", warning, "Revisa la página o dato señalado antes de confirmar.")));
  }

  const uniqueRequired = uniqueIssues(requiredIssues);
  const uniqueReview = uniqueIssues(reviewIssues);
  const uniqueOptional = uniqueIssues(optionalMissing);
  return {
    status: uniqueRequired.length > 0 ? "missing_required_data" : uniqueReview.length > 0 ? "needs_review" : "complete",
    requiredIssues: uniqueRequired,
    reviewIssues: uniqueReview,
    optionalMissing: uniqueOptional,
    scheduleCoverage: coverage,
  };
}
