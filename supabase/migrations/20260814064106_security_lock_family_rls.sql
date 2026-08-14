drop policy if exists "public read households" on public.households;
drop policy if exists "public write households" on public.households;
drop policy if exists "public update households" on public.households;
drop policy if exists "public read settings" on public.settings;
drop policy if exists "public write settings" on public.settings;
drop policy if exists "public update settings" on public.settings;
drop policy if exists "public read categories" on public.categories;
drop policy if exists "public write categories" on public.categories;
drop policy if exists "public update categories" on public.categories;
drop policy if exists "public delete categories" on public.categories;
drop policy if exists "public read movements" on public.movements;
drop policy if exists "public write movements" on public.movements;
drop policy if exists "public update movements" on public.movements;
drop policy if exists "public delete movements" on public.movements;
drop policy if exists "public read cash_counts" on public.cash_counts;
drop policy if exists "public write cash_counts" on public.cash_counts;
drop policy if exists "public update cash_counts" on public.cash_counts;
drop policy if exists "public delete cash_counts" on public.cash_counts;
drop policy if exists "public read recurring_payments" on public.recurring_payments;
drop policy if exists "public write recurring_payments" on public.recurring_payments;
drop policy if exists "public update recurring_payments" on public.recurring_payments;
drop policy if exists "public delete recurring_payments" on public.recurring_payments;
drop policy if exists "household_members_select_self" on public.household_members;

alter table public.households enable row level security;
alter table public.settings enable row level security;
alter table public.categories enable row level security;
alter table public.movements enable row level security;
alter table public.cash_counts enable row level security;
alter table public.recurring_payments enable row level security;
alter table public.household_members enable row level security;

revoke all privileges on table
  public.households,
  public.settings,
  public.categories,
  public.movements,
  public.cash_counts,
  public.recurring_payments,
  public.household_members
from public, anon, authenticated;

grant select on table public.households to authenticated;
grant select, insert, update on table public.settings to authenticated;
grant select, insert, update, delete on table public.categories to authenticated;
grant select, insert, update, delete on table public.movements to authenticated;
grant select, insert on table public.cash_counts to authenticated;
grant select, insert, update on table public.recurring_payments to authenticated;
grant select on table public.household_members to authenticated;

create policy "household_members_select_self"
  on public.household_members
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "households_select_member"
  on public.households
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = households.id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "settings_select_member"
  on public.settings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = settings.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "settings_insert_member"
  on public.settings
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = settings.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "settings_update_member"
  on public.settings
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = settings.household_id
        and hm.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = settings.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "categories_select_member"
  on public.categories
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = categories.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "categories_insert_member"
  on public.categories
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = categories.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "categories_update_member"
  on public.categories
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = categories.household_id
        and hm.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = categories.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "categories_delete_member"
  on public.categories
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = categories.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "movements_select_member"
  on public.movements
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = movements.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "movements_insert_member"
  on public.movements
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = movements.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "movements_update_member"
  on public.movements
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = movements.household_id
        and hm.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = movements.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "movements_delete_member"
  on public.movements
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = movements.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "cash_counts_select_member"
  on public.cash_counts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = cash_counts.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "cash_counts_insert_member"
  on public.cash_counts
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = cash_counts.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "recurring_payments_select_member"
  on public.recurring_payments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = recurring_payments.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "recurring_payments_insert_member"
  on public.recurring_payments
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = recurring_payments.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "recurring_payments_update_member"
  on public.recurring_payments
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = recurring_payments.household_id
        and hm.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.household_members as hm
      where hm.household_id = recurring_payments.household_id
        and hm.user_id = (select auth.uid())
    )
  );
