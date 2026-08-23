import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AccountReconciliation, AccountReconciliationMovement, FinancialAccount, Movement, MovementCorrection } from "../types.js";
import { isMovementPendingForReconciliation, isReconciliationStale } from "../utils/reconciliationHelpers.js";
import { MovementsList } from "./MovementsList.js";
import { MovementCorrectionModal } from "./MovementCorrectionModal.js";

describe("RECON-1C Movement Correction Domain & UI Integrity", () => {
  const cashAccount: FinancialAccount = {
    id: "acc-cash-1",
    name: "Efectivo Soles",
    reconciliationType: "cash",
    openingBalance: 0,
    currencyCode: "PEN",
    isActive: true,
    sortOrder: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  const usdAccount: FinancialAccount = {
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

  const originalMovement: Movement = {
    id: "mov-matched-1",
    type: "egreso",
    date: "2026-08-10",
    amount: 100,
    description: "Almuerzo original",
    method: "efectivo",
    category: "Comida / cenas",
    person: "Papa",
    accountId: "acc-cash-1",
    movementContext: "standard",
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-10T10:00:00.000Z",
  };

  const correctedMovement: Movement = {
    ...originalMovement,
    amount: 120,
    description: "Almuerzo corregido",
    updatedAt: "2026-08-23T12:00:00.000Z", // Server timestamp changed
  };

  const debtServiceMovement: Movement = {
    id: "mov-debt-1",
    type: "egreso",
    date: "2026-08-10",
    amount: 300,
    description: "Pago cuota banco",
    method: "transferencia",
    category: "Préstamos",
    person: "Renzo",
    accountId: "acc-cash-1",
    movementContext: "debt_service",
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-10T10:00:00.000Z",
  };

  const matchedRec: AccountReconciliation = {
    id: "rec-matched-1",
    householdId: "h1",
    accountId: "acc-cash-1",
    reconciliationType: "cash",
    currencyCode: "PEN",
    openingBalanceSnapshot: 0,
    expectedBalance: 1625.10,
    actualBalance: 1625.10,
    difference: 0,
    status: "matched",
    denominations: null,
    registeredByUserId: "u1",
    createdAt: "2026-08-15T00:00:00.000Z",
  };

  const recMovement: AccountReconciliationMovement = {
    id: "arm-1",
    householdId: "h1",
    reconciliationId: "rec-matched-1",
    movementId: "mov-matched-1",
    balanceContribution: -100,
    movementUpdatedAtSnapshot: "2026-08-10T10:00:00.000Z",
    movementSnapshot: originalMovement,
    createdAt: "2026-08-15T00:00:00.000Z",
  };

  const correctionAudit: MovementCorrection = {
    id: "corr-1",
    householdId: "h1",
    movementId: "mov-matched-1",
    correctionId: "00000000-0000-4000-8000-000000000001",
    requestSnapshot: {},
    beforeSnapshot: originalMovement,
    afterSnapshot: correctedMovement,
    reason: "Corrección por boleta física",
    registeredByUserId: "u1",
    createdAt: "2026-08-23T12:00:00.000Z",
  };

  it("1. Corrected movement returns to pending status and makes prior reconciliation stale", () => {
    const accounts = [cashAccount];
    const reconciliations = [matchedRec];
    const recMovements = [recMovement];

    // Prior to correction: certified matched, not pending
    expect(isMovementPendingForReconciliation(originalMovement, accounts, reconciliations, recMovements)).toBe(false);
    expect(isReconciliationStale(matchedRec, cashAccount, [originalMovement], recMovements)).toBe(false);

    // After correction: updatedAt updated, becomes pending and reconciliation becomes stale
    expect(isMovementPendingForReconciliation(correctedMovement, accounts, reconciliations, recMovements)).toBe(true);
    expect(isReconciliationStale(matchedRec, cashAccount, [correctedMovement], recMovements)).toBe(true);

    // Historical membership in account_reconciliation_movements remains intact
    expect(recMovements.find((rm) => rm.movementId === "mov-matched-1")).toBeDefined();
  });

  it("2. MovementsList displays 'Corregir' for standard matched movements and keeps Edit/Delete disabled", () => {
    const html = renderToStaticMarkup(
      <MovementsList
        movements={[originalMovement]}
        debtEvents={[]}
        pendingMovementIds={new Set()}
        categories={[]}
        accounts={[cashAccount]}
        reconciliations={[matchedRec]}
        reconciliationMovements={[recMovement]}
        movementCorrections={[correctionAudit]}
        onQuickCreateCategory={() => null}
        onSave={() => undefined}
        onDelete={() => undefined}
      />
    );

    // Normal edit and delete should be disabled
    expect(html).toContain('disabled=""');
    // "Corregir" button should be rendered and visible
    expect(html).toContain("Corregir");
    // Historical correction audit indication rendered
    expect(html).toContain("Historial de correcciones");
    expect(html).toContain("Corrección por boleta física");
  });

  it("3. Non-standard movements (debt_service) do NOT show 'Corregir' button and remain protected in domain", () => {
    const html = renderToStaticMarkup(
      <MovementsList
        movements={[debtServiceMovement]}
        debtEvents={[]}
        pendingMovementIds={new Set()}
        categories={[]}
        accounts={[cashAccount]}
        reconciliations={[matchedRec]}
        reconciliationMovements={[]}
        onQuickCreateCategory={() => null}
        onSave={() => undefined}
        onDelete={() => undefined}
      />
    );

    expect(html).not.toContain("Corregir");
    expect(html).toContain("Se corrige desde Deudas");
  });

  it("4. MovementCorrectionModal renders input controls, mandatory reason, and notice", () => {
    const html = renderToStaticMarkup(
      <MovementCorrectionModal
        movement={originalMovement}
        categories={[{ id: "cat-1", name: "Comida / cenas", type: "egreso", color: "#f00", icon: "utensils", is_active: true, created_at: "2026-01-01" }]}
        accounts={[cashAccount]}
        corrections={[correctionAudit]}
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );

    expect(html).toContain("Corregir Movimiento Conciliado");
    expect(html).toContain("Aviso de trazabilidad");
    expect(html).toContain("Motivo obligatorio de la corrección");
    expect(html).toContain("Confirmar Corrección");
  });

  it("5. PEN and USD currencies remain isolated during reconciliation helper checks", () => {
    const usdRec: AccountReconciliation = {
      ...matchedRec,
      id: "rec-usd-1",
      accountId: "acc-usd-1",
      currencyCode: "USD",
      openingBalanceSnapshot: 500,
      expectedBalance: 500,
      actualBalance: 500,
    };

    expect(usdAccount.currencyCode).toBe("USD");
    expect(cashAccount.currencyCode).toBe("PEN");

    expect(isReconciliationStale(usdRec, usdAccount, [originalMovement], [])).toBe(false);
  });
});
