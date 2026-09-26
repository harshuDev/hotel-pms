-- Settings -> Finances -> Currencies, cloned from the client's reference: the
-- hotel's currencies, one marked default, each with a rate that is either a
-- live exchange or a fixed figure.
--
-- THE DEFAULT IS NOT A ROW HERE. It is `properties.currency`, which every
-- amount on the property is written in and which Hotel Details sets. The list
-- shows it first, ticked, with no edit or delete -- exactly as the
-- reference's default row carries no icons -- so there is one place that
-- decides the hotel's currency and never two that could disagree. This table
-- holds the ADDITIONAL currencies only.
--
-- STORED, NOT YET LIVE. Nothing converts money yet: the guest booking page
-- has no currency switcher and no invoice is issued in a foreign currency
-- (a Hotel Feature, also stored). "Live Exchange" additionally needs a rate
-- feed this project has neither the network access nor the key for. The
-- profiles are kept so they are in place when a reader exists. See CLAUDE.md.
--
-- A fixed rate is how many units of the DEFAULT currency one unit of this
-- currency buys ("1 USD = 17.25 MXN"), held as an integer in millionths --
-- a rate, not money, but it keeps floats out all the same.

create table public.currency_profiles (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  rate_kind text not null default 'live' check (rate_kind in ('live', 'fixed')),
  fixed_rate_micros bigint,
  created_at timestamptz not null default now(),
  unique (property_id, currency),
  constraint currency_profiles_fixed_rate check (
    (rate_kind = 'fixed') = (fixed_rate_micros is not null)
    and (fixed_rate_micros is null or fixed_rate_micros > 0)
  )
);

alter table public.currency_profiles enable row level security;

create policy currency_profiles_select_current_property on public.currency_profiles
  for select using (property_id = public.current_property_id());
create policy currency_profiles_insert_revenue_staff on public.currency_profiles
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy currency_profiles_update_revenue_staff on public.currency_profiles
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy currency_profiles_delete_revenue_staff on public.currency_profiles
  for delete using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

grant select, insert, update, delete on public.currency_profiles to authenticated;
revoke all on public.currency_profiles from anon;

create or replace function public.save_currency_profile(
  p_id uuid,
  p_currency text,
  p_rate_kind text,
  p_fixed_rate_micros bigint
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_default text;
  v_id uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the currencies';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Pick a currency';
  end if;
  select btrim(currency) into v_default from public.properties where id = v_property;
  if v_currency = v_default then
    raise exception '% is already the hotel''s default currency', v_currency;
  end if;
  if coalesce(p_rate_kind, '') not in ('live', 'fixed') then
    raise exception 'Pick the rate';
  end if;
  if p_rate_kind = 'fixed' and coalesce(p_fixed_rate_micros, 0) <= 0 then
    raise exception 'Write the fixed rate, above zero';
  end if;
  if exists (
    select 1 from public.currency_profiles c
    where c.property_id = v_property and c.currency = v_currency
      and (p_id is null or c.id <> p_id)
  ) then
    raise exception '% is already one of the hotel''s currencies', v_currency;
  end if;

  if p_id is null then
    insert into public.currency_profiles (property_id, currency, rate_kind, fixed_rate_micros)
    values (
      v_property, v_currency, p_rate_kind,
      case when p_rate_kind = 'fixed' then p_fixed_rate_micros end
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.currency_profiles set
    currency = v_currency,
    rate_kind = p_rate_kind,
    fixed_rate_micros = case when p_rate_kind = 'fixed' then p_fixed_rate_micros end
  where id = p_id and property_id = v_property
  returning id into v_id;
  if v_id is null then
    raise exception 'That currency is not on this property';
  end if;
  return v_id;
end;
$$;

revoke execute on function public.save_currency_profile(uuid, text, text, bigint) from public, anon;
grant execute on function public.save_currency_profile(uuid, text, text, bigint) to authenticated;

-- Genuinely deleted, like a season: nothing points at a currency profile.
create or replace function public.delete_currency_profile(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the currencies';
  end if;
  delete from public.currency_profiles
  where id = p_id and property_id = public.current_property_id();
end;
$$;

revoke execute on function public.delete_currency_profile(uuid) from public, anon;
grant execute on function public.delete_currency_profile(uuid) to authenticated;
