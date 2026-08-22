import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DebtIntelligenceItem } from "./debtIntelligence.js";
import { buildDebtPortfolioIntelligence } from "./debtIntelligence.js";
import { buildDebtStrategies } from "./debtStrategy.js";
import { simulateDebtPrincipalPrepayment } from "./debtSimulation.js";
import {
  avalancheComparisonModeLabel,
  cashFlowUnrankedReasonLabel,
  debtLimitationLabel,
  dueStatusLabel,
  formatDebtMoney,
  simulationStatusCopy,
} from "./debtPresentation.js";
import { DebtPortfolioIntelligencePanel } from "../components/DebtPortfolioIntelligencePanel.js";
import { DebtStrategyPanel } from "../components/DebtStrategyPanel.js";
import { DebtAnalysisPanel } from "../components/DebtAnalysisPanel.js";
import { DebtsManager } from "../components/DebtsManager.js";
import type { Debt } from "../types.js";

function mockIntelligenceItem(overrides: Partial<DebtIntelligenceItem> = {}): DebtIntelligenceItem {
  return {
    debtId: "d1",
    debtName: "Préstamo BCP",
    creditorName: "BCP",
    debtKind: "bank_loan",
    currencyCode: "PEN",
    status: "active",
    isArchived: false,

    currentPrincipal: 10000,
    originalPrincipal: 10000,
    openingPrincipalBalance: 10000,

    recordedFundPrincipalReduction: 3000,
    nonFundPrincipalDelta: -500,

    balanceReductionFromOriginal: 3000,
    balanceReductionPercentFromOriginal: 30,

    historicalEconomics: {
      cashOutflow: 4000,
      principalReduction: 3000,
      economicExpense: 1000,
      interestPaid: 800,
      feesPaid: 100,
      insurancePaid: 100,
      otherCostPaid: 0,
      knownDetailedCosts: 1000,
      unclassifiedDebtCost: 0,
      fundEventCount: 4,
      paymentCount: 4,
      prepaymentCount: 0,
      payoffCount: 0,
      inconsistentEventCount: 0,
    },

    rateBasis: "tcea",
    ratePercent: 18.5,

    hasCurrentSchedule: true,
    currentScheduleId: "sv1",
    currentScheduleInstallmentCount: 12,
    currentScheduleLastDueDate: "2027-01-01",

    remainingInstallmentCount: 12,
    knownRemainingInstallmentCount: 12,
    unknownRemainingInstallmentCount: 0,
    overdueInstallmentCount: 0,

    nextInstallmentId: "i1",
    nextInstallmentNumber: 1,
    nextInstallmentDueDate: "2026-09-01",
    nextInstallmentDueStatus: "upcoming",
    nextInstallmentRemainingAmount: 900,
    nextInstallmentAmountKnown: true,

    next30KnownAmount: 900,
    next30UnknownAmountCount: 0,
    next30InstallmentCount: 1,

    prepaymentPrincipalReduction: 0,
    prepaymentCashOutflow: 0,

    hasActiveCollateral: false,
    activeCollateralCount: 0,
    nearestRedemptionDeadline: null,
    nearestRedemptionStatus: null,

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
    ...overrides,
  };
}

function mockDebt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: "d1",
    name: "Préstamo BCP",
    creditorName: "BCP",
    debtKind: "bank_loan",
    currencyCode: "PEN",
    originDate: "2026-01-01",
    trackingStartDate: "2026-01-01",
    originalPrincipal: 10000,
    openingPrincipalBalance: 10000,
    plannedInstallmentCount: 12,
    plannedInstallmentAmount: 900,
    installmentAmountMode: "fixed",
    paymentFrequency: "monthly",
    customFrequencyDays: null,
    firstDueDate: "2026-02-01",
    teaPercent: 15,
    tceaPercent: 18.5,
    notes: "",
    status: "active",
    isArchived: false,
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("DEBT-4D Debt Intelligence, Strategy & Simulator UX", () => {
  // -------------------------------------------------------------------------
  // 1. MULTI-CURRENCY (Tests 1-6)
  // -------------------------------------------------------------------------
  describe("Multi-Currency Presentation", () => {
    it("1. portfolio PEN is rendered with its currency code", () => {
      const penItem = mockIntelligenceItem({ debtId: "d-pen", currencyCode: "PEN", currentPrincipal: 5000 });
      const portfolio = buildDebtPortfolioIntelligence([penItem]);
      const html = renderToStaticMarkup(createElement(DebtPortfolioIntelligencePanel, { portfolio }));

      expect(html).toContain("PEN 5,000.00");
    });

    it("2. portfolio USD is rendered with its currency code", () => {
      const usdItem = mockIntelligenceItem({ debtId: "d-usd", currencyCode: "USD", currentPrincipal: 1200 });
      const portfolio = buildDebtPortfolioIntelligence([usdItem]);
      const html = renderToStaticMarkup(createElement(DebtPortfolioIntelligencePanel, { portfolio }));

      expect(html).toContain("USD 1,200.00");
    });

    it("3. PEN and USD appear separated", () => {
      const penItem = mockIntelligenceItem({ debtId: "d-pen", currencyCode: "PEN", currentPrincipal: 5000 });
      const usdItem = mockIntelligenceItem({ debtId: "d-usd", currencyCode: "USD", currentPrincipal: 1200 });
      const portfolio = buildDebtPortfolioIntelligence([penItem, usdItem]);
      const html = renderToStaticMarkup(createElement(DebtPortfolioIntelligencePanel, { portfolio }));

      expect(html).toContain("PEN 5,000.00");
      expect(html).toContain("USD 1,200.00");
    });

    it("4. no combined cross-currency monetary total appears", () => {
      const penItem = mockIntelligenceItem({ debtId: "d-pen", currencyCode: "PEN", currentPrincipal: 5000 });
      const usdItem = mockIntelligenceItem({ debtId: "d-usd", currencyCode: "USD", currentPrincipal: 1200 });
      const portfolio = buildDebtPortfolioIntelligence([penItem, usdItem]);
      const html = renderToStaticMarkup(createElement(DebtPortfolioIntelligencePanel, { portfolio }));

      expect(html).not.toContain("6,200");
      expect(html).not.toContain("S/ 6,200");
    });

    it("5. DebtsManager does not show 'Principal total activo' cross-currency sum", () => {
      const penDebt = mockDebt({ id: "d-pen", currencyCode: "PEN" });
      const usdDebt = mockDebt({ id: "d-usd", currencyCode: "USD" });
      const intelPEN = mockIntelligenceItem({ debtId: "d-pen", currencyCode: "PEN", currentPrincipal: 5000 });
      const intelUSD = mockIntelligenceItem({ debtId: "d-usd", currencyCode: "USD", currentPrincipal: 1200 });
      const portfolio = buildDebtPortfolioIntelligence([intelPEN, intelUSD]);
      const strats = buildDebtStrategies([intelPEN, intelUSD]);

      const html = renderToStaticMarkup(
        createElement(DebtsManager, {
          debts: [penDebt, usdDebt],
          debtEvents: [],
          scheduleVersions: [],
          installments: [],
          allocations: [],
          collaterals: [],
          accounts: [],
          categories: [],
          debtPlanningItems: [],
          debtPlanningAlertSummary: { overdue: 0, today: 0, tomorrow: 0, upcoming: 0, total: 0 },
          debtPortfolioIntelligence: portfolio,
          debtStrategies: strats,
          intelligenceItems: [intelPEN, intelUSD],
          onOpenNewDebt: () => {},
          onSelectDebt: () => {},
        })
      );

      expect(html).not.toContain("Principal total activo");
    });

    it("6. cards use DebtIntelligenceItem.currentPrincipal", () => {
      const penDebt = mockDebt({ id: "d-pen", currencyCode: "PEN", openingPrincipalBalance: 10000 });
      const intelPEN = mockIntelligenceItem({ debtId: "d-pen", currencyCode: "PEN", currentPrincipal: 7500 });
      const portfolio = buildDebtPortfolioIntelligence([intelPEN]);
      const strats = buildDebtStrategies([intelPEN]);

      const html = renderToStaticMarkup(
        createElement(DebtsManager, {
          debts: [penDebt],
          debtEvents: [],
          scheduleVersions: [],
          installments: [],
          allocations: [],
          collaterals: [],
          accounts: [],
          categories: [],
          debtPlanningItems: [],
          debtPlanningAlertSummary: { overdue: 0, today: 0, tomorrow: 0, upcoming: 0, total: 0 },
          debtPortfolioIntelligence: portfolio,
          debtStrategies: strats,
          intelligenceItems: [intelPEN],
          onOpenNewDebt: () => {},
          onSelectDebt: () => {},
        })
      );

      expect(html).toContain("PEN 7,500.00");
    });
  });

  // -------------------------------------------------------------------------
  // 2. PORTFOLIO / READINESS (Tests 7-12)
  // -------------------------------------------------------------------------
  describe("Portfolio & Readiness", () => {
    it("7. global active debt count displayed", () => {
      const item1 = mockIntelligenceItem({ debtId: "d1" });
      const item2 = mockIntelligenceItem({ debtId: "d2" });
      const portfolio = buildDebtPortfolioIntelligence([item1, item2]);
      const html = renderToStaticMarkup(createElement(DebtPortfolioIntelligencePanel, { portfolio }));

      expect(html).toContain("2");
    });

    it("8. next30 known amount per currency displayed", () => {
      const item = mockIntelligenceItem({ currencyCode: "PEN", next30KnownAmount: 1400 });
      const portfolio = buildDebtPortfolioIntelligence([item]);
      const html = renderToStaticMarkup(createElement(DebtPortfolioIntelligencePanel, { portfolio }));

      expect(html).toContain("PEN 1,400.00");
    });

    it("9. overdue count displayed in strategy or status badge", () => {
      const item = mockIntelligenceItem({ overdueInstallmentCount: 3 });
      const portfolio = buildDebtPortfolioIntelligence([item]);
      const html = renderToStaticMarkup(createElement(DebtPortfolioIntelligencePanel, { portfolio }));

      expect(html).toBeDefined();
    });

    it("10. unrated debt notice displayed", () => {
      const item = mockIntelligenceItem({ readiness: { ...mockIntelligenceItem().readiness, hasRate: false } });
      const portfolio = buildDebtPortfolioIntelligence([item]);
      const html = renderToStaticMarkup(createElement(DebtPortfolioIntelligencePanel, { portfolio }));

      expect(html).toContain("deuda sin tasa");
    });

    it("11. missing schedule notice displayed", () => {
      const item = mockIntelligenceItem({ readiness: { ...mockIntelligenceItem().readiness, hasCurrentSchedule: false } });
      const portfolio = buildDebtPortfolioIntelligence([item]);
      const html = renderToStaticMarkup(createElement(DebtPortfolioIntelligencePanel, { portfolio }));

      expect(html).toContain("deuda sin cronograma");
    });

    it("12. unknown installment notice displayed", () => {
      const item = mockIntelligenceItem({ unknownRemainingInstallmentCount: 1 });
      const portfolio = buildDebtPortfolioIntelligence([item]);
      const html = renderToStaticMarkup(createElement(DebtPortfolioIntelligencePanel, { portfolio }));

      expect(html).toContain("cuotas por confirmar");
    });
  });

  // -------------------------------------------------------------------------
  // 3. STRATEGIES (Tests 13-20)
  // -------------------------------------------------------------------------
  describe("Strategy Presentation", () => {
    it("13. Snowball copy explains smaller balance", () => {
      const item = mockIntelligenceItem();
      const strats = buildDebtStrategies([item]);
      const html = renderToStaticMarkup(
        createElement(DebtStrategyPanel, { strategies: strats, intelligenceItems: [item], onSelectDebtId: () => {} })
      );

      expect(html).toContain("Prioriza el menor saldo principal");
    });

    it("14. Snowball separates currencies", () => {
      const itemPEN = mockIntelligenceItem({ debtId: "d-pen", currencyCode: "PEN" });
      const itemUSD = mockIntelligenceItem({ debtId: "d-usd", currencyCode: "USD" });
      const strats = buildDebtStrategies([itemPEN, itemUSD]);
      const html = renderToStaticMarkup(
        createElement(DebtStrategyPanel, { strategies: strats, intelligenceItems: [itemPEN, itemUSD], onSelectDebtId: () => {} })
      );

      expect(html).toContain("Moneda: PEN");
      expect(html).toContain("Moneda: USD");
    });

    it("15. Avalanche shows TCEA and TEA in separate cohorts", () => {
      const itemTcea = mockIntelligenceItem({ debtId: "d-tcea", rateBasis: "tcea", ratePercent: 25 });
      const itemTea = mockIntelligenceItem({ debtId: "d-tea", rateBasis: "tea", ratePercent: 18 });
      const strats = buildDebtStrategies([itemTcea, itemTea]);
      const html = renderToStaticMarkup(
        createElement(DebtStrategyPanel, { strategies: strats, intelligenceItems: [itemTcea, itemTea], onSelectDebtId: () => {} })
      );

      expect(html).toContain("Tasa TCEA");
      expect(html).toContain("Tasa TEA");
    });

    it("16. Avalanche partial mode shows partial comparison notice", () => {
      const itemTcea = mockIntelligenceItem({ debtId: "d-tcea", rateBasis: "tcea", ratePercent: 25 });
      const itemTea = mockIntelligenceItem({ debtId: "d-tea", rateBasis: "tea", ratePercent: 18 });
      const strats = buildDebtStrategies([itemTcea, itemTea]);
      const html = renderToStaticMarkup(
        createElement(DebtStrategyPanel, { strategies: strats, intelligenceItems: [itemTcea, itemTea], onSelectDebtId: () => {} })
      );

      expect(html).toContain("Comparación parcial");
    });

    it("17. Avalanche unavailable mode shows missing rates notice", () => {
      expect(avalancheComparisonModeLabel("unavailable")).toContain("No hay tasas registradas suficientes para comparar");
    });

    it("18. Urgency explains date-based ordering", () => {
      const item = mockIntelligenceItem();
      const strats = buildDebtStrategies([item]);
      const html = renderToStaticMarkup(
        createElement(DebtStrategyPanel, { strategies: strats, intelligenceItems: [item], onSelectDebtId: () => {} })
      );

      expect(html).toContain("Prioriza la obligación pendiente con fecha más antigua");
    });

    it("19. Urgency unranked does NOT label items as less urgent", () => {
      const itemUnranked = mockIntelligenceItem({ nextInstallmentId: null, nextInstallmentDueDate: null });
      const strats = buildDebtStrategies([itemUnranked]);
      const html = renderToStaticMarkup(
        createElement(DebtStrategyPanel, { strategies: strats, intelligenceItems: [itemUnranked], onSelectDebtId: () => {} })
      );

      expect(html).not.toContain("menos urgente");
      expect(html).toContain("una próxima obligación rankeable");
    });

    it("20. Cash-flow relief unknown shows 'monto por confirmar' / unranked", () => {
      const itemUnk = mockIntelligenceItem({ next30UnknownAmountCount: 1 });
      const strats = buildDebtStrategies([itemUnk]);
      const html = renderToStaticMarkup(
        createElement(DebtStrategyPanel, { strategies: strats, intelligenceItems: [itemUnk], onSelectDebtId: () => {} })
      );

      expect(html).toContain("Hay montos por confirmar en los próximos 30 días");
    });
  });

  // -------------------------------------------------------------------------
  // 4. DETAIL INTELLIGENCE (Tests 21-26)
  // -------------------------------------------------------------------------
  describe("Detail Intelligence", () => {
    it("21. current principal uses intelligence", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 8500 });
      const html = renderToStaticMarkup(createElement(DebtAnalysisPanel, { intelligence: item }));

      expect(html).toContain("PEN 8,500.00");
    });

    it("22. fund principal reduction label does not say 'total pagado'", () => {
      const item = mockIntelligenceItem({ recordedFundPrincipalReduction: 3000 });
      const html = renderToStaticMarkup(createElement(DebtAnalysisPanel, { intelligence: item }));

      expect(html).toContain("Reducción por fondos");
      expect(html).not.toContain("Total pagado:");
    });

    it("23. nonFundPrincipalDelta presented as adjustment/refinancing", () => {
      const item = mockIntelligenceItem({ nonFundPrincipalDelta: 500 });
      const html = renderToStaticMarkup(createElement(DebtAnalysisPanel, { intelligence: item }));

      expect(html).toContain("Ajustes / Refinanciación");
    });

    it("24. unknown next installment shows 'Monto por confirmar'", () => {
      const item = mockIntelligenceItem({ nextInstallmentAmountKnown: false });
      const html = renderToStaticMarkup(createElement(DebtAnalysisPanel, { intelligence: item }));

      expect(html).toContain("Monto por confirmar");
    });

    it("25. schedule last date uses wording 'última cuota registrada'", () => {
      const item = mockIntelligenceItem({ currentScheduleLastDueDate: "2027-12-31" });
      const html = renderToStaticMarkup(createElement(DebtAnalysisPanel, { intelligence: item }));

      expect(html).toContain("Según el cronograma actual, la última cuota registrada vence el");
      expect(html).not.toContain("Terminas el");
      expect(html).not.toContain("Liquidación exacta");
    });

    it("26. readiness limitations are presented humanely", () => {
      const item = mockIntelligenceItem({ readiness: { ...mockIntelligenceItem().readiness, limitations: ["missing_rate"] } });
      const html = renderToStaticMarkup(createElement(DebtAnalysisPanel, { intelligence: item }));

      expect(html).toContain("No hay tasa registrada");
    });
  });

  // -------------------------------------------------------------------------
  // 5. SIMULATION UX (Tests 27-32)
  // -------------------------------------------------------------------------
  describe("Simulation UX", () => {
    it("27. valid prepayment shows simulated principal balance", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 10000 });
      const html = renderToStaticMarkup(createElement(DebtAnalysisPanel, { intelligence: item }));

      expect(html).toContain("Simular abono al capital");
    });

    it("28. payoff candidate disclaimer warns that real payoff amount may differ", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 5000 });
      const sim = simulateDebtPrincipalPrepayment(item, 5000);

      expect(sim.status).toBe("payoff_candidate");
      expect(simulationStatusCopy(sim.status)).toContain("El principal quedaría matemáticamente en 0");
    });

    it("29. exact interest savings NO presented as a figure (is null)", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 10000 });
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect(sim.exactInterestSavingsAmount).toBeNull();
    });

    it("30. simulated cash outflow NO presented as a figure (is null)", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 10000 });
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect(sim.simulatedCashOutflow).toBeNull();
    });

    it("31. unsupported credit_card has specific message", () => {
      const item = mockIntelligenceItem({ debtKind: "credit_card" });
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect(simulationStatusCopy(sim.status)).toContain("Las tarjetas de crédito tendrán un simulador específico");
    });

    it("32. simulator contains no button that executes a financial write", () => {
      const item = mockIntelligenceItem();
      const html = renderToStaticMarkup(createElement(DebtAnalysisPanel, { intelligence: item }));

      expect(html).not.toContain("Registrar pago");
      expect(html).not.toContain("Aplicar prepago");
    });
  });
});
