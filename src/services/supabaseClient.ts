import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const householdId =
  normalizeHouseholdId((import.meta.env.VITE_SUPABASE_HOUSEHOLD_ID as string | undefined) ?? "00000000-0000-0000-0000-000000000001");

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured ? createClient(supabaseUrl!, supabaseAnonKey!) : null;

export function normalizeHouseholdId(value: string) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value;

  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }

  const hex = Array.from({ length: 32 }, (_, index) => {
    hash ^= index + value.length;
    hash = Math.imul(hash, 0x01000193);
    return ((hash >>> ((index % 4) * 8)) & 0xff).toString(16).padStart(2, "0");
  }).join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
