import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Debt } from "../types";
import { calculateNextPayment } from "./debtNextPayment";
import { buildDebtPlanningItems } from "./debtPlanning";
import { buildDebtIntelligenceItems, buildDebtPortfolioIntelligence } from "./debtIntelligence";

const qapaq: Debt = {
  id: "qapaq-1",
  name: "Empeño: 2 DENARIOS, 1 SORTIJA, 1 PULSERA, 1 CADENA",
  creditorName: "QAPAQ",
  debtKind: "pledge",
  currencyCode: "PEN",
  originDate: "2026-07-31",
  trackingStartDate: "2026-07-31",
  originalPrincipal: 6510,
  openingPrincipalBalance: 6510,
  plannedInstallmentCount: null,
  plannedInstallmentAmount: null,
  installmentAmountMode: "unknown",
  paymentFrequency: "monthly",
  customFrequencyDays: null,
  firstDueDate: "2026-08-31",
  teaPercent: 51.11,
  tceaPercent: 51.11,
  notes: "",
  status: "active",
  isArchived: false,
  createdByUserId: "user-1",
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
  repaymentStructure: "open_ended",
  interestCalculationMode: "tea_estimate",
  periodicRatePercent: null,
  periodicRateBasis: "monthly",
  interestAccrualAnchorDate: null,
  minimumPrincipalPayment: 30,
};

describe("debt service planning hotfix", () => {
  it("uses the same current-period figures for minimum payment and settlement", () => {
    const next = calculateNextPayment({
      debt: qapaq,
      debtEvents: [],
      currentPrincipal: 6510,
      todayKey: "2026-08-24",
    });

    expect(next.nextDueDate).toBe("2026-08-31");
    expect(next.interestAmount).toBeCloseTo(227.86, 2);
    expect(next.minimumPaymentAmount).toBeCloseTo(257.86, 2);
    expect(next.settlementKnown).toBe(true);
    expect(next.settlementAmount).toBeCloseTo(6737.86, 2);
  });

  it("projects the next open-ended payment into Agenda and the next-30-days portfolio", () => {
    const planning = buildDebtPlanningItems([qapaq], [], [], [], [], "2026-08-24");
    expect(planning).toHaveLength(1);
    expect(planning[0]).toMatchObject({
      debtId: qapaq.id,
      dueDate: "2026-08-31",
      dueStatus: "upcoming",
      amountKnown: true,
    });
    expect(planning[0].expectedAmount).toBeCloseTo(257.86, 2);
    expect(planning[0].remainingAmount).toBeCloseTo(257.86, 2);

    const intelligence = buildDebtIntelligenceItems({
      debts: [qapaq],
      debtEvents: [],
      debtScheduleVersions: [],
      debtInstallments: [],
      debtCollaterals: [],
      debtPlanningItems: planning,
      todayKey: "2026-08-24",
    });

    expect(intelligence[0].nextInstallmentDueDate).toBe("2026-08-31");
    expect(intelligence[0].next30InstallmentCount).toBe(1);
    expect(intelligence[0].next30KnownAmount).toBeCloseTo(257.86, 2);
    expect(intelligence[0].estimatedSettlementAmount).toBeCloseTo(6737.86, 2);

    const portfolio = buildDebtPortfolioIntelligence(intelligence);
    expect(portfolio.byCurrency.PEN.next30KnownAmount).toBeCloseTo(257.86, 2);
    expect(portfolio.byCurrency.PEN.totalEstimatedSettlement).toBeCloseTo(6737.86, 2);
  });

  it("keeps debt-service category fixed in the operation UI", () => {
    const source = readFileSync(new URL("../components/DebtOperationForm.tsx", import.meta.url), "utf8");
    expect(source).toContain('const category = "Pago de deuda";');
    expect(source).toContain("Vinculada automáticamente a esta deuda.");
    expect(source).not.toContain("setCategory(e.target.value)");
  });

  it("shows the current-period cancellation total in debt detail", () => {
    const source = readFileSync(new URL("../components/DebtDetailModal.tsx", import.meta.url), "utf8");
    expect(source).toContain("Total estimado para cancelar este período");
    expect(source).toContain("nextPayment.settlementAmount");
  });
});
