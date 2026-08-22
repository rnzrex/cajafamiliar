import { useState } from "react";
import { X, DollarSign, ArrowUpRight, CheckCircle2 } from "lucide-react";
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
import { setDebtArchived, updateDebtMetadata } from "../services/dataRepository";
import { DebtAnalysisPanel } from "./DebtAnalysisPanel";

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
  canWriteDebt = true,
  onClose,
  onOpenOperation,
  onRefresh,
  setToast,
}: DebtDetailModalProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "schedule" | "collaterals" | "history">("overview");
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [editName, setEditName] = useState(debt.name);
  const [editCreditor, setEditCreditor] = useState(debt.creditorName);
  const [editNotes, setEditNotes] = useState(debt.notes);
  const [submitting, setSubmitting] = useState(false);

  const currentSchedule = currentDebtScheduleVersion(debt.id, scheduleVersions);
  const debtInstallments = installments.filter(
    (i) => currentSchedule && i.scheduleVersionId === currentSchedule.id
  );
  const debtCollaterals = collaterals.filter((c) => c.debtId === debt.id);
  const activeEvents = effectiveDebtEvents(debtEvents, debt.id);
  const allEventsForDebt = debtEvents.filter((e) => e.debtId === debt.id);

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
      setToast({
        message: "Las operaciones de deuda requieren conexión a internet y estado habilitado.",
        type: "error",
      });
      return;
    }
    setSubmitting(true);
    let success = false;
    try {
      await updateDebtMetadata({
        debtId: debt.id,
        name: editName.trim(),
        creditorName: editCreditor.trim(),
        notes: editNotes.trim(),
      });
      success = true;
      setToast({ message: "Metadata de deuda actualizada.", type: "success" });
      setIsEditingMetadata(false);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-3xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 p-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                {formatDebtKind(debt.debtKind)}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  debt.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"
                }`}
              >
                {formatDebtStatus(debt.status)}
              </span>
              {debt.isArchived && (
                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                  Archivada
                </span>
              )}
            </div>
            <h2 className="mt-1 text-2xl font-black text-slate-900">{debt.name}</h2>
            <p className="text-sm text-slate-500">Acreedor: {debt.creditorName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200 transition"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Toolbar & Tabs */}
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/50 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
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
              Cronograma ({debtInstallments.length})
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
                  <DollarSign className="h-4 w-4" /> Registrar pago
                </button>
                <button
                  type="button"
                  onClick={() => onOpenOperation("prepayment")}
                  className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-indigo-700"
                >
                  <ArrowUpRight className="h-4 w-4" /> Prepago
                </button>
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
              ) : (
                <div className="flex items-center justify-between rounded-2xl bg-blue-50/60 p-5">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Saldo principal actual</p>
                    <p className="text-3xl font-extrabold text-blue-900">
                      {formatDebtMoney(debtIntelligence.currentPrincipal, debtIntelligence.currencyCode)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Principal inicial de apertura: {formatDebtMoney(debt.openingPrincipalBalance, debt.currencyCode)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditingMetadata(true)}
                    className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-blue-700 shadow-sm hover:bg-blue-50"
                  >
                    Editar info
                  </button>
                </div>
              )}

              {/* Comprehensive Intelligence & Analysis Panel */}
              <DebtAnalysisPanel intelligence={debtIntelligence} />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs font-bold uppercase text-slate-400">Frecuencia de pago</p>
                  <p className="mt-1 text-lg font-bold text-slate-800">{formatPaymentFrequency(debt.paymentFrequency)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs font-bold uppercase text-slate-400">Tasa TEA / TCEA</p>
                  <p className="mt-1 text-lg font-bold text-slate-800">
                    {debt.teaPercent != null ? `${debt.teaPercent}% TEA` : "No especificada"}
                    {debt.tceaPercent != null ? ` / ${debt.tceaPercent}% TCEA` : ""}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs font-bold uppercase text-slate-400">Inicio de seguimiento</p>
                  <p className="mt-1 text-lg font-bold text-slate-800">{debt.trackingStartDate}</p>
                </div>
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
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-900">
                  Cronograma activo ({currentSchedule ? `Versión ${currentSchedule.versionNumber}` : "Sin cronograma"})
                </h3>
              </div>
              {debtInstallments.length === 0 ? (
                <p className="text-sm text-slate-500">No hay cuotas registradas para esta versión del cronograma.</p>
              ) : (
                <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white overflow-hidden">
                  {debtInstallments.map((inst) => {
                    const progress = getInstallmentProgress(inst, allocations, activeEvents);
                    return (
                      <div key={inst.id} className="flex items-center justify-between p-4 hover:bg-slate-50">
                        <div>
                          <p className="text-sm font-bold text-slate-900">Cuota N° {inst.installmentNumber}</p>
                          <p className="text-xs text-slate-500">Vencimiento: {inst.dueDate}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-extrabold text-slate-900">
                            {inst.expectedAmount != null
                              ? formatDebtMoney(inst.expectedAmount, debt.currencyCode)
                              : "Por confirmar"}
                          </p>
                          <span
                            className={`inline-block rounded-md px-2 py-0.5 text-xs font-bold ${
                              progress.isPaid ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {progress.isPaid ? "Cubierta" : "Pendiente"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === "collaterals" && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Garantías declaradas</h3>
              {debtCollaterals.length === 0 ? (
                <p className="text-sm text-slate-500">No se han registrado garantías para esta deuda.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {debtCollaterals.map((c) => (
                    <div key={c.id} className="rounded-2xl border border-slate-200 p-4 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">{c.description}</span>
                        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                          {c.status}
                        </span>
                      </div>
                      {c.pledgedValue != null && (
                        <p className="text-xs text-slate-600">
                          Valor en garantía: {formatDebtMoney(c.pledgedValue, debt.currencyCode)}
                        </p>
                      )}
                      {c.redemptionDeadline && (
                        <p className="text-xs text-slate-500">Plazo rescate: {c.redemptionDeadline}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "history" && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Historial de eventos</h3>
              {allEventsForDebt.length === 0 ? (
                <p className="text-sm text-slate-500">No hay eventos registrados para esta deuda.</p>
              ) : (
                <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white overflow-hidden">
                  {allEventsForDebt.map((ev) => (
                    <div key={ev.id} className="flex items-center justify-between p-4 hover:bg-slate-50">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">{formatEventType(ev.eventType)}</span>
                          <span className="text-xs text-slate-400">{ev.eventDate}</span>
                        </div>
                        {ev.description && <p className="text-xs text-slate-500 mt-0.5">{ev.description}</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-extrabold text-slate-900">
                          {formatDebtMoney(ev.cashAmount, debt.currencyCode)}
                        </p>
                        <p className="text-xs text-slate-500">
                          Principal: {formatDebtMoney(-ev.principalDelta, debt.currencyCode)}
                        </p>
                      </div>
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
