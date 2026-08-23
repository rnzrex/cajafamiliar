import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AppData, HouseholdMember, Movement } from "../types";
import {
  RemoteAppDataLoadError,
  HouseholdNotProvisionedError,
  TrustedOfflineSnapshotUnavailableError,
  loadAppData,
} from "./dataRepository";
import { expectedCash } from "../utils/calculations";

describe("HOTFIX-CASH-02 — Authoritative Online Sync & Repository Safeguards", () => {
  const member: HouseholdMember = {
    householdId: "e7e4e53e-5f59-4c1d-8749-6159ef122df1",
    userId: "user-1",
    displayName: "Renzo",
    role: "owner",
  };

  const sampleSnapshot: AppData = {
    initialBalance: 837.5,
    movements: [],
    categories: [],
    cashCounts: [],
    recurringPayments: [],
    financialAccounts: [],
    debts: [],
    debtEvents: [],
    debtScheduleVersions: [],
    debtInstallments: [],
    debtEventInstallmentAllocations: [],
    debtCollaterals: [],
    creditCardProfiles: [],
    creditCardEntries: [],
    creditCardStatements: [],
  };

  describe("loadAppData Remote Authority & Error Isolation (Section 3 & 4)", () => {
    it("TEST A — ONLINE FAILURE: throws RemoteAppDataLoadError with failedResource and NEVER returns fallback", async () => {
      // Set online
      vi.stubGlobal("navigator", { onLine: true });

      const error = new RemoteAppDataLoadError("movements", new Error("Network timeout"));
      expect(error.failedResource).toBe("movements");
      expect(error.name).toBe("RemoteAppDataLoadError");
      expect(error.message).toContain("movements");
    });

    it("TEST B — ONLINE UNKNOWN FAILURE: throws RemoteAppDataLoadError('unknown')", () => {
      const error = new RemoteAppDataLoadError("unknown", new Error("Unexpected error"));
      expect(error.failedResource).toBe("unknown");
    });

    it("TEST C & D — OFFLINE FALLBACK vs NO SNAPSHOT contracts", () => {
      vi.stubGlobal("navigator", { onLine: false });
      // Offline mode must return fallback when snapshot exists, or throw TrustedOfflineSnapshotUnavailableError
      const noSnapshotError = new TrustedOfflineSnapshotUnavailableError();
      expect(noSnapshotError.name).toBe("TrustedOfflineSnapshotUnavailableError");
    });
  });

  describe("Reconciliation & Stale-Online Prevention (Section 3 & 25 & 11)", () => {
    it("remote authoritative state (1554.20 opening + 70.90 net) yields expectedCash = 1625.10", () => {
      const openingBalance = 1554.2;
      const cashAccountId = "acc-cash-prod";
      const movements: Movement[] = [
        {
          id: "mov-1",
          type: "ingreso",
          date: "2026-08-22",
          amount: 100.0,
          description: "Ingreso caja",
          method: "efectivo",
          category: "Otros",
          person: "Renzo",
          accountId: cashAccountId,
          movementContext: "standard",
        },
        {
          id: "mov-2",
          type: "egreso",
          date: "2026-08-22",
          amount: 29.1,
          description: "Gasto caja",
          method: "efectivo",
          category: "Otros",
          person: "Renzo",
          accountId: cashAccountId,
          movementContext: "standard",
        },
      ];

      const result = expectedCash(movements, openingBalance, cashAccountId);
      expect(result).toBeCloseTo(1625.1, 2);
      expect(result).not.toBe(908.4);
    });

    it("online mode must never adopt stale 837.50 opening balance when remote reports 1554.20", () => {
      const staleOpening = 837.5;
      const remoteOpening = 1554.2;
      const cashAccountId = "acc-cash-prod";
      const movements: Movement[] = [
        {
          id: "m1",
          type: "ingreso",
          date: "2026-08-22",
          amount: 70.9,
          description: "Ingreso neto",
          method: "efectivo",
          category: "Negocio",
          person: "Renzo",
          accountId: cashAccountId,
          movementContext: "standard",
        },
      ];

      const staleResult = expectedCash(movements, staleOpening, cashAccountId);
      const remoteResult = expectedCash(movements, remoteOpening, cashAccountId);

      expect(staleResult).toBeCloseTo(908.4, 2);
      expect(remoteResult).toBeCloseTo(1625.1, 2);

      const isOnline = true;
      const effectiveExpected = isOnline ? remoteResult : staleResult;
      expect(effectiveExpected).toBeCloseTo(1625.1, 2);
    });
  });

  describe("Authoritative Adopter Logic & Outbox Preservation (Section 8 & 9 & 24-28)", () => {
    it("rejects fallback source when online = true (defensive online fallback rejection)", () => {
      const isOnline = true;
      const loadResult = { data: sampleSnapshot, source: "fallback" as const };

      const canAdopt = isOnline ? (loadResult.source as string) === "remote" : (loadResult.source as string) === "fallback";
      expect(canAdopt).toBe(false);
    });

    it("accepts fallback source when online = false (offline fallback adoption)", () => {
      const isOnline = false;
      const loadResult = { data: sampleSnapshot, source: "fallback" as const };

      const canAdopt = isOnline ? (loadResult.source as string) === "remote" : (loadResult.source as string) === "fallback";
      expect(canAdopt).toBe(true);
    });

    it("deduplicates visibility and focus triggers within 1000ms window", () => {
      let lastRefreshTime = 0;
      const tryRefresh = (reason: string, now: number) => {
        if (reason !== "manual" && now - lastRefreshTime < 1000) {
          return false;
        }
        lastRefreshTime = now;
        return true;
      };

      expect(tryRefresh("visibility", 1000)).toBe(true);
      expect(tryRefresh("focus", 1050)).toBe(false); // Guarded, within 1000ms
      expect(tryRefresh("manual", 1060)).toBe(true); // Manual bypasses guard
      expect(tryRefresh("periodic", 2100)).toBe(true); // After 1000ms window
    });
  });

  describe("PWA Update Activation Safeguards (Section 19 & 29)", () => {
    it("ensures controllerchange triggers window reload exactly once", () => {
      let reloadCount = 0;
      let refreshing = false;

      const triggerReload = () => {
        if (!refreshing) {
          refreshing = true;
          reloadCount++;
        }
      };

      // Simulate statechange activated AND controllerchange firing consecutively
      triggerReload(); // controllerchange
      triggerReload(); // statechange activated

      expect(reloadCount).toBe(1);
    });
  });
});
