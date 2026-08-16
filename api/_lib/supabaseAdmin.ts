import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface ServerEnvironment {
  supabaseUrl: string;
  serviceRoleKey: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
  appOrigin: string;
}

export class ServerConfigurationError extends Error {
  constructor() {
    super("Server configuration is incomplete.");
    this.name = "ServerConfigurationError";
  }
}

export function readServerEnvironment(): ServerEnvironment {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const vapidPublicKey = process.env.WEB_PUSH_PUBLIC_KEY?.trim();
  const vapidPrivateKey = process.env.WEB_PUSH_PRIVATE_KEY?.trim();
  const vapidSubject = process.env.WEB_PUSH_SUBJECT?.trim();
  const rawAppOrigin = process.env.WEB_PUSH_APP_ORIGIN?.trim();

  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject || !rawAppOrigin) {
    throw new ServerConfigurationError();
  }

  if (!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vapidSubject) && !/^https:\/\//.test(vapidSubject)) {
    throw new ServerConfigurationError();
  }

  let appOrigin: string;
  try {
    const parsedOrigin = new URL(rawAppOrigin);
    if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") throw new Error();
    appOrigin = parsedOrigin.origin;
  } catch {
    throw new ServerConfigurationError();
  }

  return { supabaseUrl, serviceRoleKey, vapidPublicKey, vapidPrivateKey, vapidSubject, appOrigin };
}

export function createSupabaseAdmin(environment: ServerEnvironment): SupabaseClient {
  return createClient(environment.supabaseUrl, environment.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
