import { describe, expect, it } from "vitest";
import type { AppData, CashCount, Debt, DebtEvent, Movement } from "../types";
import { loadCachedData, loadOfflineAccessRecord, makeUuid, normalizeData, type AppDataSnapshotInput } from "./storage";

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
    movementContext: "standard",
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

function debtSnapshot(overrides: Partial<Debt>): Debt {
  return {
    id: "d1",
    name: "Préstamo BCP",
    creditorName: "BCP",
    debtKind: "bank_loan",
    currencyCode: "PEN",
    originDate: null,
    trackingStartDate: "2026-08-01",
    originalPrincipal: null,
    openingPrincipalBalance: 10000,
    plannedInstallmentCount: null,
    plannedInstallmentAmount: null,
    installmentAmountMode: "fixed",
    paymentFrequency: null,
    customFrequencyDays: null,
    firstDueDate: null,
    teaPercent: null,
    tceaPercent: null,
    notes: "",
    status: "active",
    isArchived: false,
    createdByUserId: "u1",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function loadSnapshotThroughCache(snapshot: AppDataSnapshotInput): AppData | null {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => (key === "caja-familiar-data" ? JSON.stringify(snapshot) : null),
      setItem: () => undefined,
      removeItem: () => undefined,
    },
    configurable: true,
  });
  try {
    return loadCachedData();
  } finally {
    if (originalDescriptor) Object.defineProperty(globalThis, "localStorage", originalDescriptor);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
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

  it("movement legacy sin movementContext produce standard", () => {
    const legacyMovement = movement({}) as Partial<Movement>;
    delete legacyMovement.movementContext;
    const result = normalizeData(snapshot({ movements: [legacyMovement as Movement] }));
    expect(result.movements[0].movementContext).toBe("standard");
  });

  it("movementContext credit_card_credit sobrevive normalizeData sin degradarse a standard", () => {
    const creditMov = movement({ id: "mc1", movementContext: "credit_card_credit" });
    const result = normalizeData(snapshot({ movements: [creditMov] }));
    expect(result.movements[0].movementContext).toBe("credit_card_credit");
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
          { id: "acc-cash-1", name: "Efectivo", reconciliationType: "cash", openingBalance: 120.5, currencyCode: "PEN", isActive: true, sortOrder: 0, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
          { id: "acc-banco-1", name: "Banco", reconciliationType: "balance", openingBalance: 0, currencyCode: "PEN", isActive: true, sortOrder: 1, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
        ],
      })
    );
    expect(result.financialAccounts).toEqual([
      { id: "acc-cash-1", name: "Efectivo", reconciliationType: "cash", openingBalance: 120.5, currencyCode: "PEN", isActive: true, sortOrder: 0, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
      { id: "acc-banco-1", name: "Banco", reconciliationType: "balance", openingBalance: 0, currencyCode: "PEN", isActive: true, sortOrder: 1, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
    ]);
  });
});

describe("normalizeData con deudas (DEBT-1B)", () => {
  it("snapshot legacy sin campos Debt produce seis arreglos vacíos", () => {
    const result = normalizeData(snapshot({}));
    expect(result.debts).toEqual([]);
    expect(result.debtEvents).toEqual([]);
    expect(result.debtScheduleVersions).toEqual([]);
    expect(result.debtInstallments).toEqual([]);
    expect(result.debtEventInstallmentAllocations).toEqual([]);
    expect(result.debtCollaterals).toEqual([]);
  });

  it("conserva y normaliza numeric/null de las deudas del snapshot", () => {
    const result = normalizeData(
      snapshot({
        debts: [
          {
            id: "d1",
            name: "Préstamo BCP",
            creditorName: "BCP",
            debtKind: "bank_loan",
            currencyCode: "PEN",
            originDate: null,
            trackingStartDate: "2026-08-01",
            originalPrincipal: null,
            openingPrincipalBalance: "10000",
            plannedInstallmentCount: 12,
            plannedInstallmentAmount: "950.5",
            installmentAmountMode: "fixed",
            paymentFrequency: null,
            customFrequencyDays: null,
            firstDueDate: "2026-09-01",
            teaPercent: "12.5",
            tceaPercent: null,
            notes: "",
            status: "active",
            isArchived: false,
            createdByUserId: "u1",
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
          } as unknown as Debt,
        ],
        debtEvents: [
          {
            id: "e1",
            debtId: "d1",
            eventDate: "2026-08-10",
            eventType: "payment",
            cashAmount: "800",
            principalDelta: "-800",
            interestPaid: 0,
            feesPaid: 0,
            insurancePaid: 0,
            otherCostPaid: 0,
            breakdownComplete: true,
            movementId: null,
            reversalOfEventId: null,
            description: "Cuota 1",
            registeredByUserId: "u1",
            createdAt: "2026-08-10T00:00:00.000Z",
          } as unknown as DebtEvent,
        ],
      })
    );
    expect(result.debts[0].openingPrincipalBalance).toBe(10000);
    expect(result.debts[0].originalPrincipal).toBeNull();
    expect(result.debts[0].plannedInstallmentAmount).toBe(950.5);
    expect(result.debts[0].teaPercent).toBe(12.5);
    expect(result.debts[0].paymentFrequency).toBeNull();
    expect(result.debtEvents[0].cashAmount).toBe(800);
    expect(result.debtEvents[0].principalDelta).toBe(-800);
    expect(result.debtEvents[0].movementId).toBeNull();
  });
});

describe("isAppDataSnapshot con deudas (DEBT-1B)", () => {
  it("snapshot legacy sin campos Debt sigue siendo válido", () => {
    const result = loadSnapshotThroughCache(snapshot({}));
    expect(result).not.toBeNull();
    expect(result?.debts).toEqual([]);
  });

  it("snapshot legacy sin lineage carried usa una lista vacía y normaliza el lineage nuevo", () => {
    const legacy = normalizeData(snapshot({}));
    expect(legacy.debtInstallmentCarriedAllocations).toEqual([]);

    const result = normalizeData(snapshot({
      debtInstallmentCarriedAllocations: [{
        id: "c1",
        restoredInstallmentId: "i1",
        sourceEventId: "e1",
        sourceAllocationId: "a1",
        debtId: "d1",
        householdId: "h1",
        allocatedAmount: "40" as unknown as number,
        createdByUserId: "u1",
        createdAt: "2026-08-20T00:00:00.000Z",
      }],
    }));
    expect(result.debtInstallmentCarriedAllocations?.[0].allocatedAmount).toBe(40);
  });

  it("rechaza Debt sin currencyCode", () => {
    expect(loadSnapshotThroughCache(snapshot({ debts: [debtSnapshot({})] }))).not.toBeNull();

    const incomplete = debtSnapshot({});
    delete (incomplete as { currencyCode?: unknown }).currencyCode;
    expect(loadSnapshotThroughCache(snapshot({ debts: [incomplete] }))).toBeNull();
  });

  it("rechaza Debt con isArchived no boolean", () => {
    expect(loadSnapshotThroughCache(snapshot({ debts: [debtSnapshot({})] }))).not.toBeNull();
    expect(loadSnapshotThroughCache(snapshot({ debts: [debtSnapshot({ isArchived: "yes" as unknown as boolean })] }))).toBeNull();
  });

  it("rechaza Debt con openingPrincipalBalance null o vacío", () => {
    expect(loadSnapshotThroughCache(snapshot({ debts: [debtSnapshot({ openingPrincipalBalance: null as unknown as number })] }))).toBeNull();
    expect(loadSnapshotThroughCache(snapshot({ debts: [debtSnapshot({ openingPrincipalBalance: "" as unknown as number })] }))).toBeNull();
  });
});

describe("makeUuid", () => {
  it("genera un UUID v4 sin prefijo para cuentas", () => {
    const value = makeUuid();
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(value.startsWith("acc-")).toBe(false);
  });

  it("genera UUIDs distintos en llamadas consecutivas", () => {
    expect(makeUuid()).not.toBe(makeUuid());
  });
});

describe("version de acceso offline", () => {
  it("rechaza el registro de una PWA anterior a la versión 2", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      value: { getItem: () => JSON.stringify({ version: 1, householdId: "h1", userId: "u1", displayName: "Renzo", role: "owner", snapshotReady: true }) },
      configurable: true,
    });
    try {
      expect(loadOfflineAccessRecord()).toBeNull();
    } finally {
      if (originalDescriptor) Object.defineProperty(globalThis, "localStorage", originalDescriptor);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
