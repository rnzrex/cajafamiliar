import { Edit, Power, Plus, Save, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { Category, CategoryType } from "../types";

interface CategoriesManagerProps {
  categories: Category[];
  onSave: (category: Omit<Category, "id" | "created_at">, id?: string) => Category | null;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
}

const colorOptions = ["#2563eb", "#16a34a", "#dc2626", "#f59e0b", "#7c3aed", "#0f766e", "#db2777", "#64748b"];

export function CategoriesManager({ categories, onSave, onDelete, onToggle }: CategoriesManagerProps) {
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<CategoryType>("egreso");
  const [color, setColor] = useState(colorOptions[0]);
  const [icon, setIcon] = useState("tag");

  function startEdit(category: Category) {
    setEditing(category);
    setName(category.name);
    setType(category.type);
    setColor(category.color ?? colorOptions[0]);
    setIcon(category.icon ?? "tag");
  }

  function resetForm() {
    setEditing(null);
    setName("");
    setType("egreso");
    setColor(colorOptions[0]);
    setIcon("tag");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const saved = onSave({ name: name.trim(), type, color, icon: icon.trim(), is_active: editing?.is_active ?? true }, editing?.id);
    if (saved) resetForm();
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[420px_1fr]">
      <form onSubmit={handleSubmit} className="rounded-lg bg-white p-5 soft-shadow">
        <div className="mb-5 flex items-center gap-3">
          <Plus className="h-7 w-7 text-blue-600" />
          <h2 className="text-2xl font-bold text-slate-800">{editing ? "Editar categoria" : "Nueva categoria"}</h2>
        </div>

        <div className="space-y-4">
          <label className="block space-y-2 text-lg font-semibold text-slate-700">
            Nombre
            <input value={name} onChange={(event) => setName(event.target.value)} className="h-14 w-full rounded-lg border border-slate-200 px-4 text-lg" />
          </label>
          <label className="block space-y-2 text-lg font-semibold text-slate-700">
            Tipo
            <select value={type} onChange={(event) => setType(event.target.value as CategoryType)} className="h-14 w-full rounded-lg border border-slate-200 bg-white px-4 text-lg">
              <option value="ingreso">Ingreso</option>
              <option value="egreso">Egreso</option>
              <option value="ambos">Ambos</option>
            </select>
          </label>
          <label className="block space-y-2 text-lg font-semibold text-slate-700">
            Color
            <div className="grid grid-cols-4 gap-2">
              {colorOptions.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setColor(item)}
                  className={`h-12 rounded-lg border-4 ${color === item ? "border-slate-800" : "border-white"}`}
                  style={{ backgroundColor: item }}
                  title={item}
                />
              ))}
            </div>
          </label>
          <label className="block space-y-2 text-lg font-semibold text-slate-700">
            Icono opcional
            <input value={icon} onChange={(event) => setIcon(event.target.value)} placeholder="Ejemplo: casa, colegio, mascota" className="h-14 w-full rounded-lg border border-slate-200 px-4 text-lg" />
          </label>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="submit" className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-xl font-bold text-white hover:bg-blue-700">
              <Save className="h-6 w-6" />
              {editing ? "Guardar cambios" : "Crear categoria"}
            </button>
            {editing && (
              <button type="button" onClick={resetForm} className="min-h-14 rounded-lg border border-slate-300 px-5 py-3 text-xl font-bold text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
            )}
          </div>
        </div>
      </form>

      <section className="rounded-lg bg-white p-5 soft-shadow">
        <h2 className="mb-4 text-2xl font-bold text-slate-800">Categorias existentes</h2>
        <div className="space-y-3">
          {categories.map((category) => (
            <article key={category.id} className={`rounded-lg border p-4 ${category.is_active ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-slate-100 opacity-75"}`}>
              <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                <div className="flex items-center gap-3">
                  <span className="h-10 w-10 shrink-0 rounded-lg" style={{ backgroundColor: category.color ?? "#94a3b8" }} />
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">{category.name}</h3>
                    <p className="text-slate-600">
                      {category.type} - {category.is_active ? "Activa" : "Inactiva"} {category.icon ? `- Icono: ${category.icon}` : ""}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <button type="button" onClick={() => startEdit(category)} className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-blue-100 px-4 py-2 text-lg font-bold text-blue-800 hover:bg-blue-200">
                    <Edit className="h-5 w-5" />
                    Editar
                  </button>
                  <button type="button" onClick={() => onToggle(category.id)} className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-slate-200 px-4 py-2 text-lg font-bold text-slate-700 hover:bg-slate-300">
                    <Power className="h-5 w-5" />
                    {category.is_active ? "Desactivar" : "Activar"}
                  </button>
                  <button type="button" onClick={() => onDelete(category.id)} className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-red-100 px-4 py-2 text-lg font-bold text-red-700 hover:bg-red-200">
                    <Trash2 className="h-5 w-5" />
                    Eliminar
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
