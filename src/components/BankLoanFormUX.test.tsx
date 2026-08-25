import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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
  it("renders DebtForm step 1 with bank loan options", () => {
    const html = renderToStaticMarkup(
      <DebtForm
        accounts={[]}
        categories={[]}
        setToast={() => {}}
        onSaved={() => {}}
        onCancel={() => {}}
        initialStep="type_select"
      />
    );

    expect(html).toContain("Préstamo bancario");
    expect(html).toContain("¿Qué deuda quieres registrar?");
  });

  it("renders DebtForm step 2 with Bank Loan Subtypes and Amortization Methods", () => {
    const html = renderToStaticMarkup(
      <DebtForm
        accounts={[]}
        categories={[]}
        setToast={() => {}}
        onSaved={() => {}}
        onCancel={() => {}}
        initialStep="details"
      />
    );

    expect(html).toContain("Tipo de Crédito Bancario");
    expect(html).toContain("Modalidad de Amortización");
    expect(html).toContain("Fuente del Cronograma");
    expect(html).toContain("A) Tengo el cronograma del banco");
    expect(html).toContain("B) No tengo cronograma; estimar cuota");
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
});
