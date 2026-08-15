alter table public.household_members
  add column if not exists display_name text;

alter table public.movements
  add column if not exists registered_by_user_id uuid;

alter table public.movements
  add constraint movements_registered_by_user_fk
  foreign key (registered_by_user_id)
  references auth.users(id)
  on delete set null;

create index if not exists idx_movements_registered_by_user
  on public.movements(household_id, registered_by_user_id);
