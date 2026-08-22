import { describe, expect, it } from "vitest";
import type { DebtIntelligenceItem } from "./debtIntelligence";
import {
  simulateDebtPrincipalPrepayment,
  simulateDebtPrincipalPrepaymentScenarios,
} from "./debtSimulation";

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

describe("DEBT-4C Principal Prepayment Simulator", () => {
  // -------------------------------------------------------------------------
  // 1. ELIGIBILITY (Tests 1-8)
  // -------------------------------------------------------------------------
  describe("Eligibility", () => {
    it("1. active non-archived debt is simulatable", () => {
      const item = mockIntelligenceItem({ status: "active", isArchived: false });
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect(sim.status).toBe("valid_prepayment");
    });

    it("2. paid_off => status = not_active", () => {
      const item = mockIntelligenceItem({ status: "paid_off" });
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect(sim.status).toBe("not_active");
      expect(sim.appliedPrincipalReduction).toBeNull();
    });

    it("3. refinanced => status = not_active", () => {
      const item = mockIntelligenceItem({ status: "refinanced" });
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect(sim.status).toBe("not_active");
      expect(sim.appliedPrincipalReduction).toBeNull();
    });

    it("4. archived => status = archived", () => {
      const item = mockIntelligenceItem({ isArchived: true });
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect(sim.status).toBe("archived");
      expect(sim.appliedPrincipalReduction).toBeNull();
    });

    it("5. credit_card => status = unsupported_debt_kind", () => {
      const item = mockIntelligenceItem({ debtKind: "credit_card" });
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect(sim.status).toBe("unsupported_debt_kind");
      expect(sim.appliedPrincipalReduction).toBeNull();
    });

    it("6. currentPrincipal = 0 => status = no_outstanding_principal", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 0 });
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect(sim.status).toBe("no_outstanding_principal");
      expect(sim.appliedPrincipalReduction).toBeNull();
    });

    it("7. currentPrincipal negative => status = no_outstanding_principal", () => {
      const item = mockIntelligenceItem({ currentPrincipal: -500 });
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect(sim.status).toBe("no_outstanding_principal");
      expect(sim.appliedPrincipalReduction).toBeNull();
    });

    it("8. input item is not mutated", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 10000 });
      const copyBefore = JSON.parse(JSON.stringify(item));

      simulateDebtPrincipalPrepayment(item, 2000);

      expect(item).toEqual(copyBefore);
    });
  });

  // -------------------------------------------------------------------------
  // 2. INPUT VALIDATION (Tests 9-14)
  // -------------------------------------------------------------------------
  describe("Input Validation", () => {
    it("9. amount NaN => status = invalid_amount", () => {
      const item = mockIntelligenceItem();
      const sim = simulateDebtPrincipalPrepayment(item, NaN);

      expect(sim.status).toBe("invalid_amount");
      expect(sim.appliedPrincipalReduction).toBeNull();
    });

    it("10. amount Infinity => status = invalid_amount", () => {
      const item = mockIntelligenceItem();
      const sim = simulateDebtPrincipalPrepayment(item, Infinity);

      expect(sim.status).toBe("invalid_amount");
      expect(sim.appliedPrincipalReduction).toBeNull();
    });

    it("11. amount 0 => status = invalid_amount", () => {
      const item = mockIntelligenceItem();
      const sim = simulateDebtPrincipalPrepayment(item, 0);

      expect(sim.status).toBe("invalid_amount");
      expect(sim.appliedPrincipalReduction).toBeNull();
    });

    it("12. amount negative => status = invalid_amount", () => {
      const item = mockIntelligenceItem();
      const sim = simulateDebtPrincipalPrepayment(item, -500);

      expect(sim.status).toBe("invalid_amount");
      expect(sim.appliedPrincipalReduction).toBeNull();
    });

    it("13. amount greater than principal + tolerance => status = exceeds_current_principal", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 5000 });
      const sim = simulateDebtPrincipalPrepayment(item, 5000.02);

      expect(sim.status).toBe("exceeds_current_principal");
    });

    it("14. exceeds does NOT clamp silently (appliedPrincipalReduction and simulatedPrincipal remain null)", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 5000 });
      const sim = simulateDebtPrincipalPrepayment(item, 6000);

      expect(sim.status).toBe("exceeds_current_principal");
      expect(sim.appliedPrincipalReduction).toBeNull();
      expect(sim.simulatedPrincipal).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 3. VALID PREPAYMENT (Tests 15-21)
  // -------------------------------------------------------------------------
  describe("Valid Prepayment", () => {
    it("15. amount smaller than principal => status = valid_prepayment", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 10000 });
      const sim = simulateDebtPrincipalPrepayment(item, 3000);

      expect(sim.status).toBe("valid_prepayment");
    });

    it("16. operationHint = principal_prepayment", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 10000 });
      const sim = simulateDebtPrincipalPrepayment(item, 3000);

      expect(sim.operationHint).toBe("principal_prepayment");
    });

    it("17. appliedPrincipalReduction equals requested amount", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 10000 });
      const sim = simulateDebtPrincipalPrepayment(item, 3000);

      expect(sim.appliedPrincipalReduction).toBe(3000);
    });

    it("18. simulatedPrincipal = currentPrincipal - requestedAmount", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 10000 });
      const sim = simulateDebtPrincipalPrepayment(item, 3000);

      expect(sim.simulatedPrincipal).toBe(7000);
    });

    it("19. principalReductionPercentOfCurrent calculated correctly", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 10000 });
      const sim = simulateDebtPrincipalPrepayment(item, 3000);

      expect(sim.principalReductionPercentOfCurrent).toBe(30);
    });

    it("20. currencyCode preserved", () => {
      const item = mockIntelligenceItem({ currencyCode: "USD" });
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect(sim.currencyCode).toBe("USD");
    });

    it("21. rate does not alter simulatedPrincipal", () => {
      const itemTcea = mockIntelligenceItem({ currentPrincipal: 10000, rateBasis: "tcea", ratePercent: 40.0 });
      const itemTea = mockIntelligenceItem({ currentPrincipal: 10000, rateBasis: "tea", ratePercent: 5.0 });

      const simTcea = simulateDebtPrincipalPrepayment(itemTcea, 2000);
      const simTea = simulateDebtPrincipalPrepayment(itemTea, 2000);

      expect(simTcea.simulatedPrincipal).toBe(8000);
      expect(simTea.simulatedPrincipal).toBe(8000);
    });
  });

  // -------------------------------------------------------------------------
  // 4. PAYOFF CANDIDATE (Tests 22-26)
  // -------------------------------------------------------------------------
  describe("Payoff Candidate", () => {
    it("22. amount exactly equal to currentPrincipal => status = payoff_candidate", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 5000 });
      const sim = simulateDebtPrincipalPrepayment(item, 5000);

      expect(sim.status).toBe("payoff_candidate");
    });

    it("23. operationHint = payoff", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 5000 });
      const sim = simulateDebtPrincipalPrepayment(item, 5000);

      expect(sim.operationHint).toBe("payoff");
    });

    it("24. simulatedPrincipal = 0", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 5000 });
      const sim = simulateDebtPrincipalPrepayment(item, 5000);

      expect(sim.simulatedPrincipal).toBe(0);
    });

    it("25. amount within tolerance (4999.995 vs 5000) => status = payoff_candidate", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 5000 });
      const sim = simulateDebtPrincipalPrepayment(item, 4999.995);

      expect(sim.status).toBe("payoff_candidate");
      expect(sim.simulatedPrincipal).toBe(0);
    });

    it("26. payoff candidate does NOT generate exact cash outflow (simulatedCashOutflow = null)", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 5000 });
      const sim = simulateDebtPrincipalPrepayment(item, 5000);

      expect(sim.simulatedCashOutflow).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 5. ORIGINAL PRINCIPAL PROGRESS (Tests 27-30)
  // -------------------------------------------------------------------------
  describe("Original Principal Progress", () => {
    it("27. simulatedBalanceReductionFromOriginal calculated correctly", () => {
      const item = mockIntelligenceItem({ originalPrincipal: 10000, currentPrincipal: 8000 }); // current=8000
      const sim = simulateDebtPrincipalPrepayment(item, 2000); // simulatedPrincipal=6000

      expect(sim.simulatedBalanceReductionFromOriginal).toBe(4000); // 10000 - 6000
    });

    it("28. simulated balance reduction percent from original calculated correctly", () => {
      const item = mockIntelligenceItem({ originalPrincipal: 10000, currentPrincipal: 8000 });
      const sim = simulateDebtPrincipalPrepayment(item, 2000); // simulatedPrincipal=6000

      expect(sim.simulatedBalanceReductionPercentFromOriginal).toBe(40); // (4000 / 10000) * 100
    });

    it("29. originalPrincipal = null => original progress metrics are null", () => {
      const item = mockIntelligenceItem({ originalPrincipal: null });
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect(sim.simulatedBalanceReductionFromOriginal).toBeNull();
      expect(sim.simulatedBalanceReductionPercentFromOriginal).toBeNull();
    });

    it("30. balance reduction percent from original is not clamped between 0 and 100", () => {
      const item = mockIntelligenceItem({ originalPrincipal: 10000, currentPrincipal: 12000 }); // refinance increased principal
      const sim = simulateDebtPrincipalPrepayment(item, 1000); // simulatedPrincipal = 11000

      expect(sim.simulatedBalanceReductionFromOriginal).toBe(-1000); // 10000 - 11000
      expect(sim.simulatedBalanceReductionPercentFromOriginal).toBe(-10); // unclamped negative progress
    });
  });

  // -------------------------------------------------------------------------
  // 6. EFFECTS WE MUST NOT INVENT (Tests 31-36)
  // -------------------------------------------------------------------------
  describe("Effects We Must Not Invent", () => {
    it("31. exactInterestSavingsAmount is always null", () => {
      const item = mockIntelligenceItem();
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect(sim.exactInterestSavingsAmount).toBeNull();
    });

    it("32. simulatedInstallmentAmount is always null", () => {
      const item = mockIntelligenceItem();
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect(sim.simulatedInstallmentAmount).toBeNull();
    });

    it("33. simulatedScheduleLastDueDate is always null", () => {
      const item = mockIntelligenceItem();
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect(sim.simulatedScheduleLastDueDate).toBeNull();
    });

    it("34. simulatedCashOutflow is always null", () => {
      const item = mockIntelligenceItem();
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect(sim.simulatedCashOutflow).toBeNull();
    });

    it("35. currentScheduleLastDueDate remains as reference only and is not altered", () => {
      const item = mockIntelligenceItem({ currentScheduleLastDueDate: "2027-01-01" });
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect(sim.currentScheduleLastDueDate).toBe("2027-01-01");
      expect(sim.simulatedScheduleLastDueDate).toBeNull();
    });

    it("36. valid scenario includes explicit limitations array", () => {
      const item = mockIntelligenceItem();
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect(sim.limitations).toContain("exact_interest_savings_unavailable");
      expect(sim.limitations).toContain("installment_recalculation_unavailable");
      expect(sim.limitations).toContain("payoff_date_recalculation_unavailable");
      expect(sim.limitations).toContain("cash_outflow_not_determined");
      expect(sim.limitations).toContain("recalculated_schedule_required");
    });
  });

  // -------------------------------------------------------------------------
  // 7. EXTRA RECOMMENDED TESTS (Tests 37-44)
  // -------------------------------------------------------------------------
  describe("Extra Scenarios & Property Absences", () => {
    it("37. TCEA 40% vs TCEA 10% produces identical simulatedPrincipal", () => {
      const item1 = mockIntelligenceItem({ currentPrincipal: 10000, rateBasis: "tcea", ratePercent: 40 });
      const item2 = mockIntelligenceItem({ currentPrincipal: 10000, rateBasis: "tcea", ratePercent: 10 });

      const sim1 = simulateDebtPrincipalPrepayment(item1, 2500);
      const sim2 = simulateDebtPrincipalPrepayment(item2, 2500);

      expect(sim1.simulatedPrincipal).toBe(7500);
      expect(sim2.simulatedPrincipal).toBe(7500);
    });

    it("38. TEA vs unknown rate produces identical simulatedPrincipal", () => {
      const itemTea = mockIntelligenceItem({ currentPrincipal: 10000, rateBasis: "tea", ratePercent: 15 });
      const itemUnk = mockIntelligenceItem({ currentPrincipal: 10000, rateBasis: "unknown", ratePercent: null });

      const simTea = simulateDebtPrincipalPrepayment(itemTea, 1500);
      const simUnk = simulateDebtPrincipalPrepayment(itemUnk, 1500);

      expect(simTea.simulatedPrincipal).toBe(8500);
      expect(simUnk.simulatedPrincipal).toBe(8500);
    });

    it("39. scenario series preserves input order", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 10000 });
      const amounts = [1000, 5000, 10000];

      const sims = simulateDebtPrincipalPrepaymentScenarios(item, amounts);

      expect(sims.map((s) => s.requestedPrincipalReduction)).toEqual([1000, 5000, 10000]);
    });

    it("40. scenario series reuses status payoff/prepayment correctly", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 10000 });
      const amounts = [1000, 10000, 15000];

      const sims = simulateDebtPrincipalPrepaymentScenarios(item, amounts);

      expect(sims[0].status).toBe("valid_prepayment");
      expect(sims[1].status).toBe("payoff_candidate");
      expect(sims[2].status).toBe("exceeds_current_principal");
    });

    it("41. invalid scenario does not return partial simulated numbers", () => {
      const item = mockIntelligenceItem({ currentPrincipal: 10000 });
      const sim = simulateDebtPrincipalPrepayment(item, -100);

      expect(sim.appliedPrincipalReduction).toBeNull();
      expect(sim.simulatedPrincipal).toBeNull();
      expect(sim.principalReductionPercentOfCurrent).toBeNull();
      expect(sim.simulatedBalanceReductionFromOriginal).toBeNull();
    });

    it("42. no interestSavingsPercent property exists", () => {
      const item = mockIntelligenceItem();
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect((sim as any).interestSavingsPercent).toBeUndefined();
    });

    it("43. no simulatedMonthlyPayment property exists", () => {
      const item = mockIntelligenceItem();
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect((sim as any).simulatedMonthlyPayment).toBeUndefined();
    });

    it("44. no global/crossCurrency summary property exists", () => {
      const item = mockIntelligenceItem();
      const sim = simulateDebtPrincipalPrepayment(item, 1000);

      expect((sim as any).globalSummary).toBeUndefined();
      expect((sim as any).crossCurrencyTotal).toBeUndefined();
    });
  });
});
