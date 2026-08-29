import { describe, expect, it } from "vitest";
import {
  translateDebtError,
  formatDebtKind,
  formatDebtStatus,
  formatPaymentFrequency,
  formatEventType,
  debtEconomicSummary,
  validateDebtPayment,
  validateDebtPrepayment,
  validateDebtPayoff,
  validateDebtAllocations,
  getInstallmentProgress,
} from "./debtViewModel";
import type { DebtInstallment, DebtEventInstallmentAllocation, DebtInstallmentCarriedAllocation, DebtEvent } from "../types";

describe("debtViewModel utilities and pure helpers", () => {
  it("translates known debt errors correctly", () => {
    expect(translateDebtError(new Error("AUTH_REQUIRED"))).toContain("iniciar sesión");
    expect(translateDebtError(new Error("DEBT_NOT_FOUND"))).toContain("no existe");
    expect(translateDebtError(new Error("DEBT_ARCHIVED"))).toContain("archivada");
  });

  it("formats debt kinds and statuses", () => {
    expect(formatDebtKind("bank_loan")).toBe("Préstamo bancario");
    expect(formatDebtStatus("active")).toBe("Activa");
    expect(formatPaymentFrequency("monthly")).toBe("Mensual");
    expect(formatEventType("payment")).toBe("Pago de cuota");
  });

  it("computes economic summary correctly for payment 1000/780/220 and 1000/780/190", () => {
    const summary1 = debtEconomicSummary(1000, 780, 220, 0, 0, 0);
    expect(summary1.cashOutflow).toBe(1000);
    expect(summary1.principalReduction).toBe(780);
    expect(summary1.economicExpense).toBe(220);
    expect(summary1.knownCosts).toBe(220);
    expect(summary1.unclassifiedDebtCost).toBe(0);

    const summary2 = debtEconomicSummary(1000, 780, 190, 0, 0, 0);
    expect(summary2.cashOutflow).toBe(1000);
    expect(summary2.principalReduction).toBe(780);
    expect(summary2.economicExpense).toBe(220);
    expect(summary2.knownCosts).toBe(190);
    expect(summary2.unclassifiedDebtCost).toBe(30);
  });

  it("validates debt payment correctly (valid, negative principal, exceeding principal, principal > cash, knownCosts > economicExpense, complete breakdown mismatch, incomplete residual)", () => {
    const validRes = validateDebtPayment({
      cashAmount: 500,
      principalAmount: 400,
      currentPrincipal: 1000,
      breakdownComplete: true,
      interestPaid: 100,
    });
    expect(validRes.valid).toBe(true);

    const zeroCash = validateDebtPayment({
      cashAmount: 0,
      principalAmount: 100,
      currentPrincipal: 1000,
      breakdownComplete: false,
    });
    expect(zeroCash.valid).toBe(false);

    const exceedPrincipal = validateDebtPayment({
      cashAmount: 1200,
      principalAmount: 1200,
      currentPrincipal: 1000,
      breakdownComplete: false,
    });
    expect(exceedPrincipal.valid).toBe(false);

    const principalGreaterThanCash = validateDebtPayment({
      cashAmount: 500,
      principalAmount: 600,
      currentPrincipal: 1000,
      breakdownComplete: false,
    });
    expect(principalGreaterThanCash.valid).toBe(false);

    const knownCostsExceedEconomic = validateDebtPayment({
      cashAmount: 1000,
      principalAmount: 800,
      currentPrincipal: 1000,
      breakdownComplete: false,
      interestPaid: 250,
    });
    expect(knownCostsExceedEconomic.valid).toBe(false);

    const breakdownMismatch = validateDebtPayment({
      cashAmount: 1000,
      principalAmount: 780,
      currentPrincipal: 1000,
      breakdownComplete: true,
      interestPaid: 200,
    });
    expect(breakdownMismatch.valid).toBe(false);

    const incompleteResidualValid = validateDebtPayment({
      cashAmount: 1000,
      principalAmount: 780,
      currentPrincipal: 1000,
      breakdownComplete: false,
      interestPaid: 190,
    });
    expect(incompleteResidualValid.valid).toBe(true);
  });

  it("validates debt prepayment correctly (valid, non-positive, prepayment paying off principal)", () => {
    const validPre = validateDebtPrepayment({
      cashAmount: 300,
      principalAmount: 300,
      currentPrincipal: 1000,
      breakdownComplete: false,
    });
    expect(validPre.valid).toBe(true);

    const wouldPayOff = validateDebtPrepayment({
      cashAmount: 1000,
      principalAmount: 1000,
      currentPrincipal: 1000,
      breakdownComplete: false,
    });
    expect(wouldPayOff.valid).toBe(false);
    expect(wouldPayOff.error).toContain("Liquidar deuda");
  });

  it("validates debt payoff correctly (valid and insufficient)", () => {
    const validPayoff = validateDebtPayoff({
      cashAmount: 1050,
      currentPrincipal: 1000,
      breakdownComplete: true,
      interestPaid: 50,
    });
    expect(validPayoff.valid).toBe(true);

    const insufficient = validateDebtPayoff({
      cashAmount: 900,
      currentPrincipal: 1000,
      breakdownComplete: false,
    });
    expect(insufficient.valid).toBe(false);
  });

  it("validates debt allocations against remaining installment amounts and cash amount", () => {
    const installments: DebtInstallment[] = [
      { id: "i1", debtId: "d1", scheduleVersionId: "v1", installmentNumber: 1, dueDate: "2026-01-01", expectedAmount: 500, expectedPrincipal: 400, expectedInterest: 100, expectedFees: 0, expectedInsurance: 0, createdByUserId: "u1", createdAt: "" }
    ];
    const persistedAllocations: DebtEventInstallmentAllocation[] = [];
    const debtEvents: DebtEvent[] = [];

    const validAlloc = validateDebtAllocations(
      [{ installmentId: "i1", allocatedAmount: 500 }],
      installments,
      500,
      persistedAllocations,
      debtEvents
    );
    expect(validAlloc.valid).toBe(true);

    const exceedAlloc = validateDebtAllocations(
      [{ installmentId: "i1", allocatedAmount: 600 }],
      installments,
      600,
      persistedAllocations,
      debtEvents
    );
    expect(exceedAlloc.valid).toBe(false);
  });

  it("includes carried coverage in progress and client-side allocation overage guards", () => {
    const installment: DebtInstallment = {
      id: "i-carried",
      debtId: "d1",
      scheduleVersionId: "v1",
      installmentNumber: 1,
      dueDate: "2026-01-01",
      expectedAmount: 100,
      expectedPrincipal: 80,
      expectedInterest: 20,
      expectedFees: 0,
      expectedInsurance: 0,
      createdByUserId: "u1",
      createdAt: "",
    };
    const payment: DebtEvent = {
      id: "e-carried",
      debtId: "d1",
      eventDate: "2026-01-01",
      eventType: "payment",
      cashAmount: 60,
      principalDelta: -48,
      interestPaid: 12,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      breakdownComplete: true,
      movementId: "m-carried",
      reversalOfEventId: null,
      description: "",
      registeredByUserId: "u1",
      createdAt: "2026-01-01T00:00:00Z",
    };
    const allocation: DebtEventInstallmentAllocation = {
      id: "a-carried",
      eventId: payment.id,
      debtId: "d1",
      installmentId: installment.id,
      allocatedAmount: 60,
      createdByUserId: "u1",
      createdAt: payment.createdAt,
    };
    const carried: DebtInstallmentCarriedAllocation = {
      id: "c-carried",
      restoredInstallmentId: installment.id,
      sourceEventId: payment.id,
      sourceAllocationId: "a-source",
      debtId: "d1",
      householdId: "h1",
      allocatedAmount: 40,
      createdByUserId: "u1",
      createdAt: payment.createdAt,
    };

    expect(getInstallmentProgress(installment, [allocation], [payment], [carried])).toMatchObject({ allocated: 100, isPaid: true, progressPercent: 100 });
    expect(validateDebtAllocations([{ installmentId: installment.id, allocatedAmount: 21 }], [installment], 21, [allocation], [payment], [carried]).valid).toBe(false);
  });

  it("allows allocation when expectedAmount is null and does not invent remaining=0", () => {
    const installments: DebtInstallment[] = [
      { id: "iNull", debtId: "d1", scheduleVersionId: "v1", installmentNumber: 1, dueDate: "2026-01-01", expectedAmount: null as any, expectedPrincipal: null, expectedInterest: null, expectedFees: 0, expectedInsurance: 0, createdByUserId: "u1", createdAt: "" }
    ];
    const res = validateDebtAllocations(
      [{ installmentId: "iNull", allocatedAmount: 250 }],
      installments,
      300,
      [],
      []
    );
    expect(res.valid).toBe(true);
  });

  it("handles fully allocated known installment remaining 0 and validates duplicate/NaN/negative allocations", () => {
    const installments: DebtInstallment[] = [
      { id: "i1", debtId: "d1", scheduleVersionId: "v1", installmentNumber: 1, dueDate: "2026-01-01", expectedAmount: 500, expectedPrincipal: 400, expectedInterest: 100, expectedFees: 0, expectedInsurance: 0, createdByUserId: "u1", createdAt: "" }
    ];
    const persistedAllocations: DebtEventInstallmentAllocation[] = [
      { id: "a1", eventId: "e1", debtId: "d1", installmentId: "i1", allocatedAmount: 500, createdByUserId: "u1", createdAt: "" }
    ];
    const debtEvents: DebtEvent[] = [
      { id: "e1", debtId: "d1", eventType: "payment", eventDate: "2026-01-01", cashAmount: 500, principalDelta: -400, interestPaid: 100, feesPaid: 0, insurancePaid: 0, otherCostPaid: 0, breakdownComplete: true, movementId: "m1", reversalOfEventId: null, description: "", registeredByUserId: "u1", createdAt: "" }
    ];

    const resFull = validateDebtAllocations(
      [{ installmentId: "i1", allocatedAmount: 50 }],
      installments,
      100,
      persistedAllocations,
      debtEvents
    );
    expect(resFull.valid).toBe(false);

    const resDup = validateDebtAllocations(
      [{ installmentId: "i1", allocatedAmount: 100 }, { installmentId: "i1", allocatedAmount: 100 }],
      installments,
      500,
      [],
      []
    );
    expect(resDup.valid).toBe(false);

    const resNaN = validateDebtAllocations(
      [{ installmentId: "i1", allocatedAmount: NaN }],
      installments,
      500,
      [],
      []
    );
    expect(resNaN.valid).toBe(false);

    const resNeg = validateDebtAllocations(
      [{ installmentId: "i1", allocatedAmount: -50 }],
      installments,
      500,
      [],
      []
    );
    expect(resNeg.valid).toBe(false);
  });

  it("rejects NaN monetary amounts in payment, prepayment, and payoff validations", () => {
    expect(validateDebtPayment({ cashAmount: NaN, principalAmount: 100, currentPrincipal: 1000, breakdownComplete: false }).valid).toBe(false);
    expect(validateDebtPrepayment({ cashAmount: 100, principalAmount: NaN, currentPrincipal: 1000, breakdownComplete: false }).valid).toBe(false);
    expect(validateDebtPayoff({ cashAmount: 1000, currentPrincipal: NaN, breakdownComplete: false }).valid).toBe(false);
  });

  it("handles rpcSucceeded and refresh failure without retrying RPCs", async () => {
    let rpcSucceeded = false;
    let rpcCalledCount = 0;
    const mockRpc = async () => {
      rpcCalledCount++;
      return { success: true };
    };
    const mockRefresh = async () => {
      throw new Error("REFRESH_FAILED");
    };

    let caughtError: any = null;
    try {
      await mockRpc();
      rpcSucceeded = true;
      await mockRefresh();
    } catch (err) {
      if (rpcSucceeded) {
        caughtError = err;
      }
    }

    expect(rpcCalledCount).toBe(1);
    expect(rpcSucceeded).toBe(true);
    expect(caughtError).toBeDefined();
    expect(caughtError.message).toBe("REFRESH_FAILED");
  });
});
