import { useRef, useState } from "react";
import { ArrowLeft, CreditCard, Save } from "lucide-react";
import { createCreditCardDebt, CreditCardOperationError } from "../services/dataRepository.js";
import type { CreditCardDebtCreateInput } from "../types.js";
import { translateDebtError } from "../utils/debtViewModel.js";
import { getCurrencySymbol } from "../utils/debtFormMode.js";
import { localDateString } from "../utils/date.js";
import { makeUuid } from "../utils/storage.js";

interface CreditCardFormProps {
  canWriteDebt?: boolean;
  onSaved: () => void;
  onCancel: () => void;
  setToast: (toast: { message: string; type: "success" | "error" }) => void;
}

export function CreditCardForm({ canWriteDebt = true, onSaved, onCancel, setToast }: CreditCardFormProps) {
  const [name, setName] = useState("");
  const [creditorName, setCreditorName] = useState("");
  const [currencyCode, setCurrencyCode] = useState<"PEN" | "USD">("PEN");
  const [openingBalance, setOpeningBalance] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [closingDay, setClosingDay] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [last4, setLast4] = useState("");
  const [originDate, setOriginDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const createRequestRef = useRef<{ fingerprint: string; input: CreditCardDebtCreateInput } | null>(null);

  const currencySymbol = getCurrencySymbol(currencyCode);

  function validate(): boolean {
    if (!canWriteDebt || (typeof navigator !== "undefined" && !navigator.onLine)) {
      setToast({ message: "Las operaciones de tarjeta requieren conexión a internet y permisos de escritura.", type: "error" });
      return false;
    }
    const balance = Number(openingBalance);
    if (!name.trim() || !creditorName.trim() || openingBalance.trim() === "" || !Number.isFinite(balance) || balance < 0) {
      setToast({ message: "Completa el nombre, banco y un saldo inicial válido.", type: "error" });
      return false;
    }
    if (creditLimit && (!Number.isFinite(Number(creditLimit)) || Number(creditLimit) <= 0)) {
      setToast({ message: "El límite de crédito debe ser un monto positivo.", type: "error" });
      return false;
    }
    if (last4.trim() && !/^\d{4}$/.test(last4.trim())) {
      setToast({ message: "Los últimos 4 dígitos deben contener exactamente 4 números.", type: "error" });
      return false;
    }
    for (const [label, value] of [["cierre", closingDay], ["pago", dueDay]] as const) {
      if (value && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 31)) {
        setToast({ message: `El día de ${label} debe estar entre 1 y 31.`, type: "error" });
        return false;
      }
    }
    return true;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || !validate()) return;

    setSubmitting(true);
    try {
      const draftInput = {
        name: name.trim(),
        creditorName: creditorName.trim(),
        currencyCode,
        originDate: originDate || null,
        trackingStartDate: localDateString(),
        openingBalance: Number(openingBalance),
        creditLimit: creditLimit ? Number(creditLimit) : null,
        closingDay: closingDay ? Number(closingDay) : null,
        dueDay: dueDay ? Number(dueDay) : null,
        last4: last4.trim() || null,
        notes: notes.trim(),
      } satisfies Omit<CreditCardDebtCreateInput, "debtId">;
      const fingerprint = JSON.stringify(draftInput);
      const input = createRequestRef.current?.fingerprint === fingerprint
        ? createRequestRef.current.input
        : { debtId: makeUuid(), ...draftInput };
      createRequestRef.current = { fingerprint, input };

      await createCreditCardDebt(input);
      await onSaved();
      createRequestRef.current = null;
      setToast({ message: "Tarjeta de crédito registrada exitosamente.", type: "success" });
    } catch (error) {
      if (error instanceof CreditCardOperationError && error.code === "DEBT_ALREADY_EXISTS") {
        try {
          await onSaved();
          createRequestRef.current = null;
          setToast({ message: "La tarjeta ya estaba registrada; se recuperó correctamente.", type: "success" });
          return;
        } catch (recoveryError) {
          setToast({ message: translateDebtError(recoveryError), type: "error" });
          return;
        }
      }
      setToast({ message: translateDebtError(error), type: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl rounded-3xl bg-white p-5 shadow-xl sm:p-7">
      <header className="mb-6 flex items-center gap-3 border-b border-slate-100 pb-5">
        <button type="button" onClick={onCancel} className="rounded-full bg-slate-100 p-2.5 text-slate-700 hover:bg-slate-200" aria-label="Volver a tarjetas">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="rounded-xl bg-blue-100 p-2.5 text-blue-700"><CreditCard className="h-5 w-5" /></div>
        <div>
          <h2 className="text-2xl font-black text-slate-900">Registrar tarjeta</h2>
          <p className="text-sm text-slate-500">Registra el punto de partida. No se creará un ingreso automático.</p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nombre de la tarjeta *">
            <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Visa Black" className={inputClass} />
          </Field>
          <Field label="Banco / acreedor *">
            <input required value={creditorName} onChange={(event) => setCreditorName(event.target.value)} placeholder="Ej. Interbank" className={inputClass} />
          </Field>
          <Field label="Moneda *">
            <select value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value as "PEN" | "USD")} className={inputClass}>
              <option value="PEN">PEN — S/ Sol peruano</option>
              <option value="USD">USD — $ Dólar estadounidense</option>
            </select>
          </Field>
          <Field label="Saldo actual inicial *" hint="Este saldo no vuelve a sumar dinero en tus cuentas.">
            <div className="flex items-center rounded-xl border border-slate-300 focus-within:border-blue-600">
              <span className="pl-3 text-sm font-black text-slate-500">{currencySymbol}</span>
              <input required type="number" min="0" step="0.01" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} placeholder="0.00" className="w-full bg-transparent px-3 py-2.5 text-slate-900 outline-none" />
            </div>
          </Field>
          <Field label="Límite de crédito">
            <div className="flex items-center rounded-xl border border-slate-300 focus-within:border-blue-600">
              <span className="pl-3 text-sm font-black text-slate-500">{currencySymbol}</span>
              <input type="number" min="0.01" step="0.01" value={creditLimit} onChange={(event) => setCreditLimit(event.target.value)} placeholder="Opcional" className="w-full bg-transparent px-3 py-2.5 text-slate-900 outline-none" />
            </div>
          </Field>
          <Field label="Fecha de inicio">
            <input type="date" value={originDate} onChange={(event) => setOriginDate(event.target.value)} className={inputClass} />
          </Field>
          <Field label="Día de cierre">
            <input type="number" min="1" max="31" value={closingDay} onChange={(event) => setClosingDay(event.target.value)} placeholder="1 - 31" className={inputClass} />
          </Field>
          <Field label="Día habitual de pago">
            <input type="number" min="1" max="31" value={dueDay} onChange={(event) => setDueDay(event.target.value)} placeholder="1 - 31" className={inputClass} />
          </Field>
          <Field label="Últimos 4 dígitos">
            <input inputMode="numeric" maxLength={4} value={last4} onChange={(event) => setLast4(event.target.value.replace(/\D/g, ""))} placeholder="Opcional" className={inputClass} />
          </Field>
        </div>

        <Field label="Notas">
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Información adicional opcional" className={inputClass} />
        </Field>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={submitting} className="min-h-12 rounded-xl border border-slate-300 px-5 py-2.5 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
          <button type="submit" disabled={submitting} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-2.5 font-black text-white shadow-md hover:bg-blue-700 disabled:opacity-50">
            <Save className="h-5 w-5" /> {submitting ? "Registrando..." : "Registrar tarjeta"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5 text-sm font-bold text-slate-700">
      {label}
      {children}
      {hint && <span className="block text-xs font-medium text-slate-500">{hint}</span>}
    </label>
  );
}

const inputClass = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none focus:border-blue-600";
