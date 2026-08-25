// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Debt, DebtInstallment, DebtScheduleVersion, FinancialAccount } from "../types.js";
import * as dataRepository from "../services/dataRepository.js";
import { DebtOperationForm } from "./DebtOperationForm.js";

vi.mock("../services/dataRepository", async () => {
  const actual = await vi.importActual<typeof dataRepository>("../services/dataRepository.js");
  return {
    ...actual,
    recordDebtPayment: vi.fn().mockResolvedValue({}),
    recordDebtPrepayment: vi.fn().mockResolvedValue({}),
    recordDebtInstallmentAdvance: vi.fn().mockResolvedValue({}),
    updateDebtContractualSchedule: vi.fn().mockResolvedValue({}),
  };
});

const debt: Debt = {
  id: "debt-qapaq",
  name: "Crédito QAPAQ",
  creditorName: "QAPAQ",
  debtKind: "bank_loan",
  currencyCode: "PEN",
  originDate: "2026-01-01",
  trackingStartDate: "2026-01-01",
  originalPrincipal: 10000,
  openingPrincipalBalance: 10000,
  plannedInstallmentCount: 12,
  plannedInstallmentAmount: 1100,
  installmentAmountMode: "fixed",
  paymentFrequency: "monthly",
  customFrequencyDays: null,
  firstDueDate: "2026-09-01",
  teaPercent: 15,
  tceaPercent: 17,
  notes: "",
  status: "active",
  isArchived: false,
  createdByUserId: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  repaymentStructure: "fixed_schedule",
  interestCalculationMode: "tea_estimate",
};

const account: FinancialAccount = {
  id: "qapaq-account",
  name: "QAPAQ",
  reconciliationType: "balance",
  openingBalance: 10000,
  currencyCode: "PEN",
  isActive: true,
  sortOrder: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const schedule: DebtScheduleVersion = {
  id: "schedule-qapaq",
  debtId: debt.id,
  versionNumber: 1,
  effectiveDate: "2026-01-01",
  reason: "initial",
  scheduleSource: "contractual",
  isAuthoritative: true,
  triggerEventId: null,
  notes: "",
  createdByUserId: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
};

const installments: DebtInstallment[] = [
  {
    id: "qapaq-installment-1",
    scheduleVersionId: schedule.id,
    debtId: debt.id,
    installmentNumber: 1,
    dueDate: "2026-09-01",
    expectedAmount: 1100,
    expectedPrincipal: 800,
    expectedInterest: 250,
    expectedFees: 0,
    expectedInsurance: 50,
    createdByUserId: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "qapaq-installment-2",
    scheduleVersionId: schedule.id,
    debtId: debt.id,
    installmentNumber: 2,
    dueDate: "2026-10-01",
    expectedAmount: 1200,
    expectedPrincipal: 700,
    expectedInterest: 400,
    expectedFees: 0,
    expectedInsurance: 100,
    createdByUserId: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
  },
];

function renderOperation(operationType: "payment" | "prepayment" | "installment_advance" | "schedule_update", paymentWithExtraPrincipal = false) {
  return render(
    <DebtOperationForm
      debt={debt}
      operationType={operationType}
      paymentWithExtraPrincipal={paymentWithExtraPrincipal}
      installments={installments}
      scheduleVersions={[schedule]}
      debtEvents={[]}
      accounts={[account]}
      categories={[]}
      currentPrincipal={10000}
      persistedAllocations={[]}
      onSaved={vi.fn().mockResolvedValue(undefined)}
      onCancel={vi.fn()}
      setToast={vi.fn()}
    />
  );
}

describe("DebtOperationFormUX - BANK V2 operations", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  });

  it("submits payment plus extra principal as one QAPAQ movement payload", async () => {
    const user = userEvent.setup();
    renderOperation("payment", true);
    const amounts = screen.getAllByRole("spinbutton");

    await user.clear(amounts[0]);
    await user.type(amounts[0], "3200");
    await user.clear(amounts[1]);
    await user.type(amounts[1], "800");
    await user.clear(amounts[2]);
    await user.type(amounts[2], "2000");
    await user.clear(amounts[3]);
    await user.type(amounts[3], "350");
    await user.clear(amounts[5]);
    await user.type(amounts[5], "50");
    await user.type(screen.getAllByPlaceholderText("Monto asignado")[0], "1100");
    await user.click(screen.getByRole("button", { name: "Confirmar operación" }));

    await waitFor(() => expect(dataRepository.recordDebtPayment).toHaveBeenCalledWith(expect.objectContaining({
      cashAmount: 3200,
      principalAmount: 800,
      extraPrincipalAmount: 2000,
      prepaymentEffect: "unknown",
      accountId: account.id,
      category: "Pago de deuda",
      allocations: [{ installmentId: installments[0].id, allocatedAmount: 1100 }],
    })));
  });

  it("submits a standalone principal prepayment with its selected effect", async () => {
    const user = userEvent.setup();
    renderOperation("prepayment");
    const amounts = screen.getAllByRole("spinbutton");

    await user.clear(amounts[0]);
    await user.type(amounts[0], "500");
    await user.clear(amounts[1]);
    await user.type(amounts[1], "500");
    await user.selectOptions(screen.getAllByRole("combobox")[1], "reduce_installment");
    await user.click(screen.getByRole("button", { name: "Confirmar operación" }));

    await waitFor(() => expect(dataRepository.recordDebtPrepayment).toHaveBeenCalledWith(expect.objectContaining({
      cashAmount: 500,
      principalAmount: 500,
      prepaymentEffect: "reduce_installment",
      scheduleInstallments: [],
      scheduleSource: null,
    })));
  });

  it("selects consecutive future installments and submits one advance allocation payload", async () => {
    const user = userEvent.setup();
    renderOperation("installment_advance");
    const checkboxes = screen.getAllByRole("checkbox");

    await user.click(checkboxes[1]);
    await user.click(checkboxes[2]);
    expect((screen.getAllByRole("spinbutton")[0] as HTMLInputElement).value).toBe("2300.00");
    await user.click(screen.getByRole("button", { name: "Confirmar operación" }));

    await waitFor(() => expect(dataRepository.recordDebtInstallmentAdvance).toHaveBeenCalledWith(expect.objectContaining({
      cashAmount: 2300,
      principalAmount: 1500,
      interestPaid: 650,
      insurancePaid: 150,
      allocations: [
        { installmentId: installments[0].id, allocatedAmount: 1100 },
        { installmentId: installments[1].id, allocatedAmount: 1200 },
      ],
    })));
  });

  it("submits the current rows through the append-only contractual schedule update", async () => {
    const user = userEvent.setup();
    renderOperation("schedule_update");

    await user.click(screen.getByRole("button", { name: "Guardar cronograma oficial" }));

    await waitFor(() => expect(dataRepository.updateDebtContractualSchedule).toHaveBeenCalledWith(expect.objectContaining({
      debtId: debt.id,
      reason: "manual_adjustment",
      scheduleInstallments: [
        expect.objectContaining({
          installmentNumber: 1,
          dueDate: installments[0].dueDate,
          expectedAmount: installments[0].expectedAmount,
          expectedPrincipal: installments[0].expectedPrincipal,
          expectedInterest: installments[0].expectedInterest,
          expectedFees: installments[0].expectedFees,
          expectedInsurance: installments[0].expectedInsurance,
        }),
        expect.objectContaining({ installmentNumber: 2, dueDate: installments[1].dueDate }),
      ],
    })));
  });
});
