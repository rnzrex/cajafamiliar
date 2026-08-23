import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AppData, HouseholdMember, Movement } from "../types";
import { fetchAllSupabaseRows } from "./supabasePagination";
import { loadAppData, RemoteAppDataLoadError } from "./dataRepository";
import { saveData } from "../utils/storage";
import { expectedCash } from "../utils/calculations";

// Mock storage
const mockLoadTrustedSnapshot = vi.fn();
const mockMarkTrustedSnapshot = vi.fn();
vi.mock("../utils/storage", async () => {
  const actual = await vi.importActual<typeof import("../utils/storage")>("../utils/storage");
  return {
    ...actual,
    loadTrustedSnapshot: (...args: any[]) => mockLoadTrustedSnapshot(...args),
    markTrustedSnapshot: (...args: any[]) => mockMarkTrustedSnapshot(...args),
  };
});

// Mock Supabase Client
const mockFrom = vi.fn();
vi.mock("./supabaseClient", () => ({
  householdId: "h-prod-1010",
  isSupabaseConfigured: true,
  supabase: {
    from: (table: string) => mockFrom(table),
  },
}));

describe("HOTFIX-CASH-03 — Exhaustive Remote Dataset Pagination & Trusted Snapshot Integrity", () => {
  const sampleAppData: AppData = {
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Section 13: Production Root Cause Fixture (1554.20 - 645.80 + 716.70 = 1625.10)", () => {
    it("proves first 1000 movements yield 908.40, while all 1010 yield 1625.10", () => {
      const openingBalance = 1554.2;
      const cashAccountId = "cash-acc-1";

      const first1000: Movement[] = Array.from({ length: 1000 }, (_, i) => ({
        id: `m-${i}`,
        type: "egreso",
        date: "2026-08-20",
        amount: 0.6458,
        description: `Egreso ${i}`,
        method: "efectivo",
        category: "Otros",
        person: "Renzo",
        accountId: cashAccountId,
        movementContext: "standard",
      }));

      const last10: Movement[] = Array.from({ length: 10 }, (_, i) => ({
        id: `m-extra-${i}`,
        type: "ingreso",
        date: "2026-08-21",
        amount: 71.67,
        description: `Ingreso extra ${i}`,
        method: "efectivo",
        category: "Otros",
        person: "Renzo",
        accountId: cashAccountId,
        movementContext: "standard",
      }));

      const cash1000 = expectedCash(first1000, openingBalance, cashAccountId);
      expect(cash1000).toBeCloseTo(908.4, 2);

      const all1010 = [...first1000, ...last10];
      const cash1010 = expectedCash(all1010, openingBalance, cashAccountId);
      expect(cash1010).toBeCloseTo(1625.1, 2);
    });
  });

  describe("Section 14, 15, 16, 17, 18, 24: Unit & Helper Tests for fetchAllSupabaseRows", () => {
    it("Section 14: PAGINATION 1010 — fetches 2 pages (0..999, 1000..1999) returning 1010 rows", async () => {
      const rangeMock = vi.fn().mockImplementation((from: number, to: number) => {
        if (from === 0 && to === 999) {
          const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `id-${i}`, date: "2026-08-20" }));
          return Promise.resolve({ data: page1, error: null });
        }
        if (from === 1000 && to === 1999) {
          const page2 = Array.from({ length: 10 }, (_, i) => ({ id: `id-extra-${i}`, date: "2026-08-21" }));
          return Promise.resolve({ data: page2, error: null });
        }
        return Promise.resolve({ data: [], error: null });
      });

      const makeChainedMock = () => {
        const builder: any = {
          order: () => builder,
          range: rangeMock,
        };
        return builder;
      };

      const fakeSupabase: any = {
        from: () => ({
          select: () => ({
            eq: () => makeChainedMock(),
          }),
        }),
      };

      const rows = await fetchAllSupabaseRows({
        supabase: fakeSupabase,
        table: "movements",
        householdId: "h-1",
        orders: [
          { column: "date", ascending: false },
          { column: "created_at", ascending: false },
          { column: "id", ascending: false },
        ],
        pageSize: 1000,
      });

      expect(rows).toHaveLength(1010);
      expect(rangeMock).toHaveBeenCalledTimes(2);
      expect(rangeMock).toHaveBeenNthCalledWith(1, 0, 999);
      expect(rangeMock).toHaveBeenNthCalledWith(2, 1000, 1999);
    });

    it("Section 15: EXACTLY 1000 — fetches page 1 (1000) and page 2 (0) to confirm end of dataset", async () => {
      const rangeMock = vi.fn().mockImplementation((from: number) => {
        if (from === 0) {
          const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `id-${i}` }));
          return Promise.resolve({ data: page1, error: null });
        }
        return Promise.resolve({ data: [], error: null });
      });

      const makeChainedMock = () => {
        const builder: any = {
          order: () => builder,
          range: rangeMock,
        };
        return builder;
      };

      const fakeSupabase: any = {
        from: () => ({
          select: () => ({
            eq: () => makeChainedMock(),
          }),
        }),
      };

      const rows = await fetchAllSupabaseRows({
        supabase: fakeSupabase,
        table: "movements",
        householdId: "h-1",
        orders: [{ column: "id", ascending: true }],
        pageSize: 1000,
      });

      expect(rows).toHaveLength(1000);
      expect(rangeMock).toHaveBeenCalledTimes(2);
      expect(rangeMock).toHaveBeenNthCalledWith(1, 0, 999);
      expect(rangeMock).toHaveBeenNthCalledWith(2, 1000, 1999);
    });

    it("Section 16: 2005 — fetches 3 pages (0..999, 1000..1999, 2000..2999) returning 2005 rows", async () => {
      const rangeMock = vi.fn().mockImplementation((from: number) => {
        if (from === 0) {
          return Promise.resolve({ data: Array.from({ length: 1000 }, (_, i) => ({ id: `id-${i}` })), error: null });
        }
        if (from === 1000) {
          return Promise.resolve({ data: Array.from({ length: 1000 }, (_, i) => ({ id: `id-${1000 + i}` })), error: null });
        }
        if (from === 2000) {
          return Promise.resolve({ data: Array.from({ length: 5 }, (_, i) => ({ id: `id-${2000 + i}` })), error: null });
        }
        return Promise.resolve({ data: [], error: null });
      });

      const makeChainedMock = () => {
        const builder: any = {
          order: () => builder,
          range: rangeMock,
        };
        return builder;
      };

      const fakeSupabase: any = {
        from: () => ({
          select: () => ({
            eq: () => makeChainedMock(),
          }),
        }),
      };

      const rows = await fetchAllSupabaseRows({
        supabase: fakeSupabase,
        table: "movements",
        householdId: "h-1",
        orders: [{ column: "id", ascending: true }],
        pageSize: 1000,
      });

      expect(rows).toHaveLength(2005);
      expect(rangeMock).toHaveBeenCalledTimes(3);
    });

    it("Section 17: PAGE 2 FAILURE — throws RemoteAppDataLoadError without returning partial data", async () => {
      const rangeMock = vi.fn().mockImplementation((from: number) => {
        if (from === 0) {
          return Promise.resolve({ data: Array.from({ length: 1000 }, (_, i) => ({ id: `id-${i}` })), error: null });
        }
        return Promise.resolve({ data: null, error: { message: "Page 2 connection timeout" } });
      });

      const makeChainedMock = () => {
        const builder: any = {
          order: () => builder,
          range: rangeMock,
        };
        return builder;
      };

      const fakeSupabase: any = {
        from: () => ({
          select: () => ({
            eq: () => makeChainedMock(),
          }),
        }),
      };

      await expect(
        fetchAllSupabaseRows({
          supabase: fakeSupabase,
          table: "movements",
          householdId: "h-1",
          orders: [{ column: "id", ascending: true }],
          pageSize: 1000,
        })
      ).rejects.toThrow(RemoteAppDataLoadError);
    });

    it("Section 18: NO DUPLICATE BOUNDARY — deduplicates rows appearing across page boundaries", async () => {
      const page1 = [
        { id: "m-1", amount: 10 },
        { id: "m-2", amount: 20 },
      ];
      const page2 = [
        { id: "m-2", amount: 20 },
        { id: "m-3", amount: 30 },
      ];

      const rangeMock = vi.fn().mockImplementation((from: number) => {
        if (from === 0) return Promise.resolve({ data: page1, error: null });
        if (from === 2) return Promise.resolve({ data: page2, error: null });
        return Promise.resolve({ data: [], error: null });
      });

      const makeChainedMock = () => {
        const builder: any = {
          order: () => builder,
          range: rangeMock,
        };
        return builder;
      };

      const fakeSupabase: any = {
        from: () => ({
          select: () => ({
            eq: () => makeChainedMock(),
          }),
        }),
      };

      const rows = await fetchAllSupabaseRows({
        supabase: fakeSupabase,
        table: "movements",
        householdId: "h-1",
        orders: [{ column: "id", ascending: true }],
        pageSize: 2,
      });

      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.id)).toEqual(["m-1", "m-2", "m-3"]);
    });
  });

  describe("Section 19: Real loadAppData >1000 Movements Integration Test", () => {
    it("executes real loadAppData across 1010 movements and yields authoritative expectedCash 1625.10", async () => {
      vi.stubGlobal("navigator", { onLine: true });

      const member: HouseholdMember = {
        householdId: "h-prod-1010",
        userId: "user-1",
        displayName: "Renzo",
        role: "owner",
      };

      const page1Rows = Array.from({ length: 1000 }, (_, i) => ({
        id: `mov-${i}`,
        household_id: "h-prod-1010",
        type: "egreso",
        date: "2026-08-20",
        amount: 0.6458,
        description: `Egreso ${i}`,
        method: "efectivo",
        category: "Otros",
        person: "Renzo",
        account_id: "cash-acc-1",
        movement_context: "standard",
        created_at: "2026-08-20T10:00:00Z",
      }));

      const page2Rows = Array.from({ length: 10 }, (_, i) => ({
        id: `mov-extra-${i}`,
        household_id: "h-prod-1010",
        type: "ingreso",
        date: "2026-08-21",
        amount: 71.67,
        description: `Ingreso extra ${i}`,
        method: "efectivo",
        category: "Otros",
        person: "Renzo",
        account_id: "cash-acc-1",
        movement_context: "standard",
        created_at: "2026-08-21T10:00:00Z",
      }));

      const makeChainedMock = (table: string) => {
        const builder: any = {
          order: () => builder,
          range: (from: number, to: number) => {
            if (table === "movements") {
              if (from === 0 && to === 999) return Promise.resolve({ data: page1Rows, error: null });
              if (from === 1000) return Promise.resolve({ data: page2Rows, error: null });
              return Promise.resolve({ data: [], error: null });
            }
            if (table === "financial_accounts") {
              return Promise.resolve({
                data: [
                  {
                    id: "cash-acc-1",
                    household_id: "h-prod-1010",
                    name: "Efectivo",
                    opening_balance: 1554.2,
                    reconciliation_type: "cash",
                    is_active: true,
                    sort_order: 1,
                    created_at: "2026-08-01T00:00:00Z",
                  },
                ],
                error: null,
              });
            }
            return Promise.resolve({ data: [], error: null });
          },
          maybeSingle: () => Promise.resolve({ data: { initial_balance: 1554.2 }, error: null }),
        };
        return builder;
      };

      mockFrom.mockImplementation((table: string) => ({
        select: () => ({
          eq: () => makeChainedMock(table),
        }),
      }));

      const storageModule = await import("../utils/storage");
      const saveDataSpy = vi.spyOn(storageModule, "saveData").mockReturnValue(true);

      const res = await loadAppData(member);

      expect(res.source).toBe("remote");
      expect(res.data.movements).toHaveLength(1010);

      const cashAccount = res.data.financialAccounts.find((a) => a.id === "cash-acc-1");
      const calcCash = expectedCash(res.data.movements, cashAccount?.openingBalance ?? 0, cashAccount?.id ?? null);
      expect(calcCash).toBeCloseTo(1625.1, 2);
      expect(mockMarkTrustedSnapshot).toHaveBeenCalledWith(member);

      saveDataSpy.mockRestore();
    });
  });

  describe("Section 8, 9, 10: Cache Persistence & Trusted Snapshot Integrity Gate", () => {
    it("Section 8: saveData returns boolean (true on success, false on quota/error)", () => {
      const result = saveData(sampleAppData);
      expect(typeof result).toBe("boolean");
    });

    it("Section 9 & 10: QUOTA / STORAGE FAILURE — remote load succeeds (1010 rows / 1625.10 cash) but markTrustedSnapshot IS NOT CALLED when saveData returns false", async () => {
      vi.stubGlobal("navigator", { onLine: true });

      const member: HouseholdMember = {
        householdId: "h-prod-1010",
        userId: "user-1",
        displayName: "Renzo",
        role: "owner",
      };

      const storageModule = await import("../utils/storage");
      const saveDataSpy = vi.spyOn(storageModule, "saveData").mockReturnValue(false);

      const page1Rows = Array.from({ length: 1000 }, (_, i) => ({
        id: `mov-${i}`,
        household_id: "h-prod-1010",
        type: "egreso",
        date: "2026-08-20",
        amount: 0.6458,
        description: `Egreso ${i}`,
        method: "efectivo",
        category: "Otros",
        person: "Renzo",
        account_id: "cash-acc-1",
        movement_context: "standard",
        created_at: "2026-08-20T10:00:00Z",
      }));

      const page2Rows = Array.from({ length: 10 }, (_, i) => ({
        id: `mov-extra-${i}`,
        household_id: "h-prod-1010",
        type: "ingreso",
        date: "2026-08-21",
        amount: 71.67,
        description: `Ingreso extra ${i}`,
        method: "efectivo",
        category: "Otros",
        person: "Renzo",
        account_id: "cash-acc-1",
        movement_context: "standard",
        created_at: "2026-08-21T10:00:00Z",
      }));

      const makeChainedMock = (table: string) => {
        const builder: any = {
          order: () => builder,
          range: (from: number, to: number) => {
            if (table === "movements") {
              if (from === 0 && to === 999) return Promise.resolve({ data: page1Rows, error: null });
              if (from === 1000) return Promise.resolve({ data: page2Rows, error: null });
              return Promise.resolve({ data: [], error: null });
            }
            if (table === "financial_accounts") {
              return Promise.resolve({
                data: [
                  {
                    id: "cash-acc-1",
                    household_id: "h-prod-1010",
                    name: "Efectivo",
                    opening_balance: 1554.2,
                    reconciliation_type: "cash",
                    is_active: true,
                    sort_order: 1,
                    created_at: "2026-08-01T00:00:00Z",
                  },
                ],
                error: null,
              });
            }
            return Promise.resolve({ data: [], error: null });
          },
          maybeSingle: () => Promise.resolve({ data: { initial_balance: 1554.2 }, error: null }),
        };
        return builder;
      };

      mockFrom.mockImplementation((table: string) => ({
        select: () => ({
          eq: () => makeChainedMock(table),
        }),
      }));

      const res = await loadAppData(member);

      // 1. Online remote load succeeds completely
      expect(res.source).toBe("remote");
      expect(res.data.movements).toHaveLength(1010);
      const calcCash = expectedCash(res.data.movements, 1554.2, "cash-acc-1");
      expect(calcCash).toBeCloseTo(1625.1, 2);

      // 2. markTrustedSnapshot MUST NOT be called because saveData returned false
      expect(mockMarkTrustedSnapshot).not.toHaveBeenCalled();

      saveDataSpy.mockRestore();
    });
  });
});
