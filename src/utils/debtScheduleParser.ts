import type { DebtInstallmentAmountMode, DebtPaymentFrequency } from "../types.js";

export interface ContractualScheduleRowInput {
  installmentNumber: number;
  dueDate: string;
  expectedAmount: number;
  expectedPrincipal: number;
  expectedInterest: number;
  expectedInsurance: number;
  expectedFees: number;
}

export interface ScheduleParseResult {
  valid: boolean;
  errors: string[];
  rows: ContractualScheduleRowInput[];
  detectedCount: number;
  firstDueDate: string | null;
  detectedFrequency: DebtPaymentFrequency;
  installmentAmountMode: DebtInstallmentAmountMode;
  totalContractSum: number;
  totalPrincipal: number;
  totalInterest: number;
  totalInsurance: number;
  totalFees: number;
}

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function parseNumeric(val: string | undefined | null): number {
  if (!val) return 0;
  // Clean currency symbols, commas as thousands separators, etc.
  const cleaned = val.replace(/[^0-9.-]/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function parseDateStr(val: string | undefined | null): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  // DD/MM/YYYY or DD-MM-YYYY
  const match = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) {
    const day = match[1].padStart(2, "0");
    const month = match[2].padStart(2, "0");
    const year = match[3];
    return `${year}-${month}-${day}`;
  }
  return null;
}

export function parseContractualScheduleText(rawText: string): ScheduleParseResult {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const errors: string[] = [];
  const rows: ContractualScheduleRowInput[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    // Split by TAB or multiple spaces or semicolons
    const tokens = line.split(/\t|;|\s{2,}/).map((t) => t.trim());

    // Skip header line if detected
    if (idx === 0 && (line.toLowerCase().includes("cuota") || line.toLowerCase().includes("fecha") || line.toLowerCase().includes("capital"))) {
      continue;
    }

    if (tokens.length < 3) {
      errors.push(`Línea ${idx + 1}: Insuficientes columnas.`);
      continue;
    }

    let instNo = parseInt(tokens[0], 10);
    let dateIdx = 1;
    if (isNaN(instNo)) {
      // Try if first token is date and auto-assign installment number
      const d = parseDateStr(tokens[0]);
      if (d) {
        instNo = rows.length + 1;
        dateIdx = 0;
      } else {
        errors.push(`Línea ${idx + 1}: N° de cuota o fecha no reconocidos.`);
        continue;
      }
    }

    const dueDate = parseDateStr(tokens[dateIdx]);
    if (!dueDate) {
      errors.push(`Línea ${idx + 1}: Fecha inválida (${tokens[dateIdx] || ""}).`);
      continue;
    }

    const expectedAmount = parseNumeric(tokens[dateIdx + 1]);
    const expectedPrincipal = parseNumeric(tokens[dateIdx + 2]);
    const expectedInterest = parseNumeric(tokens[dateIdx + 3]);
    const expectedInsurance = parseNumeric(tokens[dateIdx + 4]);
    const expectedFees = parseNumeric(tokens[dateIdx + 5]);

    // Validation total ≈ principal + interest + insurance + fees
    const sumComponents = expectedPrincipal + expectedInterest + expectedInsurance + expectedFees;
    if (sumComponents > 0 && Math.abs(expectedAmount - sumComponents) > 0.10) {
      errors.push(
        `Línea ${idx + 1} (Cuota ${instNo}): El total (${expectedAmount}) no coincide con la suma de componentes (${round2(sumComponents)}).`
      );
    }

    rows.push({
      installmentNumber: instNo > 0 ? instNo : rows.length + 1,
      dueDate,
      expectedAmount: round2(expectedAmount),
      expectedPrincipal: round2(expectedPrincipal),
      expectedInterest: round2(expectedInterest),
      expectedInsurance: round2(expectedInsurance),
      expectedFees: round2(expectedFees),
    });
  }

  if (rows.length === 0) {
    return {
      valid: false,
      errors: errors.length > 0 ? errors : ["No se encontraron filas válidas en el cronograma."],
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
    };
  }

  // Auto-detect installment amount mode (fixed vs variable)
  const firstAmt = rows[0].expectedAmount;
  const isFixed = rows.every((r) => Math.abs(r.expectedAmount - firstAmt) <= 0.05);

  // Compute totals
  const totalContractSum = round2(rows.reduce((s, r) => s + r.expectedAmount, 0));
  const totalPrincipal = round2(rows.reduce((s, r) => s + r.expectedPrincipal, 0));
  const totalInterest = round2(rows.reduce((s, r) => s + r.expectedInterest, 0));
  const totalInsurance = round2(rows.reduce((s, r) => s + r.expectedInsurance, 0));
  const totalFees = round2(rows.reduce((s, r) => s + r.expectedFees, 0));

  return {
    valid: errors.length === 0,
    errors,
    rows,
    detectedCount: rows.length,
    firstDueDate: rows[0].dueDate,
    detectedFrequency: "monthly",
    installmentAmountMode: isFixed ? "fixed" : "variable",
    totalContractSum,
    totalPrincipal,
    totalInterest,
    totalInsurance,
    totalFees,
  };
}
