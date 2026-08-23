import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { makeUuid } from "../utils/storage";
import { toCreateCreditCardDebtRpcArgs, toSaveCreditCardProfileRpcArgs } from "./dataRepository";

const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";
const LOCAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

describe("DEBT-5F-A Local Postgres SQL & Privilege Smoke Tests", () => {
  it("verifies create_credit_card_debt_v1 execute privilege is revoked from anon", async () => {
    const anonClient = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
      auth: { persistSession: false },
    });

    const args = toCreateCreditCardDebtRpcArgs({
      debtId: makeUuid(),
      name: "Test Card",
      creditorName: "Bank",
      currencyCode: "PEN",
      originDate: "2026-08-01",
      trackingStartDate: "2026-08-01",
      openingBalance: 0,
    });

    const { error } = await anonClient.rpc("create_credit_card_debt_v1", args);

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/permission denied|AUTH_REQUIRED|42501|P0001/i);
  });

  it("verifies save_credit_card_profile_v1 execute privilege is revoked from anon", async () => {
    const anonClient = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
      auth: { persistSession: false },
    });

    const args = toSaveCreditCardProfileRpcArgs({
      debtId: makeUuid(),
      creditLimit: 1000,
      closingDay: 15,
      dueDay: 5,
      last4: "1234",
    });

    const { error } = await anonClient.rpc("save_credit_card_profile_v1", args);

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/permission denied|AUTH_REQUIRED|42501|P0001/i);
  });

  it("verifies direct table modification permissions on credit_card_profiles are restricted from anon", async () => {
    const anonClient = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
      auth: { persistSession: false },
    });

    const { error: insertErr } = await anonClient
      .from("credit_card_profiles")
      .insert({
        debt_id: makeUuid(),
        household_id: makeUuid(),
      });

    expect(insertErr).not.toBeNull();
  });
});
