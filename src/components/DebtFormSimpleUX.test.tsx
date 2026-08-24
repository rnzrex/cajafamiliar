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
        repaymentStructure: "fixed_schedule",
        interestCalculationMode: "contract_periodic_rate",
        periodicRatePercent: "4.5",
        periodicRateBasis: "monthly",
      });

      expect(payload.openingPrincipalBalance).toBe(4500.5);
      expect(payload.originalPrincipal).toBe(10000);
      expect(payload.originDate).toBe("2025-01-15");
      expect(payload.trackingStartDate).toBe("2026-08-23");
      expect(payload.repaymentStructure).toBe("fixed_schedule");
      expect(payload.interestCalculationMode).toBe("contract_periodic_rate");
      expect(payload.periodicRatePercent).toBe(4.5);
      expect(payload.periodicRateBasis).toBe("monthly");
    });

    it("A2. open_ended repaymentStructure sets plannedInstallmentCount to null", () => {
      const payload = buildDebtCreateInputPayload({
        debtId: "debt-existing-2",
        debtKind: "pledge",
        onboardingMode: "EXISTING_DEBT",
        currencyCode: "PEN",
        name: "Empeño Anillo",
        creditorName: "Casa de Empeño",
        openingPrincipalBalance: 800,
        repaymentStructure: "open_ended",
        interestCalculationMode: "contract_periodic_rate",
        periodicRatePercent: 5,
        periodicRateBasis: "monthly",
        plannedInstallmentCount: 12,
      });

      expect(payload.repaymentStructure).toBe("open_ended");
      expect(payload.plannedInstallmentCount).toBeNull();
      expect(payload.periodicRatePercent).toBe(5);
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
    it("1. DebtForm onboarding allows selecting repayment structure and interest terms", () => {
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

      expect(html).toContain("¿Cómo funciona el pago de esta deuda / empeño?");
      expect(html).toContain("Sin plazo fijo");
      expect(html).toContain("Con cuotas / fecha final");
      expect(html).toContain("¿Cómo se calculan los intereses?");
      expect(html).toContain("Tasa por período");
      expect(html).toContain("Tasa Efectiva Anual (TEA)");
    });

    it("2. currency is select, not free text with PEN and USD options", () => {
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

    it("3. simple debt registration works without advanced fields", () => {
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
  });
});
