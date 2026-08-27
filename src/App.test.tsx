// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App.js";
import type { DebtCreateResult } from "./services/dataRepository.js";
import type { AppData } from "./types.js";

const emptyAppData = vi.hoisted((): AppData => ({
  movements: [],
  cashCounts: [],
  recurringPayments: [],
  categories: [],
  initialBalance: 0,
  financialAccounts: [],
  debts: [],
  bankLoanProfiles: [],
  debtInsuranceTerms: [],
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
}));

vi.mock("./services/dataRepository", async () => {
  const actual = await vi.importActual<typeof import("./services/dataRepository.js")>("./services/dataRepository.js");
  return {
    ...actual,
    loadAppData: vi.fn().mockResolvedValue({ data: emptyAppData, source: "remote" }),
  };
});

const createdResult = vi.hoisted(() => ({
  debt: { id: "new-debt-ux", name: "Crédito nuevo" },
  scheduleVersion: { id: "new-version-ux" },
  installments: [{ id: "new-installment-ux" }],
  collaterals: [{ id: "new-collateral-ux" }],
}));

vi.mock("./components/DebtForm", () => ({
  DebtForm: ({ onSaved }: { onSaved: (result: DebtCreateResult) => void }) => (
    <button type="button" onClick={() => onSaved(createdResult as DebtCreateResult)}>
      Simular crédito guardado
    </button>
  ),
}));

vi.mock("./components/DebtsManager", () => ({
  DebtsManager: ({ debts, onOpenNewDebt }: { debts: Array<{ id: string; name: string }>; onOpenNewDebt: () => void }) => (
    <section aria-label="Deudas visibles">
      <button type="button" onClick={onOpenNewDebt}>Registrar deuda</button>
      {debts.map((debt) => <p key={debt.id}>{debt.name}</p>)}
    </section>
  ),
}));

describe("App debt create visibility", () => {
  it("shows the RPC-created debt immediately even when refresh is deduplicated", async () => {
    render(<App currentMember={{ householdId: "household-1", userId: "user-1", displayName: "Renzo", role: "owner" }} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /^Deudas/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Deudas/ }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar deuda" }));
    fireEvent.click(screen.getByRole("button", { name: "Simular crédito guardado" }));

    await waitFor(() => expect(screen.getByRole("region", { name: "Deudas visibles" }).textContent).toContain("Crédito nuevo"));
  });
});
