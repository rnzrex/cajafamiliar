import { useState } from "react";
import { X, Calendar, DollarSign, Shield, FileText, ArrowUpRight, History, CheckCircle2, RotateCcw } from "lucide-react";
import type { Debt, DebtEvent, DebtScheduleVersion, DebtInstallment, DebtEventInstallmentAllocation, DebtCollateral, FinancialAccount, Category, HouseholdMember } from "../types";
import { currentDebtPrincipal, currentDebtScheduleVersion, effectiveDebtEvents } from "../utils/debtCalculations";
import { formatDebtKind, formatDebtStatus, formatPaymentFrequency, formatEventType, getInstallmentProgress, translateDebtError } from "../utils/debtViewModel";
import { setDebtArchived, updateDebtMetadata } from "../services/dataRepository";

interface DebtDetailModalProps {
  debt: Debt;
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
  onOpenOperation: (operationType: "payment" | "prepayment" | "payoff" | "reversal", targetEventId?: string) => void;
  onRefresh: () => Promise<void> | void;
  setToast: (toast: { message: string; type: "success" | "error" }) => void;
}

export function DebtDetailModal({
  debt,
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

  const currentPrincipal = currentDebtPrincipal(debt, debtEvents);
  const currentSchedule = currentDebtScheduleVersion(debt.id, scheduleVersions);
  const debtInstallments = installments.filter((i) => currentSchedule && i.scheduleVersionId === currentSchedule.id);
  const debtCollaterals = collaterals.filter((c) => c.debtId === debt.id);
  const activeEvents = effectiveDebtEvents(debtEvents, debt.id);
  const allEventsForDebt = debtEvents.filter((e) => e.debtId === debt.id);

  const handleToggleArchive = async () => {
    if (!canWriteDebt || (typeof navigator !== "undefined" && !navigator.onLine)) {
      setToast({ message: "Las operaciones de deuda requieren conexión a internet y estado habilitado.", type: "error" });
      return;
    }
    setSubmitting(true);
    try {
      await setDebtArchived({ debtId: debt.id, isArchived: !debt.isArchived });
      setToast({ message: debt.isArchived ? "Deuda reactivada." : "Deuda archivada.", type: "success" });
      await onRefresh();
    } catch (err) {
      setToast({ message: translateDebtError(err), type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteDebt || (typeof navigator !== "undefined" && !navigator.onLine)) {
      setToast({ message: "Las operaciones de deuda requieren conexión a internet y estado habilitado.", type: "error" });
      return;
    }
    setSubmitting(true);
    try {
      await updateDebtMetadata({
        debtId: debt.id,
        name: editName.trim(),
        creditorName: editCreditor.trim(),
        notes: editNotes.trim(),
      });
      setToast({ message: "Metadata actualizada exitosamente.", type: "success" });
      setIsEditingMetadata(false);
      await onRefresh();
    } catch (err) {
      setToast({ message: translateDebtError(err), type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-3xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">{formatDebtKind(debt.debtKind)}</span>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${debt.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-800"}`}>
                {formatDebtStatus(debt.status)}
              </span>
              {debt.isArchived && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">Archivada</span>}
            </div>
            <h2 className="mt-1 text-2xl font-bold text-slate-900">{debt.name}</h2>
            <p className="text-sm text-slate-500">Acreedor: {debt.creditorName}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-slate-200 p-2.5 text-slate-700 hover:bg-slate-300">
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white px-6 py-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("overview")}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition ${activeTab === "overview" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
              Resumen
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("schedule")}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition ${activeTab === "schedule" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
              Cronograma ({debtInstallments.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("collaterals")}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition ${activeTab === "collaterals" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
              Garantías ({debtCollaterals.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition ${activeTab === "history" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
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
                    <button type="button" onClick={() => setIsEditingMetadata(false)} className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600">
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
                      {debt.currencyCode} {currentPrincipal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Principal inicial de apertura: {debt.openingPrincipalBalance.toLocaleString()}</p>
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
                      <div key={inst.id} className="flex flex-col gap-2 rounded-2xl border border-slate-200 p-4 bg-slate-50/50 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">Cuota #{inst.installmentNumber}</span>
                            <span className="text-xs text-slate-500">Vence: {inst.dueDate}</span>
                            {prog.isPaid && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">Pagada</span>}
                          </div>
                          <p className="mt-1 text-sm text-slate-600">
                            Esperado: {debt.currencyCode} {inst.expectedAmount ?? 0} (Principal: {inst.expectedPrincipal ?? 0} | Interés: {inst.expectedInterest ?? 0})
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-slate-900">
                            Pagado: {debt.currencyCode} {prog.allocated.toFixed(2)}
                          </p>
                          <div className="mt-1 h-2 w-32 bg-slate-200 rounded-full overflow-hidden inline-block">
                            <div className="h-full bg-emerald-500" style={{ width: `${prog.progressPercent}%` }} />
                          </div>
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
              <h3 className="text-lg font-bold text-slate-900">Garantías y colaterales</h3>
              {debtCollaterals.length === 0 ? (
                <p className="text-sm text-slate-500 italic">No hay garantías registradas para esta deuda.</p>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {debtCollaterals.map((col) => (
                    <div key={col.id} className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
                      <p className="font-bold text-slate-900">{col.description}</p>
                      <p className="mt-1 text-sm text-slate-600">Estado: {col.status}</p>
                      {col.estimatedValue != null && <p className="text-sm font-semibold text-blue-700">Valor estimado: {col.estimatedValue}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "history" && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Historial de la deuda</h3>
              {allEventsForDebt.length === 0 ? (
                <p className="text-sm text-slate-500 italic">No se han registrado operaciones financieras.</p>
              ) : (
                <div className="space-y-3">
                  {allEventsForDebt.map((ev) => {
                    const isReversal = ev.eventType === "reversal";
                    const isReversed = activeEvents.find((ae) => ae.id === ev.id) === undefined && !isReversal;
                    const isSupportedReversal = ["payment", "principal_prepayment", "payoff"].includes(ev.eventType);
                    const canReverse = !isReversal && !isReversed && !debt.isArchived && debt.status !== "refinanced" && isSupportedReversal && canWriteDebt;
                    return (
                      <div key={ev.id} className="flex flex-col gap-2 rounded-2xl border border-slate-200 p-4 bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-800">{formatEventType(ev.eventType)}</span>
                            <span className="text-xs text-slate-500">{ev.eventDate}</span>
                            {isReversed && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">Revertido</span>}
                          </div>
                          <p className="mt-1 text-sm font-medium text-slate-900">{ev.description || "Sin descripción"}</p>
                          <p className="text-xs text-slate-500">Monto: {debt.currencyCode} {ev.cashAmount} | Capital aplicado: {debt.currencyCode} {Math.max(0, -ev.principalDelta).toFixed(2)}</p>
                        </div>
                        {canReverse && (
                          <button
                            type="button"
                            onClick={() => onOpenOperation("reversal", ev.id)}
                            className="flex items-center gap-1 rounded-xl bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 self-start sm:self-center"
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> Revertir
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
