// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
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
    expect(screen.getByText(/dinero nuevo que todavía no forma parte de tu liquidez registrada/i)).toBeTruthy();
    expect(screen.getByText("ANÁLISIS COMPLETO")).toBeTruthy();

    fireEvent.change(screen.getByTestId("advisor-question-input"), { target: { value: "¿Qué cambió desde la semana pasada?" } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar" }));
    expect(screen.getByText("Esta versión todavía no guarda snapshots del asesor para comparar semanas con precisión.")).toBeTruthy();
  });

  it("translates internal recommendation values into human copy", () => {
    const advisorResult = result();
    advisorResult.recommendations = [{
      id: "card-statement-fixture",
      priority: 1,
      priorityClass: "card_statement",
      type: "CARD_STATEMENT_DUE",
      title: "Reserva S/ 400.00 para Tarjeta Fixture",
      reason: "El estado de cuenta vence el 20 sep 2026.",
      currencyCode: "PEN",
      amount: 400,
      dueDate: "2026-09-20",
      debtId: null,
      cardId: "card-fixture",
      paymentId: null,
      confidence: "complete",
      evidence: [],
    }];

    render(<FinancialAdvisorPanel result={advisorResult} onNavigate={vi.fn()} />);

    expect(screen.getByText("Estado de cuenta próximo · Monto conocido")).toBeTruthy();
    expect(screen.queryByText(/CARD_STATEMENT_DUE|COMPLETE|PARTIAL/)).toBeNull();
  });

  it("renders the executive extra-cash result from the shared read-model", () => {
    const advisorResult = result();
    advisorResult.liquidityByCurrency.PEN = {
      currencyCode: "PEN",
      knownAmount: 2138.25,
      accountCount: 1,
      unknownAccountCount: 0,
      balanceStatus: "known",
    };
    advisorResult.reserveRequirementsByCurrency.PEN = {
      currencyCode: "PEN",
      ordinaryKnownAmount: 3656.69,
      ordinaryEstimatedAmount: 0,
      ordinaryUnknownCount: 0,
      cardKnownAmount: 0,
      cardUnknownCount: 0,
      requiredKnownAmount: 3656.69,
    };

    render(<FinancialAdvisorPanel result={advisorResult} onNavigate={vi.fn()} />);
    const panel = within(screen.getAllByTestId("financial-advisor-panel").at(-1)!);
    fireEvent.change(panel.getByTestId("advisor-extra-amount"), { target: { value: "100" } });
    fireEvent.click(panel.getByRole("button", { name: "Analizar dinero adicional" }));

    expect(panel.getByText("RESULTADO")).toBeTruthy();
    expect(panel.getByText("Faltante antes")).toBeTruthy();
    expect(panel.getByText("Faltante después")).toBeTruthy();
    expect(panel.getByText("NO CONVIENE HACER UN PREPAGO TODAVÍA")).toBeTruthy();
    expect(panel.getByText(/Actualmente te faltan/)).toBeTruthy();
    expect(panel.getByText(/Todavía no los destines a reducción de principal/)).toBeTruthy();
  });
});
