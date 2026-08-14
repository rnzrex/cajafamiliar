import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import App from "../App";
import { householdId, isSupabaseConfigured, supabase } from "../services/supabaseClient";
import type { HouseholdMember } from "../types";
import { clearLocalAppData } from "../utils/storage";

type MembershipState = "idle" | "checking" | "authorized" | "denied" | "provisioning" | "error";

export function AuthGate() {
  if (!isSupabaseConfigured || !supabase) return <App />;
  return <ConfiguredAuthGate client={supabase} />;
}

function ConfiguredAuthGate({ client }: { client: SupabaseClient }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authAttempt, setAuthAttempt] = useState(0);
  const [membershipState, setMembershipState] = useState<MembershipState>("idle");
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [membershipAttempt, setMembershipAttempt] = useState(0);
  const [currentMember, setCurrentMember] = useState<HouseholdMember | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const sessionUserId = useRef<string | null>(null);
  const authEventVersion = useRef(0);
  const currentUserId = session?.user.id ?? null;

  useEffect(() => {
    let active = true;
    const initialAuthEventVersion = authEventVersion.current;

    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active || authEventVersion.current !== initialAuthEventVersion) return;
        if (error) {
          setAuthError("No se pudo restaurar la sesión. Revisa tu conexión e intenta nuevamente.");
        } else {
          if (!data.session) clearLocalAppData();
          sessionUserId.current = data.session?.user.id ?? null;
          setSession(data.session);
        }
        setAuthReady(true);
      })
      .catch(() => {
        if (!active || authEventVersion.current !== initialAuthEventVersion) return;
        setAuthError("No se pudo restaurar la sesión. Revisa tu conexión e intenta nuevamente.");
        setAuthReady(true);
      });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      authEventVersion.current += 1;
      if (nextSession?.user.id !== sessionUserId.current) {
        clearLocalAppData();
        setMembershipState(nextSession ? "checking" : "idle");
        setCurrentMember(null);
      }
      sessionUserId.current = nextSession?.user.id ?? null;
      setSession(nextSession);
      setAuthError(null);
      setAuthReady(true);
      if (!nextSession) clearLocalAppData();
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [authAttempt, client]);

  useEffect(() => {
    if (!authReady || authError) return;
    if (!session || !currentUserId) {
      setMembershipState("idle");
      setMembershipError(null);
      setCurrentMember(null);
      return;
    }

    let active = true;
    setMembershipState("checking");
    setMembershipError(null);
    setCurrentMember(null);

    void client
      .from("household_members")
      .select("household_id,user_id,role,display_name")
      .eq("household_id", householdId)
      .eq("user_id", currentUserId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setMembershipState("error");
          setMembershipError("No se pudo verificar el acceso. Revisa tu conexión e intenta nuevamente.");
        } else if (!data) {
          clearLocalAppData();
          setMembershipState("denied");
        } else if (typeof data.display_name !== "string" || !data.display_name.trim()) {
          setCurrentMember(null);
          setMembershipError("Tu cuenta tiene acceso, pero falta configurar display_name. Un administrador debe completar el provisioning antes de usar Caja Familiar.");
          setMembershipState("provisioning");
        } else {
          setCurrentMember({
            householdId: data.household_id,
            userId: data.user_id,
            displayName: data.display_name.trim(),
            role: data.role === "owner" ? "owner" : "member",
          });
          setMembershipState("authorized");
        }
      });

    return () => {
      active = false;
    };
  }, [authError, authReady, client, currentUserId, membershipAttempt]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || !password) {
      setLoginError("Ingresa tu correo y contraseña.");
      return;
    }

    setIsSubmitting(true);
    setLoginError(null);
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.session) {
        setLoginError("No se pudo iniciar sesión. Revisa tu correo y contraseña.");
        return;
      }

      setSession(data.session);
    } catch {
      setLoginError("No se pudo iniciar sesión. Revisa tu correo y contraseña.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setLoginError(null);
    try {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    } catch {
      setIsSigningOut(false);
      window.alert("No se pudo cerrar sesión. Intenta nuevamente.");
      return;
    }

    clearLocalAppData();
    setSession(null);
    setCurrentMember(null);
    setMembershipState("idle");
    setIsSigningOut(false);
  }

  function retryAuth() {
    setAuthReady(false);
    setAuthError(null);
    setAuthAttempt((attempt) => attempt + 1);
  }

  function retryMembership() {
    setMembershipAttempt((attempt) => attempt + 1);
  }

  if (!authReady) return <GateMessage title="Caja Familiar" message="Restaurando sesión..." />;
  if (authError) {
    return <GateMessage title="Caja Familiar" message={authError} actionLabel="Reintentar" onAction={retryAuth} />;
  }
  if (!session) return <LoginScreen error={loginError} isSubmitting={isSubmitting} onSubmit={handleLogin} />;
  if (membershipState === "checking" || membershipState === "idle") {
    return <GateMessage title="Caja Familiar" message="Verificando acceso..." />;
  }
  if (membershipState === "denied") {
    return <GateMessage title="Caja Familiar" message="Esta cuenta no tiene acceso a Caja Familiar." actionLabel="Cerrar sesión" onAction={() => void handleSignOut()} actionDisabled={isSigningOut} />;
  }
  if (membershipState === "provisioning") {
    return (
      <GateMessage
        title="Caja Familiar"
        message={membershipError ?? "Falta completar el provisioning de esta cuenta."}
        actionLabel="Reintentar"
        onAction={retryMembership}
        secondaryLabel="Cerrar sesión"
        onSecondary={() => void handleSignOut()}
        actionDisabled={isSigningOut}
      />
    );
  }
  if (membershipState === "error") {
    return (
      <GateMessage
        title="Caja Familiar"
        message={membershipError ?? "No se pudo verificar el acceso. Revisa tu conexión e intenta nuevamente."}
        actionLabel="Reintentar"
        onAction={retryMembership}
        secondaryLabel="Cerrar sesión"
        onSecondary={() => void handleSignOut()}
        actionDisabled={isSigningOut}
      />
    );
  }

  if (membershipState === "authorized" && currentMember) return <App currentMember={currentMember} onSignOut={handleSignOut} />;
  return <GateMessage title="Caja Familiar" message="Verificando acceso..." />;
}

function LoginScreen({ error, isSubmitting, onSubmit }: { error: string | null; isSubmitting: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <AuthShell>
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl sm:p-8">
        <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Finanzas familiares</p>
        <h1 className="mt-2 text-3xl font-black text-slate-900">Caja Familiar</h1>
        <p className="mt-2 text-slate-600">Ingresa para consultar y administrar la caja de tu familia.</p>
        {error && <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-800" role="alert">{error}</p>}
        <div className="mt-6 space-y-4">
          <label className="block space-y-2 text-base font-bold text-slate-700">
            Correo
            <input name="email" type="email" autoComplete="email" required className="h-14 w-full rounded-2xl border border-slate-200 px-4 text-lg" />
          </label>
          <label className="block space-y-2 text-base font-bold text-slate-700">
            Contraseña
            <input name="password" type="password" autoComplete="current-password" required className="h-14 w-full rounded-2xl border border-slate-200 px-4 text-lg" />
          </label>
          <button disabled={isSubmitting} type="submit" className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-blue-600 px-5 py-3 text-lg font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
            {isSubmitting ? "Ingresando..." : "Ingresar"}
          </button>
        </div>
      </form>
    </AuthShell>
  );
}

function GateMessage({
  title,
  message,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  actionDisabled = false,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  actionDisabled?: boolean;
}) {
  return (
    <AuthShell>
      <section className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-xl sm:p-8">
        <h1 className="text-3xl font-black text-slate-900">{title}</h1>
        <p className="mt-4 text-lg text-slate-600" role="status" aria-live="polite">{message}</p>
        <div className="mt-6 flex flex-col gap-3">
          {actionLabel && onAction && <button disabled={actionDisabled} type="button" onClick={onAction} className="min-h-14 rounded-2xl bg-blue-600 px-5 py-3 text-lg font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">{actionLabel}</button>}
          {secondaryLabel && onSecondary && <button disabled={actionDisabled} type="button" onClick={onSecondary} className="min-h-14 rounded-2xl border border-slate-300 px-5 py-3 text-lg font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">{secondaryLabel}</button>}
        </div>
      </section>
    </AuthShell>
  );
}

function AuthShell({ children }: { children: ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">{children}</main>;
}
