import { useState } from "react";
import { X, CreditCard, ArrowRightLeft, Percent, FileText, RotateCcw, Settings, RefreshCw } from "lucide-react";
import type {
  Debt,
  CreditCardProfile,
  CreditCardEntry,
  FinancialAccount,
  Category,
  HouseholdMember,
} from "../types";
import { localDateString } from "../utils/date";
import { makeUuid } from "../utils/storage";
import { formatMoneyByCurrency } from "../utils/calculations";
import { translateDebtError } from "../utils/debtViewModel";
import {
  calculateCreditCardRefundCapacity,
  isCreditCardEntryEligibleForReversal,
} from "../utils/creditCardCalculations";
import { executeCreditCardOperation } from "../services/creditCardOperationalActions";

export type CardOperationType =
  | "purchase"
  | "payment"
  | "fee"
  | "statement"
  | "credit"
  | "reversal"
  | "profile";

interface CreditCardOperationModalProps {
  debt: Debt;
  profile?: CreditCardProfile | null;
  cardEntries: CreditCardEntry[];
  accounts: FinancialAccount[];
  categories: Category[];
  currentMember?: HouseholdMember;
  initialOperationType?: CardOperationType;
  canWriteDebt?: boolean;
  onClose: () => void;
  onSuccess: () => void;
  setToast: (toast: { message: string; type: "success" | "error" }) => void;
}

export function CreditCardOperationModal({
  debt,
  profile,
  cardEntries,
  accounts,
  categories,
  initialOperationType = "purchase",
  canWriteDebt = true,
  onClose,
  onSuccess,
  setToast,
}: CreditCardOperationModalProps) {
  const [opType, setOpType] = useState<CardOperationType>(initialOperationType);
  const [submitting, setSubmitting] = useState(false);

  const today = localDateString(new Date());

  // Form states
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");

  // Statement states
  const [statementDate, setStatementDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [minimumPaymentAmount, setMinimumPaymentAmount] = useState("");

  // Credit / Reversal states
  const [targetEntryId, setTargetEntryId] = useState("");
  const [reversalConfirmed, setReversalConfirmed] = useState(false);

  // Profile edit states
  const [creditLimit, setCreditLimit] = useState(profile?.creditLimit != null ? String(profile.creditLimit) : "");
  const [closingDay, setClosingDay] = useState(profile?.closingDay != null ? String(profile.closingDay) : "");
  const [dueDay, setDueDay] = useState(profile?.dueDay != null ? String(profile.dueDay) : "");
  const [last4, setLast4] = useState(profile?.last4 ?? "");

  const canOperateCard = canWriteDebt && debt.status === "active" && !debt.isArchived;

  // Eligible accounts for card payment (Must be active & match card currency)
  const eligibleAccounts = accounts.filter(
    (acc) => acc.isActive && acc.currencyCode === debt.currencyCode
  );

  // Eligible target entries for Credit/Refund (purchase or finance_charge with remaining refundable capacity > 0)
  const scopedEntries = cardEntries.filter((e) => e.debtId === debt.id);
  const eligibleCreditTargets = scopedEntries.filter(
    (e) =>
      (e.entryType === "purchase" || e.entryType === "finance_charge") &&
      calculateCreditCardRefundCapacity(e, cardEntries).isRefundable
  );

  // Eligible target entries for Reversal (non-reversal entries not yet reversed and without active linked refunds)
  const eligibleReversalTargets = scopedEntries.filter((e) =>
    isCreditCardEntryEligibleForReversal(e, cardEntries)
  );

  const selectedTargetEntry = scopedEntries.find((e) => e.id === targetEntryId);
  const selectedTargetRefundCap = selectedTargetEntry
    ? calculateCreditCardRefundCapacity(selectedTargetEntry, cardEntries)
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canOperateCard) {
      setToast({
        message: "No se pueden realizar operaciones en una tarjeta inactiva o archivada.",
        type: "error",
      });
      return;
    }

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setToast({
        message: "Las operaciones de tarjeta requieren conexión a internet.",
        type: "error",
      });
      return;
    }

    setSubmitting(true);
    try {
      if (opType === "purchase") {
        if (!amount || Number(amount) <= 0 || !description.trim() || !categoryId) {
          setToast({ message: "Complete todos los campos obligatorios para la compra.", type: "error" });
          setSubmitting(false);
          return;
        }
        await executeCreditCardOperation({
          operation: "purchase",
          purchaseInput: {
            debtId: debt.id,
            entryId: makeUuid(),
            movementId: makeUuid(),
            purchaseDate: date,
            amount: Number(amount),
            description: description.trim(),
            category: categoryId,
          },
        });
        setToast({ message: "Compra registrada exitosamente.", type: "success" });
      } else if (opType === "payment") {
        if (!amount || Number(amount) <= 0 || !accountId || !description.trim() || !categoryId) {
          setToast({ message: "Complete todos los campos obligatorios para el pago.", type: "error" });
          setSubmitting(false);
          return;
        }
        await executeCreditCardOperation({
          operation: "payment",
          paymentInput: {
            debtId: debt.id,
            entryId: makeUuid(),
            movementId: makeUuid(),
            paymentDate: date,
            amount: Number(amount),
            accountId,
            description: description.trim(),
            category: categoryId,
          },
        });
        setToast({ message: "Pago de tarjeta registrado exitosamente.", type: "success" });
      } else if (opType === "fee") {
        if (!amount || Number(amount) <= 0 || !description.trim() || !categoryId) {
          setToast({ message: "Complete todos los campos obligatorios para la comisión / interés.", type: "error" });
          setSubmitting(false);
          return;
        }
        await executeCreditCardOperation({
          operation: "fee",
          feeInput: {
            debtId: debt.id,
            entryId: makeUuid(),
            movementId: makeUuid(),
            feeDate: date,
            amount: Number(amount),
            description: description.trim(),
            category: categoryId,
          },
        });
        setToast({ message: "Comisión / interés registrado exitosamente.", type: "success" });
      } else if (opType === "statement") {
        if (!statementDate || !dueDate) {
          setToast({ message: "Ingrese las fechas de cierre y vencimiento.", type: "error" });
          setSubmitting(false);
          return;
        }
        await executeCreditCardOperation({
          operation: "statement_close",
          statementCloseInput: {
            statementId: makeUuid(),
            debtId: debt.id,
            statementDate,
            dueDate,
            minimumPaymentAmount: minimumPaymentAmount ? Number(minimumPaymentAmount) : null,
          },
        });
        setToast({ message: "Estado de cuenta cerrado exitosamente.", type: "success" });
      } else if (opType === "credit") {
        if (!targetEntryId || !amount || Number(amount) <= 0 || !description.trim()) {
          setToast({ message: "Seleccione un registro destino, un monto positivo y una descripción.", type: "error" });
          setSubmitting(false);
          return;
        }
        if (selectedTargetRefundCap && Number(amount) > selectedTargetRefundCap.remainingRefundableAmount + 0.0001) {
          setToast({
            message: `El monto devuelto (${formatMoneyByCurrency(Number(amount), debt.currencyCode)}) excede el saldo máximo disponible para reembolso (${formatMoneyByCurrency(selectedTargetRefundCap.remainingRefundableAmount, debt.currencyCode)}).`,
            type: "error",
          });
          setSubmitting(false);
          return;
        }
        await executeCreditCardOperation({
          operation: "credit",
          creditInput: {
            debtId: debt.id,
            entryId: makeUuid(),
            movementId: makeUuid(),
            targetEntryId,
            creditDate: date,
            amount: Number(amount),
            description: description.trim(),
          },
        });
        setToast({ message: "Devolución / reembolso registrado exitosamente.", type: "success" });
      } else if (opType === "reversal") {
        if (!targetEntryId || !description.trim()) {
          setToast({ message: "Seleccione el registro a revertir y motive la corrección.", type: "error" });
          setSubmitting(false);
          return;
        }
        if (!reversalConfirmed) {
          setToast({ message: "Debe confirmar que comprende el reverso de la transacción.", type: "error" });
          setSubmitting(false);
          return;
        }
        await executeCreditCardOperation({
          operation: "reversal",
          reversalInput: {
            debtId: debt.id,
            reversalEntryId: makeUuid(),
            targetEntryId,
            reversalDate: date,
            description: description.trim(),
          },
        });
        setToast({ message: "Registro revertido exitosamente.", type: "success" });
      } else if (opType === "profile") {
        if (last4.trim() && !/^[0-9]{4}$/.test(last4.trim())) {
          setToast({ message: "Los últimos 4 dígitos deben contener exactamente 4 números.", type: "error" });
          setSubmitting(false);
          return;
        }
        if (closingDay && (Number(closingDay) < 1 || Number(closingDay) > 31)) {
          setToast({ message: "El día de cierre debe estar entre 1 y 31.", type: "error" });
          setSubmitting(false);
          return;
        }
        if (dueDay && (Number(dueDay) < 1 || Number(dueDay) > 31)) {
          setToast({ message: "El día de pago debe estar entre 1 y 31.", type: "error" });
          setSubmitting(false);
          return;
        }
        if (creditLimit && Number(creditLimit) <= 0) {
          setToast({ message: "El límite de crédito debe ser un monto positivo.", type: "error" });
          setSubmitting(false);
          return;
        }
        await executeCreditCardOperation({
          operation: "profile_save",
          profileSaveInput: {
            debtId: debt.id,
            creditLimit: creditLimit ? Number(creditLimit) : null,
            closingDay: closingDay ? Number(closingDay) : null,
            dueDay: dueDay ? Number(dueDay) : null,
            last4: last4.trim() || null,
          },
        });
        setToast({ message: "Datos de tarjeta actualizados exitosamente.", type: "success" });
      }

      onSuccess();
    } catch (err) {
      setToast({ message: translateDebtError(err), type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const tabs: Array<{ type: CardOperationType; label: string; icon: any }> = [
    { type: "purchase", label: "Compra", icon: CreditCard },
    { type: "payment", label: "Pago", icon: ArrowRightLeft },
    { type: "fee", label: "Interés / Comisión", icon: Percent },
    { type: "statement", label: "Cerrar estado", icon: FileText },
    { type: "credit", label: "Reembolso", icon: RotateCcw },
    { type: "reversal", label: "Reverso", icon: RefreshCw },
    { type: "profile", label: "Ajustes", icon: Settings },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="my-8 w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-xl font-bold text-slate-900">Operaciones de Tarjeta</h3>
            <p className="text-xs text-slate-500">{debt.name} ({debt.currencyCode})</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Horizontal Navigation Tabs */}
        <div className="mt-4 flex gap-1.5 overflow-x-auto pb-2 scrollbar-none">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = opType === tab.type;
            return (
              <button
                key={tab.type}
                type="button"
                onClick={() => setOpType(tab.type)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-bold transition ${
                  active
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Purchase Form */}
          {opType === "purchase" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700">Fecha de compra *</label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">Monto ({debt.currencyCode}) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">Descripción *</label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ej. Supermercado / Combustible"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">Categoría de gasto *</label>
                <select
                  required
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                >
                  <option value="">Seleccionar categoría</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.name}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Payment Form */}
          {opType === "payment" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700">Fecha de pago *</label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">Monto abonado ({debt.currencyCode}) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">Cuenta de origen ({debt.currencyCode}) *</label>
                <select
                  required
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                >
                  <option value="">Seleccionar cuenta bancaria / efectivo</option>
                  {eligibleAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.currencyCode})
                    </option>
                  ))}
                </select>
                {eligibleAccounts.length === 0 && (
                  <p className="mt-1 text-xs text-red-500">
                    No tienes cuentas activas registradas en la misma moneda ({debt.currencyCode}).
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700">Descripción *</label>
                  <input
                    type="text"
                    required
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Ej. Pago del mes Visa"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">Categoría *</label>
                  <select
                    required
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  >
                    <option value="">Seleccionar categoría</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.name}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Fee / Interest Form */}
          {opType === "fee" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700">Fecha de interés / comisión *</label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">Monto ({debt.currencyCode}) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">Descripción *</label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ej. Membresía anual / Interés adeudado"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">Categoría de gasto *</label>
                <select
                  required
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                >
                  <option value="">Seleccionar categoría</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.name}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Statement Close Form */}
          {opType === "statement" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700">Fecha de cierre *</label>
                  <input
                    type="date"
                    required
                    value={statementDate}
                    onChange={(e) => setStatementDate(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">Fecha límite de pago *</label>
                  <input
                    type="date"
                    required
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">
                  Pago mínimo ({debt.currencyCode}) (Opcional - dejar vacío si no figura)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={minimumPaymentAmount}
                  onChange={(e) => setMinimumPaymentAmount(e.target.value)}
                  placeholder="Dejar vacío si no se registró"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div className="rounded-xl bg-blue-50 p-3 text-xs text-blue-800">
                El saldo del estado de cuenta se calculará automáticamente según el acumulado efectivo del periodo.
              </div>
            </>
          )}

          {/* Credit / Refund Form */}
          {opType === "credit" && (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-700">Seleccionar compra / comisión a reembolsar *</label>
                <select
                  required
                  value={targetEntryId}
                  onChange={(e) => setTargetEntryId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                >
                  <option value="">Seleccionar operación destino</option>
                  {eligibleCreditTargets.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.entryDate} - {e.description} ({formatMoneyByCurrency(e.liabilityDelta, debt.currencyCode)})
                    </option>
                  ))}
                </select>
                {eligibleCreditTargets.length === 0 && (
                  <p className="mt-1 text-xs text-slate-500">No hay compras o comisiones elegibles para reembolso.</p>
                )}
              </div>

              {selectedTargetEntry && selectedTargetRefundCap && (
                <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700 space-y-1 border border-slate-200">
                  <div><strong>Fecha original:</strong> {selectedTargetEntry.entryDate}</div>
                  <div><strong>Descripción:</strong> {selectedTargetEntry.description}</div>
                  <div><strong>Monto original:</strong> {formatMoneyByCurrency(selectedTargetRefundCap.originalAmount, debt.currencyCode)}</div>
                  <div><strong>Ya reembolsado:</strong> {formatMoneyByCurrency(selectedTargetRefundCap.effectiveRefundedAmount, debt.currencyCode)}</div>
                  <div className="text-blue-700 font-bold"><strong>Disponible máximo para reembolso:</strong> {formatMoneyByCurrency(selectedTargetRefundCap.remainingRefundableAmount, debt.currencyCode)}</div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700">Fecha de reembolso *</label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">Monto devuelto ({debt.currencyCode}) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    min="0.01"
                    max={selectedTargetRefundCap ? selectedTargetRefundCap.remainingRefundableAmount : undefined}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">Descripción / Motivo *</label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ej. Devolución por producto defectuoso"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </>
          )}

          {/* Reversal Form */}
          {opType === "reversal" && (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-700">Seleccionar registro a revertir *</label>
                <select
                  required
                  value={targetEntryId}
                  onChange={(e) => setTargetEntryId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                >
                  <option value="">Seleccionar registro a anular</option>
                  {eligibleReversalTargets.map((e) => (
                    <option key={e.id} value={e.id}>
                      [{e.entryType.toUpperCase()}] {e.entryDate} - {e.description} ({formatMoneyByCurrency(e.liabilityDelta, debt.currencyCode)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">Fecha del reverso *</label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">Motivo del reverso *</label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ej. Error de digitación / registro duplicado"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 border border-amber-200">
                <strong>Atención:</strong> El reverso es una corrección lógica inmutable (append-only). No elimina datos del historial financiero.
              </div>

              <label className="flex items-start gap-2 text-xs font-semibold text-slate-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={reversalConfirmed}
                  onChange={(e) => setReversalConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                />
                <span>Entiendo que este reverso anulará el efecto financiero del registro sin eliminar el historial.</span>
              </label>
            </>
          )}

          {/* Profile Edit Form */}
          {opType === "profile" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700">Límite de crédito ({debt.currencyCode})</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={creditLimit}
                    onChange={(e) => setCreditLimit(e.target.value)}
                    placeholder="Límite de crédito"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">Últimos 4 dígitos</label>
                  <input
                    type="text"
                    maxLength={4}
                    value={last4}
                    onChange={(e) => setLast4(e.target.value)}
                    placeholder="Ej. 1234"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700">Día de cierre (1 - 31)</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={closingDay}
                    onChange={(e) => setClosingDay(e.target.value)}
                    placeholder="Ej. 20"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">Día de pago (1 - 31)</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={dueDay}
                    onChange={(e) => setDueDay(e.target.value)}
                    placeholder="Ej. 5"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>
            </>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || !canOperateCard || (opType === "reversal" && !reversalConfirmed)}
              className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Procesando..." : "Guardar operación"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
