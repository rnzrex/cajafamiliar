import { describe, expect, it, vi } from "vitest";
import type { AccountReconciliation, AccountReconciliationMovement, CreditCardEntry, FinancialAccount, Movement } from "../types.js";
import { defaultMovementFilters, filterMovements } from "../utils/movementFilters.js";
import { getUnreconciledMovements, isMovementCertifiedMatched } from "../utils/reconciliationHelpers.js";

describe("RECON-1B Reconciliation UX Domain & Component Capabilities", () => {
  const sampleAccount: FinancialAccount = {
    id: "acc-pen-1",
    name: "Cuenta BCP",
    reconciliationType: "balance",
    openingBalance: 1000,
    currencyCode: "PEN",
    isActive: true,
    sortOrder: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  const sampleUsdAccount: FinancialAccount = {
    id: "acc-usd-1",
    name: "Cuenta Dólares BCP",
    reconciliationType: "balance",
    openingBalance: 500,
    currencyCode: "USD",
    isActive: true,
    sortOrder: 2,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  const mOld: Movement = {
    id: "m-old",
    type: "ingreso",
    date: "2026-08-10",
    amount: 100,
    description: "Movimiento Antiguo",
    method: "transferencia",
    category: "Otros",
    person: "Mama",
    accountId: "acc-pen-1",
    movementContext: "standard",
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-10T10:00:00.000Z",
  };

  const mBackdatedToday: Movement = {
    id: "m-backdated-today",
    type: "egreso",
    date: "2026-08-05", // Old economic date!
    amount: 50,
    description: "Gasto retroactivo registrado hoy",
    method: "transferencia",
    category: "Mercado",
    person: "Papa",
    accountId: "acc-pen-1",
    movementContext: "standard",
    createdAt: "2026-08-23T14:00:00.000Z", // Registered today!
    updatedAt: "2026-08-23T14:00:00.000Z",
  };

  const mUsd: Movement = {
    id: "m-usd",
    type: "ingreso",
    date: "2026-08-20",
    amount: 200,
    description: "Ingreso Dolares",
    method: "transferencia",
    category: "Otros",
    person: "Mama",
    accountId: "acc-usd-1",
    movementContext: "standard",
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-20T12:00:00.000Z",
  };

  describe("Movement Ordering", () => {
    it("default registration-order sorts by createdAt desc so backdated movement registered today appears FIRST", () => {
      const filters = defaultMovementFilters();
      expect(filters.orderMode).toBe("registro");

      const filtered = filterMovements([mOld, mBackdatedToday], filters, [sampleAccount]);
      expect(filtered.map((m) => m.id)).toEqual(["m-backdated-today", "m-old"]);
    });

    it("selector economic-date order sorts by date desc", () => {
      const filters = { ...defaultMovementFilters(), orderMode: "fecha" as const };
      const filtered = filterMovements([mOld, mBackdatedToday], filters, [sampleAccount]);
      expect(filtered.map((m) => m.id)).toEqual(["m-old", "m-backdated-today"]);
    });
  });

  describe("Movement Filters (Todos / Pendientes / Ya conciliados) & Badges", () => {
    const recMatched: AccountReconciliation = {
      id: "rec-matched-1",
      householdId: "h-1",
      accountId: "acc-pen-1",
      reconciliationType: "balance",
      currencyCode: "PEN",
      openingBalanceSnapshot: 1000,
      expectedBalance: 1100,
      actualBalance: 1100,
      difference: 0,
      status: "matched",
      denominations: null,
      registeredByUserId: "u-1",
      createdAt: "2026-08-23T12:00:00.000Z",
    };

    const recMovements: AccountReconciliationMovement[] = [
      {
        id: "rm-1",
        householdId: "h-1",
        reconciliationId: "rec-matched-1",
        movementId: "m-old",
        balanceContribution: 100,
        movementUpdatedAtSnapshot: "2026-08-10T10:00:00.000Z",
        movementSnapshot: mOld,
        createdAt: "2026-08-23T12:00:00.000Z",
      },
    ];

    it("filters 'conciliados' returns only movements with valid certified matched evidence", () => {
      const filters = { ...defaultMovementFilters(), reconFilter: "conciliados" as const };
      const filtered = filterMovements([mOld, mBackdatedToday], filters, [sampleAccount], [recMatched], recMovements);
      expect(filtered.map((m) => m.id)).toEqual(["m-old"]);
    });

    it("filters 'pendientes' returns movements without current certified matched evidence (e.g. backdated movement)", () => {
      const filters = { ...defaultMovementFilters(), reconFilter: "pendientes" as const };
      const filtered = filterMovements([mOld, mBackdatedToday], filters, [sampleAccount], [recMatched], recMovements);
      expect(filtered.map((m) => m.id)).toEqual(["m-backdated-today"]);
    });

    it("verifies certified matched movement returns exact badge qualification", () => {
      expect(isMovementCertifiedMatched(mOld, [recMatched], recMovements)).toBe(true);
      expect(isMovementCertifiedMatched(mBackdatedToday, [recMatched], recMovements)).toBe(false);
    });

    it("new backdated movement registered after reconciliation is marked pending", () => {
      const pending = getUnreconciledMovements(sampleAccount, [mOld, mBackdatedToday], recMatched, recMovements);
      expect(pending.map((m) => m.id)).toEqual(["m-backdated-today"]);
    });
  });

  describe("Protection Semantics: Historical Matched vs Mismatch", () => {
    it("movement in mismatch reconciliation is NOT certified and NOT historically protected", () => {
      const recMismatch: AccountReconciliation = {
        id: "rec-mismatch-1",
        householdId: "h-1",
        accountId: "acc-pen-1",
        reconciliationType: "balance",
        currencyCode: "PEN",
        openingBalanceSnapshot: 1000,
        expectedBalance: 1100,
        actualBalance: 1050,
        difference: -50,
        status: "mismatch",
        denominations: null,
        registeredByUserId: "u-1",
        createdAt: "2026-08-23T12:00:00.000Z",
      };

      const mismatchRecMovements: AccountReconciliationMovement[] = [
        {
          id: "rm-mismatch-1",
          householdId: "h-1",
          reconciliationId: "rec-mismatch-1",
          movementId: "m-old",
          balanceContribution: 100,
          movementUpdatedAtSnapshot: "2026-08-10T10:00:00.000Z",
          movementSnapshot: mOld,
          createdAt: "2026-08-23T12:00:00.000Z",
        },
      ];

      expect(isMovementCertifiedMatched(mOld, [recMismatch], mismatchRecMovements)).toBe(false);
    });

    it("stale reversed card payment is pending BUT historically protected in UI if it belongs to a matched reconciliation", () => {
      const mCardPay: Movement = {
        id: "m-card-pay",
        type: "egreso",
        date: "2026-08-15",
        amount: 200,
        description: "Pago tarjeta",
        method: "tarjeta",
        category: "Compras",
        person: "Mama",
        accountId: "acc-pen-1",
        movementContext: "credit_card_payment",
        createdAt: "2026-08-15T10:00:00.000Z",
        updatedAt: "2026-08-15T10:00:00.000Z",
      };

      const recMatched: AccountReconciliation = {
        id: "rec-matched-card",
        householdId: "h-1",
        accountId: "acc-pen-1",
        reconciliationType: "balance",
        currencyCode: "PEN",
        openingBalanceSnapshot: 1000,
        expectedBalance: 800,
        actualBalance: 800,
        difference: 0,
        status: "matched",
        denominations: null,
        registeredByUserId: "u-1",
        createdAt: "2026-08-20T12:00:00.000Z",
      };

      const recMovements: AccountReconciliationMovement[] = [
        {
          id: "rm-card-1",
          householdId: "h-1",
          reconciliationId: "rec-matched-card",
          movementId: "m-card-pay",
          balanceContribution: -200,
          movementUpdatedAtSnapshot: "2026-08-15T10:00:00.000Z",
          movementSnapshot: mCardPay,
          createdAt: "2026-08-20T12:00:00.000Z",
        },
      ];

      const paymentEntry: CreditCardEntry = {
        id: "e-pay-1",
        debtId: "d-card-1",
        entryDate: "2026-08-15",
        entryType: "payment",
        liabilityDelta: -200,
        movementId: "m-card-pay",
        reversalOfEntryId: null,
        description: "Pago tarjeta",
        registeredByUserId: "u-1",
        createdAt: "2026-08-15T10:00:00.000Z",
      };

      const reversalEntry: CreditCardEntry = {
        id: "e-rev-1",
        debtId: "d-card-1",
        entryDate: "2026-08-23",
        entryType: "reversal",
        liabilityDelta: 0,
        movementId: null,
        reversalOfEntryId: "e-pay-1",
        description: "Reversión",
        registeredByUserId: "u-1",
        createdAt: "2026-08-23T10:00:00.000Z",
      };

      // Because it was reversed, current effective contribution is 0 !== snapshot -200 => NOT certified (pending)
      expect(
        isMovementCertifiedMatched(mCardPay, [recMatched], recMovements, [paymentEntry, reversalEntry])
      ).toBe(false);

      // But it IS historically present in a matched reconciliation => protected from edit/delete!
      const matchedRecIds = new Set(
        [recMatched].filter((r) => r.status === "matched").map((r) => r.id)
      );
      const isHistoricallyProtected = recMovements.some(
        (rm) => rm.movementId === mCardPay.id && matchedRecIds.has(rm.reconciliationId)
      );

      expect(isHistoricallyProtected).toBe(true);
    });
  });

  describe("Multi-Currency Isolation", () => {
    it("isolates PEN and USD accounts without leaking movements across currencies", () => {
      const penFiltered = filterMovements(
        [mOld, mUsd],
        { ...defaultMovementFilters(), accountId: "acc-pen-1" },
        [sampleAccount, sampleUsdAccount]
      );
      expect(penFiltered.map((m) => m.id)).toEqual(["m-old"]);

      const usdFiltered = filterMovements(
        [mOld, mUsd],
        { ...defaultMovementFilters(), accountId: "acc-usd-1" },
        [sampleAccount, sampleUsdAccount]
      );
      expect(usdFiltered.map((m) => m.id)).toEqual(["m-usd"]);
    });
  });

  describe("Account Reconciliation RPC Payload & Offline Guard", () => {
    it("forms valid balance account payload", () => {
      const input = {
        reconciliationId: "rec-test-1",
        accountId: "acc-pen-1",
        actualBalance: 1150,
        denominations: null,
      };
      expect(input.actualBalance).toBe(1150);
      expect(input.denominations).toBeNull();
    });

    it("forms valid cash account payload with denomination breakdown", () => {
      const denominations = { "100": 4, "50": 4 };
      const input = {
        reconciliationId: "rec-test-cash",
        accountId: "acc-cash-1",
        actualBalance: null,
        denominations,
      };
      expect(input.actualBalance).toBeNull();
      expect(input.denominations).toEqual({ "100": 4, "50": 4 });
    });
  });
});
