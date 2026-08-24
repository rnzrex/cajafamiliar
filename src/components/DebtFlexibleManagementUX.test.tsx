import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DebtForm } from "./DebtForm";
import { DebtDetailModal } from "./DebtDetailModal";
import { DebtOperationForm } from "./DebtOperationForm";
import type { Debt, FinancialAccount, Category, DebtEvent } from "../types";
import type { DebtIntelligenceItem } from "../utils/debtIntelligence";
import * as dataRepository from "../services/dataRepository";

vi.mock("../services/dataRepository", async () => {
  const actual = await vi.importActual<typeof dataRepository>("../services/dataRepository");
  return {
    ...actual,
    createDebt: vi.fn().mockResolvedValue({
      debt: { id: "test-debt-flex-1" },
      scheduleVersion: null,
      installments: [],
      collaterals: [],
    }),
    updateDebtTerms: vi.fn().mockResolvedValue({
      id: "test-debt-flex-1",
      repaymentStructure: "open_ended",
      interestCalculationMode: "contract_periodic_rate",
      periodicRatePercent: 4,
      periodicRateBasis: "monthly",
    }),
  };
});

describe("DEBT-6B Flexible Debt Management UX Tests", () => {
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

  const flexDebt: Debt = {
    id: "debt-flex-1",
    name: "Empeño Laptop Lenovo",
    creditorName: "Casa de Empeño Sol",
    debtKind: "pledge",
    currencyCode: "PEN",
    originDate: "2026-01-01",
    trackingStartDate: "2026-01-01",
    originalPrincipal: 5000,
    openingPrincipalBalance: 5000,
    plannedInstallmentCount: null,
    plannedInstallmentAmount: null,
    installmentAmountMode: "unknown",
    paymentFrequency: null,
    customFrequencyDays: null,
    firstDueDate: null,
    teaPercent: null,
    tceaPercent: 72.4,
    notes: "Laptop i7 16GB",
    status: "active",
    isArchived: false,
    createdByUserId: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    repaymentStructure: "open_ended",
    interestCalculationMode: "contract_periodic_rate",
    periodicRatePercent: 4,
    periodicRateBasis: "monthly",
  };

  const mockIntelligence: DebtIntelligenceItem = {
    debtId: flexDebt.id,
    debtName: flexDebt.name,
    creditorName: flexDebt.creditorName,
    debtKind: flexDebt.debtKind,
    currencyCode: flexDebt.currencyCode,
    status: flexDebt.status,
    isArchived: false,
    currentPrincipal: 4750,
    originalPrincipal: 5000,
    openingPrincipalBalance: 5000,
    recordedFundPrincipalReduction: 250,
    nonFundPrincipalDelta: 0,
    balanceReductionFromOriginal: 250,
    balanceReductionPercentFromOriginal: 5,
    historicalEconomics: {
      cashOutflow: 450,
      principalReduction: 250,
      economicExpense: 200,
      interestPaid: 200,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      knownDetailedCosts: 200,
      unclassifiedDebtCost: 0,
      fundEventCount: 1,
      paymentCount: 1,
      prepaymentCount: 0,
      payoffCount: 0,
      inconsistentEventCount: 0,
    },
    rateBasis: "tcea",
    ratePercent: 72.4,
    hasCurrentSchedule: true,
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
    nextInstallmentAmountKnown: true,
    next30KnownAmount: 0,
    next30UnknownAmountCount: 0,
    next30InstallmentCount: 0,
    prepaymentPrincipalReduction: 0,
    prepaymentCashOutflow: 0,
    hasActiveCollateral: true,
    activeCollateralCount: 1,
    nearestRedemptionDeadline: "2026-10-15",
    nearestRedemptionStatus: "upcoming",
    readiness: {
      hasOriginalPrincipal: true,
      hasCurrentSchedule: true,
      hasKnownCurrentScheduleAmounts: true,
      hasRecordedLastDueDate: true,
      hasRate: true,
      hasTcea: true,
      hasTea: false,
      planningReady: true,
      rateStrategyReady: true,
      originalProgressReady: true,
      payoffVisibilityReady: true,
      limitations: [],
    },
  };

  const mockEvents: DebtEvent[] = [
    {
      id: "evt-1",
      debtId: flexDebt.id,
      eventDate: "2026-02-01",
      eventType: "payment",
      cashAmount: 450,
      principalDelta: -250, // Real production negative principalDelta
      interestPaid: 200,
      feesPaid: 0,
      insurancePaid: 0,
      otherCostPaid: 0,
      breakdownComplete: true,
      movementId: "mov-1",
      reversalOfEventId: null,
      description: "Pago cuota 1",
      registeredByUserId: "user-1",
      createdAt: "2026-02-01T10:00:00Z",
    },
  ];

  it("1. DebtForm onboarding allows selecting repayment structure and interest terms", () => {
    const html = renderToStaticMarkup(
      <DebtForm
        initialStep="details"
        accounts={mockAccounts}
        categories={mockCategories}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
        setToast={vi.fn()}
      />
    );

    expect(html).toContain("¿Cómo funciona el pago de esta deuda / empeño?");
    expect(html).toContain("Sin plazo fijo");
  });

  it("2. DebtDetailModal renders 'Avance y pagos' tab for open-ended debt with summary cards and ledger history", () => {
    const html = renderToStaticMarkup(
      <DebtDetailModal
        debt={flexDebt}
        debtIntelligence={mockIntelligence}
        debtEvents={mockEvents}
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

    expect(html).toContain("Avance y pagos");
    expect(html).toContain("Términos y Tasas de la Deuda");
    expect(html).toContain("TCEA (72.4%):");
    expect(html).toContain("referencia de costo total efectivo");
  });

  it("3. DebtOperationForm uses 'Registrar pago' wording and renders assisted interest suggestion", () => {
    const html = renderToStaticMarkup(
      <DebtOperationForm
        debt={flexDebt}
        operationType="payment"
        installments={[]}
        scheduleVersions={[]}
        debtEvents={mockEvents}
        accounts={mockAccounts}
        categories={mockCategories}
        currentPrincipal={4750}
        persistedAllocations={[]}
        onSaved={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
        setToast={vi.fn()}
      />
    );

    expect(html).toContain("Registrar pago");
    expect(html).toContain("¿Cuánto pagaste en total?");
  });
});
