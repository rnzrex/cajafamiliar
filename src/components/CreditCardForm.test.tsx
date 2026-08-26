// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreditCardDebtCreateInput, CreditCardDebtCreateResult } from "../types.js";
import { createCreditCardDebt } from "../services/dataRepository.js";
import { CreditCardForm } from "./CreditCardForm.js";

vi.mock("../services/dataRepository.js", () => ({
  createCreditCardDebt: vi.fn(),
  CreditCardOperationError: class CreditCardOperationError extends Error {},
}));

const createCreditCardDebtMock = vi.mocked(createCreditCardDebt);

function renderForm() {
  return render(
    <CreditCardForm
      onSaved={vi.fn().mockResolvedValue(undefined)}
      onCancel={vi.fn()}
      setToast={vi.fn()}
    />
  );
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Nombre de la tarjeta *"), { target: { value: "Visa Signature" } });
  fireEvent.change(screen.getByLabelText("Banco / acreedor *"), { target: { value: "BCP" } });
  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "100" } });
}

function submitForm() {
  const submitButton = screen.getByRole("button", { name: "Registrar tarjeta" });
  fireEvent.submit(submitButton.closest("form")!);
}

describe("CreditCardForm interest rate capture", () => {
  beforeEach(() => {
    createCreditCardDebtMock.mockReset();
    createCreditCardDebtMock.mockResolvedValue({} as CreditCardDebtCreateResult);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  afterEach(cleanup);

  it("includes independently entered TEA and TCEA in the create payload", async () => {
    renderForm();
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText("TEA (% anual)"), { target: { value: "49.90" } });
    fireEvent.change(screen.getByLabelText("TCEA (% anual)"), { target: { value: "62.40" } });
    submitForm();

    await waitFor(() => expect(createCreditCardDebtMock).toHaveBeenCalledTimes(1));
    const input = createCreditCardDebtMock.mock.calls[0]?.[0] as CreditCardDebtCreateInput;
    expect(input.teaPercent).toBe(49.9);
    expect(input.tceaPercent).toBe(62.4);
  });

  it("sends null for empty TEA and TCEA fields", async () => {
    renderForm();
    fillRequiredFields();
    submitForm();

    await waitFor(() => expect(createCreditCardDebtMock).toHaveBeenCalledTimes(1));
    const input = createCreditCardDebtMock.mock.calls[0]?.[0] as CreditCardDebtCreateInput;
    expect(input.teaPercent).toBeNull();
    expect(input.tceaPercent).toBeNull();
  });
});
