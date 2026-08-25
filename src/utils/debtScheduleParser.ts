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

function parseRequiredPeruvianNumeric(val: string | undefined | null): number | null {
  if (!val || !/[0-9]/.test(val)) return null;
  const parsed = parsePeruvianNumeric(val);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseDateStr(val: string | undefined | null): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parts = trimmed.split("-");
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (isRealCalendarDate(y, m, d)) return trimmed;
    return null;
  }
  const match = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    if (isRealCalendarDate(year, month, day)) {
      const dStr = day.toString().padStart(2, "0");
      const mStr = month.toString().padStart(2, "0");
      return `${year}-${mStr}-${dStr}`;
    }
  }
  return null;
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateOrdinal(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / (1000 * 60 * 60 * 24);
}

export function detectFrequencyFromDates(dates: string[]): DebtPaymentFrequency {
  if (dates.length < 2) return "monthly";

  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const gap = dateOrdinal(dates[i]) - dateOrdinal(dates[i - 1]);
    if (!Number.isFinite(gap) || gap <= 0) return "custom";
    gaps.push(gap);
  }

  const allWithin = (min: number, max: number) => gaps.every((gap) => gap >= min && gap <= max);
  if (allWithin(6, 8)) return "weekly";
  if (allWithin(13, 15)) return "biweekly";
  // Calendar-month schedules legitimately vary between 28 and 31 days, but
  // an irregular sequence must not be classified from its average gap.
  if (allWithin(27, 32)) return "monthly";
  return "custom";
}

export function parseContractualScheduleText(rawText: string): ScheduleParseResult {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const errors: string[] = [];
  const rows: ContractualScheduleRowInput[] = [];
  const seenInstallmentNumbers = new Set<number>();

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

    if (tokens.length < dateIdx + 6) {
      errors.push(`Línea ${idx + 1}: Se requieren total, capital, interés, seguro y gastos.`);
      continue;
    }

    if (!Number.isInteger(instNo) || instNo <= 0) {
      errors.push(`Línea ${idx + 1}: El número de cuota debe ser mayor a cero.`);
      continue;
    }
    if (seenInstallmentNumbers.has(instNo)) {
      errors.push(`Línea ${idx + 1}: El número de cuota ${instNo} está duplicado.`);
    }
    seenInstallmentNumbers.add(instNo);

    const parsedAmounts = [
      parseRequiredPeruvianNumeric(tokens[dateIdx + 1]),
      parseRequiredPeruvianNumeric(tokens[dateIdx + 2]),
      parseRequiredPeruvianNumeric(tokens[dateIdx + 3]),
      parseRequiredPeruvianNumeric(tokens[dateIdx + 4]),
      parseRequiredPeruvianNumeric(tokens[dateIdx + 5]),
    ];

    if (parsedAmounts.some((amount) => amount == null)) {
      errors.push(`Línea ${idx + 1} (Cuota ${instNo}): Todos los importes deben ser números explícitos.`);
      continue;
    }

    const [expectedAmount, expectedPrincipal, expectedInterest, expectedInsurance, expectedFees] = parsedAmounts as [number, number, number, number, number];

    if (expectedAmount <= 0) {
      errors.push(`Línea ${idx + 1} (Cuota ${instNo}): La cuota total debe ser mayor a cero.`);
    }
    if ([expectedPrincipal, expectedInterest, expectedInsurance, expectedFees].some((amount) => amount < 0)) {
      errors.push(`Línea ${idx + 1} (Cuota ${instNo}): Los importes no pueden ser negativos.`);
    }

    const sumComponents = expectedPrincipal + expectedInterest + expectedInsurance + expectedFees;
    if (Math.abs(expectedAmount - sumComponents) > 0.15) {
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

  const expectedSequence = rows.map((row) => row.installmentNumber);
  if (expectedSequence.some((number, index) => number !== index + 1)) {
    errors.push("La secuencia de cuotas debe ser continua y comenzar en 1.");
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
