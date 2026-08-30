// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Debt, FinancialAccount } from "../types";
import * as dataRepository from "../services/dataRepository";
import { DebtRefinanceForm } from "./DebtRefinanceForm";

vi.mock("../services/dataRepository", async () => {
  const actual = await vi.importActual<typeof dataRepository>("../services/dataRepository");
  return { ...actual, refinanceDebt: vi.fn().mockResolvedValue({ success: true }) };
});

const debt: Debt = {
  id: "source-debt", name: "Compra de terreno", creditorName: "Acreedor A", debtKind: "installment_purchase", currencyCode: "PEN",
  originDate: "2027-01-01", trackingStartDate: "2027-01-01", originalPrincipal: 1000, openingPrincipalBalance: 1000,
  plannedInstallmentCount: null, plannedInstallmentAmount: null, installmentAmountMode: "variable", paymentFrequency: null,
  customFrequencyDays: null, firstDueDate: null, teaPercent: null, tceaPercent: null, notes: "", status: "active", isArchived: false,
  createdByUserId: "user", createdAt: "2027-01-01T00:00:00Z", updatedAt: "2027-01-01T00:00:00Z", repaymentStructure: "open_ended",
  interestCalculationMode: "unknown",
};

const account: FinancialAccount = {
  id: "account-1", name: "Cuenta PEN", reconciliationType: "balance", openingBalance: 10000, currencyCode: "PEN", isActive: true,
  sortOrder: 1, createdAt: "2027-01-01T00:00:00Z", updatedAt: "2027-01-01T00:00:00Z",
};

describe("universal refinance UX", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  });

  it("previews a liability transfer and does not require a cash account when contribution is zero", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<DebtRefinanceForm debt={debt} currentPrincipal={1000} accounts={[]} canWriteDebt onSaved={onSaved} onCancel={vi.fn()} setToast={vi.fn()} />);
    expect(screen.getByText(/sin crear ingreso ni egreso/)).toBeTruthy();
    await user.type(screen.getByLabelText("Nuevo acreedor *"), "Acreedor B");
    await user.click(screen.getByRole("button", { name: "Registrar refinanciación" }));
    expect(dataRepository.refinanceDebt).toHaveBeenCalledWith(expect.objectContaining({
      sourceDebtId: debt.id,
      amountPaidByNewCreditor: 1000,
      cashContributionAmount: 0,
      contributionMovementId: null,
      contributionAccountId: null,
      refinanceCostsAmount: 0,
      refinanceCostsMovementId: null,
      refinanceCostsAccountId: null,
    }));
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("requires a real account for a positive user contribution", async () => {
    const user = userEvent.setup();
    const setToast = vi.fn();
    render(<DebtRefinanceForm debt={debt} currentPrincipal={1000} accounts={[account]} canWriteDebt onSaved={vi.fn()} onCancel={vi.fn()} setToast={setToast} />);
    await user.type(screen.getByLabelText("Nuevo acreedor *"), "Acreedor B");
    const contribution = screen.getByLabelText("Aporte propio en efectivo");
    await user.clear(contribution);
    await user.type(contribution, "100");
    const paid = screen.getByLabelText("Monto pagado por el nuevo acreedor *");
    await user.clear(paid);
    await user.type(paid, "900");
    await user.click(screen.getByRole("button", { name: "Registrar refinanciación" }));
    expect(dataRepository.refinanceDebt).toHaveBeenCalledWith(expect.objectContaining({ cashContributionAmount: 100, amountPaidByNewCreditor: 900, contributionAccountId: account.id }));
  });

  it("requires the same real account for a positive closing cost", async () => {
    const user = userEvent.setup();
    const setToast = vi.fn();
    render(<DebtRefinanceForm debt={debt} currentPrincipal={1000} accounts={[account]} canWriteDebt onSaved={vi.fn()} onCancel={vi.fn()} setToast={setToast} />);
    await user.type(screen.getByLabelText("Nuevo acreedor *"), "Acreedor B");
    const costs = screen.getByLabelText("Costos de cierre/refinanciación pagados en efectivo");
    await user.clear(costs);
    await user.type(costs, "25");
    await user.click(screen.getByRole("button", { name: "Registrar refinanciación" }));
    expect(dataRepository.refinanceDebt).toHaveBeenCalledWith(expect.objectContaining({
      refinanceCostsAmount: 25,
      refinanceCostsAccountId: account.id,
      refinanceCostsMovementId: expect.any(String),
    }));
  });

  it.each([
    ["contractual", "contractual"],
    ["official_noncontractual", "reconstructed"],
    ["user_reported", "manual"],
    ["estimated", "estimated"],
    ["unknown", null],
  ] as const)("preserves imported %s authority independently of schedule source", async (authority, scheduleSource) => {
    const user = userEvent.setup();
    render(<DebtRefinanceForm debt={debt} currentPrincipal={1000} accounts={[]} canWriteDebt onSaved={vi.fn()} onCancel={vi.fn()} setToast={vi.fn()} />);
    await user.type(screen.getByLabelText("Nuevo acreedor *"), "Acreedor B");
    await user.selectOptions(screen.getByLabelText("Estructura nueva"), "fixed_schedule");
    const scheduleJson = JSON.stringify({ schema: "CAJA_FAMILIAR_DEBT_DOCUMENT_V2", kind: "schedule", authority, contract: {}, rows: [{ sourceRowNumber: 1, contractualInstallmentNumber: 1, dueDate: "2027-02-01", expectedAmount: 1000, expectedPrincipal: 1000, expectedInterest: 0, expectedFees: 0, expectedInsurance: 0, expectedTaxes: 0, rowRole: "installment" }] });
    fireEvent.change(screen.getByLabelText("JSON V2 del nuevo cronograma"), { target: { value: scheduleJson } });
    await user.click(screen.getByRole("button", { name: "CARGAR NUEVO CRONOGRAMA" }));
    expect(screen.getByText(`AUTORIDAD: ${authority}`)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Registrar refinanciación" }));
    expect(dataRepository.refinanceDebt).toHaveBeenCalledWith(expect.objectContaining({
      targetScheduleSource: scheduleSource,
      targetContract: expect.objectContaining({ contractAuthority: authority }),
    }));
  });
});
