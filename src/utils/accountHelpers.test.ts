import { describe, expect, it } from "vitest";
import type { FinancialAccount, Movement } from "../types";
import { UNASSIGNED_ACCOUNT_ID, accountNameForMovement, expectedAccountBalance, getActiveCashAccount, isDefaultCashAccount, legacyMethodForAccount } from "./accountHelpers";

function account(overrides: Partial<FinancialAccount>): FinancialAccount {
  return {
    id: "acc-1",
    name: "Cuenta",
    reconciliationType: "balance",
    openingBalance: 0,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

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

describe("getActiveCashAccount", () => {
  it("devuelve la primera cuenta cash activa", () => {
    const accounts = [
      account({ id: "a", reconciliationType: "balance" }),
      account({ id: "b", reconciliationType: "cash", name: "Efectivo" }),
    ];
    expect(getActiveCashAccount(accounts)?.id).toBe("b");
  });

  it("devuelve null si no hay cuenta cash activa", () => {
    const accounts = [account({ id: "a", reconciliationType: "balance" })];
    expect(getActiveCashAccount(accounts)).toBeNull();
  });

  it("ignora cuentas cash archivadas", () => {
    const accounts = [account({ id: "a", reconciliationType: "cash", isActive: false })];
    expect(getActiveCashAccount(accounts)).toBeNull();
  });
});

describe("isDefaultCashAccount", () => {
  it("identifica la cuenta Efectivo de tipo cash", () => {
    expect(isDefaultCashAccount(account({ name: "Efectivo", reconciliationType: "cash" }))).toBe(true);
  });

  it("no confunde una cuenta de saldo llamada Efectivo", () => {
    expect(isDefaultCashAccount(account({ name: "Efectivo", reconciliationType: "balance" }))).toBe(false);
  });
});

describe("accountNameForMovement", () => {
  it("devuelve el nombre de la cuenta", () => {
    const accounts = [account({ id: "a", name: "Yape" })];
    expect(accountNameForMovement(movement({ accountId: "a" }), accounts)).toBe("Yape");
  });

  it("devuelve el nombre aunque la cuenta esté archivada", () => {
    const accounts = [account({ id: "a", name: "Yape", isActive: false })];
    expect(accountNameForMovement(movement({ accountId: "a" }), accounts)).toBe("Yape");
  });

  it("marca los movimientos sin cuenta como histórico", () => {
    expect(accountNameForMovement(movement({ accountId: null }), [])).toBe("Sin cuenta (histórico)");
  });

  it("marca como histórico si la cuenta ya no existe", () => {
    expect(accountNameForMovement(movement({ accountId: "desconocida" }), [])).toBe("Sin cuenta (histórico)");
  });
});

describe("legacyMethodForAccount", () => {
  it("mapea cuenta cash a efectivo", () => {
    expect(legacyMethodForAccount(account({ reconciliationType: "cash" }))).toBe("efectivo");
  });

  it("mapea cuenta de saldo a transferencia", () => {
    expect(legacyMethodForAccount(account({ reconciliationType: "balance" }))).toBe("transferencia");
  });

  it("una cuenta nula se trata como efectivo", () => {
    expect(legacyMethodForAccount(null)).toBe("efectivo");
  });
});

describe("expectedAccountBalance", () => {
  it("parte del saldo inicial sin movimientos", () => {
    expect(expectedAccountBalance([], "a", 500)).toBe(500);
  });

  it("suma ingresos y resta egresos solo de la cuenta", () => {
    const movements = [
      movement({ type: "ingreso", amount: 200, accountId: "a" }),
      movement({ type: "egreso", amount: 50, accountId: "a" }),
      movement({ type: "ingreso", amount: 999, accountId: "otra" }),
      movement({ type: "egreso", amount: 999, accountId: null }),
    ];
    expect(expectedAccountBalance(movements, "a", 100)).toBe(250);
  });
});

describe("UNASSIGNED_ACCOUNT_ID", () => {
  it("es el identificador del filtro de movimientos históricos", () => {
    expect(UNASSIGNED_ACCOUNT_ID).toBe("__unassigned__");
  });
});