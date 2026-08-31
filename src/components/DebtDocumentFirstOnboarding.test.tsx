// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DebtDocumentFirstOnboarding } from "./DebtDocumentFirstOnboarding";
import { createDebtFromDocument } from "../services/debtDocumentFirstOnboarding";
import { CAJA_FAMILIAR_DEBT_DOCUMENT_V2 } from "../utils/universalDebtDocument";
import { createDirectRealEstateFixture } from "../utils/universalDebtFixture";

vi.mock("../services/debtDocumentFirstOnboarding", () => ({
  createDebtFromDocument: vi.fn(),
}));

function realProformaJson(options: {
  unsafeSourceOrder?: boolean;
  staleDocumentPrincipal?: boolean;
  unknownContractualNumber?: number;
  futureUnknownAfter?: number;
} = {}): string {
  const fixture = createDirectRealEstateFixture();
  return JSON.stringify({
    schema: CAJA_FAMILIAR_DEBT_DOCUMENT_V2,
    kind: "schedule",
    authority: "official_noncontractual",
    authorityEvidence: "proforma_non_binding",
    contract: {
      debtKind: "installment_purchase",
      debtName: "Proforma saneada",
      creditorName: "ACREEDOR INMOBILIARIO",
      currencyCode: "PEN",
      assetPrice: 85000,
      downPaymentAmount: 17000,
      financedPrincipalAmount: 76500,
      scheduledPrincipalAmount: 76500,
      principalBasis: "asset_price_including_down_payment",
      ...(options.staleDocumentPrincipal ? {
        currentPrincipalAmount: 76500,
        openingPrincipalAmount: 76500,
      } : {}),
      repaymentStructure: "fixed_schedule",
      termInstallments: 128,
      interestRateType: "nominal_annual_simple",
      interestRatePercent: 23,
      dayCountBasis: "actual_days_360",
    },
    rows: fixture.rows.map((row, index) => ({
      ...row,
      sourceRowNumber: options.unsafeSourceOrder && index === 1 ? 99 : row.sourceRowNumber,
      contractualInstallmentNumber: index === 1 ? 1 : row.contractualInstallmentNumber,
      expectedPrincipal: options.unknownContractualNumber != null && row.contractualInstallmentNumber === options.unknownContractualNumber
        ? null
        : options.futureUnknownAfter != null && (row.contractualInstallmentNumber ?? 0) > options.futureUnknownAfter
          ? null
          : row.expectedPrincipal,
    })),
  });
}

function renderOnboarding() {
  return render(
    <DebtDocumentFirstOnboarding
      currentMember={{ householdId: "household-test", userId: "user-test", displayName: "Test", role: "owner" }}
      setToast={() => {}}
      onSaved={() => {}}
      onCancel={() => {}}
      onBack={() => {}}
      onUseSpecializedFlow={() => {}}
    />
  );
}

describe("DebtDocumentFirstOnboarding real proforma review", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows corrected semantics, separate row counts, exact structure, and last-paid capital", () => {
    renderOnboarding();
    fireEvent.change(screen.getByLabelText("JSON V2 del documento"), { target: { value: realProformaJson({ staleDocumentPrincipal: true }) } });
    fireEvent.click(screen.getByRole("button", { name: "ANALIZAR Y RELLENAR DEUDA" }));

    expect(screen.getByText("129 FILAS")).toBeTruthy();
    expect(screen.getByText("VALIDADA / EXACTA")).toBeTruthy();
    expect(screen.getByText("Plazo informado: 128")).toBeTruthy();
    expect(screen.getAllByText("S/ 8,500.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("S/ 85,000.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/números duplicados/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /YA REALICÉ PAGOS CONSECUTIVOS Y COMPLETOS/ }));
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "8" } });
    expect(screen.getAllByText("S/ 69,062.50").length).toBeGreaterThan(0);
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "9" } });
    expect(screen.getAllByText("S/ 68,000.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("S/ 69,062.50")).toBeNull();

    const createMock = vi.mocked(createDebtFromDocument);
    createMock.mockResolvedValue({} as never);
    fireEvent.click(screen.getByRole("button", { name: "CONFIRMAR Y CREAR DEUDA" }));
    return waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
      expect(createMock.mock.calls[0]?.[0]).toMatchObject({
        openingPrincipalBalance: 68000,
        contract: { openingPrincipalAmount: 68000 },
      });
    });
  });

  it("keeps creation disabled when duplicate numbering has unsafe source order", () => {
    renderOnboarding();
    fireEvent.change(screen.getByLabelText("JSON V2 del documento"), { target: { value: realProformaJson({ unsafeSourceOrder: true }) } });
    fireEvent.click(screen.getByRole("button", { name: "ANALIZAR Y RELLENAR DEUDA" }));

    expect(screen.getByText("NO SE PUEDE CREAR TODAVÍA")).toBeTruthy();
    expect(screen.getByRole("button", { name: "CONFIRMAR Y CREAR DEUDA" })).toHaveProperty("disabled", true);
  });
});
