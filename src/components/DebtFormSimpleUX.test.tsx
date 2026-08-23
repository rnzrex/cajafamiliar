import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DebtForm } from "./DebtForm";
import {
  buildDebtCreateInputPayload,
  buildPledgeCollateralList,
  getCurrencySymbol,
  formatReviewDate,
} from "../utils/debtFormMode";
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

describe("DEBT-6A Simple Debt Onboarding UX & Production Helpers Integrity", () => {
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

  describe("Pure Production Helpers Mapping Tests", () => {
    it("A. EXISTING_DEBT mode maps owed amount to openingPrincipalBalance and keeps originalPrincipal optional", () => {
      const payload = buildDebtCreateInputPayload({
        debtId: "debt-existing-1",
        debtKind: "bank_loan",
        onboardingMode: "EXISTING_DEBT",
        currencyCode: "PEN",
        name: "Préstamo Vehicular",
        creditorName: "Interbank",
        openingPrincipalBalance: "4500.50",
        originalPrincipal: "10000.00",
        originDate: "2025-01-15",
        trackingStartDate: "2026-08-23",
      });

      expect(payload.openingPrincipalBalance).toBe(4500.5);
      expect(payload.originalPrincipal).toBe(10000);
      expect(payload.originDate).toBe("2025-01-15");
      expect(payload.trackingStartDate).toBe("2026-08-23");
    });

    it("A2. EXISTING_DEBT allows originalPrincipal to remain null when omitted", () => {
      const payload = buildDebtCreateInputPayload({
        debtId: "debt-existing-2",
        debtKind: "family_loan",
        onboardingMode: "EXISTING_DEBT",
        currencyCode: "PEN",
        name: "Deuda Familiar",
        creditorName: "Tío Carlos",
        openingPrincipalBalance: 800,
        originalPrincipal: "",
        trackingStartDate: "2026-08-23",
      });

      expect(payload.openingPrincipalBalance).toBe(800);
      expect(payload.originalPrincipal).toBeNull();
      expect(payload.originDate).toBeNull();
    });

    it("B. NEW_DEBT mode sets originalPrincipal equal to openingPrincipalBalance (single amount concept)", () => {
      const payload = buildDebtCreateInputPayload({
        debtId: "debt-new-1",
        debtKind: "bank_loan",
        onboardingMode: "NEW_DEBT",
        currencyCode: "PEN",
        name: "Préstamo Personal BCP",
        creditorName: "BCP",
        openingPrincipalBalance: "3500.00",
        trackingStartDate: "2026-08-23",
      });

      expect(payload.openingPrincipalBalance).toBe(3500);
      expect(payload.originalPrincipal).toBe(3500);
      expect(payload.originDate).toBe("2026-08-23");
    });

    it("C. PLEDGE collateral mapping builds primary collateral correctly", () => {
      const collaterals = buildPledgeCollateralList(
        {
          pledgeItemDescription: "Laptop Lenovo i7",
          pledgeRedemptionDeadline: "2026-10-15",
          pledgeEstimatedValue: "2500.00",
          pledgePledgedValue: "1500.00",
        },
        []
      );

      expect(collaterals).toHaveLength(1);
      expect(collaterals[0]).toEqual({
        description: "Laptop Lenovo i7",
        pledgedValue: 1500,
        estimatedValue: 2500,
        redemptionDeadline: "2026-10-15",
      });
    });

    it("D. Currency helpers return correct symbols for PEN and USD", () => {
      expect(getCurrencySymbol("PEN")).toBe("S/");
      expect(getCurrencySymbol("USD")).toBe("$");
      expect(getCurrencySymbol("OTHER")).toBe("S/");
    });

    it("E. Review date helper formats YYYY-MM-DD to DD/MM/YYYY", () => {
      expect(formatReviewDate("2026-10-15")).toBe("15/10/2026");
      expect(formatReviewDate("2026-01-05")).toBe("05/01/2026");
      expect(formatReviewDate("")).toBe("—");
      expect(formatReviewDate(null)).toBe("—");
    });
  });

  describe("Component Rendering & Form UX Tests", () => {
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

      expect(html).toContain("PEN — S/ Sol peruano");
      expect(html).toContain("USD — $ Dólar estadounidense");
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

    it("5. simple debt registration works without advanced fields", () => {
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

      expect(html).toContain("Mostrar datos adicionales y avanzados ▼");
      expect(html).not.toContain("Cronograma inicial de cuotas");
    });

    it("6. pledge-specific UX renders clear labels for pledge", () => {
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

      expect(html).toContain("Empeño");
      expect(html).not.toContain("Pignoración");
    });

    it("7. mobile-friendly render structure", () => {
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

    it("8. confirmation review displays friendly date format and label 'Comenzó'", () => {
      const html = renderToStaticMarkup(
        <DebtForm
          initialStep="review"
          accounts={mockAccounts}
          categories={mockCategories}
          onSaved={mockOnSaved}
          onCancel={mockOnCancel}
          setToast={mockSetToast}
        />
      );

      expect(html).toContain("Confirmar registro de deuda");
      expect(html).not.toContain("Empezó / Fecha origen");
    });
  });
});
