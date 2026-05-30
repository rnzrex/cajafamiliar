import {
  BarChart3,
  CalendarClock,
  ClipboardList,
  Coins,
  Home,
  Menu,
  PiggyBank,
  PlusCircle,
  Settings,
  Tags,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CashCounter } from "./components/CashCounter";
import { CategoriesManager } from "./components/CategoriesManager";
import { Dashboard } from "./components/Dashboard";
import { InitialBalance } from "./components/InitialBalance";
import { MovementForm } from "./components/MovementForm";
import { MovementsList } from "./components/MovementsList";
import { RecurringPayments } from "./components/RecurringPayments";
import { Reports } from "./components/Reports";
import { AppData, Category, Movement, MovementDraft, MovementType, RecurringPayment } from "./types";
import { expectedCash, formatMoney, isPaymentFinished, isPaymentPaidThisMonth } from "./utils/calculations";
import { loadAppData, saveAppData } from "./services/dataRepository";
import { makeId, loadData } from "./utils/storage";
import { localDateString } from "./utils/date";

type View = "dashboard" | "registrar-ingreso" | "registrar-gasto" | "movimientos" | "conteo" | "pagos" | "reportes" | "categorias" | "saldo-inicial";

const navItems: Array<{ view: View; label: string; icon: typeof Home }> = [
  { view: "dashboard", label: "Inicio", icon: Home },
  { view: "registrar-gasto", label: "Registrar", icon: PlusCircle },
  { view: "movimientos", label: "Movimientos", icon: ClipboardList },
  { view: "conteo", label: "Caja", icon: Coins },
  { view: "pagos", label: "Pagos", icon: CalendarClock },
  { view: "reportes", label: "Reportes", icon: BarChart3 },
  { view: "categorias", label: "Categorias", icon: Tags },
  { view: "saldo-inicial", label: "Saldo inicial", icon: Settings },
];

const titles: Record<View, string> = {
  dashboard: "Caja Familiar",
  "registrar-ingreso": "Registrar ingreso",
  "registrar-gasto": "Registrar gasto",
  movimientos: "Movimientos",
  conteo: "Conteo de caja",
  pagos: "Pagos recurrentes",
  reportes: "Reportes",
  categorias: "Categorias",
  "saldo-inicial": "Saldo inicial",
};

export default function App() {
  const [data, setData] = useState<AppData>(() => loadData());
  const [view, setView] = useState<View>("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [movementDraft, setMovementDraft] = useState<MovementDraft | null>(null);
  const [pendingRecurringPaymentId, setPendingRecurringPaymentId] = useState<string | null>(null);
  const [dataReady, setDataReady] = useState(false);
  const expected = useMemo(() => expectedCash(data.movements, data.initialBalance), [data.movements, data.initialBalance]);

  useEffect(() => {
    loadAppData().then((loadedData) => {
      setData(loadedData);
      setDataReady(true);
    });
  }, []);

  useEffect(() => {
    if (dataReady) void saveAppData(data);
  }, [data, dataReady]);

  function navigate(nextView: string) {
    if (nextView !== "registrar-gasto" && nextView !== "registrar-ingreso") {
      setMovementDraft(null);
      setPendingRecurringPaymentId(null);
    }
    setView(nextView as View);
    setMenuOpen(false);
  }

  function saveMovement(movement: Omit<Movement, "id">, id?: string) {
    setData((current) => ({
      ...current,
      movements: id
        ? current.movements.map((item) => (item.id === id ? { ...movement, id } : item))
        : [{ ...movement, id: makeId("mov"), createdAt: new Date().toISOString() }, ...current.movements],
      recurringPayments: pendingRecurringPaymentId
        ? current.recurringPayments.map((item) =>
            item.id === pendingRecurringPaymentId ? markPaidForCurrentMonth(item) : item
          )
        : current.recurringPayments,
    }));
    const shouldReturnToPayments = Boolean(pendingRecurringPaymentId);
    setMovementDraft(null);
    setPendingRecurringPaymentId(null);
    setView(shouldReturnToPayments ? "pagos" : "movimientos");
  }

  function deleteMovement(id: string) {
    if (!window.confirm("Seguro que deseas eliminar este movimiento?")) return;
    setData((current) => ({ ...current, movements: current.movements.filter((movement) => movement.id !== id) }));
  }

  function savePayment(payment: Omit<RecurringPayment, "id">, id?: string) {
    setData((current) => ({
      ...current,
      recurringPayments: id
        ? current.recurringPayments.map((item) => (item.id === id ? { ...payment, id } : item))
        : [{ ...payment, id: makeId("pay") }, ...current.recurringPayments],
    }));
  }

  function markPaymentPaid(payment: RecurringPayment, shouldCreateExpense: boolean) {
    if (shouldCreateExpense) {
      setMovementDraft({
        type: "egreso",
        date: localDateString(),
        amount: payment.amount,
        description: payment.name,
        category: payment.category,
      });
      setPendingRecurringPaymentId(payment.id);
      setView("registrar-gasto");
      return;
    }

    setData((current) => ({ ...current, recurringPayments: current.recurringPayments.map((item) => (item.id === payment.id ? markPaidForCurrentMonth(item) : item)) }));
  }

  function deactivatePayment(id: string) {
    setData((current) => ({ ...current, recurringPayments: current.recurringPayments.map((item) => (item.id === id ? { ...item, is_active: false } : item)) }));
  }

  function saveCategory(category: Omit<Category, "id" | "created_at">, id?: string): Category | null {
    const name = category.name.trim();
    if (!name) {
      window.alert("La categoria no puede estar vacia.");
      return null;
    }

    const duplicate = data.categories.some((item) => item.id !== id && normalizeName(item.name) === normalizeName(name));
    if (duplicate) {
      window.alert("Ya existe una categoria con ese nombre.");
      return null;
    }

    const savedCategory: Category = {
      ...category,
      name,
      id: id ?? makeId("cat"),
      created_at: id ? (data.categories.find((item) => item.id === id)?.created_at ?? new Date().toISOString()) : new Date().toISOString(),
    };

    setData((current) => ({
      ...current,
      categories: id ? current.categories.map((item) => (item.id === id ? savedCategory : item)) : [savedCategory, ...current.categories],
    }));

    return savedCategory;
  }

  function deleteCategory(id: string) {
    const category = data.categories.find((item) => item.id === id);
    if (!category) return;
    const hasMovements = data.movements.some((movement) => normalizeName(movement.category) === normalizeName(category.name));
    if (hasMovements) {
      window.alert("No puedes eliminar esta categoria porque ya tiene movimientos registrados. Puedes desactivarla.");
      return;
    }
    if (!window.confirm("Seguro que deseas eliminar esta categoria?")) return;
    setData((current) => ({ ...current, categories: current.categories.filter((item) => item.id !== id) }));
  }

  function toggleCategory(id: string) {
    setData((current) => ({ ...current, categories: current.categories.map((item) => (item.id === id ? { ...item, is_active: !item.is_active } : item)) }));
  }

  function markPaidForCurrentMonth(payment: RecurringPayment): RecurringPayment {
    const now = new Date();
    const paidInstallments =
      payment.recurrence_type === "fixed" && !isPaymentPaidThisMonth(payment) ? payment.paid_installments + 1 : payment.paid_installments;
    const updated: RecurringPayment = {
      ...payment,
      status: "pagado",
      paidAt: now.toISOString(),
      paid_installments: paidInstallments,
      last_paid_month: now.getMonth() + 1,
      last_paid_year: now.getFullYear(),
    };

    return isPaymentFinished(updated) ? { ...updated, is_active: false } : updated;
  }

  const initialType: MovementType = view === "registrar-ingreso" ? "ingreso" : "egreso";

  return (
    <div className="min-h-screen bg-slate-100">
      <aside className={`fixed inset-y-0 left-0 z-30 w-72 transform bg-white p-4 shadow-xl transition lg:translate-x-0 ${menuOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-3 text-blue-700">
              <PiggyBank className="h-8 w-8" />
            </div>
            <div>
              <p className="text-xl font-bold text-slate-900">Caja Familiar</p>
              <p className="text-sm text-slate-500">Finanzas en soles</p>
            </div>
          </div>
          <button type="button" className="rounded-lg p-2 text-slate-600 lg:hidden" onClick={() => setMenuOpen(false)} title="Cerrar menu">
            <X className="h-6 w-6" />
          </button>
        </div>

        <nav className="space-y-2">
          {navItems.map((item) => (
            <button
              key={item.view}
              type="button"
              onClick={() => navigate(item.view)}
              className={`flex min-h-14 w-full items-center gap-3 rounded-lg px-4 text-left text-lg font-bold transition ${
                view === item.view ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <item.icon className="h-6 w-6 shrink-0" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-6 rounded-lg bg-blue-50 p-4 text-blue-900">
          <p className="font-semibold">Saldo esperado</p>
          <p className="text-2xl font-bold">{formatMoney(expected)}</p>
        </div>
      </aside>

      {menuOpen && <button className="fixed inset-0 z-20 bg-slate-900/30 lg:hidden" type="button" onClick={() => setMenuOpen(false)} title="Cerrar menu" />}

      <main className="lg:pl-72">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100/95 px-4 py-4 backdrop-blur lg:px-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">{titles[view]}</h1>
              <p className="text-slate-600">Gestion familiar clara, simple y guardada en este equipo.</p>
            </div>
            <button type="button" className="rounded-lg bg-white p-3 text-slate-700 shadow lg:hidden" onClick={() => setMenuOpen(true)} title="Abrir menu">
              <Menu className="h-7 w-7" />
            </button>
          </div>
        </header>

        <div className="p-4 lg:p-8">
          {view === "dashboard" && (
            <Dashboard movements={data.movements} cashCounts={data.cashCounts} recurringPayments={data.recurringPayments} initialBalance={data.initialBalance} onNavigate={navigate} />
          )}
          {(view === "registrar-ingreso" || view === "registrar-gasto") && (
            <MovementForm
              initialType={initialType}
              draft={movementDraft}
              categories={data.categories}
              onQuickCreateCategory={saveCategory}
              onSave={saveMovement}
              onCancel={
                movementDraft
                  ? () => {
                      setMovementDraft(null);
                      setPendingRecurringPaymentId(null);
                      setView("pagos");
                    }
                  : undefined
              }
            />
          )}
          {view === "movimientos" && (
            <MovementsList
              movements={data.movements}
              categories={data.categories}
              onQuickCreateCategory={saveCategory}
              onSave={saveMovement}
              onDelete={deleteMovement}
            />
          )}
          {view === "conteo" && (
            <CashCounter
              movements={data.movements}
              initialBalance={data.initialBalance}
              cashCounts={data.cashCounts}
              onSave={(cashCount) => setData((current) => ({ ...current, cashCounts: [{ ...cashCount, id: makeId("count") }, ...current.cashCounts] }))}
            />
          )}
          {view === "pagos" && (
            <RecurringPayments
              payments={data.recurringPayments}
              categories={data.categories}
              onSave={savePayment}
              onMarkPaid={markPaymentPaid}
              onDeactivate={deactivatePayment}
            />
          )}
          {view === "reportes" && <Reports movements={data.movements} categories={data.categories} initialBalance={data.initialBalance} />}
          {view === "categorias" && <CategoriesManager categories={data.categories} onSave={saveCategory} onDelete={deleteCategory} onToggle={toggleCategory} />}
          {view === "saldo-inicial" && <InitialBalance initialBalance={data.initialBalance} onSave={(value) => setData((current) => ({ ...current, initialBalance: value }))} />}
        </div>
      </main>
    </div>
  );
}

function normalizeName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
