import { describe, expect, it } from "vitest";
import { formatDebtStatus, translateDebtError, formatEventType } from "./debtViewModel";
import { currentDebtScheduleVersion } from "./debtCalculations";
import type { DebtScheduleVersion } from "../types";

describe("DEBT-2C Hardened Behaviors & View-Model", () => {
  it("formats paid_off status as Pagada", () => {
    expect(formatDebtStatus("paid_off")).toBe("Pagada");
    expect(formatDebtStatus("active")).toBe("Activa");
    expect(formatDebtStatus("refinanced")).toBe("Refinanciada");
  });

  it("translates errors without technical jargon", () => {
    expect(translateDebtError(new Error("DEBT_PREPAYMENT_WOULD_PAY_OFF"))).toContain("Liquidar deuda");
    expect(translateDebtError(new Error("DEBT_REVERSAL_SCHEDULE_REQUIRED"))).toContain("nuevo cronograma");
  });

  it("finds current debt schedule version correctly", () => {
    const versions: DebtScheduleVersion[] = [
      { id: "v1", debtId: "d1", versionNumber: 1, effectiveDate: "2026-01-01", reason: "initial", triggerEventId: null, notes: "", createdByUserId: "u1", createdAt: "" },
      { id: "v2", debtId: "d1", versionNumber: 2, effectiveDate: "2026-02-01", reason: "prepayment", triggerEventId: "e1", notes: "", createdByUserId: "u1", createdAt: "" },
      { id: "v3", debtId: "d2", versionNumber: 1, effectiveDate: "2026-01-01", reason: "initial", triggerEventId: null, notes: "", createdByUserId: "u1", createdAt: "" },
    ];
    const current = currentDebtScheduleVersion("d1", versions);
    expect(current?.id).toBe("v2");
    expect(current?.versionNumber).toBe(2);
  });
});
