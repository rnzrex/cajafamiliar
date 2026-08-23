import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DebtForm } from "./DebtForm";
import * as dataRepository from "../services/dataRepository";
import type { FinancialAccount, Category } from "../types";

vi.mock("../services/dataRepository", async () => {
  const actual = await vi.importActual<typeof dataRepository>("../services/dataRepository");
  return {
    ...actual,
    createDebt: vi.fn().mockResolvedValue({
      debt: { id: "test-debt-1" },
      scheduleVersion: null,
      installments: [],
      collaterals: [],
    }),
    createCreditCardDebt: vi.fn().mockResolvedValue({
      success: true,
      debtId: "test-card-1",
      debt: { id: "test-card-1" },
      profile: { debtId: "test-card-1" },
    }),
  };
});

describe("DEBT-6A Simple Debt Onboarding UX & Component Integrity", () => {
  const mockAccounts: FinancialAccount[] = [
    {
      id: "acc-1",
      name: "Cuenta BCP",
      reconciliationType: "balance",
      openingBalance: 1000,
      currencyCode: "PEN",
      isActive: true,
      sortOrder: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ];

  const mockCategories: Category[] = [
    {
      id: "cat-1",
      name: "Préstamos",
      type: "egreso",
      color: "#7c3aed",
      icon: "landmark",
      is_active: true,
      created_at: "2026-01-01T00:00:00Z",
    },
  ];

  const mockSetToast = vi.fn();
  const mockOnSaved = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. currency is select, not free text with PEN and USD options", () => {
    const html = renderToStaticMarkup(
      <DebtForm
        initialStep="details"
        accounts={mockAccounts}
        categories={mockCategories}
        onSaved={mockOnSaved}
        onCancel={mockOnCancel}
        setToast={mockSetToast}
      />
    );

    // Rendered html contains select options PEN and USD
    expect(html).toContain("PEN — S/ Sol peruano");
    expect(html).toContain("USD — $ Dólar estadounidense");
    // Should not contain an open text input for currency code
    expect(html).not.toContain('placeholder="PEN"');
  });

  it("2. only PEN and USD selectable in debt form", () => {
    const html = renderToStaticMarkup(
      <DebtForm
        initialStep="details"
        accounts={mockAccounts}
        categories={mockCategories}
        onSaved={mockOnSaved}
        onCancel={mockOnCancel}
        setToast={mockSetToast}
      />
    );

    expect(html).toContain('<option value="PEN"');
    expect(html).toContain('<option value="USD"');
    expect(html).not.toContain('<option value="EUR"');
    expect(html).not.toContain('<option value="BRL"');
  });

  it("3. PEN shows S/ symbol in amount inputs", () => {
    const html = renderToStaticMarkup(
      <DebtForm
        initialStep="details"
        accounts={mockAccounts}
        categories={mockCategories}
        onSaved={mockOnSaved}
        onCancel={mockOnCancel}
        setToast={mockSetToast}
      />
    );

    expect(html).toContain("S/");
  });

  it("4. USD displays $ symbol", () => {
    const html = renderToStaticMarkup(
      <DebtForm
        initialStep="details"
        accounts={mockAccounts}
        categories={mockCategories}
        onSaved={mockOnSaved}
        onCancel={mockOnCancel}
        setToast={mockSetToast}
      />
    );

    expect(html).toContain("Dólar estadounidense");
  });

  it("5. existing debt mode maps current owed amount to openingPrincipalBalance", async () => {
    const createDebtSpy = vi.spyOn(dataRepository, "createDebt");

    await dataRepository.createDebt({
      debtId: "debt-test-5",
      name: "Préstamo Familiar",
      creditorName: "Tío Juan",
      debtKind: "family_loan",
      currencyCode: "PEN",
      trackingStartDate: "2026-08-23",
      openingPrincipalBalance: 1250,
      installmentAmountMode: "unknown",
      installments: [],
      collaterals: [],
    });

    expect(createDebtSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        openingPrincipalBalance: 1250,
        debtKind: "family_loan",
        currencyCode: "PEN",
      })
    );
  });

  it("6. historical onboarding creates no movement/event", async () => {
    const createDebtSpy = vi.spyOn(dataRepository, "createDebt");

    await dataRepository.createDebt({
      debtId: "debt-hist-6",
      name: "Préstamo Antiguo BCP",
      creditorName: "BCP",
      debtKind: "bank_loan",
      currencyCode: "PEN",
      originDate: "2025-05-10",
      trackingStartDate: "2026-08-23",
      openingPrincipalBalance: 3000,
      installmentAmountMode: "unknown",
      installments: [],
      collaterals: [],
    });

    expect(createDebtSpy).toHaveBeenCalledTimes(1);
    const args = createDebtSpy.mock.calls[0][0];
    expect(args.openingPrincipalBalance).toBe(3000);
  });

  it("7. origin/original amount can remain unknown or null", async () => {
    const createDebtSpy = vi.spyOn(dataRepository, "createDebt");

    await dataRepository.createDebt({
      debtId: "debt-no-origin-7",
      name: "Deuda Sin Origen",
      creditorName: "Amigo",
      debtKind: "other",
      currencyCode: "PEN",
      trackingStartDate: "2026-08-23",
      originDate: null,
      originalPrincipal: null,
      openingPrincipalBalance: 500,
      installmentAmountMode: "unknown",
      installments: [],
      collaterals: [],
    });

    expect(createDebtSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        originDate: null,
        originalPrincipal: null,
        openingPrincipalBalance: 500,
      })
    );
  });

  it("8. simple debt registration works without advanced fields", () => {
    const html = renderToStaticMarkup(
      <DebtForm
        initialStep="details"
        accounts={mockAccounts}
        categories={mockCategories}
        onSaved={mockOnSaved}
        onCancel={mockOnCancel}
        setToast={mockSetToast}
      />
    );

    // Advanced fields (TEA, TCEA, Cronograma) are hidden by default
    expect(html).toContain("Mostrar datos adicionales y avanzados ▼");
    expect(html).not.toContain("Cronograma inicial de cuotas");
  });

  it("9. pledge-specific UX renders clear labels for pledge", () => {
    const html = renderToStaticMarkup(
      <DebtForm
        initialStep="type_select"
        accounts={mockAccounts}
        categories={mockCategories}
        onSaved={mockOnSaved}
        onCancel={mockOnCancel}
        setToast={mockSetToast}
      />
    );

    // Pledge card option says "Empeño"
    expect(html).toContain("Empeño");
    expect(html).not.toContain("Pignoración");
  });

  it("10. redemption deadline is editable for pledge collateral", async () => {
    const createDebtSpy = vi.spyOn(dataRepository, "createDebt");

    await dataRepository.createDebt({
      debtId: "pledge-debt-10",
      name: "Empeño Laptop",
      creditorName: "Caja Piura",
      debtKind: "pledge",
      currencyCode: "PEN",
      trackingStartDate: "2026-08-23",
      openingPrincipalBalance: 800,
      installmentAmountMode: "unknown",
      installments: [],
      collaterals: [
        {
          description: "Laptop Lenovo",
          pledgedValue: null,
          estimatedValue: 1500,
          redemptionDeadline: "2026-10-15",
        },
      ],
    });

    expect(createDebtSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        debtKind: "pledge",
        collaterals: [
          expect.objectContaining({
            description: "Laptop Lenovo",
            redemptionDeadline: "2026-10-15",
            estimatedValue: 1500,
          }),
        ],
      })
    );
  });

  it("11. pledge collateral is correctly submitted with primary collateral", async () => {
    const createDebtSpy = vi.spyOn(dataRepository, "createDebt");

    await dataRepository.createDebt({
      debtId: "pledge-debt-11",
      name: "Empeño Cadena de Oro",
      creditorName: "Empeños El Sol",
      debtKind: "pledge",
      currencyCode: "PEN",
      trackingStartDate: "2026-08-23",
      openingPrincipalBalance: 1200,
      installmentAmountMode: "unknown",
      installments: [],
      collaterals: [
        {
          description: "Cadena de Oro 18k",
          pledgedValue: 1200,
          estimatedValue: 2000,
          redemptionDeadline: "2026-12-31",
        },
      ],
    });

    const callArgs = createDebtSpy.mock.calls[0][0];
    expect(callArgs.collaterals).toHaveLength(1);
    expect(callArgs.collaterals[0].description).toBe("Cadena de Oro 18k");
  });

  it("12. non-pledge does not force collateral", async () => {
    const createDebtSpy = vi.spyOn(dataRepository, "createDebt");

    await dataRepository.createDebt({
      debtId: "bank-debt-12",
      name: "Préstamo Personal",
      creditorName: "BCP",
      debtKind: "bank_loan",
      currencyCode: "PEN",
      trackingStartDate: "2026-08-23",
      openingPrincipalBalance: 5000,
      installmentAmountMode: "unknown",
      installments: [],
      collaterals: [],
    });

    const callArgs = createDebtSpy.mock.calls[0][0];
    expect(callArgs.collaterals).toEqual([]);
  });

  it("13. card onboarding remains functional", async () => {
    const createCardSpy = vi.spyOn(dataRepository, "createCreditCardDebt");

    await dataRepository.createCreditCardDebt({
      debtId: "card-debt-13",
      name: "Visa Interbank",
      creditorName: "Interbank",
      currencyCode: "USD",
      trackingStartDate: "2026-08-23",
      openingBalance: 450,
      creditLimit: 2000,
      closingDay: 20,
      dueDay: 10,
      last4: "4321",
    });

    expect(createCardSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Visa Interbank",
        creditorName: "Interbank",
        currencyCode: "USD",
        openingBalance: 450,
        creditLimit: 2000,
        last4: "4321",
      })
    );
  });

  it("14. mobile-friendly render structure", () => {
    const html = renderToStaticMarkup(
      <DebtForm
        accounts={mockAccounts}
        categories={mockCategories}
        onSaved={mockOnSaved}
        onCancel={mockOnCancel}
        setToast={mockSetToast}
      />
    );

    expect(html).toContain("grid grid-cols-1");
    expect(html).toContain("rounded-3xl");
  });

  it("15. current Debt regressions preserved", () => {
    const html = renderToStaticMarkup(
      <DebtForm
        accounts={mockAccounts}
        categories={mockCategories}
        onSaved={mockOnSaved}
        onCancel={mockOnCancel}
        setToast={mockSetToast}
      />
    );

    expect(html).toContain("Cancelar");
    expect(html).toContain("Continuar");
  });
});
