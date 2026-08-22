import type { DueDateKind } from "./dueDates.js";
import type { DebtDataLimitation } from "./debtIntelligence.js";
import type { DebtPrepaymentSimulationStatus } from "./debtSimulation.js";
import type { AvalancheComparisonMode, CashFlowRelief30dUnrankedReason } from "./debtStrategy.js";

/**
 * Format monetary amount with currency code (e.g., "PEN 1,250.00" or "USD 300.00").
 * Preserves exact currencyCode, never performs FX or cross-currency sums.
 */
export function formatDebtMoney(
  amount: number | null | undefined,
  currencyCode: string = "PEN"
): string {
  if (amount == null || !Number.isFinite(amount)) return "Sin monto";
  const formatted = amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currencyCode} ${formatted}`;
}

/**
 * Human-readable description for DebtDataLimitation flags.
 */
export function debtLimitationLabel(limitation: DebtDataLimitation): string {
  switch (limitation) {
    case "missing_original_principal":
      return "Falta registrar el principal original.";
    case "missing_current_schedule":
      return "No hay cronograma actual.";
    case "unknown_installment_amounts":
      return "Hay cuotas con monto por confirmar.";
    case "missing_rate":
      return "No hay tasa registrada.";
    case "missing_last_due_date":
      return "No hay última fecha registrada del cronograma.";
    default:
      return "Información pendiente de registro.";
  }
}

/**
 * Human-readable label for Avalanche Comparison Mode.
 */
export function avalancheComparisonModeLabel(mode: AvalancheComparisonMode): string {
  switch (mode) {
    case "tcea_full":
      return "Comparación completa por TCEA.";
    case "tea_full":
      return "No hay TCEA registradas; comparación completa por TEA.";
    case "partial":
      return "Comparación parcial: existen bases de tasa distintas o datos faltantes.";
    case "unavailable":
      return "No hay tasas registradas suficientes para comparar.";
  }
}

/**
 * Human-readable reason for unranked cash-flow relief items.
 */
export function cashFlowUnrankedReasonLabel(reason: CashFlowRelief30dUnrankedReason): string {
  switch (reason) {
    case "missing_current_schedule":
      return "Sin cronograma actual.";
    case "unknown_next30_amounts":
      return "Hay montos por confirmar en los próximos 30 días.";
  }
}

/**
 * Human-readable explanation copy for simulation status.
 */
export function simulationStatusCopy(status: DebtPrepaymentSimulationStatus): string {
  switch (status) {
    case "valid_prepayment":
      return "Si este monto se aplicara íntegramente al capital:";
    case "payoff_candidate":
      return "El principal quedaría matemáticamente en 0 si este monto se aplicara íntegramente al capital.";
    case "exceeds_current_principal":
      return "El monto aplicado al capital supera el principal actual.";
    case "invalid_amount":
      return "Ingresa un monto válido mayor que cero.";
    case "no_outstanding_principal":
      return "No hay principal pendiente para simular.";
    case "not_active":
      return "La simulación está disponible para deudas activas.";
    case "archived":
      return "La deuda está archivada.";
    case "unsupported_debt_kind":
      return "Las tarjetas de crédito tendrán un simulador específico en una fase posterior.";
  }
}

/**
 * Human-readable label and visual tone for due date status.
 */
export function dueStatusLabel(kind: DueDateKind | "covered" | null): {
  label: string;
  tone: "red" | "orange" | "yellow" | "blue" | "emerald";
} {
  switch (kind) {
    case "overdue":
      return { label: "Vencida", tone: "red" };
    case "today":
      return { label: "Vence hoy", tone: "orange" };
    case "tomorrow":
      return { label: "Vence mañana", tone: "yellow" };
    case "upcoming":
      return { label: "Próxima", tone: "blue" };
    case "later":
      return { label: "Fecha posterior", tone: "blue" };
    case "covered":
      return { label: "Cubierta", tone: "emerald" };
    default:
      return { label: "Sin fecha", tone: "blue" };
  }
}
