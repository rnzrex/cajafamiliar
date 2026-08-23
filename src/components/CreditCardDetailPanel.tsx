import { useState } from "react";
import {
  CreditCard,
  Plus,
  ArrowRightLeft,
  Percent,
  FileText,
  RotateCcw,
  RefreshCw,
  Settings,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
} from "lucide-react";
import type {
  Debt,
  CreditCardProfile,
  CreditCardEntry,
  CreditCardStatement,
  FinancialAccount,
  Category,
  HouseholdMember,
} from "../types";
import { formatMoneyByCurrency } from "../utils/calculations";
import {
  buildCreditCardStatementAlerts,
  selectUrgentCreditCardStatementAlertsForReminder,
  currentCreditCardBalance,
} from "../utils/creditCardCalculations";
import { localDateString } from "../utils/date";
import { CreditCardOperationModal, CardOperationType } from "./CreditCardOperationModal";

interface CreditCardDetailPanelProps {
  debt: Debt;
  profile?: CreditCardProfile | null;
  cardEntries: CreditCardEntry[];
  cardStatements: CreditCardStatement[];
  allDebts: Debt[];
  accounts: FinancialAccount[];
  categories: Category[];
  currentMember?: HouseholdMember;
  canWriteDebt?: boolean;
  onRefreshData: () => void;
  setToast: (toast: { message: string; type: "success" | "error" }) => void;
}

export function CreditCardDetailPanel({
  debt,
  profile,
  cardEntries,
  cardStatements,
  allDebts,
  accounts,
  categories,
  currentMember,
  canWriteDebt = true,
  onRefreshData,
  setToast,
}: CreditCardDetailPanelProps) {
  const [activeModalOp, setActiveModalOp] = useState<CardOperationType | null>(null);

  // Filter entries and statements for this card
  const thisCardEntries = cardEntries
    .filter((e) => e.debtId === debt.id)
    .sort((a, b) => {
      if (a.entryDate !== b.entryDate) return b.entryDate.localeCompare(a.entryDate);
      if (a.createdAt !== b.createdAt) return b.createdAt.localeCompare(a.createdAt);
      return b.id.localeCompare(a.id);
    });

  const thisCardStatements = cardStatements
    .filter((s) => s.debtId === debt.id)
    .sort((a, b) => b.statementDate.localeCompare(a.statementDate));

  const currentBalance = currentCreditCardBalance(debt, thisCardEntries);
  const creditLimit = profile?.creditLimit ?? null;
  const availableCredit = creditLimit != null ? creditLimit - currentBalance : null;
  const utilizationPercent =
    creditLimit != null && creditLimit > 0 ? (currentBalance / creditLimit) * 100 : null;

  // Latest statement and attention status
  const latestStatement = thisCardStatements[0] ?? null;

  const todayKey = localDateString(new Date());
  const cardAlerts = buildCreditCardStatementAlerts({
    debts: allDebts.filter((d) => d.id === debt.id),
    creditCardProfiles: profile ? [profile] : [],
    creditCardEntries: thisCardEntries,
    creditCardStatements: thisCardStatements,
    todayKey,
  });

  const currentAlert = cardAlerts.find((a) => a.debtId === debt.id) ?? null;

  // Track reversed entries
  const reversedEntryIds = new Set(
    thisCardEntries
      .filter((e) => e.entryType === "reversal" && e.reversalOfEntryId)
      .map((e) => e.reversalOfEntryId!)
  );

  return (
    <div className="space-y-6">
      {/* Top Card Metric Banner */}
      <div className="rounded-3xl bg-slate-900 p-6 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <CreditCard className="h-6 w-6 text-blue-400" />
              <h2 className="text-2xl font-bold">{debt.name}</h2>
              {profile?.last4 && (
                <span className="rounded-md bg-slate-800 px-2 py-1 text-xs font-mono text-slate-300">
                  •••• {profile.last4}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-400">
              {debt.creditorName} • {debt.currencyCode}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setActiveModalOp("profile")}
            className="flex items-center gap-1.5 rounded-xl bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700"
          >
            <Settings className="h-4 w-4" /> Ajustes de tarjeta
          </button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 border-t border-slate-800 pt-4">
          <div>
            <span className="text-xs font-medium text-slate-400">Saldo actual</span>
            <div className="text-xl font-black text-white">
              {formatMoneyByCurrency(currentBalance, debt.currencyCode)}
            </div>
          </div>

          <div>
            <span className="text-xs font-medium text-slate-400">Límite de crédito</span>
            <div className="text-lg font-bold text-slate-200">
              {creditLimit != null
                ? formatMoneyByCurrency(creditLimit, debt.currencyCode)
                : "Límite no registrado"}
            </div>
          </div>

          <div>
            <span className="text-xs font-medium text-slate-400">Disponible</span>
            <div
              className={`text-lg font-bold ${
                availableCredit != null && availableCredit < 0 ? "text-red-400" : "text-slate-200"
              }`}
            >
              {availableCredit != null
                ? formatMoneyByCurrency(availableCredit, debt.currencyCode)
                : "Límite no registrado"}
            </div>
          </div>

          <div>
            <span className="text-xs font-medium text-slate-400">Uso de línea</span>
            <div className="text-lg font-bold text-slate-200">
              {utilizationPercent != null ? `${utilizationPercent.toFixed(1)}%` : "Límite no registrado"}
            </div>
          </div>
        </div>
      </div>

      {/* Latest Statement Section */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <h3 className="text-lg font-bold text-slate-900">Último estado de cuenta</h3>
          {currentAlert && (
            <div className="flex items-center gap-1.5 text-xs font-bold">
              {currentAlert.actionable ? (
                <span className="flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-amber-800">
                  <AlertCircle className="h-3.5 w-3.5" /> Pago pendiente
                </span>
              ) : currentAlert.coverageStatus === "unknown_after_settlement_activity" ? (
                <span className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                  <HelpCircle className="h-3.5 w-3.5" /> Actividad post-cierre
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Estado al día / cubierto
                </span>
              )}
            </div>
          )}
        </div>

        {latestStatement ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <span className="block text-xs text-slate-500">Fecha de cierre</span>
              <span className="text-sm font-bold text-slate-900">{latestStatement.statementDate}</span>
            </div>
            <div>
              <span className="block text-xs text-slate-500">Saldo al cierre</span>
              <span className="text-sm font-bold text-slate-900">
                {formatMoneyByCurrency(latestStatement.statementBalance, debt.currencyCode)}
              </span>
            </div>
            <div>
              <span className="block text-xs text-slate-500">Fecha límite de pago</span>
              <span className="text-sm font-bold text-slate-900">{latestStatement.dueDate}</span>
            </div>
            <div>
              <span className="block text-xs text-slate-500">Pago mínimo</span>
              <span className="text-sm font-bold text-slate-900">
                {latestStatement.minimumPaymentAmount != null
                  ? formatMoneyByCurrency(latestStatement.minimumPaymentAmount, debt.currencyCode)
                  : "Pago mínimo no registrado"}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500 italic">No hay un estado de cuenta registrado todavía.</p>
        )}
      </div>

      {/* Operational Actions Grid */}
      {(() => {
        const canOperateCard = canWriteDebt && debt.status === "active" && !debt.isArchived;
        return (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Acciones de tarjeta</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <button
                type="button"
                disabled={!canOperateCard}
                onClick={() => setActiveModalOp("purchase")}
                className="flex items-center justify-center gap-2 rounded-2xl bg-blue-600 p-3.5 text-sm font-bold text-white shadow-md hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="h-4 w-4" /> Registrar compra
              </button>
              <button
                type="button"
                disabled={!canOperateCard}
                onClick={() => setActiveModalOp("payment")}
                className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 p-3.5 text-sm font-bold text-white shadow-md hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ArrowRightLeft className="h-4 w-4" /> Registrar pago
              </button>
              <button
                type="button"
                disabled={!canOperateCard}
                onClick={() => setActiveModalOp("fee")}
                className="flex items-center justify-center gap-2 rounded-2xl bg-purple-600 p-3.5 text-sm font-bold text-white shadow-md hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Percent className="h-4 w-4" /> Interés / Comisión
              </button>
              <button
                type="button"
                disabled={!canOperateCard}
                onClick={() => setActiveModalOp("statement")}
                className="flex items-center justify-center gap-2 rounded-2xl bg-slate-800 p-3.5 text-sm font-bold text-white shadow-md hover:bg-slate-900 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FileText className="h-4 w-4" /> Cerrar estado
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={!canOperateCard}
                onClick={() => setActiveModalOp("credit")}
                className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw className="h-3.5 w-3.5 text-blue-600" /> Registrar devolución / reembolso
              </button>
              <button
                type="button"
                disabled={!canOperateCard}
                onClick={() => setActiveModalOp("reversal")}
                className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className="h-3.5 w-3.5 text-amber-600" /> Corregir mediante reverso
              </button>
            </div>
          </div>
        );
      })()}

      {/* Card Ledger / Entry History */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900 mb-4">Historial de movimientos de tarjeta</h3>
        {thisCardEntries.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No hay registros cargados para esta tarjeta.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Descripción</th>
                  <th className="px-4 py-3 text-right">Efecto saldo</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {thisCardEntries.map((e) => {
                  const isReversed = reversedEntryIds.has(e.id);
                  const isReversalRow = e.entryType === "reversal";
                  const labels: Record<string, string> = {
                    purchase: "Compra",
                    payment: "Pago",
                    finance_charge: "Interés / Comisión",
                    credit: "Devolución",
                    reversal: "Reverso",
                  };
                  return (
                    <tr key={e.id} className={isReversed ? "bg-slate-50/70 text-slate-400 line-through" : ""}>
                      <td className="px-4 py-3 whitespace-nowrap font-medium">{e.entryDate}</td>
                      <td className="px-4 py-3 whitespace-nowrap font-semibold">{labels[e.entryType] ?? e.entryType}</td>
                      <td className="px-4 py-3">{e.description}</td>
                      <td className={`px-4 py-3 text-right font-bold whitespace-nowrap ${
                        e.liabilityDelta > 0 ? "text-red-600" : e.liabilityDelta < 0 ? "text-emerald-600" : "text-slate-500"
                      }`}>
                        {e.liabilityDelta > 0 ? "+" : ""}
                        {formatMoneyByCurrency(e.liabilityDelta, debt.currencyCode)}
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        {isReversed ? (
                          <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-bold text-slate-600 no-underline">
                            Revertido
                          </span>
                        ) : isReversalRow ? (
                          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">
                            Reverso
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                            Efectivo
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Statement History */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900 mb-4">Historial de estados de cuenta</h3>
        {thisCardStatements.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No hay estados de cuenta cerrados históricamente.</p>
        ) : (
          <div className="space-y-3">
            {thisCardStatements.map((st) => (
              <div key={st.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-slate-50 p-4 border border-slate-200">
                <div>
                  <span className="text-xs text-slate-500 block">Fecha de cierre</span>
                  <span className="text-sm font-bold text-slate-900">{st.statementDate}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">Vencimiento</span>
                  <span className="text-sm font-bold text-slate-900">{st.dueDate}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">Saldo cerrado</span>
                  <span className="text-sm font-bold text-slate-900">
                    {formatMoneyByCurrency(st.statementBalance, debt.currencyCode)}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">Pago mínimo</span>
                  <span className="text-sm font-bold text-slate-900">
                    {st.minimumPaymentAmount != null
                      ? formatMoneyByCurrency(st.minimumPaymentAmount, debt.currencyCode)
                      : "No registrado"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {activeModalOp && (
        <CreditCardOperationModal
          debt={debt}
          profile={profile}
          cardEntries={thisCardEntries}
          accounts={accounts}
          categories={categories}
          currentMember={currentMember}
          initialOperationType={activeModalOp}
          canWriteDebt={canWriteDebt}
          onClose={() => setActiveModalOp(null)}
          onSuccess={() => {
            setActiveModalOp(null);
            onRefreshData();
          }}
          setToast={setToast}
        />
      )}
    </div>
  );
}
