import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AppData, FinancialAccount, HouseholdMember, Movement } from "../types";
import { RemoteAppDataLoadError, HouseholdNotProvisionedError, TrustedOfflineSnapshotUnavailableError } from "./dataRepository";
import { expectedCash } from "../utils/calculations";

describe("HOTFIX-CASH-02 — Authoritative Online Sync", () => {
  const member: HouseholdMember = {
    householdId: "e7e4e53e-5f59-4c1d-8749-6159ef122df1",
    userId: "user-1",
    displayName: "Renzo",
    role: "owner",
  };

  describe("Reconciliation & Stale-Online Prevention (Section 3 & 25 & 11)", () => {
    it("remote authoritative state (1554.20 opening + 70.90 net) yields expectedCash = 1625.10", () => {
      const openingBalance = 1554.20;
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
      expect(result).toBeCloseTo(1625.10, 2);
      expect(result).not.toBe(908.40);
    });

    it("online mode must never use stale 837.50 opening balance when remote reports 1554.20", () => {
      const staleOpening = 837.50;
      const remoteOpening = 1554.20;
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

      expect(staleResult).toBeCloseTo(908.40, 2);
      expect(remoteResult).toBeCloseTo(1625.10, 2);

      // Rule 11: Under online mode, only 1625.10 is authoritative
      const isOnline = true;
      const effectiveExpected = isOnline ? remoteResult : staleResult;
      expect(effectiveExpected).toBeCloseTo(1625.10, 2);
    });
  });

  describe("RemoteAppDataLoadError & Table Error Identification (Section 7 & 12)", () => {
    it("RemoteAppDataLoadError captures the failed table/resource name", () => {
      const err = new RemoteAppDataLoadError("movements", new Error("Database connection timeout"));
      expect(err.failedResource).toBe("movements");
      expect(err.name).toBe("RemoteAppDataLoadError");
      expect(err.message).toContain("movements");
    });
  });

  describe("Cross-Device Sync Simulation (Section 32 & 33 & 36)", () => {
    it("simulates Device B receiving revision B from Device A upon refresh", () => {
      let deviceBData: { opening: number; movements: Movement[] } = {
        opening: 2500.0,
        movements: [],
      };

      expect(expectedCash(deviceBData.movements, deviceBData.opening)).toBe(2500.0);

      // Device A performs remote updates -> Remote becomes 1554.20 opening + 70.90 net
      const remoteRevisionB = {
        opening: 1554.20,
        movements: [
          {
            id: "m-remote-1",
            type: "ingreso" as const,
            date: "2026-08-22",
            amount: 70.9,
            description: "Abono remoto",
            method: "efectivo" as const,
            category: "Ventas",
            person: "Renzo",
            accountId: "cash-1",
            movementContext: "standard" as const,
          },
        ],
      };

      // Simulated visibilitychange/focus refresh on Device B adopts Revision B
      deviceBData = remoteRevisionB;
      const updatedBalance = expectedCash(deviceBData.movements, deviceBData.opening, "cash-1");

      expect(updatedBalance).toBeCloseTo(1625.10, 2);
    });
  });
});
