import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AppData, HouseholdMember } from "../types";

// 1. Mock storage
const mockLoadTrustedSnapshot = vi.fn();
vi.mock("../utils/storage", async () => {
  const actual = await vi.importActual<typeof import("../utils/storage")>("../utils/storage");
  return {
    ...actual,
    loadTrustedSnapshot: (...args: any[]) => mockLoadTrustedSnapshot(...args),
  };
});

// 2. Mock Supabase Client
const mockFrom = vi.fn();
vi.mock("./supabaseClient", () => ({
  householdId: "h-test-123",
  isSupabaseConfigured: true,
  supabase: {
    from: (table: string) => mockFrom(table),
  },
}));

// Import REAL loadAppData after mocks!
import { loadAppData, RemoteAppDataLoadError, TrustedOfflineSnapshotUnavailableError } from "./dataRepository";

describe("Real loadAppData Execution Tests (Section 4, 5, 6, 7)", () => {
  const member: HouseholdMember = {
    householdId: "h-test-123",
    userId: "user-123",
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("REAL TEST A — ONLINE FAILED TABLE: throws RemoteAppDataLoadError('movements') and NEVER calls loadTrustedSnapshot", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    mockLoadTrustedSnapshot.mockReturnValue(sampleSnapshot);

    mockFrom.mockImplementation((table: string) => {
      if (table === "movements") {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: null, error: { message: "Table query error for movements" } }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { initial_balance: 1554.2 }, error: null }),
            order: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
              ascending: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      };
    });

    try {
      await loadAppData(member);
      expect.fail("Should have thrown RemoteAppDataLoadError");
    } catch (err: any) {
      expect(err).toBeInstanceOf(RemoteAppDataLoadError);
      expect(err.failedResource).toBe("movements");
    }

    // EXPLICIT REQUIREMENT (Section 5): Verify loadTrustedSnapshot WAS NOT CALLED
    expect(mockLoadTrustedSnapshot).not.toHaveBeenCalled();
  });

  it("REAL TEST B — OFFLINE FALLBACK: returns source='fallback' and data=snapshot when navigator.onLine=false", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    mockLoadTrustedSnapshot.mockReturnValue(sampleSnapshot);

    const result = await loadAppData(member);

    expect(result.source).toBe("fallback");
    expect(result.data).toEqual(sampleSnapshot);

    // Verify remote query was NOT executed
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("REAL TEST C — OFFLINE WITHOUT SNAPSHOT: throws TrustedOfflineSnapshotUnavailableError when offline and no snapshot", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    mockLoadTrustedSnapshot.mockReturnValue(null);

    await expect(loadAppData(member)).rejects.toThrow(TrustedOfflineSnapshotUnavailableError);
  });
});
