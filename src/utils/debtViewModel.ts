import type { Debt, DebtCollateral, DebtEvent, DebtEventInstallmentAllocation, DebtInstallment, DebtScheduleVersion, DebtKind, DebtStatus, DebtPaymentFrequency, Category } from "../types";
import { currentDebtPrincipal, currentDebtScheduleVersion, effectiveDebtEvents, effectiveInstallmentAllocations, allocatedAmountForInstallment } from "./debtCalculations";

export function translateDebtError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    const translations: Record<string, string> = {
      AUTH_REQUIRED: "Se requiere iniciar sesión para realizar esta operación.",
      HOUSEHOLD_ACCESS_DENIED: "No tienes permisos de acceso en este hogar.",
      DEBT_NOT_FOUND: "La deuda especificada no existe.",
      DEBT_ALREADY_EXISTS: "Ya existe una deuda con este identificador.",
      INVALID_DEBT_INPUT: "Los datos ingresados para la deuda no son válidos.",
      INVALID_INSTALLMENTS: "El cronograma de cuotas contiene datos inválidos.",
      INVALID_COLLATERALS: "Las garantías ingresadas no son válidas.",
      DEBT_ARCHIVED: "La deuda se encuentra archivada y no admite operaciones.",
      DEBT_NOT_ACTIVE: "La deuda no está activa.",
      DEBT_ALREADY_PAID_OFF: "La deuda ya ha sido pagada en su totalidad.",
      DEBT_PRINCIPAL_EXCEEDED: "El monto supera el saldo principal actual.",
      DEBT_PREPAYMENT_WOULD_PAY_OFF: "El prepago pagaría la totalidad del principal; utilice la opción de Liquidar deuda.",
      INVALID_DEBT_PAYMENT: "Los datos del pago no son válidos.",
      INVALID_DEBT_PREPAYMENT: "Los datos del prepago no son válidos.",
      INVALID_DEBT_PAYOFF: "Los datos de la liquidación no son válidos.",
      INVALID_DEBT_REVERSAL: "Los datos de la reversión no son válidos.",
      INVALID_DEBT_SCHEDULE: "El nuevo cronograma no es válido.",
      INVALID_DEBT_ALLOCATIONS: "Las asignaciones de cuotas no coinciden con el monto o son inválidas.",
      DEBT_EVENT_ID_CONFLICT: "Conflicto con el identificador del registro.",
      DEBT_EVENT_NOT_FOUND: "El registro de deuda especificado no existe.",
      DEBT_EVENT_TYPE_UNSUPPORTED: "Tipo de registro de deuda no soportado.",
      DEBT_EVENT_ALREADY_REVERSED: "Este registro ya ha sido revertido previamente.",
      DEBT_REVERSAL_SCHEDULE_REQUIRED: "La reversión de este registro requiere un nuevo cronograma de cuotas.",
      DEBT_REVERSAL_SCHEDULE_NOT_ALLOWED: "La reversión no permite un nuevo cronograma.",
      DEBT_MOVEMENT_CONFLICT: "Conflicto con el movimiento financiero asociado.",
      DEBT_MOVEMENT_ALREADY_LINKED: "El movimiento financiero ya está vinculado a otra operación o deuda.",
      DEBT_MOVEMENT_NOT_FOUND: "El movimiento financiero no existe.",
      DEBT_MOVEMENT_MUST_BE_EXPENSE: "El movimiento asociado debe ser un egreso.",
      DEBT_MOVEMENT_AMOUNT_MISMATCH: "El monto del movimiento no coincide con el monto de la operación de deuda.",
      DEBT_MOVEMENT_DATE_MISMATCH: "La fecha del movimiento no coincide con la fecha de la operación.",
      DEBT_MOVEMENT_CONTEXT_REQUIRED: "El movimiento debe tener contexto de servicio de deuda.",
      DEBT_MOVEMENT_ACCOUNT_REQUIRED: "Se requiere seleccionar una cuenta financiera.",
      DEBT_MOVEMENT_ACCOUNT_NOT_FOUND: "La cuenta financiera seleccionada no existe.",
      DEBT_MOVEMENT_ACCOUNT_METHOD_MISMATCH: "El método de pago no coincide con el tipo de cuenta financiera.",
      ACCOUNT_NOT_AVAILABLE: "La cuenta financiera seleccionada no está disponible.",
      DEBT_SERVICE_MOVEMENT_RPC_ONLY: "Los movimientos de servicio de deuda solo pueden registrarse mediante operaciones de deuda.",
    };
    for (const [code, text] of Object.entries(translations)) {
      if (msg.includes(code)) return text;
    }
    return msg;
  }
  return "Ocurrió un error inesperado en la operación de deuda.";
}

export function formatDebtKind(kind: DebtKind): string {
  const map: Record<DebtKind, string> = {
    bank_loan: "Préstamo bancario",
    family_loan: "Préstamo familiar",
    installment_purchase: "Compra en cuotas",
    mortgage: "Hipoteca",
    pledge: "Pignoración / Empeño",
    credit_card: "Tarjeta de crédito",
    other: "Otro",
  };
  return map[kind] ?? kind;
}

export function formatDebtStatus(status: DebtStatus): string {
  const map: Record<DebtStatus, string> = {
    active: "Activa",
    paid_off: "Pagada",
    refinanced: "Refinanciada",
  };
  return map[status] ?? status;
}

export function formatPaymentFrequency(frequency: DebtPaymentFrequency | null): string {
  if (!frequency) return "No especificada";
  const map: Record<DebtPaymentFrequency, string> = {
    monthly: "Mensual",
    biweekly: "Quincenal",
    weekly: "Semanal",
    custom: "Personalizada",
  };
  return map[frequency] ?? frequency;
}

export function formatEventType(eventType: string): string {
  const map: Record<string, string> = {
    payment: "Pago de cuota",
    principal_prepayment: "Prepago de principal",
    principal_adjustment: "Ajuste de principal",
    refinance: "Refinanciación",
    payoff: "Liquidación total",
    reversal: "Reversión",
  };
  return map[eventType] ?? eventType;
}

export function getInstallmentProgress(
  installment: DebtInstallment,
  allocations: DebtEventInstallmentAllocation[],
  events: DebtEvent[]
) {
  const allocated = allocatedAmountForInstallment(installment.id, allocations, events);
  const expected = installment.expectedAmount ?? 0;
  const isPaid = expected > 0 ? allocated >= expected : allocated > 0;
  return {
    allocated,
    expected,
    isPaid,
    progressPercent: expected > 0 ? Math.min(100, Math.round((allocated / expected) * 100)) : allocated > 0 ? 100 : 0,
  };
}

export function debtEconomicSummary(
  cashAmount: number,
  principalAmount: number,
  interestPaid: number = 0,
  feesPaid: number = 0,
  insurancePaid: number = 0,
  otherCostPaid: number = 0,
  currentPrincipal?: number
) {
  const effectivePrincipal = currentPrincipal !== undefined ? currentPrincipal : principalAmount;
  const economicExpense = cashAmount - effectivePrincipal;
  const knownCosts = interestPaid + feesPaid + insurancePaid + otherCostPaid;
  const unclassifiedDebtCost = economicExpense - knownCosts;
  return {
    cashOutflow: cashAmount,
    principalReduction: effectivePrincipal,
    knownCosts,
    economicExpense,
    unclassifiedDebtCost,
  };
}

export function validateDebtPayment(input: {
  cashAmount: number;
  principalAmount: number;
  currentPrincipal: number;
  breakdownComplete: boolean;
  interestPaid?: number;
  feesPaid?: number;
  insurancePaid?: number;
  otherCostPaid?: number;
}): { valid: boolean; error?: string } {
  const interest = input.interestPaid ?? 0;
  const fees = input.feesPaid ?? 0;
  const insurance = input.insurancePaid ?? 0;
  const otherCost = input.otherCostPaid ?? 0;

  if (
    !Number.isFinite(input.cashAmount) ||
    !Number.isFinite(input.principalAmount) ||
    !Number.isFinite(input.currentPrincipal) ||
    !Number.isFinite(interest) ||
    !Number.isFinite(fees) ||
    !Number.isFinite(insurance) ||
    !Number.isFinite(otherCost)
  ) {
    return { valid: false, error: "Los montos ingresados deben ser números válidos." };
  }
  if (interest < 0 || fees < 0 || insurance < 0 || otherCost < 0) {
    return { valid: false, error: "Los costos no pueden ser negativos." };
  }
  if (input.cashAmount <= 0) {
    return { valid: false, error: "El monto de efectivo debe ser mayor a cero." };
  }
  if (input.principalAmount < 0) {
    return { valid: false, error: "El capital aplicado no puede ser negativo." };
  }
  if (input.principalAmount > input.currentPrincipal + 0.01) {
    return { valid: false, error: translateDebtError(new Error("DEBT_PRINCIPAL_EXCEEDED")) };
  }
  if (input.principalAmount > input.cashAmount + 0.01) {
    return { valid: false, error: "El capital aplicado no puede superar la salida de dinero." };
  }
  const knownCosts = interest + fees + insurance + otherCost;
  const economicExpense = input.cashAmount - input.principalAmount;
  if (knownCosts > economicExpense + 0.01) {
    return { valid: false, error: "Los costos conocidos no pueden superar el costo financiero total." };
  }
  if (input.breakdownComplete) {
    if (Math.abs(economicExpense - knownCosts) > 0.01) {
      return { valid: false, error: translateDebtError(new Error("INVALID_DEBT_PAYMENT")) };
    }
  }
  return { valid: true };
}

export function validateDebtPrepayment(input: {
  cashAmount: number;
  principalAmount: number;
  currentPrincipal: number;
  breakdownComplete: boolean;
  interestPaid?: number;
  feesPaid?: number;
  insurancePaid?: number;
  otherCostPaid?: number;
}): { valid: boolean; error?: string } {
  const interest = input.interestPaid ?? 0;
  const fees = input.feesPaid ?? 0;
  const insurance = input.insurancePaid ?? 0;
  const otherCost = input.otherCostPaid ?? 0;

  if (
    !Number.isFinite(input.cashAmount) ||
    !Number.isFinite(input.principalAmount) ||
    !Number.isFinite(input.currentPrincipal) ||
    !Number.isFinite(interest) ||
    !Number.isFinite(fees) ||
    !Number.isFinite(insurance) ||
    !Number.isFinite(otherCost)
  ) {
    return { valid: false, error: "Los montos ingresados deben ser números válidos." };
  }
  if (interest < 0 || fees < 0 || insurance < 0 || otherCost < 0) {
    return { valid: false, error: "Los costos no pueden ser negativos." };
  }
  if (input.cashAmount <= 0) {
    return { valid: false, error: "El monto de efectivo debe ser mayor a cero." };
  }
  if (input.principalAmount <= 0) {
    return { valid: false, error: "El prepago de principal debe ser mayor a cero." };
  }
  if (input.principalAmount >= input.currentPrincipal - 0.01) {
    return { valid: false, error: translateDebtError(new Error("DEBT_PREPAYMENT_WOULD_PAY_OFF")) };
  }
  if (input.principalAmount > input.cashAmount + 0.01) {
    return { valid: false, error: "El capital aplicado no puede superar la salida de dinero." };
  }
  const knownCosts = interest + fees + insurance + otherCost;
  const economicExpense = input.cashAmount - input.principalAmount;
  if (knownCosts > economicExpense + 0.01) {
    return { valid: false, error: "Los costos conocidos no pueden superar el costo financiero total." };
  }
  if (input.breakdownComplete) {
    if (Math.abs(economicExpense - knownCosts) > 0.01) {
      return { valid: false, error: translateDebtError(new Error("INVALID_DEBT_PREPAYMENT")) };
    }
  }
  return { valid: true };
}

export function validateDebtPayoff(input: {
  cashAmount: number;
  currentPrincipal: number;
  breakdownComplete: boolean;
  interestPaid?: number;
  feesPaid?: number;
  insurancePaid?: number;
  otherCostPaid?: number;
}): { valid: boolean; error?: string } {
  const interest = input.interestPaid ?? 0;
  const fees = input.feesPaid ?? 0;
  const insurance = input.insurancePaid ?? 0;
  const otherCost = input.otherCostPaid ?? 0;

  if (
    !Number.isFinite(input.cashAmount) ||
    !Number.isFinite(input.currentPrincipal) ||
    !Number.isFinite(interest) ||
    !Number.isFinite(fees) ||
    !Number.isFinite(insurance) ||
    !Number.isFinite(otherCost)
  ) {
    return { valid: false, error: "Los montos ingresados deben ser números válidos." };
  }
  if (interest < 0 || fees < 0 || insurance < 0 || otherCost < 0) {
    return { valid: false, error: "Los costos no pueden ser negativos." };
  }
  if (input.cashAmount <= 0) {
    return { valid: false, error: "El monto de efectivo debe ser mayor a cero." };
  }
  if (input.cashAmount < input.currentPrincipal - 0.01) {
    return { valid: false, error: translateDebtError(new Error("INVALID_DEBT_PAYOFF")) };
  }
  const knownCosts = interest + fees + insurance + otherCost;
  const economicExpense = input.cashAmount - input.currentPrincipal;
  if (knownCosts > economicExpense + 0.01) {
    return { valid: false, error: "Los costos conocidos no pueden superar el costo financiero total." };
  }
  const minRequired = input.currentPrincipal + knownCosts;
  if (input.cashAmount < minRequired - 0.01) {
    return { valid: false, error: translateDebtError(new Error("INVALID_DEBT_PAYOFF")) };
  }
  if (input.breakdownComplete) {
    if (Math.abs(economicExpense - knownCosts) > 0.01) {
      return { valid: false, error: translateDebtError(new Error("INVALID_DEBT_PAYOFF")) };
    }
  }
  return { valid: true };
}

export function validateDebtAllocations(
  allocations: Array<{ installmentId: string; allocatedAmount: number }>,
  installments: DebtInstallment[],
  cashAmount: number,
  persistedAllocations: DebtEventInstallmentAllocation[] = [],
  debtEvents: DebtEvent[] = []
): { valid: boolean; error?: string } {
  if (!Number.isFinite(cashAmount) || cashAmount <= 0) {
    return { valid: false, error: "El monto de efectivo debe ser un número válido mayor a cero." };
  }
  const seenIds = new Set<string>();
  const totalAllocated = allocations.reduce((sum, a) => {
    if (!Number.isFinite(a.allocatedAmount) || a.allocatedAmount <= 0) {
      return sum;
    }
    return sum + a.allocatedAmount;
  }, 0);

  if (totalAllocated > cashAmount + 0.01) {
    return { valid: false, error: "El total asignado a cuotas supera la salida de efectivo." };
  }

  for (const alloc of allocations) {
    if (!Number.isFinite(alloc.allocatedAmount) || alloc.allocatedAmount <= 0) {
      return { valid: false, error: "El monto asignado a la cuota debe ser mayor a cero y finito." };
    }
    if (seenIds.has(alloc.installmentId)) {
      return { valid: false, error: "No se permiten cuotas duplicadas en la asignación." };
    }
    seenIds.add(alloc.installmentId);

    const inst = installments.find((i) => i.id === alloc.installmentId);
    if (!inst) {
      return { valid: false, error: "Una de las cuotas asignadas no existe en el cronograma." };
    }

    const alreadyAllocated = allocatedAmountForInstallment(inst.id, persistedAllocations, debtEvents);
    const expectedAmount = inst.expectedAmount;
    if (expectedAmount != null && Number.isFinite(expectedAmount)) {
      const remaining = Math.max(0, expectedAmount - alreadyAllocated);
      if (alloc.allocatedAmount > remaining + 0.01) {
        return { valid: false, error: `El monto asignado a la cuota #${inst.installmentNumber} supera el saldo restante (S/ ${remaining.toFixed(2)}).` };
      }
    }
  }
  return { valid: true };
}
