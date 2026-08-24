-- DEBT-6B.3 Safe Pristine Debt Permanent Delete
-- Allows permanent deletion ONLY for a debt/card with ZERO financial/domain history.
-- Once any debt_event, credit_card_entry, or credit_card_statement exists, deletion is blocked with DEBT_HAS_HISTORY.

create or replace function public.delete_pristine_debt_v1(
  p_household_id uuid,
  p_debt_id uuid
)
returns pg_catalog.jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_debt public.debts%rowtype;
  v_member public.household_members%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select hm.*
    into v_member
    from public.household_members as hm
   where hm.household_id = p_household_id
     and hm.user_id = v_user_id;

  if not found then
    raise exception 'MEMBER_NOT_PROVISIONED';
  end if;

  select d.*
    into v_debt
    from public.debts as d
   where d.id = p_debt_id
     and d.household_id = p_household_id
   for update;

  if not found then
    raise exception 'DEBT_NOT_FOUND';
  end if;

  -- History Protection Check: block if ANY financial/domain history exists
  if exists (
    select 1
      from public.debt_events as e
     where e.debt_id = p_debt_id
  ) or exists (
    select 1
      from public.credit_card_entries as cce
     where cce.debt_id = p_debt_id
  ) or exists (
    select 1
      from public.credit_card_statements as ccs
     where ccs.debt_id = p_debt_id
  ) then
    raise exception 'DEBT_HAS_HISTORY';
  end if;

  -- Clean up setup-only dependent records
  delete from public.debt_installments
   where schedule_version_id in (
     select id from public.debt_schedule_versions where debt_id = p_debt_id
   );

  delete from public.debt_schedule_versions
   where debt_id = p_debt_id;

  delete from public.debt_collaterals
   where debt_id = p_debt_id;

  delete from public.recurring_payments
   where linked_debt_id = p_debt_id;

  delete from public.credit_card_profiles
   where debt_id = p_debt_id;

  delete from public.debts
   where id = p_debt_id
     and household_id = p_household_id;

  return pg_catalog.jsonb_build_object(
    'success', true,
    'debt_id', p_debt_id::text,
    'deleted', true
  );
end;
$function$;

-- REVOKE ALL EXECUTE from public, anon, service_role
revoke all privileges on function public.delete_pristine_debt_v1(uuid, uuid)
  from public, anon, service_role;

-- GRANT EXECUTE ONLY to authenticated
grant execute on function public.delete_pristine_debt_v1(uuid, uuid)
  to authenticated;

comment on function public.delete_pristine_debt_v1(uuid, uuid) is
  'DEBT-6B.3: Permite eliminar permanentemente una deuda o tarjeta solo si no tiene registros de historial financiero (eventos, consumos o estados de cuenta).';
