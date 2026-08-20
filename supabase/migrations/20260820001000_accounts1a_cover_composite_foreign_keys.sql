create index if not exists idx_movements_account_household
  on public.movements(account_id, household_id);

create index if not exists idx_cash_counts_account_household
  on public.cash_counts(account_id, household_id);

drop index if exists public.idx_movements_account_id;
drop index if exists public.idx_cash_counts_account_id;