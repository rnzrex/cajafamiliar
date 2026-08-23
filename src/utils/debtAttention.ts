import type {
  CreditCardEntry,
  CreditCardProfile,
  CreditCardStatement,
  Debt,
  DebtCollateral,
  DebtEvent,
  DebtInstallment,
  DebtKind,
  DebtScheduleVersion,
} from "../types.js";
import {
  buildCreditCardIntelligenceItem,
  buildCreditCardStatementAlerts,
  currentCreditCardBalance,
} from "./creditCardCalculations.js";
import { currentDebtPrincipal } from "./debtCalculations.js";
import { localDateString } from "./date.js";
import { dueDateStatus } from "./dueDates.js";
import type { DebtIntelligenceItem } from "./debtIntelligence.js";

export type DebtNextActionKind =
  | "pay_overdue_installment"
  | "pay_due_installment"
  | "pay_upcoming_installment"
  | "pay_card_statement_overdue"
  | "pay_card_statement_due"
  | "pay_card_statement_upcoming"
  | "review_card_statement_activity"
  | "review_unknown_minimum"
  | "register_card_statement"
  | "complete_card_profile"
  | "register_schedule"
  | "none";

export type DebtNextActionPriority =
  | "overdue"
  | "due_today"
  | "due_soon"
  | "upcoming"
  | "incomplete"
  | "info";

export interface DebtNextAction {
  debtId: string;
  debtName: string;
  creditorName: string;
  debtKind: DebtKind;
  currencyCode: string;
  kind: DebtNextActionKind;
  priority: DebtNextActionPriority;
  priorityRank: number; // 1 = overdue, 2 = due_today, 3 = due_soon, 4 = upcoming, 5 = incomplete, 6 = info
  title: string;
  detail: string;
  dueDate: string | null;
  resolvedAmount: number | null;
  isAmountUnknown: boolean;
  reason: string | null;
  actionLabel: string;
  badgeLabel: string;
  badgeTone: "red" | "orange" | "amber" | "blue" | "emerald" | "slate";
}

export interface CreditCardProfileCompleteness {
  isComplete: boolean;
  missingFields: ("creditLimit" | "closingDay" | "dueDay")[];
  statusLabel: string;
}

/**
  Evaluates credit card profile completeness.
  Note: last4 is identity metadata and does not alone trigger a financial warning.
 */
export function getCreditCardProfileCompleteness(
  profile?: CreditCardProfile | null
): CreditCardProfileCompleteness {
  if (!profile) {
    return {
      isComplete: false,
      missingFields: ["creditLimit", "closingDay", "dueDay"],
      statusLabel: "Falta registrar datos de la tarjeta",
    };
  }

  const missing: ("creditLimit" | "closingDay" | "dueDay")[] = [];
  if (profile.creditLimit == null) missing.push("creditLimit");
  if (profile.closingDay == null) missing.push("closingDay");
  if (profile.dueDay == null) missing.push("dueDay");

  if (missing.length === 0) {
    return {
      isComplete: true,
      missingFields: [],
      statusLabel: "Datos de tarjeta completos",
    };
  }

  const labels: string[] = [];
  if (missing.includes("creditLimit")) labels.push("límite");
  if (missing.includes("closingDay")) labels.push("día de cierre");
  if (missing.includes("dueDay")) labels.push("día de pago");

  return {
    isComplete: false,
    missingFields: missing,
    statusLabel: `Falta registrar ${labels.join(" y ")}`,
  };
}

export interface BuildDebtNextActionInput {
  debt: Debt;
  intelligenceItem?: DebtIntelligenceItem | null;
  creditCardProfiles?: CreditCardProfile[];
  creditCardEntries?: CreditCardEntry[];
  cardStatements?: CreditCardStatement[];
  allDebts?: Debt[];
  todayKey?: string;
}

export function getDebtNextAction({
  debt,
  intelligenceItem,
  creditCardProfiles = [],
  creditCardEntries = [],
  cardStatements = [],
  allDebts = [debt],
  todayKey = localDateString(),
}: BuildDebtNextActionInput): DebtNextAction {
  const isCard = debt.debtKind === "credit_card";

  // Archived or Paid Off debts
  if (debt.isArchived) {
    return {
      debtId: debt.id,
      debtName: debt.name,
      creditorName: debt.creditorName,
      debtKind: debt.debtKind,
      currencyCode: debt.currencyCode,
      kind: "none",
      priority: "info",
      priorityRank: 6,
      title: "Deuda archivada",
      detail: "Esta obligación se encuentra archivada.",
      dueDate: null,
      resolvedAmount: null,
      isAmountUnknown: false,
      reason: null,
      actionLabel: "Ver detalle",
      badgeLabel: "Archivado",
      badgeTone: "slate",
    };
  }

  if (debt.status === "paid_off") {
    return {
      debtId: debt.id,
      debtName: debt.name,
      creditorName: debt.creditorName,
      debtKind: debt.debtKind,
      currencyCode: debt.currencyCode,
      kind: "none",
      priority: "info",
      priorityRank: 6,
      title: "Deuda liquidada",
      detail: "Esta obligación ha sido cancelada en su totalidad.",
      dueDate: null,
      resolvedAmount: null,
      isAmountUnknown: false,
      reason: null,
      actionLabel: "Ver detalle",
      badgeLabel: "Liquidado",
      badgeTone: "emerald",
    };
  }

  // Active Credit Card
  if (isCard) {
    const profile = creditCardProfiles.find((p) => p.debtId === debt.id) ?? null;
    const completeness = getCreditCardProfileCompleteness(profile);

    const thisCardEntries = creditCardEntries.filter((e) => e.debtId === debt.id);
    const thisCardStatements = cardStatements.filter((s) => s.debtId === debt.id);

    const cardIntel = buildCreditCardIntelligenceItem({
      debt,
      profile,
      entries: thisCardEntries,
      statements: thisCardStatements,
      todayKey,
    });

    if (cardIntel.latestStatement && cardIntel.latestStatement.dueDate) {
      const ds = dueDateStatus(cardIntel.latestStatement.dueDate, todayKey);
      const stm = cardIntel.latestStatement;
      const minPayment = cardIntel.minimumPaymentAmount;

      if (cardIntel.coverageStatus === "unknown_after_settlement_activity") {
        return {
          debtId: debt.id,
          debtName: debt.name,
          creditorName: debt.creditorName,
          debtKind: debt.debtKind,
          currencyCode: debt.currencyCode,
          kind: "review_card_statement_activity",
          priority: "incomplete",
          priorityRank: 5,
          title: "Revisar estado de cuenta",
          detail: "Movimientos posteriores a la fecha de cierre requieren verificar la cobertura actual.",
          dueDate: stm.dueDate,
          resolvedAmount: null,
          isAmountUnknown: true,
          reason: "Movimientos registrados después de la fecha de cierre",
          actionLabel: "Ver detalles",
          badgeLabel: "Revisar estado",
          badgeTone: "amber",
        };
      }

      if (cardIntel.actionable) {
        const isMinUnknown = minPayment == null;
        const targetAmount = minPayment ?? stm.statementBalance;

        if (ds.kind === "overdue") {
          return {
            debtId: debt.id,
            debtName: debt.name,
            creditorName: debt.creditorName,
            debtKind: debt.debtKind,
            currencyCode: debt.currencyCode,
            kind: "pay_card_statement_overdue",
            priority: "overdue",
            priorityRank: 1,
            title: "Pago de tarjeta vencido",
            detail: `Estado al ${stm.statementDate} venció el ${stm.dueDate}`,
            dueDate: stm.dueDate,
            resolvedAmount: targetAmount,
            isAmountUnknown: isMinUnknown,
            reason: isMinUnknown ? "No se conoce el pago mínimo" : null,
            actionLabel: "Registrar pago",
            badgeLabel: "Vencido",
            badgeTone: "red",
          };
        }

        if (ds.kind === "today") {
          return {
            debtId: debt.id,
            debtName: debt.name,
            creditorName: debt.creditorName,
            debtKind: debt.debtKind,
            currencyCode: debt.currencyCode,
            kind: "pay_card_statement_due",
            priority: "due_today",
            priorityRank: 2,
            title: "Pago de tarjeta vence hoy",
            detail: `Estado al ${stm.statementDate} vence hoy (${stm.dueDate})`,
            dueDate: stm.dueDate,
            resolvedAmount: targetAmount,
            isAmountUnknown: isMinUnknown,
            reason: isMinUnknown ? "No se conoce el pago mínimo" : null,
            actionLabel: "Registrar pago",
            badgeLabel: "Vence hoy",
            badgeTone: "orange",
          };
        }

        if (ds.kind === "tomorrow" || (ds.kind === "upcoming" && ds.days <= 7)) {
          return {
            debtId: debt.id,
            debtName: debt.name,
            creditorName: debt.creditorName,
            debtKind: debt.debtKind,
            currencyCode: debt.currencyCode,
            kind: "pay_card_statement_upcoming",
            priority: "due_soon",
            priorityRank: 3,
            title: "Pago de tarjeta vence pronto",
            detail: `Estado al ${stm.statementDate} vence el ${stm.dueDate}`,
            dueDate: stm.dueDate,
            resolvedAmount: targetAmount,
            isAmountUnknown: isMinUnknown,
            reason: isMinUnknown ? "No se conoce el pago mínimo" : null,
            actionLabel: "Registrar pago",
            badgeLabel: "Vence pronto",
            badgeTone: "amber",
          };
        }

        return {
          debtId: debt.id,
          debtName: debt.name,
          creditorName: debt.creditorName,
          debtKind: debt.debtKind,
          currencyCode: debt.currencyCode,
          kind: "pay_card_statement_upcoming",
          priority: "upcoming",
          priorityRank: 4,
          title: "Próximo pago de tarjeta",
          detail: `Estado al ${stm.statementDate} vence el ${stm.dueDate}`,
          dueDate: stm.dueDate,
          resolvedAmount: targetAmount,
          isAmountUnknown: isMinUnknown,
          reason: isMinUnknown ? "No se conoce el pago mínimo" : null,
          actionLabel: "Registrar pago",
          badgeLabel: "Próximo pago",
          badgeTone: "blue",
        };
      }

      if (cardIntel.coverageStatus === "covered" || !cardIntel.actionable) {
        return {
          debtId: debt.id,
          debtName: debt.name,
          creditorName: debt.creditorName,
          debtKind: debt.debtKind,
          currencyCode: debt.currencyCode,
          kind: "none",
          priority: "info",
          priorityRank: 6,
          title: "Tarjeta al día",
          detail: "El estado de cuenta se encuentra al día o cubierto.",
          dueDate: null,
          resolvedAmount: null,
          isAmountUnknown: false,
          reason: null,
          actionLabel: "Ver detalle",
          badgeLabel: "Al día",
          badgeTone: "emerald",
        };
      }
    }

    // Incomplete Profile
    if (!completeness.isComplete) {
      return {
        debtId: debt.id,
        debtName: debt.name,
        creditorName: debt.creditorName,
        debtKind: debt.debtKind,
        currencyCode: debt.currencyCode,
        kind: "complete_card_profile",
        priority: "incomplete",
        priorityRank: 5,
        title: "Ajustar datos de tarjeta",
        detail: completeness.statusLabel,
        dueDate: null,
        resolvedAmount: null,
        isAmountUnknown: false,
        reason: completeness.statusLabel,
        actionLabel: "Ajustar datos",
        badgeLabel: "Datos incompletos",
        badgeTone: "amber",
      };
    }

    return {
      debtId: debt.id,
      debtName: debt.name,
      creditorName: debt.creditorName,
      debtKind: debt.debtKind,
      currencyCode: debt.currencyCode,
      kind: "register_card_statement",
      priority: "info",
      priorityRank: 6,
      title: "Sin estado de cuenta",
      detail: "No hay un estado de cuenta registrado todavía.",
      dueDate: null,
      resolvedAmount: null,
      isAmountUnknown: false,
      reason: "No hay un estado de cuenta registrado",
      actionLabel: "Ver detalle",
      badgeLabel: "Sin estado",
      badgeTone: "slate",
    };
  }

  // Active Amortizing Loan
  const dueStatus = intelligenceItem?.nextInstallmentDueStatus ?? null;
  const dueDate = intelligenceItem?.nextInstallmentDueDate ?? null;
  const remainingAmt = intelligenceItem?.nextInstallmentRemainingAmount ?? null;

  if (dueStatus === "overdue" && dueDate) {
    return {
      debtId: debt.id,
      debtName: debt.name,
      creditorName: debt.creditorName,
      debtKind: debt.debtKind,
      currencyCode: debt.currencyCode,
      kind: "pay_overdue_installment",
      priority: "overdue",
      priorityRank: 1,
      title: "Cuota vencida",
      detail: `La cuota del ${dueDate} se encuentra vencida`,
      dueDate,
      resolvedAmount: remainingAmt,
      isAmountUnknown: remainingAmt == null,
      reason: remainingAmt == null ? "Monto de cuota por confirmar" : null,
      actionLabel: "Registrar pago",
      badgeLabel: "Vencido",
      badgeTone: "red",
    };
  }

  if (dueStatus === "due_today" && dueDate) {
    return {
      debtId: debt.id,
      debtName: debt.name,
      creditorName: debt.creditorName,
      debtKind: debt.debtKind,
      currencyCode: debt.currencyCode,
      kind: "pay_due_installment",
      priority: "due_today",
      priorityRank: 2,
      title: "Cuota vence hoy",
      detail: `La cuota vence hoy (${dueDate})`,
      dueDate,
      resolvedAmount: remainingAmt,
      isAmountUnknown: remainingAmt == null,
      reason: remainingAmt == null ? "Monto de cuota por confirmar" : null,
      actionLabel: "Registrar pago",
      badgeLabel: "Vence hoy",
      badgeTone: "orange",
    };
  }

  if (dueStatus === "due_soon" && dueDate) {
    return {
      debtId: debt.id,
      debtName: debt.name,
      creditorName: debt.creditorName,
      debtKind: debt.debtKind,
      currencyCode: debt.currencyCode,
      kind: "pay_upcoming_installment",
      priority: "due_soon",
      priorityRank: 3,
      title: "Cuota vence pronto",
      detail: `La próxima cuota vence el ${dueDate}`,
      dueDate,
      resolvedAmount: remainingAmt,
      isAmountUnknown: remainingAmt == null,
      reason: remainingAmt == null ? "Monto de cuota por confirmar" : null,
      actionLabel: "Ver cuota",
      badgeLabel: "Vence pronto",
      badgeTone: "amber",
    };
  }

  if (dueStatus === "upcoming" && dueDate) {
    return {
      debtId: debt.id,
      debtName: debt.name,
      creditorName: debt.creditorName,
      debtKind: debt.debtKind,
      currencyCode: debt.currencyCode,
      kind: "pay_upcoming_installment",
      priority: "upcoming",
      priorityRank: 4,
      title: "Próxima cuota",
      detail: `Programada para el ${dueDate}`,
      dueDate,
      resolvedAmount: remainingAmt,
      isAmountUnknown: remainingAmt == null,
      reason: remainingAmt == null ? "Monto de cuota por confirmar" : null,
      actionLabel: "Ver cuota",
      badgeLabel: "Próximo pago",
      badgeTone: "blue",
    };
  }

  if (intelligenceItem?.dataLimitations?.includes("missing_current_schedule")) {
    return {
      debtId: debt.id,
      debtName: debt.name,
      creditorName: debt.creditorName,
      debtKind: debt.debtKind,
      currencyCode: debt.currencyCode,
      kind: "register_schedule",
      priority: "incomplete",
      priorityRank: 5,
      title: "Falta registrar cronograma",
      detail: "No hay un cronograma de cuotas activo para calcular próximos pagos.",
      dueDate: null,
      resolvedAmount: null,
      isAmountUnknown: false,
      reason: "Falta información del cronograma",
      actionLabel: "Ver detalle",
      badgeLabel: "Sin cronograma",
      badgeTone: "amber",
    };
  }

  return {
    debtId: debt.id,
    debtName: debt.name,
    creditorName: debt.creditorName,
    debtKind: debt.debtKind,
    currencyCode: debt.currencyCode,
    kind: "none",
    priority: "info",
    priorityRank: 6,
    title: "Deuda al día",
    detail: "Sin cuotas pendientes inmediatas.",
    dueDate: null,
    resolvedAmount: null,
    isAmountUnknown: false,
    reason: null,
    actionLabel: "Ver detalle",
    badgeLabel: "Al día",
    badgeTone: "emerald",
  };
}

export interface BuildAllNextActionsInput {
  debts: Debt[];
  intelligenceItems?: DebtIntelligenceItem[];
  creditCardProfiles?: CreditCardProfile[];
  creditCardEntries?: CreditCardEntry[];
  cardStatements?: CreditCardStatement[];
  todayKey?: string;
}

export function buildAllDebtNextActions({
  debts,
  intelligenceItems = [],
  creditCardProfiles = [],
  creditCardEntries = [],
  cardStatements = [],
  todayKey = localDateString(),
}: BuildAllNextActionsInput): DebtNextAction[] {
  const intelMap = new Map(intelligenceItems.map((item) => [item.debtId, item]));

  const actions = debts.map((debt) =>
    getDebtNextAction({
      debt,
      intelligenceItem: intelMap.get(debt.id),
      creditCardProfiles,
      creditCardEntries,
      cardStatements,
      allDebts: debts,
      todayKey,
    })
  );

  return sortDebtNextActions(actions);
}

/**
  Sorts DebtNextAction items deterministically:
  1. Priority Rank (1: overdue, 2: due_today, 3: due_soon, 4: upcoming, 5: incomplete, 6: info)
  2. Due Date (earliest first)
  3. Debt Name (alphabetical)
  Note: Never uses raw monetary amounts to rank across currencies!
 */
export function sortDebtNextActions(actions: DebtNextAction[]): DebtNextAction[] {
  return [...actions].sort((a, b) => {
    if (a.priorityRank !== b.priorityRank) {
      return a.priorityRank - b.priorityRank;
    }
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate);
    }
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return a.debtName.localeCompare(b.debtName);
  });
}

/**
  Filters urgent/actionable attention items:
  priority in ["overdue", "due_today", "due_soon", "incomplete"]
 */
export function getUrgentDebtAttentionItems(actions: DebtNextAction[]): DebtNextAction[] {
  return actions.filter(
    (action) =>
      action.priority === "overdue" ||
      action.priority === "due_today" ||
      action.priority === "due_soon" ||
      action.priority === "incomplete"
  );
}
