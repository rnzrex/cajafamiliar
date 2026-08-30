import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const migrationPath = resolve(root, "supabase/migrations/20260830100000_universal_debt_contract_engine_v1.sql");
const sql = await readFile(migrationPath, "utf8");

const required = [
  "debt_financing_contracts",
  "debt_refinancing_links",
  "upsert_debt_financing_contract_v1",
  "create_debt_document_import_job_v2",
  "refinance_debt_v1",
  "reverse_debt_refinancing_v1",
  "record_debt_payment_universal_v1",
  "record_debt_prepayment_universal_v1",
  "record_debt_installment_advance_universal_v1",
  "CAJA_FAMILIAR_BANK_DOCUMENT_V1",
  "CAJA_FAMILIAR_DEBT_DOCUMENT_V2",
  "actual_days_360",
  "actual_days_365",
];
const forbidden = ["include-all", "migration repair", "supabase_execute_sql", "gemini_api_key", "force push"];
const missing = required.filter((token) => !sql.includes(token));
const presentForbidden = forbidden.filter((token) => sql.toLowerCase().includes(token.toLowerCase()));

if (missing.length || presentForbidden.length || !/^-- Additive only\./m.test(sql)) {
  console.error(JSON.stringify({ missing, presentForbidden, additiveHeader: /^-- Additive only\./m.test(sql) }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ migration: "20260830100000_universal_debt_contract_engine_v1.sql", additiveOnly: true, requiredSymbols: required.length, forbiddenTerms: 0 }, null, 2));
