import * as XLSX from "xlsx";
import type { DebtPaymentFrequency } from "../types.js";
import {
  detectFrequencyFromDates,
  parseContractualScheduleText,
  parseDateStr,
  parsePeruvianNumeric,
  type ContractualScheduleRowInput,
  type ScheduleParseResult,
} from "./debtScheduleParser.js";

export type DebtScheduleColumn = "installmentNumber" | "dueDate" | "expectedAmount" | "expectedPrincipal" | "expectedInterest" | "expectedInsurance" | "expectedFees" | "reportedBalance";

export const DEBT_SCHEDULE_COLUMN_LABELS: Record<DebtScheduleColumn, string> = {
  installmentNumber: "Cuota",
  dueDate: "Fecha",
  expectedAmount: "Total",
  expectedPrincipal: "Capital",
  expectedInterest: "Interés",
  expectedInsurance: "Seguro",
  expectedFees: "Gastos",
  reportedBalance: "Saldo informado",
};

export interface DebtScheduleFileColumnMapping {
  installmentNumber?: number;
  dueDate?: number;
  expectedAmount?: number;
  expectedPrincipal?: number;
  expectedInterest?: number;
  expectedInsurance?: number;
  expectedFees?: number;
  reportedBalance?: number;
}

export interface DebtScheduleFileParseResult extends ScheduleParseResult {
  headerRowIndex: number | null;
  headers: string[];
  mapping: DebtScheduleFileColumnMapping;
  missingColumns: DebtScheduleColumn[];
  ambiguousColumns: DebtScheduleColumn[];
}

const REQUIRED_COLUMNS: DebtScheduleColumn[] = [
  "installmentNumber",
  "dueDate",
  "expectedAmount",
  "expectedPrincipal",
  "expectedInterest",
  "expectedInsurance",
  "expectedFees",
];

const HEADER_ALIASES: Record<DebtScheduleColumn, string[]> = {
  installmentNumber: ["cuota", "nrocuota", "ncuota", "numerocuota", "nro", "n"],
  dueDate: ["fecha", "vencimiento", "fechavencimiento"],
  expectedAmount: ["cuotatotal", "totalcuota", "importecuota", "total", "pago"],
  expectedPrincipal: ["capital", "amortizacion", "principal"],
  expectedInterest: ["interes"],
  expectedInsurance: ["seguro", "desgravamen", "segurodesgravamen"],
  expectedFees: ["gastos", "comision", "portes", "otros"],
  reportedBalance: ["saldo", "saldopendiente", "saldocapital", "balance", "saldobanco"],
};

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function emptyResult(overrides: Partial<DebtScheduleFileParseResult> = {}): DebtScheduleFileParseResult {
  return {
    valid: false,
    errors: [],
    rows: [],
    detectedCount: 0,
    firstDueDate: null,
    detectedFrequency: "monthly",
    installmentAmountMode: "unknown",
    totalContractSum: 0,
    totalPrincipal: 0,
    totalInterest: 0,
    totalInsurance: 0,
    totalFees: 0,
    headerRowIndex: null,
    headers: [],
    mapping: {},
    missingColumns: [],
    ambiguousColumns: [],
    ...overrides,
  };
}

function findHeaderRow(rows: unknown[][]): { index: number; headers: string[] } | null {
  for (let index = 0; index < Math.min(rows.length, 12); index++) {
    const headers = rows[index].map((cell) => String(cell ?? "").trim());
    const normalized = headers.map(normalizeHeader);
    const matches = REQUIRED_COLUMNS.reduce(
      (count, column) => count + (normalized.some((header) =>
        HEADER_ALIASES[column].some((alias) => header === alias || (alias.length >= 5 && header.includes(alias)))
      ) ? 1 : 0),
      0
    );
    if (matches >= 2) return { index, headers };
  }
  return null;
}

function detectMapping(headers: string[]): { mapping: DebtScheduleFileColumnMapping; missingColumns: DebtScheduleColumn[]; ambiguousColumns: DebtScheduleColumn[] } {
  const normalized = headers.map(normalizeHeader);
  const mapping: DebtScheduleFileColumnMapping = {};
  const missingColumns: DebtScheduleColumn[] = [];
  const ambiguousColumns: DebtScheduleColumn[] = [];

  for (const column of REQUIRED_COLUMNS) {
    const candidates = normalized.flatMap((header, index) =>
      HEADER_ALIASES[column].some((alias) => header === alias || (alias.length >= 5 && header.includes(alias))) ? [index] : []
    );
    if (candidates.length === 0) missingColumns.push(column);
    else {
      mapping[column] = candidates[0];
      if (candidates.length > 1) ambiguousColumns.push(column);
    }
  }
  const reportedBalanceCandidates = normalized.flatMap((header, index) =>
    HEADER_ALIASES.reportedBalance.some((alias) => header === alias || (alias.length >= 5 && header.includes(alias))) ? [index] : []
  );
  if (reportedBalanceCandidates.length > 0) {
    mapping.reportedBalance = reportedBalanceCandidates[0];
    if (reportedBalanceCandidates.length > 1) ambiguousColumns.push("reportedBalance");
  }
  return { mapping, missingColumns, ambiguousColumns };
}

function excelDateToIso(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  return parseDateStr(String(value ?? ""));
}

function cellText(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "").trim();
}

function resultFromText(text: string, metadata: Pick<DebtScheduleFileParseResult, "headerRowIndex" | "headers" | "mapping" | "missingColumns" | "ambiguousColumns">): DebtScheduleFileParseResult {
  const parsed = parseContractualScheduleText(text);
  return { ...parsed, ...metadata };
}

export function parseDebtScheduleFile(
  data: ArrayBuffer | Uint8Array,
  mappingOverride?: DebtScheduleFileColumnMapping
): DebtScheduleFileParseResult {
  let workbook: XLSX.WorkBook;
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const isZipWorkbook = bytes[0] === 0x50 && bytes[1] === 0x4b;
    const isLegacyWorkbook = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
    workbook = isZipWorkbook || isLegacyWorkbook
      ? XLSX.read(bytes, { type: "array", cellDates: true })
      : XLSX.read(new TextDecoder("utf-8").decode(bytes), { type: "string", cellDates: true });
  } catch {
    return emptyResult({ errors: ["No pudimos leer el archivo. Verifica que sea un Excel o CSV válido."] });
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return emptyResult({ errors: ["El archivo no contiene hojas de cálculo."] });
  const sheet = workbook.Sheets[firstSheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
  const header = findHeaderRow(matrix);
  if (!header) return emptyResult({ errors: ["No pudimos identificar la fila de encabezados del cronograma."] });

  const detected = detectMapping(header.headers);
  const mapping = { ...detected.mapping, ...mappingOverride };
  const missingColumns = REQUIRED_COLUMNS.filter((column) => mapping[column] == null);
  const metadata = {
    headerRowIndex: header.index,
    headers: header.headers,
    mapping,
    missingColumns,
    ambiguousColumns: detected.ambiguousColumns,
  };

  if (missingColumns.length > 0) {
    return emptyResult({
      ...metadata,
      errors: missingColumns.map((column) => `No pudimos identificar la columna ${DEBT_SCHEDULE_COLUMN_LABELS[column]}.`),
    });
  }

  const mappedColumnEntries = [...REQUIRED_COLUMNS, ...(mapping.reportedBalance != null ? ["reportedBalance" as const] : [])].map((column) => [column, mapping[column]!] as const);
  const duplicateSourceColumns = Array.from(new Set(
    mappedColumnEntries
      .map(([, sourceIndex]) => sourceIndex)
      .filter((sourceIndex, index, sourceIndexes) => sourceIndexes.indexOf(sourceIndex) !== index)
  ));
  if (duplicateSourceColumns.length > 0) {
    const duplicateLabels = mappedColumnEntries
      .filter(([, sourceIndex]) => duplicateSourceColumns.includes(sourceIndex))
      .map(([column]) => DEBT_SCHEDULE_COLUMN_LABELS[column]);
    return emptyResult({
      ...metadata,
      errors: [`Una misma columna fue asignada a más de un campo (${duplicateLabels.join(", ")}).`],
    });
  }

  const lines: string[] = [];
  const dataRows = matrix.slice(header.index + 1);
  for (const row of dataRows) {
    if (!row.some((cell) => cellText(cell) !== "")) continue;
    const installmentValue = row[mapping.installmentNumber!];
    const dueDate = excelDateToIso(row[mapping.dueDate!]);
    const amountValues = [
      row[mapping.expectedAmount!],
      row[mapping.expectedPrincipal!],
      row[mapping.expectedInterest!],
      row[mapping.expectedInsurance!],
      row[mapping.expectedFees!],
    ].map(cellText);
    if (mapping.reportedBalance != null) amountValues.push(cellText(row[mapping.reportedBalance]));
    lines.push([cellText(installmentValue), dueDate ?? cellText(row[mapping.dueDate!]), ...amountValues].join("\t"));
  }

  if (lines.length === 0) return emptyResult({ ...metadata, errors: ["No se encontraron filas de cuotas después de los encabezados."] });
  return resultFromText(lines.join("\n"), metadata);
}

export function scheduleFileRowsToInternal(rows: ContractualScheduleRowInput[]): ContractualScheduleRowInput[] {
  return rows.map((row, index) => ({ ...row, installmentNumber: index + 1 }));
}

export function formatScheduleFilePreview(result: DebtScheduleFileParseResult): Array<Record<DebtScheduleColumn, string | number | null>> {
  return result.rows.map((row) => ({
    installmentNumber: row.contractualInstallmentNumber,
    dueDate: row.dueDate,
    expectedAmount: row.expectedAmount,
    expectedPrincipal: row.expectedPrincipal,
    expectedInterest: row.expectedInterest,
    expectedInsurance: row.expectedInsurance,
    expectedFees: row.expectedFees,
    reportedBalance: row.reportedBalance ?? null,
  }));
}

export function summarizeScheduleFile(result: Pick<DebtScheduleFileParseResult, "rows">): { count: number; firstContractualNumber: number | null; lastContractualNumber: number | null; frequency: DebtPaymentFrequency } {
  const dates = result.rows.map((row) => row.dueDate);
  return {
    count: result.rows.length,
    firstContractualNumber: result.rows[0]?.contractualInstallmentNumber ?? null,
    lastContractualNumber: result.rows.at(-1)?.contractualInstallmentNumber ?? null,
    frequency: detectFrequencyFromDates(dates),
  };
}

/**
 * Converts an XLS/XLSX workbook to bounded, row-addressable text for the AI
 * fallback. The deterministic schedule parser remains the first path; this
 * representation preserves sheet names, headers, and source row positions
 * without sending the original workbook bytes inline.
 */
export function workbookToBoundedText(
  data: ArrayBuffer | Uint8Array,
  options: { maxSheets?: number; maxRowsPerSheet?: number; maxColumns?: number; maxCharacters?: number } = {},
): string | null {
  const maxSheets = options.maxSheets ?? 12;
  const maxRowsPerSheet = options.maxRowsPerSheet ?? 600;
  const maxColumns = options.maxColumns ?? 32;
  const maxCharacters = options.maxCharacters ?? 4_000_000;
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const isZipWorkbook = bytes[0] === 0x50 && bytes[1] === 0x4b;
    const isLegacyWorkbook = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
    if (!isZipWorkbook && !isLegacyWorkbook) return null;
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
    const lines: string[] = [];
    let characters = 0;
    for (const [sheetIndex, sheetName] of workbook.SheetNames.slice(0, maxSheets).entries()) {
      lines.push(`[sheetIndex=${sheetIndex}][sheetName=${sheetName}]`);
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: true });
      for (let rowIndex = 0; rowIndex < Math.min(matrix.length, maxRowsPerSheet); rowIndex++) {
        const row = matrix[rowIndex].slice(0, maxColumns).map((cell) => cellText(cell).replace(/[\t\r\n]+/g, " ").slice(0, 240));
        const line = `row=${rowIndex + 1}\t${row.join("\t")}`;
        characters += line.length + 1;
        if (characters > maxCharacters) return lines.join("\n");
        lines.push(line);
      }
    }
    return lines.length > 0 ? lines.join("\n") : null;
  } catch {
    return null;
  }
}
