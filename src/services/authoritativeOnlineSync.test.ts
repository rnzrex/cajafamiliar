import { describe, expect, it, vi } from "vitest";
import type { AppData, HouseholdMember, Movement } from "../types";
import {
  RemoteAppDataLoadError,
  TrustedOfflineSnapshotUnavailableError,
} from "./dataRepository";
import {
  mergePendingMovements,
  shouldStartAuthoritativeRefresh,
  validateAuthoritativeLoadSource,
} from "./authoritativeSync";
import { expectedCash } from "../utils/calculations";

describe("HOTFIX-CASH-02 — Production Authoritative Sync Contract & Helpers", () => {
  const member: HouseholdMember = {
    householdId: "e7e4e53e-5f59-4c1d-8749-6159ef122df1",
    userId: "user-1",
    displayName: "Renzo",
    role: "owner",
  };

  const sampleAppData: AppData = {
    initialBalance: 837.5,
    movements: [
      {
        id: "m-remote-1",
        type: "ingreso",
        date: "2026-08-22",
        amount: 70.9,
        description: "Remoto",
        method: "efectivo",
        category: "Otros",
        person: "Renzo",
        accountId: "cash-1",
        movementContext: "standard",
      },
    ],
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
    accountReconciliations: [],
    accountReconciliationMovements: [],
    movementCorrections: [],
  };

  describe("Section 17: Production Helper validateAuthoritativeLoadSource", () => {
    it("ONLINE: accepts 'remote' source, rejects 'fallback' and 'local'", () => {
      expect(validateAuthoritativeLoadSource({ isOnline: true, source: "remote" })).toBe(true);
      expect(validateAuthoritativeLoadSource({ isOnline: true, source: "fallback" })).toBe(false);
      expect(validateAuthoritativeLoadSource({ isOnline: true, source: "local" })).toBe(false);
    });

    it("OFFLINE: accepts 'fallback' source, rejects 'remote' and 'local'", () => {
      expect(validateAuthoritativeLoadSource({ isOnline: false, source: "fallback" })).toBe(true);
      expect(validateAuthoritativeLoadSource({ isOnline: false, source: "remote" })).toBe(false);
      expect(validateAuthoritativeLoadSource({ isOnline: false, source: "local" })).toBe(false);
    });
  });

  describe("Section 19: Production Helper shouldStartAuthoritativeRefresh (Deduplication)", () => {
    it("deduplicates automatic triggers within 1000ms window, allows manual bypass", () => {
      // 1. Initial automatic trigger (visibility) at t=1000
      const run1 = shouldStartAuthoritativeRefresh({
        reason: "visibility",
        now: 1000,
        lastStartedAt: 0,
        inFlight: false,
      });
      expect(run1).toBe(true);

      // 2. Automatic trigger (focus) at t=1050 (within 1000ms window) -> GUARDED (false)
      const run2 = shouldStartAuthoritativeRefresh({
        reason: "focus",
        now: 1050,
        lastStartedAt: 1000,
        inFlight: false,
      });
      expect(run2).toBe(false);

      // 3. Manual trigger at t=1060 -> BYPASSES window (true)
      const run3 = shouldStartAuthoritativeRefresh({
        reason: "manual",
        now: 1060,
        lastStartedAt: 1000,
        inFlight: false,
      });
      expect(run3).toBe(true);

      // 4. Automatic trigger at t=2100 -> AFTER window (true)
      const run4 = shouldStartAuthoritativeRefresh({
        reason: "periodic",
        now: 2100,
        lastStartedAt: 1000,
        inFlight: false,
      });
      expect(run4).toBe(true);

      // 5. In-flight guard -> REJECTED (false)
      const run5 = shouldStartAuthoritativeRefresh({
        reason: "manual",
        now: 3000,
        lastStartedAt: 1000,
        inFlight: true,
      });
      expect(run5).toBe(false);
    });
  });

  describe("Section 18: Production Helper mergePendingMovements", () => {
    it("merges new pending outbox operations without duplicating existing remote IDs", () => {
      const pendingOperation = {
        version: 1 as const,
        operationId: "op-1",
        kind: "create-movement" as const,
        householdId: "h1",
        userId: "user-1",
        clientTimestamp: 1000,
        queuedAt: "2026-08-22T20:00:00Z",
        syncedAt: null,
        createdAt: "2026-08-22T20:00:00Z",
        movement: {
          id: "m-local-pending",
          type: "ingreso" as const,
          date: "2026-08-22",
          amount: 50.0,
          description: "Pendiente local",
          method: "efectivo" as const,
          category: "Otros",
          person: "Renzo",
          accountId: "cash-1",
          movementContext: "standard" as const,
        },
      };

      const merged = mergePendingMovements(sampleAppData, [pendingOperation]);
      expect(merged.movements).toHaveLength(2);
      expect(merged.movements[0].id).toBe("m-local-pending");

      // Merge again with duplicate operation ID -> should NOT duplicate
      const reMerged = mergePendingMovements(merged, [pendingOperation]);
      expect(reMerged.movements).toHaveLength(2);
    });
  });

  describe("Reconciliation & Production Cash Fixture (1554.20 + 70.90 = 1625.10)", () => {
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
  });

  describe("Typed Errors", () => {
    it("RemoteAppDataLoadError retains failedResource property", () => {
      const err = new RemoteAppDataLoadError("financial_accounts", new Error("RLS error"));
      expect(err.failedResource).toBe("financial_accounts");
      expect(err.name).toBe("RemoteAppDataLoadError");
    });
  });
});
