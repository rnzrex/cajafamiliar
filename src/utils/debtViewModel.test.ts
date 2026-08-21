import { describe, expect, it } from "vitest";
import { translateDebtError, formatDebtKind, formatDebtStatus, formatPaymentFrequency, formatEventType } from "./debtViewModel";

describe("debtViewModel utilities", () => {
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
});
