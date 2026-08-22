import { describe, expect, it } from "vitest";
import type { DebtIntelligenceItem } from "./debtIntelligence";
import {
  activeDebtStrategyItems,
  buildAvalancheStrategy,
  buildCashFlowRelief30dStrategy,
  buildDebtStrategies,
  buildSnowballStrategy,
  buildUrgencyStrategy,
} from "./debtStrategy";

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

describe("DEBT-4B Debt Strategy Ranking Engine", () => {
  // -------------------------------------------------------------------------
  // 1. BASE FILTERING (Tests 1-5)
  // -------------------------------------------------------------------------
  describe("Base Filtering", () => {
    it("1. active debt is candidate", () => {
      const activeItem = mockIntelligenceItem({ debtId: "d1", status: "active", isArchived: false });
      const candidates = activeDebtStrategyItems([activeItem]);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].debtId).toBe("d1");
    });

    it("2. paid_off excluded", () => {
      const paidOffItem = mockIntelligenceItem({ debtId: "d1", status: "paid_off", isArchived: false });
      const candidates = activeDebtStrategyItems([paidOffItem]);

      expect(candidates).toHaveLength(0);
    });

    it("3. refinanced excluded", () => {
      const refinancedItem = mockIntelligenceItem({ debtId: "d1", status: "refinanced", isArchived: false });
      const candidates = activeDebtStrategyItems([refinancedItem]);

      expect(candidates).toHaveLength(0);
    });

    it("4. archived excluded", () => {
      const archivedItem = mockIntelligenceItem({ debtId: "d1", status: "active", isArchived: true });
      const candidates = activeDebtStrategyItems([archivedItem]);

      expect(candidates).toHaveLength(0);
    });

    it("5. input is not mutated", () => {
      const items = [
        mockIntelligenceItem({ debtId: "d1", status: "active" }),
        mockIntelligenceItem({ debtId: "d2", status: "paid_off" }),
      ];
      const copyBefore = JSON.parse(JSON.stringify(items));

      activeDebtStrategyItems(items);

      expect(items).toEqual(copyBefore);
    });
  });

  // -------------------------------------------------------------------------
  // 2. SNOWBALL (Tests 6-15)
  // -------------------------------------------------------------------------
  describe("Snowball Strategy", () => {
    it("6. smaller currentPrincipal gets rank 1", () => {
      const d1 = mockIntelligenceItem({ debtId: "d1", currentPrincipal: 5000 });
      const d2 = mockIntelligenceItem({ debtId: "d2", currentPrincipal: 10000 });

      const res = buildSnowballStrategy([d1, d2]);
      const pen = res.byCurrency["PEN"];

      expect(pen[0].debtId).toBe("d1");
      expect(pen[0].rankWithinCurrency).toBe(1);
      expect(pen[1].debtId).toBe("d2");
      expect(pen[1].rankWithinCurrency).toBe(2);
    });

    it("7. ascending order with 3 debts", () => {
      const d1 = mockIntelligenceItem({ debtId: "d1", currentPrincipal: 15000 });
      const d2 = mockIntelligenceItem({ debtId: "d2", currentPrincipal: 2000 });
      const d3 = mockIntelligenceItem({ debtId: "d3", currentPrincipal: 8000 });

      const res = buildSnowballStrategy([d1, d2, d3]);
      const pen = res.byCurrency["PEN"];

      expect(pen.map((c) => c.debtId)).toEqual(["d2", "d3", "d1"]);
    });

    it("8. currentPrincipal is the metric used", () => {
      const d1 = mockIntelligenceItem({ debtId: "d1", currentPrincipal: 1000 });
      const res = buildSnowballStrategy([d1]);

      expect(res.byCurrency["PEN"][0].currentPrincipal).toBe(1000);
    });

    it("9. originalPrincipal does not affect ranking", () => {
      const d1 = mockIntelligenceItem({ debtId: "d1", currentPrincipal: 5000, originalPrincipal: 50000 });
      const d2 = mockIntelligenceItem({ debtId: "d2", currentPrincipal: 8000, originalPrincipal: 8000 });

      const res = buildSnowballStrategy([d1, d2]);
      expect(res.byCurrency["PEN"][0].debtId).toBe("d1");
    });

    it("10. rate does not affect ranking", () => {
      const d1 = mockIntelligenceItem({ debtId: "d1", currentPrincipal: 3000, ratePercent: 50 });
      const d2 = mockIntelligenceItem({ debtId: "d2", currentPrincipal: 9000, ratePercent: 5 });

      const res = buildSnowballStrategy([d1, d2]);
      expect(res.byCurrency["PEN"][0].debtId).toBe("d1");
    });

    it("11. PEN and USD generate separate groups", () => {
      const dPEN = mockIntelligenceItem({ debtId: "d-pen", currencyCode: "PEN", currentPrincipal: 5000 });
      const dUSD = mockIntelligenceItem({ debtId: "d-usd", currencyCode: "USD", currentPrincipal: 1000 });

      const res = buildSnowballStrategy([dPEN, dUSD]);
      expect(Object.keys(res.byCurrency)).toEqual(["PEN", "USD"]);
      expect(res.byCurrency["PEN"][0].debtId).toBe("d-pen");
      expect(res.byCurrency["USD"][0].debtId).toBe("d-usd");
    });

    it("12. no global snowball rank exists", () => {
      const dPEN = mockIntelligenceItem({ debtId: "d-pen", currencyCode: "PEN" });
      const res = buildSnowballStrategy([dPEN]);

      expect((res as any).globalRank).toBeUndefined();
    });

    it("13. tie-break uses debtName", () => {
      const d1 = mockIntelligenceItem({ debtId: "d1", debtName: "Zapa", currentPrincipal: 5000 });
      const d2 = mockIntelligenceItem({ debtId: "d2", debtName: "Alfa", currentPrincipal: 5000 });

      const res = buildSnowballStrategy([d1, d2]);
      expect(res.byCurrency["PEN"][0].debtId).toBe("d2"); // Alfa first
    });

    it("14. tie-break name uses debtId", () => {
      const d1 = mockIntelligenceItem({ debtId: "d-z", debtName: "Misma", currentPrincipal: 5000 });
      const d2 = mockIntelligenceItem({ debtId: "d-a", debtName: "Misma", currentPrincipal: 5000 });

      const res = buildSnowballStrategy([d1, d2]);
      expect(res.byCurrency["PEN"][0].debtId).toBe("d-a");
    });

    it("15. result is independent of input order", () => {
      const d1 = mockIntelligenceItem({ debtId: "d1", currentPrincipal: 1000 });
      const d2 = mockIntelligenceItem({ debtId: "d2", currentPrincipal: 5000 });

      const res1 = buildSnowballStrategy([d1, d2]);
      const res2 = buildSnowballStrategy([d2, d1]);

      expect(res1).toEqual(res2);
    });
  });

  // -------------------------------------------------------------------------
  // 3. AVALANCHE (Tests 16-29)
  // -------------------------------------------------------------------------
  describe("Avalanche Strategy", () => {
    it("16. higher TCEA wins within TCEA cohort", () => {
      const d1 = mockIntelligenceItem({ debtId: "d1", rateBasis: "tcea", ratePercent: 15.0 });
      const d2 = mockIntelligenceItem({ debtId: "d2", rateBasis: "tcea", ratePercent: 25.0 });

      const res = buildAvalancheStrategy([d1, d2]);
      const tcea = res.byCurrency["PEN"].tceaCandidates;

      expect(tcea[0].debtId).toBe("d2");
      expect(tcea[0].rankWithinBasis).toBe(1);
    });

    it("17. TCEA cohort ordered DESC", () => {
      const d1 = mockIntelligenceItem({ debtId: "d1", rateBasis: "tcea", ratePercent: 10.0 });
      const d2 = mockIntelligenceItem({ debtId: "d2", rateBasis: "tcea", ratePercent: 30.0 });
      const d3 = mockIntelligenceItem({ debtId: "d3", rateBasis: "tcea", ratePercent: 20.0 });

      const res = buildAvalancheStrategy([d1, d2, d3]);
      const tcea = res.byCurrency["PEN"].tceaCandidates;

      expect(tcea.map((c) => c.debtId)).toEqual(["d2", "d3", "d1"]);
    });

    it("18. higher TEA wins within TEA cohort", () => {
      const d1 = mockIntelligenceItem({ debtId: "d1", rateBasis: "tea", ratePercent: 12.0 });
      const d2 = mockIntelligenceItem({ debtId: "d2", rateBasis: "tea", ratePercent: 18.0 });

      const res = buildAvalancheStrategy([d1, d2]);
      const tea = res.byCurrency["PEN"].teaCandidates;

      expect(tea[0].debtId).toBe("d2");
      expect(tea[0].rankWithinBasis).toBe(1);
    });

    it("19. TEA cohort ordered DESC", () => {
      const d1 = mockIntelligenceItem({ debtId: "d1", rateBasis: "tea", ratePercent: 8.0 });
      const d2 = mockIntelligenceItem({ debtId: "d2", rateBasis: "tea", ratePercent: 24.0 });
      const d3 = mockIntelligenceItem({ debtId: "d3", rateBasis: "tea", ratePercent: 16.0 });

      const res = buildAvalancheStrategy([d1, d2, d3]);
      const tea = res.byCurrency["PEN"].teaCandidates;

      expect(tea.map((c) => c.debtId)).toEqual(["d2", "d3", "d1"]);
    });

    it("20. debt with unknown rate stays unranked", () => {
      const dUnknown = mockIntelligenceItem({ debtId: "d-unk", rateBasis: "unknown", ratePercent: null });

      const res = buildAvalancheStrategy([dUnknown]);
      const pen = res.byCurrency["PEN"];

      expect(pen.unknownRateDebtIds).toEqual(["d-unk"]);
      expect(pen.tceaCandidates).toHaveLength(0);
      expect(pen.teaCandidates).toHaveLength(0);
    });

    it("21. null rate does not become 0", () => {
      const dUnknown = mockIntelligenceItem({ debtId: "d-unk", rateBasis: "unknown", ratePercent: null });
      const res = buildAvalancheStrategy([dUnknown]);

      expect(res.byCurrency["PEN"].tceaCandidates).toHaveLength(0);
      expect(res.byCurrency["PEN"].teaCandidates).toHaveLength(0);
    });

    it("22. TCEA and TEA stay in separate cohorts", () => {
      const dTcea = mockIntelligenceItem({ debtId: "d-tcea", rateBasis: "tcea", ratePercent: 20.0 });
      const dTea = mockIntelligenceItem({ debtId: "d-tea", rateBasis: "tea", ratePercent: 30.0 });

      const res = buildAvalancheStrategy([dTcea, dTea]);
      const pen = res.byCurrency["PEN"];

      expect(pen.tceaCandidates).toHaveLength(1);
      expect(pen.teaCandidates).toHaveLength(1);
    });

    it("23. no rankAcrossAllRates exists", () => {
      const dTcea = mockIntelligenceItem({ debtId: "d-tcea", rateBasis: "tcea", ratePercent: 20.0 });
      const res = buildAvalancheStrategy([dTcea]);

      expect((res.byCurrency["PEN"] as any).rankAcrossAllRates).toBeUndefined();
    });

    it("24. all TCEA => comparisonMode = tcea_full", () => {
      const d1 = mockIntelligenceItem({ debtId: "d1", rateBasis: "tcea", ratePercent: 20.0 });
      const d2 = mockIntelligenceItem({ debtId: "d2", rateBasis: "tcea", ratePercent: 15.0 });

      const res = buildAvalancheStrategy([d1, d2]);
      expect(res.byCurrency["PEN"].comparisonMode).toBe("tcea_full");
    });

    it("25. all TEA without TCEA => comparisonMode = tea_full", () => {
      const d1 = mockIntelligenceItem({ debtId: "d1", rateBasis: "tea", ratePercent: 18.0 });
      const d2 = mockIntelligenceItem({ debtId: "d2", rateBasis: "tea", ratePercent: 12.0 });

      const res = buildAvalancheStrategy([d1, d2]);
      expect(res.byCurrency["PEN"].comparisonMode).toBe("tea_full");
    });

    it("26. mixture TCEA and TEA => comparisonMode = partial", () => {
      const dTcea = mockIntelligenceItem({ debtId: "d-tcea", rateBasis: "tcea", ratePercent: 20.0 });
      const dTea = mockIntelligenceItem({ debtId: "d-tea", rateBasis: "tea", ratePercent: 15.0 });

      const res = buildAvalancheStrategy([dTcea, dTea]);
      expect(res.byCurrency["PEN"].comparisonMode).toBe("partial");
    });

    it("27. known rate + unknown rate => comparisonMode = partial", () => {
      const dTcea = mockIntelligenceItem({ debtId: "d-tcea", rateBasis: "tcea", ratePercent: 20.0 });
      const dUnk = mockIntelligenceItem({ debtId: "d-unk", rateBasis: "unknown", ratePercent: null });

      const res = buildAvalancheStrategy([dTcea, dUnk]);
      expect(res.byCurrency["PEN"].comparisonMode).toBe("partial");
    });

    it("28. all unknown => comparisonMode = unavailable", () => {
      const dUnk = mockIntelligenceItem({ debtId: "d-unk", rateBasis: "unknown", ratePercent: null });

      const res = buildAvalancheStrategy([dUnk]);
      expect(res.byCurrency["PEN"].comparisonMode).toBe("unavailable");
    });

    it("29. PEN and USD avalanche strategies are separated", () => {
      const dPEN = mockIntelligenceItem({ debtId: "d-pen", currencyCode: "PEN", rateBasis: "tcea", ratePercent: 20 });
      const dUSD = mockIntelligenceItem({ debtId: "d-usd", currencyCode: "USD", rateBasis: "tcea", ratePercent: 15 });

      const res = buildAvalancheStrategy([dPEN, dUSD]);
      expect(Object.keys(res.byCurrency)).toEqual(["PEN", "USD"]);
    });
  });

  // -------------------------------------------------------------------------
  // 4. URGENCY (Tests 30-38)
  // -------------------------------------------------------------------------
  describe("Urgency Strategy", () => {
    it("30. overdue due date wins over future due date", () => {
      const dFuture = mockIntelligenceItem({ debtId: "d-fut", nextInstallmentDueDate: "2026-09-01", nextInstallmentDueStatus: "upcoming" });
      const dOverdue = mockIntelligenceItem({ debtId: "d-over", nextInstallmentDueDate: "2026-07-15", nextInstallmentDueStatus: "overdue" });

      const res = buildUrgencyStrategy([dFuture, dOverdue]);
      expect(res.rankedCandidates[0].debtId).toBe("d-over");
      expect(res.rankedCandidates[0].urgencyRank).toBe(1);
    });

    it("31. older overdue wins over recent overdue", () => {
      const dOverRecent = mockIntelligenceItem({ debtId: "d-recent", nextInstallmentDueDate: "2026-08-10" });
      const dOverOld = mockIntelligenceItem({ debtId: "d-old", nextInstallmentDueDate: "2026-07-01" });

      const res = buildUrgencyStrategy([dOverRecent, dOverOld]);
      expect(res.rankedCandidates[0].debtId).toBe("d-old");
    });

    it("32. today wins over tomorrow", () => {
      const dToday = mockIntelligenceItem({ debtId: "d-today", nextInstallmentDueDate: "2026-08-21" });
      const dTomorrow = mockIntelligenceItem({ debtId: "d-tomorrow", nextInstallmentDueDate: "2026-08-22" });

      const res = buildUrgencyStrategy([dTomorrow, dToday]);
      expect(res.rankedCandidates[0].debtId).toBe("d-today");
    });

    it("33. upcoming due date wins over distant future due date", () => {
      const dDistant = mockIntelligenceItem({ debtId: "d-dist", nextInstallmentDueDate: "2027-01-01" });
      const dUpcoming = mockIntelligenceItem({ debtId: "d-up", nextInstallmentDueDate: "2026-08-25" });

      const res = buildUrgencyStrategy([dDistant, dUpcoming]);
      expect(res.rankedCandidates[0].debtId).toBe("d-up");
    });

    it("34. ranking can mix PEN and USD debts (cross-currency date ranking)", () => {
      const dPEN = mockIntelligenceItem({ debtId: "d-pen", currencyCode: "PEN", nextInstallmentDueDate: "2026-09-01" });
      const dUSD = mockIntelligenceItem({ debtId: "d-usd", currencyCode: "USD", nextInstallmentDueDate: "2026-08-15" });

      const res = buildUrgencyStrategy([dPEN, dUSD]);
      expect(res.rankedCandidates[0].debtId).toBe("d-usd");
      expect(res.rankedCandidates[1].debtId).toBe("d-pen");
    });

    it("35. does not use currentPrincipal to order", () => {
      const dLarge = mockIntelligenceItem({ debtId: "d-large", currentPrincipal: 50000, nextInstallmentDueDate: "2026-08-01" });
      const dSmall = mockIntelligenceItem({ debtId: "d-small", currentPrincipal: 100, nextInstallmentDueDate: "2026-09-01" });

      const res = buildUrgencyStrategy([dSmall, dLarge]);
      expect(res.rankedCandidates[0].debtId).toBe("d-large");
    });

    it("36. debt without next installment stays unranked", () => {
      const dNoNext = mockIntelligenceItem({ debtId: "d-no", nextInstallmentId: null, nextInstallmentDueDate: null });

      const res = buildUrgencyStrategy([dNoNext]);
      expect(res.rankedCandidates).toHaveLength(0);
      expect(res.unrankedDebtIds).toEqual(["d-no"]);
    });

    it("37. tie-break date uses debtName ASC, then debtId ASC", () => {
      const d1 = mockIntelligenceItem({ debtId: "d-z", debtName: "Zapa", nextInstallmentDueDate: "2026-08-25" });
      const d2 = mockIntelligenceItem({ debtId: "d-a", debtName: "Alfa", nextInstallmentDueDate: "2026-08-25" });

      const res = buildUrgencyStrategy([d1, d2]);
      expect(res.rankedCandidates[0].debtId).toBe("d-a");
    });

    it("38. result is independent of input order", () => {
      const d1 = mockIntelligenceItem({ debtId: "d1", nextInstallmentDueDate: "2026-08-10" });
      const d2 = mockIntelligenceItem({ debtId: "d2", nextInstallmentDueDate: "2026-08-20" });

      const res1 = buildUrgencyStrategy([d1, d2]);
      const res2 = buildUrgencyStrategy([d2, d1]);

      expect(res1).toEqual(res2);
    });
  });

  // -------------------------------------------------------------------------
  // 5. CASH FLOW RELIEF 30D (Tests 39-48)
  // -------------------------------------------------------------------------
  describe("Cash-Flow Relief 30d Strategy", () => {
    it("39. higher next30KnownAmount wins within currency", () => {
      const d1 = mockIntelligenceItem({ debtId: "d1", next30KnownAmount: 500 });
      const d2 = mockIntelligenceItem({ debtId: "d2", next30KnownAmount: 1200 });

      const res = buildCashFlowRelief30dStrategy([d1, d2]);
      const pen = res.byCurrency["PEN"].rankedCandidates;

      expect(pen[0].debtId).toBe("d2");
      expect(pen[0].rankWithinCurrency).toBe(1);
    });

    it("40. ordered DESC with three debts", () => {
      const d1 = mockIntelligenceItem({ debtId: "d1", next30KnownAmount: 300 });
      const d2 = mockIntelligenceItem({ debtId: "d2", next30KnownAmount: 1500 });
      const d3 = mockIntelligenceItem({ debtId: "d3", next30KnownAmount: 800 });

      const res = buildCashFlowRelief30dStrategy([d1, d2, d3]);
      const pen = res.byCurrency["PEN"].rankedCandidates;

      expect(pen.map((c) => c.debtId)).toEqual(["d2", "d3", "d1"]);
    });

    it("41. unknownNext30 > 0 => unranked with reason unknown_next30_amounts", () => {
      const dUnk = mockIntelligenceItem({
        debtId: "d-unk",
        next30KnownAmount: 500,
        next30UnknownAmountCount: 1,
      });

      const res = buildCashFlowRelief30dStrategy([dUnk]);
      const pen = res.byCurrency["PEN"];

      expect(pen.rankedCandidates).toHaveLength(0);
      expect(pen.unrankedItems).toHaveLength(1);
      expect(pen.unrankedItems[0].unrankedReason).toBe("unknown_next30_amounts");
    });

    it("42. unknown is not treated as zero", () => {
      const dUnk = mockIntelligenceItem({ debtId: "d-unk", next30KnownAmount: 0, next30UnknownAmountCount: 1 });
      const res = buildCashFlowRelief30dStrategy([dUnk]);

      expect(res.byCurrency["PEN"].rankedCandidates).toHaveLength(0);
    });

    it("43. missing schedule => unranked with reason missing_current_schedule", () => {
      const dNoSched = mockIntelligenceItem({
        debtId: "d-nosched",
        readiness: { ...mockIntelligenceItem().readiness, hasCurrentSchedule: false },
      });

      const res = buildCashFlowRelief30dStrategy([dNoSched]);
      const pen = res.byCurrency["PEN"];

      expect(pen.rankedCandidates).toHaveLength(0);
      expect(pen.unrankedItems[0].unrankedReason).toBe("missing_current_schedule");
    });

    it("44. schedule valid + 0 obligation => rankable as 0", () => {
      const dZero = mockIntelligenceItem({
        debtId: "d-zero",
        next30KnownAmount: 0,
        next30UnknownAmountCount: 0,
        readiness: { ...mockIntelligenceItem().readiness, hasCurrentSchedule: true },
      });

      const res = buildCashFlowRelief30dStrategy([dZero]);
      const pen = res.byCurrency["PEN"].rankedCandidates;

      expect(pen).toHaveLength(1);
      expect(pen[0].relief30dKnownAmount).toBe(0);
    });

    it("45. PEN and USD cash-flow relief strategies are separated", () => {
      const dPEN = mockIntelligenceItem({ debtId: "d-pen", currencyCode: "PEN", next30KnownAmount: 500 });
      const dUSD = mockIntelligenceItem({ debtId: "d-usd", currencyCode: "USD", next30KnownAmount: 200 });

      const res = buildCashFlowRelief30dStrategy([dPEN, dUSD]);
      expect(Object.keys(res.byCurrency)).toEqual(["PEN", "USD"]);
    });

    it("46. no cross-currency cash-flow rank exists", () => {
      const dPEN = mockIntelligenceItem({ debtId: "d-pen", currencyCode: "PEN" });
      const res = buildCashFlowRelief30dStrategy([dPEN]);

      expect((res as any).globalRank).toBeUndefined();
    });

    it("47. tie-break uses debtName ASC, then debtId ASC", () => {
      const d1 = mockIntelligenceItem({ debtId: "d-z", debtName: "Zapa", next30KnownAmount: 500 });
      const d2 = mockIntelligenceItem({ debtId: "d-a", debtName: "Alfa", next30KnownAmount: 500 });

      const res = buildCashFlowRelief30dStrategy([d1, d2]);
      expect(res.byCurrency["PEN"].rankedCandidates[0].debtId).toBe("d-a");
    });

    it("48. Debt A (principal 100,000, next30Known 500) vs Debt B (principal 5,000, next30Known 1,000): Cash-flow relief prioritizes Debt B", () => {
      const dA = mockIntelligenceItem({ debtId: "d-a", currentPrincipal: 100000, next30KnownAmount: 500 });
      const dB = mockIntelligenceItem({ debtId: "d-b", currentPrincipal: 5000, next30KnownAmount: 1000 });

      const res = buildCashFlowRelief30dStrategy([dA, dB]);
      const pen = res.byCurrency["PEN"].rankedCandidates;

      expect(pen[0].debtId).toBe("d-b"); // Debt B wins because next30KnownAmount is higher
      expect(pen[1].debtId).toBe("d-a");
    });
  });

  // -------------------------------------------------------------------------
  // 6. CONSOLIDATED BUILDER (Integration Test)
  // -------------------------------------------------------------------------
  describe("Consolidated Strategies Builder", () => {
    it("buildDebtStrategies returns all 4 strategies correctly", () => {
      const d1 = mockIntelligenceItem();
      const strats = buildDebtStrategies([d1]);

      expect(strats.snowball).toBeDefined();
      expect(strats.avalanche).toBeDefined();
      expect(strats.urgency).toBeDefined();
      expect(strats.cashFlowRelief30d).toBeDefined();
    });
  });
});
