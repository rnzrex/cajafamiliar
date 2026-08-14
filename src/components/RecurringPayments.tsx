import { CheckCircle, Edit, Power, Save } from "lucide-react";
import { FormEvent, useState } from "react";
import { Category, RecurrenceType, RecurringPayment } from "../types";
import { formatMoney, installmentLabel, paymentStatus } from "../utils/calculations";

interface RecurringPaymentsProps {
  payments: RecurringPayment[];
  categories: Category[];
  onSave: (payment: Omit<RecurringPayment, "id">, id?: string) => void;
  onMarkPaid: (payment: RecurringPayment, shouldCreateExpense: boolean) => void;
  onDeactivate: (id: string) => void;
}

export function RecurringPayments({ payments, categories, onSave, onMarkPaid, onDeactivate }: RecurringPaymentsProps) {
  const [editing, setEditing] = useState<RecurringPayment | null>(null);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDay, setDueDay] = useState("1");
  const [category, setCategory] = useState("Otros");
  const [notes, setNotes] = useState("");
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>("indefinite");
  const [totalInstallments, setTotalInstallments] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || Number(amount) <= 0) return;
    if (recurrenceType === "fixed" && Number(totalInstallments) <= 0) return;
    onSave(
      {
        name: name.trim(),
        amount: Number(amount),
        dueDay: Number(dueDay),
        category,
        status: "pendiente",
        notes,
        recurrence_type: recurrenceType,
        total_installments: recurrenceType === "fixed" ? Number(totalInstallments) : null,
        paid_installments: editing?.paid_installments ?? 0,
        is_active: editing?.is_active ?? true,
        last_paid_month: editing?.last_paid_month ?? null,
        last_paid_year: editing?.last_paid_year ?? null,
        paidAt: editing?.paidAt,
      },
      editing?.id
    );
    resetForm();
  }

  function startEdit(payment: RecurringPayment) {
    setEditing(payment);
    setName(payment.name);
    setAmount(payment.amount.toString());
    setDueDay(payment.dueDay.toString());
    setCategory(payment.category);
    setNotes(payment.notes);
    setRecurrenceType(payment.recurrence_type);
    setTotalInstallments(payment.total_installments?.toString() ?? "");
  }

  function resetForm() {
    setEditing(null);
    setName("");
    setAmount("");
    setDueDay("1");
    setCategory("Otros");
    setNotes("");
    setRecurrenceType("indefinite");
    setTotalInstallments("");
  }

  const groups = {
    vencidos: payments.filter((payment) => payment.is_active && paymentStatus(payment).days < 0),
    proximos: payments.filter((payment) => payment.is_active && paymentStatus(payment).days >= 0 && paymentStatus(payment).days <= 3 && paymentStatus(payment).tone !== "green"),
    pendientes: payments.filter((payment) => payment.is_active && paymentStatus(payment).tone !== "green"),
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[420px_1fr]">
      <form onSubmit={handleSubmit} className="rounded-lg bg-white p-5 soft-shadow">
        <h2 className="text-2xl font-bold text-slate-800">{editing ? "Editar pago recurrente" : "Pagos recurrentes"}</h2>
        <div className="mt-5 space-y-4">
          <label className="block space-y-2 text-lg font-semibold text-slate-700">
            Nombre del pago
            <input value={name} onChange={(event) => setName(event.target.value)} className="h-14 w-full rounded-lg border border-slate-200 px-4 text-lg" />
          </label>
          <label className="block space-y-2 text-lg font-semibold text-slate-700">
            Monto aproximado
            <input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="h-14 w-full rounded-lg border border-slate-200 px-4 text-lg" />
          </label>
          <label className="block space-y-2 text-lg font-semibold text-slate-700">
            Dia de vencimiento
            <input type="number" min="1" max="31" value={dueDay} onChange={(event) => setDueDay(event.target.value)} className="h-14 w-full rounded-lg border border-slate-200 px-4 text-lg" />
          </label>
          <label className="block space-y-2 text-lg font-semibold text-slate-700">
            Categoria
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-14 w-full rounded-lg border border-slate-200 bg-white px-4 text-lg">
              {categories
                .filter((item) => item.is_active && (item.type === "egreso" || item.type === "ambos"))
                .map((item) => (
                <option key={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-2 text-lg font-semibold text-slate-700">
            Notas
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-24 w-full rounded-lg border border-slate-200 px-4 py-3 text-lg" />
          </label>
          <label className="block space-y-2 text-lg font-semibold text-slate-700">
            Tipo de recurrencia
            <select
              value={recurrenceType}
              onChange={(event) => setRecurrenceType(event.target.value as RecurrenceType)}
              className="h-14 w-full rounded-lg border border-slate-200 bg-white px-4 text-lg"
            >
              <option value="indefinite">Mensual indefinido</option>
              <option value="fixed">Numero fijo de cuotas</option>
            </select>
          </label>
          {recurrenceType === "fixed" && (
            <label className="block space-y-2 text-lg font-semibold text-slate-700">
              Total de cuotas
              <input
                type="number"
                min="1"
                value={totalInstallments}
                onChange={(event) => setTotalInstallments(event.target.value)}
                className="h-14 w-full rounded-lg border border-slate-200 px-4 text-lg"
              />
            </label>
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="submit" className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-lg bg-orange-500 px-5 py-3 text-xl font-bold text-white hover:bg-orange-600">
              <Save className="h-6 w-6" />
              {editing ? "Guardar cambios" : "Guardar pago"}
            </button>
            {editing && (
              <button type="button" onClick={resetForm} className="min-h-14 rounded-lg border border-slate-300 px-5 py-3 text-xl font-bold text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
            )}
          </div>
        </div>
      </form>

      <section className="space-y-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Summary title="Pendientes" value={groups.pendientes.length} color="bg-blue-50 text-blue-800" />
          <Summary title="Proximos" value={groups.proximos.length} color="bg-orange-50 text-orange-800" />
          <Summary title="Vencidos" value={groups.vencidos.length} color="bg-red-50 text-red-800" />
        </div>
        <div className="space-y-3">
          {payments.map((payment) => {
            const status = paymentStatus(payment);
            const tone =
              !payment.is_active
                ? "border-slate-200 bg-slate-100"
                :
              status.tone === "red"
                ? "border-red-200 bg-red-50"
                : status.tone === "orange"
                  ? "border-orange-200 bg-orange-50"
                  : status.tone === "yellow"
                    ? "border-yellow-200 bg-yellow-50"
                    : status.tone === "green"
                      ? "border-green-200 bg-green-50"
                      : "border-slate-200 bg-white";

            return (
              <article key={payment.id} className={`rounded-lg border p-4 ${tone}`}>
                <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">{payment.name}</h3>
                    <p className="text-slate-600">
                      {formatMoney(payment.amount)} - Dia {payment.dueDay} - {payment.category}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-600">
                      {payment.recurrence_type === "fixed" ? installmentLabel(payment) : "Mensual indefinido"}
                    </p>
                    {payment.notes && <p className="mt-1 text-slate-600">{payment.notes}</p>}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <span className="rounded-lg bg-white px-4 py-2 text-lg font-bold text-slate-700">{status.label}</span>
                    {payment.is_active && status.tone !== "green" && (
                      <button
                        type="button"
                        onClick={() => {
                          const shouldCreateExpense = window.confirm("Deseas registrar este pago como egreso?");
                          onMarkPaid(payment, shouldCreateExpense);
                        }}
                        className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-lg font-bold text-white hover:bg-green-700"
                      >
                        <CheckCircle className="h-5 w-5" />
                        Marcar pagado
                      </button>
                    )}
                    <button type="button" onClick={() => startEdit(payment)} className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-blue-100 px-4 py-2 text-lg font-bold text-blue-800 hover:bg-blue-200">
                      <Edit className="h-5 w-5" />
                      Editar
                    </button>
                    {payment.is_active && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm("Deseas desactivar este pago recurrente?")) onDeactivate(payment.id);
                        }}
                        className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-slate-200 px-4 py-2 text-lg font-bold text-slate-700 hover:bg-slate-300"
                      >
                        <Power className="h-5 w-5" />
                        Desactivar
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Summary({ title, value, color }: { title: string; value: number; color: string }) {
  return (
    <div className={`rounded-lg p-4 ${color}`}>
      <p className="text-lg font-semibold">{title}</p>
      <p className="text-3xl font-bold">{value}</p>
    </div>
  );
}
