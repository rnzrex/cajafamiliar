import React, { useState } from "react";
import { AlertTriangle, History, ShieldAlert, X } from "lucide-react";
import type { Category, FinancialAccount, Movement, MovementCorrection } from "../types.js";
import { correctReconciledMovementV1 } from "../services/dataRepository.js";
import { isSupabaseConfigured } from "../services/supabaseClient.js";
import { UNASSIGNED_ACCOUNT_ID } from "../utils/accountHelpers.js";

interface MovementCorrectionModalProps {
  movement: Movement;
  categories: Category[];
  accounts: FinancialAccount[];
  corrections?: MovementCorrection[];
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}

export function MovementCorrectionModal({
  movement,
  categories,
  accounts,
  corrections = [],
  onClose,
  onSuccess,
}: MovementCorrectionModalProps) {
  const [date, setDate] = useState(movement.date);
  const [amount, setAmount] = useState<string>(String(movement.amount));
  const [description, setDescription] = useState(movement.description);
  const [method, setMethod] = useState<string>(movement.method);
  const [category, setCategory] = useState(movement.category);
  const [person, setPerson] = useState(movement.person || "");
  const [accountId, setAccountId] = useState<string>(movement.accountId || UNASSIGNED_ACCOUNT_ID);
  const [reason, setReason] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isOnline = typeof navigator === "undefined" || navigator.onLine;
  const canSubmit = isOnline && isSupabaseConfigured && reason.trim().length > 0 && !submitting;

  const movementCorrections = corrections
    .filter((c) => c.movementId === movement.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setErrorMessage(null);
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setErrorMessage("El monto debe ser un número mayor a 0.");
      return;
    }

    if (!reason.trim()) {
      setErrorMessage("El motivo de la corrección es obligatorio.");
      return;
    }

    setSubmitting(true);
    try {
      await correctReconciledMovementV1({
        movementId: movement.id,
        expectedUpdatedAt: movement.updatedAt || movement.createdAt || new Date().toISOString(),
        date: date.trim(),
        amount: parsedAmount,
        description: description.trim(),
        method: method.trim(),
        category: category.trim(),
        person: person.trim() || null,
        accountId: accountId === UNASSIGNED_ACCOUNT_ID ? null : accountId,
        reason: reason.trim(),
      });

      await onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || "Ocurrió un error al registrar la corrección.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="modal-title-correction" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Cerrar modal"
        >
          <X className="h-6 w-6" />
        </button>

        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div>
            <h2 id="modal-title-correction" className="text-2xl font-black text-slate-900">
              Corregir Movimiento Conciliado
            </h2>
            <p className="text-sm font-medium text-slate-500">
              Este movimiento fue conciliado. Puedes corregirlo conservando el historial.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-xs font-semibold text-amber-900 border border-amber-200">
          <p className="flex items-center gap-1.5 font-bold">
            <ShieldAlert className="h-4 w-4 text-amber-700 shrink-0" />
            Aviso de trazabilidad:
          </p>
          <p className="mt-1">
            Esta corrección conservará el registro de conciliación histórico. Al modificar los datos, el movimiento
            volverá al estado <strong>Pendiente</strong> y la conciliación previa se marcará como <strong>stale</strong>.
          </p>
        </div>

        {(!isOnline || !isSupabaseConfigured) && (
          <div role="alert" className="mt-4 rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-800 border border-red-200">
            Las correcciones de movimientos conciliados requieren conexión a internet en línea.
          </div>
        )}

        {errorMessage && (
          <div role="alert" className="mt-4 rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-800 border border-red-200">
            {errorMessage}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                Fecha movimiento
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base font-semibold text-slate-800 outline-none focus:border-blue-500 focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                Monto
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base font-semibold text-slate-800 outline-none focus:border-blue-500 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
              Descripción
            </label>
            <input
              type="text"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base font-semibold text-slate-800 outline-none focus:border-blue-500 focus:bg-white"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                Método de pago
              </label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base font-semibold text-slate-800 outline-none focus:border-blue-500 focus:bg-white"
              >
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta_credito">Tarjeta de crédito</option>
                <option value="yape">Yape</option>
                <option value="plin">Plin</option>
                <option value="otro">Otro</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                Categoría
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base font-semibold text-slate-800 outline-none focus:border-blue-500 focus:bg-white"
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.name}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                Persona
              </label>
              <input
                type="text"
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base font-semibold text-slate-800 outline-none focus:border-blue-500 focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                Cuenta financiera
              </label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base font-semibold text-slate-800 outline-none focus:border-blue-500 focus:bg-white"
              >
                <option value={UNASSIGNED_ACCOUNT_ID}>Sin cuenta asignada</option>
                {accounts
                  .filter((acc) => acc.isActive)
                  .map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.currencyCode})
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
              Motivo obligatorio de la corrección
            </label>
            <textarea
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explica detalladamente por qué se realiza esta corrección..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-base font-medium text-slate-800 outline-none focus:border-blue-500 focus:bg-white"
            />
          </div>

          {movementCorrections.length > 0 && (
            <div className="mt-4 rounded-2xl bg-slate-50 p-4 border border-slate-200">
              <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
                <History className="h-4 w-4 text-slate-500" />
                Historial de correcciones previas ({movementCorrections.length})
              </h4>
              <div className="mt-2 max-h-36 overflow-y-auto space-y-2 text-xs">
                {movementCorrections.map((c) => (
                  <div key={c.id} className="rounded-xl bg-white p-2.5 shadow-sm border border-slate-100">
                    <p className="font-semibold text-slate-800">
                      Motivo: <span className="font-normal">{c.reason}</span>
                    </p>
                    <p className="text-slate-500 text-[11px] mt-0.5">
                      Fecha: {new Date(c.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-12 rounded-2xl bg-slate-100 px-5 text-base font-bold text-slate-700 hover:bg-slate-200"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="h-12 rounded-2xl bg-amber-500 px-6 text-base font-black text-white shadow-md hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Guardando..." : "Confirmar Corrección"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
