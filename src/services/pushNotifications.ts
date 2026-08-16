import type { HouseholdMember } from "../types";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

export type PushNotificationStateKind =
  | "checking"
  | "unsupported"
  | "ios-install-required"
  | "not-configured"
  | "inactive"
  | "requesting"
  | "active"
  | "denied"
  | "offline"
  | "error";

export interface PushNotificationState {
  kind: PushNotificationStateKind;
  message?: string;
}

const publicKey = (import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY as string | undefined)?.trim() ?? "";

export async function getPushNotificationState(member: HouseholdMember | undefined, isBrowserOnline = typeof navigator === "undefined" || navigator.onLine): Promise<PushNotificationState> {
  if (!isPushSupported()) return { kind: "unsupported" };
  if (isIOSDevice() && !isStandalonePwa()) return { kind: "ios-install-required" };
  if (!isSupabaseConfigured || !supabase || !publicKey || !member) return { kind: "not-configured" };
  if (!isBrowserOnline) return { kind: "offline" };

  if (Notification.permission === "denied") return { kind: "denied" };

  try {
    const registration = await getServiceWorkerRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return { kind: "inactive" };

    const remoteActive = await getRemoteSubscriptionStatus(member, subscription.endpoint);
    return remoteActive ? { kind: "active" } : { kind: "inactive" };
  } catch {
    return { kind: "error", message: "No se pudo verificar el estado de las alertas." };
  }
}

export async function enablePushNotifications(member: HouseholdMember): Promise<PushNotificationState> {
  if (!isPushSupported()) throw new Error("PUSH_UNSUPPORTED");
  if (isIOSDevice() && !isStandalonePwa()) throw new Error("PUSH_IOS_INSTALL_REQUIRED");
  if (!isSupabaseConfigured || !supabase || !publicKey) throw new Error("PUSH_NOT_CONFIGURED");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    if (permission === "denied") return { kind: "denied" };
    return { kind: "inactive" };
  }

  const registration = await getServiceWorkerRegistration();
  if (!registration) throw new Error("PUSH_WORKER_NOT_READY");

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey) as unknown as BufferSource,
    });
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    await subscription.unsubscribe().catch(() => undefined);
    throw new Error("PUSH_SUBSCRIPTION_INVALID");
  }

  const { error } = await supabase.rpc("register_push_subscription", {
    p_household_id: member.householdId,
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_app_origin: window.location.origin,
    p_expires_at: toIsoDate(subscription.expirationTime),
  });

  if (error) {
    await subscription.unsubscribe().catch(() => undefined);
    throw error;
  }

  return { kind: "active" };
}

export async function unregisterPushSubscription(
  member: HouseholdMember,
  options: { isBrowserOnline?: boolean; bestEffort?: boolean } = {}
) {
  const registration = await getServiceWorkerRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  let remoteError: unknown = null;
  const remoteClient = options.isBrowserOnline !== false && isSupabaseConfigured ? supabase : null;
  const canUseRemote = Boolean(remoteClient);
  let shouldUnsubscribeLocally = !canUseRemote;
  if (remoteClient) {
    const { data, error } = await remoteClient.rpc("unregister_push_subscription", {
      p_household_id: member.householdId,
      p_endpoint: subscription.endpoint,
      p_app_origin: window.location.origin,
    });
    remoteError = error;
    shouldUnsubscribeLocally = error ? true : data === true;
  }

  if (shouldUnsubscribeLocally) await subscription.unsubscribe();
  if (remoteError && !options.bestEffort) throw remoteError;
}

async function getRemoteSubscriptionStatus(member: HouseholdMember, endpoint: string) {
  if (!supabase) return false;

  const { data, error } = await supabase.rpc("get_push_subscription_status", {
    p_household_id: member.householdId,
    p_endpoint: endpoint,
    p_app_origin: window.location.origin,
  });
  if (error) throw error;
  return data === true;
}

async function getServiceWorkerRegistration() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return null;
  return navigator.serviceWorker.getRegistration("/");
}

function isPushSupported() {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

function isIOSDevice() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalonePwa() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function toIsoDate(expirationTime: number | null) {
  return expirationTime !== null && Number.isFinite(expirationTime) ? new Date(expirationTime).toISOString() : null;
}
