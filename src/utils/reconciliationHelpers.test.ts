import { describe, expect, it } from "vitest";
import type { AccountReconciliation, AccountReconciliationMovement, CreditCardEntry, FinancialAccount, Movement } from "../types.js";
import {
  getLatestMatchedReconciliation,
  getUnreconciledMovements,
  isMovementCertifiedMatched,
  isReconciliationStale,
  movementBelongsToAccount,
} from "./reconciliationHelpers.js";
import { expectedCash } from "./calculations.js";
import { expectedAccountBalance } from "./accountHelpers.js";

const sampleAccount: FinancialAccount = {
  id: "acc-1",
  name: "Cuenta BCP",
  reconciliationType: "balance",
  openingBalance: 1000,
  currencyCode: "PEN",
  isActive: true,
  sortOrder: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const sampleCashAccount: FinancialAccount = {
  id: "acc-cash",
  name: "Caja Principal",
  reconciliationType: "cash",
  openingBalance: 500,
  currencyCode: "PEN",
  isActive: true,
  sortOrder: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const sampleUsdAccount: FinancialAccount = {
  id: "acc-usd",
  name: "Cuenta Dólares",
  reconciliationType: "balance",
  openingBalance: 200,
  currencyCode: "USD",
  isActive: true,
  sortOrder: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("RECON-1A Reconciliation Foundation Helpers", () => {
  it("CRITICAL RULE: backdated movement registered after reconciliation remains pending", () => {
    const m1: Movement = {
      id: "m1",
      type: "ingreso",
      date: "2026-08-20",
      amount: 100,
      description: "M1",
      method: "transferencia",
      category: "Otros",
      person: "Mama",
      accountId: "acc-1",
      movementContext: "standard",
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z",
    };

    const recToday: AccountReconciliation = {
      id: "rec-1",
      householdId: "h-1",
      accountId: "acc-1",
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
        reconciliationId: "rec-1",
        movementId: "m1",
        balanceContribution: 100,
        movementUpdatedAtSnapshot: "2026-08-20T10:00:00.000Z",
        movementSnapshot: m1,
        createdAt: "2026-08-23T12:00:00.000Z",
      },
    ];

    const m2: Movement = {
      id: "m2",
      type: "egreso",
      date: "2026-08-20",
      amount: 40,
      description: "M2 backdated",
      method: "transferencia",
      category: "Mercado",
      person: "Papa",
      accountId: "acc-1",
      movementContext: "standard",
      createdAt: "2026-08-23T13:00:00.000Z",
      updatedAt: "2026-08-23T13:00:00.000Z",
    };

    const allMovements = [m1, m2];

    expect(isMovementCertifiedMatched(m2, [recToday], recMovements)).toBe(false);
    expect(isMovementCertifiedMatched(m1, [recToday], recMovements)).toBe(true);

    const pending = getUnreconciledMovements(sampleAccount, allMovements, recToday, recMovements);
    expect(pending.map((m) => m.id)).toEqual(["m2"]);
  });

  it("valid evidence checking: modified updatedAt or reversed credit-card payment makes movement pending", () => {
    const mUnchanged: Movement = {
      id: "m-unchanged",
      type: "ingreso",
      date: "2026-08-20",
      amount: 100,
      description: "Unchanged",
      method: "transferencia",
      category: "Otros",
      person: "Mama",
      accountId: "acc-1",
      movementContext: "standard",
      updatedAt: "2026-08-20T10:00:00.000Z",
    };

    const mUpdated: Movement = {
      id: "m-updated",
      type: "egreso",
      date: "2026-08-20",
      amount: 50,
      description: "Updated later",
      method: "transferencia",
      category: "Mercado",
      person: "Papa",
      accountId: "acc-1",
      movementContext: "standard",
      updatedAt: "2026-08-23T15:00:00.000Z", // Changed since snapshot!
    };

    const mCardPay: Movement = {
      id: "m-card-pay",
      type: "egreso",
      date: "2026-08-20",
      amount: 200,
      description: "Pago tarjeta",
      method: "tarjeta",
      category: "Compras personales",
      person: "Mama",
      accountId: "acc-1",
      movementContext: "credit_card_payment",
      updatedAt: "2026-08-20T10:00:00.000Z",
    };

    const recMatched: AccountReconciliation = {
      id: "rec-valid-test",
      householdId: "h-1",
      accountId: "acc-1",
      reconciliationType: "balance",
      currencyCode: "PEN",
      openingBalanceSnapshot: 1000,
      expectedBalance: 850,
      actualBalance: 850,
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
        reconciliationId: "rec-valid-test",
        movementId: "m-unchanged",
        balanceContribution: 100,
        movementUpdatedAtSnapshot: "2026-08-20T10:00:00.000Z",
        movementSnapshot: mUnchanged,
        createdAt: "2026-08-23T12:00:00.000Z",
      },
      {
        id: "rm-2",
        householdId: "h-1",
        reconciliationId: "rec-valid-test",
        movementId: "m-updated",
        balanceContribution: -50,
        movementUpdatedAtSnapshot: "2026-08-20T10:00:00.000Z", // Old snapshot timestamp
        movementSnapshot: mUpdated,
        createdAt: "2026-08-23T12:00:00.000Z",
      },
      {
        id: "rm-3",
        householdId: "h-1",
        reconciliationId: "rec-valid-test",
        movementId: "m-card-pay",
        balanceContribution: -200,
        movementUpdatedAtSnapshot: "2026-08-20T10:00:00.000Z",
        movementSnapshot: mCardPay,
        createdAt: "2026-08-23T12:00:00.000Z",
      },
    ];

    const cardEntry: CreditCardEntry = {
      id: "e-pay",
      debtId: "card-debt-1",
      entryDate: "2026-08-20",
      entryType: "payment",
      liabilityDelta: -200,
      movementId: "m-card-pay",
      reversalOfEntryId: null,
      description: "Pago",
      registeredByUserId: "u-1",
      createdAt: "2026-08-20T10:00:00.000Z",
    };

    const reversalEntry: CreditCardEntry = {
      id: "e-rev",
      debtId: "card-debt-1",
      entryDate: "2026-08-23",
      entryType: "reversal",
      liabilityDelta: 0,
      movementId: null,
      reversalOfEntryId: "e-pay",
      description: "Reversion",
      registeredByUserId: "u-1",
      createdAt: "2026-08-23T16:00:00.000Z",
    };

    const cardEntries = [cardEntry, reversalEntry];

    // Unchanged movement: certified and NOT pending
    expect(isMovementCertifiedMatched(mUnchanged, [recMatched], recMovements, cardEntries)).toBe(true);

    // Updated movement: NOT certified and IS pending
    expect(isMovementCertifiedMatched(mUpdated, [recMatched], recMovements, cardEntries)).toBe(false);

    // Reversed card payment movement: NOT certified and IS pending
    expect(isMovementCertifiedMatched(mCardPay, [recMatched], recMovements, cardEntries)).toBe(false);

    const pending = getUnreconciledMovements(
      sampleAccount,
      [mUnchanged, mUpdated, mCardPay],
      recMatched,
      recMovements,
      cardEntries
    );

    expect(pending.map((m) => m.id)).toEqual(["m-updated", "m-card-pay"]);
  });

  it("mismatch status does not certify movements for protection", () => {
    const m1: Movement = {
      id: "m1",
      type: "ingreso",
      date: "2026-08-23",
      amount: 100,
      description: "M1",
      method: "transferencia",
      category: "Otros",
      person: "Mama",
      accountId: "acc-1",
      movementContext: "standard",
    };

    const recMismatch: AccountReconciliation = {
      id: "rec-mismatch",
      householdId: "h-1",
      accountId: "acc-1",
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

    const recMovements: AccountReconciliationMovement[] = [
      {
        id: "rm-1",
        householdId: "h-1",
        reconciliationId: "rec-mismatch",
        movementId: "m1",
        balanceContribution: 100,
        movementUpdatedAtSnapshot: "2026-08-23T10:00:00.000Z",
        movementSnapshot: m1,
        createdAt: "2026-08-23T12:00:00.000Z",
      },
    ];

    expect(isMovementCertifiedMatched(m1, [recMismatch], recMovements)).toBe(false);
    expect(getLatestMatchedReconciliation(sampleAccount, [recMismatch])).toBeNull();
  });

  it("updated movement triggers stale status", () => {
    const m1: Movement = {
      id: "m1",
      type: "ingreso",
      date: "2026-08-23",
      amount: 100,
      description: "M1",
      method: "transferencia",
      category: "Otros",
      person: "Mama",
      accountId: "acc-1",
      movementContext: "standard",
      updatedAt: "2026-08-23T14:00:00.000Z",
    };

    const rec: AccountReconciliation = {
      id: "rec-1",
      householdId: "h-1",
      accountId: "acc-1",
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
        reconciliationId: "rec-1",
        movementId: "m1",
        balanceContribution: 100,
        movementUpdatedAtSnapshot: "2026-08-23T12:00:00.000Z",
        movementSnapshot: m1,
        createdAt: "2026-08-23T12:00:00.000Z",
      },
    ];

    expect(isReconciliationStale(rec, sampleAccount, [m1], recMovements)).toBe(true);
  });

  it("new movement triggers stale status", () => {
    const m1: Movement = {
      id: "m1",
      type: "ingreso",
      date: "2026-08-23",
      amount: 100,
      description: "M1",
      method: "transferencia",
      category: "Otros",
      person: "Mama",
      accountId: "acc-1",
      movementContext: "standard",
      updatedAt: "2026-08-23T12:00:00.000Z",
    };

    const rec: AccountReconciliation = {
      id: "rec-1",
      householdId: "h-1",
      accountId: "acc-1",
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
        reconciliationId: "rec-1",
        movementId: "m1",
        balanceContribution: 100,
        movementUpdatedAtSnapshot: "2026-08-23T12:00:00.000Z",
        movementSnapshot: m1,
        createdAt: "2026-08-23T12:00:00.000Z",
      },
    ];

    const newMovement: Movement = {
      id: "m2",
      type: "egreso",
      date: "2026-08-23",
      amount: 30,
      description: "M2 new",
      method: "transferencia",
      category: "Luz",
      person: "Papa",
      accountId: "acc-1",
      movementContext: "standard",
      updatedAt: "2026-08-23T13:00:00.000Z",
    };

    expect(isReconciliationStale(rec, sampleAccount, [m1, newMovement], recMovements)).toBe(true);
  });

  it("opening balance change triggers stale status", () => {
    const rec: AccountReconciliation = {
      id: "rec-1",
      householdId: "h-1",
      accountId: "acc-1",
      reconciliationType: "balance",
      currencyCode: "PEN",
      openingBalanceSnapshot: 1000,
      expectedBalance: 1000,
      actualBalance: 1000,
      difference: 0,
      status: "matched",
      denominations: null,
      registeredByUserId: "u-1",
      createdAt: "2026-08-23T12:00:00.000Z",
    };

    const modifiedAccount: FinancialAccount = {
      ...sampleAccount,
      openingBalance: 1500,
    };

    expect(isReconciliationStale(rec, modifiedAccount, [], [])).toBe(true);
  });

  it("reversed credit card payment triggers stale status", () => {
    const mCard: Movement = {
      id: "m-card",
      type: "egreso",
      date: "2026-08-23",
      amount: 200,
      description: "Pago tarjeta",
      method: "tarjeta",
      category: "Compras personales",
      person: "Mama",
      accountId: "acc-1",
      movementContext: "credit_card_payment",
      updatedAt: "2026-08-23T10:00:00.000Z",
    };

    const rec: AccountReconciliation = {
      id: "rec-card",
      householdId: "h-1",
      accountId: "acc-1",
      reconciliationType: "balance",
      currencyCode: "PEN",
      openingBalanceSnapshot: 1000,
      expectedBalance: 800,
      actualBalance: 800,
      difference: 0,
      status: "matched",
      denominations: null,
      registeredByUserId: "u-1",
      createdAt: "2026-08-23T12:00:00.000Z",
    };

    const recMovements: AccountReconciliationMovement[] = [
      {
        id: "rm-card",
        householdId: "h-1",
        reconciliationId: "rec-card",
        movementId: "m-card",
        balanceContribution: -200,
        movementUpdatedAtSnapshot: "2026-08-23T10:00:00.000Z",
        movementSnapshot: mCard,
        createdAt: "2026-08-23T12:00:00.000Z",
      },
    ];

    const paymentEntry: CreditCardEntry = {
      id: "entry-pay",
      debtId: "debt-card-1",
      entryDate: "2026-08-23",
      entryType: "payment",
      liabilityDelta: -200,
      movementId: "m-card",
      reversalOfEntryId: null,
      description: "Pago tarjeta",
      registeredByUserId: "u-1",
      createdAt: "2026-08-23T10:00:00.000Z",
    };

    const reversalEntry: CreditCardEntry = {
      id: "entry-rev",
      debtId: "debt-card-1",
      entryDate: "2026-08-23",
      entryType: "reversal",
      liabilityDelta: 0,
      movementId: null,
      reversalOfEntryId: "entry-pay",
      description: "Reversión pago",
      registeredByUserId: "u-1",
      createdAt: "2026-08-23T14:00:00.000Z",
    };

    expect(isReconciliationStale(rec, sampleAccount, [mCard], recMovements, [paymentEntry])).toBe(false);
    expect(
      isReconciliationStale(rec, sampleAccount, [mCard], recMovements, [paymentEntry, reversalEntry])
    ).toBe(true);
  });

  it("cash legacy accountless efectivo movements are preserved in cash account filtering", () => {
    const legacyCashMovement: Movement = {
      id: "m-legacy-cash",
      type: "ingreso",
      date: "2026-08-23",
      amount: 150,
      description: "Venta contado",
      method: "efectivo",
      category: "Negocio",
      person: "Mama",
      accountId: null,
      movementContext: "standard",
    };

    expect(movementBelongsToAccount(legacyCashMovement, sampleCashAccount)).toBe(true);
    expect(movementBelongsToAccount(legacyCashMovement, sampleAccount)).toBe(false);
  });

  it("PEN/USD accounts are isolated and do not mix movements", () => {
    const penMov: Movement = {
      id: "m-pen",
      type: "ingreso",
      date: "2026-08-23",
      amount: 100,
      description: "PEN deposit",
      method: "transferencia",
      category: "Otros",
      person: "Mama",
      accountId: "acc-1",
      movementContext: "standard",
    };

    const usdMov: Movement = {
      id: "m-usd",
      type: "ingreso",
      date: "2026-08-23",
      amount: 50,
      description: "USD deposit",
      method: "transferencia",
      category: "Otros",
      person: "Papa",
      accountId: "acc-usd",
      movementContext: "standard",
    };

    expect(movementBelongsToAccount(penMov, sampleAccount)).toBe(true);
    expect(movementBelongsToAccount(penMov, sampleUsdAccount)).toBe(false);
    expect(movementBelongsToAccount(usdMov, sampleUsdAccount)).toBe(true);
    expect(movementBelongsToAccount(usdMov, sampleAccount)).toBe(false);

    expect(expectedAccountBalance([penMov, usdMov], "acc-1", 1000)).toBe(1100);
    expect(expectedAccountBalance([penMov, usdMov], "acc-usd", 200)).toBe(250);
  });

  it("handles >1000 rows in collections gracefully without array truncation", () => {
    const largeMovements: Movement[] = Array.from({ length: 1500 }, (_, i) => ({
      id: `mov-large-${i}`,
      type: i % 2 === 0 ? "ingreso" : "egreso",
      date: "2026-08-01",
      amount: 10,
      description: `Mov ${i}`,
      method: "transferencia",
      category: "Otros",
      person: "Mama",
      accountId: "acc-1",
      movementContext: "standard",
      createdAt: `2026-08-01T${String(Math.floor(i / 60) % 24).padStart(2, "0")}:00:00.000Z`,
      updatedAt: "2026-08-01T00:00:00.000Z",
    }));

    const rec: AccountReconciliation = {
      id: "rec-large",
      householdId: "h-1",
      accountId: "acc-1",
      reconciliationType: "balance",
      currencyCode: "PEN",
      openingBalanceSnapshot: 1000,
      expectedBalance: 1000,
      actualBalance: 1000,
      difference: 0,
      status: "matched",
      denominations: null,
      registeredByUserId: "u-1",
      createdAt: "2026-08-23T12:00:00.000Z",
    };

    const recMovements: AccountReconciliationMovement[] = largeMovements.map((m) => ({
      id: `rm-${m.id}`,
      householdId: "h-1",
      reconciliationId: "rec-large",
      movementId: m.id,
      balanceContribution: m.type === "ingreso" ? m.amount : -m.amount,
      movementUpdatedAtSnapshot: m.updatedAt!,
      movementSnapshot: m,
      createdAt: "2026-08-23T12:00:00.000Z",
    }));

    expect(recMovements.length).toBe(1500);
    expect(isReconciliationStale(rec, sampleAccount, largeMovements, recMovements)).toBe(false);
    expect(getUnreconciledMovements(sampleAccount, largeMovements, rec, recMovements)).toEqual([]);
  });

  it("preserves CASH balance calculation regression test (1625.10 expected cash balance)", () => {
    const cashMovements: Movement[] = [
      { id: "cm1", type: "ingreso", date: "2026-08-01", amount: 2000, description: "Ingreso 1", method: "efectivo", category: "Negocio", person: "Mama", accountId: null, movementContext: "standard" },
      { id: "cm2", type: "egreso", date: "2026-08-02", amount: 374.90, description: "Gasto 1", method: "efectivo", category: "Mercado", person: "Papa", accountId: null, movementContext: "standard" },
    ];

    const cash = expectedCash(cashMovements, 0, null);
    expect(Number(cash.toFixed(2))).toBe(1625.10);
  });
});
