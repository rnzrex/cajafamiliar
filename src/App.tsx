import {
  BarChart3,
  CalendarClock,
  ClipboardList,
  Coins,
  Home,
  Landmark,
  LogOut,
  MoreHorizontal,
  PiggyBank,
  PlusCircle,
  Tags,
  Wallet,
  X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AccountsManager } from "./components/AccountsManager";
import { CashCounter } from "./components/CashCounter";
import { CategoriesManager } from "./components/CategoriesManager";
import { Dashboard } from "./components/Dashboard";
import { InitialBalance } from "./components/InitialBalance";
import { MovementForm } from "./components/MovementForm";
import { MovementsList } from "./components/MovementsList";
import { RecurringPayments } from "./components/RecurringPayments";
import { DebtsManager } from "./components/DebtsManager";
import { DebtForm } from "./components/DebtForm";
import { DebtOperationForm } from "./components/DebtOperationForm";
import { DebtDetailModal } from "./components/DebtDetailModal";
import { Toast } from "./components/Toast";
import { translateDebtError } from "./utils/debtViewModel";
import { AppData, CashCount, Category, Debt, FinancialAccount, HouseholdMember, Movement, MovementDraft, MovementFormInput, MovementType, RecurringPayment } from "./types";
import { expectedCash, formatMoney, isPaymentFinished, isPaymentPaidThisMonth, paymentAlertSummary } from "./utils/calculations";
import { currentDebtPrincipal } from "./utils/debtCalculations";
import { getActiveCashAccount, isDefaultCashAccount } from "./utils/accountHelpers";
import {
  CategoryNotFoundError,
  createCashCount,
  createCategory,
  createFinancialAccount,
  createMovement,
  createMovementIdempotent,
  createRecurringPayment,
  DebtMovementProtectedError,
  completeRecurringPayment,
  deleteCategory as deleteRemoteCategory,
  deleteMovement as deleteRemoteMovement,
  FinancialAccountMethodMismatchError,
  FinancialAccountNotAvailableError,
  FinancialAccountNotFoundError,
  FinancialAccountProtectedError,
  HouseholdMemberNotProvisionedError,
  HouseholdNotProvisionedError,
  InvalidMovementError,
  loadAppData,
  MovementContextImmutableError,
  MovementNotFoundError,
  RecurringPaymentAlreadyPaidError,
  RecurringPaymentAuthenticationError,
  RecurringPaymentInactiveError,
  RecurringPaymentNotFoundError,
  TrustedOfflineSnapshotUnavailableError,
  setCategoryActive,
  setFinancialAccountActive,
  setRecurringPaymentActive,
  updateCategoryDetails,
  updateFinancialAccountDetails,
  updateInitialBalance,
  updateMovement as updateRemoteMovement,
  updateRecurringPaymentDetails,
} from "./services/dataRepository";
import { enqueueCreateMovement, listPendingCreateMovements, removeOfflineOperation, type OfflineCreateMovementOperation } from "./services/offlineOutbox";
import { isSupabaseConfigured } from "./services/supabaseClient";
import { makeId, makeUuid, loadData, saveData } from "./utils/storage";
import { localDateString } from "./utils/date";

type View = "dashboard" | "registrar-ingreso" | "registrar-gasto" | "movimientos" | "conteo" | "pagos" | "deudas" | "registrar-deuda" | "operacion-deuda" | "reportes" | "categorias" | "cuentas" | "saldo-inicial";
type SyncStatus = "loading" | "connected" | "local" | "offline" | "problem" | "syncing";
type PendingSyncState = "idle" | "flushing" | "problem";
type RemoteContactStatus = "unknown" | "success" | "failure";

const Reports = lazy(() =>
  import("./components/Reports").then(({ Reports: ReportsComponent }) => ({
    default: ReportsComponent,
  }))
);

interface AppProps {
  currentMember?: HouseholdMember;
  onSignOut?: () => void | Promise<void>;
  remoteStatus?: "connected" | "problem" | null;
}

const navItems: Array<{ view: View; label: string; icon: typeof Home }> = [
  { view: "dashboard", label: "Inicio", icon: Home },
  { view: "registrar-gasto", label: "Registrar", icon: PlusCircle },
  { view: "movimientos", label: "Movimientos", icon: ClipboardList },
  { view: "conteo", label: "Caja", icon: Coins },
  { view: "pagos", label: "Pagos", icon: CalendarClock },
  { view: "deudas", label: "Deudas", icon: Landmark },
  { view: "reportes", label: "Reportes", icon: BarChart3 },
  { view: "categorias", label: "Categorías", icon: Tags },
  { view: "cuentas", label: "Cuentas", icon: Wallet },
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
  deudas: "Deudas",
  "registrar-deuda": "Registrar deuda",
  "operacion-deuda": "Operación de deuda",
  reportes: "Reportes",
  categorias: "Categorías",
  cuentas: "Cuentas",
  "saldo-inicial": "Saldo inicial",
};

const EMPTY_APP_DATA: AppData = {
  movements: [],
  cashCounts: [],
  recurringPayments: [],
  categories: [],
  initialBalance: 0,
  financialAccounts: [],
  debts: [],
  debtEvents: [],
  debtScheduleVersions: [],
  debtInstallments: [],
  debtEventInstallmentAllocations: [],
  debtCollaterals: [],
};

const OFFLINE_WRITE_MESSAGE = "Estás sin conexión. Puedes consultar tu información, pero para registrar o modificar datos necesitas conectarte a internet.";

export default function App({ currentMember, onSignOut, remoteStatus }: AppProps = {}) {
  const [data, setData] = useState<AppData>(() => (isSupabaseConfigured ? EMPTY_APP_DATA : loadData()));
  const [view, setView] = useState<View>("dashboard");
  const [moreOpen, setMoreOpen] = useState(false);
  const [movementDraft, setMovementDraft] = useState<MovementDraft | null>(null);
  const [pendingRecurringPaymentId, setPendingRecurringPaymentId] = useState<string | null>(null);
  const [pendingRecurringMovementId, setPendingRecurringMovementId] = useState<string | null>(null);
  const [focusedPaymentId, setFocusedPaymentId] = useState<string | null>(null);
  const [selectedDebtId, setSelectedDebtId] = useState<string | null>(null);
  const selectedDebt = useMemo(() => data.debts.find((d) => d.id === selectedDebtId) ?? null, [data.debts, selectedDebtId]);
  const [debtOperationState, setDebtOperationState] = useState<{
    type: "payment" | "prepayment" | "payoff" | "reversal";
    targetEventId?: string;
  } | null>(null);
  const [dataReady, setDataReady] = useState(!isSupabaseConfigured);
  const [dataLoadError, setDataLoadError] = useState<string | null>(null);
  const [isBrowserOnline, setIsBrowserOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [lastRemoteContact, setLastRemoteContact] = useState<RemoteContactStatus>("unknown");
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const [pendingMovementIds, setPendingMovementIds] = useState<Set<string>>(() => new Set());
  const pendingMovementIdsRef = useRef<Set<string>>(new Set());
  const [pendingSyncState, setPendingSyncState] = useState<PendingSyncState>("idle");
  const [syncAttempt, setSyncAttempt] = useState(0);
  const flushInFlightRef = useRef(false);
  const appMountedRef = useRef(true);

  const refreshAppData = async () => {
    if (currentMember) {
      try {
        const res = await loadAppData(currentMember);
        setData(res.data);
      } catch (err) {
        console.error("Error refreshing app data:", err);
        throw err;
      }
    }
  };
  const canWriteDebt = isSupabaseConfigured && isBrowserOnline && Boolean(currentMember);
  const expected = useMemo(() => {
    const cashAccount = getActiveCashAccount(data.financialAccounts);
    return expectedCash(data.movements, cashAccount ? cashAccount.openingBalance : data.initialBalance, cashAccount?.id ?? null);
  }, [data.financialAccounts, data.movements, data.initialBalance]);
  const urgentPaymentSummary = useMemo(() => paymentAlertSummary(data.recurringPayments), [data.recurringPayments]);
  const urgentPaymentLabel = urgentPaymentSummary.total === 1 ? "1 pago requiere atención" : `${urgentPaymentSummary.total} pagos requieren atención`;
  const pendingMovementCount = pendingMovementIds.size;
  const syncStatus: SyncStatus = !isSupabaseConfigured
    ? "local"
    : pendingSyncState === "flushing" && isBrowserOnline
      ? "syncing"
      : !isBrowserOnline
        ? "offline"
        : pendingSyncState === "problem"
          ? "problem"
          : lastRemoteContact === "success"
            ? "connected"
            : lastRemoteContact === "failure"
              ? "problem"
              : "loading";

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    function handleOnline() {
      setIsBrowserOnline(true);
      setLastRemoteContact("unknown");
    }

    function handleOffline() {
      setIsBrowserOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    appMountedRef.current = true;
    return () => {
      appMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !remoteStatus) return;
    setLastRemoteContact(remoteStatus === "connected" ? "success" : "failure");
  }, [remoteStatus]);

  useEffect(() => {
    let active = true;

    async function load() {
      if (isSupabaseConfigured) {
        updatePendingMovementIds([]);
        setPendingSyncState("idle");
        setDataReady(false);
        setDataLoadError(null);
      }

      try {
        const result = await loadAppData(currentMember);
        let pendingOperations: OfflineCreateMovementOperation[] = [];
        if (isSupabaseConfigured && currentMember) {
          try {
            pendingOperations = await listPendingCreateMovements(currentMember);
          } catch (error) {
            if (!active) return;
            if (!isBrowserOnline) throw error;
            setPendingSyncState("problem");
          }
        }
        if (!active) return;

        updatePendingMovementIds(pendingOperations.map((operation) => operation.movement.id));
        setData(mergePendingMovements(result.data, pendingOperations));
        setLastRemoteContact(result.source === "remote" ? "success" : result.source === "fallback" ? "failure" : "unknown");
        setDataReady(true);
      } catch (error) {
        if (!active) return;
        setLastRemoteContact("failure");
        setDataLoadError(
          error instanceof TrustedOfflineSnapshotUnavailableError
            ? "Este dispositivo todavía no tiene una copia verificada para usar Caja Familiar sin conexión. Conéctate a internet al menos una vez."
            : error instanceof HouseholdNotProvisionedError
              ? "Este hogar todavía no está provisionado en Supabase. Contacta al administrador para habilitarlo."
              : error instanceof Error && error.message.includes("IndexedDB")
                ? "No se pudieron cargar los movimientos pendientes de este dispositivo. Intenta nuevamente."
                : "Problema de conexión. No se pudo cargar la información financiera. Intenta nuevamente más tarde."
        );
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [currentMember?.householdId, currentMember?.userId]);

  useEffect(() => {
    if (!dataReady || typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    if (params.get("view") !== "pagos") return;

    setView("pagos");
    setFocusedPaymentId(params.get("payment")?.trim() || null);
    window.history.replaceState(window.history.state, document.title, `${window.location.pathname}${window.location.hash}`);
  }, [dataReady]);

  useEffect(() => {
    if (!dataReady) return;
    if (!isSupabaseConfigured) {
      saveData(data);
      return;
    }
    if (!isBrowserOnline || pendingMovementIdsRef.current.size > 0) return;
    saveData(data);
  }, [data, dataReady, isBrowserOnline, pendingMovementIds]);

  useEffect(() => {
    if (!isSupabaseConfigured || !isBrowserOnline || !dataReady || !currentMember || remoteStatus !== "connected" || flushInFlightRef.current) return;

    const member = currentMember;
    let active = true;
    flushInFlightRef.current = true;

    async function flushPendingMovements() {
      try {
        let queued = await listPendingCreateMovements(member);
        if (!active) return;

        if (queued.length === 0) {
          if (pendingMovementIdsRef.current.size === 0) {
            setPendingSyncState("idle");
            return;
          }

          let remoteResult;
          try {
            remoteResult = await loadAppData(member);
          } catch {
            if (active) {
              setLastRemoteContact("failure");
              setPendingSyncState("problem");
            }
            return;
          }

          if (!active) return;
          if (remoteResult.source !== "remote") {
            setLastRemoteContact("failure");
            setPendingSyncState("problem");
            return;
          }

          setData(remoteResult.data);
          updatePendingMovementIds([]);
          setLastRemoteContact("success");
          setPendingSyncState("idle");
          return;
        }

        updatePendingMovementIds(queued.map((item) => item.movement.id));
        setData((current) => mergePendingMovements(current, queued));
        setPendingSyncState("flushing");

        while (queued.length > 0) {
          if (!active) return;
          const operation = queued[0];
          const remoteMovement: Movement = {
            ...operation.movement,
            person: member.displayName,
            registeredByUserId: member.userId,
          };

          try {
            await createMovementIdempotent(remoteMovement);
          } catch {
            if (active) {
              setLastRemoteContact("failure");
              setPendingSyncState("problem");
            }
            return;
          }

          if (!active) return;

          let remoteResult;
          try {
            remoteResult = await loadAppData(member);
          } catch {
            if (active) {
              setLastRemoteContact("failure");
              setPendingSyncState("problem");
            }
            return;
          }

          if (!active) return;
          if (remoteResult.source !== "remote" || !remoteResult.data.movements.some((movement) => movement.id === operation.movement.id)) {
            setLastRemoteContact("failure");
            setPendingSyncState("problem");
            return;
          }

          try {
            await removeOfflineOperation(operation.operationId);
          } catch {
            if (active) setPendingSyncState("problem");
            return;
          }

          if (!active) return;

          try {
            queued = await listPendingCreateMovements(member);
          } catch {
            setPendingSyncState("problem");
            return;
          }

          updatePendingMovementIds(queued.map((item) => item.movement.id));
          setData(mergePendingMovements(remoteResult.data, queued));
          setLastRemoteContact("success");
        }

        setPendingSyncState("idle");
      } catch {
        if (active) {
          setLastRemoteContact("failure");
          setPendingSyncState("problem");
        }
      } finally {
        flushInFlightRef.current = false;
        if (!active && appMountedRef.current && isBrowserOnline && dataReady && remoteStatus === "connected") {
          setSyncAttempt((attempt) => attempt + 1);
        }
      }
    }

    void flushPendingMovements();
    return () => {
      active = false;
    };
  }, [currentMember?.householdId, currentMember?.userId, dataReady, isBrowserOnline, remoteStatus, syncAttempt]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function showToast(message: string) {
    setToast({ id: Date.now(), message });
  }

  function updatePendingMovementIds(ids: Iterable<string>) {
    const next = new Set(ids);
    pendingMovementIdsRef.current = next;
    setPendingMovementIds(next);
  }

  function markRemoteSuccess() {
    if (isSupabaseConfigured) setLastRemoteContact("success");
  }

  function markRemoteFailure() {
    if (isSupabaseConfigured) setLastRemoteContact("failure");
  }

  function navigate(nextView: string) {
    setFocusedPaymentId(null);
    const isMovementView = nextView === "registrar-gasto" || nextView === "registrar-ingreso";
    if (!isMovementView || pendingRecurringPaymentId !== null || pendingRecurringMovementId !== null) {
      setMovementDraft(null);
      setPendingRecurringPaymentId(null);
      setPendingRecurringMovementId(null);
    }
    setView(nextView as View);
    setMoreOpen(false);
  }

  function openPayment(id: string) {
    setMovementDraft(null);
    setPendingRecurringPaymentId(null);
    setPendingRecurringMovementId(null);
    setFocusedPaymentId(id);
    setView("pagos");
    setMoreOpen(false);
  }

  function ensureDataReady() {
    if (dataReady) return true;
    window.alert("Los datos todavía se están cargando. Intenta nuevamente en unos segundos.");
    return false;
  }

  function ensureOnlineWriteAllowed() {
    if (!isSupabaseConfigured || typeof navigator === "undefined" || navigator.onLine) return true;
    window.alert(OFFLINE_WRITE_MESSAGE);
    return false;
  }

  async function saveMovement(movement: MovementFormInput, id?: string): Promise<boolean> {
    const isOfflineManualCreate =
      isSupabaseConfigured &&
      !isBrowserOnline &&
      id === undefined &&
      pendingRecurringPaymentId === null &&
      pendingRecurringMovementId === null &&
      dataReady &&
      Boolean(currentMember?.householdId && currentMember?.userId && currentMember.displayName.trim());

    if (!isOfflineManualCreate && !ensureOnlineWriteAllowed()) return false;
    if (!dataReady) {
      window.alert("Los datos todavía se están cargando. Intenta nuevamente en unos segundos.");
      return false;
    }

    if (id && pendingMovementIdsRef.current.has(id)) {
      window.alert("Este movimiento está pendiente de sincronización y no puede modificarse todavía.");
      return false;
    }

    const recurringPaymentId = pendingRecurringPaymentId;
    const recurringPayment = recurringPaymentId ? data.recurringPayments.find((item) => item.id === recurringPaymentId) : undefined;
    if (recurringPaymentId && !recurringPayment) {
      window.alert("Este pago ya no existe o cambió desde otro dispositivo. No se creó ningún gasto.");
      return false;
    }

    const movementId = recurringPayment ? pendingRecurringMovementId : id ?? makeId("mov");
    if (!movementId) {
      window.alert("No se pudo preparar el identificador del gasto. Vuelve a intentar desde Pagos.");
      return false;
    }

    const existingMovement = id ? data.movements.find((item) => item.id === id) : undefined;
    if (id && existingMovement?.movementContext === "debt_service") {
      window.alert("Los pagos de deuda se corrigen desde el dominio de deudas y no pueden editarse aquí.");
      return false;
    }
    const person = existingMovement?.person ?? currentMember?.displayName ?? movement.person ?? "";
    if (!person.trim() && !(recurringPayment && isSupabaseConfigured)) {
      window.alert("No se pudo determinar quién registra el movimiento. Verifica el provisioning de tu cuenta.");
      return false;
    }

    const savedMovement: Movement = {
      ...movement,
      id: movementId,
      person,
      accountId: movement.accountId ?? null,
      movementContext: existingMovement?.movementContext ?? "standard",
      registeredByUserId: existingMovement?.registeredByUserId ?? currentMember?.userId ?? null,
      createdAt: id ? existingMovement?.createdAt ?? new Date().toISOString() : new Date().toISOString(),
    };

    if (isOfflineManualCreate && currentMember) {
      try {
        await enqueueCreateMovement(currentMember, savedMovement);
      } catch {
        window.alert("No se pudo guardar el movimiento en este dispositivo. Intenta nuevamente.");
        return false;
      }

      updatePendingMovementIds([...pendingMovementIdsRef.current, savedMovement.id]);
      setPendingSyncState("idle");
      setData((current) => ({ ...current, movements: [savedMovement, ...current.movements] }));
      setMovementDraft(null);
      setPendingRecurringPaymentId(null);
      setPendingRecurringMovementId(null);
      setView("movimientos");
      showToast("Movimiento guardado en este dispositivo. Se sincronizará al recuperar conexión.");
      return true;
    }

    if (recurringPayment) {
      if (isSupabaseConfigured) {
        try {
          const result = await completeRecurringPayment(recurringPayment, savedMovement);
          if (!result?.movement) throw new Error("La RPC no devolvió el movimiento creado.");

          markRemoteSuccess();
          setData((current) => ({
            ...current,
            movements: current.movements.some((item) => item.id === result.movement!.id)
              ? current.movements.map((item) => (item.id === result.movement!.id ? result.movement! : item))
              : [result.movement!, ...current.movements],
            recurringPayments: current.recurringPayments.map((item) => (item.id === result.payment.id ? result.payment : item)),
          }));
          setMovementDraft(null);
          setPendingRecurringPaymentId(null);
          setPendingRecurringMovementId(null);
          setView("pagos");
          showToast("Gasto guardado correctamente");
          return true;
        } catch (error) {
          if (error instanceof RecurringPaymentAlreadyPaidError) {
            window.alert("Este pago ya fue marcado como pagado. No se creó un segundo gasto.");
          } else if (error instanceof RecurringPaymentNotFoundError) {
            window.alert("Este pago ya no existe o cambió desde otro dispositivo. No se creó ningún gasto.");
          } else if (error instanceof RecurringPaymentInactiveError) {
            window.alert("Este pago está inactivo. No se creó ningún gasto.");
          } else if (error instanceof HouseholdMemberNotProvisionedError) {
            window.alert("No se pudo verificar tu miembro del hogar. No se creó ningún gasto.");
          } else if (error instanceof InvalidMovementError) {
            window.alert("No se pudo validar el gasto. No se realizó ningún cambio. Intenta nuevamente.");
          } else if (error instanceof FinancialAccountNotAvailableError) {
            window.alert("La cuenta seleccionada ya no está disponible. Elige otra cuenta en el movimiento.");
          } else if (error instanceof FinancialAccountMethodMismatchError) {
            window.alert("El método de pago no corresponde al tipo de la cuenta seleccionada. Elige otra cuenta.");
          } else if (error instanceof RecurringPaymentAuthenticationError) {
            window.alert("Tu sesión ya no es válida. Inicia sesión nuevamente.");
          } else {
            markRemoteFailure();
            window.alert("No se pudo registrar el pago y el gasto. No se realizó ningún cambio. Intenta nuevamente.");
          }
          return false;
        }
      }

      const savedPayment = markPaidForCurrentMonth(recurringPayment);
      setData((current) => ({
        ...current,
        movements: [savedMovement, ...current.movements],
        recurringPayments: current.recurringPayments.map((item) => (item.id === savedPayment.id ? savedPayment : item)),
      }));
      setMovementDraft(null);
      setPendingRecurringPaymentId(null);
      setPendingRecurringMovementId(null);
      setView("pagos");
      showToast("Gasto guardado correctamente");
      return true;
    }

    let remoteMovement: Movement;
    try {
      remoteMovement = id ? await updateRemoteMovement(savedMovement) : await createMovement(savedMovement);
    } catch (error) {
      if (error instanceof MovementNotFoundError) {
        window.alert("Este movimiento ya no existe en la base de datos. Es posible que haya sido eliminado desde otro dispositivo. Actualiza la información antes de continuar.");
        return false;
      }
      if (error instanceof DebtMovementProtectedError || error instanceof MovementContextImmutableError) {
        window.alert(error.message);
        return false;
      }
      markRemoteFailure();
      window.alert("No se pudo guardar el movimiento. No se realizó ningún cambio en tu caja. Intenta nuevamente.");
      return false;
    }

    markRemoteSuccess();

    setData((current) => ({
      ...current,
      movements: id
        ? current.movements.map((item) => (item.id === id ? remoteMovement : item))
        : [remoteMovement, ...current.movements],
    }));
    setMovementDraft(null);
    setPendingRecurringPaymentId(null);
    setPendingRecurringMovementId(null);
    setView("movimientos");
    showToast(movement.type === "egreso" ? "Gasto guardado correctamente" : "Ingreso guardado correctamente");
    return true;
  }

  async function deleteMovement(id: string): Promise<boolean> {
    if (!ensureOnlineWriteAllowed()) return false;
    if (!dataReady) {
      window.alert("Los datos todavía se están cargando. Intenta nuevamente en unos segundos.");
      return false;
    }

    if (pendingMovementIdsRef.current.has(id)) {
      window.alert("Este movimiento está pendiente de sincronización y no puede eliminarse todavía.");
      return false;
    }

    const movement = data.movements.find((item) => item.id === id);
    if (movement?.movementContext === "debt_service") {
      window.alert("Los pagos de deuda se corrigen desde el dominio de deudas y no pueden eliminarse aquí.");
      return false;
    }

    if (!window.confirm("Seguro que deseas eliminar este movimiento?")) return false;

    try {
      await deleteRemoteMovement(id);
    } catch (error) {
      if (error instanceof DebtMovementProtectedError) {
        window.alert(error.message);
        return false;
      }
      markRemoteFailure();
      window.alert("No se pudo eliminar el movimiento. No se realizó ningún cambio en tu caja. Intenta nuevamente.");
      return false;
    }

    markRemoteSuccess();
    setData((current) => ({ ...current, movements: current.movements.filter((movement) => movement.id !== id) }));
    showToast("Movimiento eliminado");
    return true;
  }

  async function saveCashCount(cashCount: Omit<CashCount, "id">): Promise<boolean> {
    if (!ensureOnlineWriteAllowed()) return false;
    if (!ensureDataReady()) return false;

    const savedCount: CashCount = { ...cashCount, id: makeId("count"), accountId: cashCount.accountId ?? null };
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
    if (!ensureOnlineWriteAllowed()) return false;
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
    if (!ensureOnlineWriteAllowed()) return;
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
      setPendingRecurringMovementId(makeId("mov"));
      setView("registrar-gasto");
      return;
    }

    setPendingRecurringPaymentId(null);
    setPendingRecurringMovementId(null);

    try {
      if (isSupabaseConfigured) {
        const result = await completeRecurringPayment(payment, null);
        if (!result) throw new Error("La RPC no devolvió el pago actualizado.");
        markRemoteSuccess();
        setData((current) => ({ ...current, recurringPayments: current.recurringPayments.map((item) => (item.id === result.payment.id ? result.payment : item)) }));
        showToast("Pago marcado como pagado");
        return;
      }

      const savedPayment = markPaidForCurrentMonth(payment);
      setData((current) => ({ ...current, recurringPayments: current.recurringPayments.map((item) => (item.id === savedPayment.id ? savedPayment : item)) }));
      showToast("Pago marcado como pagado");
    } catch (error) {
      if (error instanceof RecurringPaymentAlreadyPaidError) {
        window.alert("Este pago ya fue marcado como pagado.");
      } else if (error instanceof RecurringPaymentNotFoundError) {
        window.alert("Este pago ya no existe o cambió desde otro dispositivo. No se realizó ningún cambio.");
      } else if (error instanceof RecurringPaymentInactiveError) {
        window.alert("Este pago está inactivo. No se realizó ningún cambio.");
      } else if (error instanceof HouseholdMemberNotProvisionedError) {
        window.alert("No se pudo verificar tu miembro del hogar. No se realizó ningún cambio.");
      } else if (error instanceof FinancialAccountNotAvailableError) {
        window.alert("La cuenta seleccionada ya no está disponible. Intenta nuevamente.");
      } else if (error instanceof FinancialAccountMethodMismatchError) {
        window.alert("El método de pago no corresponde al tipo de la cuenta seleccionada.");
      } else if (error instanceof RecurringPaymentAuthenticationError) {
        window.alert("Tu sesión ya no es válida. Inicia sesión nuevamente.");
      } else {
        markRemoteFailure();
        window.alert("No se pudo marcar el pago como pagado. No se realizó ningún cambio en el pago. Intenta nuevamente.");
      }
    }
  }

  async function setPaymentActive(id: string, isActive: boolean): Promise<boolean> {
    if (!ensureOnlineWriteAllowed()) return false;
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
    if (!ensureOnlineWriteAllowed()) return null;
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
    if (!ensureOnlineWriteAllowed()) return false;
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
    if (!ensureOnlineWriteAllowed()) return false;
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

  async function saveAccount(account: Omit<FinancialAccount, "id" | "createdAt" | "updatedAt">, id?: string): Promise<FinancialAccount | null> {
  if (!ensureOnlineWriteAllowed()) return null;
  if (!ensureDataReady()) return null;

  const name = account.name.trim();
  if (!name) {
    window.alert("La cuenta no puede estar vacia.");
    return null;
  }
  if (!Number.isFinite(account.openingBalance) || account.openingBalance < 0) {
    window.alert("Ingresa un saldo inicial válido.");
    return null;
  }

  const duplicate = data.financialAccounts.some((item) => item.id !== id && normalizeName(item.name) === normalizeName(name));
  if (duplicate) {
    window.alert("Ya existe una cuenta con ese nombre.");
    return null;
  }

  const existingAccount = id ? data.financialAccounts.find((item) => item.id === id) : undefined;
  if (id && existingAccount?.reconciliationType !== "balance") {
    window.alert("La cuenta de Efectivo no se puede editar aquí. Usa Editar saldo inicial.");
    return null;
  }

  const savedAccount: FinancialAccount = {
    ...account,
    name,
    id: id ?? makeUuid(),
    reconciliationType: "balance",
    createdAt: id ? (existingAccount?.createdAt ?? new Date().toISOString()) : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    const remoteAccount = id ? await updateFinancialAccountDetails(savedAccount) : await createFinancialAccount(savedAccount);
    markRemoteSuccess();
    setData((current) => ({
      ...current,
      financialAccounts: id
        ? current.financialAccounts.map((item) => (item.id === remoteAccount.id ? remoteAccount : item))
        : [...current.financialAccounts, remoteAccount],
    }));
    return remoteAccount;
  } catch (error) {
    if (error instanceof FinancialAccountNotFoundError) {
      window.alert("Esta cuenta ya no existe. Es posible que haya sido eliminada desde otro dispositivo.");
    } else if (error instanceof FinancialAccountProtectedError) {
      window.alert("La cuenta de Efectivo no se puede editar aquí. Usa Editar saldo inicial.");
    } else {
      markRemoteFailure();
      window.alert("No se pudo guardar la cuenta. Intenta nuevamente.");
    }
    return null;
  }
}

async function toggleAccount(id: string, isActive: boolean): Promise<boolean> {
  if (!ensureOnlineWriteAllowed()) return false;
  if (!ensureDataReady()) return false;

  const account = data.financialAccounts.find((item) => item.id === id);
  if (!account) return false;

  if (!isActive) {
    if (account.reconciliationType === "cash") {
      window.alert("La cuenta de Efectivo no se puede archivar.");
      return false;
    }
    const hasPendingOnAccount = data.movements.some((movement) => pendingMovementIdsRef.current.has(movement.id) && movement.accountId === account.id);
    if (hasPendingOnAccount) {
      window.alert("Esta cuenta tiene movimientos pendientes de sincronizar. Conéctate y espera a que terminen de sincronizarse antes de archivarla.");
      return false;
    }
  }

  try {
    const remoteAccount = await setFinancialAccountActive(account, isActive);
    markRemoteSuccess();
    setData((current) => ({ ...current, financialAccounts: current.financialAccounts.map((item) => (item.id === remoteAccount.id ? remoteAccount : item)) }));
    return true;
  } catch (error) {
    if (error instanceof FinancialAccountNotFoundError) {
      window.alert("Esta cuenta ya no existe. Es posible que haya sido eliminada desde otro dispositivo.");
    } else if (error instanceof FinancialAccountProtectedError) {
      window.alert("La cuenta de Efectivo no se puede archivar.");
    } else {
      markRemoteFailure();
      window.alert("No se pudo cambiar el estado de la cuenta. Intenta nuevamente.");
    }
    return false;
  }
}

async function saveInitialBalance(value: number): Promise<boolean> {
    if (!ensureOnlineWriteAllowed()) return false;
    if (!ensureDataReady()) return false;

    if (!Number.isFinite(value) || value < 0) {
      window.alert("Ingresa un saldo inicial válido.");
      return false;
    }

    try {
      const savedValue = await updateInitialBalance(value);
      markRemoteSuccess();
      setData((current) => ({
        ...current,
        initialBalance: savedValue,
        financialAccounts: current.financialAccounts.map((account) => (isDefaultCashAccount(account) ? { ...account, openingBalance: savedValue } : account)),
      }));
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

  if (dataLoadError) return <DataLoadErrorScreen message={dataLoadError} onSignOut={onSignOut} />;
  if (isSupabaseConfigured && !dataReady) return <AppLoadingScreen />;

  const initialType: MovementType = view === "registrar-ingreso" ? "ingreso" : "egreso";
  const cashAccount = getActiveCashAccount(data.financialAccounts);

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
              aria-label={item.view === "pagos" ? `Pagos${urgentPaymentSummary.total > 0 ? `, ${urgentPaymentLabel}` : ""}` : undefined}
            >
              <item.icon className="h-6 w-6 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.view === "pagos" && <UrgentPaymentBadge total={urgentPaymentSummary.total} className={view === item.view ? "bg-white text-blue-700" : "bg-red-100 text-red-800"} />}
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
              <SyncStatus status={syncStatus} pendingCount={pendingMovementCount} />
              {isSupabaseConfigured && isBrowserOnline && pendingSyncState === "problem" && (
                <button type="button" onClick={() => { setPendingSyncState("idle"); setSyncAttempt((attempt) => attempt + 1); }} className="rounded-full border border-red-200 bg-white px-3 py-1 text-sm font-bold text-red-700 hover:bg-red-50">
                  Reintentar sincronización
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="p-4 lg:p-8">
          {view === "dashboard" && (
            <Dashboard movements={data.movements} debtEvents={data.debtEvents} pendingMovementIds={pendingMovementIds} cashCounts={data.cashCounts} recurringPayments={data.recurringPayments} initialBalance={data.initialBalance} accounts={data.financialAccounts} onNavigate={navigate} onOpenPayment={openPayment} />
          )}
          {(view === "registrar-ingreso" || view === "registrar-gasto") && (
            <MovementForm
              key={view}
              initialType={initialType}
              draft={movementDraft}
              currentMember={currentMember}
              categories={data.categories}
              accounts={data.financialAccounts}
              onQuickCreateCategory={saveCategory}
              onSave={saveMovement}
              onCancel={
                movementDraft
                  ? () => {
                      setMovementDraft(null);
                      setPendingRecurringPaymentId(null);
                      setPendingRecurringMovementId(null);
                      setView("pagos");
                    }
                  : undefined
              }
            />
          )}
          {view === "movimientos" && (
            <MovementsList
              movements={data.movements}
              debtEvents={data.debtEvents}
              categories={data.categories}
              accounts={data.financialAccounts}
              currentMember={currentMember}
              pendingMovementIds={pendingMovementIds}
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
              cashAccount={cashAccount}
              onSave={saveCashCount}
            />
          )}
          {view === "pagos" && (
            <RecurringPayments
              payments={data.recurringPayments}
              categories={data.categories}
              alertSummary={urgentPaymentSummary}
              focusedPaymentId={focusedPaymentId}
              currentMember={currentMember}
              isBrowserOnline={isBrowserOnline}
              onSave={savePayment}
              onMarkPaid={markPaymentPaid}
              onDeactivate={deactivatePayment}
              onReactivate={reactivatePayment}
            />
          )}
          {view === "reportes" && (
            <Suspense fallback={<section className="rounded-lg bg-white p-5 text-slate-600 soft-shadow">Cargando reportes...</section>}>
              <Reports movements={data.movements} debtEvents={data.debtEvents} categories={data.categories} accounts={data.financialAccounts} initialBalance={data.initialBalance} />
            </Suspense>
          )}
          {view === "categorias" && <CategoriesManager categories={data.categories} onSave={saveCategory} onDelete={deleteCategory} onToggle={toggleCategory} />}
          {view === "cuentas" && <AccountsManager accounts={data.financialAccounts} movements={data.movements} onSave={saveAccount} onToggle={toggleAccount} onEditInitialBalance={() => navigate("saldo-inicial")} />}
          {view === "saldo-inicial" && <InitialBalance initialBalance={data.initialBalance} onSave={saveInitialBalance} />}
          {view === "deudas" && (
            <DebtsManager
              debts={data.debts}
              debtEvents={data.debtEvents}
              scheduleVersions={data.debtScheduleVersions}
              installments={data.debtInstallments}
              allocations={data.debtEventInstallmentAllocations}
              collaterals={data.debtCollaterals}
              accounts={data.financialAccounts}
              categories={data.categories}
              currentMember={currentMember}
              onOpenNewDebt={() => setView("registrar-deuda")}
              onSelectDebt={(debt) => setSelectedDebtId(debt.id)}
            />
          )}
          {view === "registrar-deuda" && (
            <DebtForm
              currentMember={currentMember}
              accounts={data.financialAccounts}
              categories={data.categories}
              canWriteDebt={canWriteDebt}
              onSaved={async () => {
                try {
                  await refreshAppData();
                  setView("deudas");
                } catch (err) {
                  setToast({ id: Date.now(), message: translateDebtError(err) });
                }
              }}
              onCancel={() => setView("deudas")}
              setToast={(t) => setToast({ id: Date.now(), message: t.message })}
            />
          )}
          {view === "operacion-deuda" && selectedDebt && debtOperationState && (
            <DebtOperationForm
              debt={selectedDebt}
              operationType={debtOperationState.type}
              targetEventId={debtOperationState.targetEventId}
              installments={data.debtInstallments}
              scheduleVersions={data.debtScheduleVersions}
              debtEvents={data.debtEvents}
              accounts={data.financialAccounts}
              categories={data.categories}
              currentPrincipal={currentDebtPrincipal(selectedDebt, data.debtEvents)}
              canWriteDebt={canWriteDebt}
              onSaved={async () => {
                try {
                  await refreshAppData();
                  setDebtOperationState(null);
                  setSelectedDebtId(null);
                  setView("deudas");
                } catch (err) {
                  setToast({ id: Date.now(), message: translateDebtError(err) });
                }
              }}
              onCancel={() => {
                setDebtOperationState(null);
                setView("deudas");
              }}
              setToast={(t) => setToast({ id: Date.now(), message: t.message })}
            />
          )}

          {selectedDebt && view !== "operacion-deuda" && (
            <DebtDetailModal
              debt={selectedDebt}
              debtEvents={data.debtEvents}
              scheduleVersions={data.debtScheduleVersions}
              installments={data.debtInstallments}
              allocations={data.debtEventInstallmentAllocations}
              collaterals={data.debtCollaterals}
              accounts={data.financialAccounts}
              categories={data.categories}
              currentMember={currentMember}
              canWriteDebt={canWriteDebt}
              onClose={() => setSelectedDebtId(null)}
              onOpenOperation={(opType, targetEvId) => {
                setDebtOperationState({ type: opType, targetEventId: targetEvId });
                setView("operacion-deuda");
              }}
              onRefresh={async () => {
                try {
                  await refreshAppData();
                } catch (err) {
                  setToast({ id: Date.now(), message: translateDebtError(err) });
                }
              }}
              setToast={(t) => setToast({ id: Date.now(), message: t.message })}
            />
          )}
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
          aria-label={`Más opciones${urgentPaymentSummary.total > 0 ? `, ${urgentPaymentLabel}` : ""}`}
          className={`relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 px-1 text-xs font-bold transition sm:text-sm ${
            moreOpen || ["pagos", "reportes", "categorias", "cuentas", "saldo-inicial"].includes(view) ? "text-blue-700" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          <MoreHorizontal className="h-6 w-6" />
          <span>Más</span>
          <UrgentPaymentBadge total={urgentPaymentSummary.total} className="absolute right-2 top-1 bg-red-600 text-white" />
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
              <button
                type="button"
                onClick={() => navigate("pagos")}
                aria-label={`Pagos recurrentes${urgentPaymentSummary.total > 0 ? `, ${urgentPaymentLabel}` : ""}`}
                className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-orange-50 px-4 text-left text-base font-bold text-orange-900"
              >
                <span>Pagos recurrentes</span>
                <UrgentPaymentBadge total={urgentPaymentSummary.total} className="shrink-0 bg-red-600 text-white" />
              </button>
              <button type="button" onClick={() => navigate("reportes")} className="min-h-14 rounded-2xl bg-indigo-50 px-4 text-left text-base font-bold text-indigo-900">
                Reportes
              </button>
              <button type="button" onClick={() => navigate("deudas")} className="min-h-14 rounded-2xl bg-purple-50 px-4 text-left text-base font-bold text-purple-900">
                Deudas
              </button>
              <button type="button" onClick={() => navigate("categorias")} className="min-h-14 rounded-2xl bg-emerald-50 px-4 text-left text-base font-bold text-emerald-900">
                Categorías
              </button>
              <button type="button" onClick={() => navigate("cuentas")} className="min-h-14 rounded-2xl bg-blue-50 px-4 text-left text-base font-bold text-blue-900">
                Cuentas
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

function mergePendingMovements(data: AppData, operations: OfflineCreateMovementOperation[]): AppData {
  const remoteMovementIds = new Set(data.movements.map((movement) => movement.id));
  const overlayMovementIds = new Set<string>();
  const pendingMovements = operations
    .map((operation) => operation.movement)
    .filter((movement) => {
      if (remoteMovementIds.has(movement.id) || overlayMovementIds.has(movement.id)) return false;
      overlayMovementIds.add(movement.id);
      return true;
    });

  return pendingMovements.length > 0 ? { ...data, movements: [...pendingMovements, ...data.movements] } : data;
}

function SyncStatus({ status, pendingCount }: { status: SyncStatus; pendingCount: number }) {
  const config = {
    loading: { label: "Conectando...", className: "bg-amber-400", textClassName: "text-slate-600" },
    connected: { label: "Conectado", className: "bg-emerald-500", textClassName: "text-emerald-700" },
    local: { label: "Modo local", className: "bg-slate-400", textClassName: "text-slate-600" },
    offline: { label: "Sin conexión", className: "bg-red-500", textClassName: "text-red-700" },
    problem: { label: "Problema de conexión", className: "bg-red-500", textClassName: "text-red-700" },
    syncing: { label: "Sincronizando...", className: "bg-amber-400", textClassName: "text-amber-700" },
  }[status];
  const pendingLabel = pendingCount === 1 ? "1 pendiente" : `${pendingCount} pendientes`;
  const label =
    status === "offline" && pendingCount > 0
      ? `Sin conexión · ${pendingLabel}`
      : status === "syncing"
        ? `Sincronizando ${pendingCount}...`
        : status === "problem" && pendingCount > 0
          ? `Problema de sincronización · ${pendingLabel}`
          : status === "connected" && pendingCount > 0
            ? `Conectado · ${pendingLabel}`
            : config.label;

  return (
    <div className={`flex items-center gap-2 text-sm font-bold ${config.textClassName}`} role="status" aria-live="polite">
      <span className={`h-2.5 w-2.5 rounded-full ${config.className}`} aria-hidden="true" />
      {label}
    </div>
  );
}

function AppLoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <section className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-xl sm:p-8">
        <h1 className="text-3xl font-black text-slate-900">Caja Familiar</h1>
        <p className="mt-4 text-lg text-slate-600" role="status" aria-live="polite">Conectando...</p>
      </section>
    </main>
  );
}

function UrgentPaymentBadge({ total, className = "" }: { total: number; className?: string }) {
  if (total === 0) return null;

  return <span aria-hidden="true" className={`inline-flex min-w-7 items-center justify-center rounded-full px-2 py-1 text-sm font-black leading-none ${className}`}>{total}</span>;
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
