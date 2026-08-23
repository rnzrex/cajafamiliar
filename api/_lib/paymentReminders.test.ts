import { describe, expect, it, vi } from "vitest";
import type {
  CreditCardEntry,
  CreditCardProfile,
  CreditCardStatement,
  Debt,
  DebtEvent,
  DebtEventInstallmentAllocation,
  DebtInstallment,
  DebtScheduleVersion,
  RecurringPayment,
} from "../../src/types.js";
import { localDateString } from "../../src/utils/date.js";
import type { DebtInstallmentPlanningItem } from "../../src/utils/debtPlanning.js";
import {
  buildObligationReminderPayload,
  fromCreditCardProfileRow,
  NOTIFICATION_TYPE,
  runPaymentReminderJob,
  selectUrgentDebtInstallmentsForReminder,
} from "./paymentReminders.js";

const mockSendNotification = vi.fn().mockResolvedValue({});
const mockSetVapidDetails = vi.fn();

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: (...args: any[]) => mockSetVapidDetails(...args),
    sendNotification: (...args: any[]) => mockSendNotification(...args),
  },
}));

let mockTables: Record<string, any[]> = {};
let mockInsertDeliveryResult: any = { data: { id: "del-1" }, error: null };

vi.mock("./supabaseAdmin.js", () => ({
  readServerEnvironment: () => ({
    appOrigin: "https://test.cajafamiliar.app",
    vapidSubject: "mailto:admin@test.com",
    vapidPublicKey: "test-pub-key",
    vapidPrivateKey: "test-priv-key",
  }),
  createSupabaseAdmin: () => ({
    from: (table: string) => {
      let filtered = [...(mockTables[table] ?? [])];
      const chain: any = {
        select: () => chain,
        in: (col: string, values: any[]) => {
          filtered = filtered.filter((r) => values.includes(r[col]));
          return chain;
        },
        eq: (col: string, val: any) => {
          filtered = filtered.filter((r) => r[col] === val);
          return chain;
        },
        insert: () => chain,
        maybeSingle: async () => mockInsertDeliveryResult,
        update: () => chain,
        then: (resolve: any) => resolve({ data: filtered, error: null }),
      };
      return chain;
    },
  }),
}));

function debt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: "d1",
    name: "Préstamo BCP",
    creditorName: "BCP",
    debtKind: "bank_loan",
    currencyCode: "PEN",
    originDate: null,
    trackingStartDate: "2026-01-01",
    originalPrincipal: 10000,
    openingPrincipalBalance: 10000,
    plannedInstallmentCount: 12,
    plannedInstallmentAmount: 900,
    installmentAmountMode: "fixed",
    paymentFrequency: "monthly",
    customFrequencyDays: null,
    firstDueDate: "2026-02-01",
    teaPercent: null,
    tceaPercent: null,
    notes: "",
    status: "active",
    isArchived: false,
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function scheduleVersion(overrides: Partial<DebtScheduleVersion> = {}): DebtScheduleVersion {
  return {
    id: "sv1",
    debtId: "d1",
    versionNumber: 1,
    effectiveDate: "2026-01-01",
    reason: "initial",
    triggerEventId: null,
    notes: "",
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function installment(overrides: Partial<DebtInstallment> = {}): DebtInstallment {
  return {
    id: "i1",
    scheduleVersionId: "sv1",
    debtId: "d1",
    installmentNumber: 1,
    dueDate: "2026-08-15",
    expectedAmount: 900,
    expectedPrincipal: 750,
    expectedInterest: 150,
    expectedFees: null,
    expectedInsurance: null,
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function debtEvent(overrides: Partial<DebtEvent> = {}): DebtEvent {
  return {
    id: "e1",
    debtId: "d1",
    eventDate: "2026-08-10",
    eventType: "payment",
    cashAmount: 900,
    principalDelta: -750,
    interestPaid: 150,
    feesPaid: 0,
    insurancePaid: 0,
    otherCostPaid: 0,
    breakdownComplete: true,
    movementId: "m1",
    reversalOfEventId: null,
    description: "Pago cuota",
    registeredByUserId: "u1",
    createdAt: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

function allocation(overrides: Partial<DebtEventInstallmentAllocation> = {}): DebtEventInstallmentAllocation {
  return {
    id: "a1",
    eventId: "e1",
    installmentId: "i1",
    debtId: "d1",
    allocatedAmount: 900,
    createdByUserId: "u1",
    createdAt: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

function recurringPayment(overrides: Partial<RecurringPayment> = {}): RecurringPayment {
  return {
    id: "p1",
    name: "Luz",
    amount: 150,
    amount_mode: "fixed",
    dueDay: 15,
    dueDate: "2026-08-15",
    category: "Servicios",
    status: "pendiente",
    notes: "",
    recurrence_type: "indefinite",
    total_installments: null,
    paid_installments: 0,
    is_active: true,
    last_paid_month: null,
    last_paid_year: null,
    paidAt: null,
    ...overrides,
  };
}

function debtPlanningItem(overrides: Partial<DebtInstallmentPlanningItem> = {}): DebtInstallmentPlanningItem {
  return {
    debtId: "d1",
    debtName: "Préstamo BCP",
    creditorName: "BCP",
    currencyCode: "PEN",
    scheduleVersionId: "sv1",
    installmentId: "i1",
    installmentNumber: 1,
    dueDate: "2026-08-15",
    expectedAmount: 900,
    allocatedAmount: 0,
    remainingAmount: 900,
    amountKnown: true,
    dueStatus: "overdue",
    daysUntilDue: -6,
    dueTone: "red",
    dueLabel: "Vencida hace 6 días",
    isCovered: false,
    ...overrides,
  };
}

describe("DEBT-3C Server Push Notification Contracts & Payload Rules", () => {
  it("0. NOTIFICATION_TYPE is historically stable urgent-payments-v1", () => {
    expect(NOTIFICATION_TYPE).toBe("urgent-payments-v1");
  });

  it("1. recurring-only singular body wording", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [recurringPayment({ id: "p1" })],
      urgentDebtInstallments: [],
      today: "2026-08-21",
    });

    expect(payload.title).toBe("Caja Familiar");
    expect(payload.body).toBe("Tienes 1 pago que requiere atención.");
  });

  it("2. recurring-only plural body wording", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [recurringPayment({ id: "p1" }), recurringPayment({ id: "p2" })],
      urgentDebtInstallments: [],
      today: "2026-08-21",
    });

    expect(payload.body).toBe("Tienes 2 pagos que requieren atención.");
  });

  it("3. Debt-only singular body wording", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [],
      urgentDebtInstallments: [debtPlanningItem({ debtId: "d1" })],
      today: "2026-08-21",
    });

    expect(payload.body).toBe("Tienes 1 cuota de deuda que requiere atención.");
  });

  it("4. Debt-only plural body wording", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [],
      urgentDebtInstallments: [debtPlanningItem({ debtId: "d1" }), debtPlanningItem({ debtId: "d2" })],
      today: "2026-08-21",
    });

    expect(payload.body).toBe("Tienes 2 cuotas de deuda que requieren atención.");
  });

  it("5. mixed body wording (handles singular and plural combinations)", () => {
    const mixed1 = buildObligationReminderPayload({
      urgentRecurringPayments: [recurringPayment({ id: "p1" })],
      urgentDebtInstallments: [debtPlanningItem({ debtId: "d1" })],
      today: "2026-08-21",
    });
    expect(mixed1.body).toBe("Tienes 2 obligaciones que requieren atención: 1 pago y 1 cuota de deuda.");

    const mixed2 = buildObligationReminderPayload({
      urgentRecurringPayments: [recurringPayment({ id: "p1" }), recurringPayment({ id: "p2" })],
      urgentDebtInstallments: [debtPlanningItem({ debtId: "d1" }), debtPlanningItem({ debtId: "d2" }), debtPlanningItem({ debtId: "d3" })],
      today: "2026-08-21",
    });
    expect(mixed2.body).toBe("Tienes 5 obligaciones que requieren atención: 2 pagos y 3 cuotas de deuda.");
  });

  it("6. exactly one recurring => payment deep link", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [recurringPayment({ id: "p-abc" })],
      urgentDebtInstallments: [],
      today: "2026-08-21",
    });

    expect(payload.url).toBe("/?view=pagos&payment=p-abc");
  });

  it("7. exactly one Debt => debt deep link", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [],
      urgentDebtInstallments: [debtPlanningItem({ debtId: "d-bcp" })],
      today: "2026-08-21",
    });

    expect(payload.url).toBe("/?view=deudas&debt=d-bcp");
  });

  it("8. multiple recurring => view=pagos", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [recurringPayment({ id: "p1" }), recurringPayment({ id: "p2" })],
      urgentDebtInstallments: [],
      today: "2026-08-21",
    });

    expect(payload.url).toBe("/?view=pagos");
  });

  it("9. multiple Debt => view=deudas", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [],
      urgentDebtInstallments: [debtPlanningItem({ debtId: "d1" }), debtPlanningItem({ debtId: "d2" })],
      today: "2026-08-21",
    });

    expect(payload.url).toBe("/?view=deudas");
  });

  it("10. mixed => view=dashboard", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [recurringPayment({ id: "p1" })],
      urgentDebtInstallments: [debtPlanningItem({ debtId: "d1" })],
      today: "2026-08-21",
    });

    expect(payload.url).toBe("/?view=dashboard");
  });

  it("11. daily stable tag format", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [recurringPayment()],
      urgentDebtInstallments: [],
      today: "2026-08-21",
    });

    expect(payload.tag).toBe("urgent-payments-2026-08-21");
  });

  it("12. no financial amount included in payload body", () => {
    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [recurringPayment({ amount: 9999.99 })],
      urgentDebtInstallments: [debtPlanningItem({ expectedAmount: 8888.88 })],
      today: "2026-08-21",
    });

    expect(payload.body).not.toContain("9999");
    expect(payload.body).not.toContain("8888");
    expect(payload.body).not.toContain("PEN");
    expect(payload.body).not.toContain("S/");
    expect(payload.body).not.toContain("$");
  });
});

describe("DEBT-3C Direct Debt Urgency Integration via selectUrgentDebtInstallmentsForReminder", () => {
  const today = "2026-08-21";

  it("1. overdue => included", () => {
    const d = debt();
    const sv = scheduleVersion();
    const instOverdue = installment({ id: "i-overdue", dueDate: "2026-08-10" });

    const result = selectUrgentDebtInstallmentsForReminder([d], [], [sv], [instOverdue], [], today);
    expect(result).toHaveLength(1);
    expect(result[0].installmentId).toBe("i-overdue");
    expect(result[0].dueStatus).toBe("overdue");
  });

  it("2. today => included", () => {
    const d = debt();
    const sv = scheduleVersion();
    const instToday = installment({ id: "i-today", dueDate: "2026-08-21" });

    const result = selectUrgentDebtInstallmentsForReminder([d], [], [sv], [instToday], [], today);
    expect(result).toHaveLength(1);
    expect(result[0].installmentId).toBe("i-today");
    expect(result[0].dueStatus).toBe("today");
  });

  it("3. tomorrow => included", () => {
    const d = debt();
    const sv = scheduleVersion();
    const instTomorrow = installment({ id: "i-tomorrow", dueDate: "2026-08-22" });

    const result = selectUrgentDebtInstallmentsForReminder([d], [], [sv], [instTomorrow], [], today);
    expect(result).toHaveLength(1);
    expect(result[0].installmentId).toBe("i-tomorrow");
    expect(result[0].dueStatus).toBe("tomorrow");
  });

  it("4. upcoming <= 7 days => included", () => {
    const d = debt();
    const sv = scheduleVersion();
    const instUpcoming = installment({ id: "i-upcoming", dueDate: "2026-08-25" }); // +4 days

    const result = selectUrgentDebtInstallmentsForReminder([d], [], [sv], [instUpcoming], [], today);
    expect(result).toHaveLength(1);
    expect(result[0].installmentId).toBe("i-upcoming");
    expect(result[0].dueStatus).toBe("upcoming");
  });

  it("5. later > 7 days => excluded", () => {
    const d = debt();
    const sv = scheduleVersion();
    const instLater = installment({ id: "i-later", dueDate: "2026-08-31" }); // +10 days

    const result = selectUrgentDebtInstallmentsForReminder([d], [], [sv], [instLater], [], today);
    expect(result).toHaveLength(0);
  });

  it("6. covered => excluded", () => {
    const d = debt();
    const sv = scheduleVersion();
    const instCovered = installment({ id: "i-covered", dueDate: "2026-08-10", expectedAmount: 500 });
    const ev = debtEvent({ id: "e1" });
    const alloc = allocation({ id: "a1", eventId: "e1", installmentId: "i-covered", allocatedAmount: 500 });

    const result = selectUrgentDebtInstallmentsForReminder([d], [ev], [sv], [instCovered], [alloc], today);
    expect(result).toHaveLength(0);
  });

  it("7. expectedAmount=null + overdue => included with amountKnown=false", () => {
    const d = debt();
    const sv = scheduleVersion();
    const instNullOverdue = installment({ id: "i-null", dueDate: "2026-08-10", expectedAmount: null });

    const result = selectUrgentDebtInstallmentsForReminder([d], [], [sv], [instNullOverdue], [], today);
    expect(result).toHaveLength(1);
    expect(result[0].installmentId).toBe("i-null");
    expect(result[0].amountKnown).toBe(false);
    expect(result[0].remainingAmount).toBeNull();
    expect(result[0].dueStatus).toBe("overdue");
  });

  it("8. effective payment allocation covering installment => excluded", () => {
    const d = debt();
    const sv = scheduleVersion();
    const inst = installment({ id: "i1", dueDate: "2026-08-10", expectedAmount: 1000 });
    const ev = debtEvent({ id: "e1" });
    const alloc = allocation({ id: "a1", eventId: "e1", installmentId: "i1", allocatedAmount: 1000 });

    const result = selectUrgentDebtInstallmentsForReminder([d], [ev], [sv], [inst], [alloc], today);
    expect(result).toHaveLength(0);
  });

  it("9. payment allocation whose payment was reversed => installment becomes urgent again and is included", () => {
    const d = debt();
    const sv = scheduleVersion();
    const inst = installment({ id: "i1", dueDate: "2026-08-10", expectedAmount: 1000 });

    // Payment event + allocation
    const paymentEv = debtEvent({ id: "e1", eventType: "payment" });
    const alloc = allocation({ id: "a1", eventId: "e1", installmentId: "i1", allocatedAmount: 1000 });

    // Reversal event pointing to e1
    const reversalEv = debtEvent({ id: "e2", eventType: "reversal", reversalOfEventId: "e1" });

    const result = selectUrgentDebtInstallmentsForReminder([d], [paymentEv, reversalEv], [sv], [inst], [alloc], today);
    expect(result).toHaveLength(1);
    expect(result[0].installmentId).toBe("i1");
    expect(result[0].isCovered).toBe(false);
    expect(result[0].dueStatus).toBe("overdue");
  });

  it("10. current schedule only => historic schedule version installment excluded", () => {
    const d = debt();
    const svHistoric = scheduleVersion({ id: "sv-v1", versionNumber: 1 });
    const svCurrent = scheduleVersion({ id: "sv-v2", versionNumber: 2 });

    const instHistoric = installment({ id: "i-historic", scheduleVersionId: "sv-v1", dueDate: "2026-08-10" });
    const instCurrent = installment({ id: "i-current", scheduleVersionId: "sv-v2", dueDate: "2026-08-10" });

    const result = selectUrgentDebtInstallmentsForReminder([d], [], [svHistoric, svCurrent], [instHistoric, instCurrent], [], today);
    expect(result).toHaveLength(1);
    expect(result[0].installmentId).toBe("i-current");
    expect(result[0].scheduleVersionId).toBe("sv-v2");
  });

  it("11. single actionable card alert produces currency-aware push copy", () => {
    const cardAlert = {
      debtId: "c1",
      cardName: "Visa Interbank",
      creditorName: "Interbank",
      currencyCode: "USD",
      statementId: "s1",
      statementDate: "2026-08-20",
      dueDate: "2026-09-05",
      statementBalance: 500,
      minimumPaymentAmount: 50,
      minimumPaymentKnown: true,
      daysUntilDue: 1,
      dueStatus: "tomorrow" as const,
      dueLabel: "Vence mañana",
      dueTone: "yellow" as const,
      coverageStatus: "known_unsettled" as const,
      actionable: true,
      statementOutstandingBalance: null,
      dedupeKey: "card-alert-c1-s1",
    };

    const payload = buildObligationReminderPayload({
      urgentRecurringPayments: [],
      urgentDebtInstallments: [],
      urgentCardAlerts: [cardAlert],
      today: "2026-09-04",
    });

    expect(payload.title).toBe("Caja Familiar");
    expect(payload.body).toContain("Visa Interbank");
    expect(payload.body).toContain("Pago mínimo: $50.00");
    expect(payload.url).toBe("/?view=deudas");
  });

  it("12. fromCreditCardProfileRow preserves null for nullable fields without inventing zeros or empty strings", () => {
    const row = {
      debt_id: "card-1",
      credit_limit: null,
      closing_day: null,
      due_day: null,
      last4: null,
      created_by_user_id: "u1",
      created_at: "2026-08-20T00:00:00Z",
      updated_at: "2026-08-20T00:00:00Z",
    };

    const profile = fromCreditCardProfileRow(row);
    expect(profile.creditLimit).toBeNull();
    expect(profile.closingDay).toBeNull();
    expect(profile.dueDay).toBeNull();
    expect(profile.last4).toBeNull();
  });

  it("13. runPaymentReminderJob executes real production job logic for card-only actionable household without real network", async () => {
    const today = localDateString();
    mockSendNotification.mockClear();
    mockTables = {
      push_subscriptions: [
        {
          id: "sub-card-1",
          household_id: "h-card-1",
          user_id: "u1",
          endpoint: "https://push.example.com/sub-card-1",
          p256dh: "p256key",
          auth: "authkey",
          expires_at: null,
          is_active: true,
          app_origin: "https://test.cajafamiliar.app",
        },
      ],
      household_members: [
        {
          household_id: "h-card-1",
          user_id: "u1",
          display_name: "Renzo",
        },
      ],
      recurring_payments: [],
      debts: [
        {
          id: "card-debt-1",
          household_id: "h-card-1",
          name: "Visa Interbank USD",
          creditor_name: "Interbank",
          debt_kind: "credit_card",
          currency_code: "USD",
          origin_date: "2026-01-01",
          tracking_start_date: "2026-01-01",
          opening_principal_balance: 0,
          status: "active",
          is_archived: false,
          created_by_user_id: "u1",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      debt_schedule_versions: [],
      debt_installments: [],
      debt_events: [],
      debt_event_installment_allocations: [],
      credit_card_profiles: [
        {
          debt_id: "card-debt-1",
          household_id: "h-card-1",
          credit_limit: 5000,
          closing_day: 20,
          due_day: 5,
          last4: "4321",
          created_by_user_id: "u1",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      credit_card_entries: [
        {
          id: "entry-card-1",
          debt_id: "card-debt-1",
          household_id: "h-card-1",
          entry_date: "2026-08-15",
          entry_type: "purchase",
          liability_delta: 300,
          description: "Compra Laptop",
          registered_by_user_id: "u1",
          created_at: "2026-08-15T00:00:00Z",
        },
      ],
      credit_card_statements: [
        {
          id: "stmt-card-1",
          debt_id: "card-debt-1",
          household_id: "h-card-1",
          statement_date: "2026-08-20",
          due_date: today,
          statement_balance: 300,
          minimum_payment_amount: 50,
          created_by_user_id: "u1",
          created_at: "2026-08-20T00:00:00Z",
          updated_at: "2026-08-20T00:00:00Z",
        },
      ],
    };

    mockInsertDeliveryResult = { data: { id: "delivery-card-1" }, error: null };

    const summary = await runPaymentReminderJob();

    expect(summary.subscriptions).toBe(1);
    expect(summary.cardUrgent).toBe(1);
    expect(summary.recurringUrgent).toBe(0);
    expect(summary.debtUrgent).toBe(0);
    expect(summary.sent).toBe(1);
    expect(summary.skipped).toBe(0);

    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(mockSendNotification.mock.calls[0][1]);
    expect(sentBody.title).toBe("Caja Familiar");
    expect(sentBody.body).toContain("Visa Interbank USD");
    expect(sentBody.body).toContain("Pago mínimo: $50.00");
  });

  it("14. runPaymentReminderJob skips non-actionable card statement without dispatching push notification", async () => {
    const today = localDateString();
    mockSendNotification.mockClear();
    mockTables = {
      push_subscriptions: [
        {
          id: "sub-card-2",
          household_id: "h-card-2",
          user_id: "u2",
          endpoint: "https://push.example.com/sub-card-2",
          p256dh: "p256key",
          auth: "authkey",
          expires_at: null,
          is_active: true,
          app_origin: "https://test.cajafamiliar.app",
        },
      ],
      household_members: [
        {
          household_id: "h-card-2",
          user_id: "u2",
          display_name: "Renzo",
        },
      ],
      recurring_payments: [],
      debts: [
        {
          id: "card-debt-2",
          household_id: "h-card-2",
          name: "Visa Interbank PEN",
          creditor_name: "Interbank",
          debt_kind: "credit_card",
          currency_code: "PEN",
          origin_date: "2026-01-01",
          tracking_start_date: "2026-01-01",
          opening_principal_balance: 0,
          status: "active",
          is_archived: false,
          created_by_user_id: "u2",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      debt_schedule_versions: [],
      debt_installments: [],
      debt_events: [],
      debt_event_installment_allocations: [],
      credit_card_profiles: [],
      credit_card_entries: [
        {
          id: "entry-pre-close",
          debt_id: "card-debt-2",
          household_id: "h-card-2",
          entry_date: "2026-08-01",
          entry_type: "purchase",
          liability_delta: 500,
          description: "Compra previa",
          registered_by_user_id: "u2",
          created_at: "2026-08-01T00:00:00Z",
        },
        {
          id: "entry-post-reversal",
          debt_id: "card-debt-2",
          household_id: "h-card-2",
          entry_date: "2026-08-25",
          entry_type: "reversal",
          liability_delta: -500,
          reversal_of_entry_id: "entry-pre-close",
          description: "Anulacion post-cierre",
          registered_by_user_id: "u2",
          created_at: "2026-08-25T00:00:00Z",
        },
      ],
      credit_card_statements: [
        {
          id: "stmt-closed",
          debt_id: "card-debt-2",
          household_id: "h-card-2",
          statement_date: "2026-08-20",
          due_date: today,
          statement_balance: 500,
          minimum_payment_amount: 100,
          created_by_user_id: "u2",
          created_at: "2026-08-20T00:00:00Z",
          updated_at: "2026-08-20T00:00:00Z",
        },
      ],
    };

    mockInsertDeliveryResult = { data: { id: "delivery-card-2" }, error: null };

    const summary = await runPaymentReminderJob();

    expect(summary.subscriptions).toBe(1);
    expect(summary.cardUrgent).toBe(0);
    expect(summary.sent).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});
