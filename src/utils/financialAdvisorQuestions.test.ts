import { describe, expect, it } from "vitest";
import { answerFinancialAdvisorQuestion, parseFinancialAdvisorQuestion } from "./financialAdvisorQuestions.js";
import type { FinancialAdvisorResult } from "./financialAdvisor.js";

function emptyResult(): FinancialAdvisorResult {
  const emptyWindow = (key: "overdue" | "today" | "next_7_days" | "rest_of_week" | "next_30_days" | "next_90_days", label: string) => ({
    key,
    label,
    byCurrency: {},
    items: [],
  });
  return {
    todayKey: "2026-09-01",
    dataQuality: { status: "complete", missingDataCount: 0, messages: [], reasonCodes: [] },
    liquidityByCurrency: {},
    windows: {
      overdue: emptyWindow("overdue", "Vencidas / inmediatas"),
      today: emptyWindow("today", "Hoy"),
      next_7_days: emptyWindow("next_7_days", "Próximos 7 días"),
      rest_of_week: emptyWindow("rest_of_week", "Resto de esta semana"),
      next_30_days: emptyWindow("next_30_days", "Próximos 30 días"),
      next_90_days: emptyWindow("next_90_days", "Próximos 90 días"),
    },
    coverageByCurrency: {},
    reserveRequirementsByCurrency: {},
    recommendations: [],
    debtPriorities: [],
    debtComparisons: [],
    cardStatements: [],
    debtLoad: {
      activeDebtCount: 0,
      overdueObligationCount: 0,
      byCurrency: {},
      incomeRatioStatus: "not_calculated",
      incomeRatioMessage: "No calculamos un ratio deuda/ingreso porque Caja Familiar no tiene un ingreso mensual estable confirmado.",
    },
    extraCash: null,
    extraCashDebtItems: [],
  };
}

describe("Financial Advisor local question parser", () => {
  it("17. maps accented and unaccented weekly questions to one intent", () => {
    expect(parseFinancialAdvisorQuestion("qué tengo que pagar esta semana").intent).toBe("weekly_obligations");
    expect(parseFinancialAdvisorQuestion("que pago esta semana").intent).toBe("weekly_obligations");
  });

  it("18. parses extra cash amount and PEN currency", () => {
    const parsed = parseFinancialAdvisorQuestion("Tengo S/ 2000 extra, ¿qué hago?");
    expect(parsed.intent).toBe("extra_cash");
    expect(parsed.amount).toBe(2000);
    expect(parsed.currencyCode).toBe("PEN");
  });

  it("19. answers unsupported questions honestly with available suggestions", () => {
    const answer = answerFinancialAdvisorQuestion(parseFinancialAdvisorQuestion("¿Qué opinas del mercado?"), emptyResult());
    expect(answer.intent).toBe("unsupported");
    expect(answer.answer).toContain("no puedo responder");
    expect(answer.suggestions.length).toBeGreaterThan(0);
  });

  it("20. refuses to invent a historical comparison", () => {
    const answer = answerFinancialAdvisorQuestion(parseFinancialAdvisorQuestion("¿Qué cambió desde la semana pasada?"), emptyResult());
    expect(answer.intent).toBe("changes");
    expect(answer.answer).toBe("Esta versión todavía no guarda snapshots del asesor para comparar semanas con precisión.");
  });

  it("answers weekly intent only from the supplied advisor result", () => {
    const result = emptyResult();
    result.windows.rest_of_week.byCurrency.PEN = {
      currencyCode: "PEN",
      knownAmount: 200,
      estimatedAmount: 50,
      unknownAmountCount: 1,
      obligationCount: 3,
    };
    const answer = answerFinancialAdvisorQuestion(parseFinancialAdvisorQuestion("pagos esta semana"), result);
    expect(answer.answer).toContain("200.00");
    expect(answer.answer).toContain("monto(s) por confirmar");
  });
});
