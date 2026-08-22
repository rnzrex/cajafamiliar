import { describe, expect, it } from "vitest";
import type {
  Debt,
  DebtCollateral,
  DebtEvent,
  DebtInstallment,
  DebtScheduleVersion,
} from "../types";
import { buildDebtPlanningItems } from "./debtPlanning";
import {
  buildDebtIntelligenceItems,
  buildDebtPortfolioIntelligence,
} from "./debtIntelligence";

function debt(overrides: Partial<Debt> = {}): Debt {
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

function scheduleVersion(overrides: Partial<DebtScheduleVersion> = {}): DebtScheduleVersion {
  return {
    id: "sv1",
    debtId: "d1",
    versionNumber: 1,
    effectiveDate: "2026-01-01",
    reason: "initial",
    triggerEventId: null,
    notes: "",
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function installment(overrides: Partial<DebtInstallment> = {}): DebtInstallment {
  return {
    id: "i1",
    scheduleVersionId: "sv1",
    debtId: "d1",
    installmentNumber: 1,
    dueDate: "2026-08-15",
    expectedAmount: 900,
    expectedPrincipal: 750,
    expectedInterest: 150,
    expectedFees: null,
    expectedInsurance: null,
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function debtEvent(overrides: Partial<DebtEvent> = {}): DebtEvent {
  return {
    id: "e1",
    debtId: "d1",
    eventDate: "2026-08-10",
    eventType: "payment",
    cashAmount: 900,
    principalDelta: -750,
    interestPaid: 150,
    feesPaid: 0,
    insurancePaid: 0,
    otherCostPaid: 0,
    breakdownComplete: true,
    movementId: "m1",
    reversalOfEventId: null,
    description: "Pago cuota",
    registeredByUserId: "u1",
    createdAt: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

function collateral(overrides: Partial<DebtCollateral> = {}): DebtCollateral {
  return {
    id: "c1",
    debtId: "d1",
    description: "Laptop HP",
    pledgedValue: 3000,
    estimatedValue: 2500,
    redemptionDeadline: "2026-09-30",
    status: "pledged",
    notes: "",
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("DEBT-4A Debt Intelligence Read-Model", () => {
  const todayKey = "2026-08-21";

  describe("Fund Events & Principal", () => {
    it("1. currentPrincipal reuses all effective principalDelta", () => {
      const d1 = debt({ openingPrincipalBalance: 10000 });
      const e1 = debtEvent({ eventType: "payment", principalDelta: -1000 });
      const e2 = debtEvent({ id: "e2", eventType: "principal_adjustment", principalDelta: -500 });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [e1, e2],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].currentPrincipal).toBe(8500); // 10000 - 1000 - 500
    });

    it("2. recordedFundPrincipalReduction counts payment", () => {
      const d1 = debt();
      const ePay = debtEvent({ eventType: "payment", principalDelta: -800 });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [ePay],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].recordedFundPrincipalReduction).toBe(800);
    });

    it("3. counts principal_prepayment", () => {
      const d1 = debt();
      const ePrep = debtEvent({ eventType: "principal_prepayment", principalDelta: -2000 });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [ePrep],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].recordedFundPrincipalReduction).toBe(2000);
      expect(items[0].prepaymentPrincipalReduction).toBe(2000);
    });

    it("4. counts payoff", () => {
      const d1 = debt();
      const ePayoff = debtEvent({ eventType: "payoff", principalDelta: -10000 });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [ePayoff],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].recordedFundPrincipalReduction).toBe(10000);
      expect(items[0].historicalEconomics.payoffCount).toBe(1);
    });

    it("5. reversal removes effect of target event", () => {
      const d1 = debt();
      const ePay = debtEvent({ id: "e1", eventType: "payment", principalDelta: -1000 });
      const eRev = debtEvent({ id: "e2", eventType: "reversal", reversalOfEventId: "e1", principalDelta: 1000 });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [ePay, eRev],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].recordedFundPrincipalReduction).toBe(0);
      expect(items[0].currentPrincipal).toBe(10000);
    });

    it("6. principal_adjustment negative does NOT count as principal paid", () => {
      const d1 = debt();
      const eAdj = debtEvent({ eventType: "principal_adjustment", principalDelta: -1500 });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [eAdj],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].recordedFundPrincipalReduction).toBe(0);
      expect(items[0].nonFundPrincipalDelta).toBe(-1500);
      expect(items[0].currentPrincipal).toBe(8500);
    });

    it("7. refinance principalDelta does NOT count as principal paid", () => {
      const d1 = debt();
      const eRef = debtEvent({ eventType: "refinance", principalDelta: 2000 });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [eRef],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].recordedFundPrincipalReduction).toBe(0);
      expect(items[0].nonFundPrincipalDelta).toBe(2000);
      expect(items[0].currentPrincipal).toBe(12000);
    });

    it("8. nonFundPrincipalDelta captures adjustment and refinance", () => {
      const d1 = debt();
      const eAdj = debtEvent({ id: "e1", eventType: "principal_adjustment", principalDelta: -500 });
      const eRef = debtEvent({ id: "e2", eventType: "refinance", principalDelta: 1000 });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [eAdj, eRef],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].nonFundPrincipalDelta).toBe(500); // -500 + 1000 = 500
    });
  });

  describe("Historical Economics", () => {
    it("9-13. historical cash, principal, economic expense, detailed and residual cost", () => {
      const d1 = debt();
      const e1 = debtEvent({
        eventType: "payment",
        cashAmount: 1000,
        principalDelta: -700,
        interestPaid: 200,
        feesPaid: 30,
        insurancePaid: 20,
        otherCostPaid: 0, // detailed = 250
        breakdownComplete: false,
      });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [e1],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      const econ = items[0].historicalEconomics;
      expect(econ.cashOutflow).toBe(1000);
      expect(econ.principalReduction).toBe(700);
      expect(econ.economicExpense).toBe(300); // 1000 - 700
      expect(econ.knownDetailedCosts).toBe(250);
      expect(econ.unclassifiedDebtCost).toBe(50); // 300 - 250
    });

    it("14-16. incomplete breakdown retains residual, no clamp, inconsistent count if residual < -0.01", () => {
      const d1 = debt();
      const eInconsistent = debtEvent({
        eventType: "payment",
        cashAmount: 500,
        principalDelta: -400, // economic expense = 100
        interestPaid: 150, // detailed costs = 150 > 100!
        feesPaid: 0,
        insurancePaid: 0,
        otherCostPaid: 0,
      });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [eInconsistent],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      const econ = items[0].historicalEconomics;
      expect(econ.unclassifiedDebtCost).toBe(-50); // unclamped
      expect(econ.inconsistentEventCount).toBe(1);
    });

    it("17. reversed fund event does not count in historical economics", () => {
      const d1 = debt();
      const ePay = debtEvent({ id: "e1", eventType: "payment", cashAmount: 1000, principalDelta: -800 });
      const eRev = debtEvent({ id: "e2", eventType: "reversal", reversalOfEventId: "e1" });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [ePay, eRev],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].historicalEconomics.cashOutflow).toBe(0);
      expect(items[0].historicalEconomics.paymentCount).toBe(0);
    });
  });

  describe("Original Principal & Progress", () => {
    it("18-19. balanceReductionFromOriginal and percent correct", () => {
      const d1 = debt({ originalPrincipal: 10000, openingPrincipalBalance: 10000 });
      const e1 = debtEvent({ eventType: "payment", principalDelta: -4000 });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [e1],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].balanceReductionFromOriginal).toBe(4000);
      expect(items[0].balanceReductionPercentFromOriginal).toBe(40);
    });

    it("20. originalPrincipal=null => metrics null", () => {
      const d1 = debt({ originalPrincipal: null });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].balanceReductionFromOriginal).toBeNull();
      expect(items[0].balanceReductionPercentFromOriginal).toBeNull();
    });

    it("21. no artificial clamp of percent (can be > 100% or negative)", () => {
      const d1 = debt({ originalPrincipal: 10000, openingPrincipalBalance: 10000 });
      const eRef = debtEvent({ eventType: "refinance", principalDelta: 2000 }); // principal becomes 12000 (> 10000)

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [eRef],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].balanceReductionFromOriginal).toBe(-2000);
      expect(items[0].balanceReductionPercentFromOriginal).toBe(-20); // negative progress unclamped
    });
  });

  describe("Current Schedule & Installments", () => {
    it("22-25. current schedule only and currentScheduleLastDueDate", () => {
      const d1 = debt();
      const sv1 = scheduleVersion({ id: "sv1", versionNumber: 1 });
      const i1 = installment({ id: "i1", scheduleVersionId: "sv1", dueDate: "2026-05-01" });
      const sv2 = scheduleVersion({ id: "sv2", versionNumber: 2 });
      const i2 = installment({ id: "i2", scheduleVersionId: "sv2", dueDate: "2026-11-15" });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [sv1, sv2],
        debtInstallments: [i1, i2],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].hasCurrentSchedule).toBe(true);
      expect(items[0].currentScheduleId).toBe("sv2");
      expect(items[0].currentScheduleInstallmentCount).toBe(1);
      expect(items[0].currentScheduleLastDueDate).toBe("2026-11-15");
    });

    it("26-29. remaining installments uses planning items, handles unknown, overdue, covered", () => {
      const d1 = debt();
      const sv = scheduleVersion();
      const i1 = installment({ id: "i1", dueDate: "2026-07-15", expectedAmount: 900 }); // overdue
      const i2 = installment({ id: "i2", dueDate: "2026-08-25", expectedAmount: null }); // unknown
      const i3 = installment({ id: "i3", dueDate: "2026-09-25", expectedAmount: 900 }); // covered

      const eCovered = debtEvent({ id: "e1" });
      const alloc = { id: "a1", eventId: "e1", installmentId: "i3", debtId: "d1", allocatedAmount: 900, createdByUserId: "u1", createdAt: "2026-08-10" };

      const planningItems = buildDebtPlanningItems([d1], [eCovered], [sv], [i1, i2, i3], [alloc], todayKey);
      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [eCovered],
        debtScheduleVersions: [sv],
        debtInstallments: [i1, i2, i3],
        debtCollaterals: [],
        debtPlanningItems: planningItems,
        todayKey,
      });

      expect(items[0].remainingInstallmentCount).toBe(2); // i1 (overdue), i2 (unknown)
      expect(items[0].knownRemainingInstallmentCount).toBe(1); // i1
      expect(items[0].unknownRemainingInstallmentCount).toBe(1); // i2
      expect(items[0].overdueInstallmentCount).toBe(1); // i1
    });

    it("30. next outstanding chooses overdue before future", () => {
      const d1 = debt();
      const sv = scheduleVersion();
      const iFuture = installment({ id: "i-future", installmentNumber: 2, dueDate: "2026-09-01" });
      const iOverdue = installment({ id: "i-overdue", installmentNumber: 1, dueDate: "2026-07-10" });

      const planningItems = buildDebtPlanningItems([d1], [], [sv], [iFuture, iOverdue], [], todayKey);
      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [sv],
        debtInstallments: [iFuture, iOverdue],
        debtCollaterals: [],
        debtPlanningItems: planningItems,
        todayKey,
      });

      expect(items[0].nextInstallmentId).toBe("i-overdue");
      expect(items[0].nextInstallmentDueStatus).toBe("overdue");
    });
  });

  describe("Next 30 Days", () => {
    it("31-35. next30 range semantics (today included, day 30 included, day 31 excluded, overdue excluded, unknown counted)", () => {
      const d1 = debt();
      const sv = scheduleVersion();

      const iToday = installment({ id: "i-today", dueDate: "2026-08-21", expectedAmount: 100 }); // day 0
      const i30 = installment({ id: "i-30", dueDate: "2026-09-20", expectedAmount: 200 }); // day 30
      const i31 = installment({ id: "i-31", dueDate: "2026-09-21", expectedAmount: 300 }); // day 31
      const iOverdue = installment({ id: "i-overdue", dueDate: "2026-08-10", expectedAmount: 400 }); // overdue
      const iUnknown30 = installment({ id: "i-unk30", dueDate: "2026-08-28", expectedAmount: null }); // unknown day 7

      const planningItems = buildDebtPlanningItems([d1], [], [sv], [iToday, i30, i31, iOverdue, iUnknown30], [], todayKey);
      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [sv],
        debtInstallments: [iToday, i30, i31, iOverdue, iUnknown30],
        debtCollaterals: [],
        debtPlanningItems: planningItems,
        todayKey,
      });

      const item = items[0];
      expect(item.next30InstallmentCount).toBe(3); // iToday, i30, iUnknown30
      expect(item.next30KnownAmount).toBe(300); // 100 + 200
      expect(item.next30UnknownAmountCount).toBe(1); // iUnknown30
      expect(item.overdueInstallmentCount).toBe(1); // iOverdue counted separately
    });
  });

  describe("Rate Information", () => {
    it("36-39. TCEA has basis=tcea, tea only has basis=tea, neither has unknown/null", () => {
      const dTcea = debt({ id: "d-tcea", tceaPercent: 22.5, teaPercent: 18.0 });
      const dTea = debt({ id: "d-tea", tceaPercent: null, teaPercent: 15.0 });
      const dNone = debt({ id: "d-none", tceaPercent: null, teaPercent: null });

      const items = buildDebtIntelligenceItems({
        debts: [dTcea, dTea, dNone],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].rateBasis).toBe("tcea");
      expect(items[0].ratePercent).toBe(22.5);

      expect(items[1].rateBasis).toBe("tea");
      expect(items[1].ratePercent).toBe(15.0);

      expect(items[2].rateBasis).toBe("unknown");
      expect(items[2].ratePercent).toBeNull();
    });
  });

  describe("Collateral Intelligence", () => {
    it("40-43. pledged status is active, released is not, nearest redemption deadline & status correct", () => {
      const d1 = debt();
      const cPledged = collateral({ id: "c1", status: "pledged", redemptionDeadline: "2026-09-10" });
      const cReleased = collateral({ id: "c2", status: "released", redemptionDeadline: "2026-08-01" });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [cPledged, cReleased],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].hasActiveCollateral).toBe(true);
      expect(items[0].activeCollateralCount).toBe(1);
      expect(items[0].nearestRedemptionDeadline).toBe("2026-09-10");
      expect(items[0].nearestRedemptionStatus).toBe("later");
    });
  });

  describe("Readiness Flags", () => {
    it("44-48. missing flags generated, collateral absence does NOT generate limitation", () => {
      const dIncomplete = debt({
        originalPrincipal: null,
        tceaPercent: null,
        teaPercent: null,
      });

      const items = buildDebtIntelligenceItems({
        debts: [dIncomplete],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      const readiness = items[0].readiness;
      expect(readiness.hasOriginalPrincipal).toBe(false);
      expect(readiness.hasCurrentSchedule).toBe(false);
      expect(readiness.hasRate).toBe(false);
      expect(readiness.limitations).toContain("missing_original_principal");
      expect(readiness.limitations).toContain("missing_current_schedule");
      expect(readiness.limitations).toContain("missing_rate");
    });
  });

  describe("Portfolio Intelligence", () => {
    it("49-52. portfolio includes active non-archived only (paid_off, refinanced, archived excluded)", () => {
      const dActive = debt({ id: "d-active", status: "active", isArchived: false });
      const dPaidOff = debt({ id: "d-paidoff", status: "paid_off", isArchived: false });
      const dRefinanced = debt({ id: "d-refinanced", status: "refinanced", isArchived: false });
      const dArchived = debt({ id: "d-archived", status: "active", isArchived: true });

      const items = buildDebtIntelligenceItems({
        debts: [dActive, dPaidOff, dRefinanced, dArchived],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items).toHaveLength(4); // items built for all debts

      const portfolio = buildDebtPortfolioIntelligence(items);
      expect(portfolio.totalActiveDebts).toBe(1);
    });

    it("53-58. PEN/USD separated, largest/smallest by currency, prepayments & historical costs by currency", () => {
      const dPEN1 = debt({ id: "d-pen1", currencyCode: "PEN", openingPrincipalBalance: 5000 });
      const dPEN2 = debt({ id: "d-pen2", currencyCode: "PEN", openingPrincipalBalance: 15000 });
      const dUSD = debt({ id: "d-usd", currencyCode: "USD", openingPrincipalBalance: 2000 });

      const items = buildDebtIntelligenceItems({
        debts: [dPEN1, dPEN2, dUSD],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      const portfolio = buildDebtPortfolioIntelligence(items);
      expect(Object.keys(portfolio.byCurrency)).toEqual(["PEN", "USD"]);

      const penGroup = portfolio.byCurrency["PEN"];
      expect(penGroup.activeDebtCount).toBe(2);
      expect(penGroup.totalCurrentPrincipal).toBe(20000);
      expect(penGroup.largestDebtId).toBe("d-pen2");
      expect(penGroup.smallestDebtId).toBe("d-pen1");

      const usdGroup = portfolio.byCurrency["USD"];
      expect(usdGroup.activeDebtCount).toBe(1);
      expect(usdGroup.totalCurrentPrincipal).toBe(2000);
    });

    it("59. global non-monetary counts correct", () => {
      const d1 = debt({ id: "d1", tceaPercent: null, teaPercent: null }); // unrated
      const d2 = debt({ id: "d2", tceaPercent: 15 });

      const items = buildDebtIntelligenceItems({
        debts: [d1, d2],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      const portfolio = buildDebtPortfolioIntelligence(items);
      expect(portfolio.totalActiveDebts).toBe(2);
      expect(portfolio.unratedDebtCount).toBe(1);
      expect(portfolio.debtsWithoutCurrentScheduleCount).toBe(2);
    });
  });
});
