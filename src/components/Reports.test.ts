import { describe, expect, it, vi } from "vitest";
import type { DebtEvent, FinancialAccount, Movement } from "../types";
import { defaultMovementFilters } from "../utils/movementFilters";
import { buildCashEvolution, exportReportFromReports } from "./Reports";

const exportReportExcelMock = vi.hoisted(() => vi.fn());

vi.mock("../utils/excelExport", () => ({ exportReportExcel: exportReportExcelMock }));

function movement(overrides: Partial<Movement>): Movement {
  return {
    id: "m1",
    type: "egreso",
    date: "2026-08-20",
    amount: 100,
    description: "Movimiento",
    method: "Yape",
    category: "Otros",
    person: "Renzo",
    accountId: "cash-1",
    movementContext: "standard",
    ...overrides,
  };
}

describe("buildCashEvolution", () => {
  it("usa accountId una sola vez y no vuelve a exigir method=efectivo", () => {
    const result = buildCashEvolution([movement({})], 1000, "cash-1");
    expect(result).toEqual([
      { date: "Inicio", saldo: 1000 },
      { date: "08-20", saldo: 900 },
    ]);
  });
});

describe("exportReportFromReports", () => {
  it("pasa los DebtEvents reales al export económico", async () => {
    const movements = [movement({ id: "debt-movement", amount: 1000, movementContext: "debt_service", category: "Préstamos" })];
    const debtEvents: DebtEvent[] = [
      {
        id: "debt-event",
        debtId: "debt-1",
        eventDate: "2026-08-20",
        eventType: "payment",
        cashAmount: 1000,
        principalDelta: -780,
        interestPaid: 190,
        feesPaid: 0,
        insurancePaid: 30,
        otherCostPaid: 0,
        breakdownComplete: true,
        movementId: "debt-movement",
        reversalOfEventId: null,
        description: "Pago",
        registeredByUserId: "u1",
        createdAt: "2026-08-20T00:00:00.000Z",
      },
    ];
    const filters = defaultMovementFilters();
    const accounts: FinancialAccount[] = [];

    await exportReportFromReports(movements, filters, accounts, debtEvents);

    expect(exportReportExcelMock).toHaveBeenCalledWith(movements, filters, accounts, debtEvents);
  });
});
