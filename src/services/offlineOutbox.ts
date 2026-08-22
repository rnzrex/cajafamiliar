import type { HouseholdMember, Movement } from "../types";

const DB_NAME = "caja-familiar-offline";
const DB_VERSION = 1;
const STORE_NAME = "operations";
const IDENTITY_INDEX = "household-user";
const QUEUED_AT_INDEX = "queued-at";
const OPERATION_VERSION = 1 as const;

export class DebtServiceOfflineUnsupportedError extends Error {
  constructor() {
    super("DEBT_SERVICE_OFFLINE_UNSUPPORTED");
    this.name = "DebtServiceOfflineUnsupportedError";
  }
}

export class CreditCardPurchaseOfflineUnsupportedError extends Error {
  constructor() {
    super("CREDIT_CARD_PURCHASE_OFFLINE_UNSUPPORTED");
    this.name = "CreditCardPurchaseOfflineUnsupportedError";
  }
}

export interface OfflineCreateMovementOperation {
  version: typeof OPERATION_VERSION;
  operationId: string;
  kind: "create-movement";
  householdId: string;
  userId: string;
  queuedAt: string;
  movement: Movement;
}

export async function enqueueCreateMovement(member: HouseholdMember, movement: Movement): Promise<void> {
  if (movement.movementContext === "debt_service") throw new DebtServiceOfflineUnsupportedError();
  if (movement.movementContext === "credit_card_purchase") throw new CreditCardPurchaseOfflineUnsupportedError();

  const database = await openOutbox();
  const operation: OfflineCreateMovementOperation = {
    version: OPERATION_VERSION,
    operationId: `op-${crypto.randomUUID()}`,
    kind: "create-movement",
    householdId: member.householdId,
    userId: member.userId,
    queuedAt: new Date().toISOString(),
    movement: { ...movement, movementContext: "standard" },
  };

  try {
    await runTransaction<void>(database, "readwrite", (store) => store.add(operation));
  } finally {
    database.close();
  }
}

export async function listPendingCreateMovements(member: HouseholdMember): Promise<OfflineCreateMovementOperation[]> {
  const database = await openOutbox();
  try {
    const operations = await runTransaction<OfflineCreateMovementOperation[]>(database, "readonly", (store) =>
      store.index(IDENTITY_INDEX).getAll(IDBKeyRange.only([member.householdId, member.userId]))
    );

    return operations
      .filter((operation) => operation.version === OPERATION_VERSION && operation.kind === "create-movement")
      .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt) || left.operationId.localeCompare(right.operationId))
      .map((operation) => ({
        ...operation,
        movement: {
          ...operation.movement,
          accountId: operation.movement.accountId ?? null,
          movementContext: operation.movement.movementContext === "debt_service" ? "debt_service" : operation.movement.movementContext === "credit_card_purchase" ? "credit_card_purchase" : "standard",
        },
      }));
  } finally {
    database.close();
  }
}

export async function removeOfflineOperation(operationId: string): Promise<void> {
  const database = await openOutbox();
  try {
    await runTransaction<void>(database, "readwrite", (store) => store.delete(operationId));
  } finally {
    database.close();
  }
}

function openOutbox(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB no está disponible en este navegador."));

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      const upgradeTransaction = request.transaction;
      if (!upgradeTransaction) {
        reject(new Error("No se pudo preparar la base IndexedDB de movimientos pendientes."));
        return;
      }

      const store = database.objectStoreNames.contains(STORE_NAME)
        ? upgradeTransaction.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: "operationId" });

      if (!store.indexNames.contains(IDENTITY_INDEX)) store.createIndex(IDENTITY_INDEX, ["householdId", "userId"], { unique: false });
      if (!store.indexNames.contains(QUEUED_AT_INDEX)) store.createIndex(QUEUED_AT_INDEX, "queuedAt", { unique: false });
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir la cola offline."));
    request.onblocked = () => reject(new Error("La cola offline está bloqueada por otra conexión abierta."));
  });
}

function runTransaction<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<any> | void
): Promise<T> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(STORE_NAME, mode);
    } catch (error) {
      reject(error);
      return;
    }

    let result: unknown;
    let requestError: unknown;
    let settled = false;

    function finish(callback: () => void) {
      if (settled) return;
      settled = true;
      database.close();
      callback();
    }

    transaction.oncomplete = () => finish(() => resolve(result as T));
    transaction.onerror = () => finish(() => reject(requestError ?? transaction.error ?? new Error("La transacción IndexedDB falló.")));
    transaction.onabort = () => finish(() => reject(requestError ?? transaction.error ?? new Error("La transacción IndexedDB fue cancelada.")));

    try {
      const request = action(transaction.objectStore(STORE_NAME));
      if (request) {
        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => {
          requestError = request.error;
          try {
            transaction.abort();
          } catch {
            finish(() => reject(requestError ?? new Error("La solicitud IndexedDB falló.")));
          }
        };
      }
    } catch (error) {
      requestError = error;
      try {
        transaction.abort();
      } catch {
        finish(() => reject(error));
      }
    }
  });
}
