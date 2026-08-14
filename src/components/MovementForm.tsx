import { Plus, Save, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Category, CategoryType, Movement, MovementDraft, MovementType, paymentMethods } from "../types";
import { detectCategory } from "../utils/categoryDetector";
import { localDateString } from "../utils/date";

interface MovementFormProps {
  initialType?: MovementType;
  movement?: Movement | null;
  draft?: MovementDraft | null;
  categories: Category[];
  onQuickCreateCategory: (category: Omit<Category, "id" | "created_at">) => Category | null;
  onSave: (movement: Omit<Movement, "id">, id?: string) => void | Promise<boolean>;
  onCancel?: () => void;
}

const today = () => localDateString();

export function MovementForm({ initialType = "egreso", movement, draft, categories, onQuickCreateCategory, onSave, onCancel }: MovementFormProps) {
  const [type, setType] = useState<MovementType>(movement?.type ?? draft?.type ?? initialType);
  const [date, setDate] = useState(movement?.date ?? draft?.date ?? today());
  const [amount, setAmount] = useState(movement?.amount.toString() ?? draft?.amount?.toString() ?? "");
  const [description, setDescription] = useState(movement?.description ?? draft?.description ?? "");
  const [method, setMethod] = useState(movement?.method ?? draft?.method ?? "efectivo");
  const [category, setCategory] = useState(movement?.category ?? draft?.category ?? "Otros");
  const [person, setPerson] = useState(movement?.person ?? draft?.person ?? "");
  const [categoryTouched, setCategoryTouched] = useState(Boolean(movement || draft?.category));
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryType, setNewCategoryType] = useState<CategoryType>(initialType);
  const [isSaving, setIsSaving] = useState(false);

  const availableCategories = categories.filter((item) => item.is_active && (item.type === type || item.type === "ambos"));

  useEffect(() => {
    setType(movement?.type ?? draft?.type ?? initialType);
    setDate(movement?.date ?? draft?.date ?? today());
    setAmount(movement?.amount.toString() ?? draft?.amount?.toString() ?? "");
    setDescription(movement?.description ?? draft?.description ?? "");
    setMethod(movement?.method ?? draft?.method ?? "efectivo");
    setCategory(movement?.category ?? draft?.category ?? "Otros");
    setPerson(movement?.person ?? draft?.person ?? "");
    setCategoryTouched(Boolean(movement || draft?.category));
  }, [draft, initialType, movement]);

  useEffect(() => {
    if (!categoryTouched) {
      const detected = detectCategory(description);
      const isAllowed = availableCategories.some((item) => item.name === detected);
      setCategory(isAllowed ? detected : "Otros");
    }
  }, [availableCategories, description, categoryTouched]);

  useEffect(() => {
    if (!availableCategories.some((item) => item.name === category)) {
      setCategory(availableCategories.find((item) => item.name === "Otros")?.name ?? availableCategories[0]?.name ?? "");
    }
  }, [availableCategories, category]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSaving) return;

    const parsedAmount = Number(amount);
    if (!description.trim() || !person.trim() || !parsedAmount || parsedAmount <= 0) return;

    setIsSaving(true);
    try {
      const saved = await onSave(
        {
          type,
          date,
          amount: parsedAmount,
          description: description.trim(),
          method,
          category,
          person: person.trim(),
        },
        movement?.id
      );

      if (!movement && saved !== false) {
        setAmount("");
        setDescription("");
        setPerson("");
        setCategoryTouched(false);
      }
    } finally {
      setIsSaving(false);
    }
  }

  function handleQuickCategorySubmit(event: FormEvent) {
    event.preventDefault();
    const created = onQuickCreateCategory({
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
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg bg-white p-5 soft-shadow">
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-slate-800">{movement ? "Editar movimiento" : "Registrar movimiento"}</h2>
        <p className="mt-1 text-base text-slate-600">La categoria se sugiere automaticamente por la descripcion.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="space-y-2 text-lg font-semibold text-slate-700">
          Tipo
          <select value={type} onChange={(event) => setType(event.target.value as MovementType)} className="h-14 w-full rounded-lg border border-slate-200 bg-white px-4 text-lg">
            <option value="ingreso">Ingreso</option>
            <option value="egreso">Egreso</option>
          </select>
        </label>
        <label className="space-y-2 text-lg font-semibold text-slate-700">
          Fecha
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-14 w-full rounded-lg border border-slate-200 px-4 text-lg" />
        </label>
        <label className="space-y-2 text-lg font-semibold text-slate-700">
          Monto
          <input min="0" step="0.1" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="S/ 0.00" className="h-14 w-full rounded-lg border border-slate-200 px-4 text-lg" />
        </label>
        <label className="space-y-2 text-lg font-semibold text-slate-700">
          Metodo de pago
          <select value={method} onChange={(event) => setMethod(event.target.value as typeof method)} className="h-14 w-full rounded-lg border border-slate-200 bg-white px-4 text-lg">
            {paymentMethods.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-lg font-semibold text-slate-700 md:col-span-2">
          Descripcion
          <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ejemplo: compra mercado" className="h-14 w-full rounded-lg border border-slate-200 px-4 text-lg" />
        </label>
        <label className="space-y-2 text-lg font-semibold text-slate-700">
          Categoria
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={category}
              onChange={(event) => {
                setCategoryTouched(true);
                setCategory(event.target.value);
              }}
              className="h-14 w-full rounded-lg border border-slate-200 bg-white px-4 text-lg"
            >
              {availableCategories.map((item) => (
                <option key={item.id} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                setNewCategoryType(type);
                setShowCategoryModal(true);
              }}
              className="flex min-h-14 shrink-0 items-center justify-center gap-2 rounded-lg bg-slate-700 px-4 py-3 text-lg font-bold text-white hover:bg-slate-800"
            >
              <Plus className="h-5 w-5" />
              Nueva categoria
            </button>
          </div>
        </label>
        <label className="space-y-2 text-lg font-semibold text-slate-700">
          Persona que registra
          <input value={person} onChange={(event) => setPerson(event.target.value)} placeholder="Nombre" className="h-14 w-full rounded-lg border border-slate-200 px-4 text-lg" />
        </label>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button disabled={isSaving} type="submit" className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-xl font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
          <Save className="h-6 w-6" />
          {isSaving ? "Guardando..." : "Guardar"}
        </button>
        {onCancel && (
          <button disabled={isSaving} type="button" onClick={onCancel} className="min-h-14 rounded-lg border border-slate-300 px-5 py-3 text-xl font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
            Cancelar
          </button>
        )}
      </div>

      {showCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form onSubmit={handleQuickCategorySubmit} className="w-full max-w-md rounded-lg bg-white p-5 soft-shadow">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-2xl font-bold text-slate-800">Nueva categoria</h3>
              <button type="button" onClick={() => setShowCategoryModal(false)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" title="Cerrar">
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="space-y-4">
              <label className="block space-y-2 text-lg font-semibold text-slate-700">
                Nombre
                <input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} className="h-14 w-full rounded-lg border border-slate-200 px-4 text-lg" />
              </label>
              <label className="block space-y-2 text-lg font-semibold text-slate-700">
                Tipo
                <select value={newCategoryType} onChange={(event) => setNewCategoryType(event.target.value as CategoryType)} className="h-14 w-full rounded-lg border border-slate-200 bg-white px-4 text-lg">
                  <option value="ingreso">Ingreso</option>
                  <option value="egreso">Egreso</option>
                  <option value="ambos">Ambos</option>
                </select>
              </label>
              <button type="submit" className="flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-xl font-bold text-white hover:bg-blue-700">
                <Save className="h-6 w-6" />
                Crear y seleccionar
              </button>
            </div>
          </form>
        </div>
      )}
    </form>
  );
}
