from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}\n--- OLD ---\n{old[:500]}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# -----------------------------------------------------------------------------
# 1) Single source of truth for current-period settlement estimate.
# -----------------------------------------------------------------------------
replace_once(
    "src/utils/debtNextPayment.ts",
    '''  minimumPaymentAmount: number | null;\n  minimumPaymentKnown: boolean;\n  principalAfterPayment: number | null;\n''',
    '''  minimumPaymentAmount: number | null;\n  minimumPaymentKnown: boolean;\n  settlementAmount: number | null;\n  settlementKnown: boolean;\n  principalAfterPayment: number | null;\n''',
)

replace_once(
    "src/utils/debtNextPayment.ts",
    '''  if (interestKnown) {\n    minimumPaymentKnown = true;\n    minimumPaymentAmount = round2((interestAmount ?? 0) + effectiveMinPrincipal);\n    principalAfterPayment = round2(Math.max(0, principal - effectiveMinPrincipal));\n  } else {\n    minimumPaymentKnown = false;\n    minimumPaymentAmount = null;\n    principalAfterPayment = minimumPrincipalKnown ? round2(Math.max(0, principal - effectiveMinPrincipal)) : null;\n  }\n\n  return {\n''',
    '''  if (interestKnown) {\n    minimumPaymentKnown = true;\n    minimumPaymentAmount = round2((interestAmount ?? 0) + effectiveMinPrincipal);\n    principalAfterPayment = round2(Math.max(0, principal - effectiveMinPrincipal));\n  } else {\n    minimumPaymentKnown = false;\n    minimumPaymentAmount = null;\n    principalAfterPayment = minimumPrincipalKnown ? round2(Math.max(0, principal - effectiveMinPrincipal)) : null;\n  }\n\n  // For open-ended debts this is the best current-period payoff estimate we can\n  // derive from the registered terms: outstanding principal + applicable period\n  // interest. It intentionally does not invent unregistered fees/insurance.\n  const settlementKnown = interestKnown;\n  const settlementAmount = settlementKnown\n    ? round2(principal + (interestAmount ?? 0))\n    : null;\n\n  return {\n''',
)

replace_once(
    "src/utils/debtNextPayment.ts",
    '''    minimumPaymentAmount,\n    minimumPaymentKnown,\n    principalAfterPayment,\n''',
    '''    minimumPaymentAmount,\n    minimumPaymentKnown,\n    settlementAmount,\n    settlementKnown,\n    principalAfterPayment,\n''',
)


# -----------------------------------------------------------------------------
# 2) Planning: derive the next obligation for open-ended debts even when they
#    intentionally have no persisted installment schedule.
# -----------------------------------------------------------------------------
replace_once(
    "src/utils/debtPlanning.ts",
    '''import {\n  allocatedAmountForInstallment,\n  currentDebtScheduleVersion,\n  effectiveDebtEvents,\n} from "./debtCalculations.js";\nimport { dueDateStatus } from "./dueDates.js";\n''',
    '''import {\n  allocatedAmountForInstallment,\n  currentDebtPrincipal,\n  currentDebtScheduleVersion,\n  effectiveDebtEvents,\n} from "./debtCalculations.js";\nimport { calculateNextPayment } from "./debtNextPayment.js";\nimport { dueDateStatus } from "./dueDates.js";\n''',
)

replace_once(
    "src/utils/debtPlanning.ts",
    '''    const currentSchedule = currentDebtScheduleVersion(debt.id, scheduleVersions);\n    if (!currentSchedule) continue; // No schedule — nothing to plan\n\n    // Only installments of the current schedule version\n    const debtInstallments = installments.filter(\n      (i) => i.scheduleVersionId === currentSchedule.id && i.debtId === debt.id\n    );\n\n    for (const installment of debtInstallments) {\n''',
    '''    const currentSchedule = currentDebtScheduleVersion(debt.id, scheduleVersions);\n\n    // Only installments of the current schedule version. Open-ended debts do\n    // not need a persisted schedule, so an empty list is valid for them.\n    const debtInstallments = currentSchedule\n      ? installments.filter(\n          (i) => i.scheduleVersionId === currentSchedule.id && i.debtId === debt.id\n        )\n      : [];\n\n    // Flexible/open-ended debts use calculateNextPayment as their canonical\n    // current obligation. Expose that next cycle as a derived planning item so\n    // Panorama, Próximos 30 días, alerts and Agenda all consume the same truth\n    // already used by the debt detail page. Nothing synthetic is persisted.\n    if (debt.repaymentStructure === "open_ended" && debtInstallments.length === 0) {\n      const currentPrincipal = Math.max(0, currentDebtPrincipal(debt, debtEvents));\n      const nextPayment = calculateNextPayment({\n        debt,\n        debtEvents,\n        currentPrincipal,\n        todayKey,\n      });\n\n      if (currentPrincipal > 0 && nextPayment.nextDueDate) {\n        const expectedAmount =\n          nextPayment.minimumPaymentKnown && nextPayment.minimumPaymentAmount != null\n            ? nextPayment.minimumPaymentAmount\n            : null;\n        const { amountKnown, remainingAmount, isCovered } = resolveAmounts(expectedAmount, 0);\n        const { dueStatus, dueLabel, dueTone, daysUntilDue } = resolveDueStatus(\n          nextPayment.nextDueDate,\n          isCovered,\n          todayKey\n        );\n        const paidCycles = effectiveDebtEvents(debtEvents, debt.id).filter(\n          (event) => event.eventType === "payment"\n        ).length;\n\n        items.push({\n          debtId: debt.id,\n          debtName: debt.name,\n          creditorName: debt.creditorName,\n          currencyCode: debt.currencyCode || "PEN",\n          installmentId: `derived-next-payment:${debt.id}:${nextPayment.nextDueDate}`,\n          installmentNumber: paidCycles + 1,\n          scheduleVersionId: currentSchedule?.id ?? `derived-open-ended:${debt.id}`,\n          dueDate: nextPayment.nextDueDate,\n          daysUntilDue,\n          dueStatus,\n          dueLabel,\n          dueTone,\n          expectedAmount,\n          allocatedAmount: 0,\n          remainingAmount,\n          amountKnown,\n          isCovered,\n        });\n      }\n      continue;\n    }\n\n    if (!currentSchedule) continue;\n\n    for (const installment of debtInstallments) {\n''',
)


# -----------------------------------------------------------------------------
# 3) Intelligence: stop zeroing open-ended debts and expose estimated payoff.
# -----------------------------------------------------------------------------
replace_once(
    "src/utils/debtIntelligence.ts",
    '''import { localDateString } from "./date.js";\n''',
    '''import { localDateString } from "./date.js";\nimport { calculateNextPayment } from "./debtNextPayment.js";\n''',
)

replace_once(
    "src/utils/debtIntelligence.ts",
    '''  currentPrincipal: number;\n  originalPrincipal: number | null;\n''',
    '''  currentPrincipal: number;\n  estimatedSettlementAmount: number | null;\n  estimatedSettlementKnown: boolean;\n  originalPrincipal: number | null;\n''',
)

replace_once(
    "src/utils/debtIntelligence.ts",
    '''  activeDebtCount: number;\n  totalCurrentPrincipal: number;\n\n  largestDebtId: string | null;\n''',
    '''  activeDebtCount: number;\n  totalCurrentPrincipal: number;\n  totalEstimatedSettlement: number;\n  estimatedSettlementUnknownCount: number;\n\n  largestDebtId: string | null;\n''',
)

replace_once(
    "src/utils/debtIntelligence.ts",
    '''    const currentPrincipal =\n      debt.debtKind === "credit_card" && creditCardEntries.length > 0\n        ? currentCreditCardBalance(debt, creditCardEntries)\n        : currentDebtPrincipal(debt, debtEvents);\n\n    // 2. Fund events vs Non-fund events\n''',
    '''    const currentPrincipal =\n      debt.debtKind === "credit_card" && creditCardEntries.length > 0\n        ? currentCreditCardBalance(debt, creditCardEntries)\n        : currentDebtPrincipal(debt, debtEvents);\n\n    const settlementEstimate =\n      debt.debtKind === "credit_card"\n        ? null\n        : calculateNextPayment({ debt, debtEvents, currentPrincipal, todayKey });\n    const estimatedSettlementKnown =\n      debt.debtKind === "credit_card"\n        ? true\n        : debt.repaymentStructure === "open_ended" && settlementEstimate?.settlementKnown === true;\n    const estimatedSettlementAmount =\n      debt.debtKind === "credit_card"\n        ? currentPrincipal\n        : estimatedSettlementKnown\n        ? settlementEstimate?.settlementAmount ?? null\n        : null;\n\n    // 2. Fund events vs Non-fund events\n''',
)

replace_once(
    "src/utils/debtIntelligence.ts",
    '''    if (debt.repaymentStructure === "open_ended") {\n      remainingInstallmentCount = 0;\n      knownRemainingInstallmentCount = 0;\n      unknownRemainingInstallmentCount = 0;\n      overdueInstallmentCount = 0;\n\n      nextInstallmentId = null;\n      nextInstallmentNumber = null;\n      nextInstallmentDueDate = null;\n      nextInstallmentDueStatus = null;\n      nextInstallmentRemainingAmount = null;\n      nextInstallmentAmountKnown = true;\n\n      next30InstallmentCount = 0;\n      next30KnownAmount = 0;\n      next30UnknownAmountCount = 0;\n    } else if (isCard && latestCardStatement && latestCardStatement.dueDate) {\n''',
    '''    if (isCard && latestCardStatement && latestCardStatement.dueDate) {\n''',
)

replace_once(
    "src/utils/debtIntelligence.ts",
    '''      currentPrincipal,\n      originalPrincipal: debt.originalPrincipal,\n''',
    '''      currentPrincipal,\n      estimatedSettlementAmount,\n      estimatedSettlementKnown,\n      originalPrincipal: debt.originalPrincipal,\n''',
)

replace_once(
    "src/utils/debtIntelligence.ts",
    '''        activeDebtCount: 0,\n        totalCurrentPrincipal: 0,\n\n        largestDebtId: null,\n''',
    '''        activeDebtCount: 0,\n        totalCurrentPrincipal: 0,\n        totalEstimatedSettlement: 0,\n        estimatedSettlementUnknownCount: 0,\n\n        largestDebtId: null,\n''',
)

replace_once(
    "src/utils/debtIntelligence.ts",
    '''    entry.activeDebtCount++;\n    entry.totalCurrentPrincipal += item.currentPrincipal;\n\n    // Largest / Smallest tracking\n''',
    '''    entry.activeDebtCount++;\n    entry.totalCurrentPrincipal += item.currentPrincipal;\n    if (item.estimatedSettlementKnown && item.estimatedSettlementAmount != null) {\n      entry.totalEstimatedSettlement += item.estimatedSettlementAmount;\n    } else {\n      entry.estimatedSettlementUnknownCount++;\n    }\n\n    // Largest / Smallest tracking\n''',
)


# -----------------------------------------------------------------------------
# 4) Panorama: make amount actually owed the primary KPI; retain principal as
#    secondary context and keep next-30-days strictly to scheduled minimums.
# -----------------------------------------------------------------------------
replace_once(
    "src/components/DebtPortfolioIntelligencePanel.tsx",
    '''        {/* Principal Activo Por Moneda */}\n        <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4">\n          <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Principal activo por moneda</p>\n          <div className="mt-1 space-y-0.5">\n            {currencyEntries.length === 0 ? (\n              <p className="text-sm font-bold text-slate-500">Sin deudas activas</p>\n            ) : (\n              currencyEntries.map((entry) => (\n                <p key={entry.currencyCode} className="text-lg font-extrabold text-blue-900">\n                  {formatDebtMoney(entry.totalCurrentPrincipal, entry.currencyCode)}\n                </p>\n              ))\n            )}\n          </div>\n        </div>\n''',
    '''        {/* Estimated current-period settlement by currency */}\n        <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4">\n          <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Total estimado para cancelar</p>\n          <div className="mt-1 space-y-1">\n            {currencyEntries.length === 0 ? (\n              <p className="text-sm font-bold text-slate-500">Sin deudas activas</p>\n            ) : (\n              currencyEntries.map((entry) => (\n                <div key={entry.currencyCode}>\n                  <p className="text-lg font-extrabold text-blue-900">\n                    {entry.totalEstimatedSettlement > 0\n                      ? formatDebtMoney(entry.totalEstimatedSettlement, entry.currencyCode)\n                      : "Por confirmar"}\n                  </p>\n                  <p className="text-[11px] font-semibold text-slate-500">\n                    Principal: {formatDebtMoney(entry.totalCurrentPrincipal, entry.currencyCode)}\n                  </p>\n                  {entry.estimatedSettlementUnknownCount > 0 && (\n                    <p className="text-[11px] font-semibold text-amber-700">\n                      + {entry.estimatedSettlementUnknownCount} {entry.estimatedSettlementUnknownCount === 1 ? "liquidación por confirmar" : "liquidaciones por confirmar"}\n                    </p>\n                  )}\n                </div>\n              ))\n            )}\n          </div>\n        </div>\n''',
)


# -----------------------------------------------------------------------------
# 5) Debt operations: debt-service category is system-owned; payoff prefill uses
#    principal + applicable current-period interest from the same SSOT.
# -----------------------------------------------------------------------------
replace_once(
    "src/components/DebtOperationForm.tsx",
    '''  accounts,\n  categories,\n  currentPrincipal,\n''',
    '''  accounts,\n  currentPrincipal,\n''',
)

replace_once(
    "src/components/DebtOperationForm.tsx",
    '''  const initialNextPayment = calculateNextPayment({ debt, debtEvents, currentPrincipal });\n\n  const initialPrefillCash = (operationType === "payment" && isFlexOpenEnded && initialNextPayment.minimumPaymentKnown && initialNextPayment.minimumPaymentAmount != null)\n    ? initialNextPayment.minimumPaymentAmount.toString()\n    : (operationType === "payoff" ? currentPrincipal.toString() : "");\n\n  const initialPrefillInterest = (operationType === "payment" && isFlexOpenEnded && initialNextPayment.minimumPaymentKnown && initialNextPayment.interestAmount != null)\n    ? initialNextPayment.interestAmount.toString()\n    : "0";\n''',
    '''  const initialNextPayment = calculateNextPayment({ debt, debtEvents, currentPrincipal });\n  const initialPayoffCash =\n    initialNextPayment.settlementKnown && initialNextPayment.settlementAmount != null\n      ? initialNextPayment.settlementAmount.toFixed(2)\n      : currentPrincipal.toFixed(2);\n\n  const initialPrefillCash = (operationType === "payment" && isFlexOpenEnded && initialNextPayment.minimumPaymentKnown && initialNextPayment.minimumPaymentAmount != null)\n    ? initialNextPayment.minimumPaymentAmount.toString()\n    : (operationType === "payoff" ? initialPayoffCash : "");\n\n  const initialPrefillInterest = (operationType === "payment" && isFlexOpenEnded && initialNextPayment.minimumPaymentKnown && initialNextPayment.interestAmount != null)\n    ? initialNextPayment.interestAmount.toString()\n    : (operationType === "payoff" && initialNextPayment.interestKnown && initialNextPayment.interestAmount != null\n      ? initialNextPayment.interestAmount.toString()\n      : "0");\n''',
)

replace_once(
    "src/components/DebtOperationForm.tsx",
    '''  const activeCategories = categories.filter((c) => c.is_active && (c.type === "egreso" || c.type === "ambos"));\n  const defaultCategory = activeCategories.find((c) => c.name.toLowerCase() === "préstamos")?.name ?? activeCategories[0]?.name ?? "";\n  const [category, setCategory] = useState(defaultCategory);\n''',
    '''  // Debt-service movements have a system-owned category. The economic\n  // split remains in DebtEvent (principal vs interest/costs), so this label\n  // cannot be changed into an unrelated household spending category.\n  const category = "Pago de deuda";\n''',
)

replace_once(
    "src/components/DebtOperationForm.tsx",
    '''              <div>\n                <label className="block text-sm font-semibold text-slate-700">Categoría</label>\n                <select\n                  value={category}\n                  onChange={(e) => setCategory(e.target.value)}\n                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"\n                >\n                  {activeCategories.map((cat) => (\n                    <option key={cat.id} value={cat.name}>\n                      {cat.name}\n                    </option>\n                  ))}\n                </select>\n              </div>\n''',
    '''              <div>\n                <label className="block text-sm font-semibold text-slate-700">Categoría</label>\n                <div className="mt-1 w-full rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 font-semibold text-blue-900">\n                  {category}\n                </div>\n                <p className="mt-1 text-xs text-slate-500">Vinculada automáticamente a esta deuda.</p>\n              </div>\n''',
)


# -----------------------------------------------------------------------------
# 6) Detail: show principal and the current-period amount needed to cancel.
# -----------------------------------------------------------------------------
replace_once(
    "src/components/DebtDetailModal.tsx",
    '''                  <div>\n                    <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Saldo principal actual</p>\n                    <p className="text-3xl font-extrabold text-blue-900">\n                      {formatDebtMoney(debtIntelligence.currentPrincipal, debtIntelligence.currencyCode)}\n                    </p>\n                    <p className="mt-1 text-xs text-slate-500">\n                      Principal inicial de apertura: {formatDebtMoney(debt.openingPrincipalBalance, debt.currencyCode)}\n                    </p>\n                  </div>\n                  <div className="flex items-center gap-2">\n''',
    '''                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">\n                    <div>\n                      <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Saldo principal actual</p>\n                      <p className="text-3xl font-extrabold text-blue-900">\n                        {formatDebtMoney(debtIntelligence.currentPrincipal, debtIntelligence.currencyCode)}\n                      </p>\n                      <p className="mt-1 text-xs text-slate-500">\n                        Principal inicial de apertura: {formatDebtMoney(debt.openingPrincipalBalance, debt.currencyCode)}\n                      </p>\n                    </div>\n                    {isFlexOpenEnded && (\n                      <div className="rounded-xl border border-emerald-200 bg-white/80 px-4 py-3">\n                        <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Total estimado para cancelar este período</p>\n                        <p className="text-2xl font-extrabold text-emerald-800">\n                          {nextPayment.settlementKnown && nextPayment.settlementAmount != null\n                            ? formatDebtMoney(nextPayment.settlementAmount, nextPayment.currencyCode)\n                            : "Por confirmar"}\n                        </p>\n                        <p className="mt-1 text-xs text-slate-500">\n                          Principal + interés estimado del período. No incluye cargos no registrados.\n                        </p>\n                      </div>\n                    )}\n                  </div>\n                  <div className="flex items-center gap-2">\n''',
)


# -----------------------------------------------------------------------------
# 7) Focused regression coverage.
# -----------------------------------------------------------------------------
test_path = Path("src/utils/debtServicePlanningHotfix.test.ts")
test_path.write_text(
    '''import { describe, expect, it } from "vitest";\nimport { readFileSync } from "node:fs";\nimport type { Debt } from "../types";\nimport { calculateNextPayment } from "./debtNextPayment";\nimport { buildDebtPlanningItems } from "./debtPlanning";\nimport { buildDebtIntelligenceItems, buildDebtPortfolioIntelligence } from "./debtIntelligence";\n\nconst qapaq: Debt = {\n  id: "qapaq-1",\n  name: "Empeño: 2 DENARIOS, 1 SORTIJA, 1 PULSERA, 1 CADENA",\n  creditorName: "QAPAQ",\n  debtKind: "pledge",\n  currencyCode: "PEN",\n  originDate: "2026-07-31",\n  trackingStartDate: "2026-07-31",\n  originalPrincipal: 6510,\n  openingPrincipalBalance: 6510,\n  plannedInstallmentCount: null,\n  plannedInstallmentAmount: null,\n  installmentAmountMode: "unknown",\n  paymentFrequency: "monthly",\n  customFrequencyDays: null,\n  firstDueDate: "2026-08-31",\n  teaPercent: 51.11,\n  tceaPercent: 51.11,\n  notes: "",\n  status: "active",\n  isArchived: false,\n  createdByUserId: "user-1",\n  createdAt: "2026-08-24T00:00:00.000Z",\n  updatedAt: "2026-08-24T00:00:00.000Z",\n  repaymentStructure: "open_ended",\n  interestCalculationMode: "tea_estimate",\n  periodicRatePercent: null,\n  periodicRateBasis: "monthly",\n  interestAccrualAnchorDate: null,\n  minimumPrincipalPayment: 30,\n};\n\ndescribe("debt service planning hotfix", () => {\n  it("uses the same current-period figures for minimum payment and settlement", () => {\n    const next = calculateNextPayment({\n      debt: qapaq,\n      debtEvents: [],\n      currentPrincipal: 6510,\n      todayKey: "2026-08-24",\n    });\n\n    expect(next.nextDueDate).toBe("2026-08-31");\n    expect(next.interestAmount).toBeCloseTo(227.86, 2);\n    expect(next.minimumPaymentAmount).toBeCloseTo(257.86, 2);\n    expect(next.settlementKnown).toBe(true);\n    expect(next.settlementAmount).toBeCloseTo(6737.86, 2);\n  });\n\n  it("projects the next open-ended payment into Agenda and the next-30-days portfolio", () => {\n    const planning = buildDebtPlanningItems([qapaq], [], [], [], [], "2026-08-24");\n    expect(planning).toHaveLength(1);\n    expect(planning[0]).toMatchObject({\n      debtId: qapaq.id,\n      dueDate: "2026-08-31",\n      dueStatus: "upcoming",\n      amountKnown: true,\n    });\n    expect(planning[0].expectedAmount).toBeCloseTo(257.86, 2);\n    expect(planning[0].remainingAmount).toBeCloseTo(257.86, 2);\n\n    const intelligence = buildDebtIntelligenceItems({\n      debts: [qapaq],\n      debtEvents: [],\n      debtScheduleVersions: [],\n      debtInstallments: [],\n      debtCollaterals: [],\n      debtPlanningItems: planning,\n      todayKey: "2026-08-24",\n    });\n\n    expect(intelligence[0].nextInstallmentDueDate).toBe("2026-08-31");\n    expect(intelligence[0].next30InstallmentCount).toBe(1);\n    expect(intelligence[0].next30KnownAmount).toBeCloseTo(257.86, 2);\n    expect(intelligence[0].estimatedSettlementAmount).toBeCloseTo(6737.86, 2);\n\n    const portfolio = buildDebtPortfolioIntelligence(intelligence);\n    expect(portfolio.byCurrency.PEN.next30KnownAmount).toBeCloseTo(257.86, 2);\n    expect(portfolio.byCurrency.PEN.totalEstimatedSettlement).toBeCloseTo(6737.86, 2);\n  });\n\n  it("keeps debt-service category fixed in the operation UI", () => {\n    const source = readFileSync(new URL("../components/DebtOperationForm.tsx", import.meta.url), "utf8");\n    expect(source).toContain('const category = "Pago de deuda";');\n    expect(source).toContain("Vinculada automáticamente a esta deuda.");\n    expect(source).not.toContain("setCategory(e.target.value)");\n  });\n\n  it("shows the current-period cancellation total in debt detail", () => {\n    const source = readFileSync(new URL("../components/DebtDetailModal.tsx", import.meta.url), "utf8");\n    expect(source).toContain("Total estimado para cancelar este período");\n    expect(source).toContain("nextPayment.settlementAmount");\n  });\n});\n''',
    encoding="utf-8",
)

print("Debt service/planning hotfix applied successfully.")
