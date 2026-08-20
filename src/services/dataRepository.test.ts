import { describe, expect, it } from "vitest";
import { toCashCountRow, toFinancialAccountRow, toMovementRow } from "./dataRepository";

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
      });
      expect(row.account_id).toBe("acc-bcp-1");
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
      });
      expect(row.account_id).toBeNull();
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
        isActive: true,
        sortOrder: 0,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      });
      expect(row.reconciliation_type).toBe("cash");
      expect(row.opening_balance).toBe(120.5);
      expect(row.is_active).toBe(true);
    });

    it("las cuentas balance usan reconciliation_type balance", () => {
      const row = toFinancialAccountRow({
        id: "acc-banco-1",
        name: "Banco",
        reconciliationType: "balance",
        openingBalance: 0,
        isActive: true,
        sortOrder: 1,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      });
      expect(row.reconciliation_type).toBe("balance");
    });
  });
});