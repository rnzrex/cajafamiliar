create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index if not exists idx_household_members_user_id on public.household_members(user_id);

alter table public.household_members enable row level security;

revoke all privileges on table public.household_members from public, anon, authenticated;
grant select on table public.household_members to authenticated;

drop policy if exists "household_members_select_self" on public.household_members;
create policy "household_members_select_self"
  on public.household_members
  for select
  to authenticated
  using (user_id = (select auth.uid()));
