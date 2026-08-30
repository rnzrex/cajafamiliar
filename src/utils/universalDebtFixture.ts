import type { DebtContractAuthority } from "../types";
import type { UniversalDebtDocumentRow } from "./universalDebtDocument";
import { roundCurrency } from "./universalDebtContract";

export interface DirectRealEstateFixture {
  schema: "CAJA_FAMILIAR_DIRECT_REAL_ESTATE_FIXTURE_V1";
  currencyCode: "PEN";
  assetPrice: 85000;
  downPaymentAmount: 8500;
  financedPrincipalAmount: 76500;
  scheduledPrincipalAmount: 85000;
  rows: UniversalDebtDocumentRow[];
  notes: string;
}

function isoDate(year: number, monthIndex: number, day: number): string {
  const date = new Date(Date.UTC(year, monthIndex, day));
  return date.toISOString().slice(0, 10);
}

function addMonths(year: number, monthIndex: number, amount: number): [number, number] {
  const total = year * 12 + monthIndex + amount;
  return [Math.floor(total / 12), total % 12];
}

function elapsedDays(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

/**
 * Sanitized 129-row direct-real-estate fixture used by unit/SQL gates only.
 * It contains no names, IDs, addresses, contracts, or uploaded-document data.
 */
export function createDirectRealEstateFixture(): DirectRealEstateFixture {
  const authority: DebtContractAuthority = "official_noncontractual";
  const rows: UniversalDebtDocumentRow[] = [];
  rows.push({
    sourceRowNumber: 1,
    contractualInstallmentNumber: 1,
    dueDate: isoDate(2027, 0, 10),
    openingBalance: 85000,
    expectedAmount: 8500,
    expectedPrincipal: 8500,
    expectedInterest: 0,
    expectedFees: 0,
    expectedInsurance: 0,
    expectedTaxes: 0,
    reportedBalance: 76500,
    endingBalance: 76500,
    rowRole: "down_payment",
    phase: "down_payment",
    authority,
    evidence: { source: "sanitized_acceptance_fixture" },
  });

  // Eight introductory installments of PEN 1,062.50 with zero interest.
  for (let index = 0; index < 8; index += 1) {
    const [year, month] = addMonths(2027, 0, index + 1);
    rows.push({
      sourceRowNumber: index + 2,
      contractualInstallmentNumber: index + 2,
      dueDate: isoDate(year, month, 10),
      openingBalance: roundCurrency(76500 - 1062.5 * index),
      expectedAmount: 1062.5,
      expectedPrincipal: 1062.5,
      expectedInterest: 0,
      expectedFees: 0,
      expectedInsurance: 0,
      expectedTaxes: 0,
      reportedBalance: roundCurrency(76500 - 1062.5 * (index + 1)),
      endingBalance: roundCurrency(76500 - 1062.5 * (index + 1)),
      rowRole: "installment",
      phase: "introductory_zero_interest",
      authority,
      evidence: { source: "sanitized_acceptance_fixture", feeRule: "contract_schedule_only" },
    });
  }

  // The remaining 120 rows use the supplied TNA 23% nominal simple actual/360
  // rule. The administrative fee is retained as schedule evidence only: the
  // source does not disclose a formula that may safely be reused after a
  // principal-changing operation.
  const feeSchedule = [
    155.06, 160.42,
    ...Array.from({ length: 53 }, () => 155.17),
    ...Array.from({ length: 62 }, () => 72.86),
    116.86, 29.08,
    3.71,
  ];
  let outstandingPrincipal = 68000;
  let previousDueDate = isoDate(2027, 8, 10);
  for (let index = 0; index < 120; index += 1) {
    const [year, month] = addMonths(2027, 0, index + 9);
    const dueDate = isoDate(year, month, 10);
    const periodDays = elapsedDays(previousDueDate, dueDate);
    const interest = roundCurrency(outstandingPrincipal * 0.23 * periodDays / 360);
    const fee = feeSchedule[index];
    const total = index === 119 ? 1601.16 : 1600.36;
    const principal = roundCurrency(total - interest - fee);
    outstandingPrincipal = Math.round((outstandingPrincipal - principal) * 100) / 100;
    rows.push({
      sourceRowNumber: index + 10,
      contractualInstallmentNumber: index + 10,
      dueDate,
      openingBalance: roundCurrency(outstandingPrincipal + principal),
      expectedAmount: total,
      expectedPrincipal: principal,
      expectedInterest: interest,
      expectedFees: fee,
      expectedInsurance: 0,
      expectedTaxes: 0,
      reportedBalance: outstandingPrincipal,
      endingBalance: outstandingPrincipal,
      rowRole: "installment",
      phase: "tna_actual_days_360",
      authority,
      evidence: { source: "sanitized_acceptance_fixture", periodDays, feeRule: "contract_schedule_only" },
    });
    previousDueDate = dueDate;
  }

  return {
    schema: "CAJA_FAMILIAR_DIRECT_REAL_ESTATE_FIXTURE_V1",
    currencyCode: "PEN",
    assetPrice: 85000,
    downPaymentAmount: 8500,
    financedPrincipalAmount: 76500,
    scheduledPrincipalAmount: 85000,
    rows,
    notes: "Fixture sintético de proforma no contractual; TNA nominal simple actual/360, IGV cero y administración retenida como fee de cronograma sin fórmula de recálculo.",
  };
}
