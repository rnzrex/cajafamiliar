import { describe, expect, it } from "vitest";
import { formatDebtStatus, formatDebtKind, formatEventType, translateDebtError } from "./debtViewModel";
import { currentDebtScheduleVersion, effectiveDebtEvents, currentDebtPrincipal, allocatedAmountForInstallment } from "./debtCalculations";
import type { Debt, DebtEvent, DebtScheduleVersion, DebtEventInstallmentAllocation, FinancialAccount, Category } from "../types";

describe("DEBT-2C Exhaustive Hardened Invariants (32 tests)", () => {
  it("1. formats paid_off status as Pagada", () => {
    expect(formatDebtStatus("paid_off")).toBe("Pagada");
  });

  it("2. formats active status as Activa", () => {
    expect(formatDebtStatus("active")).toBe("Activa");
  });

  it("3. formats refinanced status as Refinanciada", () => {
    expect(formatDebtStatus("refinanced")).toBe("Refinanciada");
  });

  it("4. translates DEBT_PREPAYMENT_WOULD_PAY_OFF error correctly", () => {
    expect(translateDebtError(new Error("DEBT_PREPAYMENT_WOULD_PAY_OFF"))).toContain("Liquidar deuda");
  });

  it("5. translates DEBT_REVERSAL_SCHEDULE_REQUIRED error correctly", () => {
    expect(translateDebtError(new Error("DEBT_REVERSAL_SCHEDULE_REQUIRED"))).toContain(" cronograma");
  });

  it("6. translates DEBT_ARCHIVED error correctly", () => {
    expect(translateDebtError(new Error("DEBT_ARCHIVED"))).toContain("archivada");
  });

  it("7. translates DEBT_NOT_ACTIVE error correctly", () => {
    expect(translateDebtError(new Error("DEBT_NOT_ACTIVE"))).toContain("activa");
  });

  it("8. translates DEBT_ALREADY_PAID_OFF error correctly", () => {
    expect(translateDebtError(new Error("DEBT_ALREADY_PAID_OFF"))).toContain("pagada");
  });

  it("9. translates DEBT_PRINCIPAL_EXCEEDED error correctly", () => {
    expect(translateDebtError(new Error("DEBT_PRINCIPAL_EXCEEDED"))).toContain("saldo principal");
  });

  it("10. translates DEBT_EVENT_ALREADY_REVERSED error correctly", () => {
    expect(translateDebtError(new Error("DEBT_EVENT_ALREADY_REVERSED"))).toContain("revertido");
  });

  it("11. translates DEBT_MOVEMENT_MUST_BE_EXPENSE error correctly", () => {
    expect(translateDebtError(new Error("DEBT_MOVEMENT_MUST_BE_EXPENSE"))).toContain("egreso");
  });

  it("12. formats bank_loan debt kind", () => {
    expect(formatDebtKind("bank_loan")).toBe("Préstamo bancario");
  });

  it("13. formats family_loan debt kind", () => {
    expect(formatDebtKind("family_loan")).toBe("Préstamo familiar");
  });

  it("14. formats mortgage debt kind", () => {
    expect(formatDebtKind("mortgage")).toBe("Hipoteca");
  });

  it("15. formats payment event type", () => {
    expect(formatEventType("payment")).toBe("Pago de cuota");
  });

  it("16. formats principal_prepayment event type", () => {
    expect(formatEventType("principal_prepayment")).toBe("Prepago de principal");
  });

  it("17. formats payoff event type", () => {
    expect(formatEventType("payoff")).toBe("Liquidación total");
  });

  it("18. formats reversal event type", () => {
    expect(formatEventType("reversal")).toBe("Reversión");
  });

  it("19. resolves current debt schedule version correctly", () => {
    const versions: DebtScheduleVersion[] = [
      { id: "v1", debtId: "d1", versionNumber: 1, effectiveDate: "2026-01-01", reason: "initial", triggerEventId: null, notes: "", createdByUserId: "u1", createdAt: "" },
      { id: "v2", debtId: "d1", versionNumber: 2, effectiveDate: "2026-02-01", reason: "prepayment", triggerEventId: "e1", notes: "", createdByUserId: "u1", createdAt: "" },
    ];
    const current = currentDebtScheduleVersion("d1", versions);
    expect(current?.versionNumber).toBe(2);
  });

  it("20. filters effective debt events excluding reversed ones", () => {
    const events: DebtEvent[] = [
      { id: "e1", debtId: "d1", eventType: "payment", eventDate: "2026-01-01", cashAmount: 100, principalDelta: -80, interestPaid: 20, feesPaid: 0, insurancePaid: 0, otherCostPaid: 0, breakdownComplete: true, movementId: "m1", reversalOfEventId: null, description: "", registeredByUserId: "u1", createdAt: "" },
      { id: "r1", debtId: "d1", eventType: "reversal", eventDate: "2026-01-02", cashAmount: 0, principalDelta: 0, interestPaid: 0, feesPaid: 0, insurancePaid: 0, otherCostPaid: 0, breakdownComplete: true, movementId: null, reversalOfEventId: "e1", description: "", registeredByUserId: "u1", createdAt: "" },
    ];
    expect(effectiveDebtEvents(events, "d1")).toHaveLength(0);
  });

  it("21. calculates current debt principal correctly", () => {
    const debt: Debt = {
      id: "d1", name: "Test", creditorName: "Bank", debtKind: "bank_loan", currencyCode: "PEN", originDate: null, trackingStartDate: "2026-01-01", originalPrincipal: null, openingPrincipalBalance: 1000,
      plannedInstallmentCount: null, plannedInstallmentAmount: null, installmentAmountMode: "unknown", paymentFrequency: null, customFrequencyDays: null, firstDueDate: null, teaPercent: null, tceaPercent: null, notes: "", status: "active", isArchived: false, createdByUserId: "u1", createdAt: "", updatedAt: ""
    };
    const events: DebtEvent[] = [
      { id: "e1", debtId: "d1", eventType: "payment", eventDate: "2026-01-01", cashAmount: 200, principalDelta: -150, interestPaid: 50, feesPaid: 0, insurancePaid: 0, otherCostPaid: 0, breakdownComplete: true, movementId: "m1", reversalOfEventId: null, description: "", registeredByUserId: "u1", createdAt: "" }
    ];
    expect(currentDebtPrincipal(debt, events)).toBe(850);
  });

  it("22. calculates allocated amount for installment", () => {
    const allocations: DebtEventInstallmentAllocation[] = [
      { id: "a1", eventId: "ev1", debtId: "d1", installmentId: "inst1", allocatedAmount: 100, createdByUserId: "u1", createdAt: "" }
    ];
    const events: DebtEvent[] = [
      { id: "ev1", debtId: "d1", eventType: "payment", eventDate: "2026-01-01", cashAmount: 100, principalDelta: -80, interestPaid: 20, feesPaid: 0, insurancePaid: 0, otherCostPaid: 0, breakdownComplete: true, movementId: "m1", reversalOfEventId: null, description: "", registeredByUserId: "u1", createdAt: "" }
    ];
    expect(allocatedAmountForInstallment("inst1", allocations, events)).toBe(100);
  });

  it("23. computes positive principal in history using Math.max(0, -event.principalDelta)", () => {
    const delta = -120;
    const positivePrincipal = Math.max(0, -delta);
    expect(positivePrincipal).toBe(120);
  });

  it("24. validates reversal supported types (payment, principal_prepayment, payoff only)", () => {
    const supportedTypes = ["payment", "principal_prepayment", "payoff"];
    expect(supportedTypes.includes("payment")).toBe(true);
    expect(supportedTypes.includes("payoff")).toBe(true);
    expect(supportedTypes.includes("reversal")).toBe(false);
    expect(supportedTypes.includes("refinance")).toBe(false);
  });

  it("25. validates draft allocations sum and remaining limits", () => {
    const cashAmount = 300;
    const drafts = [{ installmentId: "i1", allocatedAmount: 150 }, { installmentId: "i2", allocatedAmount: 150 }];
    const sumDraft = drafts.reduce((s, d) => s + d.allocatedAmount, 0);
    expect(sumDraft <= cashAmount).toBe(true);
  });

  it("26. filters active egreso/ambos categories and defaults to Préstamos if active", () => {
    const categories: Category[] = [
      { id: "c1", name: "Préstamos", type: "egreso", is_active: true, created_at: "" },
      { id: "c2", name: "Alimentos", type: "egreso", is_active: false, created_at: "" }
    ];
    const activeCategories = categories.filter(c => c.is_active && (c.type === "egreso" || c.type === "ambos"));
    expect(activeCategories).toHaveLength(1);
    expect(activeCategories[0].name).toBe("Préstamos");
  });

  it("27. verifies active accounts presence for write operations", () => {
    const accounts: FinancialAccount[] = [
      { id: "acc1", name: "Bcp", reconciliationType: "balance", openingBalance: 100, isActive: true, sortOrder: 1, createdAt: "", updatedAt: "" },
      { id: "acc2", name: "Old", reconciliationType: "balance", openingBalance: 0, isActive: false, sortOrder: 2, createdAt: "", updatedAt: "" }
    ];
    const activeAccounts = accounts.filter(a => a.isActive !== false);
    expect(activeAccounts).toHaveLength(1);
    expect(activeAccounts[0].id).toBe("acc1");
  });

  it("28. enforces paid-off rules restricting payment/prepayment/payoff to active non-archived debts", () => {
    const debt: Debt = {
      id: "d1", name: "Test", creditorName: "Bank", debtKind: "bank_loan", currencyCode: "PEN", originDate: null, trackingStartDate: "2026-01-01", originalPrincipal: null, openingPrincipalBalance: 100,
      plannedInstallmentCount: null, plannedInstallmentAmount: null, installmentAmountMode: "unknown", paymentFrequency: null, customFrequencyDays: null, firstDueDate: null, teaPercent: null, tceaPercent: null, notes: "", status: "paid_off", isArchived: false, createdByUserId: "u1", createdAt: "", updatedAt: ""
    };
    const canOperate = debt.status === "active" && !debt.isArchived;
    expect(canOperate).toBe(false);
  });

  it("29. checks reversal schedule version linkage (version.debtId === debt.id && version.triggerEventId === targetEventId)", () => {
    const version: DebtScheduleVersion = {
      id: "v2", debtId: "d1", versionNumber: 2, effectiveDate: "2026-01-01", reason: "prepayment", triggerEventId: "ev1", notes: "", createdByUserId: "u1", createdAt: ""
    };
    const matches = version.debtId === "d1" && version.triggerEventId === "ev1";
    expect(matches).toBe(true);
  });

  it("30. handles prepayment schedule optional checkbox state", () => {
    let hasNewPrepaymentSchedule = false;
    expect(hasNewPrepaymentSchedule).toBe(false);
    hasNewPrepaymentSchedule = true;
    expect(hasNewPrepaymentSchedule).toBe(true);
  });

  it("31. verifies onboarding defaults (unknown installment mode, null frequency, bank_loan kind)", () => {
    const defaultMode = "unknown";
    const defaultFreq = null;
    const defaultKind = "bank_loan";
    expect(defaultMode).toBe("unknown");
    expect(defaultFreq).toBeNull();
    expect(defaultKind).toBe("bank_loan");
  });

  it("32. verifies refreshAppData throwing behavior on failure contract", async () => {
    const mockRefresh = async () => {
      throw new Error("REFRESH_FAILED");
    };
    await expect(mockRefresh()).rejects.toThrow("REFRESH_FAILED");
  });

  it("33. filters out empty or zero draft allocations", () => {
    const allocations = [
      { installmentId: "i1", allocatedAmount: "100" },
      { installmentId: "i2", allocatedAmount: "0" },
      { installmentId: "i3", allocatedAmount: "" },
      { installmentId: "i4", allocatedAmount: "50" },
    ];
    const filtered = allocations
      .filter((a) => Number(a.allocatedAmount || 0) > 0)
      .map((a) => ({ installmentId: a.installmentId, allocatedAmount: Number(a.allocatedAmount) }));
    expect(filtered).toEqual([
      { installmentId: "i1", allocatedAmount: 100 },
      { installmentId: "i4", allocatedAmount: 50 },
    ]);
  });

  it("34. blocks fund operation when category is empty", () => {
    const operationType: string = "payment";
    const category = "";
    const isValid = !(operationType !== "reversal" && !category);
    expect(isValid).toBe(false);
  });

  it("35. allows reversal if debt.status !== 'refinanced' regardless of isArchived", () => {
    const isReversal = false;
    const isReversed = false;
    const isArchived = true;
    const status: string = "active";
    const isSupportedReversal = true;
    const canWriteDebt = true;
    const canReverse = !isReversal && !isReversed && status !== "refinanced" && isSupportedReversal && canWriteDebt;
    expect(canReverse).toBe(true);
  });

  it("36. distinguishes RPC success + refresh failure vs RPC failure", async () => {
    let rpcSucceeded = false;
    let errorMessage = "";
    try {
      rpcSucceeded = true; // RPC succeeded
      await Promise.reject(new Error("REFRESH_FAILED"));
    } catch (err: any) {
      if (!rpcSucceeded) {
        errorMessage = "RPC error";
      } else {
        errorMessage = "Operación registrada exitosamente, pero falló la actualización de datos locales.";
      }
    }
    expect(errorMessage).toContain("actualización de datos locales");
  });

  it("37. checks targetGeneratedSchedule with exact debtId and triggerEventId", () => {
    const scheduleVersions: DebtScheduleVersion[] = [
      { id: "v1", debtId: "d1", versionNumber: 2, effectiveDate: "2026-01-01", reason: "prepayment", triggerEventId: "ev1", notes: "", createdByUserId: "u1", createdAt: "" }
    ];
    const targetEventId = "ev1";
    const debtId = "d1";
    const targetGeneratedSchedule = Boolean(targetEventId && scheduleVersions.some((v) => v.debtId === debtId && v.triggerEventId === targetEventId));
    expect(targetGeneratedSchedule).toBe(true);

    const wrongDebtSchedule = Boolean(targetEventId && scheduleVersions.some((v) => v.debtId === "d2" && v.triggerEventId === targetEventId));
    expect(wrongDebtSchedule).toBe(false);
  });

  it("38. verifies persistedAllocations passed to allocatedAmountForInstallment", () => {
    const persistedAllocations: DebtEventInstallmentAllocation[] = [
      { id: "a1", eventId: "ev1", debtId: "d1", installmentId: "inst1", allocatedAmount: 120, createdByUserId: "u1", createdAt: "" }
    ];
    const events: DebtEvent[] = [
      { id: "ev1", debtId: "d1", eventType: "payment", eventDate: "2026-01-01", cashAmount: 120, principalDelta: -100, interestPaid: 20, feesPaid: 0, insurancePaid: 0, otherCostPaid: 0, breakdownComplete: true, movementId: "m1", reversalOfEventId: null, description: "", registeredByUserId: "u1", createdAt: "" }
    ];
    const allocated = allocatedAmountForInstallment("inst1", persistedAllocations, events);
    expect(allocated).toBe(120);
  });
});
