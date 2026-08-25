import { useState } from "react";
import { ArrowLeft, Check, Plus, Trash2, Shield, CreditCard, Banknote, Building2, Home, PackageCheck, HelpCircle, AlertCircle } from "lucide-react";
import type { HouseholdMember, DebtKind, DebtInstallmentAmountMode, DebtPaymentFrequency, FinancialAccount, Category, DebtRepaymentStructure, DebtInterestCalculationMode, PeriodicRateBasis, BankLoanSubtype, AmortizationMethod, DebtInsuranceType, DebtInsurancePricingMode, ScheduleSource } from "../types";
import {
  isCreditCardDebtKind,
  DEBT_KIND_OPTIONS,
  getCurrencySymbol,
  formatReviewDate,
  buildDebtCreateInputPayload,
  validateDebtFinancialTerms,
} from "../utils/debtFormMode";
import { createDebt, createCreditCardDebt, createBankLoan } from "../services/dataRepository";
import { makeUuid } from "../utils/storage";
import { localDateString } from "../utils/date";
import { translateDebtError } from "../utils/debtViewModel";
import { effectivePeriodicRateFromTea } from "../utils/debtInterestEngine";
import { BANK_LOAN_SUBTYPE_OPTIONS, AMORTIZATION_METHOD_OPTIONS } from "../utils/bankCreditFormHelper";
import { parseContractualScheduleText } from "../utils/debtScheduleParser";
import { generateEstimatedDebtSchedule } from "../utils/debtEstimation";

interface DebtFormProps {
  currentMember?: HouseholdMember;
  accounts: FinancialAccount[];
  categories: Category[];
  canWriteDebt?: boolean;
  onSaved: () => void;
  onCancel: () => void;
  setToast: (toast: { message: string; type: "success" | "error" }) => void;
  initialStep?: "type_select" | "details" | "review";
}

export type OnboardingMode = "EXISTING_DEBT" | "NEW_DEBT";

const KIND_ICONS: Record<DebtKind, typeof Banknote> = {
  bank_loan: Building2,
  family_loan: Banknote,
  installment_purchase: PackageCheck,
  mortgage: Home,
  pledge: Shield,
  credit_card: CreditCard,
  other: HelpCircle,
};

export function DebtForm({ canWriteDebt = true, onSaved, onCancel, setToast, initialStep = "type_select" }: DebtFormProps) {
  const [debtId] = useState(() => makeUuid());
  const [debtKind, setDebtKind] = useState<DebtKind>("bank_loan");
  const [onboardingMode, setOnboardingMode] = useState<OnboardingMode>("EXISTING_DEBT");
  const [currencyCode, setCurrencyCode] = useState<"PEN" | "USD">("PEN");

  const [name, setName] = useState("");
  const [creditorName, setCreditorName] = useState("");
  const [originDate, setOriginDate] = useState("");
  const [trackingStartDate] = useState(localDateString(new Date()));
  const [originalPrincipal, setOriginalPrincipal] = useState("");
  const [openingPrincipalBalance, setOpeningPrincipalBalance] = useState("");

  const [plannedInstallmentCount, setPlannedInstallmentCount] = useState("");
  const [plannedInstallmentAmount, setPlannedInstallmentAmount] = useState("");
  const [installmentAmountMode, setInstallmentAmountMode] = useState<DebtInstallmentAmountMode>("fixed");
  const [paymentFrequency, setPaymentFrequency] = useState<DebtPaymentFrequency | null>(null);
  const [customFrequencyDays, setCustomFrequencyDays] = useState("");
  const [firstDueDate, setFirstDueDate] = useState("");
  const [teaPercent, setTeaPercent] = useState("");
  const [tceaPercent, setTceaPercent] = useState("");
  const [repaymentStructure, setRepaymentStructure] = useState<DebtRepaymentStructure>("unknown");
  const [interestCalculationMode, setInterestCalculationMode] = useState<DebtInterestCalculationMode>("unknown");
  const [periodicRatePercent, setPeriodicRatePercent] = useState("");
  const [periodicRateBasis, setPeriodicRateBasis] = useState<PeriodicRateBasis>("monthly");
  const [minimumPrincipalPayment, setMinimumPrincipalPayment] = useState("");
  const [monthlyDueDay, setMonthlyDueDay] = useState("");
  const [notes, setNotes] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Bank Loan V2 specific states
  const [loanSubtype, setLoanSubtype] = useState<BankLoanSubtype>("personal");
  const [contractNumber, setContractNumber] = useState("");
  const [amortizationMethod, setAmortizationMethod] = useState<AmortizationMethod>("fixed_installment");
  const [scheduleSource, setScheduleSource] = useState<ScheduleSource>("contractual");
  const [assetPrice, setAssetPrice] = useState("");
  const [downPaymentAmount, setDownPaymentAmount] = useState("");
  const [financedAmount, setFinancedAmount] = useState("");
  const [gracePeriodType, setGracePeriodType] = useState<"none" | "total" | "partial">("none");
  const [gracePeriodInstallments, setGracePeriodInstallments] = useState("");
  const [balloonPaymentAmount, setBalloonPaymentAmount] = useState("");
  const [tsvScheduleText, setTsvScheduleText] = useState("");
  const [scheduleParseError, setScheduleParseError] = useState<string | null>(null);
  const [scheduleEstimationError, setScheduleEstimationError] = useState<string | null>(null);
  const [scheduleEstimationWarning, setScheduleEstimationWarning] = useState<string | null>(null);
  const [estimatedTotals, setEstimatedTotals] = useState<{
    totalPrincipal: number;
    totalInterest: number;
    totalInsurance: number;
    totalFees: number;
    totalContractSum: number;
  } | null>(null);
  const [estimatedScheduleSignature, setEstimatedScheduleSignature] = useState<string | null>(null);

  const [insurances, setInsurances] = useState<Array<{
    insuranceType: DebtInsuranceType;
    label: string;
    pricingMode: DebtInsurancePricingMode;
    ratePercent: string;
    fixedAmount: string;
    provider: string;
    policyReference: string;
    isRequired: boolean;
    notes: string;
  }>>([]);
  const [newInsuranceType, setNewInsuranceType] = useState<DebtInsuranceType>("credit_life");
  const [mortgageInsuranceCoverage, setMortgageInsuranceCoverage] = useState<"bank" | "own_policy" | "endorsed_policy" | "">("");

  // Credit card specific fields
  const [creditLimit, setCreditLimit] = useState("");
  const [closingDay, setClosingDay] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [last4, setLast4] = useState("");

  // Pledge specific fields
  const [pledgeItemDescription, setPledgeItemDescription] = useState("");
  const [pledgeRedemptionDeadline, setPledgeRedemptionDeadline] = useState("");
  const [pledgeEstimatedValue, setPledgeEstimatedValue] = useState("");
  const [pledgePledgedValue] = useState("");

  const [installments, setInstallments] = useState<Array<{
    installmentNumber: number;
    dueDate: string;
    expectedAmount: string;
    expectedPrincipal: string;
    expectedInterest: string;
    expectedFees: string;
    expectedInsurance: string;
  }>>([]);

  const [collaterals, setCollaterals] = useState<Array<{
    description: string;
    pledgedValue: string;
    estimatedValue: string;
    redemptionDeadline: string;
  }>>([]);

  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<"type_select" | "details" | "review">(initialStep);

  const currencySymbol = getCurrencySymbol(currencyCode);
  const isCard = isCreditCardDebtKind(debtKind);
  const isPledge = debtKind === "pledge";

  const insuranceLabel = (type: DebtInsuranceType): string => {
    if (type === "credit_life") return "Seguro de desgravamen";
    if (type === "vehicle") return "Seguro vehicular";
    if (type === "property") return "Seguro inmueble";
    return "Otro seguro";
  };

  const estimatedInsuranceInputs = () => {
    let creditLifeRatePercent = 0;
    let percentOriginalPrincipalRatePercent = 0;
    let fixedInsuranceAmount = 0;
    let hasUnknownInsuranceCost = false;

    for (const insurance of insurances) {
      const rate = insurance.ratePercent ? Number(insurance.ratePercent) : 0;
      const fixedAmount = insurance.fixedAmount ? Number(insurance.fixedAmount) : 0;
      if (insurance.pricingMode === "percent_outstanding_balance" && insurance.insuranceType === "credit_life") {
        creditLifeRatePercent += Number.isFinite(rate) ? rate : 0;
      } else if (insurance.pricingMode === "percent_original_principal") {
        percentOriginalPrincipalRatePercent += Number.isFinite(rate) ? rate : 0;
      } else if (insurance.pricingMode === "fixed_amount") {
        fixedInsuranceAmount += Number.isFinite(fixedAmount) ? fixedAmount : 0;
      } else if (insurance.pricingMode === "contract_schedule" || insurance.pricingMode === "unknown") {
        hasUnknownInsuranceCost = true;
      }
    }

    return {
      creditLifeRatePercent,
      percentOriginalPrincipalRatePercent,
      fixedInsuranceAmount,
      hasUnknownInsuranceCost,
    };
  };

  const addInsurance = () => {
    setInsurances([
      ...insurances,
      {
        insuranceType: newInsuranceType,
        label: insuranceLabel(newInsuranceType),
        pricingMode: "unknown",
        ratePercent: "",
        fixedAmount: "",
        provider: "",
        policyReference: "",
        isRequired: true,
        notes: "",
      },
    ]);
  };

  const currentEstimationSignature = () => JSON.stringify({
    financedAmount: openingPrincipalBalance || financedAmount,
    teaPercent,
    plannedInstallmentCount,
    paymentFrequency,
    customFrequencyDays,
    firstDueDate,
    amortizationMethod,
    gracePeriodType,
    balloonPaymentAmount,
    insurances: insurances.map((insurance) => ({
      insuranceType: insurance.insuranceType,
      pricingMode: insurance.pricingMode,
      ratePercent: insurance.ratePercent,
      fixedAmount: insurance.fixedAmount,
    })),
  });

  const addInstallment = () => {
    const nextNo = installments.length + 1;
    setInstallments([
      ...installments,
      {
        installmentNumber: nextNo,
        dueDate: firstDueDate || localDateString(new Date()),
        expectedAmount: plannedInstallmentAmount,
        expectedPrincipal: "",
        expectedInterest: "",
        expectedFees: "",
        expectedInsurance: "",
      },
    ]);
  };

  const addCollateral = () => {
    setCollaterals([...collaterals, { description: "", pledgedValue: "", estimatedValue: "", redemptionDeadline: "" }]);
  };

  const resetBankScheduleDraft = () => {
    setInstallments([]);
    setPlannedInstallmentCount("");
    setPlannedInstallmentAmount("");
    setFirstDueDate("");
    setPaymentFrequency(null);
    setCustomFrequencyDays("");
    setScheduleParseError(null);
    setScheduleEstimationError(null);
    setScheduleEstimationWarning(null);
    setEstimatedTotals(null);
    setEstimatedScheduleSignature(null);
  };

  const validateDetails = (): boolean => {
    if (!canWriteDebt || (typeof navigator !== "undefined" && !navigator.onLine)) {
      setToast({ message: "Las operaciones de deuda requieren conexión a internet y estado habilitado.", type: "error" });
      return false;
    }

    if (isCard) {
      if (!name.trim() || !creditorName.trim() || !openingPrincipalBalance) {
        setToast({ message: "Complete los campos obligatorios (Nombre, Acreedor/Banco y Saldo).", type: "error" });
        return false;
      }
      if (last4.trim() && !/^[0-9]{4}$/.test(last4.trim())) {
        setToast({ message: "Los últimos 4 dígitos deben contener exactamente 4 números.", type: "error" });
        return false;
      }
      if (closingDay && (Number(closingDay) < 1 || Number(closingDay) > 31)) {
        setToast({ message: "El día de cierre debe estar entre 1 y 31.", type: "error" });
        return false;
      }
      if (dueDay && (Number(dueDay) < 1 || Number(dueDay) > 31)) {
        setToast({ message: "El día de pago habitual debe estar entre 1 y 31.", type: "error" });
        return false;
      }
      if (creditLimit && Number(creditLimit) <= 0) {
        setToast({ message: "El límite de crédito debe ser un monto positivo.", type: "error" });
        return false;
      }
    } else if (isPledge) {
      if (!creditorName.trim() || !openingPrincipalBalance || !pledgeItemDescription.trim()) {
        setToast({ message: "Complete los campos obligatorios (Lugar del empeño, Objeto empeñado y Monto adeudado).", type: "error" });
        return false;
      }
    } else {
      if (!name.trim() || !creditorName.trim() || !openingPrincipalBalance) {
        setToast({ message: "Complete los campos obligatorios (Nombre, Acreedor y Saldo adeudado).", type: "error" });
        return false;
      }
    }

    if (debtKind === "bank_loan") {
      const bankFinancedAmount = Number(financedAmount || openingPrincipalBalance || 0);
      if (!Number.isFinite(bankFinancedAmount) || bankFinancedAmount <= 0) {
        setToast({ message: "El importe financiado debe ser mayor a cero.", type: "error" });
        return false;
      }
      if (amortizationMethod === "unknown" && scheduleSource === "estimated") {
        setToast({ message: "Para estimar el cronograma debes seleccionar una modalidad de amortización soportada.", type: "error" });
        return false;
      }
      if (scheduleSource === "contractual" && installments.length === 0) {
        setToast({ message: "Carga e interpreta el cronograma contractual del banco antes de guardar.", type: "error" });
        return false;
      }
      if (scheduleSource === "estimated") {
        const missing: string[] = [];
        if (!teaPercent.trim() || !Number.isFinite(Number(teaPercent)) || Number(teaPercent) < 0) missing.push("TEA");
        if (!plannedInstallmentCount.trim() || !Number.isInteger(Number(plannedInstallmentCount)) || Number(plannedInstallmentCount) <= 0) missing.push("plazo");
        if (!paymentFrequency) missing.push("frecuencia de pago");
        if (!firstDueDate) missing.push("primera fecha de vencimiento");
        if (paymentFrequency === "custom" && (!customFrequencyDays || Number(customFrequencyDays) <= 0)) missing.push("días de frecuencia personalizada");
        if (amortizationMethod !== "fixed_installment" && amortizationMethod !== "constant_principal") missing.push("modalidad soportada (cuota fija o capital constante)");
        if (missing.length > 0) {
          setToast({ message: `Para generar la estimación falta: ${missing.join(", ")}.`, type: "error" });
          return false;
        }
        if (estimatedScheduleSignature !== currentEstimationSignature()) {
          setToast({ message: "Los datos de la estimación cambiaron. Genera nuevamente el cronograma antes de guardar.", type: "error" });
          return false;
        }
        if (installments.length === 0) {
          setToast({ message: "Genera el cronograma estimado antes de guardar.", type: "error" });
          return false;
        }
      }
      if (loanSubtype === "mortgage" && !mortgageInsuranceCoverage) {
        setToast({ message: "En un crédito hipotecario debes indicar si el desgravamen lo cubre el banco, una póliza propia o una póliza endosada.", type: "error" });
        return false;
      }
    }

    if (Number(openingPrincipalBalance) < 0) {
      setToast({ message: "El saldo adeudado no puede ser un monto negativo.", type: "error" });
      return false;
    }

    const termsValidation = validateDebtFinancialTerms({
      interestCalculationMode,
      periodicRatePercent,
      periodicRateBasis,
      teaPercent,
    });
    if (!termsValidation.valid) {
      setToast({ message: termsValidation.error || "Términos financieros no válidos.", type: "error" });
      return false;
    }

    return true;
  };

  const handleProceedToReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateDetails()) {
      setStep("review");
    }
  };

  const handleSubmit = async () => {
    if (!validateDetails()) return;

    setSubmitting(true);
    try {
      if (isCard) {
        await createCreditCardDebt({
          debtId,
          name: name.trim(),
          creditorName: creditorName.trim(),
          currencyCode,
          originDate: originDate || null,
          trackingStartDate: trackingStartDate || localDateString(new Date()),
          openingBalance: Number(openingPrincipalBalance),
          creditLimit: creditLimit ? Number(creditLimit) : null,
          closingDay: closingDay ? Number(closingDay) : null,
          dueDay: dueDay ? Number(dueDay) : null,
          last4: last4.trim() || null,
          teaPercent: teaPercent ? Number(teaPercent) : null,
          tceaPercent: tceaPercent ? Number(tceaPercent) : null,
          notes,
        });
        setToast({ message: "Tarjeta de crédito registrada exitosamente.", type: "success" });
      } else if (debtKind === "bank_loan") {
        const payload = buildDebtCreateInputPayload({
          debtId,
          debtKind,
          onboardingMode,
          currencyCode,
          name: name.trim() || `Crédito ${loanSubtype}`,
          creditorName: creditorName.trim(),
          openingPrincipalBalance: openingPrincipalBalance || financedAmount || originalPrincipal,
          originalPrincipal: originalPrincipal || financedAmount || openingPrincipalBalance,
          originDate,
          trackingStartDate,
          paymentFrequency,
          customFrequencyDays,
          firstDueDate,
          plannedInstallmentCount,
          plannedInstallmentAmount,
           installmentAmountMode,
           teaPercent,
          tceaPercent,
          notes,
          pledgeItemDescription,
          pledgeRedemptionDeadline,
          pledgeEstimatedValue,
          pledgePledgedValue,
          installments,
          extraCollaterals: collaterals,
           repaymentStructure: "fixed_schedule",
           interestCalculationMode: scheduleSource === "contractual" ? "contract_schedule" : "tea_estimate",
          periodicRatePercent,
          periodicRateBasis,
          minimumPrincipalPayment,
        });

        await createBankLoan({
          ...payload,
          loanSubtype,
          contractNumber: contractNumber || null,
          amortizationMethod,
          disbursedAmount: originalPrincipal ? Number(originalPrincipal) : null,
          assetPrice: assetPrice ? Number(assetPrice) : null,
          downPaymentAmount: downPaymentAmount ? Number(downPaymentAmount) : null,
          financedAmount: financedAmount ? Number(financedAmount) : null,
          termInstallments: plannedInstallmentCount ? Number(plannedInstallmentCount) : null,
          gracePeriodType,
          gracePeriodInstallments: gracePeriodInstallments ? Number(gracePeriodInstallments) : null,
          balloonPaymentAmount: balloonPaymentAmount ? Number(balloonPaymentAmount) : null,
           insurances: [
             ...insurances,
             ...(loanSubtype === "mortgage" && mortgageInsuranceCoverage && !insurances.some((insurance) => insurance.insuranceType === "credit_life")
               ? [{
                   insuranceType: "credit_life" as DebtInsuranceType,
                   label: mortgageInsuranceCoverage === "bank"
                     ? "Desgravamen cubierto por el banco"
                     : mortgageInsuranceCoverage === "own_policy"
                     ? "Desgravamen con póliza propia"
                     : "Desgravamen con póliza endosada",
                   pricingMode: "unknown" as DebtInsurancePricingMode,
                   ratePercent: null,
                   fixedAmount: null,
                   provider: null,
                   policyReference: null,
                   isRequired: true,
                   notes: "Forma de cobertura definida por el usuario; costo pendiente de confirmar.",
                 }]
               : []),
           ].map((ins) => ({
             insuranceType: ins.insuranceType,
             label: ins.label,
             pricingMode: ins.pricingMode,
             ratePercent: ins.ratePercent ? Number(ins.ratePercent) : null,
             fixedAmount: ins.fixedAmount ? Number(ins.fixedAmount) : null,
             provider: ins.provider || null,
             policyReference: ins.policyReference || null,
             isRequired: ins.isRequired,
             notes: ins.notes,
           })),
          scheduleSource,
        });
        setToast({ message: "Crédito bancario registrado exitosamente.", type: "success" });
      } else {
        const payload = buildDebtCreateInputPayload({
          debtId,
          debtKind,
          onboardingMode,
          currencyCode,
          name,
          creditorName,
          openingPrincipalBalance,
          originalPrincipal,
          originDate,
          trackingStartDate,
          paymentFrequency,
          customFrequencyDays,
          firstDueDate,
          plannedInstallmentCount,
          plannedInstallmentAmount,
          installmentAmountMode,
          teaPercent,
          tceaPercent,
          notes,
          pledgeItemDescription,
          pledgeRedemptionDeadline,
          pledgeEstimatedValue,
          pledgePledgedValue,
          installments,
          extraCollaterals: collaterals,
          repaymentStructure,
          interestCalculationMode,
          periodicRatePercent,
          periodicRateBasis,
          minimumPrincipalPayment,
        });

        await createDebt(payload);
        setToast({ message: "Deuda registrada exitosamente.", type: "success" });
      }
      onSaved();
    } catch (err) {
      setToast({ message: translateDebtError(err), type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const selectedKindObj = DEBT_KIND_OPTIONS.find((opt) => opt.value === debtKind);
  const bankReviewTotals = installments.reduce(
    (totals, installment) => ({
      principal: totals.principal + (Number(installment.expectedPrincipal) || 0),
      interest: totals.interest + (Number(installment.expectedInterest) || 0),
      insurance: totals.insurance + (Number(installment.expectedInsurance) || 0),
      fees: totals.fees + (Number(installment.expectedFees) || 0),
      total: totals.total + (Number(installment.expectedAmount) || 0),
    }),
    { principal: 0, interest: 0, insurance: 0, fees: 0, total: 0 }
  );

  return (
    <section className="mx-auto max-w-4xl rounded-3xl bg-white p-6 shadow-xl lg:p-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={step === "type_select" ? onCancel : () => setStep(step === "review" ? "details" : "type_select")}
            className="rounded-full bg-slate-100 p-2 text-slate-700 hover:bg-slate-200"
            aria-label="Volver"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">
              {step === "review"
                ? "Confirmar registro de deuda"
                : isCard
                ? "Registrar tarjeta de crédito"
                : isPledge
                ? "Registrar empeño"
                : "Registrar deuda"}
            </h2>
            <p className="text-sm text-slate-500">
              {step === "review"
                ? "Verifica los datos antes de guardar"
                : step === "type_select"
                ? "Paso 1: Elige el tipo de deuda y modo"
                : "Paso 2: Completa los datos principales"}
            </p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="hidden sm:flex items-center gap-2">
          <span className={`h-2.5 w-8 rounded-full ${step === "type_select" ? "bg-blue-600" : "bg-blue-200"}`} />
          <span className={`h-2.5 w-8 rounded-full ${step === "details" ? "bg-blue-600" : step === "review" ? "bg-blue-200" : "bg-slate-200"}`} />
          <span className={`h-2.5 w-8 rounded-full ${step === "review" ? "bg-blue-600" : "bg-slate-200"}`} />
        </div>
      </div>

      {/* STEP 1: Type Selection */}
      {step === "type_select" && (
        <div className="space-y-6">
          <div>
            <h3 className="text-xl font-bold text-slate-900 mb-1">¿Qué deuda quieres registrar?</h3>
            <p className="text-sm text-slate-500 mb-4">Selecciona el tipo de compromiso financiero.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {DEBT_KIND_OPTIONS.map((opt) => {
                const IconComponent = KIND_ICONS[opt.value];
                const isSelected = debtKind === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDebtKind(opt.value)}
                    className={`flex items-center gap-3.5 p-4 rounded-2xl border text-left transition-all ${
                      isSelected
                        ? "border-blue-600 bg-blue-50/60 ring-2 ring-blue-600/20 shadow-sm"
                        : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className={`p-2.5 rounded-xl ${isSelected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                      <IconComponent className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <p className={`font-bold text-base ${isSelected ? "text-blue-950" : "text-slate-800"}`}>{opt.label}</p>
                    </div>
                    {isSelected && <Check className="h-5 w-5 text-blue-600" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-slate-100 pt-6">
            <h3 className="text-xl font-bold text-slate-900 mb-1">¿Esta deuda ya existía antes de registrarla aquí?</h3>
            <p className="text-sm text-slate-500 mb-4">Elegir el origen adecuado ayuda a mantener un historial financiero claro.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setOnboardingMode("EXISTING_DEBT")}
                className={`p-4 rounded-2xl border text-left transition-all ${
                  onboardingMode === "EXISTING_DEBT"
                    ? "border-blue-600 bg-blue-50/60 ring-2 ring-blue-600/20 shadow-sm"
                    : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="font-bold text-slate-900">Sí, ya existía anteriormente</p>
                  {onboardingMode === "EXISTING_DEBT" && <Check className="h-5 w-5 text-blue-600" />}
                </div>
                <p className="text-xs text-slate-600">
                  Ideal para deudas anteriores o en curso. Registrar esta deuda no volverá a sumar el dinero que recibiste en tus ingresos pasados.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setOnboardingMode("NEW_DEBT")}
                className={`p-4 rounded-2xl border text-left transition-all ${
                  onboardingMode === "NEW_DEBT"
                    ? "border-blue-600 bg-blue-50/60 ring-2 ring-blue-600/20 shadow-sm"
                    : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="font-bold text-slate-900">No, es una deuda nueva que empieza ahora</p>
                  {onboardingMode === "NEW_DEBT" && <Check className="h-5 w-5 text-blue-600" />}
                </div>
                <p className="text-xs text-slate-600">
                  Registra el compromiso de pago desde hoy. En esta versión solo se registra la deuda (no se crea un ingreso de dinero automático).
                </p>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl px-5 py-2.5 font-bold text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => setStep("details")}
              className="rounded-xl bg-blue-600 px-6 py-2.5 font-bold text-white shadow-md hover:bg-blue-700"
            >
              Continuar
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Details Form */}
      {step === "details" && (
        <form onSubmit={handleProceedToReview} className="space-y-6">
          {/* Currency selection */}
          <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200">
            <label className="block text-sm font-bold text-slate-800 mb-1">Moneda de la deuda *</label>
            <select
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value as "PEN" | "USD")}
              className="w-full sm:w-72 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 font-medium focus:border-blue-600 focus:outline-none"
            >
              <option value="PEN">PEN — S/ Sol peruano</option>
              <option value="USD">USD — $ Dólar estadounidense</option>
            </select>
            <p className="mt-1.5 text-xs text-slate-500">
              Selecciona PEN o USD. No se realizan conversiones automáticas de tipo de cambio.
            </p>
          </div>

          {/* Form fields according to debtKind */}
          {isPledge ? (
            /* Dedicated Pledge Form */
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">¿Dónde hiciste el empeño? *</label>
                  <input
                    type="text"
                    required
                    value={creditorName}
                    onChange={(e) => setCreditorName(e.target.value)}
                    placeholder="Ej. Casa de Empeño / Caja Piura"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700">¿Qué dejaste en garantía? *</label>
                  <input
                    type="text"
                    required
                    value={pledgeItemDescription}
                    onChange={(e) => setPledgeItemDescription(e.target.value)}
                    placeholder="Ej. Laptop Lenovo i7 / Cadena de oro 18k"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">
                    {onboardingMode === "EXISTING_DEBT" ? "¿Cuánto debes actualmente? *" : "¿Cuánto te prestaron? *"}
                  </label>
                  <div className="relative mt-1 flex items-center rounded-xl border border-slate-300 focus-within:border-blue-600">
                    <span className="select-none pl-4 text-sm font-bold text-slate-500">{currencySymbol}</span>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={openingPrincipalBalance}
                      onChange={(e) => setOpeningPrincipalBalance(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-transparent px-3 py-2.5 text-slate-900 focus:outline-none"
                    />
                  </div>
                  {onboardingMode === "EXISTING_DEBT" && (
                    <p className="mt-1 text-xs text-slate-500">
                      Este será tu punto de partida. Registrar esta deuda no volverá a sumar el dinero que recibiste anteriormente.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700">¿Cuál es la fecha límite para recuperar el bien?</label>
                  <input
                    type="date"
                    value={pledgeRedemptionDeadline}
                    onChange={(e) => setPledgeRedemptionDeadline(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {onboardingMode === "EXISTING_DEBT" && (
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">¿Cuánto te prestaron originalmente? (Opcional)</label>
                    <div className="relative mt-1 flex items-center rounded-xl border border-slate-300 focus-within:border-blue-600">
                      <span className="select-none pl-4 text-sm font-bold text-slate-500">{currencySymbol}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={originalPrincipal}
                        onChange={(e) => setOriginalPrincipal(e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-transparent px-3 py-2.5 text-slate-900 focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-slate-700">¿Cuánto vale aproximadamente el bien? (Opcional)</label>
                  <div className="relative mt-1 flex items-center rounded-xl border border-slate-300 focus-within:border-blue-600">
                    <span className="select-none pl-4 text-sm font-bold text-slate-500">{currencySymbol}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={pledgeEstimatedValue}
                      onChange={(e) => setPledgeEstimatedValue(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-transparent px-3 py-2.5 text-slate-900 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">Nombre de la deuda (Opcional)</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`Ej. Empeño: ${pledgeItemDescription || "Laptop Lenovo"}`}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                />
                <p className="mt-1 text-xs text-slate-500">Si lo dejas en blanco, se generará automáticamente a partir del objeto empeñado.</p>
              </div>
            </div>
          ) : isCard ? (
            /* Credit Card Form */
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold text-slate-700">Nombre de la tarjeta *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Visa Black Interbank"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700">Acreedor / Banco *</label>
                <input
                  type="text"
                  required
                  value={creditorName}
                  onChange={(e) => setCreditorName(e.target.value)}
                  placeholder="Ej. Interbank"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700">
                  {onboardingMode === "EXISTING_DEBT" ? "¿Cuánto debes actualmente en la tarjeta? *" : "Saldo adeudado inicial *"}
                </label>
                <div className="relative mt-1 flex items-center rounded-xl border border-slate-300 focus-within:border-blue-600">
                  <span className="select-none pl-4 text-sm font-bold text-slate-500">{currencySymbol}</span>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={openingPrincipalBalance}
                    onChange={(e) => setOpeningPrincipalBalance(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-transparent px-3 py-2.5 text-slate-900 focus:outline-none"
                  />
                </div>
                {onboardingMode === "EXISTING_DEBT" && (
                  <p className="mt-1 text-xs text-slate-500">
                    Este será tu punto de partida. Registrar esta deuda no volverá a sumar el dinero que recibiste anteriormente.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700">Límite de crédito (Opcional)</label>
                <div className="relative mt-1 flex items-center rounded-xl border border-slate-300 focus-within:border-blue-600">
                  <span className="select-none pl-4 text-sm font-bold text-slate-500">{currencySymbol}</span>
                  <input
                    type="number"
                    step="0.01"
                    value={creditLimit}
                    onChange={(e) => setCreditLimit(e.target.value)}
                    placeholder="Ej. 5000.00"
                    className="w-full bg-transparent px-3 py-2.5 text-slate-900 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          ) : (
            /* General & Bank Loan Debt Form */
            <div className="space-y-6">
              {debtKind === "bank_loan" && (
                <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-5 space-y-4">
                  <h3 className="text-lg font-bold text-blue-950 flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-blue-600" /> Datos del Crédito Bancario / Financiero
                  </h3>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-bold text-slate-800 mb-1">Tipo de Crédito Bancario *</label>
                      <select
                        value={loanSubtype}
                        onChange={(e) => setLoanSubtype(e.target.value as BankLoanSubtype)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 font-medium focus:border-blue-600 focus:outline-none"
                      >
                        {BANK_LOAN_SUBTYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-slate-800 mb-1">Modalidad de Amortización *</label>
                      <select
                        value={amortizationMethod}
                        onChange={(e) => setAmortizationMethod(e.target.value as AmortizationMethod)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 font-medium focus:border-blue-600 focus:outline-none"
                      >
                        {AMORTIZATION_METHOD_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-bold text-slate-800 mb-1">Número / código de contrato (opcional)</label>
                      <input
                        type="text"
                        value={contractNumber}
                        onChange={(e) => setContractNumber(e.target.value)}
                        placeholder="Ej. 001-2026-ABC"
                        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                    {loanSubtype === "mortgage" && (
                      <div>
                        <label className="block text-sm font-bold text-slate-800 mb-1">¿Cómo se cubre el desgravamen? *</label>
                        <select
                          value={mortgageInsuranceCoverage}
                          onChange={(e) => setMortgageInsuranceCoverage(e.target.value as "bank" | "own_policy" | "endorsed_policy" | "")}
                          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                        >
                          <option value="">Seleccionar cobertura</option>
                          <option value="bank">Lo cubre el banco</option>
                          <option value="own_policy">Póliza propia</option>
                          <option value="endorsed_policy">Póliza endosada</option>
                        </select>
                        <p className="mt-1 text-xs text-slate-500">No asumimos proveedor ni costo sin datos del contrato.</p>
                      </div>
                    )}
                  </div>

                  {/* Subtype-specific fields */}
                  {loanSubtype === "vehicular" && (
                    <div className="rounded-xl bg-white p-4 border border-blue-100 grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-700">Valor del Vehículo (Precio de Lista)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={assetPrice}
                          onChange={(e) => setAssetPrice(e.target.value)}
                          placeholder="Ej. 50000"
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700">Cuota Inicial Pagada</label>
                        <input
                          type="number"
                          step="0.01"
                          value={downPaymentAmount}
                          onChange={(e) => setDownPaymentAmount(e.target.value)}
                          placeholder="Ej. 10000"
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700">Monto Financiado Banco</label>
                        <input
                          type="number"
                          step="0.01"
                          value={financedAmount}
                          onChange={(e) => {
                            setFinancedAmount(e.target.value);
                            setOpeningPrincipalBalance(e.target.value);
                          }}
                          placeholder="Ej. 40000"
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                  )}

                  {loanSubtype === "mortgage" && (
                    <div className="rounded-xl bg-white p-4 border border-blue-100 grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-700">Valor del Inmueble (Tasación)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={assetPrice}
                          onChange={(e) => setAssetPrice(e.target.value)}
                          placeholder="Ej. 300000"
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700">Cuota Inicial Contado</label>
                        <input
                          type="number"
                          step="0.01"
                          value={downPaymentAmount}
                          onChange={(e) => setDownPaymentAmount(e.target.value)}
                          placeholder="Ej. 60000"
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700">Monto Hipotecario Financiado</label>
                        <input
                          type="number"
                          step="0.01"
                          value={financedAmount}
                          onChange={(e) => {
                            setFinancedAmount(e.target.value);
                            setOpeningPrincipalBalance(e.target.value);
                          }}
                          placeholder="Ej. 240000"
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                  )}

                  {loanSubtype === "education" && (
                    <div className="rounded-xl bg-white p-4 border border-blue-100 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-bold text-slate-700">Periodo de Gracia</label>
                        <select
                          value={gracePeriodType}
                          onChange={(e) => setGracePeriodType(e.target.value as "none" | "total" | "partial")}
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white"
                        >
                          <option value="none">Sin periodo de gracia</option>
                          <option value="partial">Gracia parcial (Solo interés/seguro)</option>
                          <option value="total">Gracia total (Sin pago durante estudios)</option>
                        </select>
                      </div>
                      {gracePeriodType !== "none" && (
                        <div>
                          <label className="block text-xs font-bold text-slate-700">Meses de Gracia</label>
                          <input
                            type="number"
                            value={gracePeriodInstallments}
                            onChange={(e) => setGracePeriodInstallments(e.target.value)}
                            placeholder="Ej. 12"
                            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {loanSubtype !== "vehicular" && loanSubtype !== "mortgage" && (
                    <div className="rounded-xl bg-white p-4 border border-blue-100">
                      <label className="block text-xs font-bold text-slate-700">Importe financiado del crédito</label>
                      <input
                        type="number"
                        step="0.01"
                        value={financedAmount}
                        onChange={(e) => {
                          setFinancedAmount(e.target.value);
                          setOpeningPrincipalBalance(e.target.value);
                        }}
                        placeholder="Ej. 10000"
                        className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                  )}

                  {/* Schedule Source Selection */}
                  <div className="space-y-3 pt-2">
                    <label className="block text-sm font-bold text-slate-800">Fuente del Cronograma *</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (scheduleSource !== "contractual") resetBankScheduleDraft();
                          setScheduleSource("contractual");
                          setInterestCalculationMode("contract_schedule");
                          setScheduleEstimationError(null);
                          setScheduleEstimationWarning(null);
                          setEstimatedTotals(null);
                        }}
                        className={`p-3.5 rounded-xl border text-left transition ${
                          scheduleSource === "contractual"
                            ? "border-blue-600 bg-white ring-2 ring-blue-600/20 shadow-sm"
                            : "border-slate-200 bg-white/70 hover:bg-white"
                        }`}
                      >
                        <p className="font-bold text-sm text-slate-900 mb-0.5">A) Tengo el cronograma del banco</p>
                        <p className="text-xs text-slate-500">Pega las filas tabuladas del cronograma oficial del banco.</p>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (scheduleSource !== "estimated") resetBankScheduleDraft();
                          setScheduleSource("estimated");
                          setInterestCalculationMode("tea_estimate");
                          setRepaymentStructure("fixed_schedule");
                        }}
                        className={`p-3.5 rounded-xl border text-left transition ${
                          scheduleSource === "estimated"
                            ? "border-blue-600 bg-white ring-2 ring-blue-600/20 shadow-sm"
                            : "border-slate-200 bg-white/70 hover:bg-white"
                        }`}
                      >
                        <p className="font-bold text-sm text-slate-900 mb-0.5">B) No tengo cronograma; estimar cuota</p>
                        <p className="text-xs text-slate-500">Caja Familiar calculará las cuotas estimadas por Sistema Francés o Capital Constante.</p>
                      </button>
                    </div>
                  </div>

                  {/* Option A: TSV Contractual Parser */}
                  {scheduleSource === "contractual" && (
                    <div className="rounded-xl bg-white p-4 border border-slate-200 space-y-3">
                      <label className="block text-xs font-bold text-slate-800">
                        Pegar filas del cronograma (Cuota, Fecha, Total, Capital, Interés, Seguro, Gastos)
                      </label>
                      <textarea
                        rows={4}
                        value={tsvScheduleText}
                        onChange={(e) => setTsvScheduleText(e.target.value)}
                        placeholder={`Ejemplo:\n1\t2026-09-15\t850.00\t500.00\t250.00\t80.00\t20.00\n2\t2026-10-15\t850.00\t510.00\t240.00\t80.00\t20.00`}
                        className="w-full rounded-xl border border-slate-300 p-3 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                      />
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => {
                            const res = parseContractualScheduleText(tsvScheduleText);
                            if (!res.valid) {
                              setScheduleParseError(res.errors.join("; "));
                            } else {
                              setScheduleParseError(null);
                              setInstallments(
                                res.rows.map((r) => ({
                                  installmentNumber: r.installmentNumber,
                                  dueDate: r.dueDate,
                                  expectedAmount: r.expectedAmount.toString(),
                                  expectedPrincipal: r.expectedPrincipal.toString(),
                                  expectedInterest: r.expectedInterest.toString(),
                                  expectedInsurance: r.expectedInsurance.toString(),
                                  expectedFees: r.expectedFees.toString(),
                                }))
                              );
                              setInstallmentAmountMode(res.installmentAmountMode);
                              setPaymentFrequency(res.detectedFrequency);
                              if (res.rows.length > 0) {
                                setFirstDueDate(res.rows[0].dueDate);
                                setPlannedInstallmentCount(res.rows.length.toString());
                                setPlannedInstallmentAmount(res.rows[0].expectedAmount.toString());
                              }
                            }
                          }}
                          className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 shadow"
                        >
                          Interpretar Cronograma
                        </button>
                        {installments.length > 0 && (
                          <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200">
                            {installments.length} cuotas contractuales cargadas ({installmentAmountMode === "fixed" ? "Cuota fija" : "Cuota variable"})
                          </span>
                        )}
                      </div>
                      {scheduleParseError && (
                        <div className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-800 border border-red-200">
                          {scheduleParseError}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Option B: Estimated Schedule Generator */}
                  {scheduleSource === "estimated" && (
                    <div className="rounded-xl bg-white p-4 border border-slate-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => {
                            try {
                              setScheduleEstimationError(null);
                              setScheduleEstimationWarning(null);
                              const finAmt = Number(openingPrincipalBalance || financedAmount || 0);
                              const teaNum = teaPercent.trim() ? Number(teaPercent) : Number.NaN;
                              const termsNum = plannedInstallmentCount.trim() ? Number(plannedInstallmentCount) : Number.NaN;
                              const insuranceInputs = estimatedInsuranceInputs();

                              if (!Number.isFinite(finAmt) || finAmt <= 0) throw new Error("El monto financiado debe ser mayor a cero.");
                              if (!Number.isFinite(teaNum) || teaNum < 0) throw new Error("La TEA debe ser un porcentaje válido y explícito.");
                              if (!Number.isInteger(termsNum) || termsNum <= 0) throw new Error("El plazo debe ser un número de cuotas mayor a cero.");
                              if (!paymentFrequency) throw new Error("La frecuencia de pago es obligatoria para estimar el cronograma.");
                              if (!firstDueDate) throw new Error("La primera fecha de vencimiento es obligatoria para estimar el cronograma.");
                              if (paymentFrequency === "custom" && (!customFrequencyDays || Number(customFrequencyDays) <= 0)) {
                                throw new Error("La frecuencia personalizada requiere indicar los días entre pagos.");
                              }

                              const estimationSignature = currentEstimationSignature();
                              const est = generateEstimatedDebtSchedule({
                                financedAmount: finAmt,
                                teaPercent: teaNum,
                                termInstallments: termsNum,
                                paymentFrequency,
                                customFrequencyDays: customFrequencyDays ? Number(customFrequencyDays) : null,
                                firstDueDate,
                                amortizationMethod,
                                gracePeriodType,
                                balloonPaymentAmount: balloonPaymentAmount ? Number(balloonPaymentAmount) : 0,
                                creditLifeRatePercent: insuranceInputs.creditLifeRatePercent,
                                percentOriginalPrincipalRatePercent: insuranceInputs.percentOriginalPrincipalRatePercent,
                                fixedInsuranceAmount: insuranceInputs.fixedInsuranceAmount,
                              });

                              setInstallments(
                                est.rows.map((r) => ({
                                  installmentNumber: r.installmentNumber,
                                  dueDate: r.dueDate,
                                  expectedAmount: r.expectedAmount.toString(),
                                  expectedPrincipal: r.expectedPrincipal.toString(),
                                  expectedInterest: r.expectedInterest.toString(),
                                  expectedInsurance: r.expectedInsurance.toString(),
                                  expectedFees: r.expectedFees.toString(),
                                }))
                              );
                              setInstallmentAmountMode(est.installmentAmountMode);
                              setPlannedInstallmentAmount(est.financialInstallmentAmount.toString());
                              setPlannedInstallmentCount(est.rows.length.toString());
                              setEstimatedTotals({
                                totalPrincipal: est.totalPrincipal,
                                totalInterest: est.totalInterest,
                                totalInsurance: est.totalInsurance,
                                totalFees: est.totalFees,
                                totalContractSum: est.totalContractSum,
                              });
                              setEstimatedScheduleSignature(estimationSignature);
                              if (insuranceInputs.hasUnknownInsuranceCost) {
                                setScheduleEstimationWarning("La cuota estimada no incluye el costo de seguro que el contrato no permite estimar.");
                              }
                            } catch (err: any) {
                              setEstimatedTotals(null);
                              setEstimatedScheduleSignature(null);
                              setScheduleEstimationError(err.message || "Error al estimar cronograma");
                            }
                          }}
                          className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 shadow"
                        >
                          Generar Cronograma Estimado (Caja Familiar)
                        </button>
                        {installments.length > 0 && (
                          <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-3 py-1 rounded-lg border border-indigo-200">
                            {installments.length} cuotas estimadas generadas (Sistema Francés/Constante)
                          </span>
                        )}
                      </div>
                      {scheduleEstimationError && (
                        <div className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-900 border border-amber-200 flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-amber-700 shrink-0" />
                          <span>{scheduleEstimationError}</span>
                        </div>
                      )}
                      {scheduleEstimationWarning && (
                        <div className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-900 border border-amber-200 flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-amber-700 shrink-0" />
                          <span>{scheduleEstimationWarning}</span>
                        </div>
                      )}
                      {estimatedTotals && (
                        <div className="grid grid-cols-2 gap-3 rounded-xl bg-indigo-50 p-3 text-xs text-indigo-950 sm:grid-cols-5">
                          <span>Capital: <strong>{currencySymbol} {estimatedTotals.totalPrincipal.toFixed(2)}</strong></span>
                          <span>Intereses: <strong>{currencySymbol} {estimatedTotals.totalInterest.toFixed(2)}</strong></span>
                          <span>Seguros: <strong>{currencySymbol} {estimatedTotals.totalInsurance.toFixed(2)}</strong></span>
                          <span>Fees: <strong>{currencySymbol} {estimatedTotals.totalFees.toFixed(2)}</strong></span>
                          <span>Total: <strong>{currencySymbol} {estimatedTotals.totalContractSum.toFixed(2)}</strong></span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">Seguros del crédito</h4>
                        <p className="text-xs text-slate-500">Registra solo lo que indique el contrato. Un crédito personal puede quedar sin desgravamen.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={newInsuranceType}
                          onChange={(e) => setNewInsuranceType(e.target.value as DebtInsuranceType)}
                          className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-800"
                        >
                          <option value="credit_life">Seguro de desgravamen</option>
                          <option value="vehicle">Seguro vehicular</option>
                          <option value="property">Seguro inmueble</option>
                          <option value="other">Otro</option>
                        </select>
                        <button type="button" onClick={addInsurance} className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100">
                          Agregar seguro
                        </button>
                      </div>
                    </div>
                    {insurances.length === 0 ? (
                      <p className="text-xs italic text-slate-500">No se han definido seguros del crédito.</p>
                    ) : (
                      <div className="space-y-3">
                        {insurances.map((insurance, index) => (
                          <div key={index} className="grid grid-cols-1 gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-4">
                            <div>
                              <label className="block text-[11px] font-bold text-slate-600">Tipo</label>
                              <select
                                value={insurance.insuranceType}
                                onChange={(e) => {
                                  const copy = [...insurances];
                                  copy[index] = { ...copy[index], insuranceType: e.target.value as DebtInsuranceType, label: insuranceLabel(e.target.value as DebtInsuranceType) };
                                  setInsurances(copy);
                                }}
                                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                              >
                                <option value="credit_life">Seguro de desgravamen</option>
                                <option value="vehicle">Seguro vehicular</option>
                                <option value="property">Seguro inmueble</option>
                                <option value="other">Otro</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[11px] font-bold text-slate-600">Modo de precio</label>
                              <select
                                value={insurance.pricingMode}
                                onChange={(e) => {
                                  const copy = [...insurances];
                                  copy[index] = { ...copy[index], pricingMode: e.target.value as DebtInsurancePricingMode };
                                  setInsurances(copy);
                                }}
                                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                              >
                                <option value="fixed_amount">Monto fijo por cuota</option>
                                <option value="percent_outstanding_balance">% saldo pendiente</option>
                                <option value="percent_original_principal">% principal original</option>
                                <option value="contract_schedule">Según cronograma contractual</option>
                                <option value="unknown">Desconocido</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[11px] font-bold text-slate-600">Tasa %</label>
                              <input type="number" step="0.0001" value={insurance.ratePercent} onChange={(e) => { const copy = [...insurances]; copy[index] = { ...copy[index], ratePercent: e.target.value }; setInsurances(copy); }} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
                            </div>
                            <div>
                              <label className="block text-[11px] font-bold text-slate-600">Monto fijo</label>
                              <input type="number" step="0.01" value={insurance.fixedAmount} onChange={(e) => { const copy = [...insurances]; copy[index] = { ...copy[index], fixedAmount: e.target.value }; setInsurances(copy); }} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
                            </div>
                            <div>
                              <label className="block text-[11px] font-bold text-slate-600">Proveedor</label>
                              <input type="text" value={insurance.provider} onChange={(e) => { const copy = [...insurances]; copy[index] = { ...copy[index], provider: e.target.value }; setInsurances(copy); }} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
                            </div>
                            <div>
                              <label className="block text-[11px] font-bold text-slate-600">Referencia de póliza</label>
                              <input type="text" value={insurance.policyReference} onChange={(e) => { const copy = [...insurances]; copy[index] = { ...copy[index], policyReference: e.target.value }; setInsurances(copy); }} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
                            </div>
                            <label className="flex items-center gap-2 pt-5 text-xs font-semibold text-slate-700">
                              <input type="checkbox" checked={insurance.isRequired} onChange={(e) => { const copy = [...insurances]; copy[index] = { ...copy[index], isRequired: e.target.checked }; setInsurances(copy); }} />
                              Seguro requerido
                            </label>
                            <div className="flex items-end justify-end gap-2">
                              <input type="text" placeholder="Notas" value={insurance.notes} onChange={(e) => { const copy = [...insurances]; copy[index] = { ...copy[index], notes: e.target.value }; setInsurances(copy); }} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
                              <button type="button" onClick={() => setInsurances(insurances.filter((_, itemIndex) => itemIndex !== index))} className="rounded-lg p-2 text-red-600 hover:bg-red-50" aria-label="Eliminar seguro"><Trash2 className="h-4 w-4" /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Nombre de la deuda *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={debtKind === "bank_loan" ? `Ej. Crédito ${loanSubtype} BCP` : "Ej. Préstamo personal BCP"}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Acreedor / Entidad *</label>
                  <input
                    type="text"
                    required
                    value={creditorName}
                    onChange={(e) => setCreditorName(e.target.value)}
                    placeholder="Ej. Banco de Crédito del Perú"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">
                    {onboardingMode === "EXISTING_DEBT" ? "¿Cuánto debes actualmente? *" : "¿Cuánto te prestaron? *"}
                  </label>
                  <div className="relative mt-1 flex items-center rounded-xl border border-slate-300 focus-within:border-blue-600">
                    <span className="select-none pl-4 text-sm font-bold text-slate-500">{currencySymbol}</span>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={openingPrincipalBalance}
                      onChange={(e) => setOpeningPrincipalBalance(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-transparent px-3 py-2.5 text-slate-900 focus:outline-none"
                    />
                  </div>
                  {onboardingMode === "EXISTING_DEBT" && (
                    <p className="mt-1 text-xs text-slate-500">
                      Este será tu punto de partida. Registrar esta deuda no volverá a sumar el dinero que recibiste anteriormente.
                    </p>
                  )}
                </div>

                {onboardingMode === "EXISTING_DEBT" && (
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Monto que recibiste originalmente (Opcional)</label>
                    <div className="relative mt-1 flex items-center rounded-xl border border-slate-300 focus-within:border-blue-600">
                      <span className="select-none pl-4 text-sm font-bold text-slate-500">{currencySymbol}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={originalPrincipal}
                        onChange={(e) => setOriginalPrincipal(e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-transparent px-3 py-2.5 text-slate-900 focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">¿Cuándo comenzó la deuda? (Opcional)</label>
                <input
                  type="date"
                  value={originDate}
                  onChange={(e) => setOriginDate(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>
          )}

          {!isCard && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1">¿Cómo funciona el pago de esta deuda / empeño?</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setRepaymentStructure("open_ended")}
                    className={`p-3 rounded-xl border text-left text-xs font-semibold transition ${
                      repaymentStructure === "open_ended"
                        ? "border-blue-600 bg-blue-50 text-blue-900 ring-2 ring-blue-600/20"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <p className="font-bold text-sm mb-0.5">Sin plazo fijo</p>
                    <p className="text-[11px] text-slate-500 font-normal">Pago intereses periódicamente y puedo amortizar capital cuando quiera.</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRepaymentStructure("fixed_schedule")}
                    className={`p-3 rounded-xl border text-left text-xs font-semibold transition ${
                      repaymentStructure === "fixed_schedule"
                        ? "border-blue-600 bg-blue-50 text-blue-900 ring-2 ring-blue-600/20"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <p className="font-bold text-sm mb-0.5">Con cuotas / fecha final</p>
                    <p className="text-[11px] text-slate-500 font-normal">Tengo un cronograma o cuotas fijas programadas.</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRepaymentStructure("unknown")}
                    className={`p-3 rounded-xl border text-left text-xs font-semibold transition ${
                      repaymentStructure === "unknown"
                        ? "border-blue-600 bg-blue-50 text-blue-900 ring-2 ring-blue-600/20"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <p className="font-bold text-sm mb-0.5">No estoy seguro</p>
                    <p className="text-[11px] text-slate-500 font-normal">Registraré los detalles más adelante.</p>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1">Frecuencia de pago</label>
                <select
                  value={paymentFrequency ?? ""}
                  onChange={(e) => setPaymentFrequency((e.target.value || null) as DebtPaymentFrequency | null)}
                  className="w-full sm:w-72 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 font-medium focus:border-blue-600 focus:outline-none"
                >
                  <option value="">Otra / No especificada</option>
                  <option value="monthly">Mensual</option>
                  <option value="biweekly">Quincenal</option>
                  <option value="weekly">Semanal</option>
                  <option value="custom">Personalizada</option>
                </select>
              </div>

              {paymentFrequency === "monthly" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl bg-white p-4 border border-slate-200">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Día de pago mensual (1–31)</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={monthlyDueDay}
                      onChange={(e) => {
                        const val = e.target.value;
                        setMonthlyDueDay(val);
                        setPaymentFrequency("monthly");
                        const dayNum = parseInt(val, 10);
                        if (dayNum >= 1 && dayNum <= 31) {
                          const now = new Date();
                          let y = now.getFullYear();
                          let m = now.getMonth() + 1;
                          if (dayNum < now.getDate()) {
                            m += 1;
                            if (m > 12) { m = 1; y += 1; }
                          }
                          const maxD = new Date(y, m, 0).getDate();
                          const d = Math.min(dayNum, maxD);
                          setFirstDueDate(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
                        }
                      }}
                      placeholder="Ej. 15"
                      className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Próximo vencimiento</label>
                    <input
                      type="date"
                      value={firstDueDate}
                      onChange={(e) => setFirstDueDate(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1">¿Cómo se calculan los intereses?</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <button
                    type="button"
                    onClick={() => setInterestCalculationMode("contract_periodic_rate")}
                    className={`p-3 rounded-xl border text-left text-xs font-semibold transition ${
                      interestCalculationMode === "contract_periodic_rate"
                        ? "border-blue-600 bg-blue-50 text-blue-900 ring-2 ring-blue-600/20"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <p className="font-bold text-sm mb-0.5">Tasa por período</p>
                    <p className="text-[11px] text-slate-500 font-normal">Ej. 4% mensual sobre saldo.</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setInterestCalculationMode("tea_estimate")}
                    className={`p-3 rounded-xl border text-left text-xs font-semibold transition ${
                      interestCalculationMode === "tea_estimate"
                        ? "border-blue-600 bg-blue-50 text-blue-900 ring-2 ring-blue-600/20"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <p className="font-bold text-sm mb-0.5">Tasa Efectiva Anual (TEA)</p>
                    <p className="text-[11px] text-slate-500 font-normal">Convierte la TEA a la tasa efectiva del período cuando la frecuencia está definida.</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setInterestCalculationMode("manual")}
                    className={`p-3 rounded-xl border text-left text-xs font-semibold transition ${
                      interestCalculationMode === "manual"
                        ? "border-blue-600 bg-blue-50 text-blue-900 ring-2 ring-blue-600/20"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <p className="font-bold text-sm mb-0.5">Registro manual</p>
                    <p className="text-[11px] text-slate-500 font-normal">Indicaré el interés en cada pago.</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setInterestCalculationMode("unknown")}
                    className={`p-3 rounded-xl border text-left text-xs font-semibold transition ${
                      interestCalculationMode === "unknown"
                        ? "border-blue-600 bg-blue-50 text-blue-900 ring-2 ring-blue-600/20"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <p className="font-bold text-sm mb-0.5">No lo sé</p>
                    <p className="text-[11px] text-slate-500 font-normal">No calcular sugerencia.</p>
                  </button>
                </div>
              </div>

              {interestCalculationMode === "contract_periodic_rate" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-700">Tasa contractual % *</label>
                    <input
                      type="number"
                      step="0.01"
                      value={periodicRatePercent}
                      onChange={(e) => setPeriodicRatePercent(e.target.value)}
                      placeholder="Ej. 4.00"
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700">Periodo de la tasa *</label>
                    <select
                      value={periodicRateBasis}
                      onChange={(e) => setPeriodicRateBasis(e.target.value as PeriodicRateBasis)}
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="monthly">Mensual</option>
                      <option value="biweekly">Quincenal</option>
                      <option value="weekly">Semanal</option>
                      <option value="daily">Diario</option>
                    </select>
                  </div>
                </div>
              )}

              {interestCalculationMode === "tea_estimate" && (
                <div className="pt-2 space-y-2">
                  <label className="block text-xs font-bold text-slate-700">TEA % (Tasa Efectiva Anual)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={teaPercent}
                    onChange={(e) => setTeaPercent(e.target.value)}
                    placeholder="Ej. 60.10"
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm sm:w-64"
                  />
                  {teaPercent && Number(teaPercent) > 0 && (paymentFrequency === "monthly" || paymentFrequency === "biweekly" || paymentFrequency === "weekly") && (
                    <div className="rounded-xl bg-blue-50 p-2.5 text-xs font-semibold text-blue-900 border border-blue-200">
                      {(() => {
                        const res = effectivePeriodicRateFromTea({
                          teaPercent: Number(teaPercent),
                          frequency: paymentFrequency as "monthly" | "biweekly" | "weekly",
                        });
                        const label = paymentFrequency === "monthly" ? "TEM" : paymentFrequency === "biweekly" ? "TEQ" : "TES";
                        return `TEA ${teaPercent}% → ${label} estimada ${res.ratePercent.toFixed(4)}%`;
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Progressive disclosure button */}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm font-bold text-blue-600 hover:text-blue-800"
            >
              {showAdvanced ? "Ocultar datos adicionales y avanzados ▲" : "Mostrar datos adicionales y avanzados ▼"}
            </button>
          </div>

          {/* Advanced fields collapsed by default */}
          {showAdvanced && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-3 border-t border-slate-100">
              {isCard ? (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Día de cierre (1 - 31)</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={closingDay}
                      onChange={(e) => setClosingDay(e.target.value)}
                      placeholder="Ej. 20"
                      className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Día de pago habitual (1 - 31)</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={dueDay}
                      onChange={(e) => setDueDay(e.target.value)}
                      placeholder="Ej. 5"
                      className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Últimos 4 dígitos</label>
                    <input
                      type="text"
                      maxLength={4}
                      value={last4}
                      onChange={(e) => setLast4(e.target.value)}
                      placeholder="Ej. 1234"
                      className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">¿Cuándo comenzó la deuda?</label>
                    <input
                      type="date"
                      value={originDate}
                      onChange={(e) => setOriginDate(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                </>
              ) : (
                <>
                  {repaymentStructure === "open_ended" ? (
                    <div>
                      <label className="block text-sm font-semibold text-slate-700">Abono mínimo obligatorio a capital</label>
                      <p className="mt-0.5 text-xs text-slate-500">Monto mínimo que la entidad exige reducir del capital en cada pago. Déjalo vacío si no existe un mínimo.</p>
                      <div className="relative mt-1 flex items-center rounded-xl border border-slate-300 focus-within:border-blue-600">
                        <span className="select-none pl-4 text-sm font-bold text-slate-500">{currencySymbol}</span>
                        <input
                          type="number"
                          step="0.01"
                          value={minimumPrincipalPayment}
                          onChange={(e) => setMinimumPrincipalPayment(e.target.value)}
                          placeholder="Opcional"
                          className="w-full bg-transparent px-3 py-2.5 text-slate-900 focus:outline-none"
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700">Fecha del primer pago</label>
                        <input
                          type="date"
                          value={firstDueDate}
                          onChange={(e) => setFirstDueDate(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700">Monto estimado de cuota</label>
                        <div className="relative mt-1 flex items-center rounded-xl border border-slate-300 focus-within:border-blue-600">
                          <span className="select-none pl-4 text-sm font-bold text-slate-500">{currencySymbol}</span>
                          <input
                            type="number"
                            step="0.01"
                            value={plannedInstallmentAmount}
                            onChange={(e) => setPlannedInstallmentAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full bg-transparent px-3 py-2.5 text-slate-900 focus:outline-none"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700">Número de cuotas planeadas</label>
                        <input
                          type="number"
                          value={plannedInstallmentCount}
                          onChange={(e) => setPlannedInstallmentCount(e.target.value)}
                          placeholder="Ej. 12"
                          className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                        />
                      </div>
                    </>
                  )}
                  {paymentFrequency === "custom" && (
                    <div>
                      <label className="block text-sm font-semibold text-slate-700">Días entre pagos (Frecuencia personalizada)</label>
                      <input
                        type="number"
                        value={customFrequencyDays}
                        onChange={(e) => setCustomFrequencyDays(e.target.value)}
                        placeholder="Ej. 45"
                        className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                  )}
                </>
              )}

              <div>
                <label className="block text-sm font-semibold text-slate-700">TEA % (Tasa Efectiva Anual)</label>
                <input
                  type="number"
                  step="0.01"
                  value={teaPercent}
                  onChange={(e) => setTeaPercent(e.target.value)}
                  placeholder="0.00"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700">TCEA % (Tasa Costo Efectivo Anual)</label>
                <input
                  type="number"
                  step="0.01"
                  value={tceaPercent}
                  onChange={(e) => setTceaPercent(e.target.value)}
                  placeholder="0.00"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700">Notas / Observaciones</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Notas opcionales..."
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>

          {/* Optional Schedule (Only non-card, fixed schedule) */}
          {!isCard && showAdvanced && repaymentStructure !== "open_ended" && (
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold text-slate-800">Cronograma inicial de cuotas (Opcional)</h3>
                <button
                  type="button"
                  onClick={addInstallment}
                  className="flex items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-1.5 text-sm font-bold text-blue-700 hover:bg-blue-100"
                >
                  <Plus className="h-4 w-4" /> Agregar cuota
                </button>
              </div>
              {installments.length === 0 ? (
                <p className="text-sm text-slate-500 italic">No se han agregado cuotas iniciales.</p>
              ) : (
                <div className="space-y-3">
                  {installments.map((inst, idx) => (
                    <div key={idx} className="grid grid-cols-1 gap-2 sm:grid-cols-6 items-center bg-slate-50 p-3 rounded-xl">
                      <div className="text-sm font-bold text-slate-700">#{inst.installmentNumber}</div>
                      <div>
                        <label className="block text-xs text-slate-500">Vencimiento</label>
                        <input
                          type="date"
                          value={inst.dueDate}
                          onChange={(e) => {
                            const copy = [...installments];
                            copy[idx].dueDate = e.target.value;
                            setInstallments(copy);
                          }}
                          className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500">Monto</label>
                        <input
                          type="number"
                          step="0.01"
                          value={inst.expectedAmount}
                          onChange={(e) => {
                            const copy = [...installments];
                            copy[idx].expectedAmount = e.target.value;
                            setInstallments(copy);
                          }}
                          className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500">Principal</label>
                        <input
                          type="number"
                          step="0.01"
                          value={inst.expectedPrincipal}
                          onChange={(e) => {
                            const copy = [...installments];
                            copy[idx].expectedPrincipal = e.target.value;
                            setInstallments(copy);
                          }}
                          className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500">Interés</label>
                        <input
                          type="number"
                          step="0.01"
                          value={inst.expectedInterest}
                          onChange={(e) => {
                            const copy = [...installments];
                            copy[idx].expectedInterest = e.target.value;
                            setInstallments(copy);
                          }}
                          className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                        />
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => setInstallments(installments.filter((_, i) => i !== idx))}
                          className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Additional Collaterals for non-pledge debts */}
          {!isCard && !isPledge && showAdvanced && (
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold text-slate-800">Garantías (Opcional)</h3>
                <button
                  type="button"
                  onClick={addCollateral}
                  className="flex items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-1.5 text-sm font-bold text-blue-700 hover:bg-blue-100"
                >
                  <Plus className="h-4 w-4" /> Agregar garantía
                </button>
              </div>
              {collaterals.length === 0 ? (
                <p className="text-sm text-slate-500 italic">No se han registrado garantías adicionales.</p>
              ) : (
                <div className="space-y-3">
                  {collaterals.map((col, idx) => (
                    <div key={idx} className="grid grid-cols-1 gap-2 sm:grid-cols-4 items-center bg-slate-50 p-3 rounded-xl">
                      <div className="sm:col-span-2">
                        <label className="block text-xs text-slate-500">Descripción</label>
                        <input
                          type="text"
                          value={col.description}
                          onChange={(e) => {
                            const copy = [...collaterals];
                            copy[idx].description = e.target.value;
                            setCollaterals(copy);
                          }}
                          placeholder="Ej. Vehículo / Inmueble"
                          className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500">Valor estimado ({currencySymbol})</label>
                        <input
                          type="number"
                          step="0.01"
                          value={col.estimatedValue}
                          onChange={(e) => {
                            const copy = [...collaterals];
                            copy[idx].estimatedValue = e.target.value;
                            setCollaterals(copy);
                          }}
                          className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                        />
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => setCollaterals(collaterals.filter((_, i) => i !== idx))}
                          className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setStep("type_select")}
              className="rounded-xl px-4 py-2.5 font-bold text-slate-600 hover:bg-slate-100"
            >
              Atrás
            </button>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-xl px-5 py-2.5 font-bold text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-xl bg-blue-600 px-6 py-2.5 font-bold text-white shadow-md hover:bg-blue-700"
              >
                Revisar resumen
              </button>
            </div>
          </div>
        </form>
      )}

      {/* STEP 3: Review & Confirmation Summary */}
      {step === "review" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-blue-100 pb-3">
              <span className="inline-flex items-center gap-2 font-bold text-blue-900 text-lg">
                {selectedKindObj?.label || "Deuda"}
              </span>
              <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">
                {onboardingMode === "EXISTING_DEBT" ? "Deuda existente" : "Deuda nueva"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-slate-500 font-medium">Acreedor / Entidad</p>
                <p className="font-bold text-slate-900 text-base">{creditorName || "—"}</p>
              </div>

              <div>
                <p className="text-xs text-slate-500 font-medium">Nombre registrado</p>
                <p className="font-bold text-slate-900 text-base">
                  {isPledge ? (name || `Empeño: ${pledgeItemDescription}`) : (name || "—")}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-500 font-medium">
                  {onboardingMode === "EXISTING_DEBT" ? "Debes actualmente" : "Monto a pagar"}
                </p>
                <p className="font-extrabold text-blue-700 text-xl">
                  {currencySymbol} {Number(openingPrincipalBalance || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-500 font-medium">Moneda</p>
                <p className="font-bold text-slate-900">{currencyCode === "USD" ? "Dólares estadounidenses (USD)" : "Soles peruanos (PEN)"}</p>
              </div>

              {originDate && (
                <div>
                  <p className="text-xs text-slate-500 font-medium">Comenzó</p>
                  <p className="font-semibold text-slate-800">{formatReviewDate(originDate)}</p>
                </div>
              )}

              {onboardingMode === "EXISTING_DEBT" && originalPrincipal && (
                <div>
                  <p className="text-xs text-slate-500 font-medium">Monto original recibido</p>
                  <p className="font-semibold text-slate-800">
                    {currencySymbol} {Number(originalPrincipal).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              )}

              {isPledge && pledgeItemDescription && (
                <div className="sm:col-span-2 rounded-xl bg-white p-3 border border-blue-200">
                  <p className="text-xs font-bold text-blue-900 mb-1">Garantía del empeño</p>
                  <p className="font-bold text-slate-900">{pledgeItemDescription}</p>
                  {pledgeRedemptionDeadline && (
                    <p className="text-xs text-slate-600 mt-1">
                      Límite para recuperar: <span className="font-bold text-slate-900">{formatReviewDate(pledgeRedemptionDeadline)}</span>
                    </p>
                  )}
                  {pledgeEstimatedValue && (
                    <p className="text-xs text-slate-600 mt-0.5">
                      Valor estimado: <span className="font-bold text-slate-900">{currencySymbol} {Number(pledgeEstimatedValue).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </p>
                  )}
                </div>
              )}
            </div>

            {debtKind === "bank_loan" && (
              <div className="rounded-xl border border-blue-200 bg-white p-4 space-y-4 text-sm">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div><p className="text-xs text-slate-500">Tipo</p><p className="font-bold">{selectedKindObj?.label}</p></div>
                  <div><p className="text-xs text-slate-500">Banco</p><p className="font-bold">{creditorName || "—"}</p></div>
                  <div><p className="text-xs text-slate-500">Contrato</p><p className="font-bold">{contractNumber || "—"}</p></div>
                  <div><p className="text-xs text-slate-500">Modalidad</p><p className="font-bold">{AMORTIZATION_METHOD_OPTIONS.find((option) => option.value === amortizationMethod)?.label || amortizationMethod}</p></div>
                  <div><p className="text-xs text-slate-500">Financiado</p><p className="font-bold">{currencySymbol} {Number(financedAmount || openingPrincipalBalance || 0).toFixed(2)}</p></div>
                  <div><p className="text-xs text-slate-500">Cuota inicial</p><p className="font-bold">{downPaymentAmount ? `${currencySymbol} ${Number(downPaymentAmount).toFixed(2)}` : "—"}</p></div>
                  <div><p className="text-xs text-slate-500">Plazo</p><p className="font-bold">{plannedInstallmentCount || "—"} cuotas</p></div>
                  <div><p className="text-xs text-slate-500">Frecuencia</p><p className="font-bold">{paymentFrequency || "—"}</p></div>
                  <div><p className="text-xs text-slate-500">Primera cuota</p><p className="font-bold">{formatReviewDate(firstDueDate)}</p></div>
                  <div><p className="text-xs text-slate-500">TEA</p><p className="font-bold">{teaPercent ? `${teaPercent}%` : "—"}</p></div>
                  <div><p className="text-xs text-slate-500">TCEA</p><p className="font-bold">{tceaPercent ? `${tceaPercent}%` : "—"}</p></div>
                  <div><p className="text-xs text-slate-500">Fuente del cronograma</p><p className="font-bold">{scheduleSource === "contractual" ? "Contractual" : "Estimada"}</p></div>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Seguros</p>
                  {insurances.length === 0 ? <p className="mt-1 text-slate-600">Sin desgravamen ni seguros definidos.</p> : <ul className="mt-1 space-y-1 text-slate-700">{insurances.map((insurance, index) => <li key={index}>{insurance.label} · {insurance.pricingMode} {insurance.provider ? `· ${insurance.provider}` : ""}</li>)}</ul>}
                </div>
                {scheduleSource === "contractual" ? (
                  <div className="grid grid-cols-2 gap-3 rounded-xl bg-emerald-50 p-3 text-emerald-950 sm:grid-cols-5">
                    <span>Capital: <strong>{currencySymbol} {bankReviewTotals.principal.toFixed(2)}</strong></span>
                    <span>Intereses: <strong>{currencySymbol} {bankReviewTotals.interest.toFixed(2)}</strong></span>
                    <span>Seguros: <strong>{currencySymbol} {bankReviewTotals.insurance.toFixed(2)}</strong></span>
                    <span>Fees: <strong>{currencySymbol} {bankReviewTotals.fees.toFixed(2)}</strong></span>
                    <span>Total contractual: <strong>{currencySymbol} {bankReviewTotals.total.toFixed(2)}</strong></span>
                  </div>
                ) : (
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 font-bold text-indigo-950">Estimación de Caja Familiar — no sustituye el cronograma del banco</div>
                )}
              </div>
            )}

            <div className="rounded-xl bg-white/80 p-3 text-xs text-slate-600 border border-slate-200/80">
              {onboardingMode === "EXISTING_DEBT" ? (
                <p>
                  <strong>Punto de partida:</strong> Registrar esta deuda no volverá a sumar el dinero que recibiste anteriormente en tus cuentas.
                </p>
              ) : (
                <p>
                  <strong>Compromiso nuevo:</strong> Se registrará el saldo adeudado y cronograma. No se generará un movimiento de dinero automático en tus cuentas.
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setStep("details")}
              className="rounded-xl px-4 py-2.5 font-bold text-slate-600 hover:bg-slate-100"
            >
              Editar datos
            </button>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-xl px-5 py-2.5 font-bold text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSubmit}
                className="rounded-xl bg-blue-600 px-6 py-2.5 font-bold text-white shadow-md hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? "Registrando..." : isCard ? "Registrar tarjeta" : "Registrar deuda"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
