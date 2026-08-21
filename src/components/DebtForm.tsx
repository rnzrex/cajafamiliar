import { useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import type { HouseholdMember, DebtKind, DebtInstallmentAmountMode, DebtPaymentFrequency, FinancialAccount, Category } from "../types";
import { createDebt } from "../services/dataRepository";
import { makeUuid } from "../utils/storage";
import { localDateString } from "../utils/date";
import { translateDebtError } from "../utils/debtViewModel";

interface DebtFormProps {
  currentMember?: HouseholdMember;
  accounts: FinancialAccount[];
  categories: Category[];
  onSaved: () => void;
  onCancel: () => void;
  setToast: (toast: { message: string; type: "success" | "error" }) => void;
}

export function DebtForm({ currentMember, onSaved, onCancel, setToast }: DebtFormProps) {
  const [debtId] = useState(() => makeUuid());
  const [name, setName] = useState("");
  const [creditorName, setCreditorName] = useState("");
  const [debtKind, setDebtKind] = useState<DebtKind>("bank_loan");
  const [currencyCode, setCurrencyCode] = useState("PEN");
  const [originDate, setOriginDate] = useState("");
  const [trackingStartDate, setTrackingStartDate] = useState(localDateString(new Date()));
  const [originalPrincipal, setOriginalPrincipal] = useState("");
  const [openingPrincipalBalance, setOpeningPrincipalBalance] = useState("");
  const [plannedInstallmentCount, setPlannedInstallmentCount] = useState("");
  const [plannedInstallmentAmount, setPlannedInstallmentAmount] = useState("");
  const [installmentAmountMode, setInstallmentAmountMode] = useState<DebtInstallmentAmountMode>("unknown");
  const [paymentFrequency, setPaymentFrequency] = useState<DebtPaymentFrequency | null>(null);
  const [customFrequencyDays, setCustomFrequencyDays] = useState("");
  const [firstDueDate, setFirstDueDate] = useState("");
  const [teaPercent, setTeaPercent] = useState("");
  const [tceaPercent, setTceaPercent] = useState("");
  const [notes, setNotes] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [installments, setInstallments] = useState<Array<{
    installmentNumber: number;
    dueDate: string;
    expectedAmount: string;
    expectedPrincipal: string;
    expectedInterest: string;
    expectedFees: string;
    expectedInsurance: string;
  }>>([]);

  const [collaterals, setCollaterals] = useState<Array<{
    description: string;
    pledgedValue: string;
    estimatedValue: string;
    redemptionDeadline: string;
  }>>([]);

  const [submitting, setSubmitting] = useState(false);

  const debtKindOptions: Array<{ value: DebtKind; label: string }> = [
    { value: "bank_loan", label: "Préstamo bancario" },
    { value: "family_loan", label: "Préstamo familiar" },
    { value: "installment_purchase", label: "Compra en cuotas" },
    { value: "mortgage", label: "Hipoteca" },
    { value: "pledge", label: "Pignoración / Empeño" },
    { value: "other", label: "Otro" },
  ];

  const addInstallment = () => {
    const nextNo = installments.length + 1;
    setInstallments([
      ...installments,
      {
        installmentNumber: nextNo,
        dueDate: firstDueDate || localDateString(new Date()),
        expectedAmount: plannedInstallmentAmount,
        expectedPrincipal: "",
        expectedInterest: "",
        expectedFees: "",
        expectedInsurance: "",
      },
    ]);
  };

  const addCollateral = () => {
    setCollaterals([...collaterals, { description: "", pledgedValue: "", estimatedValue: "", redemptionDeadline: "" }]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setToast({ message: "Las operaciones de deuda requieren conexión a internet.", type: "error" });
      return;
    }

    if (!name.trim() || !creditorName.trim() || !openingPrincipalBalance) {
      setToast({ message: "Complete los campos obligatorios (Nombre, Acreedor, Principal de apertura).", type: "error" });
      return;
    }

    setSubmitting(true);
    try {
      await createDebt({
        debtId,
        name: name.trim(),
        creditorName: creditorName.trim(),
        debtKind,
        currencyCode: currencyCode.trim() || "PEN",
        originDate: originDate || null,
        trackingStartDate,
        originalPrincipal: originalPrincipal ? Number(originalPrincipal) : null,
        openingPrincipalBalance: Number(openingPrincipalBalance),
        plannedInstallmentCount: plannedInstallmentCount ? Number(plannedInstallmentCount) : null,
        plannedInstallmentAmount: plannedInstallmentAmount ? Number(plannedInstallmentAmount) : null,
        installmentAmountMode,
        paymentFrequency: paymentFrequency || null,
        customFrequencyDays: customFrequencyDays ? Number(customFrequencyDays) : null,
        firstDueDate: firstDueDate || null,
        teaPercent: teaPercent ? Number(teaPercent) : null,
        tceaPercent: tceaPercent ? Number(tceaPercent) : null,
        notes,
        installments: installments.map((i) => ({
          installmentNumber: i.installmentNumber,
          dueDate: i.dueDate,
          expectedAmount: i.expectedAmount ? Number(i.expectedAmount) : null,
          expectedPrincipal: i.expectedPrincipal ? Number(i.expectedPrincipal) : null,
          expectedInterest: i.expectedInterest ? Number(i.expectedInterest) : null,
          expectedFees: i.expectedFees ? Number(i.expectedFees) : null,
          expectedInsurance: i.expectedInsurance ? Number(i.expectedInsurance) : null,
        })),
        collaterals: collaterals.map((c) => ({
          description: c.description.trim(),
          pledgedValue: c.pledgedValue ? Number(c.pledgedValue) : null,
          estimatedValue: c.estimatedValue ? Number(c.estimatedValue) : null,
          redemptionDeadline: c.redemptionDeadline || null,
        })),
      });

      setToast({ message: "Deuda registrada exitosamente.", type: "success" });
      onSaved();
    } catch (err) {
      setToast({ message: translateDebtError(err), type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto max-w-4xl rounded-3xl bg-white p-6 shadow-xl lg:p-8">
      <div className="mb-6 flex items-center justify-between border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onCancel} className="rounded-full bg-slate-100 p-2 text-slate-700 hover:bg-slate-200">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Registrar nueva deuda</h2>
            <p className="text-sm text-slate-500">Incorpora una obligación financiera al sistema</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-slate-700">Nombre de la deuda *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Préstamo personal BCP"
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700">Acreedor *</label>
            <input
              type="text"
              required
              value={creditorName}
              onChange={(e) => setCreditorName(e.target.value)}
              placeholder="Ej. Banco de Crédito del Perú"
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700">Tipo de deuda *</label>
            <select
              value={debtKind}
              onChange={(e) => setDebtKind(e.target.value as DebtKind)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
            >
              {debtKindOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700">Moneda</label>
            <input
              type="text"
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value)}
              placeholder="PEN"
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700">Saldo principal inicial *</label>
            <input
              type="number"
              step="0.01"
              required
              value={openingPrincipalBalance}
              onChange={(e) => setOpeningPrincipalBalance(e.target.value)}
              placeholder="0.00"
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700">Fecha de inicio de seguimiento *</label>
            <input
              type="date"
              required
              value={trackingStartDate}
              onChange={(e) => setTrackingStartDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>
        </div>

        {/* Progressive disclosure for advanced details (Requirement 13) */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm font-bold text-blue-600 hover:text-blue-800"
          >
            {showAdvanced ? "Ocultar detalles avanzados y cronograma opcional ▲" : "Mostrar detalles avanzados y cronograma opcional ▼"}
          </button>
        </div>

        {showAdvanced && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-2 border-t border-slate-100">
            <div>
              <label className="block text-sm font-semibold text-slate-700">Principal original</label>
              <input
                type="number"
                step="0.01"
                value={originalPrincipal}
                onChange={(e) => setOriginalPrincipal(e.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700">Fecha de origen</label>
              <input
                type="date"
                value={originDate}
                onChange={(e) => setOriginDate(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700">Frecuencia de pago</label>
              <select
                value={paymentFrequency ?? ""}
                onChange={(e) => setPaymentFrequency((e.target.value || null) as DebtPaymentFrequency | null)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
              >
                <option value="">No especificada</option>
                <option value="monthly">Mensual</option>
                <option value="biweekly">Quincenal</option>
                <option value="weekly">Semanal</option>
                <option value="custom">Personalizada</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700">Primera fecha de vencimiento</label>
              <input
                type="date"
                value={firstDueDate}
                onChange={(e) => setFirstDueDate(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700">TEA % (Tasa Efectiva Anual)</label>
              <input
                type="number"
                step="0.01"
                value={teaPercent}
                onChange={(e) => setTeaPercent(e.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700">TCEA %</label>
              <input
                type="number"
                step="0.01"
                value={tceaPercent}
                onChange={(e) => setTceaPercent(e.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-semibold text-slate-700">Notas / Observaciones</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        </div>

        {/* Optional Schedule / Installments */}
        <div className="rounded-2xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-bold text-slate-800">Cronograma inicial de cuotas (Opcional)</h3>
            <button
              type="button"
              onClick={addInstallment}
              className="flex items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-1.5 text-sm font-bold text-blue-700 hover:bg-blue-100"
            >
              <Plus className="h-4 w-4" /> Agregar cuota
            </button>
          </div>
          {installments.length === 0 ? (
            <p className="text-sm text-slate-500 italic">No se han agregado cuotas iniciales (puede gestionarse sin cronograma estricto).</p>
          ) : (
            <div className="space-y-3">
              {installments.map((inst, idx) => (
                <div key={idx} className="grid grid-cols-1 gap-2 sm:grid-cols-6 items-center bg-slate-50 p-3 rounded-xl">
                  <div className="text-sm font-bold text-slate-700">#{inst.installmentNumber}</div>
                  <div>
                    <label className="block text-xs text-slate-500">Vencimiento</label>
                    <input
                      type="date"
                      value={inst.dueDate}
                      onChange={(e) => {
                        const copy = [...installments];
                        copy[idx].dueDate = e.target.value;
                        setInstallments(copy);
                      }}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Monto esperado</label>
                    <input
                      type="number"
                      step="0.01"
                      value={inst.expectedAmount}
                      onChange={(e) => {
                        const copy = [...installments];
                        copy[idx].expectedAmount = e.target.value;
                        setInstallments(copy);
                      }}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Principal</label>
                    <input
                      type="number"
                      step="0.01"
                      value={inst.expectedPrincipal}
                      onChange={(e) => {
                        const copy = [...installments];
                        copy[idx].expectedPrincipal = e.target.value;
                        setInstallments(copy);
                      }}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Interés</label>
                    <input
                      type="number"
                      step="0.01"
                      value={inst.expectedInterest}
                      onChange={(e) => {
                        const copy = [...installments];
                        copy[idx].expectedInterest = e.target.value;
                        setInstallments(copy);
                      }}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setInstallments(installments.filter((_, i) => i !== idx))}
                      className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Optional Collaterals */}
        <div className="rounded-2xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-bold text-slate-800">Garantías / Colaterales (Opcional)</h3>
            <button
              type="button"
              onClick={addCollateral}
              className="flex items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-1.5 text-sm font-bold text-blue-700 hover:bg-blue-100"
            >
              <Plus className="h-4 w-4" /> Agregar garantía
            </button>
          </div>
          {collaterals.length === 0 ? (
            <p className="text-sm text-slate-500 italic">No se han registrado garantías para esta deuda.</p>
          ) : (
            <div className="space-y-3">
              {collaterals.map((col, idx) => (
                <div key={idx} className="grid grid-cols-1 gap-2 sm:grid-cols-4 items-center bg-slate-50 p-3 rounded-xl">
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-slate-500">Descripción</label>
                    <input
                      type="text"
                      value={col.description}
                      onChange={(e) => {
                        const copy = [...collaterals];
                        copy[idx].description = e.target.value;
                        setCollaterals(copy);
                      }}
                      placeholder="Ej. Vehículo / Inmueble"
                      className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Valor estimado</label>
                    <input
                      type="number"
                      step="0.01"
                      value={col.estimatedValue}
                      onChange={(e) => {
                        const copy = [...collaterals];
                        copy[idx].estimatedValue = e.target.value;
                        setCollaterals(copy);
                      }}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setCollaterals(collaterals.filter((_, i) => i !== idx))}
                      className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

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
            {submitting ? "Registrando..." : "Registrar deuda"}
          </button>
        </div>
      </form>
    </section>
  );
}
