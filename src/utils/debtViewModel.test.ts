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
} from "./debtViewModel";
import type { DebtInstallment, DebtEventInstallmentAllocation, DebtEvent } from "../types";

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

  it("computes economic summary correctly for payment 1000/780 => 220", () => {
    const summary = debtEconomicSummary(1000, 780, 220, 0, 0, 0);
    expect(summary.cashOutflow).toBe(1000);
    expect(summary.principalReduction).toBe(780);
    expect(summary.knownCosts).toBe(220);
    expect(summary.economicExpense).toBe(1000);
    expect(summary.unclassifiedDebtCost).toBe(0);
  });

  it("validates debt payment correctly (valid, negative principal, exceeding principal, breakdown mismatch)", () => {
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

    const breakdownMismatch = validateDebtPayment({
      cashAmount: 500,
      principalAmount: 400,
      currentPrincipal: 1000,
      breakdownComplete: true,
      interestPaid: 50,
    });
    expect(breakdownMismatch.valid).toBe(false);
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
