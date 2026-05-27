import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";

loadEnvFile(".env.local");
loadEnvFile(".env");

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const householdId = process.env.VITE_SUPABASE_HOUSEHOLD_ID ? normalizeHouseholdId(process.env.VITE_SUPABASE_HOUSEHOLD_ID) : undefined;

if (!supabaseUrl || !supabaseAnonKey || !householdId) {
  console.error("Faltan variables. Configura VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY y VITE_SUPABASE_HOUSEHOLD_ID en .env.local.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const suffix = Date.now();
const categoryId = `test-cat-${suffix}`;
const movementId = `test-mov-${suffix}`;
const cashCountId = `test-count-${suffix}`;
const paymentId = `test-pay-${suffix}`;

await step("households upsert", () => supabase.from("households").upsert({ id: householdId, name: "Familia Ruiz Gallardo" }));
await step("settings upsert", () => supabase.from("settings").upsert({ household_id: householdId, initial_balance: 123.45, updated_at: new Date().toISOString() }));

await step("categories insert", () =>
  supabase.from("categories").insert({
    id: categoryId,
    household_id: householdId,
    name: `Categoria prueba ${suffix}`,
    type: "ambos",
    color: "#2563eb",
    icon: "tag",
    is_active: true,
  })
);
await step("categories update", () => supabase.from("categories").update({ is_active: false }).eq("id", categoryId));
await readOne("categories read", "categories", categoryId);

await step("movements insert", () =>
  supabase.from("movements").insert({
    id: movementId,
    household_id: householdId,
    type: "egreso",
    date: new Date().toISOString().slice(0, 10),
    amount: 9.9,
    description: "Movimiento prueba Supabase",
    method: "Yape",
    category: `Categoria prueba ${suffix}`,
    person: "Prueba",
  })
);
await readOne("movements read", "movements", movementId);

await step("cash_counts insert", () =>
  supabase.from("cash_counts").insert({
    id: cashCountId,
    household_id: householdId,
    denominations: { 10: 1 },
    total: 10,
    expected: 9,
    difference: 1,
  })
);
await readOne("cash_counts read", "cash_counts", cashCountId);

await step("recurring_payments insert", () =>
  supabase.from("recurring_payments").insert({
    id: paymentId,
    household_id: householdId,
    name: "Pago prueba Supabase",
    amount: 50,
    due_day: 15,
    category: `Categoria prueba ${suffix}`,
    status: "pendiente",
    notes: "",
    recurrence_type: "indefinite",
    paid_installments: 0,
    is_active: true,
  })
);
await step("recurring_payments update", () => supabase.from("recurring_payments").update({ status: "pagado" }).eq("id", paymentId));
await readOne("recurring_payments read", "recurring_payments", paymentId);

await step("cleanup recurring_payments", () => supabase.from("recurring_payments").delete().eq("id", paymentId));
await step("cleanup cash_counts", () => supabase.from("cash_counts").delete().eq("id", cashCountId));
await step("cleanup movements", () => supabase.from("movements").delete().eq("id", movementId));
await step("cleanup categories", () => supabase.from("categories").delete().eq("id", categoryId));

console.log("OK: Supabase lee y guarda categorias, movimientos, conteos de caja y pagos recurrentes.");

async function readOne(label, table, id) {
  return step(label, () => supabase.from(table).select("*").eq("id", id).single());
}

async function step(label, action) {
  const { error } = await action();
  if (error) {
    console.error(`ERROR en ${label}: ${error.message}`);
    process.exit(1);
  }
  console.log(`OK: ${label}`);
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!process.env[key]) process.env[key] = rest.join("=").replace(/^["']|["']$/g, "");
  }
}

function normalizeHouseholdId(value) {
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
