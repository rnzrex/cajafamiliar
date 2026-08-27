// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  }, 20_000);

  it("selects the contract entry method without auto-advancing", async () => {
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

    const external = screen.getByRole("button", { name: /Analizar con IA externa/ });
    const integrated = screen.getByRole("button", { name: /Importar automáticamente con IA/ });
    const reconstruction = screen.getByRole("button", { name: /Generar desde los datos del contrato/ });
    const manual = screen.getByRole("button", { name: /Ingresar manualmente/ });
    expect(external.getAttribute("aria-pressed")).toBe("true");
    expect(external.className).toContain("ring-2");

    for (const card of [integrated, reconstruction, manual]) {
      await user.click(card);
      expect(screen.getByRole("heading", { name: "¿Qué deuda quieres registrar?" })).toBeTruthy();
      expect(card.getAttribute("aria-pressed")).toBe("true");
      expect(card.className).toContain("border-indigo-500");
      expect(external.getAttribute("aria-pressed")).toBe("false");
    }

    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByText("1. SOBRE EL CRÉDITO")).toBeTruthy();
  });

  it("requires a positive integer last paid installment for existing debt", () => {
    const setToast = vi.fn();
    render(
      <DebtForm
        accounts={[]}
        categories={[]}
        setToast={setToast}
        onSaved={() => {}}
        onCancel={() => {}}
        initialStep="details"
      />
    );

    const input = screen.getByLabelText("Última cuota contractual que ya pagaste") as HTMLInputElement;
    expect(input.required).toBe(true);
    expect(input.min).toBe("1");
    expect(input.step).toBe("1");
    expect(input.placeholder).toBe("Ej. 5");
    expect(screen.getByRole("alert").textContent).toContain("Indica cuál fue la última cuota contractual que ya pagaste.");

    fireEvent.change(input, { target: { value: "0" } });
    expect(screen.getByRole("alert").textContent).toContain("número entero mayor o igual a 1");
    fireEvent.change(input, { target: { value: "5" } });
    expect(screen.queryByText("Indica cuál fue la última cuota contractual que ya pagaste.", { exact: true })).toBeNull();
    expect(setToast).not.toHaveBeenCalled();
  });

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
    await user.click(screen.getByRole("button", { name: "EDITAR O REEMPLAZAR CRONOGRAMA" }));
    fireEvent.change(screen.getByLabelText(/Pegar filas del cronograma/), { target: { value: scheduleLines(1, 18) } });
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

    expect(fetchSpy).not.toHaveBeenCalledWith("/api/bank-document/analyze", expect.anything());
    expect(screen.getByText("CRONOGRAMA CARGADO AUTOMÁTICAMENTE")).toBeTruthy();
    expect(screen.getByText("18 cuotas contractuales cargadas")).toBeTruthy();
    expect(screen.getByText("18 de 18 cuotas")).toBeTruthy();
    expect(screen.queryByLabelText("Pegar filas del cronograma")).toBeNull();
    expect(screen.queryByText("No se encontraron filas válidas en el cronograma.")).toBeNull();
    expect(screen.getAllByText("2026-06-10").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2027-11-10").length).toBeGreaterThan(0);
    expect(screen.getAllByText("138.91").length).toBeGreaterThan(0);
    expect(screen.getAllByText("331.92").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "CALCULAR" })).toBeTruthy();
    expect((screen.getByPlaceholderText("Ej. 7300") as HTMLInputElement).value).toBe("");
    await user.click(screen.getByRole("button", { name: "CALCULAR" }));
    expect((screen.getByPlaceholderText("Ej. 7300") as HTMLInputElement).value).toBe("3294.39");
    await user.click(screen.getByRole("button", { name: "Revisar resumen" }));

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

  it("keeps imported full schedule pending until last paid installment is entered", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network must not be needed for external import")));
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

    fireEvent.change(screen.getByPlaceholderText("Ej. Crédito personal BCP"), { target: { value: "Crédito con baseline pendiente" } });
    fireEvent.change(screen.getByPlaceholderText("Ej. Banco de Crédito del Perú"), { target: { value: "Banco fixture" } });
    fireEvent.change(screen.getByLabelText("Respuesta de la IA externa"), { target: { value: bankExternalAiPayloadText() } });
    await user.click(screen.getByRole("button", { name: "INTERPRETAR RESPUESTA" }));

    expect(screen.getByText("Indica la última cuota pagada para ubicar tu próxima cuota.")).toBeTruthy();
    expect(screen.queryByText(/Última pagada: 0/)).toBeNull();
    expect(screen.queryByText(/Calculado con el cronograma: S\/ 4100\.00/)).toBeNull();

    fireEvent.change(screen.getByLabelText("Última cuota contractual que ya pagaste"), { target: { value: "5" } });
    expect(screen.getByText(/Podemos calcularlo con tu cronograma: S\/ 3294\.39\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "CALCULAR" })).toBeTruthy();
    expect((screen.getByPlaceholderText("Ej. 7300") as HTMLInputElement).value).toBe("");
    await user.click(screen.getByRole("button", { name: "CALCULAR" }));
    expect((screen.getByPlaceholderText("Ej. 7300") as HTMLInputElement).value).toBe("3294.39");
    expect(screen.queryByRole("button", { name: "CALCULAR" })).toBeNull();
    expect(screen.getByText(/Última pagada: 5 · Próxima: 6 de 18 · Pendientes: 13/)).toBeTruthy();
  }, 15_000);

  it("recalculates confirmed principal, supports manual override, and invalidates stale derived values", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network must not be needed for external import")));
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

    fireEvent.change(screen.getByPlaceholderText("Ej. Crédito personal BCP"), { target: { value: "Crédito calculable" } });
    fireEvent.change(screen.getByPlaceholderText("Ej. Banco de Crédito del Perú"), { target: { value: "Banco fixture" } });
    fireEvent.change(screen.getByLabelText("Respuesta de la IA externa"), { target: { value: bankExternalAiPayloadText() } });
    await user.click(screen.getByRole("button", { name: "INTERPRETAR RESPUESTA" }));

    const paidBeforeInput = screen.getByLabelText("Última cuota contractual que ya pagaste");
    const principalInput = screen.getByPlaceholderText("Ej. 7300") as HTMLInputElement;
    expect(screen.queryByRole("button", { name: "CALCULAR" })).toBeNull();

    fireEvent.change(paidBeforeInput, { target: { value: "5" } });
    await user.click(screen.getByRole("button", { name: "CALCULAR" }));
    expect(principalInput.value).toBe("3294.39");

    fireEvent.change(paidBeforeInput, { target: { value: "6" } });
    expect(principalInput.value).not.toBe("3294.39");
    expect(principalInput.value).not.toBe("");

    fireEvent.change(principalInput, { target: { value: "3000" } });
    expect(principalInput.value).toBe("3000");
    fireEvent.change(paidBeforeInput, { target: { value: "5" } });
    expect(principalInput.value).toBe("3000");

    // Clear the manual override, re-select the derived action, then deleting
    // its required historical input must clear the stale derived balance.
    fireEvent.change(principalInput, { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: "CALCULAR" }));
    fireEvent.change(paidBeforeInput, { target: { value: "" } });
    await waitFor(() => expect(principalInput.value).toBe(""));
    expect(screen.queryByRole("button", { name: "CALCULAR" })).toBeNull();
  }, 15_000);

  it("keeps an explicitly imported principal and does not offer a duplicate calculation action", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network must not be needed for external import")));
    const withImportedPrincipal = {
      ...BANK_EXTERNAL_AI_ALFIN_FIXTURE,
      reportedBalance: { amount: 3961.09, label: "Saldo Capital", inferredKind: "principal_balance" as const, confidence: 0.99 },
    };
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

    fireEvent.change(screen.getByPlaceholderText("Ej. Crédito personal BCP"), { target: { value: "Crédito con saldo informado" } });
    fireEvent.change(screen.getByPlaceholderText("Ej. Banco de Crédito del Perú"), { target: { value: "Banco fixture" } });
    fireEvent.change(screen.getByLabelText("Respuesta de la IA externa"), { target: { value: bankExternalAiPayloadText(withImportedPrincipal) } });
    await user.click(screen.getByRole("button", { name: "INTERPRETAR RESPUESTA" }));

    expect((screen.getByPlaceholderText("Ej. 7300") as HTMLInputElement).value).toBe("3961.09");
    expect(screen.queryByRole("button", { name: "CALCULAR" })).toBeNull();
  }, 15_000);

  it("keeps an imported schedule while opening, cancelling, or submitting an empty replacement", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network must not be needed for external import")));
    const withReportedBalance = {
      ...BANK_EXTERNAL_AI_ALFIN_FIXTURE,
      schedule: BANK_EXTERNAL_AI_ALFIN_FIXTURE.schedule.map((row, index) => index === 0 ? { ...row, reportedBalance: 3961.09 } : row),
    };
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
    fireEvent.change(screen.getByLabelText("Respuesta de la IA externa"), { target: { value: bankExternalAiPayloadText(withReportedBalance) } });
    await user.click(screen.getByRole("button", { name: "INTERPRETAR RESPUESTA" }));

    expect(screen.queryByLabelText("Pegar filas del cronograma")).toBeNull();
    expect(screen.getAllByText("3,961.09").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "EDITAR O REEMPLAZAR CRONOGRAMA" }));
    expect(screen.getByLabelText("Pegar filas del cronograma")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Interpretar Cronograma" }));
    expect(screen.getByText("No has ingresado filas para reemplazar el cronograma.")).toBeTruthy();

    const scheduleFileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(scheduleFileInput, { target: { files: [new File(["not a schedule"], "broken.csv", { type: "text/csv" })] } });
    await waitFor(() => expect(screen.getAllByText("No pudimos identificar la fila de encabezados del cronograma.").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("button", { name: "CANCELAR REEMPLAZO" }));
    expect(screen.queryByLabelText("Pegar filas del cronograma")).toBeNull();
    expect(screen.getByText("18 cuotas contractuales cargadas")).toBeTruthy();
    expect(screen.getAllByText("3,961.09").length).toBeGreaterThan(0);
  }, 15_000);

  it("replaces an imported schedule only after valid manual input and labels its provenance", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network must not be needed for external import")));
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

    fireEvent.change(screen.getByPlaceholderText("Ej. Crédito personal BCP"), { target: { value: "Crédito reemplazable" } });
    fireEvent.change(screen.getByPlaceholderText("Ej. Banco de Crédito del Perú"), { target: { value: "Banco fixture" } });
    fireEvent.change(screen.getByLabelText("Respuesta de la IA externa"), { target: { value: bankExternalAiPayloadText() } });
    await user.click(screen.getByRole("button", { name: "INTERPRETAR RESPUESTA" }));
    await user.click(screen.getByRole("button", { name: "EDITAR O REEMPLAZAR CRONOGRAMA" }));
    fireEvent.change(screen.getByLabelText("Pegar filas del cronograma"), { target: { value: scheduleLines(1, 18) } });
    await user.click(screen.getByRole("button", { name: "Interpretar Cronograma" }));

    expect(screen.getByText("Ingresado manualmente")).toBeTruthy();
    expect(screen.getByText("18 de 18 cuotas")).toBeTruthy();
    expect(screen.getAllByText("2026-01-15").length).toBeGreaterThan(0);
    expect(screen.queryByText("Analizado con IA externa")).toBeNull();
  }, 15_000);

  it("saves the imported operational rows instead of reading the hidden textarea", async () => {
    const user = userEvent.setup();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network must not be needed for external import")));
    const onSaved = vi.fn();
    render(
      <DebtForm
        accounts={[]}
        categories={[]}
        setToast={() => {}}
        onSaved={onSaved}
        onCancel={() => {}}
        initialStep="details"
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Ej. Crédito personal BCP"), { target: { value: "Crédito guardable" } });
    fireEvent.change(screen.getByPlaceholderText("Ej. Banco de Crédito del Perú"), { target: { value: "Banco fixture" } });
    fireEvent.change(screen.getByLabelText("Última cuota contractual que ya pagaste"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Respuesta de la IA externa"), { target: { value: bankExternalAiPayloadText() } });
    await user.click(screen.getByRole("button", { name: "INTERPRETAR RESPUESTA" }));
    await user.click(screen.getByRole("button", { name: "CALCULAR" }));
    await user.click(screen.getByRole("button", { name: "Revisar resumen" }));
    await user.click(screen.getByRole("button", { name: "Registrar deuda" }));

    await waitFor(() => expect(dataRepository.createBankLoan).toHaveBeenCalled());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ debt: expect.objectContaining({ id: "test-bank-1" }) })));
    const savedInput = vi.mocked(dataRepository.createBankLoan).mock.calls.at(-1)?.[0];
    expect(savedInput?.installmentsPaidBeforeTracking).toBe(5);
    expect(savedInput?.installments).toHaveLength(18);
    expect(savedInput?.installments[0]?.dueDate).toBe("2026-06-10");
    expect(savedInput?.installments[17]?.expectedPrincipal).toBe(331.92);
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
