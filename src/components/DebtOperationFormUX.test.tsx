// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Debt, DebtEvent, DebtInstallment, DebtScheduleVersion, FinancialAccount } from "../types.js";
import * as dataRepository from "../services/dataRepository.js";
import { DebtOperationForm } from "./DebtOperationForm.js";
import { DebtScheduleUpdateForm } from "./DebtScheduleUpdateForm.js";

vi.mock("../services/dataRepository", async () => {
  const actual = await vi.importActual<typeof dataRepository>("../services/dataRepository.js");
  return {
    ...actual,
    recordDebtPayment: vi.fn().mockResolvedValue({}),
    recordDebtPrepayment: vi.fn().mockResolvedValue({}),
    recordDebtInstallmentAdvance: vi.fn().mockResolvedValue({}),
    reverseDebtEvent: vi.fn().mockResolvedValue({}),
    updateDebtContractualSchedule: vi.fn().mockResolvedValue({}),
    updateBankPrepaymentSchedule: vi.fn().mockResolvedValue({}),
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

function renderOperation(
  operationType: "payment" | "prepayment" | "payoff" | "reversal" | "installment_advance" | "schedule_update",
  paymentWithExtraPrincipal = false,
  setToast = vi.fn(),
  targetEventId?: string,
  customScheduleVersions: DebtScheduleVersion[] = [schedule],
  customDebtEvents: DebtEvent[] = [],
) {
  return render(
    <DebtOperationForm
      debt={debt}
      operationType={operationType}
      paymentWithExtraPrincipal={paymentWithExtraPrincipal}
      installments={installments}
      scheduleVersions={customScheduleVersions}
      debtEvents={customDebtEvents}
      targetEventId={targetEventId}
      accounts={[account]}
      categories={[]}
      currentPrincipal={10000}
      persistedAllocations={[]}
      onSaved={vi.fn().mockResolvedValue(undefined)}
      onCancel={vi.fn()}
      setToast={setToast}
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
    expect(screen.getByRole("button", { name: /^REDUCIR PLAZO/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /^REDUCIR CUOTA/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /^TENGO EL NUEVO CRONOGRAMA DEL BANCO/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /^BANCO TODAVÍA NO ME ENTREGA/ })).not.toBeNull();
    expect(screen.queryByText("Efecto solicitado al banco")).toBeNull();
    expect(screen.queryByText("El banco entregó el cronograma posterior a este abono")).toBeNull();
    expect(screen.queryByText("Estimado por Caja Familiar")).toBeNull();
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
      prepaymentEffect: "pending_bank_schedule",
      accountId: account.id,
      category: "Pago de deuda",
      allocations: [{ installmentId: installments[0].id, allocatedAmount: 1100 }],
    })));
  }, 15_000);

  it("submits a standalone bank prepayment as pending when no schedule exists", async () => {
    const user = userEvent.setup();
    renderOperation("prepayment");
    const amounts = screen.getAllByRole("spinbutton");

    await user.clear(amounts[0]);
    await user.type(amounts[0], "500");
    await user.clear(amounts[1]);
    await user.type(amounts[1], "500");
    await user.click(screen.getByRole("button", { name: "Confirmar operación" }));

    await waitFor(() => expect(dataRepository.recordDebtPrepayment).toHaveBeenCalledWith(expect.objectContaining({
      cashAmount: 500,
      principalAmount: 500,
      prepaymentEffect: "pending_bank_schedule",
      scheduleInstallments: [],
      scheduleSource: null,
    })));
  });

  it("rejects payment plus extra principal with a term change and no schedule", async () => {
    const user = userEvent.setup();
    const setToast = vi.fn();
    renderOperation("payment", true, setToast);
    const amounts = screen.getAllByRole("spinbutton");

    await user.clear(amounts[0]);
    await user.type(amounts[0], "500");
    await user.clear(amounts[1]);
    await user.type(amounts[1], "300");
    await user.clear(amounts[2]);
    await user.type(amounts[2], "100");
    await user.click(screen.getByRole("button", { name: /^REDUCIR PLAZO/ }));
    await user.click(screen.getByRole("button", { name: "Confirmar operación" }));

    expect(dataRepository.recordDebtPayment).not.toHaveBeenCalled();
    expect(setToast).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("selecciona 'Banco todavía no entrega cronograma'"),
      type: "error",
    }));
  });

  it("requires a complete six-field schedule for a bank prepayment", async () => {
    const user = userEvent.setup();
    renderOperation("prepayment");
    const amounts = screen.getAllByRole("spinbutton");

    await user.clear(amounts[0]);
    await user.type(amounts[0], "500");
    await user.clear(amounts[1]);
    await user.type(amounts[1], "500");
    await user.click(screen.getByRole("button", { name: /^TENGO EL NUEVO CRONOGRAMA DEL BANCO/ }));
    await user.click(screen.getByRole("button", { name: "Agregar cuota al nuevo cronograma" }));

    const dueDate = screen.getByLabelText("Fecha nueva cuota 1");
    await user.clear(dueDate);
    await user.type(dueDate, "2026-09-01");
    await user.type(screen.getByLabelText("Total nueva cuota 1"), "1000");
    await user.type(screen.getByLabelText("Capital nueva cuota 1"), "800");
    await user.type(screen.getByLabelText("Interés nueva cuota 1"), "150");
    await user.type(screen.getByLabelText("Comisiones nueva cuota 1"), "20");
    await user.type(screen.getByLabelText("Seguro nueva cuota 1"), "30");
    await user.click(screen.getByRole("button", { name: "Confirmar operación" }));

    await waitFor(() => expect(dataRepository.recordDebtPrepayment).toHaveBeenCalledWith(expect.objectContaining({
      prepaymentEffect: "other",
      scheduleInstallments: [{
        installmentNumber: 1,
        dueDate: "2026-09-01",
        expectedAmount: 1000,
        expectedPrincipal: 800,
        expectedInterest: 150,
        expectedFees: 20,
        expectedInsurance: 30,
      }],
      scheduleSource: "contractual",
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

  it("starts the official post-prepayment form empty and routes an explicitly entered schedule to the dedicated RPC", async () => {
    const user = userEvent.setup();
    const prepaymentEvent: DebtEvent = {
      id: "prepayment-qapaq-1",
      debtId: debt.id,
      eventDate: "2026-08-20",
      eventType: "principal_prepayment",
      cashAmount: 500,
      principalDelta: -500,
      interestPaid: 0,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      breakdownComplete: true,
      movementId: "movement-qapaq-1",
      reversalOfEventId: null,
      description: "Prepago",
      registeredByUserId: "user-1",
      createdAt: "2026-08-20T00:00:00Z",
      prepaymentEffect: "pending_bank_schedule",
    };
    const estimatedSchedule: DebtScheduleVersion = {
      ...schedule,
      id: "schedule-qapaq-estimated",
      versionNumber: 2,
      effectiveDate: "2026-08-20",
      reason: "prepayment",
      scheduleSource: "estimated",
      isAuthoritative: false,
      triggerEventId: prepaymentEvent.id,
    };
    const estimatedInstallments = installments.map((row) => ({ ...row, scheduleVersionId: estimatedSchedule.id }));
    render(
      <DebtOperationForm
        debt={debt}
        operationType="schedule_update"
        targetEventId={prepaymentEvent.id}
        installments={estimatedInstallments}
        scheduleVersions={[schedule, estimatedSchedule]}
        debtEvents={[prepaymentEvent]}
        accounts={[account]}
        categories={[]}
        currentPrincipal={9500}
        persistedAllocations={[]}
        onSaved={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
        setToast={vi.fn()}
      />
    );

    const saveButton = screen.getByRole("button", { name: "Guardar cronograma oficial del prepago" });
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Ingresa aquí únicamente el nuevo cronograma que te entregó el banco. La estimación anterior se muestra solo como referencia y no será convertida automáticamente en contractual.")).toBeTruthy();
    expect(screen.getByText("Referencia de solo lectura · Estimado")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Agregar cuota" }));
    await user.clear(screen.getByLabelText("Fecha cuota 1"));
    await user.type(screen.getByLabelText("Fecha cuota 1"), "2026-09-01");
    await user.type(screen.getByLabelText("Total cuota 1"), "1100");
    await user.type(screen.getByLabelText("Capital cuota 1"), "800");
    await user.type(screen.getByLabelText("Interés cuota 1"), "250");
    await user.type(screen.getByLabelText("Comisiones cuota 1"), "0");
    await user.type(screen.getByLabelText("Seguro cuota 1"), "50");
    await user.click(saveButton);

    await waitFor(() => expect(dataRepository.updateBankPrepaymentSchedule).toHaveBeenCalledWith(expect.objectContaining({
      debtId: debt.id,
      prepaymentEventId: prepaymentEvent.id,
      effectiveDate: prepaymentEvent.eventDate,
    })));
    expect(dataRepository.updateDebtContractualSchedule).not.toHaveBeenCalled();
  });

  it("restores the schedule before the first target version when estimated and official versions share the trigger", () => {
    const targetEvent: DebtEvent = {
      id: "prepayment-qapaq-reversal-target",
      debtId: debt.id,
      eventDate: "2026-08-20",
      eventType: "principal_prepayment",
      cashAmount: 500,
      principalDelta: -500,
      interestPaid: 0,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      breakdownComplete: true,
      movementId: "movement-qapaq-reversal-target",
      reversalOfEventId: null,
      description: "Prepago para reversión",
      registeredByUserId: "user-1",
      createdAt: "2026-08-20T00:00:00Z",
      prepaymentEffect: "reduce_term",
    };
    const estimatedSchedule: DebtScheduleVersion = {
      ...schedule,
      id: "schedule-qapaq-reversal-estimated",
      versionNumber: 2,
      effectiveDate: "2026-08-20",
      reason: "prepayment",
      scheduleSource: "estimated",
      isAuthoritative: false,
      triggerEventId: targetEvent.id,
    };
    const officialSchedule: DebtScheduleVersion = {
      ...schedule,
      id: "schedule-qapaq-reversal-official",
      versionNumber: 3,
      effectiveDate: "2026-08-20",
      reason: "prepayment",
      scheduleSource: "contractual",
      isAuthoritative: true,
      triggerEventId: targetEvent.id,
    };

    renderOperation("reversal", false, vi.fn(), targetEvent.id, [schedule, estimatedSchedule, officialSchedule], [targetEvent]);

    expect((screen.getByLabelText("Fecha cuota restaurada 1") as HTMLInputElement).value).toBe("2026-09-01");
    expect((screen.getByLabelText("Total cuota restaurada 1") as HTMLInputElement).value).toBe("1100");
    expect((screen.getByLabelText("Capital cuota restaurada 2") as HTMLInputElement).value).toBe("700");
  });

  it("does not prefill the official form from an old contractual schedule while a bank schedule is pending", () => {
    const pendingEvent: DebtEvent = {
      id: "prepayment-qapaq-pending",
      debtId: debt.id,
      eventDate: "2026-08-20",
      eventType: "principal_prepayment",
      cashAmount: 500,
      principalDelta: -500,
      interestPaid: 0,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      breakdownComplete: true,
      movementId: "movement-qapaq-pending",
      reversalOfEventId: null,
      description: "Prepago pendiente",
      registeredByUserId: "user-1",
      createdAt: "2026-08-21T00:00:00Z",
      prepaymentEffect: "pending_bank_schedule",
    };
    render(
      <DebtScheduleUpdateForm
        debt={debt}
        debtEvents={[pendingEvent]}
        installments={installments}
        scheduleVersions={[schedule]}
        mode="prepayment_schedule"
        prepaymentEventId={pendingEvent.id}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
        setToast={vi.fn()}
      />
    );

    expect((screen.getByRole("button", { name: "Guardar cronograma oficial del prepago" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText("Fecha cuota 1")).toBeNull();
    expect(screen.getByText("Referencia de solo lectura · Contractual")).toBeTruthy();
  });
});
