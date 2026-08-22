import type { DebtEvent, Movement } from "../types.js";
import { effectiveDebtFundEvents } from "./debtCalculations.js";

export interface MovementEconomics {
  cashOutflow: number;
  economicExpense: number;
  principalReduction: number;
  liabilityDelta: number;
  unresolvedDebtServiceOutflow: number;
  knownDetailedCosts: number;
  unclassifiedDebtCost: number;
  inconsistent: boolean;
  effectiveDebtEventId: string | null;
}

export function getMovementEconomics(movement: Movement, debtEvents: DebtEvent[]): MovementEconomics {
  const empty: MovementEconomics = {
    cashOutflow: 0,
    economicExpense: 0,
    principalReduction: 0,
    liabilityDelta: 0,
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

  if (movement.movementContext === "credit_card_purchase") {
    return {
      ...empty,
      cashOutflow: 0,
      economicExpense: movement.amount,
      liabilityDelta: movement.amount,
    };
  }

  const effectiveFundEvents = effectiveDebtFundEvents(debtEvents).filter(
    (event) => event.movementId === movement.id
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
    liabilityDelta: 0,
    unresolvedDebtServiceOutflow: 0,
    knownDetailedCosts,
    unclassifiedDebtCost,
    inconsistent: movement.amount !== event.cashAmount || unclassifiedDebtCost < 0,
    effectiveDebtEventId: event.id,
  };
}

export function movementLabel(movement: Movement): string {
  if (movement.movementContext === "debt_service") return "Servicio de deuda";
  if (movement.movementContext === "credit_card_purchase") return "Compra con tarjeta";
  return movement.type === "ingreso" ? "Ingreso" : "Egreso";
}
