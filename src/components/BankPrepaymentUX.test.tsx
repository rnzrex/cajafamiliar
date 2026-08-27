// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BankLoanProfile, Debt, DebtInstallment, DebtScheduleVersion, FinancialAccount } from "../types.js";
import * as dataRepository from "../services/dataRepository.js";
import { DebtOperationForm } from "./DebtOperationForm.js";

vi.mock("../services/dataRepository.js", async () => {
  const actual = await vi.importActual<typeof dataRepository>("../services/dataRepository.js");
  return {
    ...actual,
    recordDebtPrepayment: vi.fn().mockResolvedValue({}),
  };
});

const debt: Debt = {
  id: "debt-prepayment-ux",
  name: "Crédito ALFIN",
  creditorName: "ALFIN",
  debtKind: "bank_loan",
  currencyCode: "PEN",
  originDate: "2026-01-01",
  trackingStartDate: "2026-01-01",
  originalPrincipal: 1000,
  openingPrincipalBalance: 1000,
  plannedInstallmentCount: 1,
  plannedInstallmentAmount: 1100,
  installmentAmountMode: "fixed",
  paymentFrequency: "monthly",
  customFrequencyDays: null,
  firstDueDate: "2026-09-01",
  teaPercent: 15,
  tceaPercent: null,
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
  id: "account-prepayment-ux",
  name: "Cuenta principal",
  reconciliationType: "balance",
  openingBalance: 10000,
  currencyCode: "PEN",
  isActive: true,
  sortOrder: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const schedule: DebtScheduleVersion = {
  id: "schedule-prepayment-ux",
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

const installment: DebtInstallment = {
  id: "installment-prepayment-ux",
  scheduleVersionId: schedule.id,
  debtId: debt.id,
  installmentNumber: 1,
  contractualInstallmentNumber: 1,
  dueDate: "2026-09-01",
  expectedAmount: 1100,
  expectedPrincipal: 800,
  expectedInterest: 300,
  expectedFees: 0,
  expectedInsurance: 0,
  createdByUserId: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
};

const bankLoanProfile = {
  debtId: debt.id,
  householdId: "household-1",
  loanSubtype: "personal",
  contractNumber: null,
  amortizationMethod: "fixed_installment",
  disbursedAmount: 1000,
  assetPrice: null,
  downPaymentAmount: null,
  financedAmount: 1000,
  termInstallments: 1,
  installmentsPaidBeforeTracking: 0,
  interestDayCountBasis: "actual_days_360",
  dueDateAdjustmentRule: "contractual_dates",
  installmentTotalMode: "total_installment_including_costs",
  reportedBalanceKind: "principal_balance",
  reportedBalanceAmount: 1000,
  gracePeriodType: "none",
  gracePeriodInstallments: null,
  balloonPaymentAmount: null,
  notes: "",
  createdByUserId: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as BankLoanProfile;

function renderForm(operationType: "prepayment" | "installment_advance") {
  return render(
    <DebtOperationForm
      debt={debt}
      operationType={operationType}
      installments={[installment]}
      scheduleVersions={[schedule]}
      debtEvents={[]}
      accounts={[account]}
      categories={[]}
      currentPrincipal={1000}
      bankLoanProfile={bankLoanProfile}
      debtInsuranceTerms={[]}
      persistedAllocations={[]}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
      setToast={vi.fn()}
    />
  );
}

describe("bank prepayment UX", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  });

  it("calculates and saves an estimated reduce-term schedule after explicit confirmation", async () => {
    const user = userEvent.setup();
    renderForm("prepayment");
    const amounts = screen.getAllByRole("spinbutton");
    await user.clear(amounts[0]);
    await user.type(amounts[0], "200");
    await user.clear(amounts[1]);
    await user.type(amounts[1], "200");
    const operationDate = document.querySelector('input[type="date"]') as HTMLInputElement;
    await user.clear(operationDate);
    await user.type(operationDate, "2026-08-27");
    await user.click(screen.getByRole("button", { name: /^REDUCIR PLAZO/ }));
    await user.click(screen.getByRole("button", { name: "CALCULAR SIMULACIÓN" }));
    expect(screen.getByText("SIMULACIÓN DE CAJA FAMILIAR")).not.toBeNull();
    expect(screen.getByText("ESTIMACIÓN — EL BANCO PUEDE ENTREGAR IMPORTES DIFERENTES")).not.toBeNull();
    await user.click(screen.getByRole("checkbox", { name: /Confirmo que esto es una estimación/ }));
    await user.click(screen.getByRole("button", { name: "Confirmar operación" }));

    await waitFor(() => expect(dataRepository.recordDebtPrepayment).toHaveBeenCalledWith(expect.objectContaining({
      prepaymentEffect: "reduce_term",
      scheduleSource: "estimated",
      scheduleInstallments: [expect.objectContaining({ contractualInstallmentNumber: 1, reportedBalance: expect.any(Number) })],
    })));
  });

  it("keeps installment advance separate from prepayment choices", () => {
    renderForm("installment_advance");
    expect(screen.queryByRole("button", { name: /^REDUCIR PLAZO/ })).toBeNull();
    expect(screen.getByText("ADELANTO DE CUOTAS")).not.toBeNull();
  });

  it("offers the official-bank schedule path as a contractual replacement", async () => {
    const user = userEvent.setup();
    renderForm("prepayment");
    await user.click(screen.getByRole("button", { name: /^TENGO EL NUEVO CRONOGRAMA DEL BANCO/ }));
    expect((screen.getByRole("checkbox", { name: "El acreedor me entregó un nuevo cronograma" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Agregar cuota al nuevo cronograma")).not.toBeNull();
  });
});
