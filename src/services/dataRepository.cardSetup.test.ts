import { describe, expect, it, vi } from "vitest";
import {
  toCreateCreditCardDebtRpcArgs,
  toSaveCreditCardProfileRpcArgs,
  createCreditCardDebt,
  saveCreditCardProfile,
} from "./dataRepository";

vi.mock("./supabaseClient", () => ({
  isSupabaseConfigured: true,
  householdId: "h-test-1",
  supabase: {
    rpc: vi.fn(),
  },
}));

import { supabase } from "./supabaseClient";

describe("DEBT-5F-A: Credit Card Setup RPC Mapping & Service Unit Tests", () => {
  it("1. toCreateCreditCardDebtRpcArgs formats all args correctly and preserves nulls", () => {
    const input = {
      debtId: "debt-card-1",
      name: "Visa Black Interbank",
      creditorName: "Interbank",
      currencyCode: "USD",
      originDate: "2026-01-01",
      trackingStartDate: "2026-01-01",
      openingBalance: 1500,
      creditLimit: 10000,
      closingDay: 20,
      dueDay: 5,
      last4: "9876",
      teaPercent: 45.5,
      tceaPercent: 55.2,
      notes: "Tarjeta principal",
    };

    const args = toCreateCreditCardDebtRpcArgs(input);
    expect(args.p_household_id).toBe("h-test-1");
    expect(args.p_debt_id).toBe("debt-card-1");
    expect(args.p_name).toBe("Visa Black Interbank");
    expect(args.p_creditor_name).toBe("Interbank");
    expect(args.p_currency_code).toBe("USD");
    expect(args.p_origin_date).toBe("2026-01-01");
    expect(args.p_tracking_start_date).toBe("2026-01-01");
    expect(args.p_opening_balance).toBe(1500);
    expect(args.p_credit_limit).toBe(10000);
    expect(args.p_closing_day).toBe(20);
    expect(args.p_due_day).toBe(5);
    expect(args.p_last4).toBe("9876");
    expect(args.p_tea_percent).toBe(45.5);
    expect(args.p_tcea_percent).toBe(55.2);
    expect(args.p_notes).toBe("Tarjeta principal");
  });

  it("2. toCreateCreditCardDebtRpcArgs preserves null for omitted optional facts", () => {
    const input = {
      debtId: "debt-card-2",
      name: "Mastercard BBVA",
      creditorName: "BBVA",
      currencyCode: "PEN",
      trackingStartDate: "2026-08-01",
      openingBalance: 0,
    };

    const args = toCreateCreditCardDebtRpcArgs(input);
    expect(args.p_origin_date).toBeNull();
    expect(args.p_credit_limit).toBeNull();
    expect(args.p_closing_day).toBeNull();
    expect(args.p_due_day).toBeNull();
    expect(args.p_last4).toBeNull();
    expect(args.p_tea_percent).toBeNull();
    expect(args.p_tcea_percent).toBeNull();
    expect(args.p_notes).toBe("");
  });

  it("3. createCreditCardDebt executes create_credit_card_debt_v1 RPC and maps response", async () => {
    (supabase!.rpc as any).mockResolvedValueOnce({
      data: {
        debt: {
          id: "debt-card-1",
          household_id: "h-test-1",
          name: "Visa Black Interbank",
          creditor_name: "Interbank",
          debt_kind: "credit_card",
          currency_code: "USD",
          origin_date: "2026-01-01",
          tracking_start_date: "2026-01-01",
          original_principal: null,
          opening_principal_balance: 1500,
          planned_installment_count: null,
          planned_installment_amount: null,
          installment_amount_mode: "variable",
          payment_frequency: "monthly",
          custom_frequency_days: null,
          first_due_date: null,
          tea_percent: 45.5,
          tcea_percent: 55.2,
          notes: "Tarjeta principal",
          status: "active",
          is_archived: false,
          created_by_user_id: "u1",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        profile: {
          debt_id: "debt-card-1",
          household_id: "h-test-1",
          credit_limit: 10000,
          closing_day: 20,
          due_day: 5,
          last4: "9876",
          created_by_user_id: "u1",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      },
      error: null,
    });

    const res = await createCreditCardDebt({
      debtId: "debt-card-1",
      name: "Visa Black Interbank",
      creditorName: "Interbank",
      currencyCode: "USD",
      originDate: "2026-01-01",
      trackingStartDate: "2026-01-01",
      openingBalance: 1500,
      creditLimit: 10000,
      closingDay: 20,
      dueDay: 5,
      last4: "9876",
      teaPercent: 45.5,
      tceaPercent: 55.2,
      notes: "Tarjeta principal",
    });

    expect(res.success).toBe(true);
    expect(res.debt.debtKind).toBe("credit_card");
    expect(res.profile.creditLimit).toBe(10000);
    expect(res.profile.last4).toBe("9876");
  });

  it("4. toSaveCreditCardProfileRpcArgs formats args and preserves nulls", () => {
    const args = toSaveCreditCardProfileRpcArgs({
      debtId: "debt-card-1",
      creditLimit: 12000,
      closingDay: 22,
      dueDay: 8,
      last4: "1111",
    });

    expect(args.p_household_id).toBe("h-test-1");
    expect(args.p_debt_id).toBe("debt-card-1");
    expect(args.p_credit_limit).toBe(12000);
    expect(args.p_closing_day).toBe(22);
    expect(args.p_due_day).toBe(8);
    expect(args.p_last4).toBe("1111");
  });

  it("5. saveCreditCardProfile executes save_credit_card_profile_v1 RPC and maps response", async () => {
    (supabase!.rpc as any).mockResolvedValueOnce({
      data: {
        debt_id: "debt-card-1",
        household_id: "h-test-1",
        credit_limit: 12000,
        closing_day: 22,
        due_day: 8,
        last4: "1111",
        created_by_user_id: "u1",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-08-22T00:00:00Z",
      },
      error: null,
    });

    const res = await saveCreditCardProfile({
      debtId: "debt-card-1",
      creditLimit: 12000,
      closingDay: 22,
      dueDay: 8,
      last4: "1111",
    });

    expect(res.success).toBe(true);
    expect(res.profile.creditLimit).toBe(12000);
    expect(res.profile.closingDay).toBe(22);
    expect(res.profile.dueDay).toBe(8);
    expect(res.profile.last4).toBe("1111");
  });

  it("6. mapCreditCardOperationError maps INVALID_CREDIT_CARD_PROFILE error correctly", async () => {
    (supabase!.rpc as any).mockResolvedValueOnce({
      data: null,
      error: { message: "INVALID_CREDIT_CARD_PROFILE" },
    });

    await expect(
      saveCreditCardProfile({
        debtId: "debt-card-1",
        creditLimit: -50,
      })
    ).rejects.toThrow("INVALID_CREDIT_CARD_PROFILE");
  });
});
