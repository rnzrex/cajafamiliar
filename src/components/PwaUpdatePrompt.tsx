import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_REMINDER_MS = 30 * 60 * 1000;

export function PwaUpdatePrompt() {
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const reminderTimeoutRef = useRef<number | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    let intervalId: number | null = null;
    let installingWorker: ServiceWorker | null = null;

    const revealUpdate = () => {
      if (cancelled) return;
      setUpdateAvailable(true);
      setDismissed(false);
    };

    const detectWaitingWorker = (registration: ServiceWorkerRegistration) => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        revealUpdate();
      }
    };

    const handleInstallingStateChange = () => {
      if (
        !cancelled &&
        installingWorker?.state === "installed" &&
        navigator.serviceWorker.controller
      ) {
        revealUpdate();
      }
    };

    const handleUpdateFound = () => {
      installingWorker?.removeEventListener("statechange", handleInstallingStateChange);
      installingWorker = registrationRef.current?.installing ?? null;
      installingWorker?.addEventListener("statechange", handleInstallingStateChange);
    };

    const checkForUpdates = () => {
      const registration = registrationRef.current;
      if (!registration || !navigator.onLine) return;

      void registration
        .update()
        .then(() => detectWaitingWorker(registration))
        .catch((error) => console.warn("No se pudo comprobar una actualización de la PWA.", error));
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkForUpdates();
      }
    };

    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        if (cancelled) return;

        registrationRef.current = registration;
        detectWaitingWorker(registration);
        registration.addEventListener("updatefound", handleUpdateFound);

        if (registration.installing) {
          handleUpdateFound();
        }

        checkForUpdates();
        intervalId = window.setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
        document.addEventListener("visibilitychange", handleVisibilityChange);
      })
      .catch((error) => console.error("No se pudo registrar el service worker de Caja Familiar.", error));

    return () => {
      cancelled = true;
      if (intervalId !== null) window.clearInterval(intervalId);
      if (reminderTimeoutRef.current !== null) window.clearTimeout(reminderTimeoutRef.current);
      installingWorker?.removeEventListener("statechange", handleInstallingStateChange);
      registrationRef.current?.removeEventListener("updatefound", handleUpdateFound);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const remindLater = () => {
    setDismissed(true);
    if (reminderTimeoutRef.current !== null) {
      window.clearTimeout(reminderTimeoutRef.current);
    }
    reminderTimeoutRef.current = window.setTimeout(() => {
      setDismissed(false);
      reminderTimeoutRef.current = null;
    }, UPDATE_REMINDER_MS);
  };

  const applyUpdate = async () => {
    const registration = registrationRef.current;
    if (!registration) return;

    setUpdating(true);

    try {
      if (!registration.waiting) {
        await registration.update();
      }

      const waitingWorker = registration.waiting;
      if (!waitingWorker) {
        setUpdating(false);
        return;
      }

      let refreshing = false;
      const triggerReload = () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      };

      if (typeof navigator !== "undefined" && navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener("controllerchange", triggerReload, { once: true });
      }

      waitingWorker.addEventListener("statechange", () => {
        if (waitingWorker.state === "activated") {
          triggerReload();
        }
      });
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    } catch (error) {
      console.error("No se pudo aplicar la actualización de Caja Familiar.", error);
      setUpdating(false);
    }
  };

  if (!updateAvailable || dismissed) return null;

  return (
    <section
      role="alertdialog"
      aria-labelledby="pwa-update-title"
      aria-describedby="pwa-update-description"
      className="fixed inset-x-4 bottom-24 z-[70] mx-auto max-w-md rounded-2xl border border-blue-100 bg-white p-4 shadow-2xl lg:bottom-6 lg:left-auto lg:right-6 lg:mx-0"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-xl bg-blue-50 p-2 text-blue-700">
          <RefreshCw className={`h-5 w-5 ${updating ? "animate-spin" : ""}`} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="pwa-update-title" className="text-base font-black text-slate-900">
            Nueva versión disponible
          </h2>
          <p id="pwa-update-description" className="mt-1 text-sm leading-5 text-slate-600">
            Guarda lo que estés haciendo y actualiza Caja Familiar para usar la versión más reciente.
          </p>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={remindLater}
          disabled={updating}
          className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 disabled:opacity-50"
        >
          Más tarde
        </button>
        <button
          type="button"
          onClick={() => void applyUpdate()}
          disabled={updating}
          className="min-h-11 flex-1 rounded-xl bg-blue-700 px-4 py-2 text-sm font-black text-white shadow-sm disabled:opacity-60"
        >
          {updating ? "Actualizando..." : "Actualizar"}
        </button>
      </div>
    </section>
  );
}
