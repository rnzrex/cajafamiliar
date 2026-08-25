import { useState } from "react";
import { ArrowLeft, AlertCircle } from "lucide-react";
import type { Debt, DebtEvent, DebtInstallment, DebtScheduleVersion } from "../types.js";
import { updateDebtContractualSchedule } from "../services/dataRepository.js";
import { makeUuid } from "../utils/storage.js";
import { localDateString } from "../utils/date.js";
import { translateDebtError } from "../utils/debtViewModel.js";
import { getDebtScheduleLifecycleState } from "../utils/debtPlanning.js";

interface ScheduleDraftRow {
  dueDate: string;
  expectedAmount: string;
  expectedPrincipal: string;
  expectedInterest: string;
  expectedFees: string;
  expectedInsurance: string;
}

interface DebtScheduleUpdateFormProps {
  debt: Debt;
  debtEvents: DebtEvent[];
  installments: DebtInstallment[];
  scheduleVersions: DebtScheduleVersion[];
  canWriteDebt?: boolean;
  onSaved: () => Promise<void>;
  onCancel: () => void;
  setToast: (toast: { message: string; type: "success" | "error" }) => void;
}

function asDraftRow(installment: DebtInstallment): ScheduleDraftRow {
  return {
    dueDate: installment.dueDate,
    expectedAmount: installment.expectedAmount == null ? "" : String(installment.expectedAmount),
    expectedPrincipal: installment.expectedPrincipal == null ? "" : String(installment.expectedPrincipal),
    expectedInterest: installment.expectedInterest == null ? "" : String(installment.expectedInterest),
    expectedFees: installment.expectedFees == null ? "" : String(installment.expectedFees),
    expectedInsurance: installment.expectedInsurance == null ? "" : String(installment.expectedInsurance),
  };
}

function blankRow(): ScheduleDraftRow {
  return {
    dueDate: "",
    expectedAmount: "",
    expectedPrincipal: "",
    expectedInterest: "",
    expectedFees: "",
    expectedInsurance: "",
  };
}

export function DebtScheduleUpdateForm({
  debt,
  debtEvents,
  installments,
  scheduleVersions,
  canWriteDebt = true,
  onSaved,
  onCancel,
  setToast,
}: DebtScheduleUpdateFormProps) {
  const scheduleLifecycle = getDebtScheduleLifecycleState(debt.id, debtEvents, scheduleVersions);
  const hasPendingBankSchedule = debt.debtKind === "bank_loan" && scheduleLifecycle.pendingBankSchedule;
  const currentSchedule = scheduleLifecycle.currentSchedule;
  const currentInstallments = installments
    .filter((installment) => installment.debtId === debt.id && installment.scheduleVersionId === currentSchedule?.id)
    .sort((a, b) => a.installmentNumber - b.installmentNumber);
  const [eventDate, setEventDate] = useState(localDateString(new Date()));
  const [reason, setReason] = useState<"rate_change" | "manual_adjustment">("manual_adjustment");
  const [rows, setRows] = useState<ScheduleDraftRow[]>(() => currentInstallments.map(asDraftRow));
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [eventId] = useState(() => makeUuid());

  const updateRow = (index: number, field: keyof ScheduleDraftRow, value: string) => {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canWriteDebt || (typeof navigator !== "undefined" && !navigator.onLine)) {
      setToast({ message: "La actualización del cronograma requiere conexión a internet.", type: "error" });
      return;
    }
    if (rows.length === 0) {
      setToast({ message: "El cronograma debe contener al menos una cuota.", type: "error" });
      return;
    }

    const normalized = rows.map((row, index) => {
      const values = [
        row.expectedAmount,
        row.expectedPrincipal,
        row.expectedInterest,
        row.expectedFees,
        row.expectedInsurance,
      ].map(Number);
      return {
        installmentNumber: index + 1,
        dueDate: row.dueDate,
        expectedAmount: values[0],
        expectedPrincipal: values[1],
        expectedInterest: values[2],
        expectedFees: values[3],
        expectedInsurance: values[4],
      };
    });

    for (let index = 0; index < normalized.length; index += 1) {
      const row = normalized[index];
      const components = row.expectedPrincipal + row.expectedInterest + row.expectedFees + row.expectedInsurance;
      const draft = rows[index];
      const hasAllAmounts = [
        draft.expectedAmount,
        draft.expectedPrincipal,
        draft.expectedInterest,
        draft.expectedFees,
        draft.expectedInsurance,
      ].every((value) => value.trim() !== "");
      if (
        !row.dueDate ||
        row.dueDate <= eventDate ||
        !hasAllAmounts ||
        !Object.values(row).every((value) => typeof value !== "number" || Number.isFinite(value)) ||
        row.expectedAmount <= 0 ||
        row.expectedPrincipal < 0 ||
        row.expectedInterest < 0 ||
        row.expectedFees < 0 ||
        row.expectedInsurance < 0 ||
        Math.abs(components - row.expectedAmount) > 0.01 ||
        (index > 0 && row.dueDate <= normalized[index - 1].dueDate)
      ) {
        setToast({ message: `La cuota #${index + 1} tiene importes o fecha inválidos.`, type: "error" });
        return;
      }
    }

    setSubmitting(true);
    try {
      await updateDebtContractualSchedule({
        debtId: debt.id,
        eventId,
        eventDate,
        reason,
        scheduleInstallments: normalized,
        scheduleNotes: notes.trim() || null,
      });
      setToast({ message: "Cronograma contractual actualizado correctamente.", type: "success" });
      await onSaved();
    } catch (error) {
      setToast({ message: translateDebtError(error), type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto max-w-5xl rounded-3xl bg-white p-6 shadow-xl lg:p-8">
      <div className="mb-6 flex items-center justify-between border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onCancel} className="rounded-full bg-slate-100 p-2 text-slate-700 hover:bg-slate-200">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Actualizar cronograma oficial</h2>
            <p className="text-sm text-slate-500">{debt.name} · {debt.creditorName}</p>
          </div>
        </div>
      </div>

        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
          <p>
            Esta acción agrega una nueva versión contractual y un evento de auditoría sin modificar el principal. No representa una refinanciación: un nuevo contrato debe registrarse como una deuda nueva. {hasPendingBankSchedule ? "La versión precargada es la última conocida y no se considera vigente hasta guardar el cronograma posterior." : "La versión precargada es la vigente actualmente."}
          </p>
        </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-slate-700">Fecha efectiva *</label>
            <input type="date" required value={eventDate} onChange={(event) => setEventDate(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700">Motivo *</label>
            <select value={reason} onChange={(event) => setReason(event.target.value as typeof reason)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900">
              <option value="manual_adjustment">Reprogramación / ajuste contractual</option>
              <option value="rate_change">Cambio de tasa contractual</option>
            </select>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Cuotas contractuales</h3>
              <p className="text-xs text-slate-500">La suma de capital, interés, comisiones y seguros debe coincidir con el total.</p>
            </div>
            <button type="button" onClick={() => setRows((current) => [...current, blankRow()])} className="rounded-xl bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100">
              Agregar cuota
            </button>
          </div>

          {rows.length === 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">No hay cuotas cargadas. Agrega las cuotas entregadas por el banco.</p>}

          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-3 lg:grid-cols-7">
              <div className="text-sm font-bold text-slate-700">Cuota #{index + 1}</div>
              <input aria-label={`Fecha cuota ${index + 1}`} type="date" value={row.dueDate} onChange={(event) => updateRow(index, "dueDate", event.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm" />
              <input aria-label={`Total cuota ${index + 1}`} type="number" min="0" step="0.01" placeholder="Total" value={row.expectedAmount} onChange={(event) => updateRow(index, "expectedAmount", event.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm" />
              <input aria-label={`Capital cuota ${index + 1}`} type="number" min="0" step="0.01" placeholder="Capital" value={row.expectedPrincipal} onChange={(event) => updateRow(index, "expectedPrincipal", event.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm" />
              <input aria-label={`Interés cuota ${index + 1}`} type="number" min="0" step="0.01" placeholder="Interés" value={row.expectedInterest} onChange={(event) => updateRow(index, "expectedInterest", event.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm" />
              <input aria-label={`Comisiones cuota ${index + 1}`} type="number" min="0" step="0.01" placeholder="Comisiones" value={row.expectedFees} onChange={(event) => updateRow(index, "expectedFees", event.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm" />
              <div className="flex gap-2">
                <input aria-label={`Seguro cuota ${index + 1}`} type="number" min="0" step="0.01" placeholder="Seguro" value={row.expectedInsurance} onChange={(event) => updateRow(index, "expectedInsurance", event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm" />
                <button type="button" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="rounded-lg px-2 text-sm font-bold text-red-600 hover:bg-red-50" aria-label={`Eliminar cuota ${index + 1}`}>Quitar</button>
              </div>
            </div>
          ))}
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700">Notas de auditoría</label>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900" placeholder="Referencia del nuevo cronograma, carta o comunicación del banco" />
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <button type="button" onClick={onCancel} className="rounded-xl px-5 py-2.5 font-bold text-slate-600 hover:bg-slate-100">Cancelar</button>
          <button type="submit" disabled={submitting || !canWriteDebt} className="rounded-xl bg-blue-600 px-6 py-2.5 font-bold text-white shadow-md hover:bg-blue-700 disabled:opacity-50">
            {submitting ? "Guardando..." : "Guardar cronograma oficial"}
          </button>
        </div>
      </form>
    </section>
  );
}
