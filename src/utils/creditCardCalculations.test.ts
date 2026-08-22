import { describe, expect, it } from "vitest";
import type { CreditCardEntry, Debt } from "../types";
import { currentCreditCardBalance, effectiveCreditCardEntries } from "./creditCardCalculations";
import { normalizeCreditCardEntry, normalizeCreditCardProfile, normalizeCreditCardProfiles, normalizeCreditCardEntries } from "./creditCardNormalizers";
import { defaultData, normalizeData } from "./storage";

function mockDebt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: "d1",
    name: "Visa BCP",
    creditorName: "BCP",
    debtKind: "credit_card",
    currencyCode: "PEN",
    originDate: "2026-01-01",
    trackingStartDate: "2026-01-01",
    originalPrincipal: null,
    openingPrincipalBalance: 1000,
    plannedInstallmentCount: null,
    plannedInstallmentAmount: null,
    installmentAmountMode: "unknown",
    paymentFrequency: null,
    customFrequencyDays: null,
    firstDueDate: null,
    teaPercent: 25,
    tceaPercent: 30,
    notes: "",
    status: "active",
    isArchived: false,
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function mockEntry(overrides: Partial<CreditCardEntry> = {}): CreditCardEntry {
  return {
    id: "e1",
    debtId: "d1",
    entryDate: "2026-08-01",
    entryType: "purchase",
    liabilityDelta: 200,
    movementId: "m1",
    reversalOfEntryId: null,
    description: "Compra supermercado",
    registeredByUserId: "u1",
    createdAt: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

describe("DEBT-5A Credit Card Liability Foundation & Hardening", () => {
  // -------------------------------------------------------------------------
  // 1. EFFECTIVE ENTRIES (Tests 1-10)
  // -------------------------------------------------------------------------
  describe("effectiveCreditCardEntries", () => {
    it("1. purchase entry remains effective", () => {
      const e1 = mockEntry({ entryType: "purchase", liabilityDelta: 150 });
      const res = effectiveCreditCardEntries([e1]);
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe("e1");
    });

    it("2. payment entry remains effective", () => {
      const e1 = mockEntry({ entryType: "payment", liabilityDelta: -100 });
      const res = effectiveCreditCardEntries([e1]);
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe("e1");
    });

    it("3. finance_charge entry remains effective", () => {
      const e1 = mockEntry({ entryType: "finance_charge", liabilityDelta: 50 });
      const res = effectiveCreditCardEntries([e1]);
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe("e1");
    });

    it("4. credit entry remains effective", () => {
      const e1 = mockEntry({ entryType: "credit", liabilityDelta: -30 });
      const res = effectiveCreditCardEntries([e1]);
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe("e1");
    });

    it("5. reversal entry does not appear in effective list", () => {
      const rev = mockEntry({ id: "r1", entryType: "reversal", liabilityDelta: 0, reversalOfEntryId: "e1", movementId: null });
      const res = effectiveCreditCardEntries([rev]);
      expect(res).toHaveLength(0);
    });

    it("6. reversal excludes target purchase", () => {
      const e1 = mockEntry({ id: "e1", entryType: "purchase", liabilityDelta: 200 });
      const rev = mockEntry({ id: "r1", entryType: "reversal", liabilityDelta: 0, reversalOfEntryId: "e1", movementId: null });
      const res = effectiveCreditCardEntries([e1, rev]);
      expect(res).toHaveLength(0);
    });

    it("7. reversal excludes target payment", () => {
      const e1 = mockEntry({ id: "e1", entryType: "payment", liabilityDelta: -100 });
      const rev = mockEntry({ id: "r1", entryType: "reversal", liabilityDelta: 0, reversalOfEntryId: "e1", movementId: null });
      const res = effectiveCreditCardEntries([e1, rev]);
      expect(res).toHaveLength(0);
    });

    it("8. reversal excludes target finance_charge", () => {
      const e1 = mockEntry({ id: "e1", entryType: "finance_charge", liabilityDelta: 40 });
      const rev = mockEntry({ id: "r1", entryType: "reversal", liabilityDelta: 0, reversalOfEntryId: "e1", movementId: null });
      const res = effectiveCreditCardEntries([e1, rev]);
      expect(res).toHaveLength(0);
    });

    it("9. reversal excludes target credit", () => {
      const e1 = mockEntry({ id: "e1", entryType: "credit", liabilityDelta: -25 });
      const rev = mockEntry({ id: "r1", entryType: "reversal", liabilityDelta: 0, reversalOfEntryId: "e1", movementId: null });
      const res = effectiveCreditCardEntries([e1, rev]);
      expect(res).toHaveLength(0);
    });

    it("10. debtId filter isolates target card", () => {
      const e1 = mockEntry({ id: "e1", debtId: "d1" });
      const e2 = mockEntry({ id: "e2", debtId: "d2" });
      const resD1 = effectiveCreditCardEntries([e1, e2], "d1");
      expect(resD1).toHaveLength(1);
      expect(resD1[0].id).toBe("e1");
    });
  });

  // -------------------------------------------------------------------------
  // 2. CURRENT BALANCE (Tests 11-20)
  // -------------------------------------------------------------------------
  describe("currentCreditCardBalance", () => {
    it("11. no entries returns opening balance", () => {
      const debt = mockDebt({ openingPrincipalBalance: 1500 });
      const balance = currentCreditCardBalance(debt, []);
      expect(balance).toBe(1500);
    });

    it("12. purchase increases balance", () => {
      const debt = mockDebt({ openingPrincipalBalance: 1000 });
      const e1 = mockEntry({ entryType: "purchase", liabilityDelta: 250 });
      expect(currentCreditCardBalance(debt, [e1])).toBe(1250);
    });

    it("13. multiple purchases accumulate", () => {
      const debt = mockDebt({ openingPrincipalBalance: 500 });
      const e1 = mockEntry({ id: "e1", entryType: "purchase", liabilityDelta: 200 });
      const e2 = mockEntry({ id: "e2", entryType: "purchase", liabilityDelta: 300 });
      expect(currentCreditCardBalance(debt, [e1, e2])).toBe(1000);
    });

    it("14. payment reduces balance", () => {
      const debt = mockDebt({ openingPrincipalBalance: 1000 });
      const e1 = mockEntry({ entryType: "payment", liabilityDelta: -400 });
      expect(currentCreditCardBalance(debt, [e1])).toBe(600);
    });

    it("15. finance charge increases balance", () => {
      const debt = mockDebt({ openingPrincipalBalance: 1000 });
      const e1 = mockEntry({ entryType: "finance_charge", liabilityDelta: 75 });
      expect(currentCreditCardBalance(debt, [e1])).toBe(1075);
    });

    it("16. credit reduces balance", () => {
      const debt = mockDebt({ openingPrincipalBalance: 1000 });
      const e1 = mockEntry({ entryType: "credit", liabilityDelta: -50 });
      expect(currentCreditCardBalance(debt, [e1])).toBe(950);
    });

    it("17. reversed purchase does not affect balance", () => {
      const debt = mockDebt({ openingPrincipalBalance: 1000 });
      const e1 = mockEntry({ id: "e1", entryType: "purchase", liabilityDelta: 200 });
      const r1 = mockEntry({ id: "r1", entryType: "reversal", liabilityDelta: 0, reversalOfEntryId: "e1", movementId: null });
      expect(currentCreditCardBalance(debt, [e1, r1])).toBe(1000);
    });

    it("18. reversed payment does not affect balance", () => {
      const debt = mockDebt({ openingPrincipalBalance: 1000 });
      const e1 = mockEntry({ id: "e1", entryType: "payment", liabilityDelta: -300 });
      const r1 = mockEntry({ id: "r1", entryType: "reversal", liabilityDelta: 0, reversalOfEntryId: "e1", movementId: null });
      expect(currentCreditCardBalance(debt, [e1, r1])).toBe(1000);
    });

    it("19. mixed entries produce correct net balance", () => {
      const debt = mockDebt({ openingPrincipalBalance: 1000 });
      const p1 = mockEntry({ id: "p1", entryType: "purchase", liabilityDelta: 500 });
      const pay1 = mockEntry({ id: "pay1", entryType: "payment", liabilityDelta: -800 });
      const fc1 = mockEntry({ id: "fc1", entryType: "finance_charge", liabilityDelta: 30 });
      const c1 = mockEntry({ id: "c1", entryType: "credit", liabilityDelta: -20 });
      // 1000 + 500 - 800 + 30 - 20 = 710
      expect(currentCreditCardBalance(debt, [p1, pay1, fc1, c1])).toBe(710);
    });

    it("20. negative resulting balance is NOT clamped (remains negative)", () => {
      const debt = mockDebt({ openingPrincipalBalance: 200 });
      const pay1 = mockEntry({ id: "pay1", entryType: "payment", liabilityDelta: -300 });
      // 200 - 300 = -100 (overpayment)
      expect(currentCreditCardBalance(debt, [pay1])).toBe(-100);
    });
  });

  // -------------------------------------------------------------------------
  // 3. PROFILE & NORMALIZATION (Tests 21-27)
  // -------------------------------------------------------------------------
  describe("Profile & Normalization", () => {
    it("21. numeric creditLimit is preserved", () => {
      const p = normalizeCreditCardProfile({ debtId: "d1", creditLimit: 5000, createdByUserId: "u1", createdAt: "2026-08-01", updatedAt: "2026-08-01" });
      expect(p?.creditLimit).toBe(5000);
    });

    it("22. null creditLimit is preserved", () => {
      const p = normalizeCreditCardProfile({ debtId: "d1", creditLimit: null, createdByUserId: "u1", createdAt: "2026-08-01", updatedAt: "2026-08-01" });
      expect(p?.creditLimit).toBeNull();
    });

    it("23. null closingDay is preserved", () => {
      const p = normalizeCreditCardProfile({ debtId: "d1", closingDay: null, createdByUserId: "u1", createdAt: "2026-08-01", updatedAt: "2026-08-01" });
      expect(p?.closingDay).toBeNull();
    });

    it("24. null dueDay is preserved", () => {
      const p = normalizeCreditCardProfile({ debtId: "d1", dueDay: null, createdByUserId: "u1", createdAt: "2026-08-01", updatedAt: "2026-08-01" });
      expect(p?.dueDay).toBeNull();
    });

    it("25. null last4 is preserved", () => {
      const p = normalizeCreditCardProfile({ debtId: "d1", last4: null, createdByUserId: "u1", createdAt: "2026-08-01", updatedAt: "2026-08-01" });
      expect(p?.last4).toBeNull();
    });

    it("26. complete valid profile normalizes correctly", () => {
      const p = normalizeCreditCardProfile({
        debt_id: "d1",
        credit_limit: 8000,
        closing_day: 20,
        due_day: 10,
        last4: "4321",
        created_by_user_id: "u1",
        created_at: "2026-08-01T00:00:00Z",
        updated_at: "2026-08-01T00:00:00Z",
      });
      expect(p).toEqual({
        debtId: "d1",
        creditLimit: 8000,
        closingDay: 20,
        dueDay: 10,
        last4: "4321",
        createdByUserId: "u1",
        createdAt: "2026-08-01T00:00:00Z",
        updatedAt: "2026-08-01T00:00:00Z",
      });
    });

    it("27. numeric liabilityDelta normalizes correctly in entry", () => {
      const e = normalizeCreditCardEntry({
        id: "e1",
        debt_id: "d1",
        entry_date: "2026-08-01",
        entry_type: "purchase",
        liability_delta: 350.5,
        movement_id: "m1",
        registered_by_user_id: "u1",
        created_at: "2026-08-01T00:00:00Z",
      });
      expect(e?.liabilityDelta).toBe(350.5);
    });
  });

  // -------------------------------------------------------------------------
  // 4. SNAPSHOT BACKWARD COMPATIBILITY (Tests 28-34)
  // -------------------------------------------------------------------------
  describe("Snapshot Backward Compatibility", () => {
    it("28. old snapshot without profiles defaults to []", () => {
      const norm = normalizeData({
        initialBalance: 100,
        movements: [],
        cashCounts: [],
        recurringPayments: [],
        categories: [],
      });
      expect(norm.creditCardProfiles).toEqual([]);
    });

    it("29. old snapshot without entries defaults to []", () => {
      const norm = normalizeData({
        initialBalance: 100,
        movements: [],
        cashCounts: [],
        recurringPayments: [],
        categories: [],
      });
      expect(norm.creditCardEntries).toEqual([]);
    });

    it("30. defaultData has creditCardProfiles = []", () => {
      expect(defaultData.creditCardProfiles).toEqual([]);
    });

    it("31. defaultData has creditCardEntries = []", () => {
      expect(defaultData.creditCardEntries).toEqual([]);
    });

    it("32. normalizeData does not alter existing Debt arrays", () => {
      const debt = mockDebt();
      const norm = normalizeData({
        initialBalance: 100,
        movements: [],
        cashCounts: [],
        recurringPayments: [],
        categories: [],
        debts: [debt],
      });
      expect(norm.debts).toHaveLength(1);
      expect(norm.debts[0].id).toBe("d1");
    });

    it("33. normalizeData preserves reversalOfEntryId null", () => {
      const entry = mockEntry({ reversalOfEntryId: null });
      const norm = normalizeData({
        initialBalance: 100,
        movements: [],
        cashCounts: [],
        recurringPayments: [],
        categories: [],
        creditCardEntries: [entry],
      });
      expect(norm.creditCardEntries[0].reversalOfEntryId).toBeNull();
    });

    it("34. normalizeData preserves movementId linkage", () => {
      const entry = mockEntry({ movementId: "mov-123" });
      const norm = normalizeData({
        initialBalance: 100,
        movements: [],
        cashCounts: [],
        recurringPayments: [],
        categories: [],
        creditCardEntries: [entry],
      });
      expect(norm.creditCardEntries[0].movementId).toBe("mov-123");
    });
  });

  // -------------------------------------------------------------------------
  // 5. POST-AUDIT HARDENING TESTS (Tests 35-41)
  // -------------------------------------------------------------------------
  describe("Post-Audit Hardening Tests (35-41)", () => {
    it("35. debtId filter is not affected by reversal belonging to another debt", () => {
      const p1 = mockEntry({ id: "e1", debtId: "d1", entryType: "purchase", liabilityDelta: 500 });
      const revD2 = mockEntry({ id: "r1", debtId: "d2", entryType: "reversal", liabilityDelta: 0, reversalOfEntryId: "e1", movementId: null });

      const d1Effective = effectiveCreditCardEntries([p1, revD2], "d1");
      expect(d1Effective).toHaveLength(1);
      expect(d1Effective[0].id).toBe("e1");

      const debt1 = mockDebt({ id: "d1", openingPrincipalBalance: 1000 });
      expect(currentCreditCardBalance(debt1, [p1, revD2])).toBe(1500);
    });

    it("36. profile sin createdByUserId => null", () => {
      const p = normalizeCreditCardProfile({
        debtId: "d1",
        createdAt: "2026-08-01T00:00:00Z",
        updatedAt: "2026-08-01T00:00:00Z",
      });
      expect(p).toBeNull();
    });

    it("37. profile sin createdAt => null", () => {
      const p = normalizeCreditCardProfile({
        debtId: "d1",
        createdByUserId: "u1",
        updatedAt: "2026-08-01T00:00:00Z",
      });
      expect(p).toBeNull();
    });

    it("38. profile sin updatedAt => null", () => {
      const p = normalizeCreditCardProfile({
        debtId: "d1",
        createdByUserId: "u1",
        createdAt: "2026-08-01T00:00:00Z",
      });
      expect(p).toBeNull();
    });

    it("39. entry sin registeredByUserId => null", () => {
      const e = normalizeCreditCardEntry({
        id: "e1",
        debtId: "d1",
        entryDate: "2026-08-01",
        entryType: "purchase",
        liabilityDelta: 200,
        createdAt: "2026-08-01T00:00:00Z",
      });
      expect(e).toBeNull();
    });

    it("40. entry sin createdAt => null", () => {
      const e = normalizeCreditCardEntry({
        id: "e1",
        debtId: "d1",
        entryDate: "2026-08-01",
        entryType: "purchase",
        liabilityDelta: 200,
        registeredByUserId: "u1",
      });
      expect(e).toBeNull();
    });

    it("41. normalizar el mismo input dos veces produce exactamente el mismo resultado", () => {
      const profileInput = {
        debt_id: "d1",
        credit_limit: 5000,
        closing_day: 15,
        due_day: 5,
        last4: "1234",
        created_by_user_id: "u1",
        created_at: "2026-08-01T00:00:00Z",
        updated_at: "2026-08-01T00:00:00Z",
      };
      const res1 = normalizeCreditCardProfile(profileInput);
      const res2 = normalizeCreditCardProfile(profileInput);
      expect(res1).toEqual(res2);

      const entryInput = {
        id: "e1",
        debt_id: "d1",
        entry_date: "2026-08-01",
        entry_type: "purchase",
        liability_delta: 200,
        movement_id: "m1",
        registered_by_user_id: "u1",
        created_at: "2026-08-01T00:00:00Z",
      };
      const entryRes1 = normalizeCreditCardEntry(entryInput);
      const entryRes2 = normalizeCreditCardEntry(entryInput);
      expect(entryRes1).toEqual(entryRes2);
    });
  });
});
