import { describe, expect, it } from "vitest";
import type { Movement, Debt, CreditCardEntry, HouseholdMember } from "../types";
import { getMovementEconomics, movementLabel } from "./movementEconomics";
import { expectedCash, monthlyTotals, topExpenseCategory } from "./calculations";
import { expectedAccountBalance } from "./accountHelpers";
import { enqueueCreateMovement, CreditCardPurchaseOfflineUnsupportedError } from "../services/offlineOutbox";
import { toCreditCardPurchaseRpcArgs, mapCreditCardOperationError, CreditCardOperationError } from "../services/dataRepository";
import { currentCreditCardBalance, effectiveCreditCardEntries } from "./creditCardCalculations";

function mockMovement(overrides: Partial<Movement> = {}): Movement {
  return {
    id: "m-card-1",
    type: "egreso",
    date: "2026-08-22",
    amount: 350,
    description: "Supermercado Wong",
    method: "tarjeta",
    category: "Alimentos",
    person: "Renzo",
    accountId: null,
    movementContext: "credit_card_purchase",
    registeredByUserId: "u1",
    createdAt: "2026-08-22T10:00:00Z",
    ...overrides,
  };
}

function mockDebt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: "d-visa",
    name: "Visa Signature",
    creditorName: "BCP",
    debtKind: "credit_card",
    currencyCode: "PEN",
    originDate: "2026-01-01",
    trackingStartDate: "2026-01-01",
    originalPrincipal: null,
    openingPrincipalBalance: 1000,
    plannedInstallmentCount: null,
    plannedInstallmentAmount: null,
    installmentAmountMode: "unknown",
    paymentFrequency: null,
    customFrequencyDays: null,
    firstDueDate: null,
    teaPercent: 28,
    tceaPercent: 32,
    notes: "",
    status: "active",
    isArchived: false,
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function mockEntry(overrides: Partial<CreditCardEntry> = {}): CreditCardEntry {
  return {
    id: "cce-1",
    debtId: "d-visa",
    entryDate: "2026-08-22",
    entryType: "purchase",
    liabilityDelta: 350,
    movementId: "m-card-1",
    reversalOfEntryId: null,
    description: "Supermercado Wong",
    registeredByUserId: "u1",
    createdAt: "2026-08-22T10:00:00Z",
    ...overrides,
  };
}

describe("DEBT-5B Card Purchase Engine", () => {
  // -------------------------------------------------------------------------
  // 1. ECONOMIA DE MOVIMIENTO
  // -------------------------------------------------------------------------
  describe("Movement Economics for credit_card_purchase", () => {
    it("produce cashOutflow = 0, economicExpense = amount, liabilityDelta = +amount", () => {
      const mov = mockMovement({ amount: 450 });
      const economics = getMovementEconomics(mov, []);

      expect(economics.cashOutflow).toBe(0);
      expect(economics.economicExpense).toBe(450);
      expect(economics.liabilityDelta).toBe(450);
      expect(economics.principalReduction).toBe(0);
      expect(economics.unresolvedDebtServiceOutflow).toBe(0);
      expect(economics.inconsistent).toBe(false);
    });

    it("etiqueta correctamente como Compra con tarjeta", () => {
      const mov = mockMovement();
      expect(movementLabel(mov)).toBe("Compra con tarjeta");
    });
  });

  // -------------------------------------------------------------------------
  // 2. INVARIANTES DE PASIVO Y NO DOBLE CONTEO
  // -------------------------------------------------------------------------
  describe("Liability & Cash Invariants", () => {
    it("la compra aumenta el pasivo de la tarjeta de crédito", () => {
      const debt = mockDebt({ openingPrincipalBalance: 1000 });
      const entry = mockEntry({ liabilityDelta: 350 });
      const balance = currentCreditCardBalance(debt, [entry]);
      expect(balance).toBe(1350);
    });

    it("la compra NO disminuye expectedCash en efectivo", () => {
      const cardMov = mockMovement({ amount: 350 });
      const initialCash = 500;
      expect(expectedCash([cardMov], initialCash)).toBe(500);
    });

    it("la compra NO disminuye el saldo de ninguna cuenta bancaria/líquida", () => {
      const cardMov = mockMovement({ amount: 350, accountId: null });
      const initialAccountBalance = 2000;
      expect(expectedAccountBalance([cardMov], "acc-bcp", initialAccountBalance)).toBe(2000);
    });

    it("la compra suma al gasto mensual pero NO a la salida de caja en monthlyTotals", () => {
      const cardMov = mockMovement({ date: "2026-08-15", amount: 350 });
      const totals = monthlyTotals([cardMov], "2026-08", []);
      expect(totals.cashOutflow).toBe(0);
      expect(totals.expense).toBe(350);
    });

    it("la compra se refleja en la categoría principal de gastos de su mes", () => {
      const cardMov = mockMovement({ date: "2026-08-15", amount: 350, category: "Alimentos" });
      const topCat = topExpenseCategory([cardMov], "2026-08", []);
      expect(topCat).toBe("Alimentos");
    });
  });

  // -------------------------------------------------------------------------
  // 3. ESTRUCTURA Y ARGUMENTOS RPC
  // -------------------------------------------------------------------------
  describe("RPC Arguments & Mapping", () => {
    it("toCreditCardPurchaseRpcArgs mapea los parámetros correctamente", () => {
      const args = toCreditCardPurchaseRpcArgs({
        debtId: "d-visa",
        entryId: "cce-100",
        movementId: "m-100",
        purchaseDate: "2026-08-22",
        amount: 250.5,
        description: "Farmacia",
        category: "Salud",
      });

      expect(args.p_debt_id).toBe("d-visa");
      expect(args.p_entry_id).toBe("cce-100");
      expect(args.p_movement_id).toBe("m-100");
      expect(args.p_purchase_date).toBe("2026-08-22");
      expect(args.p_amount).toBe(250.5);
      expect(args.p_description).toBe("Farmacia");
      expect(args.p_category).toBe("Salud");
    });

    it("mapCreditCardOperationError reconoce códigos de error esperados", () => {
      const err = mapCreditCardOperationError("P0001: CREDIT_CARD_PROFILE_NOT_FOUND");
      expect(err).toBeInstanceOf(CreditCardOperationError);
      expect(err?.code).toBe("CREDIT_CARD_PROFILE_NOT_FOUND");

      const errRpcOnly = mapCreditCardOperationError("P0001: CREDIT_CARD_MOVEMENT_RPC_ONLY");
      expect(errRpcOnly).toBeInstanceOf(CreditCardOperationError);
      expect(errRpcOnly?.code).toBe("CREDIT_CARD_MOVEMENT_RPC_ONLY");
    });
  });

  // -------------------------------------------------------------------------
  // 4. GARANTIA ONLINE-ONLY (BLOQUEO OFFLINE)
  // -------------------------------------------------------------------------
  describe("Online-Only Enforcement", () => {
    it("enqueueCreateMovement rechaza compras con tarjeta con CreditCardPurchaseOfflineUnsupportedError", async () => {
      const member: HouseholdMember = { householdId: "hh1", userId: "u1", displayName: "Renzo", role: "owner" };
      const cardMov = mockMovement();

      await expect(enqueueCreateMovement(member, cardMov)).rejects.toBeInstanceOf(CreditCardPurchaseOfflineUnsupportedError);
    });
  });

  // -------------------------------------------------------------------------
  // 5. REGRESION
  // -------------------------------------------------------------------------
  describe("Regressions Check", () => {
    it("los movimientos standard mantienen su comportamiento original", () => {
      const stdMov: Movement = {
        id: "m-std",
        type: "egreso",
        date: "2026-08-22",
        amount: 100,
        description: "Taxi",
        method: "efectivo",
        category: "Transporte",
        person: "Renzo",
        accountId: "cash-acc",
        movementContext: "standard",
      };

      const economics = getMovementEconomics(stdMov, []);
      expect(economics.cashOutflow).toBe(100);
      expect(economics.economicExpense).toBe(100);
      expect(economics.liabilityDelta).toBe(0);

      const totals = monthlyTotals([stdMov], "2026-08", []);
      expect(totals.cashOutflow).toBe(100);
      expect(totals.expense).toBe(100);
    });
  });
});
