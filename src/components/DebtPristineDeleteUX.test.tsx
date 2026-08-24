import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DebtDetailModal } from "./DebtDetailModal";
import type { Debt, DebtEvent, CreditCardEntry, CreditCardStatement, FinancialAccount, Category } from "../types";
import type { DebtIntelligenceItem } from "../utils/debtIntelligence";
import { translateDebtError } from "../utils/debtViewModel";
import * as dataRepository from "../services/dataRepository";

vi.mock("../services/dataRepository", async () => {
  const actual = await vi.importActual<typeof dataRepository>("../services/dataRepository");
  return {
    ...actual,
    deletePristineDebt: vi.fn().mockResolvedValue(true),
    setDebtArchived: vi.fn().mockResolvedValue(true),
  };
});

describe("DEBT-6B.3 Pristine Delete UX & Component Regressions", () => {
  const mockAccounts: FinancialAccount[] = [
    {
      id: "acc-1",
      name: "Cuenta BCP",
      reconciliationType: "balance",
      openingBalance: 2000,
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

  const baseDebt: Debt = {
    id: "debt-pristine-1",
    name: "Préstamo Pristino",
    creditorName: "Banco A",
    debtKind: "bank_loan",
    currencyCode: "PEN",
    originDate: "2026-01-01",
    trackingStartDate: "2026-01-01",
    originalPrincipal: 1000,
    openingPrincipalBalance: 1000,
    plannedInstallmentCount: null,
    plannedInstallmentAmount: null,
    installmentAmountMode: "unknown",
    paymentFrequency: null,
    customFrequencyDays: null,
    firstDueDate: null,
    teaPercent: null,
    tceaPercent: null,
    notes: "",
    status: "active",
    isArchived: false,
    createdByUserId: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    repaymentStructure: "open_ended",
    interestCalculationMode: "unknown",
    periodicRatePercent: null,
    periodicRateBasis: null,
  };

  const cardDebt: Debt = {
    ...baseDebt,
    id: "card-debt-1",
    name: "Visa Black",
    creditorName: "BCP",
    debtKind: "credit_card",
  };

  const mockIntelligence: DebtIntelligenceItem = {
    debtId: baseDebt.id,
    debtName: baseDebt.name,
    creditorName: baseDebt.creditorName,
    debtKind: baseDebt.debtKind,
    currencyCode: baseDebt.currencyCode,
    status: baseDebt.status,
    isArchived: false,
    currentPrincipal: 1000,
    originalPrincipal: 1000,
    openingPrincipalBalance: 1000,
    recordedFundPrincipalReduction: 0,
    nonFundPrincipalDelta: 0,
    balanceReductionFromOriginal: 0,
    balanceReductionPercentFromOriginal: 0,
    historicalEconomics: {
      cashOutflow: 0,
      principalReduction: 0,
      economicExpense: 0,
      interestPaid: 0,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      knownDetailedCosts: 0,
      unclassifiedDebtCost: 0,
      fundEventCount: 0,
      paymentCount: 0,
      prepaymentCount: 0,
      payoffCount: 0,
      inconsistentEventCount: 0,
    },
    rateBasis: "tcea",
    ratePercent: null,
    hasCurrentSchedule: false,
    currentScheduleId: null,
    currentScheduleInstallmentCount: 0,
    currentScheduleLastDueDate: null,
    remainingInstallmentCount: 0,
    knownRemainingInstallmentCount: 0,
    unknownRemainingInstallmentCount: 0,
    overdueInstallmentCount: 0,
    nextInstallmentId: null,
    nextInstallmentNumber: null,
    nextInstallmentDueDate: null,
    nextInstallmentDueStatus: null,
    nextInstallmentRemainingAmount: null,
    nextInstallmentAmountKnown: false,
    next30KnownAmount: 0,
    next30UnknownAmountCount: 0,
    next30InstallmentCount: 0,
    prepaymentPrincipalReduction: 0,
    prepaymentCashOutflow: 0,
    hasActiveCollateral: false,
    activeCollateralCount: 0,
    nearestRedemptionDeadline: null,
    nearestRedemptionStatus: null,
    readiness: {
      hasOriginalPrincipal: true,
      hasCurrentSchedule: false,
      hasKnownCurrentScheduleAmounts: false,
      hasRecordedLastDueDate: false,
      hasRate: false,
      hasTcea: false,
      hasTea: false,
      planningReady: false,
      rateStrategyReady: false,
      originalProgressReady: true,
      payoffVisibilityReady: false,
      limitations: [],
    },
  };

  it("A. render pristine normal debt => 'Eliminar deuda' visible", () => {
    const html = renderToStaticMarkup(
      <DebtDetailModal
        debt={baseDebt}
        debtIntelligence={mockIntelligence}
        debtEvents={[]}
        scheduleVersions={[]}
        installments={[]}
        allocations={[]}
        collaterals={[]}
        accounts={mockAccounts}
        categories={mockCategories}
        onClose={vi.fn()}
        onOpenOperation={vi.fn()}
        onRefresh={vi.fn()}
        setToast={vi.fn()}
      />
    );
    expect(html).toContain("Eliminar deuda");
    expect(html).toContain("Archivar");
  });

  it("B. render normal debt with event => permanent Delete not actionable/absent => Archive visible", () => {
    const event: DebtEvent = {
      id: "event-1",
      debtId: baseDebt.id,
      movementId: null,
      eventType: "payment",
      eventDate: "2026-02-01",
      cashAmount: 100,
      principalDelta: 100,
      interestPaid: 0,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      reversalOfEventId: null,
      description: "Pago",
      breakdownComplete: true,
      registeredByUserId: "user-1",
      createdAt: "2026-02-01T00:00:00Z",
    };

    const html = renderToStaticMarkup(
      <DebtDetailModal
        debt={baseDebt}
        debtIntelligence={mockIntelligence}
        debtEvents={[event]}
        scheduleVersions={[]}
        installments={[]}
        allocations={[]}
        collaterals={[]}
        accounts={mockAccounts}
        categories={mockCategories}
        onClose={vi.fn()}
        onOpenOperation={vi.fn()}
        onRefresh={vi.fn()}
        setToast={vi.fn()}
      />
    );
    expect(html).not.toContain("Eliminar deuda");
    expect(html).toContain("Archivar");
    expect(html).toContain("Esta deuda tiene historial y no puede eliminarse.");
  });

  it("C. render pristine credit_card through DebtDetailModal => 'Eliminar deuda' ACTUALLY visible => Archive visible", () => {
    const html = renderToStaticMarkup(
      <DebtDetailModal
        debt={cardDebt}
        debtIntelligence={{ ...mockIntelligence, debtId: cardDebt.id, debtKind: "credit_card" }}
        debtEvents={[]}
        scheduleVersions={[]}
        installments={[]}
        allocations={[]}
        collaterals={[]}
        accounts={mockAccounts}
        categories={mockCategories}
        creditCardEntries={[]}
        cardStatements={[]}
        onClose={vi.fn()}
        onOpenOperation={vi.fn()}
        onRefresh={vi.fn()}
        setToast={vi.fn()}
      />
    );
    expect(html).toContain("Eliminar deuda");
    expect(html).toContain("Archivar");
    expect(html).not.toContain("Esta deuda tiene historial y no puede eliminarse.");
  });

  it("D. render credit_card with CreditCardEntry => Delete absent => Archive visible", () => {
    const entry: CreditCardEntry = {
      id: "entry-1",
      debtId: cardDebt.id,
      entryDate: "2026-02-01",
      entryType: "purchase",
      liabilityDelta: 50,
      movementId: null,
      reversalOfEntryId: null,
      description: "Compra supermercado",
      registeredByUserId: "user-1",
      createdAt: "2026-02-01T00:00:00Z",
    };

    const html = renderToStaticMarkup(
      <DebtDetailModal
        debt={cardDebt}
        debtIntelligence={{ ...mockIntelligence, debtId: cardDebt.id, debtKind: "credit_card" }}
        debtEvents={[]}
        scheduleVersions={[]}
        installments={[]}
        allocations={[]}
        collaterals={[]}
        accounts={mockAccounts}
        categories={mockCategories}
        creditCardEntries={[entry]}
        cardStatements={[]}
        onClose={vi.fn()}
        onOpenOperation={vi.fn()}
        onRefresh={vi.fn()}
        setToast={vi.fn()}
      />
    );
    expect(html).not.toContain("Eliminar deuda");
    expect(html).toContain("Archivar");
    expect(html).toContain("Esta deuda tiene historial y no puede eliminarse.");
  });

  it("E. render credit_card with statement => Delete absent", () => {
    const statement: CreditCardStatement = {
      id: "stmt-1",
      debtId: cardDebt.id,
      statementDate: "2026-02-01",
      dueDate: "2026-02-15",
      statementBalance: 500,
      minimumPaymentAmount: 50,
      closingEntryId: null,
      createdByUserId: "user-1",
      createdAt: "2026-02-01T00:00:00Z",
      updatedAt: "2026-02-01T00:00:00Z",
    };

    const html = renderToStaticMarkup(
      <DebtDetailModal
        debt={cardDebt}
        debtIntelligence={{ ...mockIntelligence, debtId: cardDebt.id, debtKind: "credit_card" }}
        debtEvents={[]}
        scheduleVersions={[]}
        installments={[]}
        allocations={[]}
        collaterals={[]}
        accounts={mockAccounts}
        categories={mockCategories}
        creditCardEntries={[]}
        cardStatements={[statement]}
        onClose={vi.fn()}
        onOpenOperation={vi.fn()}
        onRefresh={vi.fn()}
        setToast={vi.fn()}
      />
    );
    expect(html).not.toContain("Eliminar deuda");
    expect(html).toContain("Archivar");
    expect(html).toContain("Esta deuda tiene historial y no puede eliminarse.");
  });

  it("F, G, H. DEBT_HAS_HISTORY error message translation", () => {
    const errorMsg = translateDebtError(new Error("DEBT_HAS_HISTORY"));
    expect(errorMsg).toContain("Esta deuda ya tiene historial registrado y no puede eliminarse");
    expect(errorMsg).toContain("archivarla");
  });

  it("I. rerender/switch same DebtDetailModal: credit_card -> normal debt and normal debt -> credit_card => no React hook-order error", () => {
    // 1. Render credit card
    const cardHtml = renderToStaticMarkup(
      <DebtDetailModal
        debt={cardDebt}
        debtIntelligence={{ ...mockIntelligence, debtId: cardDebt.id, debtKind: "credit_card" }}
        debtEvents={[]}
        scheduleVersions={[]}
        installments={[]}
        allocations={[]}
        collaterals={[]}
        accounts={mockAccounts}
        categories={mockCategories}
        creditCardEntries={[]}
        cardStatements={[]}
        onClose={vi.fn()}
        onOpenOperation={vi.fn()}
        onRefresh={vi.fn()}
        setToast={vi.fn()}
      />
    );
    expect(cardHtml).toContain("Visa Black");

    // 2. Render normal debt (same component, switching props)
    const normalHtml = renderToStaticMarkup(
      <DebtDetailModal
        debt={baseDebt}
        debtIntelligence={mockIntelligence}
        debtEvents={[]}
        scheduleVersions={[]}
        installments={[]}
        allocations={[]}
        collaterals={[]}
        accounts={mockAccounts}
        categories={mockCategories}
        onClose={vi.fn()}
        onOpenOperation={vi.fn()}
        onRefresh={vi.fn()}
        setToast={vi.fn()}
      />
    );
    expect(normalHtml).toContain("Préstamo Pristino");

    // 3. Render credit card again
    const cardHtml2 = renderToStaticMarkup(
      <DebtDetailModal
        debt={cardDebt}
        debtIntelligence={{ ...mockIntelligence, debtId: cardDebt.id, debtKind: "credit_card" }}
        debtEvents={[]}
        scheduleVersions={[]}
        installments={[]}
        allocations={[]}
        collaterals={[]}
        accounts={mockAccounts}
        categories={mockCategories}
        creditCardEntries={[]}
        cardStatements={[]}
        onClose={vi.fn()}
        onOpenOperation={vi.fn()}
        onRefresh={vi.fn()}
        setToast={vi.fn()}
      />
    );
    expect(cardHtml2).toContain("Visa Black");
  });
});
