import { describe, expect, it } from "vitest";
import type { DebtEvent, Movement } from "../types";
import { getMovementEconomics } from "./movementEconomics";

function movement(overrides: Partial<Movement> = {}): Movement {
  return {
    id: "m1",
    type: "egreso",
    date: "2026-08-20",
    amount: 1000,
    description: "Pago de deuda",
    method: "transferencia",
    category: "Préstamos",
    person: "Renzo",
    accountId: "account-1",
    movementContext: "debt_service",
    ...overrides,
  };
}

function event(overrides: Partial<DebtEvent> = {}): DebtEvent {
  return {
    id: "event-1",
    debtId: "debt-1",
    eventDate: "2026-08-20",
    eventType: "payment",
    cashAmount: 1000,
    principalDelta: -780,
    interestPaid: 190,
    feesPaid: 0,
    insurancePaid: 30,
    otherCostPaid: 0,
    breakdownComplete: false,
    movementId: "m1",
    reversalOfEventId: null,
    description: "Pago",
    registeredByUserId: "u1",
    createdAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("getMovementEconomics", () => {
  it("mantiene los egresos standard como gasto completo", () => {
    expect(getMovementEconomics(movement({ movementContext: "standard" }), [])).toMatchObject({
      cashOutflow: 1000,
      economicExpense: 1000,
      principalReduction: 0,
      unresolvedDebtServiceOutflow: 0,
    });
  });

  it("separa cash, principal y gasto de un payment debt_service", () => {
    expect(getMovementEconomics(movement(), [event()])).toMatchObject({
      cashOutflow: 1000,
      principalReduction: 780,
      economicExpense: 220,
      knownDetailedCosts: 220,
      unclassifiedDebtCost: 0,
      unresolvedDebtServiceOutflow: 0,
    });
  });

  it("con breakdown incompleto conserva el gasto residual sin inventar componentes", () => {
    expect(getMovementEconomics(movement(), [event({ interestPaid: 0, insurancePaid: 0 })])).toMatchObject({
      economicExpense: 220,
      knownDetailedCosts: 0,
      unclassifiedDebtCost: 220,
    });
  });

  it("marca una inconsistencia si los costos detallados superan el gasto", () => {
    const result = getMovementEconomics(movement(), [event({ interestPaid: 250 })]);
    expect(result.unclassifiedDebtCost).toBe(-60);
    expect(result.inconsistent).toBe(true);
  });

  it("deja el cash como unresolved cuando no hay evento efectivo", () => {
    expect(getMovementEconomics(movement(), [])).toMatchObject({
      cashOutflow: 1000,
      economicExpense: 0,
      principalReduction: 0,
      unresolvedDebtServiceOutflow: 1000,
    });
  });

  it("ignora reversal y vuelve a clasificar con el evento corregido efectivo", () => {
    const original = event({ id: "event-original" });
    const reversal = event({ id: "event-reversal", eventType: "reversal", reversalOfEventId: "event-original", cashAmount: 0, principalDelta: 0, interestPaid: 0, insurancePaid: 0 });
    const corrected = event({ id: "event-corrected", principalDelta: -700, interestPaid: 250, insurancePaid: 50 });

    expect(getMovementEconomics(movement(), [original, reversal])).toMatchObject({
      economicExpense: 0,
      unresolvedDebtServiceOutflow: 1000,
    });
    expect(getMovementEconomics(movement(), [original, reversal, corrected])).toMatchObject({
      economicExpense: 300,
      principalReduction: 700,
      effectiveDebtEventId: "event-corrected",
    });
  });
});
