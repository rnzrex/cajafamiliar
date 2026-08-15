drop policy if exists "movements_insert_member" on public.movements;

create policy "movements_insert_member"
  on public.movements
  for insert
  to authenticated
  with check (
    registered_by_user_id = (select auth.uid())
    and exists (
      select 1
      from public.household_members as hm
      where hm.household_id = movements.household_id
        and hm.user_id = (select auth.uid())
        and hm.display_name is not null
        and btrim(hm.display_name) <> ''
        and hm.display_name = movements.person
    )
  );

revoke update on table public.movements from authenticated;

grant update (type, date, amount, description, method, category)
  on table public.movements
  to authenticated;
