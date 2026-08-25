import type { AmortizationMethod, BankLoanSubtype, DebtInsurancePricingMode, DebtInsuranceType } from "../types.js";

export interface BankLoanSubtypeOption {
  value: BankLoanSubtype;
  label: string;
  description: string;
}

export const BANK_LOAN_SUBTYPE_OPTIONS: BankLoanSubtypeOption[] = [
  { value: "personal", label: "Préstamo personal / libre disponibilidad", description: "Créditos personales estándar de consumo." },
  { value: "vehicular", label: "Crédito vehicular", description: "Financiamiento de vehículo ligero o comercial." },
  { value: "mortgage", label: "Crédito hipotecario", description: "Adquisición, construcción o remodelación de vivienda." },
  { value: "education", label: "Crédito educativo / estudios", description: "Estudios superiores o postgrados con período de gracia opcional." },
  { value: "payroll", label: "Crédito por convenio / planilla", description: "Préstamo con descuento por planilla de haberes." },
  { value: "debt_consolidation", label: "Compra o consolidación de deuda", description: "Unificación de deudas en una sola entidad." },
  { value: "business", label: "Crédito para negocio / MYPE", description: "Capital de trabajo o activo fijo para micro/pequeña empresa." },
  { value: "other", label: "Otro crédito", description: "Otro producto o contrato de entidad financiera." },
];

export interface AmortizationMethodOption {
  value: AmortizationMethod;
  label: string;
  description: string;
}

export const AMORTIZATION_METHOD_OPTIONS: AmortizationMethodOption[] = [
  { value: "fixed_installment", label: "Cuota fija", description: "Cuota idéntica período a período (sistema francés)." },
  { value: "constant_principal", label: "Capital constante / cuota decreciente", description: "Mismo abono al principal, interés disminuye." },
  { value: "increasing_installment", label: "Cuota creciente", description: "Cuotas que se incrementan progresivamente." },
  { value: "decreasing_installment", label: "Cuota decreciente contractual", description: "Cuotas decrecientes acordadas en contrato." },
  { value: "irregular_contract", label: "Cronograma irregular definido por la entidad", description: "Fechas o importes no periódicos." },
  { value: "custom", label: "Otra modalidad", description: "Modalidad personalizada." },
  { value: "unknown", label: "No lo sé todavía", description: "Se actualizará cuando se disponga del contrato." },
];

export function getBankLoanSubtypeLabel(subtype: BankLoanSubtype | string): string {
  const found = BANK_LOAN_SUBTYPE_OPTIONS.find((opt) => opt.value === subtype);
  return found ? found.label : "Otro crédito";
}

export function getAmortizationMethodLabel(method: AmortizationMethod | string): string {
  const found = AMORTIZATION_METHOD_OPTIONS.find((opt) => opt.value === method);
  return found ? found.label : "Otra modalidad";
}
