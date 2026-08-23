import { AlertTriangle, CheckCircle2, History, Scale, X } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import type { AccountReconciliation, AccountReconciliationMovement, CreditCardEntry, FinancialAccount, HouseholdMember, Movement, RecordAccountReconciliationResult } from "../types.js";
import { expectedAccountBalance, expectedCashBalance } from "../utils/accountHelpers.js";
import { formatMoneyByCurrency } from "../utils/calculations.js";

const CASH_DENOMINATIONS = [
  { value: 200, label: "S/ 200" },
  { value: 100, label: "S/ 100" },
  { value: 50, label: "S/ 50" },
  { value: 20, label: "S/ 20" },
  { value: 10, label: "S/ 10" },
  { value: 5, label: "S/ 5" },
  { value: 2, label: "S/ 2" },
  { value: 1, label: "S/ 1" },
  { value: 0.5, label: "S/ 0.50" },
  { value: 0.2, label: "S/ 0.20" },
  { value: 0.1, label: "S/ 0.10" },
];

interface AccountReconciliationModalProps {
  account: FinancialAccount;
  movements: Movement[];
  reconciliations: AccountReconciliation[];
  reconciliationMovements: AccountReconciliationMovement[];
  creditCardEntries?: CreditCardEntry[];
  members?: HouseholdMember[];
  currentMember?: HouseholdMember;
  isOnline: boolean;
  onClose: () => void;
  onReconcile: (input: {
    reconciliationId: string;
    accountId: string;
    actualBalance?: number | null;
    denominations?: Record<string, number> | null;
  }) => Promise<RecordAccountReconciliationResult | null>;
}

export function AccountReconciliationModal({
  account,
  movements,
  reconciliations,
  reconciliationMovements,
  creditCardEntries = [],
  members = [],
  currentMember,
  isOnline,
  onClose,
  onReconcile,
}: AccountReconciliationModalProps) {
  const [actualBalanceInput, setActualBalanceInput] = useState("");
  const [denomCounts, setDenomCounts] = useState<Record<string, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<RecordAccountReconciliationResult | null>(null);

  const isCash = account.reconciliationType === "cash";

  const expectedBalanceLocalEstimate = useMemo(() => {
    if (isCash) {
      return expectedCashBalance(movements, account.openingBalance, creditCardEntries, account.id);
    }
    return expectedAccountBalance(movements, account.id, account.openingBalance, creditCardEntries);
  }, [account, movements, creditCardEntries, isCash]);

  const computedCashTotal = useMemo(() => {
    if (!isCash) return 0;
    return Object.entries(denomCounts).reduce((sum, [denom, count]) => {
      return sum + Number(denom) * (Number(count) || 0);
    }, 0);
  }, [denomCounts, isCash]);

  const history = useMemo(() => {
    return reconciliations
      .filter((r) => r.accountId === account.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [reconciliations, account.id]);

  const serverReconciliationAfterRpc = useMemo(() => {
    if (!result) return null;
    return reconciliations.find((r) => r.id === result.reconciliationId) ?? null;
  }, [result, reconciliations]);

  function handleDenomChange(denom: number, countStr: string) {
    const count = Math.max(0, parseInt(countStr, 10) || 0);
    setDenomCounts((prev) => {
      const next = { ...prev };
      if (count > 0) {
        next[denom.toString()] = count;
      } else {
        delete next[denom.toString()];
      }
      return next;
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!isOnline) {
      setErrorMessage("Estás sin conexión. Para conciliar cuentas necesitas conectarte a internet.");
      return;
    }

    if (isSubmitting) return;

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const reconciliationId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "rec-" + Date.now();

      let res: RecordAccountReconciliationResult | null = null;
      if (isCash) {
        if (Object.keys(denomCounts).length === 0) {
          setErrorMessage("Por favor ingresa al menos una denominación.");
          setIsSubmitting(false);
          return;
        }
        res = await onReconcile({
          reconciliationId,
          accountId: account.id,
          actualBalance: null,
          denominations: denomCounts,
        });
      } else {
        const val = parseFloat(actualBalanceInput);
        if (isNaN(val)) {
          setErrorMessage("Por favor ingresa un saldo real válido.");
          setIsSubmitting(false);
          return;
        }
        res = await onReconcile({
          reconciliationId,
          accountId: account.id,
          actualBalance: val,
          denominations: null,
        });
      }

      if (res) {
        setResult(res);
      } else {
        setErrorMessage("No se pudo completar la conciliación. Intenta nuevamente.");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Error al registrar la conciliación.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-label={`Conciliar ${account.name}`}>
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Scale className="h-6 w-6 text-blue-600" />
              <h3 className="text-2xl font-black text-slate-900">Conciliar {account.name}</h3>
            </div>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              Tipo: {isCash ? "Efectivo" : "Banco / Billetera"} ({account.currencyCode})
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-slate-200" aria-label="Cerrar modal">
            <X className="h-6 w-6" />
          </button>
        </div>

        {!isOnline && (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <p className="text-sm font-bold">Estás sin conexión. Para conciliar cuentas necesitas conectarte a internet.</p>
          </div>
        )}

        {result ? (
          <div className="mt-6 space-y-6">
            <div className={`rounded-3xl p-6 text-center ${result.status === "matched" ? "bg-emerald-50 text-emerald-900 border border-emerald-200" : "bg-amber-50 text-amber-900 border border-amber-200"}`}>
              <div className="flex justify-center">
                {result.status === "matched" ? (
                  <CheckCircle2 className="h-12 w-12 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-12 w-12 text-amber-600" />
                )}
              </div>
              <h4 className="mt-2 text-2xl font-black">{result.status === "matched" ? "Cuadra" : `Diferencia: ${formatMoneyByCurrency(result.difference, account.currencyCode)}`}</h4>
              <p className="mt-1 text-sm font-semibold">
                {result.status === "matched"
                  ? "El saldo real coincide exactamente con el saldo verificado por el servidor."
                  : "Existe una diferencia entre el saldo real ingresado y el saldo verificado por el servidor."}
              </p>
              {serverReconciliationAfterRpc && (
                <p className="mt-2 text-xs font-bold text-slate-600">
                  Fecha/hora de conciliación: {formatReconciliationTimestamp(serverReconciliationAfterRpc.createdAt)}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 rounded-2xl bg-slate-50 p-4 text-base">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Saldo esperado verificado</p>
                <p className="text-xl font-black text-slate-900">{formatMoneyByCurrency(result.expectedBalance, account.currencyCode)}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Saldo real</p>
                <p className="text-xl font-black text-slate-900">{formatMoneyByCurrency(result.actualBalance, account.currencyCode)}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Diferencia</p>
                <p className={`text-xl font-black ${result.difference === 0 ? "text-emerald-700" : "text-amber-700"}`}>{formatMoneyByCurrency(result.difference, account.currencyCode)}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Movimientos capturados</p>
                <p className="text-xl font-black text-slate-900">{result.movementsCount}</p>
              </div>
            </div>

            <button type="button" onClick={onClose} className="w-full rounded-2xl bg-blue-600 py-3 text-lg font-black text-white hover:bg-blue-700">
              Entendido
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-6">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Saldo esperado actual (estimación antes de conciliar)</p>
              <p className="mt-1 text-3xl font-black text-slate-900">{formatMoneyByCurrency(expectedBalanceLocalEstimate, account.currencyCode)}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">El valor definitivo es verificado y registrado por el servidor al conciliar.</p>
            </div>

            {isCash ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-base font-black text-slate-900">Ingreso de denominaciones / conteo</h4>
                  <span className="text-lg font-black text-blue-700">Total: {formatMoneyByCurrency(computedCashTotal, account.currencyCode)}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {CASH_DENOMINATIONS.map((denom) => (
                    <label key={denom.value} className="block rounded-2xl border border-slate-200 bg-white p-3">
                      <span className="text-xs font-bold text-slate-600">{denom.label}</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={denomCounts[denom.value.toString()] || ""}
                        onChange={(e) => handleDenomChange(denom.value, e.target.value)}
                        placeholder="0"
                        className="mt-1 w-full rounded-xl border border-slate-200 p-2 text-right font-black text-slate-900 outline-none focus:border-blue-500"
                      />
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-base font-bold text-slate-700">
                  Saldo real en banco / billetera ({account.currencyCode})
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={actualBalanceInput}
                  onChange={(e) => setActualBalanceInput(e.target.value)}
                  placeholder="0.00"
                  className="h-14 w-full rounded-2xl border border-slate-200 px-4 text-2xl font-black text-slate-900 outline-none focus:border-blue-500"
                />
              </div>
            )}

            {errorMessage && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-900">
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={!isOnline || isSubmitting}
              className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-lg font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Registrando conciliación..." : "Registrar conciliación"}
            </button>
          </form>
        )}

        {history.length > 0 && (
          <div className="mt-8 border-t border-slate-100 pt-6 space-y-3">
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-slate-500" />
              <h4 className="text-lg font-black text-slate-900">Historial de conciliaciones</h4>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {history.map((item) => {
                const member = members.find((m) => m.id === item.registeredByUserId);
                const registeredByName = member
                  ? member.displayName
                  : currentMember && currentMember.id === item.registeredByUserId
                  ? currentMember.displayName
                  : "Otro miembro";

                return (
                  <div key={item.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-black uppercase ${item.status === "matched" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                          {item.status === "matched" ? "Cuadra" : `Diferencia: ${formatMoneyByCurrency(item.difference, account.currencyCode)}`}
                        </span>
                        <span className="text-xs text-slate-400">({item.reconciliationType === "cash" ? "Efectivo" : "Banco"})</span>
                      </div>
                      <p className="mt-1 text-xs font-medium text-slate-600">Fecha/hora: {formatReconciliationTimestamp(item.createdAt)}</p>
                      <p className="text-xs text-slate-500">Registrado por: {registeredByName}</p>
                    </div>
                    <div className="text-right font-bold text-slate-700">
                      <p>Esperado: {formatMoneyByCurrency(item.expectedBalance, account.currencyCode)}</p>
                      <p>Real: {formatMoneyByCurrency(item.actualBalance, account.currencyCode)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function formatReconciliationTimestamp(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}
