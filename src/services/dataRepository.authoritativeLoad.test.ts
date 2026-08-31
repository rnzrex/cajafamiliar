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
    accountReconciliations: [],
    accountReconciliationMovements: [],
    movementCorrections: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("REAL TEST A — ONLINE FAILED TABLE: throws RemoteAppDataLoadError('movements') and NEVER calls loadTrustedSnapshot", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    mockLoadTrustedSnapshot.mockReturnValue(sampleSnapshot);

    const makeChainedMock = (table: string) => {
      const builder: any = {
        order: () => builder,
        range: () => {
          if (table === "movements") {
            return Promise.resolve({ data: null, error: { message: "Table query error for movements" } });
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

  it("loads financing contracts using debt_id as the primary key and never requests order=id", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const orderCalls = new Map<string, string[]>();
    const financingContract = {
      debt_id: "debt-document-1",
      household_id: "h-test-123",
      contract_authority: "official_noncontractual",
      principal_basis: "financed_principal_only",
      financed_principal_amount: 76500,
      created_at: "2026-08-31T00:00:00.000Z",
    };

    const rowsByTable: Record<string, unknown[]> = {
      debt_financing_contracts: [financingContract],
    };
    const makeBuilder = (table: string) => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        order: (column: string) => {
          const calls = orderCalls.get(table) ?? [];
          calls.push(column);
          orderCalls.set(table, calls);
          return builder;
        },
        range: () => Promise.resolve({ data: rowsByTable[table] ?? [], error: null }),
        maybeSingle: () => Promise.resolve({ data: { initial_balance: 0 }, error: null }),
      };
      return builder;
    };

    mockFrom.mockImplementation((table: string) => makeBuilder(table));

    const result = await loadAppData(member);

    expect(result.data.debtFinancingContracts).toEqual([
      expect.objectContaining({ debtId: "debt-document-1", financedPrincipalAmount: 76500 }),
    ]);
    expect(orderCalls.get("debt_financing_contracts")).toEqual(["created_at", "debt_id"]);
  });
});
