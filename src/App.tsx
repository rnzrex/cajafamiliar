import {
  BarChart3,
  CalendarClock,
  ClipboardList,
  Coins,
  Home,
  LogOut,
  MoreHorizontal,
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
import { Toast } from "./components/Toast";
import { AppData, CashCount, Category, HouseholdMember, Movement, MovementDraft, MovementFormInput, MovementType, RecurringPayment } from "./types";
import { expectedCash, formatMoney, isPaymentFinished, isPaymentPaidThisMonth } from "./utils/calculations";
import {
  CategoryNotFoundError,
  createCashCount,
  createCategory,
  createMovement,
  createRecurringPayment,
  deleteCategory as deleteRemoteCategory,
  deleteMovement as deleteRemoteMovement,
  getRecurringPayment,
  HouseholdNotProvisionedError,
  loadAppData,
  MovementNotFoundError,
  RecurringPaymentConflictError,
  RecurringPaymentNotFoundError,
  setCategoryActive,
  setRecurringPaymentActive,
  updateCategoryDetails,
  updateInitialBalance,
  updateMovement as updateRemoteMovement,
  updateRecurringPaymentDetails,
  updateRecurringPaymentPaymentState,
} from "./services/dataRepository";
import { isSupabaseConfigured } from "./services/supabaseClient";
import { makeId, loadData, saveData } from "./utils/storage";
import { localDateString } from "./utils/date";

type View = "dashboard" | "registrar-ingreso" | "registrar-gasto" | "movimientos" | "conteo" | "pagos" | "reportes" | "categorias" | "saldo-inicial";
type SyncStatus = "loading" | "connected" | "local" | "offline";

interface AppProps {
  currentMember?: HouseholdMember;
  onSignOut?: () => void | Promise<void>;
}

const navItems: Array<{ view: View; label: string; icon: typeof Home }> = [
  { view: "dashboard", label: "Inicio", icon: Home },
  { view: "registrar-gasto", label: "Registrar", icon: PlusCircle },
  { view: "movimientos", label: "Movimientos", icon: ClipboardList },
  { view: "conteo", label: "Caja", icon: Coins },
  { view: "pagos", label: "Pagos", icon: CalendarClock },
  { view: "reportes", label: "Reportes", icon: BarChart3 },
  { view: "categorias", label: "Categorías", icon: Tags },
  { view: "saldo-inicial", label: "Saldo inicial", icon: Settings },
];

const mobileNavItems: Array<{ view: View; label: string; icon: typeof Home }> = [
  { view: "dashboard", label: "Inicio", icon: Home },
  { view: "registrar-gasto", label: "Registrar", icon: PlusCircle },
  { view: "movimientos", label: "Movimientos", icon: ClipboardList },
  { view: "conteo", label: "Caja", icon: Coins },
];

const titles: Record<View, string> = {
  dashboard: "Caja Familiar",
  "registrar-ingreso": "Registrar ingreso",
  "registrar-gasto": "Registrar gasto",
  movimientos: "Movimientos",
  conteo: "Conteo de caja",
  pagos: "Pagos recurrentes",
  reportes: "Reportes",
  categorias: "Categorías",
  "saldo-inicial": "Saldo inicial",
};

export default function App({ currentMember, onSignOut }: AppProps = {}) {
  const [data, setData] = useState<AppData>(() => loadData());
  const [view, setView] = useState<View>("dashboard");
  const [moreOpen, setMoreOpen] = useState(false);
  const [movementDraft, setMovementDraft] = useState<MovementDraft | null>(null);
  const [pendingRecurringPaymentId, setPendingRecurringPaymentId] = useState<string | null>(null);
  const [focusedPaymentId, setFocusedPaymentId] = useState<string | null>(null);
  const [dataReady, setDataReady] = useState(false);
  const [dataLoadError, setDataLoadError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const expected = useMemo(() => expectedCash(data.movements, data.initialBalance), [data.movements, data.initialBalance]);

  useEffect(() => {
    let active = true;

    loadAppData()
      .then(({ data: loadedData, source }) => {
        if (!active) return;
        setData(loadedData);
        setSyncStatus(source === "fallback" ? "offline" : source === "local" ? "local" : "connected");
        if (source === "fallback") {
          window.alert("No se pudo cargar la información desde Supabase. Se conservará la copia local y no se sincronizarán datos automáticamente.");
        }
        setDataReady(true);
      })
      .catch((error) => {
        if (!active) return;
        setSyncStatus("offline");
        setDataLoadError(
          error instanceof HouseholdNotProvisionedError
            ? "Este hogar todavía no está provisionado en Supabase. Contacta al administrador para habilitarlo."
            : "No se pudo cargar la información financiera. Intenta nuevamente más tarde."
        );
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!dataReady) return;
    saveData(data);
  }, [data, dataReady]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function showToast(message: string) {
    setToast({ id: Date.now(), message });
  }

  function markRemoteSuccess() {
    if (isSupabaseConfigured) setSyncStatus("connected");
  }

  function markRemoteFailure() {
    if (isSupabaseConfigured) setSyncStatus("offline");
  }

  function navigate(nextView: string) {
    setFocusedPaymentId(null);
    if (nextView !== "registrar-gasto" && nextView !== "registrar-ingreso") {
      setMovementDraft(null);
      setPendingRecurringPaymentId(null);
    }
    setView(nextView as View);
    setMoreOpen(false);
  }

  function openPayment(id: string) {
    setMovementDraft(null);
    setPendingRecurringPaymentId(null);
    setFocusedPaymentId(id);
    setView("pagos");
    setMoreOpen(false);
  }

  function ensureDataReady() {
    if (dataReady) return true;
    window.alert("Los datos todavía se están cargando. Intenta nuevamente en unos segundos.");
    return false;
  }

  async function saveMovement(movement: MovementFormInput, id?: string): Promise<boolean> {
    if (!dataReady) {
      window.alert("Los datos todavía se están cargando. Intenta nuevamente en unos segundos.");
      return false;
    }

    const recurringPaymentId = pendingRecurringPaymentId;
    const existingMovement = id ? data.movements.find((item) => item.id === id) : undefined;
    const person = existingMovement?.person ?? currentMember?.displayName ?? movement.person ?? "";
    if (!person.trim()) {
      window.alert("No se pudo determinar quién registra el movimiento. Verifica el provisioning de tu cuenta.");
      return false;
    }

    const savedMovement: Movement = {
      ...movement,
      id: id ?? makeId("mov"),
      person,
      registeredByUserId: existingMovement?.registeredByUserId ?? currentMember?.userId ?? null,
      createdAt: id ? existingMovement?.createdAt ?? new Date().toISOString() : new Date().toISOString(),
    };

    try {
      if (id) await updateRemoteMovement(savedMovement);
      else await createMovement(savedMovement);
    } catch (error) {
      if (error instanceof MovementNotFoundError) {
        window.alert("Este movimiento ya no existe en la base de datos. Es posible que haya sido eliminado desde otro dispositivo. Actualiza la información antes de continuar.");
        return false;
      }
      setSyncStatus("offline");
      window.alert("No se pudo guardar el movimiento. No se realizó ningún cambio en tu caja. Intenta nuevamente.");
      return false;
    }

    markRemoteSuccess();

    if (recurringPaymentId) {
      const payment = data.recurringPayments.find((item) => item.id === recurringPaymentId);
      if (payment) {
        try {
          const savedPayment = await savePaidRecurringPayment(payment);
          markRemoteSuccess();
          setData((current) => ({
            ...current,
            movements: id
              ? current.movements.map((item) => (item.id === id ? savedMovement : item))
              : [savedMovement, ...current.movements],
            recurringPayments: current.recurringPayments.map((item) => (item.id === savedPayment.id ? savedPayment : item)),
          }));
          setMovementDraft(null);
          setPendingRecurringPaymentId(null);
          setView("pagos");
          showToast("Gasto guardado correctamente");
          return true;
        } catch (error) {
          if (!(error instanceof RecurringPaymentNotFoundError) && !(error instanceof RecurringPaymentConflictError)) markRemoteFailure();
          setData((current) => ({
            ...current,
            movements: id
              ? current.movements.map((item) => (item.id === id ? savedMovement : item))
              : [savedMovement, ...current.movements],
          }));
          setMovementDraft(null);
          setPendingRecurringPaymentId(null);
          setView("pagos");
          window.alert("El gasto se registró correctamente, pero no se pudo marcar el pago recurrente como pagado. No vuelvas a registrar el gasto. Intenta marcar el pago como pagado sin crear otro egreso.");
          return true;
        }
      }

      setData((current) => ({
        ...current,
        movements: id
          ? current.movements.map((item) => (item.id === id ? savedMovement : item))
          : [savedMovement, ...current.movements],
      }));
      setMovementDraft(null);
      setPendingRecurringPaymentId(null);
      setView("pagos");
      window.alert("El gasto se registró correctamente, pero no se encontró el pago recurrente para marcarlo como pagado. No vuelvas a registrar el gasto.");
      return true;
    }

    setData((current) => ({
      ...current,
      movements: id
        ? current.movements.map((item) => (item.id === id ? savedMovement : item))
        : [savedMovement, ...current.movements],
    }));
    setMovementDraft(null);
    setPendingRecurringPaymentId(null);
    setView("movimientos");
    showToast(movement.type === "egreso" ? "Gasto guardado correctamente" : "Ingreso guardado correctamente");
    return true;
  }

  async function deleteMovement(id: string): Promise<boolean> {
    if (!dataReady) {
      window.alert("Los datos todavía se están cargando. Intenta nuevamente en unos segundos.");
      return false;
    }

    if (!window.confirm("Seguro que deseas eliminar este movimiento?")) return false;

    try {
      await deleteRemoteMovement(id);
    } catch {
      setSyncStatus("offline");
      window.alert("No se pudo eliminar el movimiento. No se realizó ningún cambio en tu caja. Intenta nuevamente.");
      return false;
    }

    markRemoteSuccess();
    setData((current) => ({ ...current, movements: current.movements.filter((movement) => movement.id !== id) }));
    showToast("Movimiento eliminado");
    return true;
  }

  async function saveCashCount(cashCount: Omit<CashCount, "id">): Promise<boolean> {
    if (!ensureDataReady()) return false;

    const savedCount: CashCount = { ...cashCount, id: makeId("count") };
    try {
      const remoteCount = await createCashCount(savedCount);
      markRemoteSuccess();
      setData((current) => ({ ...current, cashCounts: [remoteCount, ...current.cashCounts] }));
      showToast("Conteo guardado correctamente");
      return true;
    } catch {
      markRemoteFailure();
      window.alert("No se pudo guardar el conteo. No se realizó ningún cambio en tu caja. Intenta nuevamente.");
      return false;
    }
  }

  async function savePayment(payment: Omit<RecurringPayment, "id">, id?: string): Promise<boolean> {
    if (!ensureDataReady()) return false;

    const savedPayment: RecurringPayment = { ...payment, id: id ?? makeId("pay") };
    try {
      const remotePayment = id ? await updateRecurringPaymentDetails(savedPayment) : await createRecurringPayment(savedPayment);
      markRemoteSuccess();
      setData((current) => ({
        ...current,
        recurringPayments: id
          ? current.recurringPayments.map((item) => (item.id === remotePayment.id ? remotePayment : item))
          : [remotePayment, ...current.recurringPayments],
      }));
      return true;
    } catch (error) {
      if (error instanceof RecurringPaymentNotFoundError) {
        window.alert("Este pago ya no existe o cambió desde otro dispositivo. Actualiza la información antes de continuar.");
      } else {
        markRemoteFailure();
        window.alert("No se pudo guardar el pago recurrente. Intenta nuevamente.");
      }
      return false;
    }
  }

  async function markPaymentPaid(payment: RecurringPayment, actualAmount: number | null, shouldCreateExpense: boolean) {
    if (!ensureDataReady()) return;

    const paymentAmount = actualAmount ?? payment.amount;
    if (shouldCreateExpense) {
      if (paymentAmount === null || !Number.isFinite(paymentAmount) || paymentAmount <= 0) {
        window.alert("Ingresa un monto válido para registrar el pago.");
        return;
      }

      setMovementDraft({
        type: "egreso",
        date: localDateString(),
        amount: paymentAmount,
        description: payment.name,
        category: payment.category,
      });
      setPendingRecurringPaymentId(payment.id);
      setView("registrar-gasto");
      return;
    }

    try {
      const savedPayment = await savePaidRecurringPayment(payment);
      markRemoteSuccess();
      setData((current) => ({ ...current, recurringPayments: current.recurringPayments.map((item) => (item.id === savedPayment.id ? savedPayment : item)) }));
      showToast("Pago marcado como pagado");
    } catch (error) {
      if (error instanceof RecurringPaymentNotFoundError || error instanceof RecurringPaymentConflictError) {
        window.alert("Este pago ya no existe o cambió desde otro dispositivo. Actualiza la información antes de continuar.");
      } else {
        markRemoteFailure();
        window.alert("No se pudo marcar el pago como pagado. No se realizó ningún cambio en el pago. Intenta nuevamente.");
      }
    }
  }

  async function setPaymentActive(id: string, isActive: boolean): Promise<boolean> {
    if (!ensureDataReady()) return false;

    const payment = data.recurringPayments.find((item) => item.id === id);
    if (!payment) return false;

    try {
      const savedPayment = await setRecurringPaymentActive(payment, isActive);
      markRemoteSuccess();
      setData((current) => ({ ...current, recurringPayments: current.recurringPayments.map((item) => (item.id === savedPayment.id ? savedPayment : item)) }));
      return true;
    } catch (error) {
      if (error instanceof RecurringPaymentNotFoundError) {
        window.alert("Este pago ya no existe o cambió desde otro dispositivo. Actualiza la información antes de continuar.");
      } else {
        markRemoteFailure();
        window.alert(`${isActive ? "No se pudo reactivar" : "No se pudo archivar"} el pago recurrente. Intenta nuevamente.`);
      }
      return false;
    }
  }

  async function deactivatePayment(id: string) {
    return setPaymentActive(id, false);
  }

  async function reactivatePayment(id: string) {
    return setPaymentActive(id, true);
  }

  async function saveCategory(category: Omit<Category, "id" | "created_at">, id?: string): Promise<Category | null> {
    if (!ensureDataReady()) return null;

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

    try {
      const remoteCategory = id ? await updateCategoryDetails(savedCategory) : await createCategory(savedCategory);
      markRemoteSuccess();
      setData((current) => ({
        ...current,
        categories: id
          ? current.categories.map((item) => (item.id === remoteCategory.id ? remoteCategory : item))
          : [remoteCategory, ...current.categories],
      }));
      return remoteCategory;
    } catch (error) {
      if (error instanceof CategoryNotFoundError) {
        window.alert("Esta categoría ya no existe. Es posible que haya sido eliminada desde otro dispositivo.");
      } else {
        markRemoteFailure();
        window.alert("No se pudo guardar la categoría. Intenta nuevamente.");
      }
      return null;
    }
  }

  async function deleteCategory(id: string): Promise<boolean> {
    if (!ensureDataReady()) return false;

    const category = data.categories.find((item) => item.id === id);
    if (!category) return false;
    const hasMovements = data.movements.some((movement) => normalizeName(movement.category) === normalizeName(category.name));
    if (hasMovements) {
      window.alert("No puedes eliminar esta categoria porque ya tiene movimientos registrados. Puedes desactivarla.");
      return false;
    }
    if (!window.confirm("Seguro que deseas eliminar esta categoria?")) return false;

    try {
      await deleteRemoteCategory(id);
      markRemoteSuccess();
      setData((current) => ({ ...current, categories: current.categories.filter((item) => item.id !== id) }));
      return true;
    } catch {
      markRemoteFailure();
      window.alert("No se pudo eliminar la categoría. No se realizó ningún cambio. Intenta nuevamente.");
      return false;
    }
  }

  async function toggleCategory(id: string): Promise<boolean> {
    if (!ensureDataReady()) return false;

    const category = data.categories.find((item) => item.id === id);
    if (!category) return false;

    try {
      const remoteCategory = await setCategoryActive(category, !category.is_active);
      markRemoteSuccess();
      setData((current) => ({ ...current, categories: current.categories.map((item) => (item.id === remoteCategory.id ? remoteCategory : item)) }));
      return true;
    } catch (error) {
      if (error instanceof CategoryNotFoundError) {
        window.alert("Esta categoría ya no existe. Es posible que haya sido eliminada desde otro dispositivo.");
      } else {
        markRemoteFailure();
        window.alert("No se pudo cambiar el estado de la categoría. Intenta nuevamente.");
      }
      return false;
    }
  }

  async function saveInitialBalance(value: number): Promise<boolean> {
    if (!ensureDataReady()) return false;

    if (!Number.isFinite(value) || value < 0) {
      window.alert("Ingresa un saldo inicial válido.");
      return false;
    }

    try {
      const savedValue = await updateInitialBalance(value);
      markRemoteSuccess();
      setData((current) => ({ ...current, initialBalance: savedValue }));
      showToast("Saldo inicial actualizado");
      return true;
    } catch {
      markRemoteFailure();
      window.alert("No se pudo guardar el saldo inicial. No se realizó ningún cambio. Intenta nuevamente.");
      return false;
    }
  }

  function markPaidForCurrentMonth(payment: RecurringPayment): RecurringPayment {
    const paidDate = localDateString();
    const [paidYear, paidMonth] = paidDate.split("-").map(Number);
    const paidInstallments =
      payment.recurrence_type === "fixed" && !isPaymentPaidThisMonth(payment) ? payment.paid_installments + 1 : payment.paid_installments;
    const updated: RecurringPayment = {
      ...payment,
      status: "pagado",
      paidAt: new Date().toISOString(),
      paid_installments: paidInstallments,
      last_paid_month: paidMonth,
      last_paid_year: paidYear,
    };

    const isCompleted = updated.recurrence_type === "one_time" || isPaymentFinished(updated);
    return isCompleted ? { ...updated, is_active: false } : updated;
  }

  async function savePaidRecurringPayment(payment: RecurringPayment): Promise<RecurringPayment> {
    const currentPayment = (await getRecurringPayment(payment.id)) ?? payment;
    return updateRecurringPaymentPaymentState(markPaidForCurrentMonth(currentPayment), currentPayment);
  }

  if (dataLoadError) return <DataLoadErrorScreen message={dataLoadError} onSignOut={onSignOut} />;

  const initialType: MovementType = view === "registrar-ingreso" ? "ingreso" : "egreso";

  return (
    <div className="min-h-screen bg-slate-100">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col overflow-hidden bg-white p-4 shadow-xl lg:flex">
        <div className="mb-6 flex shrink-0 items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-3 text-blue-700">
              <PiggyBank className="h-8 w-8" />
            </div>
            <div>
              <p className="text-xl font-bold text-slate-900">Caja Familiar</p>
              <p className="text-sm text-slate-500">Finanzas en soles</p>
            </div>
          </div>
        </div>

        <nav className="min-h-0 flex-1 space-y-2 overflow-x-hidden overflow-y-auto pr-1">
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

        <div className="mt-6 shrink-0">
          <div className="rounded-lg bg-blue-50 p-4 text-blue-900">
            <p className="font-semibold">Saldo esperado</p>
            <p className="text-2xl font-bold">{formatMoney(expected)}</p>
          </div>
          {onSignOut && (
            <button type="button" onClick={() => void onSignOut()} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 font-bold text-slate-700 hover:bg-slate-50">
              <LogOut className="h-5 w-5" />
              Cerrar sesión
            </button>
          )}
        </div>
      </aside>

      <main className="pb-24 lg:pb-0 lg:pl-72">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100/95 px-4 py-4 backdrop-blur lg:px-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">{titles[view]}</h1>
              <p className="text-slate-600">Las finanzas de la familia en un solo lugar.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {currentMember && <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-bold text-blue-800">Sesión: {currentMember.displayName}</span>}
              <SyncStatus status={syncStatus} />
            </div>
          </div>
        </header>

        <div className="p-4 lg:p-8">
          {view === "dashboard" && (
            <Dashboard movements={data.movements} cashCounts={data.cashCounts} recurringPayments={data.recurringPayments} initialBalance={data.initialBalance} onNavigate={navigate} onOpenPayment={openPayment} />
          )}
          {(view === "registrar-ingreso" || view === "registrar-gasto") && (
            <MovementForm
              key={view}
              initialType={initialType}
              draft={movementDraft}
              currentMember={currentMember}
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
              currentMember={currentMember}
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
              onSave={saveCashCount}
            />
          )}
          {view === "pagos" && (
            <RecurringPayments
              payments={data.recurringPayments}
              categories={data.categories}
              focusedPaymentId={focusedPaymentId}
              onSave={savePayment}
              onMarkPaid={markPaymentPaid}
              onDeactivate={deactivatePayment}
              onReactivate={reactivatePayment}
            />
          )}
          {view === "reportes" && <Reports movements={data.movements} categories={data.categories} initialBalance={data.initialBalance} />}
          {view === "categorias" && <CategoriesManager categories={data.categories} onSave={saveCategory} onDelete={deleteCategory} onToggle={toggleCategory} />}
          {view === "saldo-inicial" && <InitialBalance initialBalance={data.initialBalance} onSave={saveInitialBalance} />}
        </div>
      </main>

      <nav className="mobile-nav fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white/95 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden" aria-label="Navegación principal móvil">
        {mobileNavItems.map((item) => (
          <button
            key={item.view}
            type="button"
            onClick={() => navigate(item.view)}
            className={`flex min-h-16 flex-1 flex-col items-center justify-center gap-1 px-1 text-xs font-bold transition sm:text-sm ${
              view === item.view ? "text-blue-700" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <item.icon className="h-6 w-6" />
            <span>{item.label}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={`flex min-h-16 flex-1 flex-col items-center justify-center gap-1 px-1 text-xs font-bold transition sm:text-sm ${
            moreOpen || ["pagos", "reportes", "categorias", "saldo-inicial"].includes(view) ? "text-blue-700" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          <MoreHorizontal className="h-6 w-6" />
          <span>Más</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Más opciones">
          <button type="button" className="absolute inset-0 bg-slate-950/40" onClick={() => setMoreOpen(false)} aria-label="Cerrar Más" />
          <section className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Menú</p>
                <h2 className="text-2xl font-bold text-slate-900">Más opciones</h2>
              </div>
              <button type="button" onClick={() => setMoreOpen(false)} className="rounded-full bg-slate-100 p-3 text-slate-700" aria-label="Cerrar Más">
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => navigate("pagos")} className="min-h-14 rounded-2xl bg-orange-50 px-4 text-left text-base font-bold text-orange-900">
                Pagos recurrentes
              </button>
              <button type="button" onClick={() => navigate("reportes")} className="min-h-14 rounded-2xl bg-indigo-50 px-4 text-left text-base font-bold text-indigo-900">
                Reportes
              </button>
              <button type="button" onClick={() => navigate("categorias")} className="min-h-14 rounded-2xl bg-emerald-50 px-4 text-left text-base font-bold text-emerald-900">
                Categorías
              </button>
              <div className="rounded-2xl bg-slate-50 p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Configuración</p>
                <button type="button" onClick={() => navigate("saldo-inicial")} className="min-h-10 w-full rounded-xl bg-white px-3 text-left text-sm font-bold text-slate-800 shadow-sm">
                  Saldo inicial
                </button>
              </div>
              {onSignOut && (
                <button type="button" onClick={() => void onSignOut()} className="col-span-2 flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-slate-300 px-4 text-base font-bold text-slate-700 hover:bg-slate-50">
                  <LogOut className="h-5 w-5" />
                  Cerrar sesión
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {toast && <Toast key={toast.id} message={toast.message} />}
    </div>
  );
}

function SyncStatus({ status }: { status: SyncStatus }) {
  const config = {
    loading: { label: "Conectando...", className: "bg-amber-400", textClassName: "text-slate-600" },
    connected: { label: "Conectado", className: "bg-emerald-500", textClassName: "text-emerald-700" },
    local: { label: "Trabajando con copia local", className: "bg-slate-400", textClassName: "text-slate-600" },
    offline: { label: "Sin conexión", className: "bg-red-500", textClassName: "text-red-700" },
  }[status];

  return (
    <div className={`flex items-center gap-2 text-sm font-bold ${config.textClassName}`} role="status" aria-live="polite">
      <span className={`h-2.5 w-2.5 rounded-full ${config.className}`} aria-hidden="true" />
      {config.label}
    </div>
  );
}

function DataLoadErrorScreen({ message, onSignOut }: { message: string; onSignOut?: () => void | Promise<void> }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <section className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-xl sm:p-8">
        <h1 className="text-3xl font-black text-slate-900">Caja Familiar</h1>
        <p className="mt-4 text-lg text-slate-600" role="alert">{message}</p>
        {onSignOut && (
          <button type="button" onClick={() => void onSignOut()} className="mt-6 min-h-14 w-full rounded-2xl border border-slate-300 px-5 py-3 text-lg font-bold text-slate-700 hover:bg-slate-50">
            Cerrar sesión
          </button>
        )}
      </section>
    </main>
  );
}

function normalizeName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
