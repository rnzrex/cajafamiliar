import { describe, expect, it } from "vitest";
import type { Debt, DebtEvent } from "../types";
import { buildDebtPaymentLedger } from "./debtPaymentLedger";

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

  it("1. calculates running principal balance and summary stats for sequential payments", () => {
    const events: DebtEvent[] = [
      {
        id: "evt-1",
        debtId: "debt-ledger-1",
        eventDate: "2026-02-01",
        eventType: "payment",
        cashAmount: 450,
        principalDelta: 250,
        interestPaid: 200,
        feesPaid: 0,
        insurancePaid: 0,
        otherCostPaid: 0,
        breakdownComplete: true,
        isReversed: false,
        reversedByEventId: null,
        reversesEventId: null,
        notes: "",
        createdByUserId: "user-1",
        createdAt: "2026-02-01T10:00:00Z",
        updatedAt: "2026-02-01T10:00:00Z",
      },
      {
        id: "evt-2",
        debtId: "debt-ledger-1",
        eventDate: "2026-03-01",
        eventType: "payment",
        cashAmount: 390,
        principalDelta: 200,
        interestPaid: 190,
        feesPaid: 0,
        insurancePaid: 0,
        otherCostPaid: 0,
        breakdownComplete: true,
        isReversed: false,
        reversedByEventId: null,
        reversesEventId: null,
        notes: "",
        createdByUserId: "user-1",
        createdAt: "2026-03-01T10:00:00Z",
        updatedAt: "2026-03-01T10:00:00Z",
      },
    ];

    const ledger = buildDebtPaymentLedger(baseDebt, events);

    expect(ledger.items).toHaveLength(2);
    expect(ledger.items[0].principalBalanceAfter).toBe(4750);
    expect(ledger.items[0].formattedDate).toBe("01/02/2026");
    expect(ledger.items[1].principalBalanceAfter).toBe(4550);
    expect(ledger.items[1].formattedDate).toBe("01/03/2026");

    expect(ledger.summary.openingPrincipal).toBe(5000);
    expect(ledger.summary.currentPrincipal).toBe(4550);
    expect(ledger.summary.totalPrincipalAmortized).toBe(450);
    expect(ledger.summary.pctReduced).toBe(9);
    expect(ledger.summary.totalCashPaid).toBe(840);
    expect(ledger.summary.totalInterestPaid).toBe(390);
  });

  it("2. sorts backdated events chronologically by eventDate", () => {
    const events: DebtEvent[] = [
      {
        id: "evt-late-added",
        debtId: "debt-ledger-1",
        eventDate: "2026-03-01",
        eventType: "payment",
        cashAmount: 300,
        principalDelta: 100,
        interestPaid: 200,
        feesPaid: 0,
        insurancePaid: 0,
        otherCostPaid: 0,
        breakdownComplete: true,
        isReversed: false,
        reversedByEventId: null,
        reversesEventId: null,
        notes: "",
        createdByUserId: "user-1",
        createdAt: "2026-03-05T10:00:00Z",
        updatedAt: "2026-03-05T10:00:00Z",
      },
      {
        id: "evt-early-added",
        debtId: "debt-ledger-1",
        eventDate: "2026-02-01",
        eventType: "payment",
        cashAmount: 400,
        principalDelta: 200,
        interestPaid: 200,
        feesPaid: 0,
        insurancePaid: 0,
        otherCostPaid: 0,
        breakdownComplete: true,
        isReversed: false,
        reversedByEventId: null,
        reversesEventId: null,
        notes: "",
        createdByUserId: "user-1",
        createdAt: "2026-03-06T10:00:00Z", // Added later in real time but has earlier eventDate
        updatedAt: "2026-03-06T10:00:00Z",
      },
    ];

    const ledger = buildDebtPaymentLedger(baseDebt, events);

    expect(ledger.items[0].id).toBe("evt-early-added");
    expect(ledger.items[0].principalBalanceAfter).toBe(4800);
    expect(ledger.items[1].id).toBe("evt-late-added");
    expect(ledger.items[1].principalBalanceAfter).toBe(4700);
  });

  it("3. excludes reversed events from running principal and cash totals", () => {
    const events: DebtEvent[] = [
      {
        id: "evt-reversed",
        debtId: "debt-ledger-1",
        eventDate: "2026-02-01",
        eventType: "payment",
        cashAmount: 1000,
        principalDelta: 800,
        interestPaid: 200,
        feesPaid: 0,
        insurancePaid: 0,
        otherCostPaid: 0,
        breakdownComplete: true,
        isReversed: true,
        reversedByEventId: "evt-reversal",
        reversesEventId: null,
        notes: "",
        createdByUserId: "user-1",
        createdAt: "2026-02-01T10:00:00Z",
        updatedAt: "2026-02-01T10:00:00Z",
      },
    ];

    const ledger = buildDebtPaymentLedger(baseDebt, events);

    expect(ledger.summary.currentPrincipal).toBe(5000);
    expect(ledger.summary.totalCashPaid).toBe(0);
    expect(ledger.summary.totalPrincipalAmortized).toBe(0);
    expect(ledger.items[0].isReversed).toBe(true);
  });
});
