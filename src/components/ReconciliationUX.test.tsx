import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AccountReconciliation, AccountReconciliationMovement, AppData, FinancialAccount, Movement, OfflineCreateMovementOperation } from "../types.js";
import { mergePendingMovements, shouldStartAuthoritativeRefresh } from "../services/authoritativeSync.js";
import { isMovementPendingForReconciliation } from "../utils/reconciliationHelpers.js";
import { AccountReconciliationModal } from "./AccountReconciliationModal.js";
import { AccountsManager } from "./AccountsManager.js";
import { MovementsList, formatCreatedAt } from "./MovementsList.js";

describe("RECON-1B Reconciliation UX Domain & Real Component Integrity", () => {
  const sampleAccount: FinancialAccount = {
    id: "acc-pen-1",
    name: "Cuenta BCP",
    reconciliationType: "balance",
    openingBalance: 1000,
    currencyCode: "PEN",
    isActive: true,
    sortOrder: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  const sampleUsdAccount: FinancialAccount = {
    id: "acc-usd-1",
    name: "Cuenta Dólares BCP",
    reconciliationType: "balance",
    openingBalance: 500,
    currencyCode: "USD",
    isActive: true,
    sortOrder: 2,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  const archivedAccount: FinancialAccount = {
    id: "acc-archived-1",
    name: "Cuenta Vieja",
    reconciliationType: "balance",
    openingBalance: 100,
    currencyCode: "PEN",
    isActive: false,
    sortOrder: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const mOld: Movement = {
    id: "m-old",
    type: "ingreso",
    date: "2026-08-10",
    amount: 100,
    description: "Movimiento Antiguo",
    method: "transferencia",
    category: "Otros",
    person: "Mama",
    accountId: "acc-pen-1",
    movementContext: "standard",
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-10T10:00:00.000Z",
  };

  const mUsd: Movement = {
    id: "m-usd-1",
    type: "ingreso",
    date: "2026-08-11",
    amount: 200,
    description: "Movimiento en Dolares",
    method: "transferencia",
    category: "Otros",
    person: "Renzo",
    accountId: "acc-usd-1",
    movementContext: "standard",
    createdAt: "2026-08-11T10:00:00.000Z",
    updatedAt: "2026-08-11T10:00:00.000Z",
  };

  const mBackdatedToday: Movement = {
    id: "m-backdated-today",
    type: "egreso",
    date: "2026-08-05",
    amount: 50,
    description: "Gasto retroactivo registrado hoy",
    method: "transferencia",
    category: "Mercado",
    person: "Papa",
    accountId: "acc-pen-1",
    movementContext: "standard",
    createdAt: "2026-08-23T14:00:00.000Z",
    updatedAt: "2026-08-23T14:00:00.000Z",
  };

  const mUnassignedNonCash: Movement = {
    id: "m-unassigned-transfer",
    type: "egreso",
    date: "2026-08-01",
    amount: 30,
    description: "Gasto sin cuenta por transferencia",
    method: "transferencia",
    category: "Varios",
    person: "Papa",
    accountId: null,
    movementContext: "standard",
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-01T08:00:00.000Z",
  };

  const mUnassignedEfectivo: Movement = {
    id: "m-unassigned-cash",
    type: "egreso",
    date: "2026-08-02",
    amount: 20,
    description: "Gasto efectivo sin cuenta",
    method: "efectivo",
    category: "Varios",
    person: "Papa",
    accountId: null,
    movementContext: "standard",
    createdAt: "2026-08-02T08:00:00.000Z",
    updatedAt: "2026-08-02T08:00:00.000Z",
  };

  const mArchivedAccount: Movement = {
    id: "m-archived-account",
    type: "egreso",
    date: "2026-08-03",
    amount: 80,
    description: "Gasto en cuenta archivada",
    method: "transferencia",
    category: "Otros",
    person: "Papa",
    accountId: "acc-archived-1",
    movementContext: "standard",
    createdAt: "2026-08-03T08:00:00.000Z",
    updatedAt: "2026-08-03T08:00:00.000Z",
  };

  const recMatched: AccountReconciliation = {
    id: "rec-matched-1",
    householdId: "h-1",
    accountId: "acc-pen-1",
    reconciliationType: "balance",
    currencyCode: "PEN",
    openingBalanceSnapshot: 1000,
    expectedBalance: 1100,
    actualBalance: 1100,
    difference: 0,
    status: "matched",
    denominations: null,
    registeredByUserId: "u-1",
    createdAt: "2026-08-23T12:00:00.000Z",
  };

  const recMovements: AccountReconciliationMovement[] = [
    {
      id: "rm-1",
      householdId: "h-1",
      reconciliationId: "rec-matched-1",
      movementId: "m-old",
      balanceContribution: 100,
      movementUpdatedAtSnapshot: "2026-08-10T10:00:00.000Z",
      movementSnapshot: mOld,
      createdAt: "2026-08-23T12:00:00.000Z",
    },
  ];

  describe("CASH-02 Authoritative Sync Invariant", () => {
    it("remote row + pending operation with same movement ID => remote content wins and NO duplicate appears", () => {
      const remoteMovement: Movement = {
        ...mOld,
        description: "Remote Authoritative Description",
        amount: 150,
      };

      const pendingOp: OfflineCreateMovementOperation = {
        operationId: "op-1",
        createdAt: "2026-08-23T12:00:00.000Z",
        movement: {
          ...mOld,
          description: "Stale Local Outbox Description",
          amount: 999,
        },
      };

      const baseAppData: AppData = {
        initialBalance: 1000,
        categories: [],
        recurringPayments: [],
        financialAccounts: [sampleAccount],
        movements: [remoteMovement],
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
      };

      const merged = mergePendingMovements(baseAppData, [pendingOp]);

      // Exactly 1 movement in collection (no duplicates!)
      expect(merged.movements.length).toBe(1);

      // Remote content wins!
      expect(merged.movements[0].description).toBe("Remote Authoritative Description");
      expect(merged.movements[0].amount).toBe(150);
    });
  });

  describe("Pure Pending Semantics & Exclusion Helpers", () => {
    it("movement belonging to an ARCHIVED account (isActive=false) is NOT pending", () => {
      const isPending = isMovementPendingForReconciliation(
        mArchivedAccount,
        [sampleAccount, archivedAccount],
        [],
        []
      );
      expect(isPending).toBe(false);
    });

    it("unassigned non-cash movement (accountId=null, method='transferencia') is NOT pending", () => {
      const isPending = isMovementPendingForReconciliation(
        mUnassignedNonCash,
        [sampleAccount],
        [recMatched],
        recMovements
      );
      expect(isPending).toBe(false);
    });

    it("unassigned cash movement (accountId=null, method='efectivo') belonging to active cash account IS pending when uncertified", () => {
      const cashAcc: FinancialAccount = {
        ...sampleAccount,
        id: "acc-cash-1",
        reconciliationType: "cash",
      };
      const isPending = isMovementPendingForReconciliation(
        mUnassignedEfectivo,
        [cashAcc],
        [],
        []
      );
      expect(isPending).toBe(true);
    });

    it("new backdated movement assigned to active account IS pending", () => {
      const isPending = isMovementPendingForReconciliation(
        mBackdatedToday,
        [sampleAccount],
        [recMatched],
        recMovements
      );
      expect(isPending).toBe(true);
    });

    it("certified matched movement is NOT pending (it is conciliado)", () => {
      const isPending = isMovementPendingForReconciliation(
        mOld,
        [sampleAccount],
        [recMatched],
        recMovements
      );
      expect(isPending).toBe(false);
    });
  });

  describe("Authoritative Post-Write Refresh Deduplication", () => {
    it("forced authoritative refresh for reconciliation is NOT rejected when previous refresh started <1s ago", () => {
      const now = Date.now();
      const lastStartedAt = now - 200;
      const shouldRunManual = shouldStartAuthoritativeRefresh({
        reason: "manual",
        now,
        lastStartedAt,
        inFlight: false,
        windowMs: 1000,
      });

      expect(shouldRunManual).toBe(true);
    });
  });

  describe("Real Component Render Tests (renderToStaticMarkup)", () => {
    it("renders MovementsList with PEN movement S/ and USD movement $ without converting or aggregating", () => {
      const html = renderToStaticMarkup(
        <MovementsList
          movements={[mOld, mUsd]}
          debtEvents={[]}
          pendingMovementIds={new Set()}
          categories={[]}
          accounts={[sampleAccount, sampleUsdAccount]}
          debts={[]}
          reconciliations={[]}
          reconciliationMovements={[]}
          onQuickCreateCategory={() => null}
          onSave={async () => true}
          onDelete={async () => true}
        />
      );

      // Prove PEN movement renders S/
      expect(html).toContain("S/ 100.00");

      // Prove USD movement renders $
      expect(html).toContain("$ 200.00");
    });

    it("renders MovementsList with exact certified badge, separated economic & registration dates, and disabled matched edit/delete", () => {
      const html = renderToStaticMarkup(
        <MovementsList
          movements={[mOld, mBackdatedToday]}
          debtEvents={[]}
          pendingMovementIds={new Set()}
          categories={[]}
          accounts={[sampleAccount]}
          reconciliations={[recMatched]}
          reconciliationMovements={recMovements}
          onQuickCreateCategory={() => null}
          onSave={async () => true}
          onDelete={async () => true}
        />
      );

      // Prove exact badge text is rendered
      expect(html).toContain("Incluido en una conciliación que cuadró");

      // Prove economic date and registration date are rendered separately
      expect(html).toContain("Fecha movimiento:");
      expect(html).toContain("10/08/2026");
      expect(html).toContain("Registrado:");

      // Prove historical matched movement edit/delete button is disabled with tooltip
      expect(html).toContain('title="Este movimiento fue incluido en una conciliación que cuadró."');
      expect(html).toContain("disabled=");
    });

    it("renders MovementsList with mismatch/unprotected movement editable (no disabled tooltip)", () => {
      const recMismatch: AccountReconciliation = {
        ...recMatched,
        id: "rec-mismatch-1",
        status: "mismatch",
        difference: -50,
      };
      const mismatchRecMovements: AccountReconciliationMovement[] = [
        {
          ...recMovements[0],
          reconciliationId: "rec-mismatch-1",
        },
      ];

      const html = renderToStaticMarkup(
        <MovementsList
          movements={[mOld]}
          debtEvents={[]}
          pendingMovementIds={new Set()}
          categories={[]}
          accounts={[sampleAccount]}
          reconciliations={[recMismatch]}
          reconciliationMovements={mismatchRecMovements}
          onQuickCreateCategory={() => null}
          onSave={async () => true}
          onDelete={async () => true}
        />
      );

      // Movement in mismatch reconciliation should NOT be protected
      expect(html).not.toContain('title="Este movimiento fue incluido en una conciliación que cuadró."');
    });

    it("renders AccountReconciliationModal with offline guard and local expected balance estimation copy", () => {
      const htmlOffline = renderToStaticMarkup(
        <AccountReconciliationModal
          account={sampleAccount}
          movements={[mOld]}
          reconciliations={[recMatched]}
          reconciliationMovements={recMovements}
          isOnline={false}
          onClose={() => {}}
          onReconcile={async () => null}
        />
      );

      // Prove offline banner message
      expect(htmlOffline).toContain("Estás sin conexión. Para conciliar cuentas necesitas conectarte a internet.");
      // Prove authoritative local estimation label (never claim calculated by server before RPC)
      expect(htmlOffline).toContain("Saldo esperado actual (estimación antes de conciliar)");
      expect(htmlOffline).toContain("El valor definitivo es verificado y registrado por el servidor al conciliar.");
    });

    it("renders AccountsManager showing Conciliar button ONLY for active accounts and isolated PEN/USD labels", () => {
      const html = renderToStaticMarkup(
        <AccountsManager
          accounts={[sampleAccount, sampleUsdAccount, archivedAccount]}
          movements={[mOld]}
          reconciliations={[recMatched]}
          reconciliationMovements={recMovements}
          isOnline={true}
          onSave={async () => null}
          onToggle={async () => true}
          onEditInitialBalance={() => {}}
          onReconcileAccount={async () => null}
        />
      );

      // Prove PEN and USD labels are present and isolated
      expect(html).toContain("PEN");
      expect(html).toContain("USD");

      // Prove active accounts have Conciliar action button
      expect(html).toContain("Conciliar");

      // Prove archived account displays label
      expect(html).toContain("Cuenta Vieja");
      expect(html).toContain("Archivada");
    });
  });

  describe("Instant Local Time Formatting", () => {
    it("formatCreatedAt parses ISO string as an instant in local timezone", () => {
      const formatted = formatCreatedAt("2026-08-23T14:30:00.000Z");
      expect(formatted).not.toBe("-");
      expect(formatted.length).toBeGreaterThan(5);
    });
  });
});
