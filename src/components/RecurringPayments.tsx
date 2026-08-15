import { Archive, CalendarDays, CheckCircle2, Edit3, Plus, RotateCcw, Save, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Category, PaymentAmountMode, RecurrenceType, RecurringPayment } from "../types";
import {
  isPaymentFinished,
  isPaymentPaidThisMonth,
  paymentAmountLabel,
  PaymentAlertSummary,
  paymentScheduleLabel,
  paymentStatus,
} from "../utils/calculations";
import { isValidLocalDate } from "../utils/date";

interface RecurringPaymentsProps {
  payments: RecurringPayment[];
  categories: Category[];
  alertSummary: PaymentAlertSummary;
  focusedPaymentId?: string | null;
  onSave: (payment: Omit<RecurringPayment, "id">, id?: string) => void | Promise<boolean>;
  onMarkPaid: (payment: RecurringPayment, actualAmount: number | null, shouldCreateExpense: boolean) => void | Promise<void>;
  onDeactivate: (id: string) => void | Promise<boolean>;
  onReactivate: (id: string) => void | Promise<boolean>;
}

type PaymentTab = "pending" | "paid" | "archived";

export function RecurringPayments({ payments, categories, alertSummary, focusedPaymentId, onSave, onMarkPaid, onDeactivate, onReactivate }: RecurringPaymentsProps) {
  const [tab, setTab] = useState<PaymentTab>("pending");
  const [editing, setEditing] = useState<RecurringPayment | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [markingPayment, setMarkingPayment] = useState<RecurringPayment | null>(null);
  const [actualAmount, setActualAmount] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [amountMode, setAmountMode] = useState<PaymentAmountMode>("fixed");
  const [dueDay, setDueDay] = useState("1");
  const [dueDate, setDueDate] = useState("");
  const [category, setCategory] = useState("Otros");
  const [notes, setNotes] = useState("");
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>("indefinite");
  const [totalInstallments, setTotalInstallments] = useState("");
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [busyPaymentId, setBusyPaymentId] = useState<string | null>(null);

  const categoryOptions = categories.filter((item) => item.is_active && (item.type === "egreso" || item.type === "ambos"));
  const visiblePayments = payments
    .filter((payment) => paymentTab(payment) === tab)
    .sort((a, b) => paymentSortValue(a) - paymentSortValue(b));
  const counts = {
    pending: payments.filter((payment) => paymentTab(payment) === "pending").length,
    paid: payments.filter((payment) => paymentTab(payment) === "paid").length,
    archived: payments.filter((payment) => paymentTab(payment) === "archived").length,
  };
  const pendingGroups = [
    { key: "overdue" as const, label: "Vencidos" },
    { key: "week" as const, label: "Esta semana" },
    { key: "later" as const, label: "Más adelante" },
  ].map((group) => ({ ...group, payments: visiblePayments.filter((payment) => pendingSubgroup(payment) === group.key) }));

  useEffect(() => {
    if (!focusedPaymentId) return;
    const focusedPayment = payments.find((payment) => payment.id === focusedPaymentId);
    if (focusedPayment) setTab(paymentTab(focusedPayment));
  }, [focusedPaymentId, payments]);

  useEffect(() => {
    if (!focusedPaymentId) return;
    const element = document.getElementById(`recurring-payment-${focusedPaymentId}`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusedPaymentId, payments, tab, visiblePayments.length]);

  useEffect(() => {
    if (!showForm && !markingPayment) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (markingPayment && !busyPaymentId) {
        setMarkingPayment(null);
        setPaymentError("");
      } else if (showForm && !isSaving) {
        closeForm();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [busyPaymentId, isSaving, markingPayment, showForm]);

  function openNewForm() {
    setEditing(null);
    setName("");
    setAmount("");
    setAmountMode("fixed");
    setDueDay("1");
    setDueDate("");
    setCategory(categoryOptions[0]?.name ?? "Otros");
    setNotes("");
    setRecurrenceType("indefinite");
    setTotalInstallments("");
    setFormError("");
    setShowForm(true);
  }

  function startEdit(payment: RecurringPayment) {
    setEditing(payment);
    setName(payment.name);
    setAmount(payment.amount?.toString() ?? "");
    setAmountMode(payment.amount_mode);
    setDueDay(payment.dueDay?.toString() ?? "1");
    setDueDate(payment.dueDate ?? "");
    setCategory(payment.category);
    setNotes(payment.notes);
    setRecurrenceType(payment.recurrence_type);
    setTotalInstallments(payment.total_installments?.toString() ?? "");
    setFormError("");
    setShowForm(true);
  }

  function closeForm() {
    if (isSaving) return;
    setShowForm(false);
    setEditing(null);
    setFormError("");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSaving) return;

    const parsedAmount = amount.trim() === "" ? null : Number(amount);
    const parsedDueDay = Number(dueDay);
    const parsedInstallments = Number(totalInstallments);
    const recurrenceChanged = Boolean(editing && editing.recurrence_type !== recurrenceType);

    if (!name.trim()) return setFormError("Escribe un nombre para el pago.");
    if (amountMode === "fixed" && (!Number.isFinite(parsedAmount) || parsedAmount === null || parsedAmount <= 0)) {
      return setFormError("Ingresa un monto fijo mayor a S/ 0.00.");
    }
    if (amountMode === "variable" && parsedAmount !== null && (!Number.isFinite(parsedAmount) || parsedAmount <= 0)) {
      return setFormError("El monto aproximado debe ser mayor a S/ 0.00 o quedar vacío.");
    }
    if (recurrenceType === "one_time" && !isValidLocalDate(dueDate)) return setFormError("Selecciona una fecha válida.");
    if (recurrenceType !== "one_time" && (!Number.isInteger(parsedDueDay) || parsedDueDay < 1 || parsedDueDay > 31)) {
      return setFormError("El día de vencimiento debe estar entre 1 y 31.");
    }
    if (recurrenceType === "fixed" && (!Number.isInteger(parsedInstallments) || parsedInstallments < 1)) {
      return setFormError("Ingresa un total de cuotas mayor a cero.");
    }

    setFormError("");
    setIsSaving(true);
    try {
      const saved = await onSave(
        {
          name: name.trim(),
          amount: parsedAmount,
          amount_mode: amountMode,
          dueDay: recurrenceType === "one_time" ? null : parsedDueDay,
          dueDate: recurrenceType === "one_time" ? dueDate : null,
          category,
          status: recurrenceChanged ? "pendiente" : editing?.status ?? "pendiente",
          notes: notes.trim(),
          recurrence_type: recurrenceType,
          total_installments: recurrenceType === "fixed" ? parsedInstallments : null,
          paid_installments: recurrenceChanged ? 0 : editing?.paid_installments ?? 0,
          is_active: editing?.is_active ?? true,
          last_paid_month: recurrenceChanged ? null : editing?.last_paid_month ?? null,
          last_paid_year: recurrenceChanged ? null : editing?.last_paid_year ?? null,
          paidAt: recurrenceChanged ? null : editing?.paidAt ?? null,
        },
        editing?.id
      );
      if (saved !== false) closeForm();
    } finally {
      setIsSaving(false);
    }
  }

  function openPaymentDialog(payment: RecurringPayment) {
    setMarkingPayment(payment);
    setActualAmount(payment.amount?.toString() ?? "");
    setPaymentError("");
  }

  async function confirmPayment(shouldCreateExpense: boolean) {
    if (!markingPayment || busyPaymentId) return;
    const parsedAmount = actualAmount.trim() === "" ? null : Number(actualAmount);
    if (shouldCreateExpense && (parsedAmount === null || !Number.isFinite(parsedAmount) || parsedAmount <= 0)) {
      setPaymentError("Ingresa el monto real pagado.");
      return;
    }

    setBusyPaymentId(markingPayment.id);
    try {
      await onMarkPaid(markingPayment, shouldCreateExpense ? parsedAmount : null, shouldCreateExpense);
      setMarkingPayment(null);
    } finally {
      setBusyPaymentId(null);
    }
  }

  async function changeActiveState(payment: RecurringPayment) {
    if (busyPaymentId) return;
    setBusyPaymentId(payment.id);
    try {
      if (payment.is_active) await onDeactivate(payment.id);
      else await onReactivate(payment.id);
    } finally {
      setBusyPaymentId(null);
    }
  }

  function renderPaymentCard(payment: RecurringPayment) {
    const status = paymentStatus(payment);
    const isFocused = payment.id === focusedPaymentId;
    const isTerminal = isPaymentTerminal(payment);

    return (
      <article
        id={`recurring-payment-${payment.id}`}
        key={payment.id}
        className={`rounded-3xl border bg-white p-5 shadow-sm transition sm:p-6 ${isFocused ? "border-blue-500 ring-4 ring-blue-100" : "border-slate-200"}`}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-2xl font-black text-slate-900">{payment.name}</h3>
              <span className={`rounded-full px-3 py-1 text-sm font-black ${statusClass(status.tone)}`}>{status.label}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-base font-semibold text-slate-600">
              <span>{paymentAmountLabel(payment)}</span>
              <span>{paymentScheduleLabel(payment)}</span>
              <span>{payment.category}</span>
            </div>
            {payment.notes && <p className="mt-2 text-base text-slate-600">{payment.notes}</p>}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:justify-end">
            {tab === "pending" && payment.is_active && (
              <button type="button" disabled={busyPaymentId !== null} onClick={() => openPaymentDialog(payment)} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-base font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
                <CheckCircle2 className="h-5 w-5" />
                Marcar pagado
              </button>
            )}
            <button type="button" onClick={() => startEdit(payment)} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-50 px-4 py-2 text-base font-black text-blue-800 hover:bg-blue-100">
              <Edit3 className="h-5 w-5" />
              Editar
            </button>
            {!isTerminal && (
              <button type="button" disabled={busyPaymentId !== null} onClick={() => void changeActiveState(payment)} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-base font-black text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60">
                {payment.is_active ? <Archive className="h-5 w-5" /> : <RotateCcw className="h-5 w-5" />}
                {busyPaymentId === payment.id ? "Guardando..." : payment.is_active ? "Archivar" : "Reactivar"}
              </button>
            )}
          </div>
        </div>
      </article>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Pagos programados</p>
            <h2 className="mt-1 text-3xl font-black text-slate-900">No olvides lo importante</h2>
            <p className="mt-2 text-base text-slate-600">Registra lo que debes pagar y marca cada pago sin duplicar gastos.</p>
          </div>
          <button type="button" onClick={openNewForm} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-lg font-black text-white shadow-md hover:bg-blue-700">
            <Plus className="h-6 w-6" />
            Nuevo pago
          </button>
        </div>

        <UrgentPaymentSummary summary={alertSummary} />

        <div className="mt-6 grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1" role="tablist" aria-label="Estado de pagos">
          <TabButton active={tab === "pending"} label="Por pagar" count={counts.pending} onClick={() => setTab("pending")} />
          <TabButton active={tab === "paid"} label="Pagados" count={counts.paid} onClick={() => setTab("paid")} />
          <TabButton active={tab === "archived"} label="Archivados" count={counts.archived} onClick={() => setTab("archived")} />
        </div>
      </section>

      <section className="space-y-3">
        {visiblePayments.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <CalendarDays className="mx-auto h-10 w-10 text-slate-400" />
            <h3 className="mt-3 text-xl font-black text-slate-900">{emptyTitle(tab)}</h3>
            <p className="mt-2 text-slate-600">{emptyMessage(tab)}</p>
            {tab === "pending" && (
              <button type="button" onClick={openNewForm} className="mt-5 min-h-12 rounded-xl bg-blue-600 px-4 py-2 font-black text-white hover:bg-blue-700">
                Crear primer pago
              </button>
            )}
          </div>
        ) : tab === "pending" ? (
          pendingGroups.map((group) =>
            group.payments.length > 0 ? (
              <section key={group.key} aria-labelledby={`payment-group-${group.key}`}>
                <h3 id={`payment-group-${group.key}`} className="mb-2 px-1 text-sm font-black uppercase tracking-wide text-slate-500">{group.label}</h3>
                <div className="space-y-3">{group.payments.map(renderPaymentCard)}</div>
              </section>
            ) : null
          )
        ) : (
          visiblePayments.map(renderPaymentCard)
        )}
      </section>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="payment-form-title">
          <form onSubmit={handleSubmit} className="my-6 w-full max-w-2xl rounded-3xl bg-white p-5 shadow-2xl sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Configuración</p>
                <h2 id="payment-form-title" className="mt-1 text-2xl font-black text-slate-900">{editing ? "Editar pago" : "Nuevo pago"}</h2>
              </div>
              <button type="button" onClick={closeForm} className="rounded-full bg-slate-100 p-3 text-slate-600 hover:bg-slate-200" aria-label="Cerrar formulario">
                <X className="h-6 w-6" />
              </button>
            </div>

            {formError && <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-800" role="alert">{formError}</p>}

            <div className="mt-6 space-y-5">
              <label className="block space-y-2 text-base font-bold text-slate-700">
                Nombre del pago
                <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Internet de casa" className="h-14 w-full rounded-2xl border border-slate-200 px-4 text-lg" />
              </label>

              <fieldset className="space-y-2">
                <legend className="text-base font-bold text-slate-700">Monto</legend>
                <div className="grid grid-cols-2 gap-2">
                  <ChoiceButton active={amountMode === "fixed"} label="Monto fijo" onClick={() => setAmountMode("fixed")} />
                  <ChoiceButton active={amountMode === "variable"} label="Monto variable" onClick={() => setAmountMode("variable")} />
                </div>
                <input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={amountMode === "variable" ? "Opcional · aproximado" : "0.00"} className="h-14 w-full rounded-2xl border border-slate-200 px-4 text-lg" />
                {amountMode === "variable" && <p className="text-sm text-slate-500">Puedes dejarlo vacío y escribir el monto real al marcarlo como pagado.</p>}
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-base font-bold text-slate-700">Frecuencia</legend>
                <select value={recurrenceType} onChange={(event) => setRecurrenceType(event.target.value as RecurrenceType)} className="h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-lg">
                  <option value="indefinite">Cada mes, sin fecha final</option>
                  <option value="fixed">Cada mes, por número de cuotas</option>
                  <option value="one_time">Pago único</option>
                </select>
              </fieldset>

              {recurrenceType === "one_time" ? (
                <label className="block space-y-2 text-base font-bold text-slate-700">
                  Fecha del pago
                  <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="h-14 w-full rounded-2xl border border-slate-200 px-4 text-lg" />
                </label>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block space-y-2 text-base font-bold text-slate-700">
                    Día de vencimiento
                    <input type="number" min="1" max="31" value={dueDay} onChange={(event) => setDueDay(event.target.value)} className="h-14 w-full rounded-2xl border border-slate-200 px-4 text-lg" />
                  </label>
                  {recurrenceType === "fixed" && (
                    <label className="block space-y-2 text-base font-bold text-slate-700">
                      Total de cuotas
                      <input type="number" min="1" value={totalInstallments} onChange={(event) => setTotalInstallments(event.target.value)} className="h-14 w-full rounded-2xl border border-slate-200 px-4 text-lg" />
                    </label>
                  )}
                </div>
              )}

              <label className="block space-y-2 text-base font-bold text-slate-700">
                Categoría
                <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-lg">
                  {categoryOptions.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                </select>
              </label>

              <label className="block space-y-2 text-base font-bold text-slate-700">
                Notas <span className="font-normal text-slate-500">(opcional)</span>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-24 w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg" />
              </label>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button disabled={isSaving} type="submit" className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-lg font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
                <Save className="h-5 w-5" />
                {isSaving ? "Guardando..." : "Guardar pago"}
              </button>
              <button disabled={isSaving} type="button" onClick={closeForm} className="min-h-14 rounded-2xl border border-slate-300 px-5 py-3 text-lg font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {markingPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="payment-dialog-title">
          <section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold uppercase tracking-wide text-emerald-700">Registrar pago</p>
                <h2 id="payment-dialog-title" className="mt-1 text-2xl font-black text-slate-900">{markingPayment.name}</h2>
              </div>
              <button type="button" onClick={() => setMarkingPayment(null)} className="rounded-full bg-slate-100 p-3 text-slate-600 hover:bg-slate-200" aria-label="Cerrar registro de pago"><X className="h-6 w-6" /></button>
            </div>
            <p className="mt-4 text-slate-600">Usa el monto real solo si vas a crear el egreso. Para marcarlo sin gasto, puedes dejarlo vacío.</p>
            <label className="mt-5 block space-y-2 text-base font-bold text-slate-700">
              Monto real <span className="font-normal text-slate-500">(necesario para crear gasto)</span>
              <div className="flex h-16 items-center rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 focus-within:border-emerald-500">
                <span className="mr-2 text-xl font-black text-emerald-700">S/</span>
                <input autoFocus type="number" min="0" step="0.01" inputMode="decimal" value={actualAmount} onChange={(event) => { setActualAmount(event.target.value); setPaymentError(""); }} className="h-full min-w-0 flex-1 bg-transparent text-2xl font-black text-slate-900 outline-none" />
              </div>
            </label>
            {paymentError && <p className="mt-3 text-sm font-bold text-red-700" role="alert">{paymentError}</p>}
            <div className="mt-6 grid gap-3">
              <button type="button" disabled={busyPaymentId !== null} onClick={() => void confirmPayment(true)} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-lg font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
                <CheckCircle2 className="h-5 w-5" />
                {busyPaymentId ? "Guardando..." : "Registrar pago y gasto"}
              </button>
              <button type="button" disabled={busyPaymentId !== null} onClick={() => void confirmPayment(false)} className="min-h-14 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-lg font-black text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60">Solo marcar como pagado</button>
              <button type="button" disabled={busyPaymentId !== null} onClick={() => setMarkingPayment(null)} className="min-h-14 rounded-2xl border border-slate-300 px-5 py-3 text-lg font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">Cancelar</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`min-h-12 rounded-xl px-2 py-2 text-sm font-black transition sm:text-base ${active ? "bg-white text-blue-800 shadow-sm" : "text-slate-600 hover:bg-white/70"}`}>
      {label} <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">{count}</span>
    </button>
  );
}

function ChoiceButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`min-h-12 rounded-xl border-2 px-3 py-2 text-base font-black transition ${active ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300"}`}>{label}</button>;
}

function UrgentPaymentSummary({ summary }: { summary: PaymentAlertSummary }) {
  if (summary.total === 0) return null;

  return (
    <section className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 sm:p-5" aria-labelledby="urgent-payment-summary-title">
      <div>
        <p className="text-sm font-black uppercase tracking-wide text-red-700">Requieren atención</p>
        <h3 id="urgent-payment-summary-title" className="mt-1 text-2xl font-black text-red-950">Pagos urgentes</h3>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {summary.overdue > 0 && (
          <article className="rounded-2xl border border-red-200 bg-red-100 p-4 text-red-950">
            <p className="text-xl font-black">{summary.overdue === 1 ? "1 vencido" : `${summary.overdue} vencidos`}</p>
          </article>
        )}
        {summary.today > 0 && (
          <article className="rounded-2xl border border-orange-200 bg-orange-100 p-4 text-orange-950">
            <p className="text-xl font-black">{summary.today === 1 ? "1 vence hoy" : `${summary.today} vencen hoy`}</p>
          </article>
        )}
        {summary.tomorrow > 0 && (
          <article className="rounded-2xl border border-yellow-200 bg-yellow-100 p-4 text-yellow-950">
            <p className="text-xl font-black">{summary.tomorrow === 1 ? "1 vence mañana" : `${summary.tomorrow} vencen mañana`}</p>
          </article>
        )}
      </div>
    </section>
  );
}

function isPaymentTerminal(payment: RecurringPayment) {
  return payment.recurrence_type === "one_time" ? payment.status === "pagado" : isPaymentFinished(payment);
}

function paymentTab(payment: RecurringPayment): PaymentTab {
  if (isPaymentTerminal(payment)) return "paid";
  if (!payment.is_active) return "archived";
  const status = paymentStatus(payment);
  if (status.kind === "paid" || status.kind === "completed" || isPaymentPaidThisMonth(payment)) return "paid";
  return "pending";
}

function pendingSubgroup(payment: RecurringPayment) {
  const kind = paymentStatus(payment).kind;
  if (kind === "overdue") return "overdue" as const;
  if (kind === "today" || kind === "tomorrow" || kind === "upcoming") return "week" as const;
  return "later" as const;
}

function paymentSortValue(payment: RecurringPayment) {
  const status = paymentStatus(payment);
  if (status.kind === "overdue") return status.days;
  if (status.kind === "today") return 0;
  if (status.kind === "tomorrow") return 1;
  if (status.kind === "upcoming" || status.kind === "later") return status.days;
  return 999;
}

function statusClass(tone: ReturnType<typeof paymentStatus>["tone"]) {
  if (tone === "red") return "bg-red-100 text-red-800";
  if (tone === "orange") return "bg-orange-100 text-orange-800";
  if (tone === "yellow") return "bg-yellow-100 text-yellow-800";
  if (tone === "green") return "bg-emerald-100 text-emerald-800";
  if (tone === "slate") return "bg-slate-200 text-slate-700";
  return "bg-blue-100 text-blue-800";
}

function emptyTitle(tab: PaymentTab) {
  if (tab === "pending") return "No tienes pagos pendientes";
  if (tab === "paid") return "Todavía no hay pagos registrados";
  return "No hay pagos archivados";
}

function emptyMessage(tab: PaymentTab) {
  if (tab === "pending") return "Cuando agregues una obligación, aparecerá aquí con su próxima fecha.";
  if (tab === "paid") return "Los pagos que marques como pagados aparecerán aquí.";
  return "Los pagos que archives quedarán guardados en esta sección.";
}
