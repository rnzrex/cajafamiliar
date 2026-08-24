import { useState } from "react";
import { ArrowLeft, AlertCircle } from "lucide-react";
import type { Debt, FinancialAccount, Category, DebtInstallment, DebtScheduleVersion, DebtEvent, DebtEventInstallmentAllocation } from "../types";
import { recordDebtPayment, recordDebtPrepayment, recordDebtPayoff, reverseDebtEvent } from "../services/dataRepository";
import { makeUuid } from "../utils/storage";
import { localDateString } from "../utils/date";
import { translateDebtError, validateDebtPayment, validateDebtPrepayment, validateDebtPayoff, validateDebtAllocations, debtEconomicSummary } from "../utils/debtViewModel";
import { currentDebtScheduleVersion, allocatedAmountForInstallment } from "../utils/debtCalculations";

interface DebtOperationFormProps {
  debt: Debt;
  operationType: "payment" | "prepayment" | "payoff" | "reversal";
  targetEventId?: string;
  installments: DebtInstallment[];
  scheduleVersions: DebtScheduleVersion[];
  debtEvents: DebtEvent[];
  accounts: FinancialAccount[];
  categories: Category[];
  currentPrincipal: number;
  canWriteDebt?: boolean;
  persistedAllocations: DebtEventInstallmentAllocation[];
  onSaved: () => Promise<void>;
  onCancel: () => void;
  setToast: (toast: { message: string; type: "success" | "error" }) => void;
}

export function DebtOperationForm({
  debt,
  operationType,
  targetEventId,
  installments,
  scheduleVersions,
  debtEvents,
  accounts,
  categories,
  currentPrincipal,
  canWriteDebt = true,
  persistedAllocations,
  onSaved,
  onCancel,
  setToast,
}: DebtOperationFormProps) {
  const [eventId] = useState(() => makeUuid());
  const [movementId] = useState(() => makeUuid());
  const [reversalEventId] = useState(() => makeUuid());

  const [eventDate, setEventDate] = useState(localDateString(new Date()));
  const [cashAmount, setCashAmount] = useState(operationType === "payoff" ? currentPrincipal.toString() : "");

  const activeAccounts = accounts.filter((acc) => acc.isActive !== false);
  const [accountId, setAccountId] = useState(activeAccounts[0]?.id ?? "");

  const isFlexOpenEnded = debt.repaymentStructure === "open_ended";

  const [description, setDescription] = useState(
    operationType === "payment"
      ? isFlexOpenEnded
        ? `Pago de deuda — ${debt.name}`
        : `Pago de cuota — ${debt.name}`
      : operationType === "prepayment"
        ? `Prepago de principal — ${debt.name}`
        : operationType === "payoff"
          ? `Liquidación total — ${debt.name}`
          : `Reversión de registro — ${debt.name}`
  );

  const activeCategories = categories.filter((c) => c.is_active && (c.type === "egreso" || c.type === "ambos"));
  const defaultCategory = activeCategories.find((c) => c.name.toLowerCase() === "préstamos")?.name ?? activeCategories[0]?.name ?? "";
  const [category, setCategory] = useState(defaultCategory);

  const [principalAmount, setPrincipalAmount] = useState(operationType === "payoff" ? currentPrincipal.toString() : "");
  const [interestPaid, setInterestPaid] = useState("0");
  const [feesPaid, setFeesPaid] = useState("0");
  const [insurancePaid, setInsurancePaid] = useState("0");
  const [otherCostPaid, setOtherCostPaid] = useState("0");
  const [breakdownComplete, setBreakdownComplete] = useState(true);

  const currentSchedule = currentDebtScheduleVersion(debt.id, scheduleVersions);
  const currentScheduleInstallments = installments.filter((i) => currentSchedule && i.scheduleVersionId === currentSchedule.id);
  const [allocations, setAllocations] = useState<Array<{ installmentId: string; allocatedAmount: string }>>([]);

  const [hasNewPrepaymentSchedule, setHasNewPrepaymentSchedule] = useState(false);

  const targetGeneratedSchedule = Boolean(targetEventId && scheduleVersions.some((v) => v.debtId === debt.id && v.triggerEventId === targetEventId));

  const [scheduleInstallments, setScheduleInstallments] = useState<Array<{
    installmentNumber: number;
    dueDate: string;
    expectedAmount: string;
    expectedPrincipal: string;
    expectedInterest: string;
  }>>([]);
  const [scheduleNotes, setScheduleNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const numCash = Number(cashAmount || 0);
  const numPrincipal = Number(principalAmount || 0);
  const numInterest = Number(interestPaid || 0);
  const numFees = Number(feesPaid || 0);
  const numInsurance = Number(insurancePaid || 0);
  const numOtherCost = Number(otherCostPaid || 0);
  const summary = debtEconomicSummary(
    numCash,
    operationType === "payoff" ? currentPrincipal : numPrincipal,
    numInterest,
    numFees,
    numInsurance,
    numOtherCost,
    operationType === "payoff" ? currentPrincipal : undefined
  );

  const isAccountMissing = operationType !== "reversal" && !accountId;
  const hasNoActiveAccounts = operationType !== "reversal" && activeAccounts.length === 0;

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
    } else if (operationType === "prepayment") {
      if (hasNewPrepaymentSchedule && scheduleInstallments.length === 0) {
        setToast({ message: "Debe ingresar al menos una cuota en el nuevo cronograma.", type: "error" });
        return;
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
    }

    setSubmitting(true);
    let rpcExecuted = false;
    try {
      if (operationType === "payment") {
        await recordDebtPayment({
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
            .map((a) => ({
              installmentId: a.installmentId,
              allocatedAmount: Number(a.allocatedAmount),
            })),
        });
      } else if (operationType === "prepayment") {
        await recordDebtPrepayment({
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
          scheduleInstallments: hasNewPrepaymentSchedule
            ? scheduleInstallments.map((s, idx) => ({
                installmentNumber: idx + 1,
                dueDate: s.dueDate,
                expectedAmount: s.expectedAmount ? Number(s.expectedAmount) : null,
                expectedPrincipal: s.expectedPrincipal ? Number(s.expectedPrincipal) : null,
                expectedInterest: s.expectedInterest ? Number(s.expectedInterest) : null,
              }))
            : [],
          scheduleNotes: scheduleNotes || null,
        });
      } else if (operationType === "payoff") {
        await recordDebtPayoff({
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
      } else if (operationType === "reversal") {
        if (!targetEventId) {
          setToast({ message: "ID de registro objetivo no especificado para reversión.", type: "error" });
          setSubmitting(false);
          return;
        }
        await reverseDebtEvent({
          debtId: debt.id,
          reversalEventId,
          targetEventId,
          eventDate,
          description: description.trim(),
          scheduleInstallments: targetGeneratedSchedule
            ? scheduleInstallments.map((s, idx) => ({
                installmentNumber: idx + 1,
                dueDate: s.dueDate,
                expectedAmount: s.expectedAmount ? Number(s.expectedAmount) : null,
                expectedPrincipal: s.expectedPrincipal ? Number(s.expectedPrincipal) : null,
                expectedInterest: s.expectedInterest ? Number(s.expectedInterest) : null,
              }))
            : [],
          scheduleNotes: scheduleNotes || null,
        });
      }

      rpcExecuted = true;
      setToast({ message: "Operación de deuda registrada exitosamente.", type: "success" });
      await onSaved();
    } catch (err) {
      if (!rpcExecuted) {
        setToast({ message: translateDebtError(err), type: "error" });
      } else {
        setToast({ message: "Operación registrada exitosamente, pero falló la actualización de datos locales.", type: "error" });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const titleMap = {
    payment: isFlexOpenEnded ? "Registrar pago" : "Registrar pago de cuota",
    prepayment: "Registrar prepago de principal",
    payoff: "Liquidar deuda",
    reversal: "Revertir registro",
  };

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
                <label className="block text-sm font-semibold text-slate-700">Salida de dinero (Caja/Banco) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={cashAmount}
                  onChange={(e) => setCashAmount(e.target.value)}
                  placeholder="0.00"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700">Categoría</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                >
                  {activeCategories.map((cat) => (
                    <option key={cat.id} value={cat.name}>
                      {cat.name}
                    </option>
                  ))}
                </select>
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

          {operationType !== "payoff" && operationType !== "reversal" && (
            <div>
              <label className="block text-sm font-semibold text-slate-700">Capital aplicado *</label>
              <input
                type="number"
                step="0.01"
                required
                value={principalAmount}
                onChange={(e) => setPrincipalAmount(e.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
              />
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
                  onChange={(e) => setInterestPaid(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700">Comisiones pagadas</label>
                <input
                  type="number"
                  step="0.01"
                  value={feesPaid}
                  onChange={(e) => setFeesPaid(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700">Seguros pagados</label>
                <input
                  type="number"
                  step="0.01"
                  value={insurancePaid}
                  onChange={(e) => setInsurancePaid(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700">Costo adicional / financiero</label>
                <input
                  type="number"
                  step="0.01"
                  value={otherCostPaid}
                  onChange={(e) => setOtherCostPaid(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
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

        {operationType === "payment" && currentScheduleInstallments.length > 0 && (
          <div className="rounded-2xl border border-slate-200 p-4">
            <h3 className="text-lg font-bold text-slate-800 mb-2">Asignación a cuotas del cronograma vigente</h3>
            <p className="text-xs text-slate-500 mb-3">Versión #{currentSchedule?.versionNumber}</p>
            <div className="space-y-3">
              {currentScheduleInstallments.map((inst) => {
                const allocatedBefore = allocatedAmountForInstallment(inst.id, persistedAllocations, debtEvents);
                const remaining = inst.expectedAmount == null || !Number.isFinite(inst.expectedAmount) ? null : Math.max(0, inst.expectedAmount - allocatedBefore);
                const isPaid = remaining !== null && remaining <= 0;
                const currentDraftAllocation = allocations.find((a) => a.installmentId === inst.id)?.allocatedAmount ?? "";
                return (
                  <div key={inst.id} className="flex items-center justify-between bg-slate-50 p-3 rounded-xl">
                    <div>
                      <p className="text-sm font-bold text-slate-800">Cuota #{inst.installmentNumber} (Vence: {inst.dueDate})</p>
                      <p className="text-xs text-slate-500">
                        Aplicado: S/ {allocatedBefore.toFixed(2)} {remaining !== null ? `| Esperado: S/ ${inst.expectedAmount!.toFixed(2)} | Restante: S/ ${remaining.toFixed(2)}` : "| Monto esperado no especificado"}
                      </p>
                    </div>
                    {isPaid ? (
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
          </div>
        )}

        {operationType === "prepayment" && (
          <div className="rounded-2xl border border-slate-200 p-4 space-y-4">
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
                <button
                  type="button"
                  onClick={() =>
                    setScheduleInstallments([
                      ...scheduleInstallments,
                      { installmentNumber: scheduleInstallments.length + 1, dueDate: localDateString(new Date()), expectedAmount: "", expectedPrincipal: "", expectedInterest: "" },
                    ])
                  }
                  className="rounded-xl bg-blue-50 px-3 py-1.5 text-sm font-bold text-blue-700 hover:bg-blue-100"
                >
                  Agregar cuota al nuevo cronograma
                </button>
                {scheduleInstallments.map((s, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-4 gap-2 bg-slate-50 p-3 rounded-xl items-center">
                    <div>
                      <label className="block text-xs text-slate-500">Vencimiento</label>
                      <input
                        type="date"
                        value={s.dueDate}
                        onChange={(e) => {
                          const copy = [...scheduleInstallments];
                          copy[idx].dueDate = e.target.value;
                          setScheduleInstallments(copy);
                        }}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500">Monto esperado</label>
                      <input
                        type="number"
                        step="0.01"
                        value={s.expectedAmount}
                        onChange={(e) => {
                          const copy = [...scheduleInstallments];
                          copy[idx].expectedAmount = e.target.value;
                          setScheduleInstallments(copy);
                        }}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500">Capital</label>
                      <input
                        type="number"
                        step="0.01"
                        value={s.expectedPrincipal}
                        onChange={(e) => {
                          const copy = [...scheduleInstallments];
                          copy[idx].expectedPrincipal = e.target.value;
                          setScheduleInstallments(copy);
                        }}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setScheduleInstallments(scheduleInstallments.filter((_, i) => i !== idx))}
                        className="rounded-lg p-2 text-red-600 hover:bg-red-50 text-sm font-bold"
                      >
                        Eliminar
                      </button>
                    </div>
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
            <p className="text-xs text-slate-600">El evento que está revirtiendo generó un cronograma. Debe ingresar el cronograma resultante restaurado.</p>
            <button
              type="button"
              onClick={() =>
                setScheduleInstallments([
                  ...scheduleInstallments,
                  { installmentNumber: scheduleInstallments.length + 1, dueDate: localDateString(new Date()), expectedAmount: "", expectedPrincipal: "", expectedInterest: "" },
                ])
              }
              className="rounded-xl bg-amber-100 px-3 py-1.5 text-sm font-bold text-amber-900 hover:bg-amber-200"
            >
              Agregar cuota restaurada
            </button>
            {scheduleInstallments.map((s, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-4 gap-2 bg-white p-3 rounded-xl items-center shadow-sm">
                <div>
                  <label className="block text-xs text-slate-500">Vencimiento</label>
                  <input
                    type="date"
                    value={s.dueDate}
                    onChange={(e) => {
                      const copy = [...scheduleInstallments];
                      copy[idx].dueDate = e.target.value;
                      setScheduleInstallments(copy);
                    }}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">Monto esperado</label>
                  <input
                    type="number"
                    step="0.01"
                    value={s.expectedAmount}
                    onChange={(e) => {
                      const copy = [...scheduleInstallments];
                      copy[idx].expectedAmount = e.target.value;
                      setScheduleInstallments(copy);
                    }}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">Capital</label>
                  <input
                    type="number"
                    step="0.01"
                    value={s.expectedPrincipal}
                    onChange={(e) => {
                      const copy = [...scheduleInstallments];
                      copy[idx].expectedPrincipal = e.target.value;
                      setScheduleInstallments(copy);
                    }}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setScheduleInstallments(scheduleInstallments.filter((_, i) => i !== idx))}
                    className="rounded-lg p-2 text-red-600 hover:bg-red-50 text-sm font-bold"
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
