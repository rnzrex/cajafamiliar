export class HouseholdNotProvisionedError extends Error {
  constructor() {
    super("El household no está provisionado en Supabase.");
    this.name = "HouseholdNotProvisionedError";
  }
}

export class RemoteAppDataLoadError extends Error {
  failedResource: string;
  causeError?: unknown;

  constructor(failedResource: string, causeError?: unknown) {
    super(`Error al cargar datos financieros remotos de la tabla: ${failedResource}`);
    this.name = "RemoteAppDataLoadError";
    this.failedResource = failedResource;
    this.causeError = causeError;
  }
}

export class TrustedOfflineSnapshotUnavailableError extends Error {
  constructor() {
    super("No existe una copia verificada de Caja Familiar para usar sin conexión.");
    this.name = "TrustedOfflineSnapshotUnavailableError";
  }
}

export class MovementNotFoundError extends Error {
  constructor() {
    super("El movimiento no existe en Supabase.");
    this.name = "MovementNotFoundError";
  }
}

export class DebtMovementProtectedError extends Error {
  constructor() {
    super("Este movimiento está ligado a una deuda y solo puede corregirse desde el dominio de deudas.");
    this.name = "DebtMovementProtectedError";
  }
}

export class MovementContextImmutableError extends Error {
  constructor() {
    super("El contexto financiero del movimiento no puede cambiarse.");
    this.name = "MovementContextImmutableError";
  }
}

export class CategoryNotFoundError extends Error {
  constructor() {
    super("La categoría no existe en Supabase.");
    this.name = "CategoryNotFoundError";
  }
}

export class RecurringPaymentNotFoundError extends Error {
  constructor() {
    super("El pago recurrente no existe en Supabase.");
    this.name = "RecurringPaymentNotFoundError";
  }
}

export class FinancialAccountNotFoundError extends Error {
  constructor() {
    super("La cuenta financiera no existe en Supabase.");
    this.name = "FinancialAccountNotFoundError";
  }
}

export class FinancialAccountProtectedError extends Error {
  constructor() {
    super("La cuenta de caja predeterminada no se puede modificar ni eliminar.");
    this.name = "FinancialAccountProtectedError";
  }
}

export class DebtOperationUnavailableError extends Error {
  constructor(message = "La operación de deuda no está disponible en Supabase.") {
    super(message);
    this.name = "DebtOperationUnavailableError";
  }
}

export class MovementReconciledError extends Error {
  constructor() {
    super("Este movimiento ya fue conciliado en una conciliación confirmada y no puede modificarse o eliminarse.");
    this.name = "MovementReconciledError";
  }
}

export class ReconciliationIdConflictError extends Error {
  constructor() {
    super("El ID de conciliación ya existe con datos distintos (conflicto de idempotencia).");
    this.name = "ReconciliationIdConflictError";
  }
}

export class MovementCorrectionConflictError extends Error {
  constructor() {
    super("El movimiento fue modificado por otra sesión (conflicto de concurrencia). Por favor recarga e intenta de nuevo.");
    this.name = "MovementCorrectionConflictError";
  }
}

export class MovementNotReconciledError extends Error {
  constructor() {
    super("El movimiento no forma parte de una conciliación confirmada.");
    this.name = "MovementNotReconciledError";
  }
}
