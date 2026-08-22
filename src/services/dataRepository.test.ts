import { describe, expect, it, vi } from "vitest";
import { DebtOperationUnavailableError, recordDebtPayment, toCashCountRow, toCreditCardCreditRpcArgs, toCreditCardFeeRpcArgs, toCreditCardReversalRpcArgs, toDebtPayoffRpcArgs, toDebtPaymentRpcArgs, toDebtPrepaymentRpcArgs, toDebtReversalRpcArgs, toFinancialAccountRow, toMovementRow } from "./dataRepository";

vi.mock("./supabaseClient", () => ({
  householdId: "00000000-0000-4000-8000-000000000001",
  isSupabaseConfigured: false,
  supabase: null,
}));

describe("serializers de dataRepository", () => {
  describe("toMovementRow", () => {
    it("mapea account_id cuando el movimiento tiene cuenta asignada", () => {
      const row = toMovementRow({
        id: "mov-1",
        type: "egreso",
        date: "2026-08-15",
        amount: 50,
        description: "Compra",
        method: "efectivo",
        category: "Mercado",
        person: "Renzo",
        accountId: "acc-bcp-1",
        movementContext: "standard",
      });
      expect(row.account_id).toBe("acc-bcp-1");
      expect(row.movement_context).toBe("standard");
      expect(row.household_id).toBeDefined();
    });

    it("mapea account_id null para movimientos históricos sin cuenta", () => {
      const row = toMovementRow({
        id: "mov-2",
        type: "ingreso",
        date: "2026-08-10",
        amount: 100,
        description: "Venta",
        method: "Yape",
        category: "Negocio",
        person: "Renzo",
        accountId: null,
        movementContext: "standard",
      });
      expect(row.account_id).toBeNull();
      expect(row.movement_context).toBe("standard");
    });
  });

  describe("toCashCountRow", () => {
    it("mapea account_id cuando el conteo tiene cuenta asignada", () => {
      const row = toCashCountRow({
        id: "cnt-1",
        createdAt: "2026-08-16T00:00:00.000Z",
        denominations: { 10: 5 },
        total: 50,
        expected: 50,
        difference: 0,
        accountId: "acc-cash-1",
      });
      expect(row.account_id).toBe("acc-cash-1");
    });

    it("mapea account_id null para conteos legacy sin cuenta", () => {
      const row = toCashCountRow({
        id: "cnt-2",
        createdAt: "2026-08-16T00:00:00.000Z",
        denominations: { 10: 5 },
        total: 50,
        expected: 50,
        difference: 0,
        accountId: null,
      });
      expect(row.account_id).toBeNull();
    });
  });

  describe("toFinancialAccountRow", () => {
    it("conserva reconciliation_type y opening_balance", () => {
      const row = toFinancialAccountRow({
        id: "acc-cash-1",
        name: "Efectivo",
        reconciliationType: "cash",
        openingBalance: 120.5,
        currencyCode: "PEN",
        isActive: true,
        sortOrder: 0,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      });
      expect(row.reconciliation_type).toBe("cash");
      expect(row.opening_balance).toBe(120.5);
      expect(row.is_active).toBe(true);
      expect(row.currency_code).toBe("PEN");
    });

    it("las cuentas balance usan reconciliation_type balance", () => {
      const row = toFinancialAccountRow({
        id: "acc-banco-1",
        name: "Banco",
        reconciliationType: "balance",
        openingBalance: 0,
        currencyCode: "PEN",
        isActive: true,
        sortOrder: 1,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      });
      expect(row.reconciliation_type).toBe("balance");
    });
  });

  describe("Debt RPC payloads", () => {
    const payment = {
      debtId: "debt-1",
      eventId: "event-1",
      movementId: "movement-1",
      eventDate: "2026-08-20",
      cashAmount: 100,
      accountId: "account-1",
      description: "Pago",
      category: "Prestamos",
      principalAmount: 80,
      interestPaid: 20,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      breakdownComplete: true,
      allocations: [{ installmentId: "installment-1", allocatedAmount: 100 }],
    };

    it("mapea payment con nombres RPC y allocations snake_case", () => {
      expect(toDebtPaymentRpcArgs(payment)).toMatchObject({
        p_debt_id: "debt-1",
        p_event_id: "event-1",
        p_principal_amount: 80,
        p_allocations: [{ installment_id: "installment-1", allocated_amount: 100 }],
      });
    });

    it("mapea prepayment, payoff y reversal sin agregar campos del contrato equivocado", () => {
      const schedule = [{ installmentNumber: 1, dueDate: "2026-09-20", expectedAmount: 100 }];
      const prepayment = toDebtPrepaymentRpcArgs({ ...payment, scheduleInstallments: schedule, scheduleNotes: null });
      const payoff = toDebtPayoffRpcArgs(payment);
      const reversal = toDebtReversalRpcArgs({ debtId: "debt-1", reversalEventId: "reversal-1", targetEventId: "event-1", eventDate: "2026-08-21", description: "Correction", scheduleInstallments: schedule });

      expect(prepayment).toMatchObject({ p_schedule_installments: [{ installment_number: 1, due_date: "2026-09-20", expected_amount: 100 }] });
      expect(prepayment).not.toHaveProperty("p_allocations");
      expect(payoff).toMatchObject({ p_event_id: "event-1", p_cash_amount: 100 });
      expect(payoff).not.toHaveProperty("p_principal_amount");
      expect(reversal).toMatchObject({ p_reversal_event_id: "reversal-1", p_target_event_id: "event-1" });
    });

    it("no cae a local cuando Supabase no está configurado", async () => {
      await expect(recordDebtPayment(payment)).rejects.toBeInstanceOf(DebtOperationUnavailableError);
    });

    it("mapea toCreditCardFeeRpcArgs y toCreditCardReversalRpcArgs con nombres p_* requeridos por las RPCs", () => {
      const feeRpc = toCreditCardFeeRpcArgs({
        debtId: "d-1",
        entryId: "e-1",
        movementId: "m-1",
        feeDate: "2026-08-22",
        amount: 25,
        description: "Mantenimiento",
        category: "Otros",
      });
      expect(feeRpc).toMatchObject({
        p_debt_id: "d-1",
        p_entry_id: "e-1",
        p_movement_id: "m-1",
        p_fee_date: "2026-08-22",
        p_amount: 25,
        p_description: "Mantenimiento",
        p_category: "Otros",
      });

      const revRpc = toCreditCardReversalRpcArgs({
        debtId: "d-1",
        reversalEntryId: "e-rev-1",
        targetEntryId: "e-1",
        reversalDate: "2026-08-23",
        description: "Extorno de mantenimiento",
      });
      expect(revRpc).toMatchObject({
        p_debt_id: "d-1",
        p_reversal_entry_id: "e-rev-1",
        p_target_entry_id: "e-1",
        p_reversal_date: "2026-08-23",
        p_description: "Extorno de mantenimiento",
      });

      const creditRpc = toCreditCardCreditRpcArgs({
        debtId: "d-1",
        entryId: "e-c1",
        movementId: "m-c1",
        targetEntryId: "e-p1",
        creditDate: "2026-08-25",
        amount: 40,
        description: "Devolución prenda",
      });
      expect(creditRpc).toMatchObject({
        p_debt_id: "d-1",
        p_entry_id: "e-c1",
        p_movement_id: "m-c1",
        p_target_entry_id: "e-p1",
        p_credit_date: "2026-08-25",
        p_amount: 40,
        p_description: "Devolución prenda",
      });
    });
  });
});
