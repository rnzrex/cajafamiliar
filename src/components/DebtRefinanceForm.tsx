import { useState } from "react";
import { ArrowRight, ShieldAlert } from "lucide-react";
import type { Debt, DebtKind, FinancialAccount } from "../types";
import { refinanceDebt } from "../services/dataRepository";
import { makeUuid } from "../utils/storage";
import { localDateString } from "../utils/date";
import { formatDebtKind, translateDebtError } from "../utils/debtViewModel";
import { formatDebtMoney } from "../utils/debtPresentation";

interface DebtRefinanceFormProps {
  debt: Debt;
  currentPrincipal: number;
  accounts: FinancialAccount[];
  canWriteDebt: boolean;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
  setToast: (toast: { message: string; type: "success" | "error" }) => void;
}

const DEBT_KIND_OPTIONS: DebtKind[] = ["bank_loan", "family_loan", "installment_purchase", "mortgage", "pledge", "other"];

export function DebtRefinanceForm({ debt, currentPrincipal, accounts, canWriteDebt, onSaved, onCancel, setToast }: DebtRefinanceFormProps) {
  const activeAccounts = accounts.filter((account) => account.isActive !== false && account.currencyCode === debt.currencyCode);
  const [effectiveDate, setEffectiveDate] = useState(localDateString(new Date()));
  const [targetName, setTargetName] = useState(`Refinanciación — ${debt.name}`);
  const [targetCreditor, setTargetCreditor] = useState("");
  const [targetKind, setTargetKind] = useState<DebtKind>(debt.debtKind === "credit_card" ? "other" : debt.debtKind);
  const [amountPaidByNewCreditor, setAmountPaidByNewCreditor] = useState(currentPrincipal.toFixed(2));
  const [cashContribution, setCashContribution] = useState("0");
  const [refinanceCosts, setRefinanceCosts] = useState("0");
  const [targetPrincipal, setTargetPrincipal] = useState(currentPrincipal.toFixed(2));
  const [targetStructure, setTargetStructure] = useState<"fixed_schedule" | "open_ended">(debt.repaymentStructure === "fixed_schedule" ? "fixed_schedule" : "open_ended");
  const [targetFrequency, setTargetFrequency] = useState(debt.paymentFrequency ?? "monthly");
  const [targetFirstDueDate, setTargetFirstDueDate] = useState(debt.firstDueDate ?? "");
  const [accountId, setAccountId] = useState(activeAccounts[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const paidByNewCreditor = Number(amountPaidByNewCreditor || 0);
  const contribution = Number(cashContribution || 0);
  const costs = Number(refinanceCosts || 0);
  const newPrincipal = Number(targetPrincipal || 0);
  const settlementDifference = currentPrincipal - paidByNewCreditor - contribution;
  const settlementMatches = Number.isFinite(settlementDifference) && Math.abs(settlementDifference) <= 0.01;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canWriteDebt || (typeof navigator !== "undefined" && !navigator.onLine)) {
      setToast({ message: "La refinanciación requiere conexión y permisos de escritura.", type: "error" });
      return;
    }
    if (!targetName.trim() || !targetCreditor.trim() || !effectiveDate || !Number.isFinite(paidByNewCreditor) || paidByNewCreditor < 0 || !Number.isFinite(contribution) || contribution < 0 || !Number.isFinite(costs) || costs < 0 || !Number.isFinite(newPrincipal) || newPrincipal <= 0) {
      setToast({ message: "Completa los datos de la nueva obligación con importes válidos.", type: "error" });
      return;
    }
    if (!settlementMatches) {
      setToast({ message: "La suma pagada por el nuevo acreedor y el aporte propio debe coincidir con el saldo principal.", type: "error" });
      return;
    }
    if ((contribution > 0 || costs > 0) && !accountId) {
      setToast({ message: "Selecciona la cuenta desde la que saldrán el aporte propio y/o los costos.", type: "error" });
      return;
    }
    if ((contribution > 0 || costs > 0) && activeAccounts.length === 0) {
      setToast({ message: "No hay una cuenta activa en la moneda de la deuda para registrar los pagos reales.", type: "error" });
      return;
    }

    setSubmitting(true);
    try {
      const targetDebtId = makeUuid();
      const targetContract = {
        contractAuthority: "user_reported",
        principalBasis: "financed_principal_only",
        financedPrincipalAmount: newPrincipal,
        openingPrincipalAmount: newPrincipal,
        repaymentStructure: targetStructure,
        installmentAmountMode: targetStructure === "fixed_schedule" ? "fixed" : "variable",
        paymentFrequency: targetStructure === "fixed_schedule" ? targetFrequency : null,
        firstDueDate: targetStructure === "fixed_schedule" ? targetFirstDueDate || null : null,
        authorityNotes: "Oferta registrada por el usuario; requiere confirmación documental.",
      };
      await refinanceDebt({
        linkId: makeUuid(),
        sourceDebtId: debt.id,
        sourceRefinanceEventId: makeUuid(),
        targetDebtId,
        effectiveDate,
        targetName: targetName.trim(),
        targetCreditorName: targetCreditor.trim(),
        targetDebtKind: targetKind,
        currencyCode: debt.currencyCode,
        targetOriginalPrincipal: newPrincipal,
        targetOpeningPrincipal: newPrincipal,
        targetInstallmentAmountMode: targetStructure === "fixed_schedule" ? "fixed" : "variable",
        targetPaymentFrequency: targetStructure === "fixed_schedule" ? targetFrequency : null,
        targetFirstDueDate: targetStructure === "fixed_schedule" ? targetFirstDueDate || null : null,
        targetNotes: notes.trim() || "Nueva obligación creada por refinanciación; cronograma pendiente de importar si corresponde.",
        amountPaidByNewCreditor: paidByNewCreditor,
        cashContributionAmount: contribution,
        targetFinancedPrincipalAmount: newPrincipal,
        targetInstallments: [],
        targetScheduleSource: null,
        targetContract,
        contributionMovementId: contribution > 0 ? makeUuid() : null,
        contributionAccountId: contribution > 0 ? accountId : null,
        contributionDescription: contribution > 0 ? `Aporte propio para refinanciación — ${debt.name}` : null,
        contributionCategory: contribution > 0 ? "Pago de deuda" : null,
        refinanceCostsAmount: costs,
        refinanceCostsMovementId: costs > 0 ? makeUuid() : null,
        refinanceCostsAccountId: costs > 0 ? accountId : null,
        refinanceCostsDescription: costs > 0 ? `Costos de cierre de refinanciación — ${debt.name}` : null,
        refinanceCostsCategory: costs > 0 ? "Costo financiero" : null,
        notes: notes.trim() || null,
      });
      setToast({ message: "Refinanciación registrada; la deuda anterior conserva todo su historial.", type: "success" });
      await onSaved();
    } catch (error) {
      setToast({ message: translateDebtError(error), type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/60 p-5 space-y-4" data-testid="debt-refinance-form">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-indigo-600 p-2 text-white"><ArrowRight className="h-5 w-5" /></div>
        <div>
          <h3 className="text-lg font-black text-indigo-950">REFINANCIAR / COMPRA DE DEUDA</h3>
          <p className="text-sm font-semibold text-indigo-900">La deuda nueva sustituye la obligación actual sin crear ingreso ni egreso por el monto que el nuevo acreedor paga directamente.</p>
        </div>
      </div>

      <div className="rounded-xl border border-indigo-200 bg-white p-4 text-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><p className="text-xs text-slate-500">Deuda actual</p><p className="font-bold text-slate-900">{debt.name}</p></div>
          <div><p className="text-xs text-slate-500">Acreedor actual</p><p className="font-bold text-slate-900">{debt.creditorName}</p></div>
          <div><p className="text-xs text-slate-500">Saldo principal</p><p className="font-bold text-slate-900">{formatDebtMoney(currentPrincipal, debt.currencyCode)}</p></div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">Fecha efectiva *<input required type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>
        <label className="text-sm font-semibold text-slate-700">Nuevo acreedor *<input required value={targetCreditor} onChange={(event) => setTargetCreditor(event.target.value)} placeholder="Nombre o entidad" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>
        <label className="text-sm font-semibold text-slate-700">Nombre de la nueva deuda *<input required value={targetName} onChange={(event) => setTargetName(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>
        <label className="text-sm font-semibold text-slate-700">Tipo de deuda nueva<select value={targetKind} onChange={(event) => setTargetKind(event.target.value as DebtKind)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2">{DEBT_KIND_OPTIONS.map((kind) => <option key={kind} value={kind}>{formatDebtKind(kind)}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">Monto pagado por el nuevo acreedor *<input required type="number" min="0" step="0.01" value={amountPaidByNewCreditor} onChange={(event) => setAmountPaidByNewCreditor(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>
         <label className="text-sm font-semibold text-slate-700">Aporte propio en efectivo<input type="number" min="0" step="0.01" value={cashContribution} onChange={(event) => setCashContribution(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>
         <label className="text-sm font-semibold text-slate-700">Costos de cierre/refinanciación pagados en efectivo<input aria-label="Costos de cierre/refinanciación pagados en efectivo" type="number" min="0" step="0.01" value={refinanceCosts} onChange={(event) => setRefinanceCosts(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>
        <label className="text-sm font-semibold text-slate-700">Nuevo principal financiado *<input required type="number" min="0.01" step="0.01" value={targetPrincipal} onChange={(event) => setTargetPrincipal(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>
        <label className="text-sm font-semibold text-slate-700">Estructura nueva<select value={targetStructure} onChange={(event) => setTargetStructure(event.target.value as "fixed_schedule" | "open_ended")} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"><option value="open_ended">Abierta / sin cronograma cargado</option><option value="fixed_schedule">Cronograma fijo (importar después si falta)</option></select></label>
        {targetStructure === "fixed_schedule" && <>
          <label className="text-sm font-semibold text-slate-700">Frecuencia<select value={targetFrequency} onChange={(event) => setTargetFrequency(event.target.value as Debt["paymentFrequency"] & string)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"><option value="monthly">Mensual</option><option value="biweekly">Quincenal</option><option value="weekly">Semanal</option><option value="custom">Personalizada</option></select></label>
          <label className="text-sm font-semibold text-slate-700">Primera fecha de vencimiento<input type="date" value={targetFirstDueDate} onChange={(event) => setTargetFirstDueDate(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>
        </>}
      </div>

      {(contribution > 0 || costs > 0) && <label className="block text-sm font-semibold text-slate-700">Cuenta de aportes/costos *<select required value={accountId} onChange={(event) => setAccountId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"><option value="">Selecciona una cuenta</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currencyCode}</option>)}</select></label>}
      <label className="block text-sm font-semibold text-slate-700">Notas<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="Costos, condiciones o pendientes de confirmación" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>

      <div className={`rounded-xl border px-3 py-2 text-sm font-semibold ${settlementMatches ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
        {settlementMatches ? "Liquidación balanceada: solo el aporte propio generará un movimiento real." : `Falta asignar ${formatDebtMoney(Math.abs(settlementDifference), debt.currencyCode)} para cuadrar la liquidación.`}
      </div>
      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />La oferta y sus costos siguen siendo reportados hasta que se confirme el nuevo contrato. No se afirma ahorro con datos incompletos.</div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={submitting} className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600">Cancelar</button>
        <button type="submit" disabled={submitting || !settlementMatches} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{submitting ? "Registrando..." : "Registrar refinanciación"}</button>
      </div>
    </form>
  );
}
