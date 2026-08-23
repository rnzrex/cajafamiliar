import { describe, expect, it } from "vitest";
import type { FinancialAccount, HouseholdMember } from "../types";
import {
  formatMovementCorrectionUser,
  formatMovementDateShort,
  getMovementCorrectionFieldChanges,
} from "./movementCorrectionHelpers";

describe("movementCorrectionHelpers Pure Production Helper Unit Tests", () => {
  const member: HouseholdMember = {
    householdId: "h1",
    userId: "u1",
    displayName: "Renzo",
    role: "owner",
  };

  const sampleAccounts: FinancialAccount[] = [
    {
      id: "acc-cash-1",
      name: "Efectivo",
      currencyCode: "PEN",
      reconciliationType: "cash",
      openingBalance: 0,
      sortOrder: 1,
      isActive: true,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    {
      id: "acc-bcp-1",
      name: "BCP Soles",
      currencyCode: "PEN",
      reconciliationType: "balance",
      openingBalance: 1000,
      sortOrder: 2,
      isActive: true,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  ];

  it("1. formatMovementCorrectionUser returns displayName for current member, otherwise 'Otro miembro'", () => {
    expect(formatMovementCorrectionUser("u1", member)).toBe("Renzo");
    expect(formatMovementCorrectionUser("u2", member)).toBe("Otro miembro");
    expect(formatMovementCorrectionUser("u1", undefined)).toBe("Otro miembro");
  });

  it("2. formatMovementDateShort formats YYYY-MM-DD to DD/MM/YYYY", () => {
    expect(formatMovementDateShort("2026-08-20")).toBe("20/08/2026");
    expect(formatMovementDateShort("invalid")).toBe("invalid");
    expect(formatMovementDateShort("")).toBe("-");
  });

  it("3. getMovementCorrectionFieldChanges detects exact changed business fields without showing UUIDs or raw JSON", () => {
    const before = {
      date: "2026-08-10",
      amount: 100,
      description: "Almuerzo original",
      method: "efectivo",
      category: "Comida / cenas",
      person: "Papa",
      account_id: "acc-cash-1",
    };

    const after = {
      date: "2026-08-11",
      amount: 120,
      description: "Almuerzo corregido",
      method: "efectivo",
      category: "Comida / cenas",
      person: "Papa Carlos",
      account_id: "acc-bcp-1",
    };

    const diff = getMovementCorrectionFieldChanges(before, after, sampleAccounts);

    expect(diff).toHaveLength(5);

    // Date change
    const dateChange = diff.find((c) => c.fieldKey === "date");
    expect(dateChange).toEqual({
      fieldKey: "date",
      label: "Fecha",
      beforeValue: "10/08/2026",
      afterValue: "11/08/2026",
    });

    // Amount change
    const amountChange = diff.find((c) => c.fieldKey === "amount");
    expect(amountChange?.label).toBe("Monto");
    expect(amountChange?.beforeValue).toContain("100");
    expect(amountChange?.afterValue).toContain("120");

    // Description change
    const descChange = diff.find((c) => c.fieldKey === "description");
    expect(descChange).toEqual({
      fieldKey: "description",
      label: "Descripción",
      beforeValue: "Almuerzo original",
      afterValue: "Almuerzo corregido",
    });

    // Person change
    const personChange = diff.find((c) => c.fieldKey === "person");
    expect(personChange).toEqual({
      fieldKey: "person",
      label: "Persona",
      beforeValue: "Papa",
      afterValue: "Papa Carlos",
    });

    // Account change
    const accountChange = diff.find((c) => c.fieldKey === "accountId");
    expect(accountChange).toEqual({
      fieldKey: "accountId",
      label: "Cuenta",
      beforeValue: "Efectivo",
      afterValue: "BCP Soles",
    });
  });

  it("4. getMovementCorrectionFieldChanges returns empty array when snapshots are identical", () => {
    const snapshot = {
      date: "2026-08-10",
      amount: 100,
      description: "Almuerzo",
      method: "efectivo",
      category: "Comida",
      person: "Papa",
      account_id: "acc-cash-1",
    };

    const diff = getMovementCorrectionFieldChanges(snapshot, snapshot, sampleAccounts);
    expect(diff).toHaveLength(0);
  });

  it("5. Multi-currency formatting: USD renders $, PEN renders S/, cross-account formats independently without conversion", () => {
    const usdAccount: FinancialAccount = {
      id: "acc-usd-1",
      name: "BPA Dólares",
      currencyCode: "USD",
      reconciliationType: "balance",
      openingBalance: 500,
      sortOrder: 3,
      isActive: true,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };

    const multiAccounts = [...sampleAccounts, usdAccount];

    // USD account amount change
    const usdDiff = getMovementCorrectionFieldChanges(
      { amount: 50, account_id: "acc-usd-1" },
      { amount: 75, account_id: "acc-usd-1" },
      multiAccounts
    );
    const usdAmountChange = usdDiff.find((c) => c.fieldKey === "amount");
    expect(usdAmountChange?.beforeValue).toContain("$");
    expect(usdAmountChange?.afterValue).toContain("$");

    // PEN account amount change
    const penDiff = getMovementCorrectionFieldChanges(
      { amount: 50, account_id: "acc-cash-1" },
      { amount: 75, account_id: "acc-cash-1" },
      multiAccounts
    );
    const penAmountChange = penDiff.find((c) => c.fieldKey === "amount");
    expect(penAmountChange?.beforeValue).toContain("S/");
    expect(penAmountChange?.afterValue).toContain("S/");

    // PEN -> USD cross-account correction
    const crossDiff = getMovementCorrectionFieldChanges(
      { amount: 100, account_id: "acc-cash-1" },
      { amount: 100, account_id: "acc-usd-1" },
      multiAccounts
    );
    const crossAmountChange = crossDiff.find((c) => c.fieldKey === "amount");
    expect(crossAmountChange?.beforeValue).toContain("S/");
    expect(crossAmountChange?.beforeValue).toContain("100");
    expect(crossAmountChange?.afterValue).toContain("$");
    expect(crossAmountChange?.afterValue).toContain("100");
  });
});
