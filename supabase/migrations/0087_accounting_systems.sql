-- Settings -> Finances -> Accounting Systems, cloned from the client's
-- reference: "You do not have any accounting systems connected" and "Add
-- accounting system".
--
-- STORED, NOT YET LIVE, like Payment Gateways (0086). Nothing is exported to
-- an outside ledger: connecting a system is done per client, as each asks for
-- one. A row records which system the hotel keeps its books in and whether it
-- is on, so it is in place the day an export is built -- and the Accounting
-- Categories' External Code (0085) is what that export would key by.
--
-- NO CREDENTIALS ARE STORED HERE, for the same reason as a gateway: anybody
-- the select policy admits could read them. An OAuth token belongs to the
-- server when an integration exists.
--
-- THE SYSTEM LIST IS PROVISIONAL. The reference's add form has not been seen,
-- so `known_accounting_systems()` holds the ledgers a hotel ordinarily uses.
-- It and `ACCOUNTING_SYSTEMS` in `src/lib/finance-profiles.ts` change
-- together. One row per system per property.

create table public.accounting_systems (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  provider text not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (property_id, provider)
);

alter table public.accounting_systems enable row level security;

create policy accounting_systems_select_current_property on public.accounting_systems
  for select using (property_id = public.current_property_id());
create policy accounting_systems_insert_revenue_staff on public.accounting_systems
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy accounting_systems_update_revenue_staff on public.accounting_systems
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy accounting_systems_delete_revenue_staff on public.accounting_systems
  for delete using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

grant select, insert, update, delete on public.accounting_systems to authenticated;
revoke all on public.accounting_systems from anon;

create or replace function public.known_accounting_systems()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['quickbooks_online', 'xero', 'sage'];
$$;

revoke execute on function public.known_accounting_systems() from public, anon;
grant execute on function public.known_accounting_systems() to authenticated;

create or replace function public.save_accounting_system(
  p_id uuid,
  p_provider text,
  p_is_enabled boolean
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_id uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the accounting systems';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  if not (coalesce(p_provider, '') = any (public.known_accounting_systems())) then
    raise exception 'Pick the accounting system from the list';
  end if;
  if exists (
    select 1 from public.accounting_systems s
    where s.property_id = v_property and s.provider = p_provider
      and (p_id is null or s.id <> p_id)
  ) then
    raise exception 'That accounting system is already added. Edit it instead.';
  end if;

  if p_id is null then
    insert into public.accounting_systems (property_id, provider, is_enabled)
    values (v_property, p_provider, coalesce(p_is_enabled, true))
    returning id into v_id;
    return v_id;
  end if;

  update public.accounting_systems set
    provider = p_provider,
    is_enabled = coalesce(p_is_enabled, true)
  where id = p_id and property_id = v_property
  returning id into v_id;
  if v_id is null then
    raise exception 'That accounting system is not on this property';
  end if;
  return v_id;
end;
$$;

revoke execute on function public.save_accounting_system(uuid, text, boolean) from public, anon;
grant execute on function public.save_accounting_system(uuid, text, boolean) to authenticated;

-- Genuinely deleted: nothing points at one and nothing was ever exported.
create or replace function public.delete_accounting_system(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the accounting systems';
  end if;
  delete from public.accounting_systems
  where id = p_id and property_id = public.current_property_id();
end;
$$;

revoke execute on function public.delete_accounting_system(uuid) from public, anon;
grant execute on function public.delete_accounting_system(uuid) to authenticated;
