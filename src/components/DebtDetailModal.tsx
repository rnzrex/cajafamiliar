import { useState } from "react";
import { X, DollarSign, ArrowUpRight, CheckCircle2, RotateCcw, Settings, ShieldAlert, Trash2, ArrowLeft } from "lucide-react";
import type {
  Debt,
  DebtEvent,
  DebtScheduleVersion,
  DebtInstallment,
  DebtEventInstallmentAllocation,
  DebtCollateral,
  FinancialAccount,
  Category,
  HouseholdMember,
  CreditCardProfile,
  CreditCardEntry,
  CreditCardStatement,
  DebtRepaymentStructure,
  DebtInterestCalculationMode,
  PeriodicRateBasis,
  DebtPaymentFrequency,
  BankLoanProfile,
  DebtInsuranceTerms,
} from "../types";
import type { DebtIntelligenceItem } from "../utils/debtIntelligence";
import { currentDebtScheduleVersion, effectiveDebtEvents } from "../utils/debtCalculations";
import {
  formatDebtKind,
  formatDebtStatus,
  formatPaymentFrequency,
  formatEventType,
  getInstallmentProgress,
  translateDebtError,
} from "../utils/debtViewModel";
import { formatDebtMoney } from "../utils/debtPresentation";
import { deletePristineDebt, setDebtArchived, updateDebtMetadata, updateDebtTerms } from "../services/dataRepository";
import { buildDebtPaymentLedger } from "../utils/debtPaymentLedger";
import { getCurrencySymbol, formatReviewDate, validateDebtFinancialTerms } from "../utils/debtFormMode";
import { calculateNextPayment } from "../utils/debtNextPayment";
import { effectivePeriodicRateFromTea } from "../utils/debtInterestEngine";
import { getAmortizationMethodLabel, getBankLoanSubtypeLabel } from "../utils/bankCreditFormHelper";
import { DebtAnalysisPanel } from "./DebtAnalysisPanel";
import { CreditCardDetailPanel } from "./CreditCardDetailPanel";

interface DebtDetailModalProps {
  debt: Debt;
  debtIntelligence: DebtIntelligenceItem;
  debtEvents: DebtEvent[];
  scheduleVersions: DebtScheduleVersion[];
  installments: DebtInstallment[];
  allocations: DebtEventInstallmentAllocation[];
  collaterals: DebtCollateral[];
  accounts: FinancialAccount[];
  categories: Category[];
  currentMember?: HouseholdMember;
  creditCardProfiles?: CreditCardProfile[];
  creditCardEntries?: CreditCardEntry[];
  cardStatements?: CreditCardStatement[];
  bankLoanProfiles?: BankLoanProfile[];
  debtInsuranceTerms?: DebtInsuranceTerms[];
  allDebts?: Debt[];
  canWriteDebt?: boolean;
  onClose: () => void;
  onOpenOperation: (
    operationType: "payment" | "prepayment" | "payoff" | "reversal" | "installment_advance" | "schedule_update",
    targetEventId?: string,
    paymentWithExtraPrincipal?: boolean
  ) => void;
  onRefresh: () => Promise<void> | void;
  setToast: (toast: { message: string; type: "success" | "error" }) => void;
}

export function DebtDetailModal({
  debt,
  debtIntelligence,
  debtEvents,
  scheduleVersions,
  installments,
  allocations,
  collaterals,
  accounts,
  categories,
  currentMember,
  creditCardProfiles,
  creditCardEntries,
  cardStatements,
  bankLoanProfiles,
  debtInsuranceTerms,
  allDebts,
  canWriteDebt = true,
  onClose,
  onOpenOperation,
  onRefresh,
  setToast,
}: DebtDetailModalProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "schedule" | "collaterals" | "history">("overview");
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [isEditingTerms, setIsEditingTerms] = useState(false);

  const [editName, setEditName] = useState(debt.name);
  const [editCreditor, setEditCreditor] = useState(debt.creditorName);
  const [editNotes, setEditNotes] = useState(debt.notes);

  // Editable Terms State
  const [editRepaymentStructure, setEditRepaymentStructure] = useState<DebtRepaymentStructure>(debt.repaymentStructure || "unknown");
  const [editInterestCalcMode, setEditInterestCalcMode] = useState<DebtInterestCalculationMode>(debt.interestCalculationMode || "unknown");
  const [editPeriodicRatePercent, setEditPeriodicRatePercent] = useState(debt.periodicRatePercent != null ? debt.periodicRatePercent.toString() : "");
  const [editPeriodicRateBasis, setEditPeriodicRateBasis] = useState<PeriodicRateBasis>(debt.periodicRateBasis || "monthly");
  const [editTeaPercent, setEditTeaPercent] = useState(debt.teaPercent != null ? debt.teaPercent.toString() : "");
  const [editTceaPercent, setEditTceaPercent] = useState(debt.tceaPercent != null ? debt.tceaPercent.toString() : "");
  const [editPaymentFrequency, setEditPaymentFrequency] = useState<DebtPaymentFrequency | "">(debt.paymentFrequency || "");
  const [editFirstDueDate, setEditFirstDueDate] = useState(debt.firstDueDate || "");
  const [editMinimumPrincipalPayment, setEditMinimumPrincipalPayment] = useState(debt.minimumPrincipalPayment != null ? debt.minimumPrincipalPayment.toString() : "");

  const [submitting, setSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const allEventsForDebt = debtEvents.filter((e) => e.debtId === debt.id);
  const cardEntriesForDebt = (creditCardEntries || []).filter((e) => e.debtId === debt.id);
  const cardStatementsForDebt = (cardStatements || []).filter((s) => s.debtId === debt.id);

  const canDeletePristine =
    allEventsForDebt.length === 0 &&
    cardEntriesForDebt.length === 0 &&
    cardStatementsForDebt.length === 0;

  const handleToggleArchive = async () => {
    if (!canWriteDebt || (typeof navigator !== "undefined" && !navigator.onLine)) {
      setToast({
        message: "Las operaciones de deuda requieren conexión a internet y estado habilitado.",
        type: "error",
      });
      return;
    }
    setSubmitting(true);
    let success = false;
    try {
      await setDebtArchived({ debtId: debt.id, isArchived: !debt.isArchived });
      success = true;
      setToast({ message: debt.isArchived ? "Deuda reactivada." : "Deuda archivada.", type: "success" });
      await onRefresh();
    } catch (err) {
      if (!success) {
        setToast({ message: translateDebtError(err), type: "error" });
      } else {
        setToast({
          message: "Operación aplicada, pero falló la actualización de datos locales.",
          type: "error",
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeletePristine = async () => {
    if (!canWriteDebt || (typeof navigator !== "undefined" && !navigator.onLine)) {
      setToast({
        message: "Las operaciones de deuda requieren conexión a internet y estado habilitado.",
        type: "error",
      });
      return;
    }
    setSubmitting(true);
    let success = false;
    try {
      await deletePristineDebt({ debtId: debt.id });
      success = true;
      setToast({ message: "Deuda eliminada definitivamente.", type: "success" });
      onClose();
      await onRefresh();
    } catch (err) {
      setShowDeleteConfirm(false);
      if (!success) {
        setToast({ message: translateDebtError(err), type: "error" });
      } else {
        setToast({
          message: "Deuda eliminada, pero falló la actualización de datos locales.",
          type: "error",
        });
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (debt.debtKind === "credit_card") {
    const cardProfile = creditCardProfiles?.find((p) => p.debtId === debt.id) ?? null;
    return (
      <section className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200 transition"
          >
            <ArrowLeft className="h-4 w-4" /> Volver a deudas
          </button>
        </div>

        <div className="relative flex w-full flex-col rounded-3xl bg-white shadow-xl border border-slate-200 p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-slate-900">{debt.name} ({debt.creditorName})</h2>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                Tarjeta de Crédito
              </span>
            </div>
            <div className="flex items-center gap-2">
              {canWriteDebt && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleToggleArchive}
                  className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {debt.isArchived ? "Reactivar" : "Archivar"}
                </button>
              )}
              {canWriteDebt && canDeletePristine && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" /> Eliminar deuda
                </button>
              )}
            </div>
          </div>
          {!canDeletePristine && (
            <p className="mb-4 text-xs text-slate-400 italic">
              Esta deuda tiene historial y no puede eliminarse.
            </p>
          )}
          <CreditCardDetailPanel
            debt={debt}
            profile={cardProfile}
            cardEntries={creditCardEntries ?? []}
            cardStatements={cardStatements ?? []}
            allDebts={allDebts ?? [debt]}
            accounts={accounts}
            categories={categories}
            currentMember={currentMember}
            canWriteDebt={canWriteDebt}
            onRefreshData={async () => {
              await onRefresh();
            }}
            setToast={setToast}
          />
        </div>

        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
              <div className="flex items-center gap-3 text-rose-600">
                <div className="rounded-full bg-rose-100 p-2">
                  <Trash2 className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">¿Eliminar esta deuda?</h3>
              </div>
              <p className="text-sm text-slate-600">
                Esta deuda todavía no tiene movimientos registrados. Al eliminarla se borrará definitivamente su configuración y no aparecerá como archivada.
              </p>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setShowDeleteConfirm(false)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleDeletePristine}
                  className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50 shadow-sm"
                >
                  {submitting ? "Eliminando..." : "Eliminar definitivamente"}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    );
  }

  const pendingBankSchedule = debt.debtKind === "bank_loan" && debtIntelligence.pendingBankSchedule === true;
  const currentSchedule = currentDebtScheduleVersion(debt.id, scheduleVersions);
  const debtInstallments = pendingBankSchedule
    ? []
    : installments.filter((i) => currentSchedule && i.scheduleVersionId === currentSchedule.id);
  const debtCollaterals = collaterals.filter((c) => c.debtId === debt.id);
  const bankProfile = bankLoanProfiles?.find((profile) => profile.debtId === debt.id) ?? null;
  const bankInsurances = (debtInsuranceTerms || []).filter((insurance) => insurance.debtId === debt.id);
  const ledgerResult = buildDebtPaymentLedger(debt, allEventsForDebt);
  const currencySymbol = getCurrencySymbol(debt.currencyCode);
  const isFlexOpenEnded = debt.repaymentStructure === "open_ended";
  const nextPayment = calculateNextPayment({
    debt,
    debtEvents: allEventsForDebt,
    currentPrincipal: debtIntelligence.currentPrincipal,
  });

  const handleSaveMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteDebt || (typeof navigator !== "undefined" && !navigator.onLine)) {
      setToast({ message: "Las operaciones de deuda requieren conexión a internet.", type: "error" });
      return;
    }
    setSubmitting(true);
    let success = false;
    try {
      await updateDebtMetadata({
        debtId: debt.id,
        name: editName.trim(),
        creditorName: editCreditor.trim(),
        notes: editNotes,
      });
      success = true;
      setIsEditingMetadata(false);
      setToast({ message: "Información de la deuda actualizada.", type: "success" });
      await onRefresh();
    } catch (err) {
      if (!success) {
        setToast({ message: translateDebtError(err), type: "error" });
      } else {
        setToast({ message: "Guardado exitoso, pero falló el refresco local.", type: "error" });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveTerms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteDebt || (typeof navigator !== "undefined" && !navigator.onLine)) {
      setToast({ message: "Las operaciones de deuda requieren conexión a internet.", type: "error" });
      return;
    }
    const termsValidation = validateDebtFinancialTerms({
      interestCalculationMode: editInterestCalcMode,
      periodicRatePercent: editPeriodicRatePercent,
      periodicRateBasis: editPeriodicRateBasis,
      teaPercent: editTeaPercent,
    });
    if (!termsValidation.valid) {
      setToast({ message: termsValidation.error || "Términos financieros no válidos.", type: "error" });
      return;
    }
    setSubmitting(true);
    let success = false;
    try {
      await updateDebtTerms({
        debtId: debt.id,
        repaymentStructure: editRepaymentStructure,
        interestCalculationMode: editInterestCalcMode,
        periodicRatePercent: editPeriodicRatePercent ? Number(editPeriodicRatePercent) : null,
        periodicRateBasis: editPeriodicRateBasis,
        teaPercent: editTeaPercent ? Number(editTeaPercent) : null,
        tceaPercent: editTceaPercent ? Number(editTceaPercent) : null,
        paymentFrequency: editPaymentFrequency ? (editPaymentFrequency as DebtPaymentFrequency) : null,
        clearPeriodicRate: editInterestCalcMode !== "contract_periodic_rate" || !editPeriodicRatePercent,
        clearTea: !editTeaPercent,
        clearTcea: !editTceaPercent,
        clearFrequency: !editPaymentFrequency,
        firstDueDate: editFirstDueDate || null,
        clearFirstDueDate: !editFirstDueDate,
        minimumPrincipalPayment: editMinimumPrincipalPayment ? Number(editMinimumPrincipalPayment) : null,
        clearMinimumPrincipalPayment: !editMinimumPrincipalPayment,
      });
      success = true;
      setIsEditingTerms(false);
      setToast({ message: "Términos financieros actualizados exitosamente.", type: "success" });
      await onRefresh();
    } catch (err) {
      if (!success) {
        setToast({ message: translateDebtError(err), type: "error" });
      } else {
        setToast({ message: "Términos actualizados, pero falló el refresco local.", type: "error" });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto max-w-7xl space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200 transition"
        >
          <ArrowLeft className="h-4 w-4" /> Volver a deudas
        </button>
      </div>

      <div className="relative flex w-full flex-col rounded-3xl bg-white shadow-xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 p-6">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-slate-900">{debt.name}</h2>
              <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">
                {formatDebtKind(debt.debtKind)}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  debt.status === "active"
                    ? "bg-emerald-100 text-emerald-800"
                    : debt.status === "paid_off"
                    ? "bg-slate-100 text-slate-700"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                {formatDebtStatus(debt.status)}
              </span>
              {debt.isArchived && (
                <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-bold text-slate-600">Archivada</span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-500">Acreedor / Entidad: {debt.creditorName}</p>
          </div>
        </div>

        {/* Sub-Header Tabs & Quick Actions */}
        <div className="flex flex-wrap items-center justify-between border-b border-slate-100 bg-slate-50/50 px-6 py-3 gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("overview")}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                activeTab === "overview" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Resumen
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("schedule")}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                activeTab === "schedule" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {isFlexOpenEnded
                ? "Avance y pagos"
                : pendingBankSchedule
                  ? "Cronograma (pendiente)"
                  : `Cronograma (${debtInstallments.length})`}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("collaterals")}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                activeTab === "collaterals" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Garantías ({debtCollaterals.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                activeTab === "history" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Historial ({allEventsForDebt.length})
            </button>
          </div>

          <div className="flex items-center gap-2">
            {debt.status === "active" && !debt.isArchived && canWriteDebt && (
              <>
                <button
                  type="button"
                  onClick={() => onOpenOperation("payment")}
                  className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-blue-700"
                >
                  <DollarSign className="h-4 w-4" /> {isFlexOpenEnded ? "Registrar pago" : "Registrar pago"}
                </button>
                {!isFlexOpenEnded && (
                  <button
                    type="button"
                    onClick={() => onOpenOperation("payment", undefined, true)}
                    className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-indigo-700"
                  >
                    <DollarSign className="h-4 w-4" /> Pagar cuota + abono al capital
                  </button>
                )}
                {!isFlexOpenEnded && (
                  <>
                    <button
                      type="button"
                      onClick={() => onOpenOperation("prepayment")}
                      className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-indigo-700"
                    >
                      <ArrowUpRight className="h-4 w-4" /> Prepago
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenOperation("installment_advance")}
                      className="flex items-center gap-1.5 rounded-xl bg-purple-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-purple-700"
                    >
                      <ArrowUpRight className="h-4 w-4" /> Adelantar cuotas
                    </button>
                  </>
                )}
                {debt.debtKind === "bank_loan" && !isFlexOpenEnded && (
                  <button
                    type="button"
                    onClick={() => onOpenOperation("schedule_update")}
                    className="flex items-center gap-1.5 rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-bold text-blue-700 shadow hover:bg-blue-50"
                  >
                    <Settings className="h-4 w-4" /> Actualizar cronograma
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpenOperation("payoff")}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-emerald-700"
                >
                  <CheckCircle2 className="h-4 w-4" /> Liquidar deuda
                </button>
              </>
            )}
            <button
              type="button"
              disabled={submitting || !canWriteDebt}
              onClick={handleToggleArchive}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {debt.isArchived ? "Reactivar" : "Archivar"}
            </button>
            {canDeletePristine ? (
              <button
                type="button"
                disabled={submitting || !canWriteDebt}
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50 shadow-sm"
              >
                <Trash2 className="h-4 w-4" /> Eliminar deuda
              </button>
            ) : (
              <span className="text-xs text-slate-500 font-medium self-center">
                Esta deuda tiene historial y no puede eliminarse.
              </span>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 p-6">
          {activeTab === "overview" && (
            <div className="space-y-6">
              {isEditingMetadata ? (
                <form onSubmit={handleSaveMetadata} className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-4">
                  <h3 className="text-lg font-bold text-slate-900">Editar metadata de la deuda</h3>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Nombre</label>
                    <input
                      type="text"
                      required
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Acreedor</label>
                    <input
                      type="text"
                      required
                      value={editCreditor}
                      onChange={(e) => setEditCreditor(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Notas</label>
                    <textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      rows={2}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 bg-white"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditingMetadata(false)}
                      className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600"
                    >
                      Cancelar
                    </button>
                    <button type="submit" disabled={submitting} className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white">
                      Guardar cambios
                    </button>
                  </div>
                </form>
              ) : isEditingTerms ? (
                <form onSubmit={handleSaveTerms} className="rounded-2xl border border-blue-200 bg-blue-50/60 p-5 space-y-4">
                  <h3 className="text-lg font-bold text-blue-900 flex items-center gap-2">
                    <Settings className="h-5 w-5" /> Editar términos financieros y de pago
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700">Estructura de pago</label>
                      <select
                        value={editRepaymentStructure}
                        onChange={(e) => setEditRepaymentStructure(e.target.value as DebtRepaymentStructure)}
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                      >
                        <option value="open_ended">Sin plazo fijo (Flexibles / Interés + amortización)</option>
                        <option value="fixed_schedule">Con cuotas / plazo fijo</option>
                        <option value="unknown">No especificado</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700">Modo de cálculo de interés</label>
                      <select
                        value={editInterestCalcMode}
                        onChange={(e) => setEditInterestCalcMode(e.target.value as DebtInterestCalculationMode)}
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                      >
                        <option value="contract_periodic_rate">Tasa periódica contractual (ej. 4% mensual)</option>
                        <option value="tea_estimate">Estimación con TEA</option>
                        <option value="contract_schedule">Según cronograma contractual</option>
                        <option value="manual">Manual / No especificado</option>
                      </select>
                    </div>

                    {editInterestCalcMode === "contract_periodic_rate" && (
                      <>
                        <div>
                          <label className="block text-xs font-bold text-slate-700">Tasa contractual %</label>
                          <input
                            type="number"
                            step="0.01"
                            value={editPeriodicRatePercent}
                            onChange={(e) => setEditPeriodicRatePercent(e.target.value)}
                            placeholder="Ej. 4.00"
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-700">Periodo de tasa</label>
                          <select
                            value={editPeriodicRateBasis}
                            onChange={(e) => setEditPeriodicRateBasis(e.target.value as PeriodicRateBasis)}
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                          >
                            <option value="monthly">Mensual</option>
                            <option value="biweekly">Quincenal</option>
                            <option value="weekly">Semanal</option>
                            <option value="daily">Diario</option>
                          </select>
                        </div>
                      </>
                    )}

                    <div>
                      <label className="block text-xs font-bold text-slate-700">TEA % (Tasa Efectiva Anual)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editTeaPercent}
                        onChange={(e) => setEditTeaPercent(e.target.value)}
                        placeholder="Ej. 60.10"
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700">TCEA % (Tasa Costo Efectivo Anual)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editTceaPercent}
                        onChange={(e) => setEditTceaPercent(e.target.value)}
                        placeholder="Ej. 72.40"
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700">Frecuencia de pago</label>
                      <select
                        value={editPaymentFrequency}
                        onChange={(e) => setEditPaymentFrequency(e.target.value as DebtPaymentFrequency | "")}
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                      >
                        <option value="">No especificada</option>
                        <option value="monthly">Mensual</option>
                        <option value="biweekly">Quincenal</option>
                        <option value="weekly">Semanal</option>
                        <option value="custom">Personalizada</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700">Próxima fecha de vencimiento</label>
                      <input
                        type="date"
                        value={editFirstDueDate}
                        onChange={(e) => setEditFirstDueDate(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700">Abono mínimo obligatorio a capital</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editMinimumPrincipalPayment}
                        onChange={(e) => setEditMinimumPrincipalPayment(e.target.value)}
                        placeholder="Opcional"
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-blue-100">
                    <button
                      type="button"
                      onClick={() => setIsEditingTerms(false)}
                      className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600"
                    >
                      Cancelar
                    </button>
                    <button type="submit" disabled={submitting} className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white">
                      Guardar términos
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between rounded-2xl bg-blue-50/60 p-5 gap-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Saldo principal actual</p>
                      <p className="text-3xl font-extrabold text-blue-900">
                        {formatDebtMoney(debtIntelligence.currentPrincipal, debtIntelligence.currencyCode)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Principal inicial de apertura: {formatDebtMoney(debt.openingPrincipalBalance, debt.currencyCode)}
                      </p>
                    </div>
                    {isFlexOpenEnded && (
                      <div className="rounded-xl border border-emerald-200 bg-white/80 px-4 py-3">
                        <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Total estimado para cancelar este período</p>
                        <p className="text-2xl font-extrabold text-emerald-800">
                          {nextPayment.settlementKnown && nextPayment.settlementAmount != null
                            ? formatDebtMoney(nextPayment.settlementAmount, nextPayment.currencyCode)
                            : "Por confirmar"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Principal + interés estimado del período. No incluye cargos no registrados.
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditingMetadata(true)}
                      className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 border border-slate-200"
                    >
                      Editar info
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingTerms(true)}
                      className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-blue-700 shadow-sm hover:bg-blue-50 border border-blue-200 flex items-center gap-1"
                    >
                      <Settings className="h-3.5 w-3.5" /> Editar términos
                    </button>
                  </div>
                </div>
              )}

              {debt.debtKind === "bank_loan" && bankProfile && (
                <section className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-black uppercase tracking-wider text-blue-900">Perfil del crédito bancario</h3>
                    {pendingBankSchedule ? (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-900">Cronograma posterior pendiente</span>
                    ) : currentSchedule && (
                      <div className="flex items-center gap-2 text-xs font-bold">
                        <span className="rounded-full bg-white px-2.5 py-1 text-blue-800">{currentSchedule.scheduleSource === "contractual" ? "Contractual" : currentSchedule.scheduleSource === "estimated" ? "Estimado" : "Manual"}</span>
                        <span className={`rounded-full px-2.5 py-1 ${currentSchedule.isAuthoritative ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{currentSchedule.isAuthoritative ? "Autoritativo" : "No autoritativo"}</span>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
                    <div><p className="text-xs text-slate-500">Subtipo</p><p className="font-bold">{getBankLoanSubtypeLabel(bankProfile.loanSubtype)}</p></div>
                    <div><p className="text-xs text-slate-500">Banco</p><p className="font-bold">{debt.creditorName}</p></div>
                    <div><p className="text-xs text-slate-500">Número contrato</p><p className="font-bold">{bankProfile.contractNumber || "—"}</p></div>
                    <div><p className="text-xs text-slate-500">Modalidad</p><p className="font-bold">{getAmortizationMethodLabel(bankProfile.amortizationMethod)}</p></div>
                    <div><p className="text-xs text-slate-500">Monto desembolsado</p><p className="font-bold">{bankProfile.disbursedAmount == null ? "—" : `${currencySymbol} ${bankProfile.disbursedAmount.toFixed(2)}`}</p></div>
                    <div><p className="text-xs text-slate-500">Importe financiado</p><p className="font-bold">{bankProfile.financedAmount == null ? "—" : `${currencySymbol} ${bankProfile.financedAmount.toFixed(2)}`}</p></div>
                    <div><p className="text-xs text-slate-500">Precio activo</p><p className="font-bold">{bankProfile.assetPrice == null ? "—" : `${currencySymbol} ${bankProfile.assetPrice.toFixed(2)}`}</p></div>
                    <div><p className="text-xs text-slate-500">Cuota inicial</p><p className="font-bold">{bankProfile.downPaymentAmount == null ? "—" : `${currencySymbol} ${bankProfile.downPaymentAmount.toFixed(2)}`}</p></div>
                    <div><p className="text-xs text-slate-500">Plazo</p><p className="font-bold">{bankProfile.termInstallments == null ? "—" : `${bankProfile.termInstallments} cuotas`}</p></div>
                    <div><p className="text-xs text-slate-500">Gracia</p><p className="font-bold">{bankProfile.gracePeriodType}{bankProfile.gracePeriodInstallments == null ? "" : ` (${bankProfile.gracePeriodInstallments})`}</p></div>
                    <div><p className="text-xs text-slate-500">Balloon</p><p className="font-bold">{bankProfile.balloonPaymentAmount == null ? "—" : `${currencySymbol} ${bankProfile.balloonPaymentAmount.toFixed(2)}`}</p></div>
                    <div><p className="text-xs text-slate-500">TEA</p><p className="font-bold">{debt.teaPercent == null ? "—" : `${debt.teaPercent}%`}</p></div>
                    <div><p className="text-xs text-slate-500">TCEA</p><p className="font-bold">{debt.tceaPercent == null ? "—" : `${debt.tceaPercent}%`}</p></div>
                    <div><p className="text-xs text-slate-500">Cuotas restantes</p><p className="font-bold">{pendingBankSchedule ? "Por confirmar" : debtInstallments.filter((installment) => !getInstallmentProgress(installment, allocations, debtEvents).isPaid).length}</p></div>
                    <div><p className="text-xs text-slate-500">Total pendiente conocido</p><p className="font-bold">{pendingBankSchedule ? "Por confirmar" : `${currencySymbol} ${debtInstallments.reduce((total, installment) => Math.max(0, total + (installment.expectedAmount ?? 0) - getInstallmentProgress(installment, allocations, debtEvents).allocated), 0).toFixed(2)}`}</p></div>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase text-slate-500">Seguros</p>
                    {bankInsurances.length === 0 ? <p className="text-sm text-slate-600">No definidos.</p> : <ul className="mt-1 space-y-1 text-sm text-slate-700">{bankInsurances.map((insurance) => <li key={insurance.id}>{insurance.label} · {insurance.pricingMode}{insurance.provider ? ` · ${insurance.provider}` : ""}{insurance.isRequired ? " · requerido" : " · opcional"}</li>)}</ul>}
                  </div>
                </section>
              )}

              {pendingBankSchedule && (
                <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-sm">
                  <p className="text-xs font-black uppercase tracking-wider text-amber-800">CRONOGRAMA PENDIENTE DEL BANCO</p>
                  <p className="mt-1 text-sm font-semibold text-amber-950">Se registró un abono extraordinario, pero todavía no hay una versión posterior autoritativa. No se están inventando cuotas nuevas.</p>
                  {canWriteDebt && debt.debtKind === "bank_loan" && (
                    <button type="button" onClick={() => onOpenOperation("schedule_update")} className="mt-3 rounded-xl bg-amber-200 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-300">
                      Cargar cronograma oficial
                    </button>
                  )}
                </section>
              )}

              {/* Prominent Próximo Pago Section */}
              {debt.status === "active" && (
                <section className="rounded-2xl border border-blue-200 bg-blue-50/50 p-5 shadow-sm space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-blue-100 pb-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-blue-700">PRÓXIMO PAGO</p>
                      <p className="text-2xl font-black text-slate-900">
                        {nextPayment.nextDueDate ? formatReviewDate(nextPayment.nextDueDate) : "Por confirmar"}
                      </p>
                    </div>
                    {canWriteDebt && (
                      <button
                        type="button"
                        onClick={() => onOpenOperation("payment")}
                        className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-md hover:bg-blue-700 transition"
                      >
                        Registrar este pago
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                    <div className="rounded-xl bg-white p-3 border border-slate-200">
                      <p className="text-xs text-slate-500 font-medium">Interés estimado</p>
                      <p className="font-bold text-slate-900 mt-0.5">
                        {nextPayment.interestKnown && nextPayment.interestAmount != null
                          ? formatDebtMoney(nextPayment.interestAmount, nextPayment.currencyCode)
                          : "Desconocido"}
                      </p>
                    </div>

                    <div className="rounded-xl bg-white p-3 border border-slate-200">
                      <p className="text-xs text-slate-500 font-medium">Mínimo a capital</p>
                      <p className="font-bold text-slate-900 mt-0.5">
                        {nextPayment.minimumPrincipalKnown && nextPayment.minimumPrincipalAmount != null
                          ? formatDebtMoney(nextPayment.minimumPrincipalAmount, nextPayment.currencyCode)
                          : "Sin mínimo"}
                      </p>
                    </div>

                    <div className="rounded-xl bg-white p-3 border border-blue-200 bg-blue-50/30">
                      <p className="text-xs text-blue-700 font-bold">Pago mínimo</p>
                      <p className="text-lg font-black text-blue-900 mt-0.5">
                        {nextPayment.minimumPaymentKnown && nextPayment.minimumPaymentAmount != null
                          ? formatDebtMoney(nextPayment.minimumPaymentAmount, nextPayment.currencyCode)
                          : "Desconocido"}
                      </p>
                    </div>

                    <div className="rounded-xl bg-white p-3 border border-slate-200">
                      <p className="text-xs text-slate-500 font-medium">Saldo actual</p>
                      <p className="font-bold text-slate-900 mt-0.5">
                        {formatDebtMoney(nextPayment.currentPrincipal, nextPayment.currencyCode)}
                      </p>
                    </div>

                    <div className="rounded-xl bg-white p-3 border border-slate-200">
                      <p className="text-xs text-slate-500 font-medium">Saldo después</p>
                      <p className="font-bold text-slate-900 mt-0.5">
                        {nextPayment.principalAfterPayment != null
                          ? formatDebtMoney(nextPayment.principalAfterPayment, nextPayment.currencyCode)
                          : "Desconocido"}
                      </p>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 font-medium">
                    Puedes abonar más al capital.
                  </p>
                </section>
              )}

              {/* Comprehensive Intelligence & Analysis Panel */}
              <DebtAnalysisPanel intelligence={debtIntelligence} />

              {/* Decision Support & Interest Terms */}
              <div className="rounded-2xl border border-slate-200 p-5 space-y-3 bg-slate-50/40">
                <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Términos y Tasas de la Deuda</h4>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 text-sm">
                  <div>
                    <p className="text-xs text-slate-500 font-medium">Estructura de pago</p>
                    <p className="font-bold text-slate-900">
                      {debt.repaymentStructure === "open_ended"
                        ? "Sin plazo fijo"
                        : debt.repaymentStructure === "fixed_schedule"
                        ? "Con cuotas / plazo fijo"
                        : "No especificado"}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-slate-500 font-medium">Frecuencia</p>
                    <p className="font-bold text-slate-900">
                      {debt.paymentFrequency === "monthly"
                        ? "Mensual"
                        : debt.paymentFrequency === "biweekly"
                        ? "Quincenal"
                        : debt.paymentFrequency === "weekly"
                        ? "Semanal"
                        : debt.paymentFrequency === "custom"
                        ? "Personalizada"
                        : "No especificada"}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-slate-500 font-medium">Cálculo de interés</p>
                    <p className="font-bold text-slate-900">
                      {debt.interestCalculationMode === "contract_periodic_rate" && debt.periodicRatePercent != null
                        ? `Tasa contractual: ${debt.periodicRatePercent}% ${debt.periodicRateBasis || "mensual"}`
                        : debt.teaPercent != null
                        ? `TEA ${debt.teaPercent}%`
                        : "Manual / No especificado"}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-slate-500 font-medium">Tasa efectiva del período</p>
                    <p className="font-bold text-slate-900">
                      {(() => {
                        if (
                          debt.interestCalculationMode === "tea_estimate" &&
                          debt.teaPercent != null &&
                          debt.teaPercent > 0 &&
                          (debt.paymentFrequency === "monthly" ||
                            debt.paymentFrequency === "biweekly" ||
                            debt.paymentFrequency === "weekly")
                        ) {
                          const freq = debt.paymentFrequency as "monthly" | "biweekly" | "weekly";
                          const res = effectivePeriodicRateFromTea({ teaPercent: debt.teaPercent, frequency: freq });
                          const label = freq === "monthly" ? "TEM" : freq === "biweekly" ? "TEQ" : "TES";
                          return `${label} ${res.ratePercent.toFixed(4)}%`;
                        }
                        if (debt.interestCalculationMode === "contract_periodic_rate" && debt.periodicRatePercent != null) {
                          return `${debt.periodicRatePercent}% ${debt.periodicRateBasis || "mensual"}`;
                        }
                        return "No especificada";
                      })()}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-slate-500 font-medium">Referencia TCEA</p>
                    <p className="font-bold text-slate-900">
                      {debt.tceaPercent != null ? `${debt.tceaPercent}%` : "No especificada"}
                    </p>
                  </div>
                </div>

                {debt.tceaPercent != null && (
                  <p className="text-xs text-slate-500 italic bg-white p-2.5 rounded-xl border border-slate-200">
                    <strong>TCEA ({debt.tceaPercent}%):</strong> Es una referencia de costo total efectivo (incluye intereses, comisiones y seguros). No se utiliza directamente para calcular el interés individual de un pago.
                  </p>
                )}
              </div>

              {debt.notes && (
                <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
                  <p className="text-xs font-bold uppercase text-slate-400 mb-1">Notas y observaciones</p>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{debt.notes}</p>
                </div>
              )}
            </div>
          )}

          {activeTab === "schedule" && (
            <div className="space-y-6">
              {isFlexOpenEnded ? (
                /* Avance y pagos view for open-ended debt */
                <div className="space-y-6">
                  {/* Summary cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center">
                      <p className="text-[10px] font-bold uppercase text-slate-500">Saldo inicial</p>
                      <p className="text-sm font-extrabold text-slate-900">
                        {currencySymbol} {ledgerResult.summary.openingPrincipal.toFixed(2)}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-center">
                      <p className="text-[10px] font-bold uppercase text-blue-700">Saldo actual</p>
                      <p className="text-sm font-extrabold text-blue-900">
                        {currencySymbol} {ledgerResult.summary.currentPrincipal.toFixed(2)}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-center">
                      <p className="text-[10px] font-bold uppercase text-emerald-700">Capital amortizado</p>
                      <p className="text-sm font-extrabold text-emerald-900">
                        {currencySymbol} {ledgerResult.summary.totalPrincipalAmortized.toFixed(2)}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-3 text-center">
                      <p className="text-[10px] font-bold uppercase text-indigo-700">% Reducido</p>
                      <p className="text-sm font-extrabold text-indigo-900">
                        {ledgerResult.summary.pctReduced.toFixed(1)}%
                      </p>
                    </div>

                    <div className="rounded-2xl border border-purple-200 bg-purple-50 p-3 text-center">
                      <p className="text-[10px] font-bold uppercase text-purple-700">Total pagado</p>
                      <p className="text-sm font-extrabold text-purple-900">
                        {currencySymbol} {ledgerResult.summary.totalCashPaid.toFixed(2)}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-center">
                      <p className="text-[10px] font-bold uppercase text-amber-700">Intereses pagados</p>
                      <p className="text-sm font-extrabold text-amber-900">
                        {currencySymbol} {ledgerResult.summary.totalInterestPaid.toFixed(2)}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center col-span-2 sm:col-span-1">
                      <p className="text-[10px] font-bold uppercase text-slate-500">Otros costos</p>
                      <p className="text-sm font-extrabold text-slate-900">
                        {currencySymbol} {ledgerResult.summary.totalOtherCosts.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {/* Payment history table */}
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 mb-3">Historial de pagos y saldo resultantes</h3>
                    {ledgerResult.items.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-slate-500">
                        No has registrado pagos todavía.
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500 border-b border-slate-200">
                            <tr>
                              <th className="px-4 py-3">Fecha</th>
                              <th className="px-4 py-3">Operación</th>
                              <th className="px-4 py-3 text-right">Pago total</th>
                              <th className="px-4 py-3 text-right">A capital</th>
                              <th className="px-4 py-3 text-right">Interés</th>
                              <th className="px-4 py-3 text-right">Otros costos</th>
                              <th className="px-4 py-3 text-right">Saldo después</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {ledgerResult.items.map((item) => (
                              <tr key={item.id} className={item.isReversed ? "opacity-40 bg-slate-50" : "hover:bg-slate-50/50"}>
                                <td className="px-4 py-3 font-semibold text-slate-800">{item.formattedDate}</td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-semibold text-slate-900">{item.eventType}</span>
                                    {!item.breakdownComplete && (
                                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                                        Desglose incompleto
                                      </span>
                                    )}
                                    {(item.extraPrincipalAmount ?? 0) > 0 && (
                                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-800">
                                        Extra capital {currencySymbol} {(item.extraPrincipalAmount ?? 0).toFixed(2)}{item.prepaymentEffect ? ` · ${item.prepaymentEffect}` : ""}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-right font-extrabold text-blue-900">
                                  {currencySymbol} {item.cashAmount.toFixed(2)}
                                </td>
                                <td className="px-4 py-3 text-right font-bold text-emerald-700">
                                  {currencySymbol} {item.principalDelta.toFixed(2)}
                                </td>
                                <td className="px-4 py-3 text-right font-semibold text-slate-700">
                                  {currencySymbol} {item.interestPaid.toFixed(2)}
                                </td>
                                <td className="px-4 py-3 text-right font-semibold text-slate-700">
                                  {currencySymbol} {item.totalOtherCosts.toFixed(2)}
                                </td>
                                <td className="px-4 py-3 text-right font-black text-slate-900">
                                  {currencySymbol} {item.principalBalanceAfter.toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Regular schedule view for fixed-schedule debts */
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-slate-900">
                      {pendingBankSchedule ? "Último cronograma registrado" : "Cronograma vigente"} {currentSchedule ? `(Versión #${currentSchedule.versionNumber})` : ""}
                    </h3>
                    {currentSchedule && (
                      <div className="text-right text-xs font-bold text-slate-600">
                        <p>Fuente: {currentSchedule.scheduleSource === "contractual" ? "Contractual" : currentSchedule.scheduleSource === "estimated" ? "Estimado" : "Manual"}</p>
                        <p>{currentSchedule.isAuthoritative ? "Cronograma autoritativo" : "No autoritativo"}</p>
                      </div>
                    )}
                  </div>
                  {pendingBankSchedule ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
                      <p>No se muestran cuotas como vigentes porque el banco todavía no entregó el cronograma posterior al abono extraordinario.</p>
                      <p className="mt-1 text-xs font-medium text-amber-800">La versión anterior permanece en el historial y no se usa para calcular obligaciones futuras.</p>
                    </div>
                  ) : debtInstallments.length === 0 ? (
                    <p className="text-sm text-slate-500 italic">No hay cuotas registradas en el cronograma actual.</p>
                  ) : (
                    <div className="space-y-3">
                      {debtInstallments.map((inst) => {
                        const prog = getInstallmentProgress(inst, allocations, debtEvents);
                        return (
                          <div
                            key={inst.id}
                            className="flex flex-col gap-2 rounded-2xl border border-slate-200 p-4 bg-slate-50/50 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900">Cuota #{inst.installmentNumber}</span>
                                <span className="text-xs text-slate-500">Vence: {formatReviewDate(inst.dueDate)}</span>
                                {prog.isPaid && (
                                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                                    Pagada
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-sm text-slate-600">
                                Esperado:{" "}
                                {inst.expectedAmount != null
                                  ? `${currencySymbol} ${inst.expectedAmount.toFixed(2)} (Principal: ${inst.expectedPrincipal ?? 0} | Interés: ${inst.expectedInterest ?? 0})`
                                  : "Por confirmar"}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-bold text-slate-900">
                                Pagado: {currencySymbol} {prog.allocated.toFixed(2)}
                              </p>
                              <div className="mt-1 h-2 w-32 bg-slate-200 rounded-full overflow-hidden inline-block">
                                <div
                                  className="h-full bg-emerald-500"
                                  style={{ width: `${prog.progressPercent}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "collaterals" && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Garantías asociadas</h3>
              {debtCollaterals.length === 0 ? (
                <p className="text-sm text-slate-500 italic">No hay garantías registradas para esta deuda.</p>
              ) : (
                <div className="space-y-3">
                  {debtCollaterals.map((c) => (
                    <div key={c.id} className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
                      <div className="flex items-center justify-between">
                        <p className="font-bold text-slate-900">{c.description}</p>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                            c.status === "pledged"
                              ? "bg-amber-100 text-amber-800"
                              : c.status === "released"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {c.status === "pledged" ? "En garantía (Empeñado)" : c.status === "released" ? "Liberado" : "Ejecutado"}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-slate-600 sm:grid-cols-3">
                        <p>Valor estimado: {c.estimatedValue != null ? `${currencySymbol} ${c.estimatedValue}` : "—"}</p>
                        <p>Valor en prenda: {c.pledgedValue != null ? `${currencySymbol} ${c.pledgedValue}` : "—"}</p>
                        <p>Límite recuperación: {formatReviewDate(c.redemptionDeadline)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "history" && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Historial completo de eventos</h3>
              {allEventsForDebt.length === 0 ? (
                <p className="text-sm text-slate-500 italic">No hay eventos registrados.</p>
              ) : (
                <div className="space-y-3">
                  {(() => {
                    const reversedEventIds = new Set(
                      allEventsForDebt
                        .filter((e) => e.eventType === "reversal" && e.reversalOfEventId)
                        .map((e) => e.reversalOfEventId!)
                    );
                    return allEventsForDebt.map((e) => {
                      const isReversed = reversedEventIds.has(e.id);
                      return (
                        <div
                          key={e.id}
                          className={`flex items-center justify-between rounded-2xl border p-4 ${
                            isReversed ? "border-slate-200 bg-slate-100 opacity-60" : "border-slate-200 bg-slate-50"
                          }`}
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900">{formatEventType(e.eventType)}</span>
                              <span className="text-xs text-slate-500">Fecha: {formatReviewDate(e.eventDate)}</span>
                              {isReversed && (
                                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">Revertido</span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              Cash: {currencySymbol} {e.cashAmount.toFixed(2)} | Principal Δ: {currencySymbol} {e.principalDelta.toFixed(2)} | Interés: {currencySymbol} {e.interestPaid.toFixed(2)}
                            </p>
                            {(e.extraPrincipalAmount ?? 0) > 0 && <p className="mt-1 text-xs font-semibold text-indigo-700">Capital extraordinario: {currencySymbol} {(e.extraPrincipalAmount ?? 0).toFixed(2)}{e.prepaymentEffect ? ` · Efecto: ${e.prepaymentEffect}` : ""}</p>}
                            {e.description && <p className="mt-1 text-xs text-slate-600">{e.description}</p>}
                          </div>
                          {!isReversed && e.eventType !== "reversal" && canWriteDebt && debt.status === "active" && (
                            <button
                              type="button"
                              onClick={() => onOpenOperation("reversal", e.id)}
                              className="flex items-center gap-1 rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 shadow-sm"
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> Revertir
                            </button>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="rounded-full bg-rose-100 p-2">
                <Trash2 className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">¿Eliminar esta deuda?</h3>
            </div>
            <p className="text-sm text-slate-600">
              Esta deuda todavía no tiene movimientos registrados. Al eliminarla se borrará definitivamente su configuración y no aparecerá como archivada.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleDeletePristine}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50 shadow-sm"
              >
                {submitting ? "Eliminando..." : "Eliminar definitivamente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
