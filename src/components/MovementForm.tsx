import { CalendarDays, Plus, Save, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Category, CategoryType, CreditCardPurchaseInput, Debt, FinancialAccount, HouseholdMember, Movement, MovementDraft, MovementFormInput, MovementType } from "../types";
import { detectCategory } from "../utils/categoryDetector";
import { localDateString } from "../utils/date";
import { getActiveCashAccount, legacyMethodForAccount } from "../utils/accountHelpers";
import { loadPreferredPerson, makeUuid, savePreferredPerson } from "../utils/storage";
import { eligibleCreditCardsForSpending } from "../utils/creditCardSpending";

interface MovementFormProps {
  initialType?: MovementType;
  movement?: Movement | null;
  draft?: MovementDraft | null;
  draftIdentity?: string | null;
  currentMember?: HouseholdMember;
  categories: Category[];
  accounts: FinancialAccount[];
  creditCards?: Debt[];
  allowCreditCardSource?: boolean;
  onQuickCreateCategory: (category: Omit<Category, "id" | "created_at">) => Category | null | Promise<Category | null>;
  onSave: (movement: MovementFormInput, id?: string) => void | Promise<boolean>;
  onSaveCreditCardPurchase?: (input: CreditCardPurchaseInput) => void | Promise<boolean>;
  onCancel?: () => void;
}

const today = () => localDateString();
const knownPeople = ["Rolando", "Verónica", "Renzo"] as const;
type PersonChoice = (typeof knownPeople)[number] | "Otro" | "";
type ValidationField = "amount" | "description" | "person" | "source" | "category";

interface ValidationError {
  field: ValidationField;
  message: string;
}

const unassignedAccountLabel = "Sin cuenta (histórico)";
const creditCardSourcePrefix = "credit-card:";

export function MovementForm({ initialType = "egreso", movement, draft, draftIdentity, currentMember, categories, accounts, creditCards = [], allowCreditCardSource = true, onQuickCreateCategory, onSave, onSaveCreditCardPurchase, onCancel }: MovementFormProps) {
  const [type, setType] = useState<MovementType>(movement?.type ?? draft?.type ?? initialType);
  const [date, setDate] = useState(movement?.date ?? draft?.date ?? today());
  const [amount, setAmount] = useState(movement?.amount.toString() ?? draft?.amount?.toString() ?? "");
  const [description, setDescription] = useState(movement?.description ?? draft?.description ?? "");
  const [accountId, setAccountId] = useState<string | null>(() => initialAccountId(movement, draft, accounts));
  const [category, setCategory] = useState(movement?.category ?? draft?.category ?? "Negocio");
  const [person, setPerson] = useState(() => initialPersonValue(movement, draft, currentMember));
  const [personChoice, setPersonChoice] = useState<PersonChoice>(() => initialPersonChoice(movement, draft, currentMember));
  const [categoryTouched, setCategoryTouched] = useState(Boolean(movement || draft?.category));
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showCategorySelector, setShowCategorySelector] = useState(Boolean(movement));
  const [showDatePicker, setShowDatePicker] = useState(Boolean(movement) || (Boolean(draft?.date) && draft?.date !== today()));
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryType, setNewCategoryType] = useState<CategoryType>(initialType);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [validationError, setValidationError] = useState<ValidationError | null>(null);
  const cardPurchaseRequestRef = useRef<{ fingerprint: string; input: CreditCardPurchaseInput } | null>(null);
  const logicalFormIdentity = movement?.id
    ? `movement:${movement.id}`
    : draftIdentity
      ? `draft:${draftIdentity}`
      : `new:${initialType}`;

  const availableCategories = categories.filter((item) => item.is_active && (item.type === type || item.type === "ambos"));
  const dateLabel = date === today() ? "Hoy" : formatDateLabel(date);
  const selectableAccounts = accounts.filter((account) => account.isActive || account.id === movement?.accountId || account.id === accountId);
  const selectableCards = allowCreditCardSource && onSaveCreditCardPurchase && !movement ? eligibleCreditCardsForSpending(creditCards) : [];
  const selectedCreditCardId = accountId?.startsWith(creditCardSourcePrefix) ? accountId.slice(creditCardSourcePrefix.length) : null;
  const selectedCreditCard = selectedCreditCardId ? creditCards.find((card) => card.id === selectedCreditCardId) : null;
  const selectedCreditCardIsAvailable = type === "egreso" && selectedCreditCardId !== null && selectableCards.some((card) => card.id === selectedCreditCardId);
  const selectedAccount = accountId && !selectedCreditCardId ? accounts.find((account) => account.id === accountId) ?? null : null;
  const selectedAccountIsAvailable = accountId !== null && selectedCreditCardId === null && Boolean(selectedAccount?.isActive);
  const selectedSourceIsUnavailable = Boolean(accountId) && (selectedCreditCardId !== null ? !selectedCreditCardIsAvailable : !selectedAccountIsAvailable);
  const categoryIsUnavailable = categories.length > 0 && !availableCategories.some((item) => item.name === category);

  useEffect(() => {
    const nextPerson = initialPersonValue(movement, draft, currentMember);
    const nextDate = movement?.date ?? draft?.date ?? today();
    setType(movement?.type ?? draft?.type ?? initialType);
    setDate(nextDate);
    setAmount(movement?.amount.toString() ?? draft?.amount?.toString() ?? "");
    setDescription(movement?.description ?? draft?.description ?? "");
    setAccountId(initialAccountId(movement, draft, accounts));
    setCategory(movement?.category ?? draft?.category ?? "Negocio");
    setPerson(nextPerson);
    setPersonChoice(initialPersonChoice(movement, draft, currentMember));
    setCategoryTouched(Boolean(movement || draft?.category));
    setShowCategorySelector(Boolean(movement));
    setShowDatePicker(Boolean(movement) || nextDate !== today());
    setValidationError(null);
    cardPurchaseRequestRef.current = null;
  }, [logicalFormIdentity]);

  useEffect(() => {
    if (!categoryTouched) {
      const detected = detectCategory(description);
      const isAllowed = availableCategories.some((item) => item.name === detected);
      setCategory(isAllowed ? detected : availableCategories.find((item) => item.name === "Negocio")?.name ?? availableCategories[0]?.name ?? "Negocio");
    }
  }, [availableCategories, description, categoryTouched]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSaving) return;

    if (!isValidAmount(amount)) {
      setValidationError({ field: "amount", message: "Ingresa un monto mayor a S/ 0.00." });
      return;
    }
    if (!description.trim()) {
      setValidationError({ field: "description", message: "Escribe una descripción del movimiento." });
      return;
    }
    if (!person.trim()) {
      setValidationError({ field: "person", message: "Selecciona quién está registrando el movimiento." });
      return;
    }
    if (!accountId && !movement) {
      setValidationError({ field: "source", message: "Selecciona una cuenta o tarjeta para registrar el movimiento." });
      return;
    }
    if (selectedSourceIsUnavailable) {
      setValidationError({ field: "source", message: "La cuenta/tarjeta seleccionada ya no está disponible. Elige otra para guardar." });
      return;
    }
    if (categoryIsUnavailable) {
      setValidationError({ field: "category", message: "La categoría seleccionada ya no está disponible. Elige otra para guardar." });
      return;
    }

    const parsedAmount = Number(amount);
    const selectedAccountForSave = selectedCreditCardId ? null : accounts.find((item) => item.id === accountId) ?? null;
    setValidationError(null);

    setIsSaving(true);
    try {
      const saved = selectedCreditCardId && !movement
        ? onSaveCreditCardPurchase
          ? await onSaveCreditCardPurchase(getCreditCardPurchaseInput({
              requestRef: cardPurchaseRequestRef,
              debtId: selectedCreditCardId,
              purchaseDate: date,
              amount: parsedAmount,
              description: description.trim(),
              category,
            }))
          : false
        : await onSave(
            {
              type,
              date,
              amount: parsedAmount,
              description: description.trim(),
              method: accountId === null ? movement?.method ?? "efectivo" : legacyMethodForAccount(selectedAccountForSave),
              category,
              accountId: selectedCreditCardId ? null : accountId,
              ...(currentMember ? {} : { person: person.trim() }),
            },
            movement?.id
          );

      if (saved === false) return;
      if (selectedCreditCardId && !movement) cardPurchaseRequestRef.current = null;
      if (!currentMember) savePreferredPerson(person, personChoice === "Otro");

      if (!movement) {
        setAmount("");
        setDescription("");
        setPersonChoice("");
        setPerson(currentMember?.displayName ?? "");
        setCategoryTouched(false);
      }
    } finally {
      setIsSaving(false);
    }
  }

  function handlePersonChoice(choice: PersonChoice) {
    if (currentMember) return;
    setPersonChoice(choice);
    if (choice === "Otro" || choice === "") {
      setPerson("");
      return;
    }

    setPerson(choice);
    clearValidationError("person");
    savePreferredPerson(choice, false);
  }

  function clearValidationError(field: ValidationField) {
    setValidationError((current) => (current?.field === field ? null : current));
  }

  async function handleQuickCategorySubmit(event: FormEvent) {
    event.preventDefault();
    if (isCreatingCategory) return;

    setIsCreatingCategory(true);
    try {
      const created = await onQuickCreateCategory({
        name: newCategoryName.trim(),
        type: newCategoryType,
        color: "#2563eb",
        icon: "tag",
        is_active: true,
      });
      if (!created) return;
      setCategory(created.name);
      setCategoryTouched(true);
      setNewCategoryName("");
      setNewCategoryType(type);
      setShowCategoryModal(false);
      setShowCategorySelector(true);
    } finally {
      setIsCreatingCategory(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="rounded-3xl bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-3xl font-black text-slate-900">{movement ? "Editar movimiento" : type === "egreso" ? "Registrar gasto" : "Registrar ingreso"}</h2>
            {!movement && <span className={`rounded-full px-3 py-1 text-sm font-black ${type === "egreso" ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>{type === "egreso" ? "Gasto" : "Ingreso"}</span>}
          </div>
          <p className="mt-2 text-base text-slate-600">Completa lo esencial y guarda en pocos pasos.</p>
        </div>

        {validationError && (
          <p id="movement-form-error" role="alert" aria-live="assertive" className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-base font-bold text-red-800">
            {validationError.message}
          </p>
        )}

        <div className="space-y-5">
          {movement && (
            <label className="block space-y-2 text-base font-bold text-slate-700">
              Tipo de movimiento
              <select value={type} onChange={(event) => setType(event.target.value as MovementType)} className="h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-lg">
                <option value="ingreso">Ingreso</option>
                <option value="egreso">Gasto</option>
              </select>
            </label>
          )}

          <label className="block space-y-2 text-base font-bold text-slate-700">
            Monto
            <div className="flex h-20 items-center rounded-2xl border-2 border-blue-200 bg-blue-50 px-4 focus-within:border-blue-500">
              <span className="mr-2 text-2xl font-black text-blue-700">S/</span>
              <input
                autoFocus={!movement}
                min="0"
                step="0.01"
                inputMode="decimal"
                type="number"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  if (isValidAmount(event.target.value)) clearValidationError("amount");
                }}
                placeholder="0.00"
                aria-invalid={validationError?.field === "amount"}
                aria-describedby={validationError?.field === "amount" ? "movement-form-error" : undefined}
                className="h-full min-w-0 flex-1 bg-transparent text-3xl font-black text-slate-900 outline-none placeholder:text-blue-200"
              />
            </div>
          </label>

          <label className="block space-y-2 text-base font-bold text-slate-700">
            Descripción
            <input
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                if (event.target.value.trim()) clearValidationError("description");
              }}
              placeholder="Ej. Pan molido"
              aria-invalid={validationError?.field === "description"}
              aria-describedby={validationError?.field === "description" ? "movement-form-error" : undefined}
              className="h-16 w-full rounded-2xl border border-slate-200 px-4 text-lg"
            />
          </label>

          <label className="block space-y-2 text-base font-bold text-slate-700">
            {type === "egreso" ? "Pagar con" : "Cuenta de destino"}
            <select
              aria-label={type === "egreso" ? "Pagar con" : "Cuenta de destino"}
              aria-invalid={validationError?.field === "source" || selectedSourceIsUnavailable}
              aria-describedby={validationError?.field === "source" || selectedSourceIsUnavailable ? "movement-form-error" : undefined}
              value={accountId ?? ""}
              onChange={(event) => {
                setAccountId(event.target.value || null);
                clearValidationError("source");
              }}
              className="h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-lg"
            >
              {selectedSourceIsUnavailable && selectedCreditCardId && !selectedCreditCardIsAvailable && (
                <optgroup label="Fuente seleccionada">
                  <option value={accountId ?? ""} disabled>{selectedCreditCard?.name ?? "Tarjeta seleccionada"} (no disponible)</option>
                </optgroup>
              )}
              {selectedSourceIsUnavailable && !selectedCreditCardId && accountId && !selectableAccounts.some((account) => account.id === accountId) && (
                <optgroup label="Fuente seleccionada">
                  <option value={accountId} disabled>{selectedAccount?.name ?? "Cuenta seleccionada"} (no disponible)</option>
                </optgroup>
              )}
              {selectableAccounts.length === 0 && !movement && <option value="">Sin cuentas disponibles</option>}
              {selectableAccounts.length > 0 && <optgroup label="Cuentas">
                {selectableAccounts.map((item) => (
                  <option key={item.id} value={item.id} disabled={!item.isActive}>
                    {item.isActive ? item.name : `${item.name} (no disponible)`}
                  </option>
                ))}
              </optgroup>}
              {type === "egreso" && selectableCards.length > 0 && <optgroup label="Tarjetas PEN activas">
                {selectableCards.map((card) => (
                  <option key={card.id} value={`${creditCardSourcePrefix}${card.id}`}>
                    {card.name} · {card.creditorName}
                  </option>
                ))}
              </optgroup>}
              {movement && <option value="">{unassignedAccountLabel}</option>}
            </select>
            {selectableAccounts.length === 0 && selectableCards.length === 0 && !movement && (
              <span className="block text-sm font-semibold text-slate-500">Crea una cuenta primero desde la sección Cuentas o registra una tarjeta PEN activa.</span>
            )}
            {selectedSourceIsUnavailable && <p role="alert" className="block text-sm font-bold text-red-700">La cuenta/tarjeta seleccionada ya no está disponible. Elige otra para guardar.</p>}
            {selectedCreditCardId && selectedCreditCardIsAvailable && <span className="block text-sm font-semibold text-blue-700">La compra se guardará en el ledger de la tarjeta; no descontará una cuenta bancaria.</span>}
          </label>

          {currentMember ? (
            <section className="rounded-2xl border border-blue-100 bg-blue-50 p-4" aria-label="Autor del movimiento">
              <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Registrado por</p>
              <p className="mt-1 text-xl font-black text-slate-900">{person}</p>
              <p className="mt-1 text-sm text-slate-600">Se asigna automáticamente según tu cuenta.</p>
            </section>
          ) : (
            <fieldset className="space-y-2" aria-invalid={validationError?.field === "person"} aria-describedby={validationError?.field === "person" ? "movement-form-error" : undefined}>
              <legend className="text-base font-bold text-slate-700">Registrado por</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {knownPeople.map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={personChoice === item}
                    onClick={() => handlePersonChoice(item)}
                    className={`min-h-14 rounded-2xl border-2 px-3 py-2 text-base font-black transition ${personChoice === item ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300"}`}
                  >
                    {item}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={personChoice === "Otro"}
                  onClick={() => handlePersonChoice("Otro")}
                  className={`min-h-14 rounded-2xl border-2 px-3 py-2 text-base font-black transition ${personChoice === "Otro" ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300"}`}
                >
                  Otro
                </button>
              </div>
              {personChoice === "Otro" && (
                <input
                  value={person}
                  onChange={(event) => {
                    setPerson(event.target.value);
                    if (event.target.value.trim()) clearValidationError("person");
                  }}
                  onBlur={() => savePreferredPerson(person, true)}
                  placeholder="Escribe el nombre"
                  aria-invalid={validationError?.field === "person"}
                  aria-describedby={validationError?.field === "person" ? "movement-form-error" : undefined}
                  className="h-14 w-full rounded-2xl border border-slate-200 px-4 text-lg"
                />
              )}
            </fieldset>
          )}

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Categoría sugerida</p>
                <p className="mt-1 text-xl font-black text-slate-900">{category || "Negocio"}</p>
              </div>
              <button type="button" onClick={() => setShowCategorySelector((current) => !current)} className="min-h-12 rounded-xl bg-white px-4 py-2 text-base font-black text-blue-700 shadow-sm hover:bg-blue-50" aria-expanded={showCategorySelector}>
                {showCategorySelector ? "Ocultar" : "Cambiar"}
              </button>
            </div>
            {showCategorySelector && (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <select
                  aria-label="Categoría"
                  value={category}
                  onChange={(event) => {
                    setCategoryTouched(true);
                    setCategory(event.target.value);
                    clearValidationError("category");
                  }}
                  className="h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-lg"
                >
                  {categoryIsUnavailable && <option value={category} disabled>{category} (no disponible)</option>}
                  {availableCategories.map((item) => (
                    <option key={item.id} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => { setNewCategoryType(type); setShowCategoryModal(true); }} className="flex min-h-14 shrink-0 items-center justify-center gap-2 rounded-2xl bg-slate-800 px-4 py-3 text-base font-black text-white hover:bg-slate-900">
                  <Plus className="h-5 w-5" />
                  Nueva categoría
                </button>
              </div>
            )}
            {categoryIsUnavailable && <p role="alert" className="mt-2 text-sm font-bold text-red-700">La categoría seleccionada ya no está disponible. Elige otra para guardar.</p>}
          </section>

          {movement ? (
            <label className="block space-y-2 text-base font-bold text-slate-700">
              Fecha
              <input aria-label="Fecha" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-14 w-full rounded-2xl border border-slate-200 px-4 text-lg" />
            </label>
          ) : (
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <CalendarDays className="h-6 w-6 text-blue-700" />
                  <p className="text-lg font-black text-slate-900">Fecha: {dateLabel}</p>
                </div>
                <button type="button" onClick={() => setShowDatePicker((current) => !current)} className="min-h-12 rounded-xl bg-slate-100 px-4 py-2 text-base font-black text-slate-700 hover:bg-slate-200">
                  {showDatePicker ? "Ocultar selector" : "Cambiar fecha"}
                </button>
              </div>
              {showDatePicker && <input aria-label="Fecha" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-3 h-14 w-full rounded-2xl border border-slate-200 px-4 text-lg" />}
            </section>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button disabled={isSaving} type="submit" className="flex min-h-16 flex-1 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-xl font-black text-white shadow-md hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
            <Save className="h-6 w-6" />
            {isSaving ? "Guardando..." : movement ? "Guardar cambios" : type === "egreso" ? "Guardar gasto" : "Guardar ingreso"}
          </button>
          {onCancel && (
            <button disabled={isSaving} type="button" onClick={onCancel} className="min-h-14 rounded-2xl border border-slate-300 px-5 py-3 text-lg font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
              Cancelar
            </button>
          )}
        </div>
      </form>

      {showCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-label="Nueva categoría">
          <form onSubmit={handleQuickCategorySubmit} className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-2xl font-black text-slate-900">Nueva categoría</h3>
              <button type="button" onClick={() => setShowCategoryModal(false)} className="rounded-full bg-slate-100 p-3 text-slate-600 hover:bg-slate-200" aria-label="Cerrar nueva categoría">
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="space-y-4">
              <label className="block space-y-2 text-base font-bold text-slate-700">
                Nombre
                <input autoFocus value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} className="h-14 w-full rounded-2xl border border-slate-200 px-4 text-lg" />
              </label>
              <label className="block space-y-2 text-base font-bold text-slate-700">
                Tipo
                <select value={newCategoryType} onChange={(event) => setNewCategoryType(event.target.value as CategoryType)} className="h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-lg">
                  <option value="ingreso">Ingreso</option>
                  <option value="egreso">Gasto</option>
                  <option value="ambos">Ambos</option>
                </select>
              </label>
              <button disabled={isCreatingCategory} type="submit" className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-lg font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
                <Save className="h-6 w-6" />
                {isCreatingCategory ? "Guardando..." : "Crear y seleccionar"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function initialAccountId(movement?: Movement | null, draft?: MovementDraft | null, accounts?: FinancialAccount[]): string | null {
  if (movement) return movement.accountId;
  if (draft?.accountId) return draft.accountId;
  return getActiveCashAccount(accounts ?? [])?.id ?? null;
}

function getCreditCardPurchaseInput({
  requestRef,
  debtId,
  purchaseDate,
  amount,
  description,
  category,
}: {
  requestRef: { current: { fingerprint: string; input: CreditCardPurchaseInput } | null };
  debtId: string;
  purchaseDate: string;
  amount: number;
  description: string;
  category: string;
}): CreditCardPurchaseInput {
  const fingerprint = JSON.stringify({ debtId, purchaseDate, amount, description, category });
  if (requestRef.current?.fingerprint === fingerprint) return requestRef.current.input;

  const input: CreditCardPurchaseInput = {
    debtId,
    entryId: makeUuid(),
    movementId: makeUuid(),
    purchaseDate,
    amount,
    description,
    category,
  };
  requestRef.current = { fingerprint, input };
  return input;
}

function initialPersonValue(movement?: Movement | null, draft?: MovementDraft | null, currentMember?: HouseholdMember) {
  if (movement) return movement.person;
  if (currentMember) return currentMember.displayName;
  if (draft?.person) return draft.person;
  return loadPreferredPerson().value;
}

function initialPersonChoice(movement?: Movement | null, draft?: MovementDraft | null, currentMember?: HouseholdMember): PersonChoice {
  if (currentMember) return "";
  if (movement) return getPersonChoice(movement.person);
  if (draft?.person) return getPersonChoice(draft.person);
  const preferred = loadPreferredPerson();
  return preferred.isCustom ? "Otro" : getPersonChoice(preferred.value);
}

function getPersonChoice(value: string): PersonChoice {
  if (value === "Rolando" || value === "Verónica" || value === "Renzo") return value;
  return value ? "Otro" : "";
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function isValidAmount(value: string) {
  const parsed = Number(value);
  return value.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
}
