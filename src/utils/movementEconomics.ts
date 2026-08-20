import type { DebtEvent, Movement } from "../types.js";
import { effectiveDebtEvents } from "./debtCalculations.js";

export interface MovementEconomics {
  cashOutflow: number;
  economicExpense: number;
  principalReduction: number;
  unresolvedDebtServiceOutflow: number;
  knownDetailedCosts: number;
  unclassifiedDebtCost: number;
  inconsistent: boolean;
  effectiveDebtEventId: string | null;
}

const fundEventTypes = new Set(["payment", "principal_prepayment", "payoff"]);

export function getMovementEconomics(movement: Movement, debtEvents: DebtEvent[]): MovementEconomics {
  const empty: MovementEconomics = {
    cashOutflow: 0,
    economicExpense: 0,
    principalReduction: 0,
    unresolvedDebtServiceOutflow: 0,
    knownDetailedCosts: 0,
    unclassifiedDebtCost: 0,
    inconsistent: false,
    effectiveDebtEventId: null,
  };

  if (movement.type !== "egreso") return empty;

  if (movement.movementContext === "standard") {
    return { ...empty, cashOutflow: movement.amount, economicExpense: movement.amount };
  }

  const effectiveFundEvents = effectiveDebtEvents(debtEvents).filter(
    (event) => event.movementId === movement.id && fundEventTypes.has(event.eventType)
  );

  if (effectiveFundEvents.length !== 1) {
    return {
      ...empty,
      cashOutflow: movement.amount,
      unresolvedDebtServiceOutflow: movement.amount,
      inconsistent: effectiveFundEvents.length > 1,
    };
  }

  const [event] = effectiveFundEvents;
  const economicExpense = event.cashAmount + event.principalDelta;
  const knownDetailedCosts = event.interestPaid + event.feesPaid + event.insurancePaid + event.otherCostPaid;
  const unclassifiedDebtCost = economicExpense - knownDetailedCosts;

  return {
    cashOutflow: movement.amount,
    economicExpense,
    principalReduction: -event.principalDelta,
    unresolvedDebtServiceOutflow: 0,
    knownDetailedCosts,
    unclassifiedDebtCost,
    inconsistent: movement.amount !== event.cashAmount || unclassifiedDebtCost < 0,
    effectiveDebtEventId: event.id,
  };
}

export function movementLabel(movement: Movement) {
  if (movement.type === "ingreso") return "Ingreso";
  return movement.movementContext === "debt_service" ? "Pago de deuda" : "Gasto";
}
