import { describe, expect, it } from "vitest";
import type { Debt, DebtEvent } from "../types";
import { buildDebtPaymentLedger } from "./debtPaymentLedger";
import { currentDebtPrincipal } from "./debtCalculations";

describe("DEBT-6B Debt Payment Ledger Tests", () => {
  const baseDebt: Debt = {
    id: "debt-ledger-1",
    name: "Empeño Laptop Lenovo",
    creditorName: "Casa de Empeño Sol",
    debtKind: "pledge",
    currencyCode: "PEN",
    originDate: "2026-01-01",
    trackingStartDate: "2026-01-01",
    originalPrincipal: 5000,
    openingPrincipalBalance: 5000,
    plannedInstallmentCount: null,
    plannedInstallmentAmount: null,
    installmentAmountMode: "unknown",
    paymentFrequency: null,
    customFrequencyDays: null,
    firstDueDate: null,
    teaPercent: null,
    tceaPercent: null,
    notes: "",
    status: "active",
    isArchived: false,
    createdByUserId: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    repaymentStructure: "open_ended",
    interestCalculationMode: "contract_periodic_rate",
    periodicRatePercent: 4,
    periodicRateBasis: "monthly",
  };

  it("1. calculates running principal balance using negative principalDelta and matches currentDebtPrincipal invariant", () => {
    const events: DebtEvent[] = [
      {
        id: "evt-1",
        debtId: "debt-ledger-1",
        eventDate: "2026-02-01",
        eventType: "payment",
        cashAmount: 450,
        principalDelta: -250, // Real production negative principalDelta
        interestPaid: 200,
        feesPaid: 0,
        insurancePaid: 0,
        otherCostPaid: 0,
        breakdownComplete: true,
        movementId: "mov-1",
        reversalOfEventId: null,
        description: "Pago de cuota 1",
        registeredByUserId: "user-1",
        createdAt: "2026-02-01T10:00:00Z",
      },
      {
        id: "evt-2",
        debtId: "debt-ledger-1",
        eventDate: "2026-03-01",
        eventType: "payment",
        cashAmount: 390,
        principalDelta: -200, // Real production negative principalDelta
        interestPaid: 190,
        feesPaid: 0,
        insurancePaid: 0,
        otherCostPaid: 0,
        breakdownComplete: true,
        movementId: "mov-2",
        reversalOfEventId: null,
        description: "Pago de cuota 2",
        registeredByUserId: "user-1",
        createdAt: "2026-03-01T10:00:00Z",
      },
    ];

    const ledger = buildDebtPaymentLedger(baseDebt, events);

    expect(ledger.items).toHaveLength(2);
    expect(ledger.items[0].principalBalanceAfter).toBe(4750);
    expect(ledger.items[0].principalDelta).toBe(250); // Display positive user reduction
    expect(ledger.items[0].formattedDate).toBe("01/02/2026");
    expect(ledger.items[1].principalBalanceAfter).toBe(4550);
    expect(ledger.items[1].formattedDate).toBe("01/03/2026");

    expect(ledger.summary.openingPrincipal).toBe(5000);
    expect(ledger.summary.currentPrincipal).toBe(4550);
    expect(ledger.summary.totalPrincipalAmortized).toBe(450);
    expect(ledger.summary.pctReduced).toBe(9);
    expect(ledger.summary.totalCashPaid).toBe(840);
    expect(ledger.summary.totalInterestPaid).toBe(390);

    // Invariant requirement check: ledger currentPrincipal MUST equal currentDebtPrincipal(debt, events)
    expect(ledger.summary.currentPrincipal).toBe(currentDebtPrincipal(baseDebt, events));
  });

  it("2. sorts backdated events chronologically by eventDate", () => {
    const events: DebtEvent[] = [
      {
        id: "evt-late-added",
        debtId: "debt-ledger-1",
        eventDate: "2026-03-01",
        eventType: "payment",
        cashAmount: 300,
        principalDelta: -100,
        interestPaid: 200,
        feesPaid: 0,
        insurancePaid: 0,
        otherCostPaid: 0,
        breakdownComplete: true,
        movementId: "mov-late",
        reversalOfEventId: null,
        description: "Pago marzo",
        registeredByUserId: "user-1",
        createdAt: "2026-03-05T10:00:00Z",
      },
      {
        id: "evt-early-added",
        debtId: "debt-ledger-1",
        eventDate: "2026-02-01",
        eventType: "payment",
        cashAmount: 400,
        principalDelta: -200,
        interestPaid: 200,
        feesPaid: 0,
        insurancePaid: 0,
        otherCostPaid: 0,
        breakdownComplete: true,
        movementId: "mov-early",
        reversalOfEventId: null,
        description: "Pago febrero",
        registeredByUserId: "user-1",
        createdAt: "2026-03-06T10:00:00Z",
      },
    ];

    const ledger = buildDebtPaymentLedger(baseDebt, events);

    expect(ledger.items[0].id).toBe("evt-early-added");
    expect(ledger.items[0].principalBalanceAfter).toBe(4800);
    expect(ledger.items[1].id).toBe("evt-late-added");
    expect(ledger.items[1].principalBalanceAfter).toBe(4700);

    expect(ledger.summary.currentPrincipal).toBe(currentDebtPrincipal(baseDebt, events));
  });

  it("3. excludes reversed events from running principal using real reversalOfEventId reversal event", () => {
    const events: DebtEvent[] = [
      {
        id: "evt-target",
        debtId: "debt-ledger-1",
        eventDate: "2026-02-01",
        eventType: "payment",
        cashAmount: 1000,
        principalDelta: -800,
        interestPaid: 200,
        feesPaid: 0,
        insurancePaid: 0,
        otherCostPaid: 0,
        breakdownComplete: true,
        movementId: "mov-target",
        reversalOfEventId: null,
        description: "Pago inicial",
        registeredByUserId: "user-1",
        createdAt: "2026-02-01T10:00:00Z",
      },
      {
        id: "evt-reversal",
        debtId: "debt-ledger-1",
        eventDate: "2026-02-02",
        eventType: "reversal",
        cashAmount: 1000,
        principalDelta: 800,
        interestPaid: 200,
        feesPaid: 0,
        insurancePaid: 0,
        otherCostPaid: 0,
        breakdownComplete: true,
        movementId: "mov-reversal",
        reversalOfEventId: "evt-target", // Points to reversed event ID
        description: "Reversión por error",
        registeredByUserId: "user-1",
        createdAt: "2026-02-02T10:00:00Z",
      },
    ];

    const ledger = buildDebtPaymentLedger(baseDebt, events);

    expect(ledger.summary.currentPrincipal).toBe(5000);
    expect(ledger.summary.totalCashPaid).toBe(0);
    expect(ledger.summary.totalPrincipalAmortized).toBe(0);
    expect(ledger.items.find((i) => i.id === "evt-target")?.isReversed).toBe(true);

    expect(ledger.summary.currentPrincipal).toBe(currentDebtPrincipal(baseDebt, events));
  });
});
