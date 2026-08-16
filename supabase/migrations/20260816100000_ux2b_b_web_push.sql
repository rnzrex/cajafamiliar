create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  app_origin text not null,
  is_active boolean not null default true,
  expires_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_unique unique (endpoint),
  constraint push_subscriptions_endpoint_not_blank_check check (pg_catalog.btrim(endpoint) <> ''),
  constraint push_subscriptions_p256dh_not_blank_check check (pg_catalog.btrim(p256dh) <> ''),
  constraint push_subscriptions_auth_not_blank_check check (pg_catalog.btrim(auth) <> ''),
  constraint push_subscriptions_app_origin_not_blank_check check (pg_catalog.btrim(app_origin) <> ''),
  constraint push_subscriptions_member_fk foreign key (household_id, user_id)
    references public.household_members(household_id, user_id) on delete cascade
);

create table if not exists public.push_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  notification_date date not null,
  notification_type text not null,
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'failed')),
  error_code text,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint push_notification_deliveries_subscription_day_type_unique unique (subscription_id, notification_date, notification_type)
);

create index if not exists idx_push_subscriptions_active_household
  on public.push_subscriptions(household_id, app_origin)
  where is_active = true;

create index if not exists idx_push_subscriptions_user
  on public.push_subscriptions(user_id);

create index if not exists idx_push_notification_deliveries_date_type
  on public.push_notification_deliveries(notification_date, notification_type);

alter table public.push_subscriptions enable row level security;
alter table public.push_notification_deliveries enable row level security;

revoke all privileges on table public.push_subscriptions, public.push_notification_deliveries
from public, anon, authenticated;

drop policy if exists "push_subscriptions_select_own_member" on public.push_subscriptions;
create policy "push_subscriptions_select_own_member"
  on public.push_subscriptions
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.household_members as hm
      where hm.household_id = push_subscriptions.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create or replace function public.register_push_subscription(
  p_household_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_app_origin text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_subscription public.push_subscriptions%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_household_id is null
     or p_endpoint is null or pg_catalog.btrim(p_endpoint) = ''
     or p_p256dh is null or pg_catalog.btrim(p_p256dh) = ''
     or p_auth is null or pg_catalog.btrim(p_auth) = ''
     or p_app_origin is null or pg_catalog.btrim(p_app_origin) = '' then
    raise exception 'INVALID_PUSH_SUBSCRIPTION';
  end if;

  if not exists (
    select 1
    from public.household_members as hm
    where hm.household_id = p_household_id
      and hm.user_id = v_user_id
      and hm.display_name is not null
      and pg_catalog.btrim(hm.display_name) <> ''
  ) then
    raise exception 'MEMBER_NOT_PROVISIONED';
  end if;

  insert into public.push_subscriptions (
    user_id,
    household_id,
    endpoint,
    p256dh,
    auth,
    app_origin,
    is_active,
    expires_at,
    last_failure_at,
    updated_at
  ) values (
    v_user_id,
    p_household_id,
    pg_catalog.btrim(p_endpoint),
    pg_catalog.btrim(p_p256dh),
    pg_catalog.btrim(p_auth),
    pg_catalog.btrim(p_app_origin),
    true,
    p_expires_at,
    null,
    pg_catalog.now()
  )
  on conflict (endpoint)
  do update set
    user_id = excluded.user_id,
    household_id = excluded.household_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    app_origin = excluded.app_origin,
    is_active = true,
    expires_at = excluded.expires_at,
    last_failure_at = null,
    updated_at = pg_catalog.now()
  returning * into v_subscription;

  return pg_catalog.jsonb_build_object(
    'id', v_subscription.id,
    'is_active', v_subscription.is_active,
    'app_origin', v_subscription.app_origin
  );
end;
$function$;

create or replace function public.unregister_push_subscription(
  p_household_id uuid,
  p_endpoint text,
  p_app_origin text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_household_id is null or p_endpoint is null or pg_catalog.btrim(p_endpoint) = ''
     or p_app_origin is null or pg_catalog.btrim(p_app_origin) = '' then
    raise exception 'INVALID_PUSH_SUBSCRIPTION';
  end if;

  if not exists (
    select 1
    from public.household_members as hm
    where hm.household_id = p_household_id
      and hm.user_id = v_user_id
  ) then
    raise exception 'MEMBER_NOT_PROVISIONED';
  end if;

  update public.push_subscriptions
     set is_active = false,
         updated_at = pg_catalog.now()
   where user_id = v_user_id
     and household_id = p_household_id
     and endpoint = pg_catalog.btrim(p_endpoint)
     and app_origin = pg_catalog.btrim(p_app_origin);

  return found;
end;
$function$;

create or replace function public.get_push_subscription_status(
  p_household_id uuid,
  p_endpoint text,
  p_app_origin text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_household_id is null or p_endpoint is null or pg_catalog.btrim(p_endpoint) = ''
     or p_app_origin is null or pg_catalog.btrim(p_app_origin) = '' then
    raise exception 'INVALID_PUSH_SUBSCRIPTION';
  end if;

  if not exists (
    select 1
    from public.household_members as hm
    where hm.household_id = p_household_id
      and hm.user_id = v_user_id
  ) then
    raise exception 'MEMBER_NOT_PROVISIONED';
  end if;

  return coalesce(
    (
      select ps.is_active
      from public.push_subscriptions as ps
      where ps.user_id = v_user_id
        and ps.household_id = p_household_id
        and ps.endpoint = pg_catalog.btrim(p_endpoint)
        and ps.app_origin = pg_catalog.btrim(p_app_origin)
      limit 1
    ),
    false
  );
end;
$function$;

revoke execute on function public.register_push_subscription(uuid, text, text, text, text, timestamptz)
  from public, anon, service_role;
grant execute on function public.register_push_subscription(uuid, text, text, text, text, timestamptz)
  to authenticated;

revoke execute on function public.unregister_push_subscription(uuid, text, text)
  from public, anon, service_role;
grant execute on function public.unregister_push_subscription(uuid, text, text)
  to authenticated;

revoke execute on function public.get_push_subscription_status(uuid, text, text)
  from public, anon, service_role;
grant execute on function public.get_push_subscription_status(uuid, text, text)
  to authenticated;
