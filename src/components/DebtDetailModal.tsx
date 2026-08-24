import { useState } from "react";
import { X, DollarSign, ArrowUpRight, CheckCircle2, RotateCcw, Settings, ShieldAlert } from "lucide-react";
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
import { setDebtArchived, updateDebtMetadata, updateDebtTerms } from "../services/dataRepository";
import { buildDebtPaymentLedger } from "../utils/debtPaymentLedger";
import { getCurrencySymbol, formatReviewDate } from "../utils/debtFormMode";
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
  allDebts?: Debt[];
  canWriteDebt?: boolean;
  onClose: () => void;
  onOpenOperation: (
    operationType: "payment" | "prepayment" | "payoff" | "reversal",
    targetEventId?: string
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

  const [submitting, setSubmitting] = useState(false);

  if (debt.debtKind === "credit_card") {
    const cardProfile = creditCardProfiles?.find((p) => p.debtId === debt.id) ?? null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
        <button type="button" className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={onClose} />
        <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-3xl bg-white shadow-2xl overflow-y-auto p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
            <h2 className="text-xl font-bold text-slate-900">Detalle de Tarjeta de Crédito</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200 transition"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
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
      </div>
    );
  }

  const currentSchedule = currentDebtScheduleVersion(debt.id, scheduleVersions);
  const debtInstallments = installments.filter(
    (i) => currentSchedule && i.scheduleVersionId === currentSchedule.id
  );
  const debtCollaterals = collaterals.filter((c) => c.debtId === debt.id);
  const allEventsForDebt = debtEvents.filter((e) => e.debtId === debt.id);
  const ledgerResult = buildDebtPaymentLedger(debt, allEventsForDebt);
  const currencySymbol = getCurrencySymbol(debt.currencyCode);
  const isFlexOpenEnded = debt.repaymentStructure === "open_ended";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-3xl bg-white shadow-2xl overflow-hidden">
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
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200 transition"
          >
            <X className="h-6 w-6" />
          </button>
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
              {isFlexOpenEnded ? "Avance y pagos" : `Cronograma (${debtInstallments.length})`}
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
                    onClick={() => onOpenOperation("prepayment")}
                    className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-indigo-700"
                  >
                    <ArrowUpRight className="h-4 w-4" /> Prepago
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
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6">
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
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Saldo principal actual</p>
                    <p className="text-3xl font-extrabold text-blue-900">
                      {formatDebtMoney(debtIntelligence.currentPrincipal, debtIntelligence.currencyCode)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Principal inicial de apertura: {formatDebtMoney(debt.openingPrincipalBalance, debt.currencyCode)}
                    </p>
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

              {/* Comprehensive Intelligence & Analysis Panel */}
              <DebtAnalysisPanel intelligence={debtIntelligence} />

              {/* Decision Support & Interest Terms */}
              <div className="rounded-2xl border border-slate-200 p-5 space-y-3 bg-slate-50/40">
                <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Términos y Tasas de la Deuda</h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-sm">
                  <div>
                    <p className="text-xs text-slate-500 font-medium">Estructura de pago</p>
                    <p className="font-bold text-slate-900">
                      {debt.repaymentStructure === "open_ended"
                        ? "Sin plazo fijo (Flexibles)"
                        : debt.repaymentStructure === "fixed_schedule"
                        ? "Con cuotas / plazo fijo"
                        : "No especificado"}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-slate-500 font-medium">Cálculo de interés</p>
                    <p className="font-bold text-slate-900">
                      {debt.interestCalculationMode === "contract_periodic_rate" && debt.periodicRatePercent != null
                        ? `Tasa contractual: ${debt.periodicRatePercent}% ${debt.periodicRateBasis || "mensual"}`
                        : debt.teaPercent != null
                        ? `TEA: ${debt.teaPercent}%`
                        : "Manual / No especificado"}
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
                      Cronograma vigente {currentSchedule ? `(Versión #${currentSchedule.versionNumber})` : ""}
                    </h3>
                  </div>
                  {debtInstallments.length === 0 ? (
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
                  {allEventsForDebt.map((e) => (
                    <div
                      key={e.id}
                      className={`flex items-center justify-between rounded-2xl border p-4 ${
                        e.isReversed ? "border-slate-200 bg-slate-100 opacity-60" : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">{formatEventType(e.eventType)}</span>
                          <span className="text-xs text-slate-500">Fecha: {formatReviewDate(e.eventDate)}</span>
                          {e.isReversed && (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">Revertido</span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          Cash: {currencySymbol} {e.cashAmount.toFixed(2)} | Principal Δ: {currencySymbol} {e.principalDelta.toFixed(2)} | Interés: {currencySymbol} {e.interestPaid.toFixed(2)}
                        </p>
                        {e.notes && <p className="mt-1 text-xs text-slate-600">{e.notes}</p>}
                      </div>
                      {!e.isReversed && e.eventType !== "reversal" && canWriteDebt && debt.status === "active" && (
                        <button
                          type="button"
                          onClick={() => onOpenOperation("reversal", e.id)}
                          className="flex items-center gap-1 rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 shadow-sm"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Revertir
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
