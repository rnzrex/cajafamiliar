// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "./AuthGate";

const authTestState = vi.hoisted(() => ({
  client: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn(),
  },
  appProps: { current: null as any },
  membershipResponses: [] as any[],
}));

vi.mock("../App", () => ({
  default: ({ currentMember, onRetryRemoteAccess, remoteStatus }: any) => (
    <div data-testid="app">
      <span data-testid="member">{currentMember.displayName}</span>
      <span data-testid="remote-status">{remoteStatus ?? "null"}</span>
      <button type="button" onClick={onRetryRemoteAccess}>Reintentar acceso</button>
    </div>
  ),
}));

vi.mock("../services/pushNotifications", () => ({
  unregisterPushSubscription: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/supabaseClient", () => ({
  householdId: "household-1",
  isSupabaseConfigured: true,
  supabase: authTestState.client,
}));

vi.mock("../utils/storage", () => ({
  clearLocalAppData: vi.fn(),
  loadOfflineAccessRecord: vi.fn(),
  loadTrustedSnapshot: vi.fn(),
  saveOfflineAccessRecord: vi.fn(),
}));

const memberRow = {
  household_id: "household-1",
  user_id: "user-1",
  role: "owner",
  display_name: "Renzo",
};

function configureClient() {
  authTestState.client.auth.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-1" } } },
    error: null,
  });
  authTestState.client.auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
  authTestState.client.from.mockImplementation(() => {
    const query: any = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue(authTestState.membershipResponses.shift()),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    return query;
  });
}

describe("AuthGate membership revalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authTestState.membershipResponses.length = 0;
    authTestState.appProps.current = null;
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    configureClient();
  });

  afterEach(cleanup);

  it("keeps App authorized and exposes retry after a transient membership failure", async () => {
    authTestState.membershipResponses.push({ data: memberRow, error: null });
    render(<AuthGate />);
    await waitFor(() => expect(screen.getByTestId("app")).toBeTruthy());

    authTestState.membershipResponses.push({ data: null, error: new Error("network failure") });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar acceso" }));

    await waitFor(() => expect(screen.getByTestId("remote-status").textContent).toBe("problem"));
    expect(screen.getByTestId("app")).toBeTruthy();
    expect(screen.getByTestId("member").textContent).toBe("Renzo");
    expect(screen.getByRole("button", { name: "Reintentar acceso" })).toBeTruthy();
  });

  it("removes App authorization when membership is actually revoked", async () => {
    authTestState.membershipResponses.push({ data: memberRow, error: null });
    render(<AuthGate />);
    await waitFor(() => expect(screen.getByTestId("app")).toBeTruthy());

    authTestState.membershipResponses.push({ data: null, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar acceso" }));

    await waitFor(() => expect(screen.getByText("Esta cuenta no tiene acceso a Caja Familiar.")).toBeTruthy());
    expect(screen.queryByTestId("app")).toBeNull();
  });

  it("returns remoteStatus to connected after a successful retry", async () => {
    authTestState.membershipResponses.push({ data: memberRow, error: null });
    render(<AuthGate />);
    await waitFor(() => expect(screen.getByTestId("app")).toBeTruthy());

    authTestState.membershipResponses.push({ data: null, error: new Error("temporary failure") });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar acceso" }));
    await waitFor(() => expect(screen.getByTestId("remote-status").textContent).toBe("problem"));

    authTestState.membershipResponses.push({ data: memberRow, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar acceso" }));

    await waitFor(() => expect(screen.getByTestId("remote-status").textContent).toBe("connected"));
    expect(screen.getByTestId("app")).toBeTruthy();
  });
});
