import type { Debt } from "../types.js";

export interface DeepLinkParseResult {
  view: "pagos" | "deudas" | "dashboard" | null;
  focusedPaymentId: string | null;
  selectedDebtId: string | null;
}

/**
 * Parses query parameters from a notification deep link URL search string.
 * Resolves views ("pagos", "deudas", "dashboard") and checks existence of debtId in debts array.
 */
export function parseNotificationDeepLink(
  searchString: string,
  debts: Debt[] = []
): DeepLinkParseResult {
  const params = new URLSearchParams(searchString);
  const view = params.get("view")?.trim();

  if (view === "pagos") {
    const paymentId = params.get("payment")?.trim() || null;
    return {
      view: "pagos",
      focusedPaymentId: paymentId,
      selectedDebtId: null,
    };
  }

  if (view === "deudas") {
    const debtId = params.get("debt")?.trim() || null;
    const foundDebt = debtId ? debts.find((d) => d.id === debtId) : null;
    return {
      view: "deudas",
      focusedPaymentId: null,
      selectedDebtId: foundDebt ? foundDebt.id : null,
    };
  }

  if (view === "dashboard") {
    return {
      view: "dashboard",
      focusedPaymentId: null,
      selectedDebtId: null,
    };
  }

  return {
    view: null,
    focusedPaymentId: null,
    selectedDebtId: null,
  };
}
