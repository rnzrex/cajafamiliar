import type { Debt, MovementContext } from "../types.js";

export const CREDIT_CARD_SPENDING_CURRENCY = "PEN";

export function eligibleCreditCardsForSpending(
  debts: Debt[],
  currencyCode = CREDIT_CARD_SPENDING_CURRENCY
): Debt[] {
  return debts.filter(
    (debt) =>
      debt.debtKind === "credit_card" &&
      debt.status === "active" &&
      !debt.isArchived &&
      debt.currencyCode === currencyCode
  );
}

export function isCreditCardMovementContext(context: MovementContext): boolean {
  return context === "credit_card_purchase" || context === "credit_card_payment" || context === "credit_card_fee" || context === "credit_card_credit";
}
