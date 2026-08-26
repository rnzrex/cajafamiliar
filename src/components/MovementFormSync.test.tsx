// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Category, CreditCardPurchaseInput, Debt, FinancialAccount, HouseholdMember, Movement, MovementDraft } from "../types.js";
import { MovementForm } from "./MovementForm.js";

const member: HouseholdMember = {
  householdId: "household-1",
  userId: "user-1",
  displayName: "Renzo",
  role: "owner",
};

const cashAccount: FinancialAccount = {
  id: "cash-1",
  name: "Caja",
  reconciliationType: "cash",
  openingBalance: 0,
  currencyCode: "PEN",
  isActive: true,
  sortOrder: 1,
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
};

const bankAccount: FinancialAccount = {
  ...cashAccount,
  id: "bank-1",
  name: "Cuenta BCP",
  reconciliationType: "balance",
  sortOrder: 2,
};

const creditCard: Debt = {
  id: "card-1",
  name: "Visa Signature",
  creditorName: "Banco",
  debtKind: "credit_card",
  currencyCode: "PEN",
  originDate: null,
  trackingStartDate: "2026-08-01",
  originalPrincipal: null,
  openingPrincipalBalance: 100,
  plannedInstallmentCount: null,
  plannedInstallmentAmount: null,
  installmentAmountMode: "variable",
  paymentFrequency: "monthly",
  customFrequencyDays: null,
  firstDueDate: null,
  teaPercent: null,
  tceaPercent: null,
  notes: "",
  status: "active",
  isArchived: false,
  createdByUserId: "user-1",
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
};

const categories: Category[] = [
  {
    id: "category-food",
    name: "Alimentación",
    type: "egreso",
    color: "#2563eb",
    icon: "shopping-cart",
    is_active: true,
    created_at: "2026-08-01T00:00:00Z",
  },
  {
    id: "category-business",
    name: "Negocio",
    type: "ambos",
    color: "#16a34a",
    icon: "briefcase",
    is_active: true,
    created_at: "2026-08-01T00:00:00Z",
  },
];

const movement: Movement = {
  id: "movement-x",
  type: "egreso",
  date: "2026-08-20",
  amount: 10,
  description: "Original",
  method: "transferencia",
  category: "Alimentación",
  person: "Renzo",
  accountId: bankAccount.id,
  movementContext: "standard",
};

const recurringDraftA: MovementDraft = {
  type: "egreso",
  date: "2026-08-20",
  amount: 25,
  description: "Internet",
  method: "transferencia",
  category: "Alimentación",
  person: "Renzo",
  accountId: bankAccount.id,
};

const recurringDraftB: MovementDraft = {
  ...recurringDraftA,
  amount: 40,
  description: "Luz",
};

type MovementFormOptions = Partial<React.ComponentProps<typeof MovementForm>>;

function formElement(options: MovementFormOptions = {}) {
  const onQuickCreateCategory = options.onQuickCreateCategory ?? vi.fn();
  const onSave = options.onSave ?? vi.fn().mockResolvedValue(true);
  return (
    <MovementForm
      initialType="egreso"
      currentMember={member}
      categories={categories}
      accounts={[cashAccount]}
      onQuickCreateCategory={onQuickCreateCategory}
      onSave={onSave}
      {...options}
    />
  );
}

function renderForm(options: MovementFormOptions = {}) {
  return render(formElement(options));
}

describe("MovementForm sync draft preservation", () => {
  const interactionTimeout = 15_000;

  afterEach(cleanup);

  it("preserves a dirty new expense when authoritative arrays get equivalent new references", async () => {
    const user = userEvent.setup();
    const view = renderForm({ accounts: [cashAccount, bankAccount], creditCards: [creditCard] });

    const amount = screen.getByRole("spinbutton");
    const description = screen.getByRole("textbox", { name: "Descripción" });
    await user.type(amount, "87.50");
    await user.type(description, "Mercado");
    await user.click(screen.getByRole("button", { name: "Cambiar" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Categoría" }), "Alimentación");
    await user.selectOptions(screen.getByRole("combobox", { name: "Pagar con" }), bankAccount.id);
    await user.click(screen.getByRole("button", { name: "Cambiar fecha" }));
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-08-25" } });

    view.rerender(
      formElement({
        initialType: "egreso",
        currentMember: { ...member },
        categories: categories.map((category) => ({ ...category })),
        accounts: [{ ...cashAccount }, { ...bankAccount }],
        creditCards: [{ ...creditCard }],
      })
    );

    expect(Number((screen.getByRole("spinbutton") as HTMLInputElement).value)).toBe(87.5);
    expect((screen.getByRole("textbox", { name: "Descripción" }) as HTMLInputElement).value).toBe("Mercado");
    expect((screen.getByRole("combobox", { name: "Categoría" }) as HTMLSelectElement).value).toBe("Alimentación");
    expect((screen.getByRole("combobox", { name: "Pagar con" }) as HTMLSelectElement).value).toBe(bankAccount.id);
    expect((screen.getByLabelText("Fecha") as HTMLInputElement).value).toBe("2026-08-25");
  }, interactionTimeout);

  it("preserves a dirty new income across equivalent remote refreshes", async () => {
    const user = userEvent.setup();
    const view = renderForm({ initialType: "ingreso", accounts: [cashAccount, bankAccount] });

    await user.type(screen.getByRole("spinbutton"), "120");
    await user.type(screen.getByRole("textbox", { name: "Descripción" }), "Sueldo");
    await user.selectOptions(screen.getByRole("combobox", { name: "Cuenta de destino" }), bankAccount.id);

    view.rerender(formElement({
      initialType: "ingreso",
      currentMember: { ...member },
      accounts: [{ ...cashAccount }, { ...bankAccount }],
      categories: categories.map((category) => ({ ...category })),
    }));

    expect(Number((screen.getByRole("spinbutton") as HTMLInputElement).value)).toBe(120);
    expect((screen.getByRole("textbox", { name: "Descripción" }) as HTMLInputElement).value).toBe("Sueldo");
    expect((screen.getByRole("combobox", { name: "Cuenta de destino" }) as HTMLSelectElement).value).toBe(bankAccount.id);
  }, interactionTimeout);

  it("preserves an active card source when the same card returns as a new object", async () => {
    const user = userEvent.setup();
    const onSaveCreditCardPurchase = vi.fn(async (_input: CreditCardPurchaseInput) => true);
    const view = renderForm({
      accounts: [cashAccount],
      creditCards: [creditCard],
      onSaveCreditCardPurchase,
    });

    await user.selectOptions(screen.getByRole("combobox", { name: "Pagar con" }), "credit-card:card-1");
    await user.type(screen.getByRole("spinbutton"), "87.50");
    await user.type(screen.getByRole("textbox", { name: "Descripción" }), "Mercado");

    view.rerender(formElement({
      currentMember: { ...member },
      accounts: [{ ...cashAccount }],
      creditCards: [{ ...creditCard }],
      onSaveCreditCardPurchase,
      categories: categories.map((category) => ({ ...category })),
    }));

    expect((screen.getByRole("combobox", { name: "Pagar con" }) as HTMLSelectElement).value).toBe("credit-card:card-1");
    expect(Number((screen.getByRole("spinbutton") as HTMLInputElement).value)).toBe(87.5);
    expect((screen.getByRole("textbox", { name: "Descripción" }) as HTMLInputElement).value).toBe("Mercado");
  }, interactionTimeout);

  it("preserves edits for the same movement id and rehydrates only for a different id", async () => {
    const user = userEvent.setup();
    const view = renderForm({ movement, accounts: [cashAccount, bankAccount] });

    const amount = screen.getByRole("spinbutton");
    await user.clear(amount);
    await user.type(amount, "87.50");
    await user.clear(screen.getByRole("textbox", { name: "Descripción" }));
    await user.type(screen.getByRole("textbox", { name: "Descripción" }), "Mercado editado");
    await user.selectOptions(screen.getByRole("combobox", { name: "Categoría" }), "Negocio");

    view.rerender(formElement({
      movement: { ...movement, amount: 999, description: "Remote update", category: "Alimentación" },
      currentMember: { ...member },
      accounts: [{ ...cashAccount }, { ...bankAccount }],
      categories: categories.map((category) => ({ ...category })),
    }));

    expect(Number((screen.getByRole("spinbutton") as HTMLInputElement).value)).toBe(87.5);
    expect((screen.getByRole("textbox", { name: "Descripción" }) as HTMLInputElement).value).toBe("Mercado editado");
    expect((screen.getByRole("combobox", { name: "Categoría" }) as HTMLSelectElement).value).toBe("Negocio");

    view.rerender(formElement({
      movement: { ...movement, id: "movement-y", amount: 33, description: "Otro movimiento", category: "Alimentación" },
      currentMember: { ...member },
      accounts: [{ ...cashAccount }, { ...bankAccount }],
      categories: categories.map((category) => ({ ...category })),
    }));

    expect(Number((screen.getByRole("spinbutton") as HTMLInputElement).value)).toBe(33);
    expect((screen.getByRole("textbox", { name: "Descripción" }) as HTMLInputElement).value).toBe("Otro movimiento");
    expect((screen.getByRole("combobox", { name: "Categoría" }) as HTMLSelectElement).value).toBe("Alimentación");
  }, interactionTimeout);

  it("preserves a recurring draft until the explicit draft identity changes", async () => {
    const user = userEvent.setup();
    const view = renderForm({
      draft: recurringDraftA,
      draftIdentity: "recurring-a",
      accounts: [cashAccount, bankAccount],
    });

    await user.clear(screen.getByRole("textbox", { name: "Descripción" }));
    await user.type(screen.getByRole("textbox", { name: "Descripción" }), "Internet editado");

    view.rerender(formElement({
      draft: { ...recurringDraftA, description: "Remote draft refresh" },
      draftIdentity: "recurring-a",
      currentMember: { ...member },
      accounts: [{ ...cashAccount }, { ...bankAccount }],
    }));
    expect((screen.getByRole("textbox", { name: "Descripción" }) as HTMLInputElement).value).toBe("Internet editado");

    view.rerender(formElement({
      draft: recurringDraftB,
      draftIdentity: "recurring-b",
      currentMember: { ...member },
      accounts: [{ ...cashAccount }, { ...bankAccount }],
    }));
    expect(Number((screen.getByRole("spinbutton") as HTMLInputElement).value)).toBe(40);
    expect((screen.getByRole("textbox", { name: "Descripción" }) as HTMLInputElement).value).toBe("Luz");
  }, interactionTimeout);

  it("keeps an archived account selected and blocks save until explicit reselection", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => true);
    const view = renderForm({ accounts: [cashAccount, bankAccount], onSave });

    await user.selectOptions(screen.getByRole("combobox", { name: "Pagar con" }), bankAccount.id);
    await user.type(screen.getByRole("spinbutton"), "87.50");
    await user.type(screen.getByRole("textbox", { name: "Descripción" }), "Mercado");

    view.rerender(formElement({
      currentMember: { ...member },
      accounts: [{ ...cashAccount }, { ...bankAccount, isActive: false }],
      onSave,
      categories: categories.map((category) => ({ ...category })),
    }));

    expect((screen.getByRole("combobox", { name: "Pagar con" }) as HTMLSelectElement).value).toBe(bankAccount.id);
    expect(screen.getByText("La cuenta/tarjeta seleccionada ya no está disponible. Elige otra para guardar.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(onSave).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByRole("combobox", { name: "Pagar con" }), cashAccount.id);
    await user.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect((onSave.mock.calls as unknown[][])[0]?.[0]).toEqual(expect.objectContaining({ accountId: cashAccount.id }));
  }, interactionTimeout);

  it("keeps an archived or inactive card selected and never falls back to cash", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => true);
    const onSaveCreditCardPurchase = vi.fn(async (_input: CreditCardPurchaseInput) => true);
    const view = renderForm({ accounts: [cashAccount], creditCards: [creditCard], onSave, onSaveCreditCardPurchase });

    await user.selectOptions(screen.getByRole("combobox", { name: "Pagar con" }), "credit-card:card-1");
    await user.type(screen.getByRole("spinbutton"), "87.50");
    await user.type(screen.getByRole("textbox", { name: "Descripción" }), "Mercado");

    view.rerender(formElement({
      currentMember: { ...member },
      accounts: [{ ...cashAccount }],
      creditCards: [{ ...creditCard, status: "paid_off", isArchived: true }],
      onSave,
      onSaveCreditCardPurchase,
      categories: categories.map((category) => ({ ...category })),
    }));

    expect((screen.getByRole("combobox", { name: "Pagar con" }) as HTMLSelectElement).value).toBe("credit-card:card-1");
    expect(screen.getByText("La cuenta/tarjeta seleccionada ya no está disponible. Elige otra para guardar.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onSaveCreditCardPurchase).not.toHaveBeenCalled();
  }, interactionTimeout);

  it("preserves a manually selected category and blocks save if it disappears", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => true);
    const view = renderForm({ accounts: [cashAccount], onSave });

    await user.click(screen.getByRole("button", { name: "Cambiar" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Categoría" }), "Alimentación");
    await user.type(screen.getByRole("spinbutton"), "87.50");
    await user.type(screen.getByRole("textbox", { name: "Descripción" }), "Mercado");

    view.rerender(formElement({
      currentMember: { ...member },
      accounts: [{ ...cashAccount }],
      categories: categories.map((category) => category.id === "category-food" ? { ...category, is_active: false } : { ...category }),
      onSave,
    }));

    expect((screen.getByRole("combobox", { name: "Categoría" }) as HTMLSelectElement).value).toBe("Alimentación");
    expect(screen.getByText("La categoría seleccionada ya no está disponible. Elige otra para guardar.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(onSave).not.toHaveBeenCalled();
  }, interactionTimeout);

  it("clears a new form after a successful save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => true);
    renderForm({ onSave });

    await user.type(screen.getByRole("spinbutton"), "87.50");
    await user.type(screen.getByRole("textbox", { name: "Descripción" }), "Mercado");
    await user.click(screen.getByRole("button", { name: "Guardar gasto" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("textbox", { name: "Descripción" }) as HTMLInputElement).value).toBe("");
  }, interactionTimeout);
});
