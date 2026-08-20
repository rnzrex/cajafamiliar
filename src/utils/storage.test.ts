import { describe, expect, it } from "vitest";
import type { CashCount, Movement } from "../types";
import { normalizeData, type AppDataSnapshotInput } from "./storage";

function movement(overrides: Partial<Movement>): Movement {
  return {
    id: "m1",
    type: "egreso",
    date: "2026-08-15",
    amount: 0,
    description: "movimiento",
    method: "efectivo",
    category: "Otros",
    person: "Renzo",
    accountId: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<AppDataSnapshotInput>): AppDataSnapshotInput {
  return {
    movements: [],
    cashCounts: [],
    recurringPayments: [],
    categories: [],
    initialBalance: 0,
    ...overrides,
  };
}

function withoutFinancialAccounts(input: AppDataSnapshotInput): AppDataSnapshotInput {
  const copy = { ...input };
  delete (copy as { financialAccounts?: unknown }).financialAccounts;
  return copy;
}

describe("normalizeData con cuentas financieras", () => {
  it("snapshot legacy sin financialAccounts produce lista vacía", () => {
    const result = normalizeData(withoutFinancialAccounts(snapshot({})));
    expect(result.financialAccounts).toEqual([]);
  });

  it("movement legacy sin accountId produce null", () => {
    const legacyMovement: Movement = movement({}) as Movement;
    delete (legacyMovement as { accountId?: unknown }).accountId;
    const result = normalizeData(snapshot({ movements: [legacyMovement] }));
    expect(result.movements[0].accountId).toBeNull();
  });

  it("cashCount legacy sin accountId produce null", () => {
    const legacyCount: CashCount = {
      id: "c1",
      createdAt: "2026-08-10T00:00:00.000Z",
      denominations: {},
      total: 100,
      expected: 100,
      difference: 0,
      accountId: null,
    };
    delete (legacyCount as { accountId?: unknown }).accountId;
    const result = normalizeData(snapshot({ cashCounts: [legacyCount] }));
    expect(result.cashCounts[0].accountId).toBeNull();
  });

  it("movement con accountId existente se conserva", () => {
    const result = normalizeData(snapshot({ movements: [movement({ accountId: "acc-cash-1" })] }));
    expect(result.movements[0].accountId).toBe("acc-cash-1");
  });

  it("cashCount con accountId existente se conserva", () => {
    const result = normalizeData(
      snapshot({
        cashCounts: [
          {
            id: "c1",
            createdAt: "2026-08-10T00:00:00.000Z",
            denominations: {},
            total: 100,
            expected: 100,
            difference: 0,
            accountId: "acc-cash-1",
          },
        ],
      })
    );
    expect(result.cashCounts[0].accountId).toBe("acc-cash-1");
  });

  it("financialAccounts existentes se conservan correctamente", () => {
    const result = normalizeData(
      snapshot({
        financialAccounts: [
          { id: "acc-cash-1", name: "Efectivo", reconciliationType: "cash", openingBalance: 120.5, isActive: true, sortOrder: 0, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
          { id: "acc-banco-1", name: "Banco", reconciliationType: "balance", openingBalance: 0, isActive: true, sortOrder: 1, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
        ],
      })
    );
    expect(result.financialAccounts).toEqual([
      { id: "acc-cash-1", name: "Efectivo", reconciliationType: "cash", openingBalance: 120.5, isActive: true, sortOrder: 0, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
      { id: "acc-banco-1", name: "Banco", reconciliationType: "balance", openingBalance: 0, isActive: true, sortOrder: 1, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
    ]);
  });
});