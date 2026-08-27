import { useMemo, useState } from "react";
import { ArrowLeft, AlertCircle } from "lucide-react";
import type { BankLoanProfile, Category, Debt, DebtEvent, DebtEventInstallmentAllocation, DebtInstallment, DebtInsuranceTerms, DebtScheduleVersion, FinancialAccount, PrepaymentEffect } from "../types";
import { recordDebtPayment, recordDebtPrepayment, recordDebtPayoff, reverseDebtEvent, recordDebtInstallmentAdvance } from "../services/dataRepository";
import type { DebtOperationSaveResult } from "../services/authoritativeSync";
import { makeUuid } from "../utils/storage";
import { localDateString } from "../utils/date";
import { translateDebtError, validateDebtPayment, validateDebtPrepayment, validateDebtPayoff, validateDebtAllocations, debtEconomicSummary } from "../utils/debtViewModel";
import { allocatedAmountForInstallment } from "../utils/debtCalculations";
import { calculateAssistedInterestSuggestion, getLastEffectiveDebtPaymentDate } from "../utils/debtInterestEngine";
import { calculateNextPayment } from "../utils/debtNextPayment";
import { getCurrencySymbol } from "../utils/debtFormMode";
import { getDebtScheduleLifecycleState } from "../utils/debtPlanning.js";
import { DebtScheduleUpdateForm } from "./DebtScheduleUpdateForm.js";
import { BankSchedulePreview } from "./BankSchedulePreview.js";
import { simulateBankPrepayment } from "../utils/bankPrepaymentSimulation.js";

function assertNever(value: never): never {
  throw new Error(`Operación de deuda no soportada: ${String(value)}`);
}

type ScheduleDraftRow = {
  installmentNumber: number;
  contractualInstallmentNumber?: number | null;
  dueDate: string;
  expectedAmount: string;
  expectedPrincipal: string;
  expectedInterest: string;
  expectedFees: string;
  expectedInsurance: string;
};

function toScheduleDraftRow(installment: DebtInstallment): ScheduleDraftRow {
  return {
    installmentNumber: installment.installmentNumber,
    contractualInstallmentNumber: installment.contractualInstallmentNumber,
    dueDate: installment.dueDate,
    expectedAmount: installment.expectedAmount == null ? "" : String(installment.expectedAmount),
    expectedPrincipal: installment.expectedPrincipal == null ? "" : String(installment.expectedPrincipal),
    expectedInterest: installment.expectedInterest == null ? "" : String(installment.expectedInterest),
    expectedFees: installment.expectedFees == null ? "" : String(installment.expectedFees),
    expectedInsurance: installment.expectedInsurance == null ? "" : String(installment.expectedInsurance),
  };
}

function toScheduleInstallmentInput(row: ScheduleDraftRow, index: number) {
  const numberOrNull = (value: string) => value.trim() === "" ? null : Number(value);
  return {
    installmentNumber: index + 1,
    ...(row.contractualInstallmentNumber != null ? { contractualInstallmentNumber: row.contractualInstallmentNumber } : {}),
    dueDate: row.dueDate,
    expectedAmount: numberOrNull(row.expectedAmount),
    expectedPrincipal: numberOrNull(row.expectedPrincipal),
    expectedInterest: numberOrNull(row.expectedInterest),
    expectedFees: numberOrNull(row.expectedFees),
    expectedInsurance: numberOrNull(row.expectedInsurance),
  };
}

function validateStrictScheduleDraft(rows: ScheduleDraftRow[], eventDate: string): string | null {
  if (rows.length === 0) return "Debe ingresar al menos una cuota en el nuevo cronograma.";

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const values = [row.expectedAmount, row.expectedPrincipal, row.expectedInterest, row.expectedFees, row.expectedInsurance];
    const numbers = values.map(Number);
    const components = numbers[1] + numbers[2] + numbers[3] + numbers[4];
    if (
      !row.dueDate ||
      row.dueDate <= eventDate ||
      values.some((value) => value.trim() === "") ||
      numbers.some((value) => !Number.isFinite(value)) ||
      numbers[0] <= 0 ||
      numbers.slice(1).some((value) => value < 0) ||
      Math.abs(components - numbers[0]) > 0.01 ||
      (index > 0 && row.dueDate <= rows[index - 1].dueDate)
    ) {
      return `La cuota #${index + 1} tiene importes o fecha inválidos.`;
    }
  }
  return null;
}

interface DebtOperationFormProps {
  debt: Debt;
  operationType: "payment" | "prepayment" | "payoff" | "reversal" | "installment_advance" | "schedule_update";
  targetEventId?: string;
  paymentWithExtraPrincipal?: boolean;
  installments: DebtInstallment[];
  scheduleVersions: DebtScheduleVersion[];
  debtEvents: DebtEvent[];
  accounts: FinancialAccount[];
  categories: Category[];
  currentPrincipal: number;
  bankLoanProfile?: BankLoanProfile | null;
  debtInsuranceTerms?: DebtInsuranceTerms[];
  canWriteDebt?: boolean;
  persistedAllocations: DebtEventInstallmentAllocation[];
  onSaved: (result: DebtOperationSaveResult) => Promise<void> | void;
  onCancel: () => void;
  setToast: (toast: { message: string; type: "success" | "error" }) => void;
}

export function DebtOperationForm({
  debt,
  operationType,
  targetEventId,
  paymentWithExtraPrincipal = false,
  installments,
  scheduleVersions,
  debtEvents,
  accounts,
  currentPrincipal,
  bankLoanProfile = null,
  debtInsuranceTerms = [],
  canWriteDebt = true,
  persistedAllocations,
  onSaved,
  onCancel,
  setToast,
}: DebtOperationFormProps) {
  const [eventId] = useState(() => makeUuid());
  const [movementId] = useState(() => makeUuid());
  const [reversalEventId] = useState(() => makeUuid());

  const isFlexOpenEnded = debt.repaymentStructure === "open_ended";
  const isBankFixedSchedule = debt.debtKind === "bank_loan" && debt.repaymentStructure === "fixed_schedule";
  const initialNextPayment = calculateNextPayment({ debt, debtEvents, currentPrincipal });

  let initialPayoffCash = "";
  let initialPayoffInterest = "0";

  if (operationType === "payoff") {
    if (isFlexOpenEnded) {
      if (initialNextPayment.settlementKnown && initialNextPayment.settlementAmount != null) {
        initialPayoffCash = initialNextPayment.settlementAmount.toFixed(2);
        initialPayoffInterest = (initialNextPayment.interestAmount ?? 0).toString();
      } else {
        // Open-ended + settlement unknown: leave cash empty so user inputs real amount
        initialPayoffCash = "";
        initialPayoffInterest = "0";
      }
    } else {
      // Fixed-schedule: preserve previous behavior (currentPrincipal)
      initialPayoffCash = currentPrincipal > 0 ? currentPrincipal.toString() : "";
      initialPayoffInterest = "0";
    }
  }

  const initialPrefillCash = (operationType === "payment" && isFlexOpenEnded && initialNextPayment.minimumPaymentKnown && initialNextPayment.minimumPaymentAmount != null)
    ? initialNextPayment.minimumPaymentAmount.toString()
    : (operationType === "payoff" ? initialPayoffCash : "");

  const initialPrefillInterest = (operationType === "payment" && isFlexOpenEnded && initialNextPayment.minimumPaymentKnown && initialNextPayment.interestAmount != null)
    ? initialNextPayment.interestAmount.toString()
    : (operationType === "payoff" ? initialPayoffInterest : "0");

  const initialPrefillPrincipal = (operationType === "payment" && isFlexOpenEnded && initialNextPayment.minimumPaymentKnown && initialNextPayment.minimumPrincipalAmount != null)
    ? initialNextPayment.minimumPrincipalAmount.toString()
    : (operationType === "payoff" ? currentPrincipal.toString() : "");

  const [eventDate, setEventDate] = useState(localDateString(new Date()));
  const [cashAmount, setCashAmount] = useState(initialPrefillCash);

  const activeAccounts = accounts.filter((acc) => acc.isActive !== false);
  const [accountId, setAccountId] = useState(activeAccounts[0]?.id ?? "");

  const formatDueDateDisplay = (isoDate: string) => {
    const parts = isoDate.split("-");
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : isoDate;
  };

  const [description, setDescription] = useState(
    operationType === "payment"
      ? paymentWithExtraPrincipal
        ? `Pago de cuota + abono al capital — ${debt.name}`
        : isFlexOpenEnded
        ? initialNextPayment.nextDueDate
          ? `Pago de deuda — ${debt.name} — vencimiento ${formatDueDateDisplay(initialNextPayment.nextDueDate)}`
          : `Pago de deuda — ${debt.name}`
        : `Pago de cuota — ${debt.name}`
      : operationType === "prepayment"
        ? `Prepago de principal — ${debt.name}`
        : operationType === "payoff"
          ? `Liquidación total — ${debt.name}`
          : operationType === "installment_advance"
            ? `Adelanto de cuotas — ${debt.name}`
          : `Reversión de registro — ${debt.name}`
  );

  // Debt-service movements have a system-owned category. The economic
  // split remains in DebtEvent (principal vs interest/costs), so this label
  // cannot be changed into an unrelated household spending category.
  const category = "Pago de deuda";

  const [principalAmount, setPrincipalAmount] = useState(initialPrefillPrincipal);
  const [extraPrincipalAmount, setExtraPrincipalAmount] = useState("0");
  const [prepaymentEffect, setPrepaymentEffect] = useState<PrepaymentEffect>(() =>
    isBankFixedSchedule && (operationType === "prepayment" || paymentWithExtraPrincipal)
      ? "pending_bank_schedule"
      : "unknown"
  );
  const [interestPaid, setInterestPaid] = useState(initialPrefillInterest);
  const [feesPaid, setFeesPaid] = useState("0");
  const [insurancePaid, setInsurancePaid] = useState("0");
  const [otherCostPaid, setOtherCostPaid] = useState("0");
  const [breakdownComplete, setBreakdownComplete] = useState(true);

  const scheduleLifecycle = getDebtScheduleLifecycleState(debt.id, debtEvents, scheduleVersions);
  const hasPendingBankSchedule = debt.debtKind === "bank_loan" && scheduleLifecycle.pendingBankSchedule;
  const currentSchedule = scheduleLifecycle.currentSchedule;
  const currentScheduleInstallments = hasPendingBankSchedule
    ? []
    : installments.filter((i) => currentSchedule && i.scheduleVersionId === currentSchedule.id && !i.isPaidBeforeTracking);
  const [allocations, setAllocations] = useState<Array<{ installmentId: string; allocatedAmount: string }>>([]);

  const eligibleAdvanceInstallments = currentScheduleInstallments.filter((installment) => {
    const allocatedBefore = allocatedAmountForInstallment(installment.id, persistedAllocations, debtEvents);
    return installment.dueDate > eventDate && allocatedBefore <= 0.01;
  });

  const setAdvanceAllocations = (nextAllocations: Array<{ installmentId: string; allocatedAmount: string }>) => {
    setAllocations(nextAllocations);
    if (operationType !== "installment_advance") return;

    const selected = nextAllocations
      .map((allocation) => currentScheduleInstallments.find((installment) => installment.id === allocation.installmentId))
      .filter((installment): installment is DebtInstallment => installment != null);
    const sum = (field: "expectedAmount" | "expectedPrincipal" | "expectedInterest" | "expectedFees" | "expectedInsurance") =>
      selected.reduce((total, installment) => total + (installment[field] ?? 0), 0);
    setCashAmount(sum("expectedAmount").toFixed(2));
    setPrincipalAmount(sum("expectedPrincipal").toFixed(2));
    setInterestPaid(sum("expectedInterest").toFixed(2));
    setFeesPaid(sum("expectedFees").toFixed(2));
    setInsurancePaid(sum("expectedInsurance").toFixed(2));
    setOtherCostPaid("0");
    setBreakdownComplete(true);
  };

  const [hasNewPrepaymentSchedule, setHasNewPrepaymentSchedule] = useState(false);
  const [hasNewPaymentSchedule, setHasNewPaymentSchedule] = useState(false);
  const [newScheduleSource, setNewScheduleSource] = useState<"contractual" | "estimated">("contractual");

  const targetScheduleVersion = targetEventId
    ? scheduleVersions
        .filter((version) => version.debtId === debt.id && version.triggerEventId === targetEventId)
        .sort((a, b) => a.versionNumber - b.versionNumber)
        .at(-1) ?? null
    : null;
  const previousScheduleVersion = targetScheduleVersion
    ? scheduleVersions
        .filter((version) => version.debtId === debt.id && version.versionNumber < targetScheduleVersion.versionNumber)
        .sort((a, b) => a.versionNumber - b.versionNumber)
        .at(-1) ?? null
    : null;
  const previousScheduleInstallments = previousScheduleVersion
    ? installments
        .filter((installment) => installment.debtId === debt.id && installment.scheduleVersionId === previousScheduleVersion.id)
        .sort((a, b) => a.installmentNumber - b.installmentNumber)
    : [];
  const targetGeneratedSchedule = targetScheduleVersion != null;

  const [scheduleInstallments, setScheduleInstallments] = useState<ScheduleDraftRow[]>(() =>
    operationType === "reversal" ? previousScheduleInstallments.map(toScheduleDraftRow) : []
  );
  const [scheduleNotes, setScheduleNotes] = useState(() =>
    operationType === "reversal" ? previousScheduleVersion?.notes ?? "" : ""
  );
  const [simulation, setSimulation] = useState<ReturnType<typeof simulateBankPrepayment> | null>(null);
  const [calculatedSimulationFingerprint, setCalculatedSimulationFingerprint] = useState("");
  const [simulationAccepted, setSimulationAccepted] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [isUserModified, setIsUserModified] = useState(false);
  const currencySymbol = getCurrencySymbol(debt.currencyCode);

  const lastEventDate = getLastEffectiveDebtPaymentDate(debtEvents, debt.id);
  const nextPayment = calculateNextPayment({ debt, debtEvents, currentPrincipal, todayKey: eventDate });

  const numCash = Number(cashAmount || 0);
  const suggestion = calculateAssistedInterestSuggestion({
    debt,
    currentPrincipal,
    paymentDate: eventDate,
    cashAmount: numCash,
    lastEventDate,
    nextInstallment: currentScheduleInstallments[0] || null,
  });

  const applySuggestion = () => {
    if (suggestion.certainty !== "insufficient_info") {
      setInterestPaid(suggestion.suggestedInterest.toString());
      setPrincipalAmount(suggestion.suggestedPrincipal.toString());
      setOtherCostPaid(suggestion.suggestedOtherCosts.toString());
      setFeesPaid("0");
      setInsurancePaid("0");
    }
    setIsUserModified(false);
  };

  const numPrincipal = Number(principalAmount || 0);
  const numExtraPrincipal = Number(extraPrincipalAmount || 0);
  const totalPrincipalAmount = numPrincipal + numExtraPrincipal;
  const numInterest = Number(interestPaid || 0);
  const numFees = Number(feesPaid || 0);
  const numInsurance = Number(insurancePaid || 0);
  const numOtherCost = Number(otherCostPaid || 0);
  const bankPrepaymentScenario = isBankFixedSchedule && (
    operationType === "prepayment" || (operationType === "payment" && paymentWithExtraPrincipal && numExtraPrincipal > 0)
  );
  const simulationEffect = prepaymentEffect === "reduce_term" || prepaymentEffect === "reduce_installment"
    ? prepaymentEffect
    : null;
  const simulationFingerprint = useMemo(
    () => JSON.stringify({
      effect: simulationEffect,
      eventDate,
      principalBefore: currentPrincipal,
      principalPaid: operationType === "payment" ? numPrincipal : 0,
      extraPrincipalPaid: operationType === "payment" ? numExtraPrincipal : numPrincipal,
      teaPercent: debt.teaPercent,
      periodicRatePercent: debt.periodicRatePercent,
      periodicRateBasis: debt.periodicRateBasis,
      bankLoanProfile,
      debtInsuranceTerms,
      schedule: currentScheduleInstallments.map((row) => ({
        installmentNumber: row.installmentNumber,
        contractualInstallmentNumber: row.contractualInstallmentNumber,
        dueDate: row.dueDate,
        expectedAmount: row.expectedAmount,
        expectedPrincipal: row.expectedPrincipal,
        expectedInterest: row.expectedInterest,
        expectedFees: row.expectedFees,
        expectedInsurance: row.expectedInsurance,
      })),
    }),
    [bankLoanProfile, currentPrincipal, currentScheduleInstallments, debt.periodicRateBasis, debt.periodicRatePercent, debt.teaPercent, debtInsuranceTerms, eventDate, numExtraPrincipal, numPrincipal, operationType, simulationEffect],
  );
  const simulationIsCurrent = simulation != null && calculatedSimulationFingerprint === simulationFingerprint;
  const simulationInput = useMemo(() => simulationEffect == null ? null : ({
    effect: simulationEffect,
    principalBeforeOperation: currentPrincipal,
    principalPaid: operationType === "payment" ? numPrincipal : 0,
    extraPrincipalPaid: operationType === "payment" ? numExtraPrincipal : numPrincipal,
    operationDate: eventDate,
    originalPrincipal: bankLoanProfile?.financedAmount ?? debt.originalPrincipal,
    teaPercent: debt.teaPercent,
    periodicRatePercent: debt.periodicRatePercent,
    periodicRateBasis: debt.periodicRateBasis,
    dayCountBasis: bankLoanProfile?.interestDayCountBasis,
    installmentTotalMode: bankLoanProfile?.installmentTotalMode,
    dueDateAdjustmentRule: bankLoanProfile?.dueDateAdjustmentRule,
    amortizationMethod: bankLoanProfile?.amortizationMethod,
    currentSchedule: currentScheduleInstallments,
    insuranceTerms: debtInsuranceTerms,
  }), [bankLoanProfile, currentPrincipal, currentScheduleInstallments, debt.originalPrincipal, debt.periodicRateBasis, debt.periodicRatePercent, debt.teaPercent, debtInsuranceTerms, eventDate, numExtraPrincipal, numPrincipal, operationType, simulationEffect]);
  const summary = debtEconomicSummary(
    numCash,
    operationType === "payoff" ? currentPrincipal : totalPrincipalAmount,
    numInterest,
    numFees,
    numInsurance,
    numOtherCost,
    operationType === "payoff" ? currentPrincipal : undefined
  );

  const isAccountMissing = operationType !== "reversal" && !accountId;
  const hasNoActiveAccounts = operationType !== "reversal" && activeAccounts.length === 0;

  const clearBankScheduleChoice = () => {
    setHasNewPaymentSchedule(false);
    setHasNewPrepaymentSchedule(false);
    setScheduleInstallments([]);
    setScheduleNotes("");
    setSimulation(null);
    setCalculatedSimulationFingerprint("");
    setSimulationAccepted(false);
  };

  const chooseBankPrepaymentPath = (choice: PrepaymentEffect | "official") => {
    if (choice === "official") {
      setPrepaymentEffect("other");
      setHasNewPaymentSchedule(operationType === "payment");
      setHasNewPrepaymentSchedule(operationType === "prepayment");
      setNewScheduleSource("contractual");
      setSimulation(null);
      setCalculatedSimulationFingerprint("");
      setSimulationAccepted(false);
      return;
    }
    setPrepaymentEffect(choice);
    clearBankScheduleChoice();
  };

  const calculatePrepaymentSimulation = () => {
    if (!simulationInput) return;
    const result = simulateBankPrepayment(simulationInput);
    setSimulation(result);
    setCalculatedSimulationFingerprint(simulationFingerprint);
    setSimulationAccepted(false);
  };

  const effectiveSimulation = bankPrepaymentScenario && simulationEffect != null && simulationIsCurrent ? simulation : null;
  const hasSelectedSchedule = operationType === "payment" ? hasNewPaymentSchedule : hasNewPrepaymentSchedule;
  const scheduleForSave = hasSelectedSchedule
    ? scheduleInstallments.map(toScheduleInstallmentInput)
    : effectiveSimulation?.rows.map((row) => ({
        installmentNumber: row.installmentNumber,
        contractualInstallmentNumber: row.contractualInstallmentNumber,
        dueDate: row.dueDate,
        expectedAmount: row.total,
        expectedPrincipal: row.principal,
        expectedInterest: row.interest,
        expectedFees: row.fees,
        expectedInsurance: row.insurance,
      })) ?? [];
  const scheduleSourceForSave = hasSelectedSchedule ? "contractual" as const : effectiveSimulation ? "estimated" as const : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteDebt || (typeof navigator !== "undefined" && !navigator.onLine)) {
      setToast({ message: "Las operaciones de deuda requieren conexión a internet y estado en línea.", type: "error" });
      return;
    }
    if (hasNoActiveAccounts) {
      setToast({ message: "No hay cuentas financieras activas disponibles para registrar la operación.", type: "error" });
      return;
    }
    if (isAccountMissing) {
      setToast({ message: "Seleccione una cuenta financiera válida.", type: "error" });
      return;
    }

    if (operationType !== "reversal" && !category) {
      setToast({ message: "Seleccione una categoría válida para registrar la operación.", type: "error" });
      return;
    }

    if (operationType === "prepayment" && numPrincipal >= currentPrincipal) {
      setToast({ message: "El prepago cubre o supera el principal actual; utilice la opción de Liquidar deuda.", type: "error" });
      return;
    }

    if (operationType === "payment") {
      if (isBankFixedSchedule && numExtraPrincipal > 0) {
        if ((simulationEffect != null) && !hasNewPaymentSchedule && (!effectiveSimulation || !effectiveSimulation.canPersist || !simulationAccepted)) {
          setToast({ message: "Calcula y confirma la simulación, o selecciona 'Banco todavía no entrega cronograma' antes de guardar el prepago.", type: "error" });
          return;
        }
        if (hasNewPaymentSchedule && prepaymentEffect === "pending_bank_schedule") {
          setToast({ message: "Adjunta el nuevo cronograma o selecciona 'Banco todavía no entrega cronograma', pero no ambos.", type: "error" });
          return;
        }
        if (!hasNewPaymentSchedule && prepaymentEffect !== "pending_bank_schedule" && simulationEffect == null) {
          setToast({ message: "Selecciona una opción de cronograma: calcula la simulación o selecciona 'Banco todavía no entrega cronograma'.", type: "error" });
          return;
        }
      }
      if (hasNewPaymentSchedule && scheduleInstallments.length === 0) {
        setToast({ message: "Debe ingresar al menos una cuota en el nuevo cronograma.", type: "error" });
        return;
      }
      if (hasNewPaymentSchedule && prepaymentEffect === "pending_bank_schedule") {
        setToast({ message: "No puedes adjuntar un cronograma y marcarlo como pendiente al mismo tiempo.", type: "error" });
        return;
      }
      if (hasNewPaymentSchedule) {
        const scheduleError = validateStrictScheduleDraft(scheduleInstallments, eventDate);
        if (scheduleError) {
          setToast({ message: scheduleError, type: "error" });
          return;
        }
      }
      const val = validateDebtPayment({
        cashAmount: numCash,
        principalAmount: numPrincipal,
        extraPrincipalAmount: numExtraPrincipal,
        currentPrincipal,
        breakdownComplete,
        interestPaid: numInterest,
        feesPaid: numFees,
        insurancePaid: numInsurance,
        otherCostPaid: numOtherCost,
      });
      if (!val.valid) {
        setToast({ message: val.error || "Datos de pago inválidos", type: "error" });
        return;
      }
      const formattedAlloc = allocations
        .filter((a) => {
          const n = Number(a.allocatedAmount);
          return Number.isFinite(n) && n > 0 && a.installmentId;
        })
        .map((a) => ({
          installmentId: a.installmentId,
          allocatedAmount: Number(a.allocatedAmount),
        }));
      const uniqueAllocMap = new Map<string, number>();
      for (const fa of formattedAlloc) {
        uniqueAllocMap.set(fa.installmentId, (uniqueAllocMap.get(fa.installmentId) || 0) + fa.allocatedAmount);
      }
      const dedupedAlloc = Array.from(uniqueAllocMap.entries()).map(([installmentId, allocatedAmount]) => ({
        installmentId,
        allocatedAmount,
      }));
      const allocVal = validateDebtAllocations(dedupedAlloc, currentScheduleInstallments, numCash, persistedAllocations, debtEvents);
      if (!allocVal.valid) {
        setToast({ message: allocVal.error || "Asignaciones de cuotas inválidas", type: "error" });
        return;
      }
    } else if (operationType === "installment_advance") {
      const selectedAllocations = allocations
        .filter((allocation) => Number(allocation.allocatedAmount) > 0 && allocation.installmentId)
        .map((allocation) => ({ installmentId: allocation.installmentId, allocatedAmount: Number(allocation.allocatedAmount) }));
      if (selectedAllocations.length === 0) {
        setToast({ message: "Selecciona al menos una cuota futura para adelantar.", type: "error" });
        return;
      }
      const selectedInstallments = selectedAllocations
        .map((allocation) => currentScheduleInstallments.find((installment) => installment.id === allocation.installmentId))
        .filter((installment): installment is DebtInstallment => installment != null)
        .sort((a, b) => a.installmentNumber - b.installmentNumber);
      const selectedNumbers = selectedInstallments.map((installment) => installment.installmentNumber);
      const isConsecutive = selectedNumbers.every((number, index) => index === 0 || number === selectedNumbers[index - 1] + 1);
      if (!isConsecutive || selectedInstallments.length !== selectedAllocations.length) {
        setToast({ message: "El adelanto debe cubrir cuotas futuras consecutivas del cronograma vigente.", type: "error" });
        return;
      }
      if (selectedInstallments.some((installment) => installment.dueDate <= eventDate || installment.expectedAmount == null || installment.expectedPrincipal == null || installment.expectedInterest == null)) {
        setToast({ message: "Solo puedes adelantar cuotas futuras con capital, interés y total definidos.", type: "error" });
        return;
      }
      const allocationValidation = validateDebtAllocations(selectedAllocations, eligibleAdvanceInstallments, numCash, persistedAllocations, debtEvents);
      if (!allocationValidation.valid) {
        setToast({ message: allocationValidation.error || "Asignaciones de adelanto inválidas.", type: "error" });
        return;
      }
      const allocationsTotal = selectedAllocations.reduce((sum, allocation) => sum + allocation.allocatedAmount, 0);
      if (Math.abs(allocationsTotal - numCash) > 0.01 || Math.abs(numExtraPrincipal) > 0.01) {
        setToast({ message: "El adelanto debe tener un único total de efectivo igual a la suma de sus allocations.", type: "error" });
        return;
      }
      const val = validateDebtPayment({
        cashAmount: numCash,
        principalAmount: numPrincipal,
        currentPrincipal,
        breakdownComplete,
        interestPaid: numInterest,
        feesPaid: numFees,
        insurancePaid: numInsurance,
        otherCostPaid: numOtherCost,
      });
      if (!val.valid) {
        setToast({ message: val.error || "Datos de adelanto inválidos", type: "error" });
        return;
      }
    } else if (operationType === "prepayment") {
      if (isBankFixedSchedule) {
        if ((simulationEffect != null) && !hasNewPrepaymentSchedule && (!effectiveSimulation || !effectiveSimulation.canPersist || !simulationAccepted)) {
          setToast({ message: "Calcula y confirma la simulación, o selecciona 'Banco todavía no entrega cronograma' antes de guardar el prepago.", type: "error" });
          return;
        }
        if (hasNewPrepaymentSchedule && prepaymentEffect === "pending_bank_schedule") {
          setToast({ message: "Adjunta el nuevo cronograma o selecciona 'Banco todavía no entrega cronograma', pero no ambos.", type: "error" });
          return;
        }
        if (!hasNewPrepaymentSchedule && prepaymentEffect !== "pending_bank_schedule" && simulationEffect == null) {
          setToast({ message: "Selecciona una opción de cronograma: calcula la simulación o selecciona 'Banco todavía no entrega cronograma'.", type: "error" });
          return;
        }
      }
      if (hasNewPrepaymentSchedule && scheduleInstallments.length === 0) {
        setToast({ message: "Debe ingresar al menos una cuota en el nuevo cronograma.", type: "error" });
        return;
      }
      if (hasNewPrepaymentSchedule) {
        const scheduleError = validateStrictScheduleDraft(scheduleInstallments, eventDate);
        if (scheduleError) {
          setToast({ message: scheduleError, type: "error" });
          return;
        }
      }
      const val = validateDebtPrepayment({
        cashAmount: numCash,
        principalAmount: numPrincipal,
        currentPrincipal,
        breakdownComplete,
        interestPaid: numInterest,
        feesPaid: numFees,
        insurancePaid: numInsurance,
        otherCostPaid: numOtherCost,
      });
      if (!val.valid) {
        setToast({ message: val.error || "Datos de prepago inválidos", type: "error" });
        return;
      }
    } else if (operationType === "payoff") {
      const val = validateDebtPayoff({
        cashAmount: numCash,
        currentPrincipal,
        breakdownComplete,
        interestPaid: numInterest,
        feesPaid: numFees,
        insurancePaid: numInsurance,
        otherCostPaid: numOtherCost,
      });
      if (!val.valid) {
        setToast({ message: val.error || "Datos de liquidación inválidos", type: "error" });
        return;
      }
    } else if (operationType === "reversal") {
      if (targetGeneratedSchedule && scheduleInstallments.length === 0) {
        setToast({ message: "Debe ingresar al menos una cuota en el cronograma restaurado.", type: "error" });
        return;
      }
      if (targetGeneratedSchedule) {
        const scheduleError = validateStrictScheduleDraft(scheduleInstallments, eventDate);
        if (scheduleError) {
          setToast({ message: scheduleError, type: "error" });
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      let operationResult: DebtOperationSaveResult | null = null;
      switch (operationType) {
        case "payment":
          operationResult = await recordDebtPayment({
            debtId: debt.id,
            eventId,
            movementId,
            eventDate,
            cashAmount: numCash,
            accountId,
            description: description.trim(),
            category,
            principalAmount: numPrincipal,
            interestPaid: numInterest,
            feesPaid: numFees,
            insurancePaid: numInsurance,
            otherCostPaid: numOtherCost,
            extraPrincipalAmount: numExtraPrincipal,
            prepaymentEffect: numExtraPrincipal > 0 ? prepaymentEffect : null,
            breakdownComplete,
            allocations: allocations
              .filter((a) => Number(a.allocatedAmount || 0) > 0)
              .map((a) => ({ installmentId: a.installmentId, allocatedAmount: Number(a.allocatedAmount) })),
            scheduleInstallments: scheduleForSave,
            scheduleNotes: scheduleForSave.length > 0 ? (effectiveSimulation ? "Simulación de Caja Familiar; estimación no contractual." : scheduleNotes || null) : null,
            scheduleSource: scheduleSourceForSave,
          });
          break;
        case "installment_advance":
          operationResult = await recordDebtInstallmentAdvance({
            debtId: debt.id,
            eventId,
            movementId,
            eventDate,
            cashAmount: numCash,
            accountId,
            description: description.trim(),
            category,
            principalAmount: numPrincipal,
            interestPaid: numInterest,
            feesPaid: numFees,
            insurancePaid: numInsurance,
            otherCostPaid: numOtherCost,
            breakdownComplete,
            allocations: allocations
              .filter((a) => Number(a.allocatedAmount || 0) > 0)
              .map((a) => ({ installmentId: a.installmentId, allocatedAmount: Number(a.allocatedAmount) })),
          });
          break;
        case "prepayment":
          operationResult = await recordDebtPrepayment({
            debtId: debt.id,
            eventId,
            movementId,
            eventDate,
            cashAmount: numCash,
            accountId,
            description: description.trim(),
            category,
            principalAmount: numPrincipal,
            interestPaid: numInterest,
            feesPaid: numFees,
            insurancePaid: numInsurance,
            otherCostPaid: numOtherCost,
            prepaymentEffect,
            breakdownComplete,
            scheduleInstallments: scheduleForSave,
            scheduleNotes: scheduleForSave.length > 0 ? (effectiveSimulation ? "Simulación de Caja Familiar; estimación no contractual." : scheduleNotes || null) : null,
            scheduleSource: scheduleSourceForSave,
          });
          break;
        case "payoff":
          operationResult = await recordDebtPayoff({
            debtId: debt.id,
            eventId,
            movementId,
            eventDate,
            cashAmount: numCash,
            accountId,
            description: description.trim(),
            category,
            interestPaid: numInterest,
            feesPaid: numFees,
            insurancePaid: numInsurance,
            otherCostPaid: numOtherCost,
            breakdownComplete,
          });
          break;
        case "reversal":
          if (!targetEventId) {
            setToast({ message: "ID de registro objetivo no especificado para reversión.", type: "error" });
            return;
          }
          operationResult = await reverseDebtEvent({
            debtId: debt.id,
            reversalEventId,
            targetEventId,
            eventDate,
            description: description.trim(),
            scheduleInstallments: targetGeneratedSchedule ? scheduleInstallments.map(toScheduleInstallmentInput) : [],
            scheduleNotes: scheduleNotes || null,
          });
          break;
        case "schedule_update":
          return;
        default:
          assertNever(operationType);
      }

      setToast({ message: "Operación de deuda registrada exitosamente.", type: "success" });
      try {
        if (operationResult) await onSaved(operationResult);
      } catch {
        setToast({ message: "Operación registrada exitosamente, pero falló la actualización de datos locales.", type: "error" });
      }
    } catch (err) {
      setToast({ message: translateDebtError(err), type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const titleMap = {
    payment: isFlexOpenEnded ? "Registrar pago" : "Registrar pago de cuota",
    prepayment: "Registrar prepago de principal",
    installment_advance: "Adelantar cuotas futuras",
    payoff: "Liquidar deuda",
    reversal: "Revertir registro",
    schedule_update: "Actualizar cronograma oficial",
  };

  if (operationType === "schedule_update") {
    return (
      <DebtScheduleUpdateForm
        debt={debt}
        debtEvents={debtEvents}
        installments={installments}
        scheduleVersions={scheduleVersions}
        canWriteDebt={canWriteDebt}
        onSaved={onSaved}
        onCancel={onCancel}
        setToast={setToast}
      />
    );
  }

  return (
    <section className="mx-auto max-w-3xl rounded-3xl bg-white p-6 shadow-xl lg:p-8">
      <div className="mb-6 flex items-center justify-between border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onCancel} className="rounded-full bg-slate-100 p-2 text-slate-700 hover:bg-slate-200">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{titleMap[operationType]}</h2>
            <p className="text-sm text-slate-500">{debt.name} — Acreedor: {debt.creditorName}</p>
          </div>
        </div>
      </div>

      {hasNoActiveAccounts && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 flex items-center gap-3 text-red-800">
          <AlertCircle className="h-6 w-6 shrink-0" />
          <p className="text-sm font-bold">No hay cuentas financieras activas disponibles. Debe activar o crear una cuenta para registrar operaciones financieras.</p>
        </div>
      )}

      {operationType === "reversal" && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-center gap-3 text-amber-900">
          <AlertCircle className="h-6 w-6 shrink-0 text-amber-700" />
          <p className="text-sm font-bold">Esto corrige cómo se aplicó este pago a la deuda. La salida de dinero original permanece registrada en la cuenta.</p>
        </div>
      )}

      {operationType === "installment_advance" && (
        <div className="mb-6 rounded-2xl border border-purple-200 bg-purple-50 p-4 text-purple-950">
          <p className="text-sm font-black tracking-wide">ADELANTO DE CUOTAS</p>
          <p className="mt-1 text-sm font-semibold">Cubre cuotas futuras. No equivale a un abono extraordinario al capital.</p>
        </div>
      )}

      {hasPendingBankSchedule && (operationType === "payment" || operationType === "prepayment" || operationType === "installment_advance") && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <p className="text-sm font-black tracking-wide">CRONOGRAMA DEL BANCO PENDIENTE</p>
          <p className="mt-1 text-sm font-semibold">No se muestran ni se asignan cuotas antiguas. Puedes registrar el pago o cargar el nuevo cronograma oficial cuando esté disponible.</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-slate-700">Fecha de la operación *</label>
            <input
              type="date"
              required
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>

          {bankPrepaymentScenario && (
            <div className="sm:col-span-2 rounded-2xl border-2 border-blue-200 bg-blue-50/70 p-4 space-y-4" aria-label="Opciones de prepago bancario">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-blue-800">CAMBIO DESPUÉS DEL PREPAGO</p>
                <h3 className="mt-1 text-lg font-black text-slate-900">¿Qué cronograma quieres registrar?</h3>
                <p className="mt-1 text-sm text-slate-700">El capital baja inmediatamente por la cuota y el abono extraordinario. El cronograma estimado nunca reemplaza al del banco.</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button type="button" aria-pressed={prepaymentEffect === "reduce_term" && !hasSelectedSchedule} onClick={() => chooseBankPrepaymentPath("reduce_term")} className={`rounded-2xl border p-4 text-left transition ${prepaymentEffect === "reduce_term" && !hasSelectedSchedule ? "border-blue-600 bg-white ring-2 ring-blue-200" : "border-blue-100 bg-white hover:border-blue-400"}`}>
                  <span className="block text-sm font-black text-blue-950">REDUCIR PLAZO</span>
                  <span className="mt-1 block text-xs text-slate-600">Mantener aproximadamente la cuota y terminar antes.</span>
                </button>
                <button type="button" aria-pressed={prepaymentEffect === "reduce_installment" && !hasSelectedSchedule} onClick={() => chooseBankPrepaymentPath("reduce_installment")} className={`rounded-2xl border p-4 text-left transition ${prepaymentEffect === "reduce_installment" && !hasSelectedSchedule ? "border-blue-600 bg-white ring-2 ring-blue-200" : "border-blue-100 bg-white hover:border-blue-400"}`}>
                  <span className="block text-sm font-black text-blue-950">REDUCIR CUOTA</span>
                  <span className="mt-1 block text-xs text-slate-600">Mantener las fechas futuras y recalcular el importe.</span>
                </button>
                <button type="button" aria-pressed={hasSelectedSchedule} onClick={() => chooseBankPrepaymentPath("official")} className={`rounded-2xl border p-4 text-left transition ${hasSelectedSchedule ? "border-emerald-600 bg-white ring-2 ring-emerald-200" : "border-blue-100 bg-white hover:border-emerald-400"}`}>
                  <span className="block text-sm font-black text-emerald-950">TENGO EL NUEVO CRONOGRAMA DEL BANCO</span>
                  <span className="mt-1 block text-xs text-slate-600">Cargar sus cuotas oficiales completas y conservar la versión anterior.</span>
                </button>
                <button type="button" aria-pressed={prepaymentEffect === "pending_bank_schedule"} onClick={() => chooseBankPrepaymentPath("pending_bank_schedule")} className={`rounded-2xl border p-4 text-left transition ${prepaymentEffect === "pending_bank_schedule" ? "border-amber-600 bg-white ring-2 ring-amber-200" : "border-blue-100 bg-white hover:border-amber-400"}`}>
                  <span className="block text-sm font-black text-amber-950">BANCO TODAVÍA NO ME ENTREGA</span>
                  <span className="mt-1 block text-xs text-slate-600">Guardar el principal y dejar pendiente el cronograma, sin inventar cuotas.</span>
                </button>
              </div>

              {simulationEffect != null && !hasSelectedSchedule && (
                <div className="rounded-2xl border border-indigo-200 bg-white p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-base font-black text-indigo-950">SIMULACIÓN DE CAJA FAMILIAR</h4>
                      <p className="text-xs font-black text-amber-800">ESTIMACIÓN — EL BANCO PUEDE ENTREGAR IMPORTES DIFERENTES</p>
                    </div>
                    <button type="button" onClick={calculatePrepaymentSimulation} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700">CALCULAR SIMULACIÓN</button>
                  </div>
                  {simulation && !simulationIsCurrent && <p className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-900">Los datos del prepago cambiaron. Vuelve a calcular la simulación antes de guardarla.</p>}
                  {effectiveSimulation && (
                    <>
                      <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-4">
                        <div><p className="text-xs text-slate-500">Principal antes</p><p className="font-black text-slate-900">{currencySymbol} {effectiveSimulation.principalBefore.toFixed(2)}</p></div>
                        <div><p className="text-xs text-slate-500">Principal después</p><p className="font-black text-emerald-700">{currencySymbol} {(effectiveSimulation.principalAfter ?? 0).toFixed(2)}</p></div>
                        <div><p className="text-xs text-slate-500">Cuotas restantes</p><p className="font-black text-slate-900">{effectiveSimulation.oldRemainingInstallments} → {effectiveSimulation.newRemainingInstallments}</p></div>
                        <div><p className="text-xs text-slate-500">Interés estimado</p><p className="font-black text-indigo-800">{effectiveSimulation.estimatedInterestSavings == null ? "Por confirmar" : `${currencySymbol} ${effectiveSimulation.newEstimatedInterest?.toFixed(2)} (ahorro ${effectiveSimulation.estimatedInterestSavings.toFixed(2)})`}</p></div>
                      </div>
                      <BankSchedulePreview
                        rows={effectiveSimulation.rows.map((row) => ({ contractualInstallmentNumber: row.contractualInstallmentNumber, dueDate: row.dueDate, principal: row.principal, interest: row.interest, insurance: row.insurance, fees: row.fees, total: row.total, reportedBalance: row.remainingPrincipalBalance }))}
                        compact
                        ariaLabel="Vista previa del cronograma estimado después del prepago"
                      />
                      {effectiveSimulation.warnings.length > 0 && <div className="space-y-1 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-900">{effectiveSimulation.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
                      <label className="flex items-start gap-2 text-sm font-bold text-slate-800">
                        <input type="checkbox" checked={simulationAccepted} onChange={(event) => setSimulationAccepted(event.target.checked)} disabled={!effectiveSimulation.canPersist} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600" />
                        Confirmo que esto es una estimación y deseo guardarla como cronograma no contractual.
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {operationType !== "reversal" && (
            <div>
              <label className="block text-sm font-semibold text-slate-700">Cuenta financiera *</label>
              <select
                required
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
              >
                {activeAccounts.length === 0 && <option value="">Sin cuentas activas</option>}
                {activeAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.reconciliationType})
                  </option>
                ))}
              </select>
            </div>
          )}

          {operationType !== "reversal" && (
            <>
              <div>
                <label className="block text-sm font-semibold text-slate-700">
                    {operationType === "payment" ? paymentWithExtraPrincipal ? "Cuota + abono al capital (un solo total) *" : "¿Cuánto pagaste en total? *" : operationType === "installment_advance" ? "Total de cuotas adelantadas *" : "Salida de dinero (Caja/Banco) *"}
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={cashAmount}
                   onChange={(e) => {
                     if (operationType === "installment_advance") return;
                     const val = e.target.value;
                    setCashAmount(val);
                    const newCash = Number(val || 0);
                    if (operationType === "payment" && isFlexOpenEnded && !isUserModified && nextPayment.interestKnown && nextPayment.interestAmount != null) {
                      const calcInt = nextPayment.interestAmount;
                      const newInt = Math.min(newCash, calcInt);
                      const newPrin = Math.min(currentPrincipal, Math.max(0, newCash - calcInt));
                      setInterestPaid(newInt.toString());
                      setPrincipalAmount(newPrin.toString());
                    }
                  }}
                   placeholder="0.00"
                   readOnly={operationType === "installment_advance"}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                />
                {operationType === "payment" && nextPayment.minimumPaymentKnown && nextPayment.minimumPaymentAmount != null && numCash > 0 && numCash < nextPayment.minimumPaymentAmount && (
                  <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900">
                    <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                    <span>Este pago está por debajo del mínimo estimado/contractual.</span>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700">Categoría</label>
                <div className="mt-1 w-full rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 font-semibold text-blue-900">
                  {category}
                </div>
                <p className="mt-1 text-xs text-slate-500">Vinculada automáticamente a esta deuda.</p>
              </div>
            </>
          )}

          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700">Descripción *</label>
            <input
              type="text"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>

          {operationType !== "reversal" && operationType !== "installment_advance" && numCash > 0 && (
            <div className="sm:col-span-2 rounded-2xl border border-blue-200 bg-blue-50/70 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-blue-900">DISTRIBUCIÓN SUGERIDA</p>
                <span className="rounded-full bg-blue-200/80 px-2.5 py-0.5 text-xs font-semibold text-blue-900">
                  {suggestion.certainty === "exact_contract"
                    ? "Cronograma contractual"
                    : suggestion.certainty === "exact_rate"
                    ? "Tasa contractual"
                    : suggestion.certainty === "tea_estimate"
                    ? "Estimación TEA"
                    : "Información insuficiente"}
                </span>
              </div>

              {suggestion.certainty !== "insufficient_info" ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-slate-500 font-medium">Interés</p>
                    <p className="font-bold text-slate-900">{currencySymbol} {suggestion.suggestedInterest.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 font-medium">A capital</p>
                    <p className="font-bold text-emerald-700">{currencySymbol} {suggestion.suggestedPrincipal.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 font-medium">Otros costos</p>
                    <p className="font-bold text-slate-900">{currencySymbol} {suggestion.suggestedOtherCosts.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 font-medium">Saldo después del pago</p>
                    <p className="font-bold text-blue-800">{currencySymbol} {suggestion.principalAfterPayment.toFixed(2)}</p>
                  </div>
                </div>
              ) : null}

              <p className="text-xs text-slate-600 italic">{suggestion.calculationExplanation}</p>

              {suggestion.warningMessage && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs font-bold text-amber-900 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-700 shrink-0" />
                  <span>{suggestion.warningMessage}</span>
                </div>
              )}

              {suggestion.certainty !== "insufficient_info" && (
                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={applySuggestion}
                    className="text-xs font-bold text-blue-700 hover:text-blue-900 underline"
                  >
                    {isUserModified ? "Restablecer sugerencia" : "Aplicar distribución sugerida"}
                  </button>
                </div>
              )}
            </div>
          )}

          {operationType !== "payoff" && operationType !== "reversal" && (
            <div>
              <label className="block text-sm font-semibold text-slate-700">Capital aplicado *</label>
              <input
                type="number"
                step="0.01"
                required
                value={principalAmount}
                onChange={(e) => {
                  setPrincipalAmount(e.target.value);
                  setIsUserModified(true);
                }}
                 placeholder="0.00"
                 readOnly={operationType === "installment_advance"}
                 className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
          )}

          {operationType === "payment" && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 sm:col-span-2">
              <label className="block text-sm font-bold text-indigo-950">Abono extraordinario al capital (opcional)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={extraPrincipalAmount}
                onChange={(e) => setExtraPrincipalAmount(e.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-slate-900"
              />
              <p className="mt-1 text-xs text-indigo-900">Se registra en la misma operación y movimiento que el pago de cuota.</p>
              {numExtraPrincipal > 0 && (
                <div className="mt-3">
                  <label className="block text-xs font-bold text-indigo-950">Efecto solicitado al banco</label>
                  <select value={prepaymentEffect} onChange={(e) => setPrepaymentEffect(e.target.value as PrepaymentEffect)} className="mt-1 w-full rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm text-slate-900">
                    <option value="reduce_term">Reducir plazo</option>
                    <option value="reduce_installment">Reducir cuota</option>
                    <option value="pending_bank_schedule">Banco todavía no entrega cronograma</option>
                    <option value="other">Otro</option>
                    <option value="unknown">Todavía no lo sé</option>
                  </select>
                </div>
              )}
            </div>
          )}

          {operationType === "payment" && isBankFixedSchedule && numExtraPrincipal > 0 && (
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50/30 p-4 sm:col-span-2 space-y-4">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="hasNewPaymentSchedule"
                  checked={hasNewPaymentSchedule}
                  onChange={(e) => setHasNewPaymentSchedule(e.target.checked)}
                  className="mt-1 h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <label htmlFor="hasNewPaymentSchedule" className="text-sm font-bold text-indigo-950">
                    El banco entregó el cronograma posterior a este abono
                  </label>
                  <p className="text-xs text-indigo-900">Se guardará junto con el mismo pago y movimiento. Si aún no existe, selecciona el estado pendiente sin inventar cuotas.</p>
                </div>
              </div>

              {hasNewPaymentSchedule && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Fuente</label>
                    <select value={newScheduleSource} onChange={(e) => setNewScheduleSource(e.target.value as "contractual" | "estimated")} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
                      <option value="contractual">Contractual / oficial del banco</option>
                      <option value="estimated">Estimado por Caja Familiar</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => setScheduleInstallments([...scheduleInstallments, { installmentNumber: scheduleInstallments.length + 1, dueDate: "", expectedAmount: "", expectedPrincipal: "", expectedInterest: "", expectedFees: "", expectedInsurance: "" }])}
                    className="rounded-xl bg-indigo-100 px-3 py-1.5 text-sm font-bold text-indigo-800 hover:bg-indigo-200"
                  >
                    Agregar cuota posterior al abono
                  </button>
                  {scheduleInstallments.map((s, idx) => (
                    <div key={idx} className="grid grid-cols-1 gap-2 rounded-xl bg-white p-3 sm:grid-cols-3 lg:grid-cols-7">
                      <span className="text-xs font-bold text-slate-600">Cuota #{idx + 1}</span>
                      <input aria-label={`Fecha nueva cuota ${idx + 1}`} type="date" value={s.dueDate} onChange={(e) => { const copy = [...scheduleInstallments]; copy[idx].dueDate = e.target.value; setScheduleInstallments(copy); }} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                      <input aria-label={`Total nueva cuota ${idx + 1}`} type="number" min="0" step="0.01" placeholder="Total" value={s.expectedAmount} onChange={(e) => { const copy = [...scheduleInstallments]; copy[idx].expectedAmount = e.target.value; setScheduleInstallments(copy); }} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                      <input aria-label={`Capital nueva cuota ${idx + 1}`} type="number" min="0" step="0.01" placeholder="Capital" value={s.expectedPrincipal} onChange={(e) => { const copy = [...scheduleInstallments]; copy[idx].expectedPrincipal = e.target.value; setScheduleInstallments(copy); }} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                      <input aria-label={`Interés nueva cuota ${idx + 1}`} type="number" min="0" step="0.01" placeholder="Interés" value={s.expectedInterest} onChange={(e) => { const copy = [...scheduleInstallments]; copy[idx].expectedInterest = e.target.value; setScheduleInstallments(copy); }} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                      <input aria-label={`Comisiones nueva cuota ${idx + 1}`} type="number" min="0" step="0.01" placeholder="Comisiones" value={s.expectedFees} onChange={(e) => { const copy = [...scheduleInstallments]; copy[idx].expectedFees = e.target.value; setScheduleInstallments(copy); }} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                      <div className="flex gap-2"><input aria-label={`Seguro nueva cuota ${idx + 1}`} type="number" min="0" step="0.01" placeholder="Seguro" value={s.expectedInsurance} onChange={(e) => { const copy = [...scheduleInstallments]; copy[idx].expectedInsurance = e.target.value; setScheduleInstallments(copy); }} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm" /><button type="button" onClick={() => setScheduleInstallments(scheduleInstallments.filter((_, i) => i !== idx))} className="text-xs font-bold text-red-600">Quitar</button></div>
                    </div>
                  ))}
                  <input type="text" value={scheduleNotes} onChange={(e) => setScheduleNotes(e.target.value)} placeholder="Notas del cronograma (opcional)" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                </div>
              )}
            </div>
          )}

          {operationType !== "reversal" && (
            <>
              <div>
                <label className="block text-sm font-semibold text-slate-700">Interés pagado</label>
                <input
                  type="number"
                  step="0.01"
                  value={interestPaid}
                   onChange={(e) => {
                     if (operationType === "installment_advance") return;
                     setInterestPaid(e.target.value);
                    setIsUserModified(true);
                  }}
                   className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                   readOnly={operationType === "installment_advance"}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700">Comisiones pagadas</label>
                <input
                  type="number"
                  step="0.01"
                  value={feesPaid}
                   onChange={(e) => { if (operationType !== "installment_advance") setFeesPaid(e.target.value); }}
                   className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                   readOnly={operationType === "installment_advance"}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700">Seguros pagados</label>
                <input
                  type="number"
                  step="0.01"
                  value={insurancePaid}
                   onChange={(e) => { if (operationType !== "installment_advance") setInsurancePaid(e.target.value); }}
                   className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                   readOnly={operationType === "installment_advance"}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700">Costo adicional / financiero</label>
                <input
                  type="number"
                  step="0.01"
                  value={otherCostPaid}
                   onChange={(e) => { if (operationType !== "installment_advance") setOtherCostPaid(e.target.value); }}
                   className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                   readOnly={operationType === "installment_advance"}
                />
              </div>
              <div className="flex items-center gap-2 sm:col-span-2 pt-2">
                <input
                  type="checkbox"
                  id="breakdownComplete"
                  checked={!breakdownComplete}
                  onChange={(e) => setBreakdownComplete(!e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="breakdownComplete" className="text-sm font-semibold text-slate-700">
                  No sé cómo se compone una parte del costo
                </label>
              </div>
            </>
          )}
        </div>

        {operationType !== "reversal" && (
          <div className="rounded-2xl bg-blue-50/80 p-4 border border-blue-100 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 text-center">
            <div>
              <p className="text-xs font-bold uppercase text-blue-600">Salida de dinero</p>
              <p className="text-lg font-black text-blue-900">S/ {summary.cashOutflow.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-emerald-600">Reducción de deuda</p>
              <p className="text-lg font-black text-emerald-900">S/ {summary.principalReduction.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-purple-600">Costo financiero</p>
              <p className="text-lg font-black text-purple-900">S/ {summary.economicExpense.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-indigo-600">Costo clasificado</p>
              <p className="text-lg font-black text-indigo-900">S/ {summary.knownCosts.toFixed(2)}</p>
            </div>
            {summary.unclassifiedDebtCost > 0.01 && (
              <div>
                <p className="text-xs font-bold uppercase text-amber-600">Costo sin clasificar</p>
                <p className="text-lg font-black text-amber-900">S/ {summary.unclassifiedDebtCost.toFixed(2)}</p>
              </div>
            )}
          </div>
        )}

        {(operationType === "payment" || operationType === "installment_advance") && currentScheduleInstallments.length > 0 && (
          <div className="rounded-2xl border border-slate-200 p-4">
            <h3 className="text-lg font-bold text-slate-800 mb-2">{operationType === "installment_advance" ? "Selecciona cuotas futuras a adelantar" : "Asignación a cuotas del cronograma vigente"}</h3>
            <p className="text-xs text-slate-500 mb-3">Versión #{currentSchedule?.versionNumber}</p>
            {operationType === "installment_advance" && eligibleAdvanceInstallments.length === 0 ? (
              <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">No hay cuotas futuras, consecutivas y pendientes disponibles para adelantar en el cronograma vigente.</p>
            ) : (
              <div className="space-y-3">
                {(operationType === "installment_advance" ? eligibleAdvanceInstallments : currentScheduleInstallments).map((inst) => {
                const allocatedBefore = allocatedAmountForInstallment(inst.id, persistedAllocations, debtEvents);
                const remaining = inst.expectedAmount == null || !Number.isFinite(inst.expectedAmount) ? null : Math.max(0, inst.expectedAmount - allocatedBefore);
                const isPaid = remaining !== null && remaining <= 0;
                const currentDraftAllocation = allocations.find((a) => a.installmentId === inst.id)?.allocatedAmount ?? "";
                return (
                  <div key={inst.id} className="flex items-center justify-between bg-slate-50 p-3 rounded-xl">
                    <div>
                      <p className="text-sm font-bold text-slate-800">Cuota contractual #{inst.contractualInstallmentNumber ?? inst.installmentNumber} (Vence: {inst.dueDate})</p>
                      <p className="text-xs text-slate-500">
                        {operationType === "installment_advance"
                          ? `Capital: S/ ${(inst.expectedPrincipal ?? 0).toFixed(2)} | Interés: S/ ${(inst.expectedInterest ?? 0).toFixed(2)} | Seguro: S/ ${(inst.expectedInsurance ?? 0).toFixed(2)} | Fees: S/ ${(inst.expectedFees ?? 0).toFixed(2)} | Total: S/ ${(inst.expectedAmount ?? 0).toFixed(2)}`
                          : `Aplicado: S/ ${allocatedBefore.toFixed(2)} ${remaining !== null ? `| Esperado: S/ ${inst.expectedAmount!.toFixed(2)} | Restante: S/ ${remaining.toFixed(2)}` : "| Monto esperado no especificado"}`}
                      </p>
                    </div>
                    {operationType === "installment_advance" ? (
                      <label className="flex items-center gap-2 text-sm font-bold text-purple-900">
                        <input
                          type="checkbox"
                          checked={Boolean(currentDraftAllocation)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setAdvanceAllocations([...allocations, { installmentId: inst.id, allocatedAmount: String(inst.expectedAmount ?? 0) }]);
                            } else {
                              setAdvanceAllocations(allocations.filter((allocation) => allocation.installmentId !== inst.id));
                            }
                          }}
                          className="h-5 w-5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                        />
                        Adelantar
                      </label>
                    ) : isPaid ? (
                      <span className="rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800">Pagada</span>
                    ) : (
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Monto asignado"
                        value={currentDraftAllocation}
                        onChange={(e) => {
                           const val = e.target.value;
                           const existing = allocations.find((a) => a.installmentId === inst.id);
                           if (existing) {
                             setAllocations(allocations.map((a) => (a.installmentId === inst.id ? { ...a, allocatedAmount: val } : a)));
                          } else if (val) {
                            setAllocations([...allocations, { installmentId: inst.id, allocatedAmount: val }]);
                          }
                        }}
                        className="w-36 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                      />
                    )}
                  </div>
                );
                })}
              </div>
            )}
          </div>
        )}

        {operationType === "prepayment" && (
          <div className="rounded-2xl border border-slate-200 p-4 space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-800">¿Qué efecto esperas del abono al capital?</label>
              <select value={prepaymentEffect} onChange={(e) => setPrepaymentEffect(e.target.value as PrepaymentEffect)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900">
                <option value="reduce_term">Reducir plazo</option>
                <option value="reduce_installment">Reducir cuota</option>
                <option value="pending_bank_schedule">Banco todavía no entrega cronograma</option>
                <option value="other">Otro</option>
                <option value="unknown">Todavía no lo sé</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="hasNewPrepaymentSchedule"
                checked={hasNewPrepaymentSchedule}
                onChange={(e) => setHasNewPrepaymentSchedule(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="hasNewPrepaymentSchedule" className="text-base font-bold text-slate-800">
                El acreedor me entregó un nuevo cronograma
              </label>
            </div>
            {hasNewPrepaymentSchedule && (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Fuente del nuevo cronograma</label>
                  <select value={newScheduleSource} onChange={(e) => setNewScheduleSource(e.target.value as "contractual" | "estimated")} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                    <option value="contractual">Contractual / oficial del banco</option>
                    <option value="estimated">Estimado por Caja Familiar</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setScheduleInstallments([
                      ...scheduleInstallments,
                       { installmentNumber: scheduleInstallments.length + 1, dueDate: localDateString(new Date()), expectedAmount: "", expectedPrincipal: "", expectedInterest: "", expectedFees: "", expectedInsurance: "" },
                    ])
                  }
                  className="rounded-xl bg-blue-50 px-3 py-1.5 text-sm font-bold text-blue-700 hover:bg-blue-100"
                >
                  Agregar cuota al nuevo cronograma
                </button>
                {scheduleInstallments.map((s, idx) => (
                  <div key={idx} className="grid grid-cols-1 gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-3 lg:grid-cols-7">
                    <div className="text-xs font-bold text-slate-600">Cuota #{idx + 1}</div>
                    <input aria-label={`Fecha nueva cuota ${idx + 1}`} type="date" value={s.dueDate} onChange={(e) => { const copy = [...scheduleInstallments]; copy[idx].dueDate = e.target.value; setScheduleInstallments(copy); }} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                    <input aria-label={`Total nueva cuota ${idx + 1}`} type="number" min="0" step="0.01" placeholder="Total" value={s.expectedAmount} onChange={(e) => { const copy = [...scheduleInstallments]; copy[idx].expectedAmount = e.target.value; setScheduleInstallments(copy); }} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                    <input aria-label={`Capital nueva cuota ${idx + 1}`} type="number" min="0" step="0.01" placeholder="Capital" value={s.expectedPrincipal} onChange={(e) => { const copy = [...scheduleInstallments]; copy[idx].expectedPrincipal = e.target.value; setScheduleInstallments(copy); }} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                    <input aria-label={`Interés nueva cuota ${idx + 1}`} type="number" min="0" step="0.01" placeholder="Interés" value={s.expectedInterest} onChange={(e) => { const copy = [...scheduleInstallments]; copy[idx].expectedInterest = e.target.value; setScheduleInstallments(copy); }} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                    <input aria-label={`Comisiones nueva cuota ${idx + 1}`} type="number" min="0" step="0.01" placeholder="Comisiones" value={s.expectedFees} onChange={(e) => { const copy = [...scheduleInstallments]; copy[idx].expectedFees = e.target.value; setScheduleInstallments(copy); }} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                    <div className="flex gap-2"><input aria-label={`Seguro nueva cuota ${idx + 1}`} type="number" min="0" step="0.01" placeholder="Seguro" value={s.expectedInsurance} onChange={(e) => { const copy = [...scheduleInstallments]; copy[idx].expectedInsurance = e.target.value; setScheduleInstallments(copy); }} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm" /><button type="button" onClick={() => setScheduleInstallments(scheduleInstallments.filter((_, i) => i !== idx))} className="text-sm font-bold text-red-600">Eliminar</button></div>
                  </div>
                ))}
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Notas del cronograma</label>
                  <input
                    type="text"
                    value={scheduleNotes}
                    onChange={(e) => setScheduleNotes(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2 text-sm"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {operationType === "reversal" && targetGeneratedSchedule && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-3">
            <h3 className="text-lg font-bold text-amber-900">Restauración de cronograma anterior (Requerida)</h3>
            <p className="text-xs text-slate-600">El evento que está revirtiendo generó un cronograma. Se carga la versión anterior y debe conservarse completa para restaurarla.</p>
            <button
              type="button"
              onClick={() =>
                setScheduleInstallments([
                  ...scheduleInstallments,
                  { installmentNumber: scheduleInstallments.length + 1, dueDate: "", expectedAmount: "", expectedPrincipal: "", expectedInterest: "", expectedFees: "", expectedInsurance: "" },
                ])
              }
              className="rounded-xl bg-amber-100 px-3 py-1.5 text-sm font-bold text-amber-900 hover:bg-amber-200"
            >
              Agregar cuota restaurada
            </button>
            {scheduleInstallments.map((s, idx) => (
              <div key={idx} className="grid grid-cols-1 gap-2 rounded-xl bg-white p-3 shadow-sm sm:grid-cols-3 lg:grid-cols-7">
                <div className="text-xs font-bold text-slate-600">Cuota #{idx + 1}</div>
                <input aria-label={`Fecha cuota restaurada ${idx + 1}`} type="date" value={s.dueDate} onChange={(e) => { const copy = [...scheduleInstallments]; copy[idx].dueDate = e.target.value; setScheduleInstallments(copy); }} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                <input aria-label={`Total cuota restaurada ${idx + 1}`} type="number" step="0.01" placeholder="Total" value={s.expectedAmount} onChange={(e) => { const copy = [...scheduleInstallments]; copy[idx].expectedAmount = e.target.value; setScheduleInstallments(copy); }} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                <input aria-label={`Capital cuota restaurada ${idx + 1}`} type="number" step="0.01" placeholder="Capital" value={s.expectedPrincipal} onChange={(e) => { const copy = [...scheduleInstallments]; copy[idx].expectedPrincipal = e.target.value; setScheduleInstallments(copy); }} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                <input aria-label={`Interés cuota restaurada ${idx + 1}`} type="number" step="0.01" placeholder="Interés" value={s.expectedInterest} onChange={(e) => { const copy = [...scheduleInstallments]; copy[idx].expectedInterest = e.target.value; setScheduleInstallments(copy); }} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                <input aria-label={`Comisiones cuota restaurada ${idx + 1}`} type="number" step="0.01" placeholder="Comisiones" value={s.expectedFees} onChange={(e) => { const copy = [...scheduleInstallments]; copy[idx].expectedFees = e.target.value; setScheduleInstallments(copy); }} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                <div className="flex justify-end">
                  <input aria-label={`Seguro cuota restaurada ${idx + 1}`} type="number" step="0.01" placeholder="Seguro" value={s.expectedInsurance} onChange={(e) => { const copy = [...scheduleInstallments]; copy[idx].expectedInsurance = e.target.value; setScheduleInstallments(copy); }} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                  <button
                    type="button"
                    onClick={() => setScheduleInstallments(scheduleInstallments.filter((_, i) => i !== idx))}
                    className="rounded-lg p-2 text-sm font-bold text-red-600 hover:bg-red-50"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-5 py-2.5 font-bold text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting || hasNoActiveAccounts}
            className="rounded-xl bg-blue-600 px-6 py-2.5 font-bold text-white shadow-md hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "Registrando..." : "Confirmar operación"}
          </button>
        </div>
      </form>
    </section>
  );
}
