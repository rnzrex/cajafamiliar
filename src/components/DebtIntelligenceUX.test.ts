import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  CreditCardProfile,
  CreditCardStatement,
  Debt,
  DebtInstallment,
  DebtScheduleVersion,
} from "../types.js";
import { DebtsManager } from "./DebtsManager.js";
import { DebtAttentionPanel } from "./DebtAttentionPanel.js";
import { CreditCardDetailPanel } from "./CreditCardDetailPanel.js";
import { DebtDetailModal } from "./DebtDetailModal.js";
import { buildAllDebtNextActions } from "../utils/debtAttention.js";
import { buildDebtStrategies } from "../utils/debtStrategy.js";
import { buildDebtIntelligenceItems } from "../utils/debtIntelligence.js";
import { buildDebtPlanningItems } from "../utils/debtPlanning.js";
import type { DebtIntelligenceItem } from "../utils/debtIntelligence.js";

function sampleLoanDebt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: "loan-1",
    name: "Préstamo Vehicular",
    creditorName: "BCP",
    debtKind: "bank_loan",
    currencyCode: "PEN",
    originDate: "2026-01-01",
    trackingStartDate: "2026-01-01",
    originalPrincipal: 20000,
    openingPrincipalBalance: 20000,
    plannedInstallmentCount: 24,
    plannedInstallmentAmount: 1000,
    installmentAmountMode: "fixed",
    paymentFrequency: "monthly",
    customFrequencyDays: null,
    firstDueDate: "2026-02-01",
    teaPercent: 12,
    tceaPercent: 14,
    notes: "",
    status: "active",
    isArchived: false,
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function sampleCardDebt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: "card-1",
    name: "Tarjeta Signature",
    creditorName: "BBVA",
    debtKind: "credit_card",
    currencyCode: "PEN",
    originDate: "2026-01-01",
    trackingStartDate: "2026-01-01",
    originalPrincipal: 0,
    openingPrincipalBalance: 0,
    plannedInstallmentCount: 0,
    plannedInstallmentAmount: 0,
    installmentAmountMode: "fixed",
    paymentFrequency: "monthly",
    customFrequencyDays: null,
    firstDueDate: "2026-01-01",
    teaPercent: 0,
    tceaPercent: 0,
    notes: "",
    status: "active",
    isArchived: false,
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const defaultScheduleVersion: DebtScheduleVersion = {
  id: "s-1",
  debtId: "loan-1",
  versionNumber: 1,
  reason: "initial",
  effectiveDate: "2026-01-01",
  triggerEventId: null,
  notes: "",
  createdByUserId: "u1",
  createdAt: "2026-01-01T00:00:00Z",
};

const defaultInstallment: DebtInstallment = {
  id: "inst-1",
  debtId: "loan-1",
  scheduleVersionId: "s-1",
  installmentNumber: 1,
  dueDate: "2026-08-10",
  expectedAmount: 1000,
  expectedPrincipal: 800,
  expectedInterest: 200,
  expectedFees: 0,
  expectedInsurance: 0,
  createdByUserId: "u1",
  createdAt: "2026-01-01T00:00:00Z",
};

function sampleLoanIntelligence(
  loan: Debt = sampleLoanDebt(),
  versions: DebtScheduleVersion[] = [defaultScheduleVersion],
  installments: DebtInstallment[] = [defaultInstallment],
  todayKey: string = "2026-08-23"
): DebtIntelligenceItem {
  const planningItems = buildDebtPlanningItems([loan], [], versions, installments, [], todayKey);
  return buildDebtIntelligenceItems({
    debts: [loan],
    debtEvents: [],
    debtScheduleVersions: versions,
    debtInstallments: installments,
    debtCollaterals: [],
    debtPlanningItems: planningItems,
    todayKey,
  })[0];
}

describe("DEBT-5F-B: Debt Intelligence UX Real Component Tests", () => {
  it("renders DebtAttentionPanel with urgent overdue items when actionable", () => {
    const loan = sampleLoanDebt();
    const intel = sampleLoanIntelligence(loan, [defaultScheduleVersion], [defaultInstallment], "2026-08-23");
    const actions = buildAllDebtNextActions({
      debts: [loan],
      intelligenceItems: [intel],
      todayKey: "2026-08-23",
    });

    const html = renderToStaticMarkup(
      React.createElement(DebtAttentionPanel, {
        actions,
        onSelectDebtId: () => {},
      })
    );

    expect(html).toContain("Requiere tu atención");
    expect(html).toContain("Cuota vencida");
    expect(html).toContain("Préstamo Vehicular");
    expect(html).toContain("PEN 1,000.00");
  });

  it("renders DebtAttentionPanel healthy empty state when no urgent items exist", () => {
    const paidOffLoan = sampleLoanDebt({ status: "paid_off" });
    const paidOffIntel = sampleLoanIntelligence(paidOffLoan, [], [], "2026-08-23");

    const actions = buildAllDebtNextActions({
      debts: [paidOffLoan],
      intelligenceItems: [paidOffIntel],
      todayKey: "2026-08-23",
    });

    const html = renderToStaticMarkup(
      React.createElement(DebtAttentionPanel, {
        actions,
        onSelectDebtId: () => {},
      })
    );

    expect(html).toContain("No hay pagos urgentes en este momento");
    expect(html).not.toContain("Requiere tu atención");
  });

  it("renders DebtsManager distinguishing 'Saldo actual' for cards and 'Saldo principal' for loans", () => {
    const loan = sampleLoanDebt();
    const card = sampleCardDebt();
    const loanIntel = sampleLoanIntelligence(loan, [defaultScheduleVersion], [defaultInstallment], "2026-08-23");

    const html = renderToStaticMarkup(
      React.createElement(DebtsManager, {
        debts: [loan, card],
        debtEvents: [],
        scheduleVersions: [defaultScheduleVersion],
        installments: [defaultInstallment],
        allocations: [],
        collaterals: [],
        accounts: [],
        categories: [],
        debtPlanningItems: [],
        debtPlanningAlertSummary: { overdue: 0, today: 0, tomorrow: 0, upcoming: 0, total: 0 },
        debtPortfolioIntelligence: {
          byCurrency: {},
          totalActiveDebts: 2,
          unratedDebtCount: 0,
          debtsWithoutCurrentScheduleCount: 0,
          debtsWithUnknownInstallmentsCount: 0,
          debtsWithActiveCollateralCount: 0,
        },
        debtStrategies: buildDebtStrategies([loanIntel]),
        intelligenceItems: [loanIntel],
        onOpenNewDebt: () => {},
        onSelectDebt: () => {},
      })
    );

    expect(html).toContain("Gestión de Deudas");
    expect(html).toContain("Saldo actual");
    expect(html).toContain("Saldo principal");
    expect(html).toContain("Tarjeta Signature");
    expect(html).toContain("Préstamo Vehicular");
  });

  it("renders CreditCardDetailPanel showing 'Límite no registrado' when credit limit is null", () => {
    const card = sampleCardDebt();

    const html = renderToStaticMarkup(
      React.createElement(CreditCardDetailPanel, {
        debt: card,
        profile: null,
        cardEntries: [],
        cardStatements: [],
        allDebts: [card],
        accounts: [],
        categories: [],
        onRefreshData: () => {},
        setToast: () => {},
      })
    );

    expect(html).toContain("Tarjeta Signature");
    expect(html).toContain("Límite no registrado");
    expect(html).toContain("Saldo actual");
    expect(html).toContain("Acciones de tarjeta");
  });

  it("renders CreditCardDetailPanel showing 'Pago mínimo no registrado' when minimum payment is null", () => {
    const card = sampleCardDebt();
    const profile: CreditCardProfile = {
      debtId: card.id,
      creditLimit: 5000,
      closingDay: 20,
      dueDay: 5,
      last4: "1234",
      createdByUserId: "u1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const stm: CreditCardStatement = {
      id: "stm-1",
      debtId: card.id,
      statementDate: "2026-08-20",
      dueDate: "2026-09-05",
      statementBalance: 750,
      minimumPaymentAmount: null,
      closingEntryId: null,
      createdByUserId: "u1",
      createdAt: "2026-08-20T00:00:00Z",
      updatedAt: "2026-08-20T00:00:00Z",
    };

    const html = renderToStaticMarkup(
      React.createElement(CreditCardDetailPanel, {
        debt: card,
        profile,
        cardEntries: [],
        cardStatements: [stm],
        allDebts: [card],
        accounts: [],
        categories: [],
        onRefreshData: () => {},
        setToast: () => {},
      })
    );

    expect(html).toContain("Pago mínimo no registrado");
    expect(html).not.toContain("S/ 0.00");
  });

  it("preserves DebtDetailModal loan experience with Registrar pago, Prepago, Liquidar deuda, Cronograma, Garantías, Historial", () => {
    const loan = sampleLoanDebt();
    const intel = sampleLoanIntelligence(loan, [defaultScheduleVersion], [defaultInstallment], "2026-08-23");

    const html = renderToStaticMarkup(
      React.createElement(DebtDetailModal, {
        debt: loan,
        debtIntelligence: intel,
        debtEvents: [],
        scheduleVersions: [defaultScheduleVersion],
        installments: [defaultInstallment],
        allocations: [],
        collaterals: [],
        accounts: [],
        categories: [],
        creditCardProfiles: [],
        creditCardEntries: [],
        cardStatements: [],
        allDebts: [loan],
        onClose: () => {},
        onOpenOperation: () => {},
        onRefresh: () => {},
        setToast: () => {},
      })
    );

    expect(html).toContain("Registrar pago");
    expect(html).toContain("Prepago");
    expect(html).toContain("Liquidar deuda");
    expect(html).toContain("Cronograma");
    expect(html).toContain("Garantías");
    expect(html).toContain("Historial");
  });
});
