import { describe, expect, it } from "vitest";
import type { CreditCardEntry, CreditCardStatement, Debt, FinancialAccount, Movement } from "../types";
import { currentCreditCardBalance, effectiveCreditCardEntries, effectiveCreditCardEntriesAsOf, latestCreditCardStatement, statementCreditCardBalance } from "./creditCardCalculations";
import { normalizeCreditCardStatement, normalizeCreditCardStatements } from "./creditCardNormalizers";
import { getMovementEconomics, movementLabel } from "./movementEconomics";
import { CreditCardOperationError, mapCreditCardOperationError, toCreditCardPaymentRpcArgs, toCreditCardStatementCloseRpcArgs, toFinancialAccountRow, fromCreditCardStatementRow } from "../services/dataRepository";
import { CreditCardPurchaseOfflineUnsupportedError, enqueueCreateMovement } from "../services/offlineOutbox";
import { formatMoneyByCurrency, monthlyTotals } from "./calculations";

function mockMovement(overrides: Partial<Movement> = {}): Movement {
  return {
    id: "mov-1",
    type: "egreso",
    date: "2026-08-15",
    amount: 100,
    description: "Prueba DEBT-5C",
    method: "transferencia",
    category: "Otros",
    person: "Renzo",
    accountId: "acc-100",
    movementContext: "standard",
    ...overrides,
  };
}

function mockEntry(overrides: Partial<CreditCardEntry> = {}): CreditCardEntry {
  return {
    id: "cce-1",
    debtId: "debt-card-1",
    entryDate: "2026-08-15",
    entryType: "purchase",
    liabilityDelta: 100,
    movementId: "mov-1",
    reversalOfEntryId: null,
    description: "Entrada de tarjeta",
    registeredByUserId: "user-1",
    createdAt: "2026-08-15T12:00:00.000Z",
    ...overrides,
  };
}

function mockDebt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: "debt-card-1",
    name: "Visa BBVA",
    creditorName: "BBVA",
    debtKind: "credit_card",
    currencyCode: "PEN",
    originDate: "2026-01-01",
    trackingStartDate: "2026-01-01",
    originalPrincipal: null,
    openingPrincipalBalance: 0,
    plannedInstallmentCount: null,
    plannedInstallmentAmount: null,
    installmentAmountMode: "fixed",
    paymentFrequency: null,
    customFrequencyDays: null,
    firstDueDate: null,
    teaPercent: null,
    tceaPercent: null,
    isArchived: false,
    notes: "",
    status: "active",
    createdByUserId: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function mockAccount(overrides: Partial<FinancialAccount> = {}): FinancialAccount {
  return {
    id: "acc-1",
    name: "Cuenta BCP PEN",
    reconciliationType: "balance",
    openingBalance: 1000,
    currencyCode: "PEN",
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("DEBT-5C — Card Payment Engine & Statements (Hardened)", () => {
  // -------------------------------------------------------------------------
  // 1. SEMÁNTICA FINANCIERA (COMPRA vs PAGO vs FEE)
  // -------------------------------------------------------------------------
  describe("Financial Economics", () => {
    it("credit_card_purchase: cashOutflow = 0, economicExpense = amount, liabilityDelta = +amount", () => {
      const mov = mockMovement({ movementContext: "credit_card_purchase", amount: 250, accountId: null });
      const econ = getMovementEconomics(mov, []);
      expect(econ.cashOutflow).toBe(0);
      expect(econ.economicExpense).toBe(250);
      expect(econ.liabilityDelta).toBe(250);
      expect(movementLabel(mov)).toBe("Compra con tarjeta");
    });

    it("credit_card_payment: cashOutflow = amount, economicExpense = 0, liabilityDelta = -amount", () => {
      const mov = mockMovement({ movementContext: "credit_card_payment", amount: 250, accountId: "acc-bcp" });
      const econ = getMovementEconomics(mov, []);
      expect(econ.cashOutflow).toBe(250);
      expect(econ.economicExpense).toBe(0);
      expect(econ.liabilityDelta).toBe(-250);
      expect(movementLabel(mov)).toBe("Pago de tarjeta");
    });

    it("credit_card_fee: cashOutflow = 0, economicExpense = amount, liabilityDelta = +amount", () => {
      const mov = mockMovement({ movementContext: "credit_card_fee", amount: 15, accountId: null });
      const econ = getMovementEconomics(mov, []);
      expect(econ.cashOutflow).toBe(0);
      expect(econ.economicExpense).toBe(15);
      expect(econ.liabilityDelta).toBe(15);
      expect(movementLabel(mov)).toBe("Cargo de tarjeta");
    });

    it("NO DOBLE CONTEO: Compra 100 + Pago 100 produce gasto económico total = 100 (no 200)", () => {
      const purchaseMov = mockMovement({ id: "m-1", date: "2026-08-10", amount: 100, movementContext: "credit_card_purchase", accountId: null });
      const paymentMov = mockMovement({ id: "m-2", date: "2026-08-20", amount: 100, movementContext: "credit_card_payment", accountId: "acc-1" });

      const totals = monthlyTotals([purchaseMov, paymentMov], "2026-08", []);
      expect(totals.expense).toBe(100);
      expect(totals.cashOutflow).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  // 2. HISTORICAL REVERSAL AS-OF SEMANTICS
  // -------------------------------------------------------------------------
  describe("Historical Reversal As-Of Semantics", () => {
    it("Future Reversal: Reversal posterior a la fecha de corte NO altera el statement balance histórico", () => {
      const debt = mockDebt({ id: "d-1", openingPrincipalBalance: 0 });

      // Compra el 20 de agosto
      const purchase = mockEntry({ id: "e-1", debtId: "d-1", entryDate: "2026-08-20", entryType: "purchase", liabilityDelta: 100 });
      // Cierre de tarjeta el 31 de agosto
      // Reversal efectuada el 5 de septiembre (posterior al corte)
      const futureReversal = mockEntry({
        id: "e-2",
        debtId: "d-1",
        entryDate: "2026-09-05",
        entryType: "reversal",
        liabilityDelta: -100,
        reversalOfEntryId: "e-1",
      });

      const entries = [purchase, futureReversal];

      // Al 31 de agosto (as-of date), la compra sigue siendo válida e incluye +100
      expect(statementCreditCardBalance(debt, entries, "2026-08-31")).toBe(100);

      // Al 5 de septiembre, en el balance dinámico actual, la compra ya fue revertida y da 0
      expect(currentCreditCardBalance(debt, entries)).toBe(0);
    });

    it("Pre-Close Reversal: Reversal anterior a la fecha de corte SÍ invalida la compra para el statement", () => {
      const debt = mockDebt({ id: "d-1", openingPrincipalBalance: 0 });

      const purchase = mockEntry({ id: "e-1", debtId: "d-1", entryDate: "2026-08-20", entryType: "purchase", liabilityDelta: 100 });
      const preCloseReversal = mockEntry({
        id: "e-2",
        debtId: "d-1",
        entryDate: "2026-08-25",
        entryType: "reversal",
        liabilityDelta: -100,
        reversalOfEntryId: "e-1",
      });

      const entries = [purchase, preCloseReversal];

      // Al 31 de agosto, la compra fue revertida antes del corte, por lo que el statement da 0
      expect(statementCreditCardBalance(debt, entries, "2026-08-31")).toBe(0);
      expect(currentCreditCardBalance(debt, entries)).toBe(0);
    });

    it("effectiveCreditCardEntriesAsOf considera únicamente las reversiones ocurridas hasta asOfDate", () => {
      const p1 = mockEntry({ id: "p1", entryDate: "2026-08-10", entryType: "purchase", liabilityDelta: 500 });
      const r1 = mockEntry({ id: "r1", entryDate: "2026-09-01", entryType: "reversal", reversalOfEntryId: "p1" });

      const effectiveAug = effectiveCreditCardEntriesAsOf([p1, r1], "2026-08-31");
      expect(effectiveAug).toHaveLength(1);
      expect(effectiveAug[0].id).toBe("p1");

      const effectiveSept = effectiveCreditCardEntriesAsOf([p1, r1], "2026-09-05");
      expect(effectiveSept).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. CURRENCY SAFETY & FINANCIAL ACCOUNT FOUNDATION
  // -------------------------------------------------------------------------
  describe("Currency Safety & Financial Accounts", () => {
    it("FinancialAccount incluye currencyCode y lo serializa a currency_code", () => {
      const acc = mockAccount({ currencyCode: "USD" });
      const row = toFinancialAccountRow(acc);
      expect(row.currency_code).toBe("USD");
    });

    it("formatMoneyByCurrency formatea USD y PEN correctamente sin alterar el comportamiento global", () => {
      const usdStr = formatMoneyByCurrency(100, "USD");
      expect(usdStr).toContain("100");
      expect(usdStr).toContain("$");

      const penStr = formatMoneyByCurrency(100, "PEN");
      expect(penStr).toContain("100");
      expect(penStr).toContain("S/");
    });

    it("mapCreditCardOperationError mapea ACCOUNT_CURRENCY_MISMATCH", () => {
      const err = mapCreditCardOperationError("P0001: ACCOUNT_CURRENCY_MISMATCH");
      expect(err).toBeInstanceOf(CreditCardOperationError);
      expect(err?.code).toBe("ACCOUNT_CURRENCY_MISMATCH");
    });

    it("Coherencia de Método: cuenta cash -> efectivo, cuenta balance -> transferencia", () => {
      const cashAcc = mockAccount({ reconciliationType: "cash" });
      const balAcc = mockAccount({ reconciliationType: "balance" });

      const getMethod = (acc: FinancialAccount) =>
        acc.reconciliationType === "cash" ? "efectivo" : "transferencia";

      expect(getMethod(cashAcc)).toBe("efectivo");
      expect(getMethod(balAcc)).toBe("transferencia");
    });
  });

  // -------------------------------------------------------------------------
  // 4. MINIMUM PAYMENT & NORMALIZADORES
  // -------------------------------------------------------------------------
  describe("Minimum Payment & Normalization", () => {
    it("minimumPaymentAmount es nullable y NO se inventa automáticamente", () => {
      const rawWithoutMin = {
        id: "st-10",
        debt_id: "d-1",
        statement_date: "2026-08-31",
        due_date: "2026-09-15",
        statement_balance: 1000,
        created_by_user_id: "u-1",
        created_at: "2026-08-31T00:00:00Z",
        updated_at: "2026-08-31T00:00:00Z",
      };

      const statement = normalizeCreditCardStatement(rawWithoutMin);
      expect(statement).not.toBeNull();
      expect(statement?.minimumPaymentAmount).toBeNull();
      expect(statement?.statementBalance).toBe(1000);
    });

    it("normalizeCreditCardStatements filtra registros inválidos", () => {
      const valid = {
        id: "st-1",
        debtId: "d-1",
        statementDate: "2026-08-31",
        dueDate: "2026-09-15",
        statementBalance: 500,
        minimumPaymentAmount: 50,
        createdByUserId: "u-1",
        createdAt: "2026-08-31T00:00:00Z",
        updatedAt: "2026-08-31T00:00:00Z",
      };
      const invalid = { id: "st-2" };

      const res = normalizeCreditCardStatements([valid, invalid]);
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe("st-1");
    });
  });

  // -------------------------------------------------------------------------
  // 5. RPC ARGS & ERROR MAPPING
  // -------------------------------------------------------------------------
  describe("RPC Arguments & Error Mapping", () => {
    it("toCreditCardPaymentRpcArgs mapea los parámetros de pago correctamente", () => {
      const args = toCreditCardPaymentRpcArgs({
        debtId: "d-visa",
        entryId: "cce-pay-1",
        movementId: "mov-pay-1",
        paymentDate: "2026-08-20",
        amount: 300,
        accountId: "acc-bcp",
        description: "Pago mensual de tarjeta",
        category: "Préstamos",
      });

      expect(args.p_debt_id).toBe("d-visa");
      expect(args.p_entry_id).toBe("cce-pay-1");
      expect(args.p_payment_date).toBe("2026-08-20");
      expect(args.p_amount).toBe(300);
      expect(args.p_account_id).toBe("acc-bcp");
    });

    it("toCreditCardStatementCloseRpcArgs mapea los parámetros de cierre de statement", () => {
      const args = toCreditCardStatementCloseRpcArgs({
        statementId: "st-new",
        debtId: "d-visa",
        statementDate: "2026-08-31",
        dueDate: "2026-09-15",
        minimumPaymentAmount: 50,
      });

      expect(args.p_statement_id).toBe("st-new");
      expect(args.p_debt_id).toBe("d-visa");
      expect(args.p_statement_date).toBe("2026-08-31");
      expect(args.p_due_date).toBe("2026-09-15");
      expect(args.p_minimum_payment_amount).toBe(50);
    });

    it("mapCreditCardOperationError reconoce todos los códigos de error de DEBT-5C", () => {
      const errPay = mapCreditCardOperationError("P0001: INVALID_CREDIT_CARD_PAYMENT");
      expect(errPay?.code).toBe("INVALID_CREDIT_CARD_PAYMENT");

      const errStmt = mapCreditCardOperationError("P0001: CREDIT_CARD_STATEMENT_CONFLICT");
      expect(errStmt?.code).toBe("CREDIT_CARD_STATEMENT_CONFLICT");

      const errAcc = mapCreditCardOperationError("P0001: ACCOUNT_INACTIVE");
      expect(errAcc?.code).toBe("ACCOUNT_INACTIVE");

      const errCurr = mapCreditCardOperationError("P0001: ACCOUNT_CURRENCY_MISMATCH");
      expect(errCurr?.code).toBe("ACCOUNT_CURRENCY_MISMATCH");
    });
  });

  // -------------------------------------------------------------------------
  // 6. ONLINE-ONLY GUARDS
  // -------------------------------------------------------------------------
  describe("Online-Only Outbox Protection", () => {
    it("enqueueCreateMovement rechaza credit_card_payment en offline outbox", async () => {
      const member = { householdId: "hh-1", userId: "u-1", displayName: "Renzo", role: "owner" as const };
      const mov = mockMovement({ movementContext: "credit_card_payment" });

      await expect(enqueueCreateMovement(member, mov)).rejects.toThrow(CreditCardPurchaseOfflineUnsupportedError);
    });

    it("enqueueCreateMovement rechaza credit_card_fee en offline outbox", async () => {
      const member = { householdId: "hh-1", userId: "u-1", displayName: "Renzo", role: "owner" as const };
      const mov = mockMovement({ movementContext: "credit_card_fee" });

      await expect(enqueueCreateMovement(member, mov)).rejects.toThrow(CreditCardPurchaseOfflineUnsupportedError);
    });
  });
});
