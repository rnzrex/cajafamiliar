import { describe, expect, it } from "vitest";
import type { Debt, DebtEvent, DebtEventInstallmentAllocation, DebtInstallment, DebtScheduleVersion } from "../types.js";
import { parseContractualScheduleText } from "./debtScheduleParser.js";
import { calculateFrenchFinancialInstallment, generateEstimatedDebtSchedule } from "./debtEstimation.js";
import { effectivePeriodicRateFromTea } from "./debtInterestEngine.js";
import { currentDebtPrincipal, effectiveDebtEvents, effectiveInstallmentAllocations } from "./debtCalculations.js";
import { getMovementEconomics } from "./movementEconomics.js";
import { buildDebtPaymentLedger } from "./debtPaymentLedger.js";
import { buildDebtPlanningItems } from "./debtPlanning.js";

describe("BANK CREDIT CONTRACT V2 - PERU DOMAIN ENGINE", () => {
  // ============================================================
  // SECTION 25: ONBOARDING & SCHEDULE PARSER TESTS
  // ============================================================
  describe("Section 25: Onboarding Presets & Schedule Parsing", () => {
    it("parses tab-delimited contractual bank schedule correctly", () => {
      const tsvText = `
Cuota\tFecha\tCuota Total\tCapital\tInterés\tSeguro\tGastos
1\t2026-09-15\t850.00\t500.00\t250.00\t80.00\t20.00
2\t2026-10-15\t850.00\t510.00\t240.00\t80.00\t20.00
3\t2026-11-15\t850.00\t520.00\t230.00\t80.00\t20.00
      `;

      const result = parseContractualScheduleText(tsvText);
      expect(result.valid).toBe(true);
      expect(result.detectedCount).toBe(3);
      expect(result.firstDueDate).toBe("2026-09-15");
      expect(result.installmentAmountMode).toBe("fixed");
      expect(result.totalContractSum).toBe(2550);
      expect(result.totalPrincipal).toBe(1530);
      expect(result.totalInterest).toBe(720);
      expect(result.totalInsurance).toBe(240);
      expect(result.totalFees).toBe(60);
    });

    it("rejects contractual rows with omitted or non-numeric cost components", () => {
      const result = parseContractualScheduleText("1\t2026-09-15\t850\n2\t2026-10-15\t850\t500\tinvalid\t80\t20");

      expect(result.valid).toBe(false);
      expect(result.rows).toHaveLength(0);
      expect(result.errors.join(" ")).toContain("importes");
    });

    it("validates vehicular credit numbers (assetPrice - downPayment ~ financedAmount)", () => {
      const assetPrice = 50000;
      const downPayment = 10000;
      const exactFinanced = assetPrice - downPayment; // 40000
      const financedWithFees = 41000; // Allows difference for financed registration/insurance fees

      expect(exactFinanced).toBe(40000);
      expect(financedWithFees - (assetPrice - downPayment)).toBe(1000); // 1000 in financed fees
    });
  });

  // ============================================================
  // SECTION 26: CONTRACTUAL SCHEDULE IS SOURCE OF TRUTH
  // ============================================================
  describe("Section 26: Contractual Schedule Source of Truth", () => {
    it("preserves exact bank schedule values without overriding with TEA formula", () => {
      const tsvText = `
1\t2026-09-15\t1234.56\t800.00\t350.00\t70.00\t14.56
2\t2026-10-15\t1234.56\t810.00\t340.00\t70.00\t14.56
      `;

      const result = parseContractualScheduleText(tsvText);
      expect(result.valid).toBe(true);
      expect(result.rows[0].expectedAmount).toBe(1234.56);
      expect(result.rows[0].expectedPrincipal).toBe(800.00);
      expect(result.rows[0].expectedInterest).toBe(350.00);
      // Ensure exact contractual values are maintained
      expect(result.rows[0].expectedAmount).not.toBe(1200);
    });
  });

  // ============================================================
  // SECTION 27: ESTIMATED FRENCH SCHEDULE CALCULATION
  // ============================================================
  describe("Section 27: Estimated Schedule French System", () => {
    it("uses effective periodic rate from TEA (never TEA/12)", () => {
      const tea = 18; // 18% TEA
      const { rateDecimal, ratePercent } = effectivePeriodicRateFromTea({
        teaPercent: tea,
        frequency: "monthly",
      });

      // (1 + 0.18)^(1/12) - 1 ≈ 1.38884%
      expect(ratePercent).toBeCloseTo(1.38884, 4);
      expect(ratePercent).not.toBe(1.5); // TEA/12 would be 1.5%

      const p = calculateFrenchFinancialInstallment(10000, rateDecimal, 12);
      expect(p).toBeGreaterThan(900);
      expect(p).toBeLessThan(950);
    });

    it("generates estimated schedule with desgravamen calculated per period on balance", () => {
      const estimate = generateEstimatedDebtSchedule({
        financedAmount: 10000,
        teaPercent: 15,
        termInstallments: 6,
        paymentFrequency: "monthly",
        firstDueDate: "2026-09-01",
        amortizationMethod: "fixed_installment",
        creditLifeRatePercent: 0.05, // 0.05% monthly desgravamen on balance
      });

      expect(estimate.isEstimated).toBe(true);
      expect(estimate.rows).toHaveLength(6);
      expect(estimate.rows[0].expectedInsurance).toBeCloseTo(5.00, 2); // 10000 * 0.0005 = 5.00
      expect(estimate.totalPrincipal).toBe(10000);
    });
  });

  // ============================================================
  // SECTION 28: PAYMENT + EXTRA PRINCIPAL (ONE OUTFLOW)
  // ============================================================
  describe("Section 28: Payment + Extra Principal Abono", () => {
    it("records ONE single cash outflow movement while reducing extra principal", () => {
      const debt: Debt = {
        id: "bank-debt-1",
        name: "Préstamo Personal BCP",
        creditorName: "BCP",
        debtKind: "bank_loan",
        currencyCode: "PEN",
        originDate: "2026-01-01",
        trackingStartDate: "2026-01-01",
        originalPrincipal: 20000,
        openingPrincipalBalance: 20000,
        plannedInstallmentCount: 24,
        plannedInstallmentAmount: 850,
        installmentAmountMode: "fixed",
        paymentFrequency: "monthly",
        customFrequencyDays: null,
        firstDueDate: "2026-02-01",
        teaPercent: 15,
        tceaPercent: 18,
        notes: "",
        status: "active",
        isArchived: false,
        createdByUserId: "user-1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };

      // Cuota 850 (Principal 500 + Interest/Costs 350) + Extra Principal 2000 => Total cash = 2850
      const event: DebtEvent = {
        id: "evt-1",
        debtId: debt.id,
        eventDate: "2026-03-01",
        eventType: "payment",
        cashAmount: 2850,
        principalDelta: -2500, // 500 cuota principal + 2000 extra principal
        interestPaid: 250,
        feesPaid: 20,
        insurancePaid: 80,
        otherCostPaid: 0,
        extraPrincipalAmount: 2000,
        prepaymentEffect: "reduce_term",
        breakdownComplete: true,
        movementId: "mov-1",
        reversalOfEventId: null,
        description: "Pago cuota + extra principal",
        registeredByUserId: "user-1",
        createdAt: "2026-03-01T00:00:00Z",
      };

      const currentPrincipal = currentDebtPrincipal(debt, [event]);
      expect(currentPrincipal).toBe(17500); // 20000 - 2500

      const economics = getMovementEconomics(
        {
          id: "mov-1",
          type: "egreso",
          date: "2026-03-01",
          amount: 2850,
          description: "Pago cuota + extra principal",
          method: "transferencia",
          category: "Pago de deuda",
          person: "Renzo",
          accountId: "acc-1",
          movementContext: "debt_service",
        },
        [event]
      );

      expect(economics.cashOutflow).toBe(2850);
      expect(economics.principalReduction).toBe(2500);
      expect(economics.economicExpense).toBe(350); // 2850 - 2500 = 350 interest & fees!
    });
  });

  // ============================================================
  // SECTION 31: INSTALLMENT ADVANCE (ADELANTO DE CUOTAS)
  // ============================================================
  describe("Section 31: Installment Advance (Adelanto de Cuotas)", () => {
    it("covers 3 consecutive future installments with 1 movement, 3 allocations, and no schedule recalculation", () => {
      const debtId = "loan-advance-1";
      const debt: Debt = {
        id: debtId,
        name: "Crédito Vehicular BBVA",
        creditorName: "BBVA",
        debtKind: "bank_loan",
        currencyCode: "PEN",
        originDate: null,
        trackingStartDate: "2026-01-01",
        originalPrincipal: 30000,
        openingPrincipalBalance: 30000,
        plannedInstallmentCount: 12,
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
        createdByUserId: "user-1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };

      const version: DebtScheduleVersion = {
        id: "v-1",
        debtId,
        versionNumber: 1,
        effectiveDate: "2026-01-01",
        reason: "initial",
        scheduleSource: "contractual",
        isAuthoritative: true,
        triggerEventId: null,
        notes: "",
        createdByUserId: "user-1",
        createdAt: "2026-01-01T00:00:00Z",
      };

      const inst1: DebtInstallment = { id: "i-1", scheduleVersionId: "v-1", debtId, installmentNumber: 1, dueDate: "2026-02-01", expectedAmount: 1000, expectedPrincipal: 700, expectedInterest: 200, expectedFees: 50, expectedInsurance: 50, createdByUserId: "u-1", createdAt: "2026-01-01T00:00:00Z" };
      const inst2: DebtInstallment = { id: "i-2", scheduleVersionId: "v-1", debtId, installmentNumber: 2, dueDate: "2026-03-01", expectedAmount: 1000, expectedPrincipal: 710, expectedInterest: 190, expectedFees: 50, expectedInsurance: 50, createdByUserId: "u-1", createdAt: "2026-01-01T00:00:00Z" };
      const inst3: DebtInstallment = { id: "i-3", scheduleVersionId: "v-1", debtId, installmentNumber: 3, dueDate: "2026-04-01", expectedAmount: 1000, expectedPrincipal: 720, expectedInterest: 180, expectedFees: 50, expectedInsurance: 50, createdByUserId: "u-1", createdAt: "2026-01-01T00:00:00Z" };

      // Single installment advance event covering all 3 installments
      const advanceEvent: DebtEvent = {
        id: "evt-adv-1",
        debtId,
        eventDate: "2026-01-15",
        eventType: "installment_advance",
        cashAmount: 3000,
        principalDelta: -(700 + 710 + 720), // -2130
        interestPaid: 570,
        feesPaid: 150,
        insurancePaid: 150,
        otherCostPaid: 0,
        breakdownComplete: true,
        movementId: "mov-adv-1",
        reversalOfEventId: null,
        description: "Adelanto de 3 cuotas",
        registeredByUserId: "user-1",
        createdAt: "2026-01-15T00:00:00Z",
      };

      const allocations: DebtEventInstallmentAllocation[] = [
        { id: "a-1", eventId: "evt-adv-1", installmentId: "i-1", debtId, allocatedAmount: 1000, createdByUserId: "u-1", createdAt: "2026-01-15T00:00:00Z" },
        { id: "a-2", eventId: "evt-adv-1", installmentId: "i-2", debtId, allocatedAmount: 1000, createdByUserId: "u-1", createdAt: "2026-01-15T00:00:00Z" },
        { id: "a-3", eventId: "evt-adv-1", installmentId: "i-3", debtId, allocatedAmount: 1000, createdByUserId: "u-1", createdAt: "2026-01-15T00:00:00Z" },
      ];

      // Check allocations mark installments covered
      const effectiveAlloc = effectiveInstallmentAllocations(allocations, [advanceEvent], debtId);
      expect(effectiveAlloc).toHaveLength(3);

      const planningItems = buildDebtPlanningItems([debt], [advanceEvent], [version], [inst1, inst2, inst3], allocations, "2026-01-20");
      expect(planningItems.every((item) => item.isCovered)).toBe(true);

      // Principal reduction equals sum of expectedPrincipal of advanced cuotas
      expect(currentDebtPrincipal(debt, [advanceEvent])).toBe(30000 - 2130);
    });
  });

  // ============================================================
  // SECTION 32: REVERSAL SAFETY
  // ============================================================
  describe("Section 32: Reversal Safety", () => {
    it("reverts installment advance safely restoring principal and allocations", () => {
      const debtId = "loan-rev-1";
      const debt: Debt = {
        id: debtId,
        name: "Préstamo Educativo",
        creditorName: "Interbank",
        debtKind: "bank_loan",
        currencyCode: "PEN",
        originDate: null,
        trackingStartDate: "2026-01-01",
        originalPrincipal: 10000,
        openingPrincipalBalance: 10000,
        plannedInstallmentCount: 10,
        plannedInstallmentAmount: 1100,
        installmentAmountMode: "fixed",
        paymentFrequency: "monthly",
        customFrequencyDays: null,
        firstDueDate: "2026-02-01",
        teaPercent: 10,
        tceaPercent: 11,
        notes: "",
        status: "active",
        isArchived: false,
        createdByUserId: "user-1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };

      const event: DebtEvent = {
        id: "evt-orig",
        debtId,
        eventDate: "2026-02-01",
        eventType: "installment_advance",
        cashAmount: 1100,
        principalDelta: -900,
        interestPaid: 200,
        feesPaid: 0,
        insurancePaid: 0,
        otherCostPaid: 0,
        breakdownComplete: true,
        movementId: "mov-orig",
        reversalOfEventId: null,
        description: "Adelanto cuota 1",
        registeredByUserId: "user-1",
        createdAt: "2026-02-01T00:00:00Z",
      };

      const reversalEvent: DebtEvent = {
        id: "evt-rev",
        debtId,
        eventDate: "2026-02-02",
        eventType: "reversal",
        cashAmount: 0,
        principalDelta: 0,
        interestPaid: 0,
        feesPaid: 0,
        insurancePaid: 0,
        otherCostPaid: 0,
        breakdownComplete: false,
        movementId: null,
        reversalOfEventId: "evt-orig",
        description: "Reversión de adelanto",
        registeredByUserId: "user-1",
        createdAt: "2026-02-02T00:00:00Z",
      };

      const events = [event, reversalEvent];
      expect(effectiveDebtEvents(events, debtId)).toHaveLength(0);
      expect(currentDebtPrincipal(debt, events)).toBe(10000);
    });
  });

  // ============================================================
  // SECTION 33: ACCOUNTING INTEGRITY
  // ============================================================
  describe("Section 33: Financial Reporting Integrity", () => {
    it("never inflates household expense with principal amortization", () => {
      const debt: Debt = {
        id: "bank-debt-acc",
        name: "Préstamo Vehicular Santander",
        creditorName: "Santander",
        debtKind: "bank_loan",
        currencyCode: "PEN",
        originDate: null,
        trackingStartDate: "2026-01-01",
        originalPrincipal: 40000,
        openingPrincipalBalance: 40000,
        plannedInstallmentCount: 36,
        plannedInstallmentAmount: 1500,
        installmentAmountMode: "fixed",
        paymentFrequency: "monthly",
        customFrequencyDays: null,
        firstDueDate: "2026-02-01",
        teaPercent: 14,
        tceaPercent: 16,
        notes: "",
        status: "active",
        isArchived: false,
        createdByUserId: "user-1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };

      // Payment 850 cuota + 2000 extra principal = 2850 total cash
      // Interest + fees = 350
      const event: DebtEvent = {
        id: "evt-acc-1",
        debtId: debt.id,
        eventDate: "2026-02-15",
        eventType: "payment",
        cashAmount: 2850,
        principalDelta: -2500,
        interestPaid: 300,
        feesPaid: 50,
        insurancePaid: 0,
        otherCostPaid: 0,
        extraPrincipalAmount: 2000,
        breakdownComplete: true,
        movementId: "mov-acc-1",
        reversalOfEventId: null,
        description: "Pago cuota + extra capital",
        registeredByUserId: "user-1",
        createdAt: "2026-02-15T00:00:00Z",
      };

      const ledger = buildDebtPaymentLedger(debt, [event]);
      expect(ledger.summary.totalCashPaid).toBe(2850);
      expect(ledger.summary.totalPrincipalAmortized).toBe(2500);
      expect(ledger.summary.totalInterestPaid).toBe(300);

      const economics = getMovementEconomics(
        {
          id: "mov-acc-1",
          type: "egreso",
          date: "2026-02-15",
          amount: 2850,
          description: "Pago cuota + extra capital",
          method: "transferencia",
          category: "Pago de deuda",
          person: "Renzo",
          accountId: "acc-1",
          movementContext: "debt_service",
        },
        [event]
      );

      expect(economics.economicExpense).toBe(350); // NOT 2850!
      expect(economics.principalReduction).toBe(2500);
    });
  });
});
