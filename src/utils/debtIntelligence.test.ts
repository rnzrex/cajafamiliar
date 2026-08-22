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
    cashAmount: 1000,
    principalDelta: -800,
    interestPaid: 200,
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

describe("DEBT-4A Debt Intelligence Read-Model Contractual Coverage", () => {
  const todayKey = "2026-08-21";

  // -------------------------------------------------------------------------
  // 1. FUND EVENTS / PRINCIPAL (Tests 1-8)
  // -------------------------------------------------------------------------
  describe("Fund Events & Principal", () => {
    it("1. currentPrincipal reuses all effective principalDelta", () => {
      const d1 = debt({ openingPrincipalBalance: 10000 });
      const e1 = debtEvent({ eventType: "payment", cashAmount: 1000, principalDelta: -800 });
      const e2 = debtEvent({ id: "e2", eventType: "principal_adjustment", cashAmount: 0, principalDelta: -500 });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [e1, e2],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].currentPrincipal).toBe(8700); // 10000 - 800 - 500
    });

    it("2. recordedFundPrincipalReduction counts payment", () => {
      const d1 = debt();
      const ePay = debtEvent({ eventType: "payment", cashAmount: 1000, principalDelta: -800 });

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

    it("3. recordedFundPrincipalReduction counts principal_prepayment", () => {
      const d1 = debt();
      const ePrep = debtEvent({ eventType: "principal_prepayment", cashAmount: 2000, principalDelta: -2000 });

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
      expect(items[0].prepaymentCashOutflow).toBe(2000);
    });

    it("4. recordedFundPrincipalReduction counts payoff", () => {
      const d1 = debt();
      const ePayoff = debtEvent({ eventType: "payoff", cashAmount: 10200, principalDelta: -10000, interestPaid: 200 });

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

    it("5. reversal eliminates the target event from fund principal reduction and currentPrincipal", () => {
      const d1 = debt({ openingPrincipalBalance: 10000 });
      const ePay = debtEvent({ id: "e1", eventType: "payment", cashAmount: 1000, principalDelta: -800, interestPaid: 200 });
      const eRev = debtEvent({
        id: "e2",
        eventType: "reversal",
        cashAmount: 0,
        principalDelta: 0,
        interestPaid: 0,
        feesPaid: 0,
        insurancePaid: 0,
        otherCostPaid: 0,
        breakdownComplete: false,
        movementId: null,
        reversalOfEventId: "e1",
      });

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
      const d1 = debt({ openingPrincipalBalance: 10000 });
      const eAdj = debtEvent({ eventType: "principal_adjustment", cashAmount: 0, principalDelta: -1500 });

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
      const d1 = debt({ openingPrincipalBalance: 10000 });
      const eRef = debtEvent({ eventType: "refinance", cashAmount: 0, principalDelta: 2000 });

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
      const eAdj = debtEvent({ id: "e1", eventType: "principal_adjustment", cashAmount: 0, principalDelta: -500 });
      const eRef = debtEvent({ id: "e2", eventType: "refinance", cashAmount: 0, principalDelta: 1000 });

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

  // -------------------------------------------------------------------------
  // 2. HISTORICAL ECONOMICS (Tests 9-17)
  // -------------------------------------------------------------------------
  describe("Historical Economics", () => {
    it("9. historical economics calculates total cashOutflow", () => {
      const d1 = debt();
      const e1 = debtEvent({ eventType: "payment", cashAmount: 1000, principalDelta: -700, interestPaid: 300 });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [e1],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].historicalEconomics.cashOutflow).toBe(1000);
    });

    it("10. historical economics calculates total principalReduction", () => {
      const d1 = debt();
      const e1 = debtEvent({ eventType: "payment", cashAmount: 1000, principalDelta: -700, interestPaid: 300 });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [e1],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].historicalEconomics.principalReduction).toBe(700);
    });

    it("11. historical economics calculates economicExpense = cash + principalDelta", () => {
      const d1 = debt();
      const e1 = debtEvent({ eventType: "payment", cashAmount: 1000, principalDelta: -700 });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [e1],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].historicalEconomics.economicExpense).toBe(300); // 1000 + (-700) = 300
    });

    it("12. historical economics calculates knownDetailedCosts", () => {
      const d1 = debt();
      const e1 = debtEvent({
        eventType: "payment",
        cashAmount: 1000,
        principalDelta: -700,
        interestPaid: 200,
        feesPaid: 30,
        insurancePaid: 20,
        otherCostPaid: 0,
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

      expect(items[0].historicalEconomics.knownDetailedCosts).toBe(250);
    });

    it("13. historical economics calculates positive unclassifiedDebtCost residual", () => {
      const d1 = debt();
      const e1 = debtEvent({
        eventType: "payment",
        cashAmount: 1000,
        principalDelta: -700, // economic expense = 300
        interestPaid: 200, // detailed costs = 200
        feesPaid: 0,
        insurancePaid: 0,
        otherCostPaid: 0,
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

      expect(items[0].historicalEconomics.unclassifiedDebtCost).toBe(100); // 300 - 200 = 100
    });

    it("14. incomplete breakdown retains unclassifiedDebtCost residual", () => {
      const d1 = debt();
      const eIncomplete = debtEvent({
        eventType: "payment",
        cashAmount: 1000,
        principalDelta: -700,
        breakdownComplete: false,
        interestPaid: 0,
        feesPaid: 0,
        insurancePaid: 0,
        otherCostPaid: 0,
      });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [eIncomplete],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].historicalEconomics.unclassifiedDebtCost).toBe(300);
    });

    it("15. negative unclassifiedDebtCost residual is NOT clamped to zero", () => {
      const d1 = debt();
      const eInconsistent = debtEvent({
        eventType: "payment",
        cashAmount: 500,
        principalDelta: -400, // economic expense = 100
        interestPaid: 150, // detailed costs = 150 > 100
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

      expect(items[0].historicalEconomics.unclassifiedDebtCost).toBe(-50); // unclamped
    });

    it("16. residual < -0.01 increments inconsistentEventCount", () => {
      const d1 = debt();
      const eInconsistent = debtEvent({
        eventType: "payment",
        cashAmount: 500,
        principalDelta: -400,
        interestPaid: 150,
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

      expect(items[0].historicalEconomics.inconsistentEventCount).toBe(1);
    });

    it("17. reversed fund event does not count in historical economics", () => {
      const d1 = debt();
      const ePay = debtEvent({ id: "e1", eventType: "payment", cashAmount: 1000, principalDelta: -800, interestPaid: 200 });
      const eRev = debtEvent({
        id: "e2",
        eventType: "reversal",
        cashAmount: 0,
        principalDelta: 0,
        reversalOfEventId: "e1",
      });

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
      expect(items[0].historicalEconomics.fundEventCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. ORIGINAL PRINCIPAL / PROGRESS (Tests 18-21)
  // -------------------------------------------------------------------------
  describe("Original Principal & Progress", () => {
    it("18. balanceReductionFromOriginal is calculated as originalPrincipal minus currentPrincipal", () => {
      const d1 = debt({ originalPrincipal: 10000, openingPrincipalBalance: 10000 });
      const e1 = debtEvent({ eventType: "payment", cashAmount: 4000, principalDelta: -4000 });

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
    });

    it("19. balanceReductionPercentFromOriginal is calculated relative to originalPrincipal", () => {
      const d1 = debt({ originalPrincipal: 10000, openingPrincipalBalance: 10000 });
      const e1 = debtEvent({ eventType: "payment", cashAmount: 4000, principalDelta: -4000 });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [e1],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].balanceReductionPercentFromOriginal).toBe(40);
    });

    it("20. originalPrincipal null results in null reduction metrics", () => {
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

    it("21. balanceReductionPercentFromOriginal is not artificially clamped between 0 and 100", () => {
      const d1 = debt({ originalPrincipal: 10000, openingPrincipalBalance: 10000 });
      const eRef = debtEvent({ eventType: "refinance", cashAmount: 0, principalDelta: 2000 }); // currentPrincipal = 12000

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
      expect(items[0].balanceReductionPercentFromOriginal).toBe(-20);
    });
  });

  // -------------------------------------------------------------------------
  // 4. SCHEDULE / OUTSTANDING (Tests 22-30)
  // -------------------------------------------------------------------------
  describe("Current Schedule & Installments", () => {
    it("22. current schedule only is used for installment count and last due date", () => {
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
    });

    it("23. historical schedule does not define currentScheduleLastDueDate", () => {
      const d1 = debt();
      const sv1 = scheduleVersion({ id: "sv1", versionNumber: 1 });
      const iOld = installment({ id: "i1", scheduleVersionId: "sv1", dueDate: "2027-12-31" });
      const sv2 = scheduleVersion({ id: "sv2", versionNumber: 2 });
      const iNew = installment({ id: "i2", scheduleVersionId: "sv2", dueDate: "2026-10-01" });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [sv1, sv2],
        debtInstallments: [iOld, iNew],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].currentScheduleLastDueDate).toBe("2026-10-01");
    });

    it("24. currentScheduleLastDueDate is calculated as the maximum due date of the current schedule", () => {
      const d1 = debt();
      const sv = scheduleVersion({ id: "sv1" });
      const i1 = installment({ id: "i1", scheduleVersionId: "sv1", dueDate: "2026-09-01" });
      const i2 = installment({ id: "i2", scheduleVersionId: "sv1", dueDate: "2026-12-15" });
      const i3 = installment({ id: "i3", scheduleVersionId: "sv1", dueDate: "2026-10-01" });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [sv],
        debtInstallments: [i1, i2, i3],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].currentScheduleLastDueDate).toBe("2026-12-15");
    });

    it("25. debt without current schedule results in null currentScheduleId and false hasCurrentSchedule", () => {
      const d1 = debt();

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].hasCurrentSchedule).toBe(false);
      expect(items[0].currentScheduleId).toBeNull();
      expect(items[0].currentScheduleLastDueDate).toBeNull();
    });

    it("26. remainingInstallmentCount uses planning items for non-covered installments", () => {
      const d1 = debt();
      const sv = scheduleVersion();
      const i1 = installment({ id: "i1", dueDate: "2026-08-25", expectedAmount: 900 });
      const i2 = installment({ id: "i2", dueDate: "2026-09-25", expectedAmount: 900 });

      const planningItems = buildDebtPlanningItems([d1], [], [sv], [i1, i2], [], todayKey);
      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [sv],
        debtInstallments: [i1, i2],
        debtCollaterals: [],
        debtPlanningItems: planningItems,
        todayKey,
      });

      expect(items[0].remainingInstallmentCount).toBe(2);
    });

    it("27. unknownRemainingInstallmentCount counts non-covered installments with expectedAmount null", () => {
      const d1 = debt();
      const sv = scheduleVersion();
      const i1 = installment({ id: "i1", dueDate: "2026-08-25", expectedAmount: 900 });
      const iUnknown = installment({ id: "i2", dueDate: "2026-09-25", expectedAmount: null });

      const planningItems = buildDebtPlanningItems([d1], [], [sv], [i1, iUnknown], [], todayKey);
      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [sv],
        debtInstallments: [i1, iUnknown],
        debtCollaterals: [],
        debtPlanningItems: planningItems,
        todayKey,
      });

      expect(items[0].unknownRemainingInstallmentCount).toBe(1);
      expect(items[0].knownRemainingInstallmentCount).toBe(1);
    });

    it("28. overdueInstallmentCount counts non-covered installments with dueStatus overdue", () => {
      const d1 = debt();
      const sv = scheduleVersion();
      const iOverdue = installment({ id: "i1", dueDate: "2026-07-15", expectedAmount: 900 }); // overdue

      const planningItems = buildDebtPlanningItems([d1], [], [sv], [iOverdue], [], todayKey);
      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [sv],
        debtInstallments: [iOverdue],
        debtCollaterals: [],
        debtPlanningItems: planningItems,
        todayKey,
      });

      expect(items[0].overdueInstallmentCount).toBe(1);
    });

    it("29. covered installment is excluded from remainingInstallmentCount", () => {
      const d1 = debt();
      const sv = scheduleVersion();
      const iCovered = installment({ id: "i1", dueDate: "2026-08-25", expectedAmount: 900 });
      const ePay = debtEvent({ id: "e1", cashAmount: 1000, principalDelta: -900 });
      const alloc = { id: "a1", eventId: "e1", installmentId: "i1", debtId: "d1", allocatedAmount: 900, createdByUserId: "u1", createdAt: "2026-08-10" };

      const planningItems = buildDebtPlanningItems([d1], [ePay], [sv], [iCovered], [alloc], todayKey);
      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [ePay],
        debtScheduleVersions: [sv],
        debtInstallments: [iCovered],
        debtCollaterals: [],
        debtPlanningItems: planningItems,
        todayKey,
      });

      expect(items[0].remainingInstallmentCount).toBe(0);
    });

    it("30. next outstanding installment selects overdue installment before future installment", () => {
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

  // -------------------------------------------------------------------------
  // 5. NEXT 30 DAYS (Tests 31-35)
  // -------------------------------------------------------------------------
  describe("Next 30 Days", () => {
    it("31. today (daysUntilDue = 0) is included in next30", () => {
      const d1 = debt();
      const sv = scheduleVersion();
      const iToday = installment({ id: "i-today", dueDate: "2026-08-21", expectedAmount: 500 });

      const planningItems = buildDebtPlanningItems([d1], [], [sv], [iToday], [], todayKey);
      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [sv],
        debtInstallments: [iToday],
        debtCollaterals: [],
        debtPlanningItems: planningItems,
        todayKey,
      });

      expect(items[0].next30InstallmentCount).toBe(1);
      expect(items[0].next30KnownAmount).toBe(500);
    });

    it("32. day 30 (daysUntilDue = 30) is included in next30", () => {
      const d1 = debt();
      const sv = scheduleVersion();
      const i30 = installment({ id: "i-30", dueDate: "2026-09-20", expectedAmount: 600 }); // 30 days from Aug 21

      const planningItems = buildDebtPlanningItems([d1], [], [sv], [i30], [], todayKey);
      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [sv],
        debtInstallments: [i30],
        debtCollaterals: [],
        debtPlanningItems: planningItems,
        todayKey,
      });

      expect(items[0].next30InstallmentCount).toBe(1);
      expect(items[0].next30KnownAmount).toBe(600);
    });

    it("33. day 31 (daysUntilDue = 31) is excluded from next30", () => {
      const d1 = debt();
      const sv = scheduleVersion();
      const i31 = installment({ id: "i-31", dueDate: "2026-09-21", expectedAmount: 700 }); // 31 days from Aug 21

      const planningItems = buildDebtPlanningItems([d1], [], [sv], [i31], [], todayKey);
      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [sv],
        debtInstallments: [i31],
        debtCollaterals: [],
        debtPlanningItems: planningItems,
        todayKey,
      });

      expect(items[0].next30InstallmentCount).toBe(0);
      expect(items[0].next30KnownAmount).toBe(0);
    });

    it("34. overdue installment is excluded from next30 and counted in overdueInstallmentCount", () => {
      const d1 = debt();
      const sv = scheduleVersion();
      const iOverdue = installment({ id: "i-overdue", dueDate: "2026-08-10", expectedAmount: 400 });

      const planningItems = buildDebtPlanningItems([d1], [], [sv], [iOverdue], [], todayKey);
      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [sv],
        debtInstallments: [iOverdue],
        debtCollaterals: [],
        debtPlanningItems: planningItems,
        todayKey,
      });

      expect(items[0].next30InstallmentCount).toBe(0);
      expect(items[0].overdueInstallmentCount).toBe(1);
    });

    it("35. unknown next30 installment is counted in next30UnknownAmountCount and not added to next30KnownAmount as zero", () => {
      const d1 = debt();
      const sv = scheduleVersion();
      const iUnknown = installment({ id: "i-unk", dueDate: "2026-08-28", expectedAmount: null });

      const planningItems = buildDebtPlanningItems([d1], [], [sv], [iUnknown], [], todayKey);
      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [sv],
        debtInstallments: [iUnknown],
        debtCollaterals: [],
        debtPlanningItems: planningItems,
        todayKey,
      });

      expect(items[0].next30InstallmentCount).toBe(1);
      expect(items[0].next30KnownAmount).toBe(0);
      expect(items[0].next30UnknownAmountCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 6. RATES (Tests 36-39)
  // -------------------------------------------------------------------------
  describe("Rates", () => {
    it("36. debt with TCEA has rateBasis = tcea and ratePercent = tceaPercent", () => {
      const dTcea = debt({ tceaPercent: 22.5, teaPercent: 18.0 });

      const items = buildDebtIntelligenceItems({
        debts: [dTcea],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].rateBasis).toBe("tcea");
      expect(items[0].ratePercent).toBe(22.5);
    });

    it("37. debt without TCEA but with TEA has rateBasis = tea and ratePercent = teaPercent", () => {
      const dTea = debt({ tceaPercent: null, teaPercent: 15.0 });

      const items = buildDebtIntelligenceItems({
        debts: [dTea],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].rateBasis).toBe("tea");
      expect(items[0].ratePercent).toBe(15.0);
    });

    it("38. debt without TCEA and without TEA has rateBasis = unknown and ratePercent = null", () => {
      const dNone = debt({ tceaPercent: null, teaPercent: null });

      const items = buildDebtIntelligenceItems({
        debts: [dNone],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].rateBasis).toBe("unknown");
      expect(items[0].ratePercent).toBeNull();
    });

    it("39. rate null is never transformed into zero", () => {
      const dNone = debt({ tceaPercent: null, teaPercent: null });

      const items = buildDebtIntelligenceItems({
        debts: [dNone],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].ratePercent).not.toBe(0);
      expect(items[0].ratePercent).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 7. COLLATERAL (Tests 40-43)
  // -------------------------------------------------------------------------
  describe("Collateral", () => {
    it("40. pledged collateral is considered active", () => {
      const d1 = debt();
      const c1 = collateral({ status: "pledged" });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [c1],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].hasActiveCollateral).toBe(true);
      expect(items[0].activeCollateralCount).toBe(1);
    });

    it("41. released or forfeited collateral is not considered active", () => {
      const d1 = debt();
      const cReleased = collateral({ id: "c1", status: "released" });
      const cForfeited = collateral({ id: "c2", status: "forfeited" });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [cReleased, cForfeited],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].hasActiveCollateral).toBe(false);
      expect(items[0].activeCollateralCount).toBe(0);
    });

    it("42. nearestRedemptionDeadline selects the earliest deadline among multiple pledged collaterals", () => {
      const d1 = debt();
      const cLate = collateral({ id: "c-late", status: "pledged", redemptionDeadline: "2026-09-10" });
      const cEarly = collateral({ id: "c-early", status: "pledged", redemptionDeadline: "2026-09-05" });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [cLate, cEarly],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].nearestRedemptionDeadline).toBe("2026-09-05");
    });

    it("43. nearestRedemptionStatus reuses generic dueDateStatus SSOT", () => {
      const d1 = debt();
      const cOverdue = collateral({ status: "pledged", redemptionDeadline: "2026-08-01" });

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [cOverdue],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].nearestRedemptionStatus).toBe("overdue");
    });
  });

  // -------------------------------------------------------------------------
  // 8. READINESS / LIMITATIONS (Tests 44-48)
  // -------------------------------------------------------------------------
  describe("Readiness & Limitations", () => {
    it("44. missing current schedule generates missing_current_schedule limitation flag", () => {
      const d1 = debt();

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].readiness.limitations).toContain("missing_current_schedule");
    });

    it("45. unknown installment amounts generate unknown_installment_amounts limitation flag", () => {
      const d1 = debt();
      const sv = scheduleVersion();
      const iUnk = installment({ id: "i1", expectedAmount: null });

      const planningItems = buildDebtPlanningItems([d1], [], [sv], [iUnk], [], todayKey);
      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [sv],
        debtInstallments: [iUnk],
        debtCollaterals: [],
        debtPlanningItems: planningItems,
        todayKey,
      });

      expect(items[0].readiness.limitations).toContain("unknown_installment_amounts");
    });

    it("46. missing rate generates missing_rate limitation flag", () => {
      const dNoRate = debt({ tceaPercent: null, teaPercent: null });

      const items = buildDebtIntelligenceItems({
        debts: [dNoRate],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].readiness.limitations).toContain("missing_rate");
    });

    it("47. missing original principal generates missing_original_principal limitation flag", () => {
      const dNoOrig = debt({ originalPrincipal: null });

      const items = buildDebtIntelligenceItems({
        debts: [dNoOrig],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      expect(items[0].readiness.limitations).toContain("missing_original_principal");
    });

    it("48. total absence of collateral does NOT generate any collateral limitation flag", () => {
      const d1 = debt();

      const items = buildDebtIntelligenceItems({
        debts: [d1],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [], // no collaterals
        debtPlanningItems: [],
        todayKey,
      });

      const collLimitations = items[0].readiness.limitations.filter((l) => l.includes("collateral"));
      expect(collLimitations).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 9. PORTFOLIO (Tests 49-59)
  // -------------------------------------------------------------------------
  describe("Portfolio Intelligence", () => {
    it("49. active non-archived debt is included in portfolio intelligence", () => {
      const dActive = debt({ id: "d1", status: "active", isArchived: false });

      const items = buildDebtIntelligenceItems({
        debts: [dActive],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      const portfolio = buildDebtPortfolioIntelligence(items);
      expect(portfolio.totalActiveDebts).toBe(1);
    });

    it("50. paid_off debt is excluded from active portfolio intelligence", () => {
      const dPaidOff = debt({ id: "d1", status: "paid_off", isArchived: false });

      const items = buildDebtIntelligenceItems({
        debts: [dPaidOff],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      const portfolio = buildDebtPortfolioIntelligence(items);
      expect(portfolio.totalActiveDebts).toBe(0);
    });

    it("51. refinanced debt is excluded from active portfolio intelligence", () => {
      const dRefinanced = debt({ id: "d1", status: "refinanced", isArchived: false });

      const items = buildDebtIntelligenceItems({
        debts: [dRefinanced],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      const portfolio = buildDebtPortfolioIntelligence(items);
      expect(portfolio.totalActiveDebts).toBe(0);
    });

    it("52. archived debt (isArchived = true) is excluded from active portfolio intelligence", () => {
      const dArchived = debt({ id: "d1", status: "active", isArchived: true });

      const items = buildDebtIntelligenceItems({
        debts: [dArchived],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      const portfolio = buildDebtPortfolioIntelligence(items);
      expect(portfolio.totalActiveDebts).toBe(0);
    });

    it("53. PEN and USD debts are separated into distinct byCurrency groups", () => {
      const dPEN = debt({ id: "d-pen", currencyCode: "PEN" });
      const dUSD = debt({ id: "d-usd", currencyCode: "USD" });

      const items = buildDebtIntelligenceItems({
        debts: [dPEN, dUSD],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      const portfolio = buildDebtPortfolioIntelligence(items);
      expect(Object.keys(portfolio.byCurrency)).toEqual(["PEN", "USD"]);
    });

    it("54. no aggregated cross-currency monetary field exists on portfolio intelligence", () => {
      const dPEN = debt({ id: "d-pen", currencyCode: "PEN", openingPrincipalBalance: 1000 });
      const dUSD = debt({ id: "d-usd", currencyCode: "USD", openingPrincipalBalance: 500 });

      const items = buildDebtIntelligenceItems({
        debts: [dPEN, dUSD],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      const portfolio = buildDebtPortfolioIntelligence(items);
      expect((portfolio as any).totalCurrentPrincipalGlobal).toBeUndefined();
      expect((portfolio as any).totalMonetaryAmount).toBeUndefined();
    });

    it("55. largestDebtId and smallestDebtId are calculated within each currency group", () => {
      const dSmall = debt({ id: "d-small", currencyCode: "PEN", openingPrincipalBalance: 2000 });
      const dLarge = debt({ id: "d-large", currencyCode: "PEN", openingPrincipalBalance: 12000 });

      const items = buildDebtIntelligenceItems({
        debts: [dSmall, dLarge],
        debtEvents: [],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      const portfolio = buildDebtPortfolioIntelligence(items);
      const pen = portfolio.byCurrency["PEN"];
      expect(pen.largestDebtId).toBe("d-large");
      expect(pen.largestDebtPrincipal).toBe(12000);
      expect(pen.smallestDebtId).toBe("d-small");
      expect(pen.smallestDebtPrincipal).toBe(2000);
    });

    it("56. next30 known amounts and unknown counts are aggregated per currency using real planning items", () => {
      const dPEN = debt({ id: "d-pen", currencyCode: "PEN" });
      const svPEN = scheduleVersion({ id: "sv-pen", debtId: "d-pen" });
      const iPENKnown = installment({ id: "i-pen1", debtId: "d-pen", scheduleVersionId: "sv-pen", dueDate: "2026-08-25", expectedAmount: 500 });
      const iPENUnk = installment({ id: "i-pen2", debtId: "d-pen", scheduleVersionId: "sv-pen", dueDate: "2026-08-30", expectedAmount: null });

      const dUSD = debt({ id: "d-usd", currencyCode: "USD" });
      const svUSD = scheduleVersion({ id: "sv-usd", debtId: "d-usd" });
      const iUSDKnown = installment({ id: "i-usd1", debtId: "d-usd", scheduleVersionId: "sv-usd", dueDate: "2026-08-28", expectedAmount: 150 });

      const planningItems = buildDebtPlanningItems(
        [dPEN, dUSD],
        [],
        [svPEN, svUSD],
        [iPENKnown, iPENUnk, iUSDKnown],
        [],
        todayKey
      );

      const items = buildDebtIntelligenceItems({
        debts: [dPEN, dUSD],
        debtEvents: [],
        debtScheduleVersions: [svPEN, svUSD],
        debtInstallments: [iPENKnown, iPENUnk, iUSDKnown],
        debtCollaterals: [],
        debtPlanningItems: planningItems,
        todayKey,
      });

      const portfolio = buildDebtPortfolioIntelligence(items);

      expect(portfolio.byCurrency["PEN"].next30KnownAmount).toBe(500);
      expect(portfolio.byCurrency["PEN"].next30UnknownAmountCount).toBe(1);
      expect(portfolio.byCurrency["PEN"].next30InstallmentCount).toBe(2);

      expect(portfolio.byCurrency["USD"].next30KnownAmount).toBe(150);
      expect(portfolio.byCurrency["USD"].next30UnknownAmountCount).toBe(0);
      expect(portfolio.byCurrency["USD"].next30InstallmentCount).toBe(1);
    });

    it("57. historical costs are aggregated per currency without cross-currency totals", () => {
      const dPEN = debt({ id: "d-pen", currencyCode: "PEN" });
      const ePEN = debtEvent({ id: "e-pen", debtId: "d-pen", cashAmount: 1000, principalDelta: -800, interestPaid: 150, feesPaid: 50 });

      const dUSD = debt({ id: "d-usd", currencyCode: "USD" });
      const eUSD = debtEvent({ id: "e-usd", debtId: "d-usd", cashAmount: 300, principalDelta: -250, interestPaid: 40, feesPaid: 10 });

      const items = buildDebtIntelligenceItems({
        debts: [dPEN, dUSD],
        debtEvents: [ePEN, eUSD],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      const portfolio = buildDebtPortfolioIntelligence(items);

      expect(portfolio.byCurrency["PEN"].historicalKnownDetailedCosts).toBe(200);
      expect(portfolio.byCurrency["USD"].historicalKnownDetailedCosts).toBe(50);
      expect((portfolio as any).historicalKnownDetailedCostsGlobal).toBeUndefined();
    });

    it("58. prepayment principal reduction and cash outflow are aggregated per currency", () => {
      const dPEN = debt({ id: "d-pen", currencyCode: "PEN" });
      const ePENPrep = debtEvent({ id: "e-pen-prep", debtId: "d-pen", eventType: "principal_prepayment", cashAmount: 3000, principalDelta: -3000 });

      const dUSD = debt({ id: "d-usd", currencyCode: "USD" });
      const eUSDPrep = debtEvent({ id: "e-usd-prep", debtId: "d-usd", eventType: "principal_prepayment", cashAmount: 1000, principalDelta: -1000 });

      const items = buildDebtIntelligenceItems({
        debts: [dPEN, dUSD],
        debtEvents: [ePENPrep, eUSDPrep],
        debtScheduleVersions: [],
        debtInstallments: [],
        debtCollaterals: [],
        debtPlanningItems: [],
        todayKey,
      });

      const portfolio = buildDebtPortfolioIntelligence(items);

      expect(portfolio.byCurrency["PEN"].prepaymentCashOutflow).toBe(3000);
      expect(portfolio.byCurrency["PEN"].prepaymentPrincipalReduction).toBe(3000);

      expect(portfolio.byCurrency["USD"].prepaymentCashOutflow).toBe(1000);
      expect(portfolio.byCurrency["USD"].prepaymentPrincipalReduction).toBe(1000);
    });

    it("59. global non-monetary counts (unrated, without schedule, unknown amounts, active collateral) are correct", () => {
      const dUnratedNoSched = debt({ id: "d1", tceaPercent: null, teaPercent: null });
      const dWithUnk = debt({ id: "d2", tceaPercent: 20 });
      const sv2 = scheduleVersion({ id: "sv2", debtId: "d2" });
      const iUnk = installment({ id: "i-unk", debtId: "d2", scheduleVersionId: "sv2", expectedAmount: null });

      const dColl = debt({ id: "d3", tceaPercent: 18 });
      const cPledged = collateral({ id: "c1", debtId: "d3", status: "pledged" });

      const planningItems = buildDebtPlanningItems([dUnratedNoSched, dWithUnk, dColl], [], [sv2], [iUnk], [], todayKey);

      const items = buildDebtIntelligenceItems({
        debts: [dUnratedNoSched, dWithUnk, dColl],
        debtEvents: [],
        debtScheduleVersions: [sv2],
        debtInstallments: [iUnk],
        debtCollaterals: [cPledged],
        debtPlanningItems: planningItems,
        todayKey,
      });

      const portfolio = buildDebtPortfolioIntelligence(items);

      expect(portfolio.totalActiveDebts).toBe(3);
      expect(portfolio.unratedDebtCount).toBe(1); // dUnratedNoSched
      expect(portfolio.debtsWithoutCurrentScheduleCount).toBe(2); // dUnratedNoSched, dColl
      expect(portfolio.debtsWithUnknownInstallmentsCount).toBe(1); // dWithUnk
      expect(portfolio.debtsWithActiveCollateralCount).toBe(1); // dColl
    });
  });
});
