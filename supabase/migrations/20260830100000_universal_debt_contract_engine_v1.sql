-- CAJA FAMILIAR UNIVERSAL DEBT CONTRACT ENGINE V1
-- Additive only. Historical BANK migrations remain immutable and their
-- validation gates are preserved. This migration adds generic contract
-- authority, document metadata, refinancing lineage, and structure-driven
-- operation entry points.

-- ============================================================
-- 1. AUTHORITY IS DISTINCT FROM SOURCE / RECONCILIATION
-- ============================================================

alter table public.debt_schedule_versions
  add column if not exists authority text not null default 'unknown';

update public.debt_schedule_versions
   set authority = case
     when schedule_source = 'contractual' and is_authoritative = true then 'contractual'
     when schedule_source = 'estimated' then 'estimated'
     when schedule_source = 'reconstructed' then 'official_noncontractual'
     when schedule_source = 'manual' then 'user_reported'
     else 'unknown'
   end
 where authority = 'unknown';

alter table public.debt_schedule_versions
  drop constraint if exists debt_schedule_versions_authority_check,
  add constraint debt_schedule_versions_authority_check
    check (authority in ('contractual', 'official_noncontractual', 'user_reported', 'estimated', 'unknown'));

alter table public.debt_installments
  add column if not exists expected_taxes numeric null,
  add column if not exists row_role text not null default 'installment',
  add column if not exists phase text null,
  add column if not exists evidence jsonb not null default '{}'::jsonb;

alter table public.debt_installments
  drop constraint if exists debt_installments_expected_taxes_non_negative_check,
  add constraint debt_installments_expected_taxes_non_negative_check
    check (expected_taxes is null or expected_taxes >= 0),
  drop constraint if exists debt_installments_row_role_check,
  add constraint debt_installments_row_role_check
    check (row_role in ('down_payment', 'installment', 'summary', 'unknown'));

alter table public.bank_document_import_jobs
  add column if not exists document_schema text not null default 'CAJA_FAMILIAR_BANK_DOCUMENT_V1',
  add column if not exists document_kind text not null default 'contract',
  add column if not exists document_authority text not null default 'unknown',
  add column if not exists normalized_metadata jsonb not null default '{}'::jsonb;

alter table public.bank_document_import_jobs
  drop constraint if exists bank_document_import_jobs_schema_check,
  add constraint bank_document_import_jobs_schema_check
    check (document_schema in ('CAJA_FAMILIAR_BANK_DOCUMENT_V1', 'CAJA_FAMILIAR_DEBT_DOCUMENT_V2')),
  drop constraint if exists bank_document_import_jobs_kind_check,
  add constraint bank_document_import_jobs_kind_check
    check (document_kind in ('contract', 'schedule', 'refinance', 'statement', 'other')),
  drop constraint if exists bank_document_import_jobs_authority_check,
  add constraint bank_document_import_jobs_authority_check
    check (document_authority in ('contractual', 'official_noncontractual', 'user_reported', 'estimated', 'unknown'));

-- ============================================================
-- 2. GENERIC FINANCING CONTRACT TERMS
-- ============================================================

create table if not exists public.debt_financing_contracts (
  debt_id uuid primary key,
  household_id uuid not null,
  contract_authority text not null default 'unknown',
  principal_basis text not null default 'unknown',
  asset_price numeric null,
  down_payment_amount numeric null,
  scheduled_principal_amount numeric null,
  financed_principal_amount numeric null,
  opening_principal_amount numeric null,
  repayment_structure text not null default 'unknown',
  amortization_method text not null default 'unknown',
  installment_amount_mode text not null default 'unknown',
  payment_frequency text null,
  custom_frequency_days integer null,
  first_due_date date null,
  interest_rate_type text not null default 'unknown',
  interest_rate_percent numeric null,
  interest_rate_basis text null,
  day_count_basis text not null default 'unknown',
  fee_rule_type text not null default 'unknown',
  fee_rule jsonb not null default '{}'::jsonb,
  prepayment_terms jsonb not null default '{}'::jsonb,
  authority_notes text not null default '',
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint debt_financing_contracts_debt_household_fkey
    foreign key (debt_id, household_id)
    references public.debts(id, household_id)
    on delete cascade,
  constraint debt_financing_contracts_user_fkey
    foreign key (created_by_user_id)
    references auth.users(id)
    on delete restrict,
  constraint debt_financing_contracts_authority_check
    check (contract_authority in ('contractual', 'official_noncontractual', 'user_reported', 'estimated', 'unknown')),
  constraint debt_financing_contracts_principal_basis_check
    check (principal_basis in ('asset_price_including_down_payment', 'financed_principal_only', 'reported_balance', 'unknown')),
  constraint debt_financing_contracts_repayment_structure_check
    check (repayment_structure in ('fixed_schedule', 'open_ended', 'unknown')),
  constraint debt_financing_contracts_amortization_method_check
    check (amortization_method in ('fixed_installment', 'constant_principal', 'increasing_installment', 'decreasing_installment', 'irregular_contract', 'custom', 'unknown')),
  constraint debt_financing_contracts_installment_mode_check
    check (installment_amount_mode in ('fixed', 'variable', 'unknown')),
  constraint debt_financing_contracts_frequency_check
    check (payment_frequency is null or payment_frequency in ('monthly', 'biweekly', 'weekly', 'custom')),
  constraint debt_financing_contracts_custom_frequency_check
    check ((payment_frequency = 'custom' and custom_frequency_days is not null and custom_frequency_days > 0) or (payment_frequency is distinct from 'custom' and custom_frequency_days is null)),
  constraint debt_financing_contracts_amounts_check
    check (asset_price is null or asset_price >= 0),
  constraint debt_financing_contracts_down_payment_check
    check (down_payment_amount is null or down_payment_amount >= 0),
  constraint debt_financing_contracts_scheduled_principal_check
    check (scheduled_principal_amount is null or scheduled_principal_amount >= 0),
  constraint debt_financing_contracts_financed_principal_check
    check (financed_principal_amount is null or financed_principal_amount >= 0),
  constraint debt_financing_contracts_opening_principal_check
    check (opening_principal_amount is null or opening_principal_amount >= 0),
  constraint debt_financing_contracts_interest_type_check
    check (interest_rate_type in ('nominal_annual_simple', 'effective_annual', 'effective_periodic', 'contract_schedule', 'manual', 'unknown')),
  constraint debt_financing_contracts_interest_rate_check
    check (interest_rate_percent is null or interest_rate_percent >= 0),
  constraint debt_financing_contracts_day_count_check
    check (day_count_basis in ('actual_days_360', 'actual_days_365', 'unknown')),
  constraint debt_financing_contracts_fee_rule_check
    check (fee_rule_type in ('fixed', 'percentage', 'formula_known', 'contract_schedule_only', 'unknown')),
  constraint debt_financing_contracts_asset_reconciliation_check
    check (asset_price is null or down_payment_amount is null or financed_principal_amount is null or abs(round(asset_price - down_payment_amount - financed_principal_amount, 2)) <= 0.01)
);

create index if not exists idx_debt_financing_contracts_household
  on public.debt_financing_contracts(household_id, updated_at desc);

alter table public.debt_financing_contracts enable row level security;
revoke all privileges on table public.debt_financing_contracts from public, anon, authenticated, service_role;
grant select on table public.debt_financing_contracts to authenticated;

drop policy if exists debt_financing_contracts_select_member on public.debt_financing_contracts;
create policy debt_financing_contracts_select_member
  on public.debt_financing_contracts
  for select to authenticated
  using (exists (
    select 1 from public.household_members as hm
     where hm.household_id = debt_financing_contracts.household_id
       and hm.user_id = (select auth.uid())
  ));

comment on table public.debt_financing_contracts is
  'Generic structure-driven debt terms. When present, these terms are the contract-enabled SSOT; legacy debts columns remain compatibility mirrors.';
comment on column public.debt_financing_contracts.contract_authority is
  'Evidence authority, independent from schedule_source and mathematical reconciliation.';

-- ============================================================
-- 3. REFINANCING / DEBT-PURCHASE LINEAGE
-- ============================================================

create table if not exists public.debt_refinancing_links (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  source_debt_id uuid not null,
  target_debt_id uuid not null,
  source_refinance_event_id uuid not null,
  effective_date date not null,
  settled_principal_amount numeric not null,
  amount_paid_by_new_creditor numeric not null,
  cash_contribution_amount numeric not null default 0,
  target_financed_principal_amount numeric not null,
  contribution_movement_id text null,
  refinance_costs_amount numeric not null default 0,
  refinance_costs_movement_id text null,
  status text not null default 'active',
  reversal_event_id uuid null,
  notes text not null default '',
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint debt_refinancing_links_household_fkey
    foreign key (household_id) references public.households(id) on delete cascade,
  constraint debt_refinancing_links_source_debt_fkey
    foreign key (source_debt_id, household_id) references public.debts(id, household_id) on delete restrict,
  constraint debt_refinancing_links_target_debt_fkey
    foreign key (target_debt_id, household_id) references public.debts(id, household_id) on delete restrict,
  constraint debt_refinancing_links_source_event_fkey
    foreign key (source_refinance_event_id, source_debt_id, household_id) references public.debt_events(id, debt_id, household_id) on delete restrict,
  constraint debt_refinancing_links_contribution_movement_fkey
    foreign key (contribution_movement_id, household_id) references public.movements(id, household_id) on delete restrict,
  constraint debt_refinancing_links_refinance_costs_movement_fkey
    foreign key (refinance_costs_movement_id, household_id) references public.movements(id, household_id) on delete restrict,
  constraint debt_refinancing_links_reversal_event_fkey
    foreign key (reversal_event_id, source_debt_id, household_id) references public.debt_events(id, debt_id, household_id) on delete restrict,
  constraint debt_refinancing_links_user_fkey
    foreign key (created_by_user_id) references auth.users(id) on delete restrict,
  constraint debt_refinancing_links_distinct_debts_check check (source_debt_id <> target_debt_id),
  constraint debt_refinancing_links_amounts_check check (settled_principal_amount > 0 and amount_paid_by_new_creditor >= 0 and cash_contribution_amount >= 0 and refinance_costs_amount >= 0 and target_financed_principal_amount > 0),
  constraint debt_refinancing_links_status_check check (status in ('active', 'reversed'))
);

create unique index if not exists debt_refinancing_links_active_source_key
  on public.debt_refinancing_links(source_debt_id)
  where status = 'active';
create unique index if not exists debt_refinancing_links_source_event_key
  on public.debt_refinancing_links(source_refinance_event_id);
create index if not exists idx_debt_refinancing_links_target
  on public.debt_refinancing_links(target_debt_id, status);

alter table public.debt_refinancing_links enable row level security;
revoke all privileges on table public.debt_refinancing_links from public, anon, authenticated, service_role;
grant select on table public.debt_refinancing_links to authenticated;

drop policy if exists debt_refinancing_links_select_member on public.debt_refinancing_links;
create policy debt_refinancing_links_select_member
  on public.debt_refinancing_links
  for select to authenticated
  using (exists (
    select 1 from public.household_members as hm
     where hm.household_id = debt_refinancing_links.household_id
       and hm.user_id = (select auth.uid())
  ));

-- ============================================================
-- 4. GENERIC CONTRACT / DOCUMENT METADATA RPCs
-- ============================================================

create or replace function public.upsert_debt_financing_contract_v1(
  p_household_id uuid,
  p_debt_id uuid,
  p_contract jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_debt public.debts%rowtype;
  v_row record;
  v_result public.debt_financing_contracts%rowtype;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select d.* into v_debt
    from public.debts as d
   where d.id = p_debt_id and d.household_id = p_household_id
   for update;
  if not found then raise exception 'DEBT_NOT_FOUND'; end if;
  if not exists (select 1 from public.household_members as hm where hm.household_id = p_household_id and hm.user_id = v_user_id) then
    raise exception 'HOUSEHOLD_ACCESS_DENIED';
  end if;
  if p_contract is null or pg_catalog.jsonb_typeof(p_contract) <> 'object' then raise exception 'INVALID_DEBT_INPUT'; end if;

  select x.* into v_row
    from pg_catalog.jsonb_to_record(p_contract) as x(
      contract_authority text,
      principal_basis text,
      asset_price numeric,
      down_payment_amount numeric,
      scheduled_principal_amount numeric,
      financed_principal_amount numeric,
      opening_principal_amount numeric,
      repayment_structure text,
      amortization_method text,
      installment_amount_mode text,
      payment_frequency text,
      custom_frequency_days integer,
      first_due_date date,
      interest_rate_type text,
      interest_rate_percent numeric,
      interest_rate_basis text,
      day_count_basis text,
      fee_rule_type text,
      fee_rule jsonb,
      prepayment_terms jsonb,
      authority_notes text
    );

  if coalesce(v_row.contract_authority, 'unknown') not in ('contractual', 'official_noncontractual', 'user_reported', 'estimated', 'unknown')
     or coalesce(v_row.principal_basis, 'unknown') not in ('asset_price_including_down_payment', 'financed_principal_only', 'reported_balance', 'unknown')
     or coalesce(v_row.repayment_structure, v_debt.repayment_structure, 'unknown') not in ('fixed_schedule', 'open_ended', 'unknown')
     or coalesce(v_row.amortization_method, 'unknown') not in ('fixed_installment', 'constant_principal', 'increasing_installment', 'decreasing_installment', 'irregular_contract', 'custom', 'unknown')
     or coalesce(v_row.installment_amount_mode, v_debt.installment_amount_mode, 'unknown') not in ('fixed', 'variable', 'unknown')
     or v_row.interest_rate_type is not null and v_row.interest_rate_type not in ('nominal_annual_simple', 'effective_annual', 'effective_periodic', 'contract_schedule', 'manual', 'unknown')
     or coalesce(v_row.day_count_basis, 'unknown') not in ('actual_days_360', 'actual_days_365', 'unknown')
     or coalesce(v_row.fee_rule_type, 'unknown') not in ('fixed', 'percentage', 'formula_known', 'contract_schedule_only', 'unknown')
     or (v_row.asset_price is not null and v_row.asset_price < 0)
     or (v_row.down_payment_amount is not null and v_row.down_payment_amount < 0)
     or (v_row.financed_principal_amount is not null and v_row.financed_principal_amount < 0)
     or (v_row.interest_rate_percent is not null and v_row.interest_rate_percent < 0)
     or (v_row.asset_price is not null and v_row.down_payment_amount is not null and v_row.financed_principal_amount is not null and abs(round(v_row.asset_price - v_row.down_payment_amount - v_row.financed_principal_amount, 2)) > 0.01) then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  insert into public.debt_financing_contracts (
    debt_id, household_id, contract_authority, principal_basis, asset_price,
    down_payment_amount, scheduled_principal_amount, financed_principal_amount,
    opening_principal_amount, repayment_structure, amortization_method,
    installment_amount_mode, payment_frequency, custom_frequency_days,
    first_due_date, interest_rate_type, interest_rate_percent, interest_rate_basis,
    day_count_basis, fee_rule_type, fee_rule, prepayment_terms, authority_notes,
    created_by_user_id, updated_at
  ) values (
    p_debt_id, p_household_id, coalesce(v_row.contract_authority, 'unknown'),
    coalesce(v_row.principal_basis, 'unknown'), v_row.asset_price,
    v_row.down_payment_amount, v_row.scheduled_principal_amount,
    v_row.financed_principal_amount, v_row.opening_principal_amount,
    coalesce(v_row.repayment_structure, v_debt.repayment_structure, 'unknown'),
    coalesce(v_row.amortization_method, 'unknown'),
    coalesce(v_row.installment_amount_mode, v_debt.installment_amount_mode, 'unknown'),
    v_row.payment_frequency, v_row.custom_frequency_days, v_row.first_due_date,
    coalesce(v_row.interest_rate_type, 'unknown'), v_row.interest_rate_percent,
    v_row.interest_rate_basis, coalesce(v_row.day_count_basis, 'unknown'),
    coalesce(v_row.fee_rule_type, 'unknown'), coalesce(v_row.fee_rule, '{}'::jsonb),
    coalesce(v_row.prepayment_terms, '{}'::jsonb), coalesce(v_row.authority_notes, ''),
    v_user_id, now()
  )
  on conflict (debt_id) do update set
    household_id = excluded.household_id,
    contract_authority = excluded.contract_authority,
    principal_basis = excluded.principal_basis,
    asset_price = excluded.asset_price,
    down_payment_amount = excluded.down_payment_amount,
    scheduled_principal_amount = excluded.scheduled_principal_amount,
    financed_principal_amount = excluded.financed_principal_amount,
    opening_principal_amount = excluded.opening_principal_amount,
    repayment_structure = excluded.repayment_structure,
    amortization_method = excluded.amortization_method,
    installment_amount_mode = excluded.installment_amount_mode,
    payment_frequency = excluded.payment_frequency,
    custom_frequency_days = excluded.custom_frequency_days,
    first_due_date = excluded.first_due_date,
    interest_rate_type = excluded.interest_rate_type,
    interest_rate_percent = excluded.interest_rate_percent,
    interest_rate_basis = excluded.interest_rate_basis,
    day_count_basis = excluded.day_count_basis,
    fee_rule_type = excluded.fee_rule_type,
    fee_rule = excluded.fee_rule,
    prepayment_terms = excluded.prepayment_terms,
    authority_notes = excluded.authority_notes,
    updated_at = now(),
    created_by_user_id = excluded.created_by_user_id
  returning * into v_result;
  return pg_catalog.to_jsonb(v_result);
end;
$function$;

revoke all privileges on function public.upsert_debt_financing_contract_v1(uuid, uuid, jsonb) from public, anon, service_role;
grant execute on function public.upsert_debt_financing_contract_v1(uuid, uuid, jsonb) to authenticated;

create or replace function public.create_debt_document_import_job_v2(
  p_household_id uuid,
  p_debt_id uuid,
  p_document_kind text,
  p_document_authority text,
  p_provider text,
  p_model text,
  p_file_count integer,
  p_storage_paths text[],
  p_normalized_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_row public.bank_document_import_jobs%rowtype;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from public.household_members as hm where hm.household_id = p_household_id and hm.user_id = v_user_id) then raise exception 'HOUSEHOLD_ACCESS_DENIED'; end if;
  if p_debt_id is not null and not exists (select 1 from public.debts as d where d.id = p_debt_id and d.household_id = p_household_id) then raise exception 'DEBT_NOT_FOUND'; end if;
  if p_document_kind not in ('contract', 'schedule', 'refinance', 'statement', 'other')
     or p_document_authority not in ('contractual', 'official_noncontractual', 'user_reported', 'estimated', 'unknown')
     or p_file_count is null or p_file_count < 0
     or coalesce(p_normalized_metadata, '{}'::jsonb) ? 'raw_document' then
    raise exception 'INVALID_DEBT_INPUT';
  end if;
  insert into public.bank_document_import_jobs (
    household_id, created_by_user_id, status, provider, model, file_count,
    storage_paths, document_schema, document_kind, document_authority,
    normalized_metadata
  ) values (
    p_household_id, v_user_id, 'created', p_provider, p_model, p_file_count,
    coalesce(p_storage_paths, '{}'::text[]), 'CAJA_FAMILIAR_DEBT_DOCUMENT_V2',
    p_document_kind, p_document_authority, coalesce(p_normalized_metadata, '{}'::jsonb)
  ) returning * into v_row;
  return pg_catalog.to_jsonb(v_row);
end;
$function$;

revoke all privileges on function public.create_debt_document_import_job_v2(uuid, uuid, text, text, text, text, integer, text[], jsonb) from public, anon, service_role;
grant execute on function public.create_debt_document_import_job_v2(uuid, uuid, text, text, text, text, integer, text[], jsonb) to authenticated;

create or replace function private.debt2b2_apply_universal_schedule_metadata(
  p_schedule_version_id uuid,
  p_debt_id uuid,
  p_household_id uuid,
  p_schedule_installments jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_elem jsonb;
  v_row_role text;
begin
  if p_schedule_installments is null or pg_catalog.jsonb_typeof(p_schedule_installments) <> 'array' then return; end if;
  for v_elem in select value from pg_catalog.jsonb_array_elements(p_schedule_installments) loop
    v_row_role := coalesce(v_elem->>'row_role', 'installment');
    if v_row_role not in ('down_payment', 'installment', 'summary', 'unknown') then
      raise exception 'INVALID_DEBT_SCHEDULE';
    end if;
    update public.debt_installments
       set expected_taxes = case when v_elem ? 'expected_taxes' and v_elem->'expected_taxes' <> 'null'::jsonb then (v_elem->>'expected_taxes')::numeric else null end,
           row_role = v_row_role,
           phase = nullif(v_elem->>'phase', ''),
           evidence = case when v_elem ? 'evidence' and pg_catalog.jsonb_typeof(v_elem->'evidence') = 'object' then v_elem->'evidence' else '{}'::jsonb end
     where schedule_version_id = p_schedule_version_id
       and debt_id = p_debt_id
       and household_id = p_household_id
       and installment_number = (v_elem->>'installment_number')::integer;
  end loop;
end;
$function$;

-- ============================================================
-- 5. ATOMIC REFINANCE / DEBT PURCHASE RPC
-- ============================================================

create or replace function public.refinance_debt_v1(
  p_household_id uuid,
  p_link_id uuid,
  p_source_debt_id uuid,
  p_source_refinance_event_id uuid,
  p_target_debt_id uuid,
  p_effective_date date,
  p_target_name text,
  p_target_creditor_name text,
  p_target_debt_kind text,
  p_currency_code text,
  p_target_original_principal numeric,
  p_target_opening_principal numeric,
  p_target_planned_installment_count integer,
  p_target_planned_installment_amount numeric,
  p_target_installment_amount_mode text,
  p_target_payment_frequency text,
  p_target_custom_frequency_days integer,
  p_target_first_due_date date,
  p_target_tea_percent numeric,
  p_target_tcea_percent numeric,
  p_target_notes text,
  p_amount_paid_by_new_creditor numeric,
  p_cash_contribution_amount numeric,
  p_target_financed_principal_amount numeric,
  p_target_installments jsonb,
  p_target_schedule_source text,
  p_target_contract jsonb,
  p_contribution_movement_id text,
  p_contribution_account_id uuid,
  p_contribution_description text,
  p_contribution_category text,
  p_refinance_costs_amount numeric,
  p_refinance_costs_movement_id text,
  p_refinance_costs_account_id uuid,
  p_refinance_costs_description text,
  p_refinance_costs_category text,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_person text;
  v_source public.debts%rowtype;
  v_target public.debts%rowtype;
  v_existing_link public.debt_refinancing_links%rowtype;
  v_source_event public.debt_events%rowtype;
  v_link public.debt_refinancing_links%rowtype;
  v_target_result jsonb;
  v_target_schedule public.debt_schedule_versions%rowtype;
  v_contribution public.movements%rowtype;
  v_refinance_costs public.movements%rowtype;
  v_settled_principal numeric;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select hm.display_name into v_person from public.household_members as hm where hm.household_id = p_household_id and hm.user_id = v_user_id;
  if not found or v_person is null or pg_catalog.btrim(v_person) = '' then raise exception 'HOUSEHOLD_ACCESS_DENIED'; end if;
  if p_link_id is null or p_source_debt_id is null or p_source_refinance_event_id is null or p_target_debt_id is null or p_effective_date is null
     or p_source_debt_id = p_target_debt_id
      or p_amount_paid_by_new_creditor is null or p_amount_paid_by_new_creditor < 0
      or p_cash_contribution_amount is null or p_cash_contribution_amount < 0
      or p_refinance_costs_amount is null or p_refinance_costs_amount < 0
      or p_target_financed_principal_amount is null or p_target_financed_principal_amount <= 0
     or p_target_installments is null or pg_catalog.jsonb_typeof(p_target_installments) <> 'array'
     or (p_target_schedule_source is not null and p_target_schedule_source not in ('contractual', 'reconstructed', 'estimated', 'manual')) then
    raise exception 'INVALID_DEBT_INPUT';
  end if;

  select l.* into v_existing_link from public.debt_refinancing_links as l where l.id = p_link_id and l.household_id = p_household_id for update;
  if found then
    return pg_catalog.jsonb_build_object('success', true, 'idempotentReplay', true, 'refinancing', pg_catalog.to_jsonb(v_existing_link));
  end if;

  select d.* into v_source from public.debts as d where d.id = p_source_debt_id and d.household_id = p_household_id for update;
  if not found then raise exception 'DEBT_NOT_FOUND'; end if;
  if v_source.is_archived or v_source.status <> 'active' then raise exception 'DEBT_NOT_ACTIVE'; end if;
  if exists (select 1 from public.debt_refinancing_links as l where l.source_debt_id = p_source_debt_id and l.household_id = p_household_id and l.status = 'active') then raise exception 'DEBT_REFINANCE_ALREADY_LINKED'; end if;

  v_settled_principal := private.debt2b2_current_principal(p_household_id, p_source_debt_id);
  if v_settled_principal is null or v_settled_principal <= 0 then raise exception 'DEBT_ALREADY_PAID_OFF'; end if;
  if round(coalesce(p_amount_paid_by_new_creditor, 0) + coalesce(p_cash_contribution_amount, 0), 2) <> round(v_settled_principal, 2) then
    raise exception 'DEBT_REFINANCE_SETTLEMENT_MISMATCH';
  end if;
  if p_cash_contribution_amount > 0 and (p_contribution_movement_id is null or p_contribution_account_id is null) then raise exception 'DEBT_MOVEMENT_ACCOUNT_REQUIRED'; end if;
  if p_cash_contribution_amount = 0 and p_contribution_movement_id is not null then raise exception 'INVALID_DEBT_INPUT'; end if;
  if p_refinance_costs_amount > 0 and (p_refinance_costs_movement_id is null or p_refinance_costs_account_id is null) then raise exception 'DEBT_MOVEMENT_ACCOUNT_REQUIRED'; end if;
  if p_refinance_costs_amount = 0 and p_refinance_costs_movement_id is not null then raise exception 'INVALID_DEBT_INPUT'; end if;
  if p_cash_contribution_amount > 0 and p_refinance_costs_amount > 0 and p_contribution_movement_id = p_refinance_costs_movement_id then raise exception 'INVALID_DEBT_INPUT'; end if;

  if exists (select 1 from public.debts as d where d.id = p_target_debt_id) then raise exception 'DEBT_ALREADY_EXISTS'; end if;

  v_target_result := public.create_debt_v2(
    p_household_id, p_target_debt_id, pg_catalog.btrim(p_target_name), pg_catalog.btrim(p_target_creditor_name),
    p_target_debt_kind, p_currency_code, p_effective_date, p_effective_date,
    coalesce(p_target_original_principal, p_target_financed_principal_amount), p_target_opening_principal,
    p_target_planned_installment_count, p_target_planned_installment_amount, p_target_installment_amount_mode,
    p_target_payment_frequency, p_target_custom_frequency_days, p_target_first_due_date, p_target_tea_percent,
    p_target_tcea_percent, coalesce(p_target_notes, ''), p_target_installments, '[]'::jsonb,
    coalesce(p_target_contract->>'repayment_structure', 'fixed_schedule'),
    coalesce(p_target_contract->>'interest_calculation_mode', 'unknown'),
    case when p_target_contract ? 'periodic_rate_percent' then (p_target_contract->>'periodic_rate_percent')::numeric else null end,
    p_target_contract->>'periodic_rate_basis', null
  );

  select d.* into v_target from public.debts as d where d.id = p_target_debt_id and d.household_id = p_household_id for update;
  if p_target_installments <> '[]'::jsonb then
    select s.* into v_target_schedule from public.debt_schedule_versions as s where s.debt_id = p_target_debt_id and s.household_id = p_household_id order by s.version_number desc limit 1 for update;
    if v_target_schedule.id is not null and p_target_schedule_source is not null then
      update public.debt_schedule_versions
         set schedule_source = p_target_schedule_source,
             is_authoritative = (p_target_schedule_source = 'contractual'),
             authority = case when p_target_schedule_source = 'contractual' then 'contractual' when p_target_schedule_source = 'estimated' then 'estimated' when p_target_schedule_source = 'reconstructed' then 'official_noncontractual' else 'user_reported' end
       where id = v_target_schedule.id;
    end if;
    if v_target_schedule.id is not null then
      perform private.debt2b2_apply_universal_schedule_metadata(v_target_schedule.id, p_target_debt_id, p_household_id, p_target_installments);
    end if;
  elsif p_target_schedule_source is not null then
    raise exception 'INVALID_DEBT_SCHEDULE';
  end if;

  if p_target_contract is not null then
    perform public.upsert_debt_financing_contract_v1(p_household_id, p_target_debt_id, p_target_contract);
  end if;

  if p_cash_contribution_amount > 0 then
    v_contribution := private.debt2b2_prepare_movement(
      p_household_id, p_contribution_movement_id, p_effective_date, p_cash_contribution_amount,
      p_contribution_account_id, coalesce(nullif(pg_catalog.btrim(p_contribution_description), ''), 'Aporte propio para refinanciación'),
      coalesce(nullif(pg_catalog.btrim(p_contribution_category), ''), 'Pago de deuda'), v_user_id, v_person
    );
  end if;

  if p_refinance_costs_amount > 0 then
    v_refinance_costs := private.debt2b2_prepare_movement(
      p_household_id, p_refinance_costs_movement_id, p_effective_date, p_refinance_costs_amount,
      p_refinance_costs_account_id, coalesce(nullif(pg_catalog.btrim(p_refinance_costs_description), ''), 'Costos de cierre de refinanciación'),
      coalesce(nullif(pg_catalog.btrim(p_refinance_costs_category), ''), 'Costo financiero'), v_user_id, v_person
    );
  end if;

  select e.* into v_source_event from public.debt_events as e where e.id = p_source_refinance_event_id for update;
  if found then raise exception 'DEBT_EVENT_ID_CONFLICT'; end if;
  insert into public.debt_events (
    id, debt_id, household_id, event_date, event_type, cash_amount, principal_delta,
    interest_paid, fees_paid, insurance_paid, other_cost_paid, breakdown_complete,
    movement_id, reversal_of_event_id, description, registered_by_user_id
  ) values (
    p_source_refinance_event_id, p_source_debt_id, p_household_id, p_effective_date, 'refinance',
    0, -v_settled_principal, 0, 0, 0, 0, false, null, null,
    coalesce(nullif(pg_catalog.btrim(p_notes), ''), 'Refinanciación / compra de deuda'), v_user_id
  ) returning * into v_source_event;

  update public.debts set status = 'refinanced', updated_at = now() where id = p_source_debt_id and household_id = p_household_id;

  insert into public.debt_refinancing_links (
    id, household_id, source_debt_id, target_debt_id, source_refinance_event_id,
    effective_date, settled_principal_amount, amount_paid_by_new_creditor,
    cash_contribution_amount, target_financed_principal_amount, contribution_movement_id,
    refinance_costs_amount, refinance_costs_movement_id,
    status, notes, created_by_user_id
  ) values (
    p_link_id, p_household_id, p_source_debt_id, p_target_debt_id, p_source_refinance_event_id,
    p_effective_date, v_settled_principal, p_amount_paid_by_new_creditor,
    p_cash_contribution_amount, p_target_financed_principal_amount,
    nullif(pg_catalog.btrim(p_contribution_movement_id), ''), p_refinance_costs_amount,
    nullif(pg_catalog.btrim(p_refinance_costs_movement_id), ''), 'active', coalesce(p_notes, ''), v_user_id
  ) returning * into v_link;

  return pg_catalog.jsonb_build_object(
    'success', true, 'idempotentReplay', false, 'refinancing', pg_catalog.to_jsonb(v_link),
    'sourceDebt', (select pg_catalog.to_jsonb(d) from public.debts as d where d.id = p_source_debt_id and d.household_id = p_household_id),
    'targetDebt', (select pg_catalog.to_jsonb(d) from public.debts as d where d.id = p_target_debt_id and d.household_id = p_household_id),
    'contributionMovement', case when v_contribution.id is null then null else pg_catalog.to_jsonb(v_contribution) end,
    'refinanceCostsMovement', case when v_refinance_costs.id is null then null else pg_catalog.to_jsonb(v_refinance_costs) end
  );
end;
$function$;

revoke all privileges on function public.refinance_debt_v1(uuid, uuid, uuid, uuid, uuid, date, text, text, text, text, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, numeric, numeric, numeric, jsonb, text, jsonb, text, uuid, text, text, numeric, text, uuid, text, text, text) from public, anon, service_role;
grant execute on function public.refinance_debt_v1(uuid, uuid, uuid, uuid, uuid, date, text, text, text, text, numeric, numeric, integer, numeric, text, text, integer, date, numeric, numeric, text, numeric, numeric, numeric, jsonb, text, jsonb, text, uuid, text, text, numeric, text, uuid, text, text, text) to authenticated;

-- Reversal is intentionally conservative: a target with any effective event
-- or a household contribution movement cannot be reversed automatically.
create or replace function public.reverse_debt_refinancing_v1(
  p_household_id uuid,
  p_link_id uuid,
  p_reversal_event_id uuid,
  p_reversal_date date,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_link public.debt_refinancing_links%rowtype;
  v_source public.debts%rowtype;
  v_target public.debts%rowtype;
  v_existing public.debt_events%rowtype;
  v_reversal public.debt_events%rowtype;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from public.household_members as hm where hm.household_id = p_household_id and hm.user_id = v_user_id) then raise exception 'HOUSEHOLD_ACCESS_DENIED'; end if;
  if p_link_id is null or p_reversal_event_id is null or p_reversal_date is null then raise exception 'INVALID_DEBT_REVERSAL'; end if;
  select l.* into v_link from public.debt_refinancing_links as l where l.id = p_link_id and l.household_id = p_household_id for update;
  if not found then raise exception 'DEBT_REFINANCE_NOT_FOUND'; end if;
  if v_link.status = 'reversed' then return pg_catalog.jsonb_build_object('success', true, 'idempotentReplay', true, 'refinancing', pg_catalog.to_jsonb(v_link)); end if;

  select d.* into v_source from public.debts as d where d.id = v_link.source_debt_id and d.household_id = p_household_id for update;
  select d.* into v_target from public.debts as d where d.id = v_link.target_debt_id and d.household_id = p_household_id for update;
  if exists (select 1 from public.debt_refinancing_links as l where l.target_debt_id = v_link.target_debt_id and l.household_id = p_household_id and l.status = 'active' and l.id <> v_link.id)
     or exists (
       select 1 from public.debt_events as e
        where e.debt_id = v_link.target_debt_id and e.household_id = p_household_id
          and e.event_type <> 'reversal'
          and not exists (select 1 from public.debt_events as r where r.debt_id = e.debt_id and r.household_id = e.household_id and r.event_type = 'reversal' and r.reversal_of_event_id = e.id)
     )
      or v_link.contribution_movement_id is not null
      or v_link.refinance_costs_movement_id is not null then
    raise exception 'DEBT_REFINANCE_REVERSAL_HAS_DEPENDENCIES';
  end if;

  select e.* into v_existing from public.debt_events as e where e.id = p_reversal_event_id for update;
  if found then
    if v_existing.debt_id is distinct from v_link.source_debt_id or v_existing.household_id is distinct from p_household_id or v_existing.reversal_of_event_id is distinct from v_link.source_refinance_event_id then raise exception 'DEBT_EVENT_ID_CONFLICT'; end if;
    return pg_catalog.jsonb_build_object('success', true, 'idempotentReplay', true, 'event', pg_catalog.to_jsonb(v_existing));
  end if;

  insert into public.debt_events (
    id, debt_id, household_id, event_date, event_type, cash_amount, principal_delta,
    interest_paid, fees_paid, insurance_paid, other_cost_paid, breakdown_complete,
    movement_id, reversal_of_event_id, description, registered_by_user_id
  ) values (
    p_reversal_event_id, v_link.source_debt_id, p_household_id, p_reversal_date, 'reversal',
    0, 0, 0, 0, 0, 0, false, null, v_link.source_refinance_event_id,
    coalesce(nullif(pg_catalog.btrim(p_description), ''), 'Reversión de refinanciación'), v_user_id
  ) returning * into v_reversal;
  update public.debts set status = 'active', updated_at = now() where id = v_link.source_debt_id and household_id = p_household_id;
  update public.debts set status = 'refinanced', is_archived = true, updated_at = now() where id = v_link.target_debt_id and household_id = p_household_id;
  update public.debt_refinancing_links set status = 'reversed', reversal_event_id = p_reversal_event_id where id = v_link.id;
  return pg_catalog.jsonb_build_object('success', true, 'idempotentReplay', false, 'event', pg_catalog.to_jsonb(v_reversal));
end;
$function$;

revoke all privileges on function public.reverse_debt_refinancing_v1(uuid, uuid, uuid, date, text) from public, anon, service_role;
grant execute on function public.reverse_debt_refinancing_v1(uuid, uuid, uuid, date, text) to authenticated;

-- ============================================================
-- 6. STRUCTURE-DRIVEN OPERATION ENTRY POINTS
-- ============================================================

create or replace function public.record_debt_payment_universal_v1(
  p_household_id uuid, p_debt_id uuid, p_event_id uuid, p_movement_id text,
  p_event_date date, p_cash_amount numeric, p_account_id uuid, p_description text,
  p_category text, p_principal_amount numeric, p_interest_paid numeric,
  p_fees_paid numeric, p_insurance_paid numeric, p_other_cost_paid numeric,
  p_extra_principal_amount numeric, p_prepayment_effect text, p_breakdown_complete boolean,
  p_allocations jsonb, p_schedule_installments jsonb, p_schedule_notes text,
  p_schedule_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_debt public.debts%rowtype;
  v_result jsonb;
  v_count integer;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select d.* into v_debt from public.debts as d where d.id = p_debt_id and d.household_id = p_household_id for update;
  if not found then raise exception 'DEBT_NOT_FOUND'; end if;
  if v_debt.debt_kind = 'bank_loan' then
    return public.record_debt_payment_v3(p_household_id, p_debt_id, p_event_id, p_movement_id, p_event_date, p_cash_amount, p_account_id, p_description, p_category, p_principal_amount, p_interest_paid, p_fees_paid, p_insurance_paid, p_other_cost_paid, p_extra_principal_amount, p_prepayment_effect, p_breakdown_complete, p_allocations, p_schedule_installments, p_schedule_notes, p_schedule_source);
  end if;
  v_count := case when p_schedule_installments is null or pg_catalog.jsonb_typeof(p_schedule_installments) <> 'array' then -1 else pg_catalog.jsonb_array_length(p_schedule_installments) end;
  if v_count < 0 or (v_count > 0 and p_schedule_source not in ('contractual', 'reconstructed', 'estimated')) then raise exception 'INVALID_DEBT_PAYMENT'; end if;
  if (v_count > 0 or coalesce(p_extra_principal_amount, 0) > 0) and v_debt.repayment_structure not in ('fixed_schedule', 'open_ended') then raise exception 'DEBT_REPAYMENT_STRUCTURE_UNSUPPORTED'; end if;
  v_result := public.record_debt_payment_v2(p_household_id, p_debt_id, p_event_id, p_movement_id, p_event_date, p_cash_amount, p_account_id, p_description, p_category, p_principal_amount, p_interest_paid, p_fees_paid, p_insurance_paid, p_other_cost_paid, p_extra_principal_amount, p_prepayment_effect, p_breakdown_complete, p_allocations);
  if coalesce((v_result->>'idempotentReplay')::boolean, false) then return v_result; end if;
  if v_count > 0 then
    perform private.debt2b2_validate_schedule_v3(p_event_date, 'prepayment', p_schedule_installments);
    perform private.debt2b2_validate_schedule_principal_v1(p_household_id, p_debt_id, p_schedule_installments);
    perform private.debt2b2_create_schedule_lifecycle_v1(
      p_household_id, p_debt_id, p_event_id, p_event_date, 'prepayment', p_schedule_notes,
      p_schedule_installments, v_user_id, p_schedule_source, p_schedule_source = 'contractual', true
    );
    perform private.debt2b2_apply_universal_schedule_metadata(
      (select id from public.debt_schedule_versions where trigger_event_id = p_event_id and debt_id = p_debt_id and household_id = p_household_id order by version_number desc limit 1),
      p_debt_id, p_household_id, p_schedule_installments
    );
    update public.debt_schedule_versions
       set authority = case when p_schedule_source = 'contractual' then 'contractual' when p_schedule_source = 'estimated' then 'estimated' when p_schedule_source = 'reconstructed' then 'official_noncontractual' else 'user_reported' end
     where trigger_event_id = p_event_id and debt_id = p_debt_id and household_id = p_household_id;
    return private.debt2b2_fund_result(p_event_id, false);
  end if;
  return v_result;
end;
$function$;

revoke all privileges on function public.record_debt_payment_universal_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, boolean, jsonb, jsonb, text, text) from public, anon, service_role;
grant execute on function public.record_debt_payment_universal_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, boolean, jsonb, jsonb, text, text) to authenticated;

create or replace function public.record_debt_prepayment_universal_v1(
  p_household_id uuid, p_debt_id uuid, p_event_id uuid, p_movement_id text,
  p_event_date date, p_cash_amount numeric, p_account_id uuid, p_description text,
  p_category text, p_principal_amount numeric, p_interest_paid numeric,
  p_fees_paid numeric, p_insurance_paid numeric, p_other_cost_paid numeric,
  p_prepayment_effect text, p_breakdown_complete boolean,
  p_schedule_installments jsonb, p_schedule_notes text, p_schedule_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_debt public.debts%rowtype;
begin
  select d.* into v_debt from public.debts as d where d.id = p_debt_id and d.household_id = p_household_id for update;
  if not found then raise exception 'DEBT_NOT_FOUND'; end if;
  if v_debt.debt_kind = 'bank_loan' then
    return public.record_debt_prepayment_v3(p_household_id, p_debt_id, p_event_id, p_movement_id, p_event_date, p_cash_amount, p_account_id, p_description, p_category, p_principal_amount, p_interest_paid, p_fees_paid, p_insurance_paid, p_other_cost_paid, p_prepayment_effect, p_breakdown_complete, p_schedule_installments, p_schedule_notes, p_schedule_source);
  end if;
  if v_debt.repayment_structure <> 'fixed_schedule' then raise exception 'DEBT_REPAYMENT_STRUCTURE_UNSUPPORTED'; end if;
  return public.record_debt_prepayment_v3(p_household_id, p_debt_id, p_event_id, p_movement_id, p_event_date, p_cash_amount, p_account_id, p_description, p_category, p_principal_amount, p_interest_paid, p_fees_paid, p_insurance_paid, p_other_cost_paid, p_prepayment_effect, p_breakdown_complete, p_schedule_installments, p_schedule_notes, p_schedule_source);
end;
$function$;

revoke all privileges on function public.record_debt_prepayment_universal_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, text, boolean, jsonb, text, text) from public, anon, service_role;
grant execute on function public.record_debt_prepayment_universal_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, text, boolean, jsonb, text, text) to authenticated;

create or replace function public.record_debt_installment_advance_universal_v1(
  p_household_id uuid, p_debt_id uuid, p_event_id uuid, p_movement_id text,
  p_event_date date, p_cash_amount numeric, p_account_id uuid, p_description text,
  p_category text, p_principal_amount numeric, p_interest_paid numeric,
  p_fees_paid numeric, p_insurance_paid numeric, p_other_cost_paid numeric,
  p_breakdown_complete boolean, p_allocations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  return public.record_debt_installment_advance_v1(p_household_id, p_debt_id, p_event_id, p_movement_id, p_event_date, p_cash_amount, p_account_id, p_description, p_category, p_principal_amount, p_interest_paid, p_fees_paid, p_insurance_paid, p_other_cost_paid, p_breakdown_complete, p_allocations);
end;
$function$;

revoke all privileges on function public.record_debt_installment_advance_universal_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, boolean, jsonb) from public, anon, service_role;
grant execute on function public.record_debt_installment_advance_universal_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, boolean, jsonb) to authenticated;

comment on function public.record_debt_payment_universal_v1(uuid, uuid, uuid, text, date, numeric, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, boolean, jsonb, jsonb, text, text) is
  'Structure-driven payment entry point. Bank debts delegate to the existing BANK V3 gate; non-bank fixed/open-ended debt uses the same atomic ledger with universal schedule provenance.';
