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

export function parsePeruvianNumeric(val: string | undefined | null): number {
  if (!val) return 0;
  const trimmed = val.replace(/[^0-9.,-]/g, "").trim();
  if (!trimmed) return 0;

  const hasComma = trimmed.includes(",");
  const hasDot = trimmed.includes(".");

  if (hasComma && hasDot) {
    if (trimmed.lastIndexOf(",") > trimmed.lastIndexOf(".")) {
      // 1.234,56 -> dot is thousand separator, comma is decimal
      const normalized = trimmed.replace(/\./g, "").replace(",", ".");
      const n = parseFloat(normalized);
      return isNaN(n) ? 0 : n;
    } else {
      // 1,234.56 -> comma is thousand separator, dot is decimal
      const normalized = trimmed.replace(/,/g, "");
      const n = parseFloat(normalized);
      return isNaN(n) ? 0 : n;
    }
  } else if (hasComma) {
    // 850,50 -> comma is decimal
    const normalized = trimmed.replace(",", ".");
    const n = parseFloat(normalized);
    return isNaN(n) ? 0 : n;
  } else {
    // 850.50 -> dot is decimal
    const n = parseFloat(trimmed);
    return isNaN(n) ? 0 : n;
  }
}

export function parseDateStr(val: string | undefined | null): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parts = trimmed.split("-");
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return trimmed;
    return null;
  }
  const match = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const dStr = day.toString().padStart(2, "0");
      const mStr = month.toString().padStart(2, "0");
      return `${year}-${mStr}-${dStr}`;
    }
  }
  return null;
}

export function detectFrequencyFromDates(dates: string[]): DebtPaymentFrequency {
  if (dates.length < 2) return "monthly";

  let totalGapDays = 0;
  let count = 0;
  for (let i = 1; i < dates.length; i++) {
    const d1 = new Date(dates[i - 1]).getTime();
    const d2 = new Date(dates[i]).getTime();
    if (!isNaN(d1) && !isNaN(d2) && d2 > d1) {
      const gap = (d2 - d1) / (1000 * 60 * 60 * 24);
      totalGapDays += gap;
      count++;
    }
  }

  if (count === 0) return "monthly";
  const avgGap = totalGapDays / count;

  if (avgGap <= 10) return "weekly";
  if (avgGap <= 18) return "biweekly";
  if (avgGap <= 45) return "monthly";
  return "custom";
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
    const tokens = line.split(/\t|;|\s{2,}/).map((t) => t.trim());

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
      errors.push(`Línea ${idx + 1}: Fecha de vencimiento inválida (${tokens[dateIdx] || ""}).`);
      continue;
    }

    const expectedAmount = parsePeruvianNumeric(tokens[dateIdx + 1]);
    const expectedPrincipal = parsePeruvianNumeric(tokens[dateIdx + 2]);
    const expectedInterest = parsePeruvianNumeric(tokens[dateIdx + 3]);
    const expectedInsurance = parsePeruvianNumeric(tokens[dateIdx + 4]);
    const expectedFees = parsePeruvianNumeric(tokens[dateIdx + 5]);

    const sumComponents = expectedPrincipal + expectedInterest + expectedInsurance + expectedFees;
    if (sumComponents > 0 && Math.abs(expectedAmount - sumComponents) > 0.15) {
      errors.push(
        `Línea ${idx + 1} (Cuota ${instNo}): El total (${expectedAmount}) no coincide con la suma de componentes (${round2(sumComponents)}).`
      );
    }

    // Chronological order check
    if (rows.length > 0) {
      const lastDate = rows[rows.length - 1].dueDate;
      if (dueDate <= lastDate) {
        errors.push(`Línea ${idx + 1} (Cuota ${instNo}): La fecha ${dueDate} no es posterior a la cuota anterior (${lastDate}).`);
      }
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

  const firstAmt = rows[0].expectedAmount;
  const isFixed = rows.every((r) => Math.abs(r.expectedAmount - firstAmt) <= 0.05);

  const totalContractSum = round2(rows.reduce((s, r) => s + r.expectedAmount, 0));
  const totalPrincipal = round2(rows.reduce((s, r) => s + r.expectedPrincipal, 0));
  const totalInterest = round2(rows.reduce((s, r) => s + r.expectedInterest, 0));
  const totalInsurance = round2(rows.reduce((s, r) => s + r.expectedInsurance, 0));
  const totalFees = round2(rows.reduce((s, r) => s + r.expectedFees, 0));

  const detectedFrequency = detectFrequencyFromDates(rows.map((r) => r.dueDate));

  return {
    valid: errors.length === 0,
    errors,
    rows,
    detectedCount: rows.length,
    firstDueDate: rows[0].dueDate,
    detectedFrequency,
    installmentAmountMode: isFixed ? "fixed" : "variable",
    totalContractSum,
    totalPrincipal,
    totalInterest,
    totalInsurance,
    totalFees,
  };
}
