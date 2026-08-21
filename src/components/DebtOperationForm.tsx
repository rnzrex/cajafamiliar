import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { Debt, FinancialAccount, Category, DebtInstallment } from "../types";
import { recordDebtPayment, recordDebtPrepayment, recordDebtPayoff, reverseDebtEvent } from "../services/dataRepository";
import { makeUuid } from "../utils/storage";
import { localDateString } from "../utils/date";
import { translateDebtError } from "../utils/debtViewModel";

interface DebtOperationFormProps {
  debt: Debt;
  operationType: "payment" | "prepayment" | "payoff" | "reversal";
  targetEventId?: string;
  installments: DebtInstallment[];
  accounts: FinancialAccount[];
  categories: Category[];
  currentPrincipal: number;
  onSaved: () => void;
  onCancel: () => void;
  setToast: (toast: { message: string; type: "success" | "error" }) => void;
}

export function DebtOperationForm({
  debt,
  operationType,
  targetEventId,
  installments,
  accounts,
  categories,
  currentPrincipal,
  onSaved,
  onCancel,
  setToast,
}: DebtOperationFormProps) {
  const [eventId] = useState(() => makeUuid());
  const [movementId] = useState(() => makeUuid());
  const [reversalEventId] = useState(() => makeUuid());

  const [eventDate, setEventDate] = useState(localDateString(new Date()));
  const [cashAmount, setCashAmount] = useState(operationType === "payoff" ? currentPrincipal.toString() : "");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [description, setDescription] = useState(
    operationType === "payment"
      ? `Pago de cuota — ${debt.name}`
      : operationType === "prepayment"
        ? `Prepago de principal — ${debt.name}`
        : operationType === "payoff"
          ? `Cancelación total — ${debt.name}`
          : `Reversión de operación — ${debt.name}`
  );
  const [category, setCategory] = useState(categories.find((c) => c.name.toLowerCase().includes("préstamo"))?.name ?? categories[0]?.name ?? "Préstamos");

  const [principalAmount, setPrincipalAmount] = useState(operationType === "payoff" ? currentPrincipal.toString() : "");
  const [interestPaid, setInterestPaid] = useState("0");
  const [feesPaid, setFeesPaid] = useState("0");
  const [insurancePaid, setInsurancePaid] = useState("0");
  const [otherCostPaid, setOtherCostPaid] = useState("0");
  const [breakdownComplete, setBreakdownComplete] = useState(true);

  // Allocations against installments
  const [allocations, setAllocations] = useState<Array<{ installmentId: string; allocatedAmount: string }>>([]);

  // Schedule installments for prepayment or reversal
  const [scheduleInstallments, setScheduleInstallments] = useState<Array<{
    installmentNumber: number;
    dueDate: string;
    expectedAmount: string;
    expectedPrincipal: string;
    expectedInterest: string;
  }>>([]);
  const [scheduleNotes, setScheduleNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setToast({ message: "Las operaciones de deuda requieren conexión a internet.", type: "error" });
      return;
    }

    if (!accountId) {
      setToast({ message: "Seleccione una cuenta financiera para registrar el movimiento.", type: "error" });
      return;
    }

    setSubmitting(true);
    try {
      if (operationType === "payment") {
        await recordDebtPayment({
          debtId: debt.id,
          eventId,
          movementId,
          eventDate,
          cashAmount: Number(cashAmount || 0),
          accountId,
          description: description.trim(),
          category,
          principalAmount: Number(principalAmount || 0),
          interestPaid: Number(interestPaid || 0),
          feesPaid: Number(feesPaid || 0),
          insurancePaid: Number(insurancePaid || 0),
          otherCostPaid: Number(otherCostPaid || 0),
          breakdownComplete,
          allocations: allocations.map((a) => ({
            installmentId: a.installmentId,
            allocatedAmount: Number(a.allocatedAmount || 0),
          })),
        });
      } else if (operationType === "prepayment") {
        await recordDebtPrepayment({
          debtId: debt.id,
          eventId,
          movementId,
          eventDate,
          cashAmount: Number(cashAmount || 0),
          accountId,
          description: description.trim(),
          category,
          principalAmount: Number(principalAmount || 0),
          interestPaid: Number(interestPaid || 0),
          feesPaid: Number(feesPaid || 0),
          insurancePaid: Number(insurancePaid || 0),
          otherCostPaid: Number(otherCostPaid || 0),
          breakdownComplete,
          scheduleInstallments: scheduleInstallments.map((s, idx) => ({
            installmentNumber: idx + 1,
            dueDate: s.dueDate,
            expectedAmount: s.expectedAmount ? Number(s.expectedAmount) : null,
            expectedPrincipal: s.expectedPrincipal ? Number(s.expectedPrincipal) : null,
            expectedInterest: s.expectedInterest ? Number(s.expectedInterest) : null,
          })),
          scheduleNotes: scheduleNotes || null,
        });
      } else if (operationType === "payoff") {
        await recordDebtPayoff({
          debtId: debt.id,
          eventId,
          movementId,
          eventDate,
          cashAmount: Number(cashAmount || currentPrincipal),
          accountId,
          description: description.trim(),
          category,
          interestPaid: Number(interestPaid || 0),
          feesPaid: Number(feesPaid || 0),
          insurancePaid: Number(insurancePaid || 0),
          otherCostPaid: Number(otherCostPaid || 0),
          breakdownComplete,
        });
      } else if (operationType === "reversal") {
        if (!targetEventId) {
          setToast({ message: "ID de evento objetivo no especificado para reversión.", type: "error" });
          return;
        }
        await reverseDebtEvent({
          debtId: debt.id,
          reversalEventId,
          targetEventId,
          eventDate,
          description: description.trim(),
          scheduleInstallments: scheduleInstallments.map((s, idx) => ({
            installmentNumber: idx + 1,
            dueDate: s.dueDate,
            expectedAmount: s.expectedAmount ? Number(s.expectedAmount) : null,
            expectedPrincipal: s.expectedPrincipal ? Number(s.expectedPrincipal) : null,
            expectedInterest: s.expectedInterest ? Number(s.expectedInterest) : null,
          })),
          scheduleNotes: scheduleNotes || null,
        });
      }

      setToast({ message: "Operación de deuda registrada exitosamente.", type: "success" });
      onSaved();
    } catch (err) {
      setToast({ message: translateDebtError(err), type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const titleMap = {
    payment: "Registrar pago de cuota",
    prepayment: "Registrar prepago de principal",
    payoff: "Cancelar deuda (Payoff)",
    reversal: "Revertir evento de deuda",
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
          <div>
            <label className="block text-sm font-semibold text-slate-700">Cuenta financiera *</label>
            <select
              required
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.reconciliationType})
                </option>
              ))}
            </select>
          </div>

          {operationType !== "reversal" && (
            <>
              <div>
                <label className="block text-sm font-semibold text-slate-700">Monto total pagado (Efectivo/Caja) *</label>
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
                  {categories.map((cat) => (
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
              <label className="block text-sm font-semibold text-slate-700">Monto a capital *</label>
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
            </>
          )}
        </div>

        {operationType === "payment" && installments.length > 0 && (
          <div className="rounded-2xl border border-slate-200 p-4">
            <h3 className="text-lg font-bold text-slate-800 mb-3">Asignación a cuotas del cronograma</h3>
            <div className="space-y-3">
              {installments.map((inst) => (
                <div key={inst.id} className="flex items-center justify-between bg-slate-50 p-3 rounded-xl">
                  <div>
                    <p className="text-sm font-bold text-slate-800">Cuota #{inst.installmentNumber} (Vence: {inst.dueDate})</p>
                    <p className="text-xs text-slate-500">Esperado: {inst.expectedAmount ?? 0}</p>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Monto asignado"
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
                </div>
              ))}
            </div>
          </div>
        )}

        {(operationType === "prepayment" || operationType === "reversal") && (
          <div className="rounded-2xl border border-slate-200 p-4">
            <h3 className="text-lg font-bold text-slate-800 mb-3">Nuevo cronograma (Requerido o recomendado para esta operación)</h3>
            <button
              type="button"
              onClick={() =>
                setScheduleInstallments([
                  ...scheduleInstallments,
                  { installmentNumber: scheduleInstallments.length + 1, dueDate: localDateString(new Date()), expectedAmount: "", expectedPrincipal: "", expectedInterest: "" },
                ])
              }
              className="mb-3 rounded-xl bg-blue-50 px-3 py-1.5 text-sm font-bold text-blue-700 hover:bg-blue-100"
            >
              Agregar cuota al nuevo cronograma
            </button>
            {scheduleInstallments.map((s, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-4 gap-2 bg-slate-50 p-3 rounded-xl mb-2 items-center">
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
                  <label className="block text-xs text-slate-500">Principal</label>
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
                    className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
            <div className="mt-3">
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
            disabled={submitting}
            className="rounded-xl bg-blue-600 px-6 py-2.5 font-bold text-white shadow-md hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "Registrando..." : "Confirmar operación"}
          </button>
        </div>
      </form>
    </section>
  );
}
