// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DebtForm } from "./DebtForm.js";
import { BANK_LOAN_SUBTYPE_OPTIONS, AMORTIZATION_METHOD_OPTIONS } from "../utils/bankCreditFormHelper.js";
import * as dataRepository from "../services/dataRepository.js";
import { addMonthsClamped } from "../utils/debtEstimation.js";
import { bankExternalAiPayloadText, BANK_EXTERNAL_AI_ALFIN_FIXTURE } from "../utils/bankExternalAiFixture.js";

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
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function scheduleLines(start: number, end: number): string {
    return Array.from({ length: end - start + 1 }, (_, index) => {
      const contractualNumber = start + index;
      return `${contractualNumber}\t${addMonthsClamped("2026-01-15", contractualNumber - 1)}\t100.00\t60.00\t30.00\t5.00\t5.00`;
    }).join("\n");
  }

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

  expect(screen.getByText("1. SOBRE EL CRÉDITO")).toBeTruthy();
  expect(screen.getByText("5. CRONOGRAMA *")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Agregar seguro" }));
    expect(screen.getByText("Seguro requerido")).toBeTruthy();

  const loanSubtype = screen.getAllByRole("combobox")[0];
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

  it("keeps the original first due date and blocks live baseline mismatches", async () => {
    const user = userEvent.setup();
    render(
      <DebtForm
        accounts={[]}
        categories={[]}
        setToast={() => {}}
        onSaved={() => {}}
        onCancel={() => {}}
        initialStep="details"
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Ej. Crédito personal BCP"), { target: { value: "Crédito existente" } });
    fireEvent.change(screen.getByPlaceholderText("Ej. Banco de Crédito del Perú"), { target: { value: "Banco V3" } });
    fireEvent.change(screen.getByPlaceholderText("Ej. 10000"), { target: { value: "10000" } });
    fireEvent.change(screen.getByPlaceholderText("Ej. 18"), { target: { value: "18" } });
    fireEvent.change(screen.getByPlaceholderText("Ej. 7300"), { target: { value: "7000" } });
    fireEvent.change(screen.getByLabelText("Última cuota contractual que ya pagaste"), { target: { value: "5" } });
    const originalFirstDueDate = screen.getByLabelText("Primera cuota ORIGINAL");
    fireEvent.change(originalFirstDueDate, { target: { value: "2026-01-15" } });
    const scheduleText = screen.getByLabelText(/Pegar filas del cronograma/);

    fireEvent.change(scheduleText, { target: { value: scheduleLines(6, 18) } });
    await user.click(screen.getByRole("button", { name: "Interpretar Cronograma" }));

    expect((originalFirstDueDate as HTMLInputElement).value).toBe("2026-01-15");
    expect(screen.getByText(/Primera cuota pendiente importada: 15\/06\/2026/)).toBeTruthy();

    const paidBeforeInput = screen.getByLabelText("Última cuota contractual que ya pagaste");
    fireEvent.change(paidBeforeInput, { target: { value: "4" } });
    expect(screen.getByRole("alert").textContent).toContain("Dijiste que la próxima cuota es la 5");
    fireEvent.change(paidBeforeInput, { target: { value: "5" } });
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(originalFirstDueDate, { target: { value: "" } });
    fireEvent.change(scheduleText, { target: { value: scheduleLines(1, 18) } });
    await user.click(screen.getByRole("button", { name: "Interpretar Cronograma" }));
    expect((originalFirstDueDate as HTMLInputElement).value).toBe("2026-01-15");
  }, 15_000);

  it("accepts pending-only official rows when current principal is supplied", async () => {
    const user = userEvent.setup();
    render(
      <DebtForm
        accounts={[]}
        categories={[]}
        setToast={() => {}}
        onSaved={() => {}}
        onCancel={() => {}}
        initialStep="details"
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Ej. Crédito personal BCP"), { target: { value: "Crédito existente" } });
    fireEvent.change(screen.getByPlaceholderText("Ej. Banco de Crédito del Perú"), { target: { value: "Banco V3" } });
    fireEvent.change(screen.getByPlaceholderText("Ej. 10000"), { target: { value: "10000" } });
    fireEvent.change(screen.getByPlaceholderText("Ej. 18"), { target: { value: "18" } });
    fireEvent.change(screen.getByPlaceholderText("Ej. 7300"), { target: { value: "7000" } });
    fireEvent.change(screen.getByLabelText("Última cuota contractual que ya pagaste"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/Pegar filas del cronograma/), { target: { value: scheduleLines(6, 18) } });
    await user.click(screen.getByRole("button", { name: "Interpretar Cronograma" }));
    await user.click(screen.getByRole("button", { name: "Revisar resumen" }));

    expect(screen.getByRole("button", { name: "Registrar deuda" })).toBeTruthy();
    expect(screen.getByText(/Próxima: 6 de 18/)).toBeTruthy();
    expect(screen.getByText("Contractual", { exact: true })).toBeTruthy();
  }, 15_000);

  it("blocks pending-only official rows when current principal is unavailable", async () => {
    const user = userEvent.setup();
    render(
      <DebtForm
        accounts={[]}
        categories={[]}
        setToast={() => {}}
        onSaved={() => {}}
        onCancel={() => {}}
        initialStep="details"
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Ej. Crédito personal BCP"), { target: { value: "Crédito existente" } });
    fireEvent.change(screen.getByPlaceholderText("Ej. Banco de Crédito del Perú"), { target: { value: "Banco V3" } });
    fireEvent.change(screen.getByPlaceholderText("Ej. 10000"), { target: { value: "10000" } });
    fireEvent.change(screen.getByPlaceholderText("Ej. 18"), { target: { value: "18" } });
    fireEvent.change(screen.getByLabelText("Última cuota contractual que ya pagaste"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/Pegar filas del cronograma/), { target: { value: scheduleLines(6, 18) } });
    await user.click(screen.getByRole("button", { name: "Interpretar Cronograma" }));
    expect((screen.getByPlaceholderText("Ej. 7300") as HTMLInputElement).required).toBe(true);
    await user.click(screen.getByRole("button", { name: "Revisar resumen" }));

    expect(screen.queryByRole("button", { name: "Registrar deuda" })).toBeNull();
  }, 15_000);

  it("imports the anonymized 18-row fixture through external AI without calling a provider", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network must not be needed for external import"));
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <DebtForm
        accounts={[]}
        categories={[]}
        setToast={() => {}}
        onSaved={() => {}}
        onCancel={() => {}}
        initialStep="details"
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Ej. Crédito personal BCP"), { target: { value: "Crédito externo" } });
    fireEvent.change(screen.getByPlaceholderText("Ej. Banco de Crédito del Perú"), { target: { value: "Banco fixture" } });
    fireEvent.change(screen.getByLabelText("Última cuota contractual que ya pagaste"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Respuesta de la IA externa"), { target: { value: bankExternalAiPayloadText() } });
    await user.click(screen.getByRole("button", { name: "INTERPRETAR RESPUESTA" }));
    await user.click(screen.getByRole("button", { name: "Revisar resumen" }));

    expect(fetchSpy).not.toHaveBeenCalledWith("/api/bank-document/analyze", expect.anything());
    expect(screen.getByText("Analizado con IA externa")).toBeTruthy();
    expect(screen.getByText("Resultado del análisis")).toBeTruthy();
    expect(screen.getByText("CRONOGRAMA COMPLETO")).toBeTruthy();
    expect(screen.getByText("18 cuotas detectadas e importadas")).toBeTruthy();
    expect(screen.getByText("Tenemos la información necesaria para continuar.")).toBeTruthy();
    expect(screen.getByText(/18 filas/)).toBeTruthy();
    expect(screen.getByText("Contractual", { exact: true })).toBeTruthy();
    expect(screen.getByText(/S\/\s*3,294\.39/)).toBeTruthy();
    expect(screen.getByText(/Próxima: 6 de 18/)).toBeTruthy();
    expect(BANK_EXTERNAL_AI_ALFIN_FIXTURE.schedule).toHaveLength(18);
  }, 15_000);

  it("shows an explicit missing-schedule review instead of treating term as imported rows", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network must not be needed for external import"));
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <DebtForm
        accounts={[]}
        categories={[]}
        setToast={() => {}}
        onSaved={() => {}}
        onCancel={() => {}}
        initialStep="details"
      />
    );

    const withoutSchedule = {
      ...BANK_EXTERNAL_AI_ALFIN_FIXTURE,
      schedule: [],
      teaPercent: null,
      extractionWarnings: [],
    };
    fireEvent.change(screen.getByPlaceholderText("Ej. Crédito personal BCP"), { target: { value: "Crédito sin cronograma" } });
    fireEvent.change(screen.getByPlaceholderText("Ej. Banco de Crédito del Perú"), { target: { value: "Banco fixture" } });
    fireEvent.change(screen.getByLabelText("Respuesta de la IA externa"), { target: { value: bankExternalAiPayloadText(withoutSchedule) } });
    await user.click(screen.getByRole("button", { name: "INTERPRETAR RESPUESTA" }));

    expect(screen.getByText("NO ENCONTRAMOS EL CRONOGRAMA")).toBeTruthy();
    expect(screen.getByText(/Vuelve a ejecutar el prompt asegurándote de adjuntar todas las páginas del cronograma/)).toBeTruthy();
    expect(screen.queryByText("cuotas detectadas e importadas")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/bank-document/analyze", expect.anything());
  }, 15_000);
});
