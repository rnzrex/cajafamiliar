import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const container = process.env.DEBT6B_DB_CONTAINER ?? "supabase_db_crea-una-aplicaci-n-web-completa";

const ids = {
  user: "00000000-0000-4000-8000-0000000006b1",
  household: "00000000-0000-4000-8000-0000000006b2",
  debt1: "00000000-0000-4000-8000-0000000006b3",
  debt2: "00000000-0000-4000-8000-0000000006b4",
};

function execSql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-t",
      "-A",
    ]);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`psql exited with code ${code}: ${stderr || stdout}`));
      } else {
        if (stderr && stderr.trim().length > 0 && !stderr.includes("NOTICE")) {
          // console.warn("psql stderr:", stderr);
        }
        resolve(stdout.trim());
      }
    });

    child.stdin.write(sql);
    child.stdin.end();
  });
}

function withUser(sql, userId = ids.user) {
  return `
    begin;
    select set_config('request.jwt.claim.sub', '${userId}', true);
    select set_config('request.jwt.claim.role', 'authenticated', true);
    ${sql}
    commit;
  `;
}

async function applyMigrationsInOrder() {
  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));

  const sortedFiles = [...files].sort((a, b) => a.localeCompare(b));

  // Recreate public schema clean with baseline system tables
  await execSql(`
    drop schema if exists public cascade;
    create schema public;
    grant all on schema public to postgres, public;

    create table if not exists public.households (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      created_at timestamptz not null default now()
    );

    create table if not exists public.settings (
      household_id uuid primary key references public.households(id) on delete cascade,
      initial_balance numeric not null default 0
    );

    create table if not exists public.categories (
      id uuid primary key default gen_random_uuid(),
      household_id uuid references public.households(id) on delete cascade,
      name text not null,
      type text not null,
      color text,
      icon text,
      is_active boolean default true,
      created_at timestamptz default now()
    );

    create table if not exists public.movements (
      id text primary key,
      household_id uuid not null references public.households(id) on delete cascade,
      type text not null,
      date date not null,
      amount numeric not null,
      description text not null,
      method text not null,
      category text not null,
      person text not null,
      registered_by_user_id uuid,
      created_at timestamptz not null default now()
    );

    create table if not exists public.cash_counts (
      id uuid primary key default gen_random_uuid(),
      household_id uuid not null references public.households(id) on delete cascade,
      date date not null,
      amount numeric not null,
      notes text,
      created_at timestamptz not null default now()
    );

    create table if not exists public.recurring_payments (
      id uuid primary key default gen_random_uuid(),
      household_id uuid not null references public.households(id) on delete cascade,
      name text not null,
      amount numeric,
      due_day integer,
      category text not null,
      recurrence_type text not null default 'indefinite',
      total_installments integer,
      created_at timestamptz not null default now()
    );
  `);

  for (const file of sortedFiles) {
    if (file.includes("__dryrun")) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    try {
      await execSql(sql);
    } catch (err) {
      console.error(`Error applying migration ${file}:`, err);
      throw err;
    }
  }
  console.log("✓ Applied all DB migrations to local Postgres container");
}

async function runSmokeTest() {
  console.log("--- Running DEBT-6B SQL Smoke Harness ---");

  try {
    // 1. Reset DB schema and apply all migrations
    await applyMigrationsInOrder();

    // 2. Setup test user & household
    await execSql(`
      delete from auth.users where id = '${ids.user}';
      insert into auth.users (id, email) values ('${ids.user}', 'debt6b-harness@example.test');
      insert into public.households (id, name) values ('${ids.household}', 'DEBT-6B harness');
      insert into public.household_members (household_id, user_id, role, display_name)
        values ('${ids.household}', '${ids.user}', 'owner', 'DEBT-6B User');
    `);
    console.log("✓ Test environment initialized");

    // 3A. Test extended 25-arg create_debt_v1
    const create25ResultJson = await execSql(withUser(`
      select public.create_debt_v1(
        '${ids.household}', '${ids.debt1}', 'Empeño Laptop Lenovo', 'Casa de Empeño',
        'pledge', 'PEN', '2026-01-01', '2026-01-01', 5000, 5000,
        null, null, 'unknown', null, null, null,
        null, 72.4, 'Laptop Lenovo i7', '[]'::jsonb, '[]'::jsonb,
        'open_ended', 'contract_periodic_rate', 4.0, 'monthly'
      );
    `));
    const lines1 = create25ResultJson.split("\n").map(s => s.trim()).filter(Boolean);
    const rawJsonStr1 = lines1.find(l => l.startsWith("{"));
    const parsedCreate1 = JSON.parse(rawJsonStr1);
    if (parsedCreate1.debt.repayment_structure !== "open_ended") {
      throw new Error("create_debt_v1 failed to store open_ended repayment_structure");
    }
    console.log("✓ Extended 25-argument create_debt_v1 successfully executed");

    // 3B. Test legacy 21-arg create_debt_v1 backward-compatible invocation
    const create21ResultJson = await execSql(withUser(`
      select public.create_debt_v1(
        '${ids.household}', '${ids.debt2}', 'Préstamo Antiguo', 'Banco BCP',
        'bank_loan', 'PEN', '2026-01-01', '2026-01-01', 2000, 2000,
        12, 200, 'fixed', 'monthly', null, '2026-02-01',
        18.5, 22.0, 'Legacy call', '[]'::jsonb, '[]'::jsonb
      );
    `));
    const lines2 = create21ResultJson.split("\n").map(s => s.trim()).filter(Boolean);
    const rawJsonStr2 = lines2.find(l => l.startsWith("{"));
    const parsedCreate2 = JSON.parse(rawJsonStr2);
    if (parsedCreate2.debt.id !== ids.debt2) {
      throw new Error("Legacy 21-argument create_debt_v1 failed to create debt");
    }
    console.log("✓ Legacy 21-argument create_debt_v1 successfully executed without overload ambiguity");

    // 4. Test update_debt_terms_v1 with explicit clear flags
    const updateResultJson = await execSql(withUser(`
      select public.update_debt_terms_v1(
        '${ids.household}', '${ids.debt1}',
        'open_ended', 'tea_estimate', null, null,
        60.1, 72.4, null, null, null,
        true, false, false, false, false
      );
    `));
    const lines3 = updateResultJson.split("\n").map(s => s.trim()).filter(Boolean);
    const rawUpdateStr = lines3.find(l => l.startsWith("{"));
    const parsedUpdate = JSON.parse(rawUpdateStr);
    if (parsedUpdate.periodic_rate_percent !== null || parsedUpdate.periodic_rate_basis !== null) {
      throw new Error("update_debt_terms_v1 failed to clear periodic rate fields when p_clear_periodic_rate is true");
    }
    if (parsedUpdate.interest_calculation_mode !== "tea_estimate" || Number(parsedUpdate.tea_percent) !== 60.1) {
      throw new Error("update_debt_terms_v1 failed to update tea_percent");
    }
    console.log("✓ update_debt_terms_v1 successfully cleared periodic rate and updated TEA terms");

    // 5. Test check constraints (reject invalid repayment_structure)
    let rejected = false;
    try {
      await execSql(withUser(`
        select public.update_debt_terms_v1(
          '${ids.household}', '${ids.debt1}',
          'invalid_structure', null, null, null, null, null, null, null
        );
      `));
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error("update_debt_terms_v1 allowed invalid repayment_structure!");
    }
    console.log("✓ Invalid repayment_structure correctly rejected by domain check constraint");

    console.log("--- DEBT-6B SQL Smoke Test Completed Successfully ---");
  } catch (err) {
    console.error("❌ SQL Smoke Test Failed:", err);
    process.exit(1);
  }
}

runSmokeTest();
