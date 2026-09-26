-- Settings -> Finances -> Payment Gateway, cloned from the client's reference:
-- "Payment Gateways", a list of Title and Is Default with a pencil (and a
-- cross) per row, and "Add gateway".
--
-- STORED, NOT YET LIVE -- AND DELIBERATELY SO. No gateway is connected: there
-- is no Stripe code in this repository and no keys in any environment (see
-- "Card capture is not built" in CLAUDE.md). Connecting a gateway is done per
-- client, as each asks for one. A row here records which gateway the hotel
-- uses and which is its default, so it is in place the day one is wired.
--
-- NO CREDENTIALS ARE STORED HERE, AND NONE EVER SHOULD BE. A gateway's secret
-- key is readable by anybody this table's select policy admits; when a
-- gateway is wired its secret goes in the server's environment, and a
-- publishable key is the most a row could ever carry.
--
-- THE PROVIDER LIST is the two the reference shows -- Stripe SCA and
-- ChannexPCI. It is `known_payment_gateways()` here and `PAYMENT_GATEWAYS` in
-- `src/lib/finance-profiles.ts`; adding a provider is a line in both.
--
-- At most one default per property, by a partial unique index; making one the
-- default stands the previous one down in the same statement set.

create table public.payment_gateways (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  provider text not null,
  title text not null check (btrim(title) <> '' and char_length(title) <= 80),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index payment_gateways_title_unique
  on public.payment_gateways (property_id, lower(btrim(title)));
create unique index payment_gateways_one_default
  on public.payment_gateways (property_id) where is_default;

alter table public.payment_gateways enable row level security;

create policy payment_gateways_select_current_property on public.payment_gateways
  for select using (property_id = public.current_property_id());
create policy payment_gateways_insert_revenue_staff on public.payment_gateways
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy payment_gateways_update_revenue_staff on public.payment_gateways
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy payment_gateways_delete_revenue_staff on public.payment_gateways
  for delete using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

grant select, insert, update, delete on public.payment_gateways to authenticated;
revoke all on public.payment_gateways from anon;

create or replace function public.known_payment_gateways()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['stripe_sca', 'channex_pci'];
$$;

revoke execute on function public.known_payment_gateways() from public, anon;
grant execute on function public.known_payment_gateways() to authenticated;

create or replace function public.save_payment_gateway(
  p_id uuid,
  p_provider text,
  p_title text,
  p_is_default boolean
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_id uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the payment gateways';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  if not (coalesce(p_provider, '') = any (public.known_payment_gateways())) then
    raise exception 'Pick the gateway from the list';
  end if;
  if v_title = '' then
    raise exception 'Write the title';
  end if;
  if char_length(v_title) > 80 then
    raise exception 'Keep the title to 80 characters';
  end if;
  if exists (
    select 1 from public.payment_gateways g
    where g.property_id = v_property and lower(btrim(g.title)) = lower(v_title)
      and (p_id is null or g.id <> p_id)
  ) then
    raise exception 'There is already a gateway called %', v_title;
  end if;

  -- One default: stand the old one down first, or the index refuses.
  if coalesce(p_is_default, false) then
    update public.payment_gateways set is_default = false
    where property_id = v_property and is_default
      and (p_id is null or id <> p_id);
  end if;

  if p_id is null then
    insert into public.payment_gateways (property_id, provider, title, is_default)
    values (v_property, p_provider, v_title, coalesce(p_is_default, false))
    returning id into v_id;
    return v_id;
  end if;

  update public.payment_gateways set
    provider = p_provider,
    title = v_title,
    is_default = coalesce(p_is_default, false)
  where id = p_id and property_id = v_property
  returning id into v_id;
  if v_id is null then
    raise exception 'That gateway is not on this property';
  end if;
  return v_id;
end;
$$;

revoke execute on function public.save_payment_gateway(uuid, text, text, boolean) from public, anon;
grant execute on function public.save_payment_gateway(uuid, text, text, boolean) to authenticated;

-- Genuinely deleted: nothing points at a gateway and no payment has ever gone
-- through one.
create or replace function public.delete_payment_gateway(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the payment gateways';
  end if;
  delete from public.payment_gateways
  where id = p_id and property_id = public.current_property_id();
end;
$$;

revoke execute on function public.delete_payment_gateway(uuid) from public, anon;
grant execute on function public.delete_payment_gateway(uuid) to authenticated;
