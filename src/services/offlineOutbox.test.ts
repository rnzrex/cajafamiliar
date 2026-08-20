import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HouseholdMember, Movement } from "../types";
import { enqueueCreateMovement, listPendingCreateMovements } from "./offlineOutbox";

const operations = new Map<string, any>();
const storeNames = new Set<string>();

class FakeStore {
  indexNames = { contains: () => true };

  createIndex() {
    return this;
  }

  add(value: any) {
    const request: any = {};
    queueMicrotask(() => {
      operations.set(value.operationId, value);
      request.result = value;
      request.onsuccess?.();
      this.transaction.oncomplete?.();
    });
    return request;
  }

  index() {
    return {
      getAll: () => {
        const request: any = {};
        queueMicrotask(() => {
          request.result = [...operations.values()];
          request.onsuccess?.();
          this.transaction.oncomplete?.();
        });
        return request;
      },
    };
  }

  delete(operationId: string) {
    const request: any = {};
    queueMicrotask(() => {
      operations.delete(operationId);
      request.onsuccess?.();
      this.transaction.oncomplete?.();
    });
    return request;
  }

  constructor(private readonly transaction: FakeTransaction) {}
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  objectStore() {
    return new FakeStore(this);
  }
}

class FakeDatabase {
  objectStoreNames = { contains: (name: string) => storeNames.has(name) };
  onversionchange: (() => void) | null = null;

  createObjectStore(name: string) {
    storeNames.add(name);
    return new FakeStore(new FakeTransaction());
  }

  objectStore() {
    return new FakeStore(new FakeTransaction());
  }

  transaction() {
    return new FakeTransaction();
  }

  close() {}
}

const fakeIndexedDB = {
  open() {
    const request: any = {};
    const database = new FakeDatabase();
    queueMicrotask(() => {
      request.result = database;
      request.transaction = { objectStore: () => database.objectStore() };
      request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  },
};

const member: HouseholdMember = {
  householdId: "household-1",
  userId: "user-1",
  displayName: "Renzo",
  role: "owner",
};

function movement(overrides: Partial<Movement> = {}): Movement {
  return {
    id: "movement-1",
    type: "egreso",
    date: "2026-08-20",
    amount: 100,
    description: "Movimiento",
    method: "transferencia",
    category: "Otros",
    person: "Renzo",
    accountId: "account-1",
    movementContext: "standard",
    ...overrides,
  };
}

beforeEach(() => {
  operations.clear();
  storeNames.clear();
  vi.stubGlobal("indexedDB", fakeIndexedDB);
  vi.stubGlobal("IDBKeyRange", { only: (value: unknown) => value });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("offline outbox movement context", () => {
  it("encola standard y normaliza legacy missing a standard", async () => {
    await enqueueCreateMovement(member, movement());

    const legacyMovement = movement({ id: "movement-legacy" }) as Partial<Movement>;
    delete legacyMovement.movementContext;
    await enqueueCreateMovement(member, legacyMovement as Movement);

    const pending = await listPendingCreateMovements(member);
    expect(pending).toHaveLength(2);
    expect(pending.every((operation) => operation.movement.movementContext === "standard")).toBe(true);
  });

  it("rechaza debt_service antes de persistir una operación", async () => {
    await expect(enqueueCreateMovement(member, movement({ movementContext: "debt_service" }))).rejects.toMatchObject({
      message: "DEBT_SERVICE_OFFLINE_UNSUPPORTED",
    });

    expect(await listPendingCreateMovements(member)).toEqual([]);
  });
});
