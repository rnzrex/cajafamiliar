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

  const [insurances, setInsurances] = useState<Array<{
    insuranceType: DebtInsuranceType;
    label: string;
    pricingMode: DebtInsurancePricingMode;
    ratePercent: string;
    fixedAmount: string;
    provider: string;
    policyReference: string;
  }>>([]);

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
          installmentAmountMode: scheduleSource === "contractual" ? installmentAmountMode : "fixed",
          teaPercent,
          tceaPercent,
          notes,
          pledgeItemDescription,
          pledgeRedemptionDeadline,
          pledgeEstimatedValue,
          pledgePledgedValue,
          installments,
          extraCollaterals: collaterals,
          repaymentStructure: scheduleSource === "contractual" ? "fixed_schedule" : (repaymentStructure || "fixed_schedule"),
          interestCalculationMode: scheduleSource === "contractual" ? "contract_schedule" : (interestCalculationMode || "tea_estimate"),
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
          insurances: insurances.map((ins) => ({
            insuranceType: ins.insuranceType,
            label: ins.label,
            pricingMode: ins.pricingMode,
            ratePercent: ins.ratePercent ? Number(ins.ratePercent) : null,
            fixedAmount: ins.fixedAmount ? Number(ins.fixedAmount) : null,
            provider: ins.provider || null,
            policyReference: ins.policyReference || null,
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

                  {/* Schedule Source Selection */}
                  <div className="space-y-3 pt-2">
                    <label className="block text-sm font-bold text-slate-800">Fuente del Cronograma *</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setScheduleSource("contractual")}
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
                        onClick={() => setScheduleSource("estimated")}
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
                              const finAmt = Number(openingPrincipalBalance || financedAmount || 0);
                              const teaNum = teaPercent ? Number(teaPercent) : 0;
                              const termsNum = plannedInstallmentCount ? Number(plannedInstallmentCount) : 12;

                              const est = generateEstimatedDebtSchedule({
                                financedAmount: finAmt,
                                teaPercent: teaNum,
                                termInstallments: termsNum,
                                paymentFrequency: paymentFrequency || "monthly",
                                customFrequencyDays: customFrequencyDays ? Number(customFrequencyDays) : null,
                                firstDueDate: firstDueDate || localDateString(new Date()),
                                amortizationMethod,
                                gracePeriodType,
                                balloonPaymentAmount: balloonPaymentAmount ? Number(balloonPaymentAmount) : 0,
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
                              setInstallmentAmountMode("fixed");
                              setPlannedInstallmentAmount(est.financialInstallmentAmount.toString());
                            } catch (err: any) {
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
                    </div>
                  )}
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
