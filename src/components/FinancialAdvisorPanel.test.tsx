// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FinancialAdvisorPanel } from "./FinancialAdvisorPanel.js";
import { buildFinancialAdvisorResult, type FinancialAdvisorSnapshot } from "../utils/financialAdvisor.js";
import { buildDebtStrategies } from "../utils/debtStrategy.js";
import { buildObligationProjection } from "../utils/obligationProjection.js";

function result() {
  const snapshot: FinancialAdvisorSnapshot = {
    todayKey: "2026-09-01",
    initialBalance: 0,
    financialAccounts: [],
    movements: [],
    debts: [],
    debtEvents: [],
    debtPlanningItems: [],
    debtIntelligenceItems: [],
    debtStrategies: buildDebtStrategies([]),
    obligationProjection: buildObligationProjection({ recurringPayments: [], debts: [], debtPlanningItems: [], todayKey: "2026-09-01", horizonMonthCount: 4 }),
    creditCardProfiles: [],
    creditCardEntries: [],
    creditCardStatements: [],
  };
  return buildFinancialAdvisorResult(snapshot);
}

describe("FinancialAdvisorPanel", () => {
  it("renders the read-only advisor sections and handles a local question", () => {
    render(<FinancialAdvisorPanel result={result()} onNavigate={vi.fn()} />);

    expect(screen.getByText("TU ASESOR FINANCIERO")).toBeTruthy();
    expect(screen.getByText("TU PRIORIDAD DE HOY")).toBeTruthy();
    expect(screen.getByText("DINERO QUE DEBES TENER LISTO")).toBeTruthy();
    expect(screen.getByText("¿QUÉ DEUDA CONVIENE ATACAR?")).toBeTruthy();
    expect(screen.getByTestId("advisor-extra-cash")).toBeTruthy();
    expect(screen.getByText("ANÁLISIS COMPLETO")).toBeTruthy();

    fireEvent.change(screen.getByTestId("advisor-question-input"), { target: { value: "¿Qué cambió desde la semana pasada?" } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar" }));
    expect(screen.getByText("Esta versión todavía no guarda snapshots del asesor para comparar semanas con precisión.")).toBeTruthy();
  });
});
