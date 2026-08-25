// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DebtForm } from "./DebtForm.js";
import { BANK_LOAN_SUBTYPE_OPTIONS, AMORTIZATION_METHOD_OPTIONS } from "../utils/bankCreditFormHelper.js";
import * as dataRepository from "../services/dataRepository.js";

vi.mock("../services/dataRepository", async () => {
  const actual = await vi.importActual<typeof dataRepository>("../services/dataRepository.js");
  return {
    ...actual,
    createBankLoan: vi.fn().mockResolvedValue({
      debt: { id: "test-bank-1" },
      scheduleVersion: null,
      installments: [],
      collaterals: [],
    }),
    createDebt: vi.fn(),
  };
});

describe("BankLoanFormUX - Bank Credit Contract V2 Onboarding", () => {
  afterEach(cleanup);

  it("advances from type selection to bank details and toggles estimation", async () => {
    const user = userEvent.setup();
    render(
      <DebtForm
        accounts={[]}
        categories={[]}
        setToast={() => {}}
        onSaved={() => {}}
        onCancel={() => {}}
        initialStep="type_select"
      />
    );

    expect(screen.getByRole("heading", { name: "¿Qué deuda quieres registrar?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(screen.getByText("Datos del Crédito Bancario / Financiero")).toBeTruthy();
    expect(screen.getByText("Fuente del Cronograma *")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Agregar seguro" }));
    expect(screen.getByText("Seguro requerido")).toBeTruthy();

    const loanSubtype = screen.getAllByRole("combobox")[1];
    await user.selectOptions(loanSubtype, "mortgage");
    expect(screen.getByText("¿Cómo se cubre el desgravamen? *")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /B\) No tengo cronograma/ }));
    expect(screen.getByRole("button", { name: "Generar Cronograma Estimado (Caja Familiar)" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Generar Cronograma Estimado (Caja Familiar)" }));
    expect(screen.getByText("El monto financiado debe ser mayor a cero.")).toBeTruthy();
  }, 10_000);

  it("exposes all required bank loan subtype options", () => {
    const values = BANK_LOAN_SUBTYPE_OPTIONS.map((o) => o.value);
    expect(values).toContain("personal");
    expect(values).toContain("vehicular");
    expect(values).toContain("mortgage");
    expect(values).toContain("education");
    expect(values).toContain("payroll");
    expect(values).toContain("debt_consolidation");
    expect(values).toContain("business");
    expect(values).toContain("other");
  });

  it("exposes all required amortization method options", () => {
    const values = AMORTIZATION_METHOD_OPTIONS.map((o) => o.value);
    expect(values).toContain("fixed_installment");
    expect(values).toContain("constant_principal");
    expect(values).toContain("increasing_installment");
    expect(values).toContain("decreasing_installment");
    expect(values).toContain("irregular_contract");
    expect(values).toContain("custom");
    expect(values).toContain("unknown");
  });
});
