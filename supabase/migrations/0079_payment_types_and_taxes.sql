-- Settings -> Finances, cloned from the client's reference: Custom Payment
-- Types and Tax Information ("Taxes And Fees").
--
-- PAYMENT TYPES ARE A FREE LIST NOW, not one per kind. The reference lists
-- Cash, Cheque, Bank Transfer, Voucher, Credit Card, Debit Card and Other,
-- each with a title and a description, and adds more at will. Until now
-- `unique (property_id, kind)` bounded the screen to the eight kinds, so a
-- hotel could not have Credit Card and Debit Card side by side. Nothing
-- read a method BY its kind -- checked before dropping the constraint -- so
-- two methods of one kind are safe.
--
-- THE KIND STILL DECIDES THE MONEY. `affects_drawer` follows it by check
-- constraint exactly as before (cash touches the drawer, nothing else does),
-- and it is still frozen once payments exist against a type. What changed is
-- only how many types may share one.
--
-- Titles are unique per property instead, case-insensitively: two types
-- both called "Cash" would be a cashier picking between identical rows.

alter table public.payment_methods
  add column description text,
  add constraint payment_methods_description_length check (
    description is null or char_length(description) <= 500
  );

alter table public.payment_methods drop constraint payment_methods_property_id_kind_key;

create unique index payment_methods_property_title_key
  on public.payment_methods (property_id, lower(btrim(name)));

-- Replaced rather than overloaded: the one caller was the screen being
-- rebuilt, and the per-kind refusal inside it is exactly what this lifts.
drop function if exists public.save_payment_method(text, public.payment_method_kind, uuid, boolean);

create or replace function public.save_payment_type(
  p_id uuid,
  p_title text,
  p_description text,
  p_kind public.payment_method_kind,
  p_is_active boolean
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_current_kind public.payment_method_kind;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can set up payment types';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if v_title = '' then
    raise exception 'A payment type needs a title';
  end if;
  if p_kind is null then
    raise exception 'Pick what kind of payment this is';
  end if;
  -- Not offered by this application; the enum value predates the rule.
  if p_kind = 'upi' then
    raise exception 'Pick what kind of payment this is';
  end if;
  if exists (
    select 1 from public.payment_methods pm
    where pm.property_id = v_property
      and lower(btrim(pm.name)) = lower(v_title)
      and (p_id is null or pm.id <> p_id)
  ) then
    raise exception 'There is already a payment type called %', v_title;
  end if;

  if p_id is null then
    insert into public.payment_methods (property_id, name, description, kind, affects_drawer, is_active)
    values (v_property, v_title, v_description, p_kind, p_kind = 'cash', coalesce(p_is_active, true))
    returning id into v_id;
    return v_id;
  end if;

  select pm.kind into v_current_kind
  from public.payment_methods pm
  where pm.id = p_id and pm.property_id = v_property;
  if v_current_kind is null then
    raise exception 'That payment type is not on this property';
  end if;

  -- Moving a type across the cash line would restate every shift already
  -- counted, so the kind is frozen once money has been taken on it.
  if v_current_kind is distinct from p_kind and exists (
    select 1 from public.payments p
    where p.payment_method_id = p_id and p.property_id = v_property
  ) then
    raise exception 'Payments have been taken as %, so its kind cannot change. Retire it and add a new one.', v_title;
  end if;

  update public.payment_methods set
    name = v_title,
    description = v_description,
    kind = p_kind,
    affects_drawer = p_kind = 'cash',
    is_active = coalesce(p_is_active, true)
  where id = p_id and property_id = v_property;
  return p_id;
end;
$$;

revoke execute on function public.save_payment_type(uuid, text, text, public.payment_method_kind, boolean) from public, anon;
grant execute on function public.save_payment_type(uuid, text, text, public.payment_method_kind, boolean) to authenticated;

/* -------------------------------------------------------------------------- */
/* Taxes And Fees: an order, and a delete for a rate nothing has used        */
/* -------------------------------------------------------------------------- */

-- The reference's rows carry a drag handle. The order is not decoration here:
-- the booking form seeds its tax field with the FIRST active rate, so the
-- rate at the top is the one a booking gets unless somebody picks another.
alter table public.tax_rates add column sort_order integer not null default 0;

update public.tax_rates t set sort_order = o.rn
from (
  select id, row_number() over (partition by property_id order by is_active desc, name) as rn
  from public.tax_rates
) o
where o.id = t.id;

create or replace function public.set_tax_rate_order(p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the taxes';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  update public.tax_rates t set sort_order = o.i
  from unnest(coalesce(p_ids, '{}')) with ordinality as o(id, i)
  where t.id = o.id and t.property_id = v_property;
end;
$$;

revoke execute on function public.set_tax_rate_order(uuid[]) from public, anon;
grant execute on function public.set_tax_rate_order(uuid[]) to authenticated;

-- A new rate goes to the foot of the list, so adding one never quietly
-- changes which rate new bookings default to.
create or replace function public.tax_rates_default_order()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.sort_order = 0 then
    select coalesce(max(sort_order), 0) + 1 into new.sort_order
    from public.tax_rates where property_id = new.property_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.tax_rates_default_order() from public, anon;

create trigger tax_rates_default_order
  before insert on public.tax_rates
  for each row execute function public.tax_rates_default_order();

/*
 * DELETE, which the reference has and this schema could never do: folio
 * items, extras and extra categories point at a rate under `on delete
 * restrict`. So a rate that NOTHING points at -- typed in by mistake, never
 * charged -- is deleted, and one in use is refused by name, pointing at
 * retiring it. The same narrow reversal `delete_room()` made in 0055.
 */
create or replace function public.delete_tax_rate(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_name text;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the taxes';
  end if;
  v_property := public.current_property_id();
  select name into v_name from public.tax_rates where id = p_id and property_id = v_property;
  if v_name is null then
    raise exception 'That tax is not on this property';
  end if;

  if exists (select 1 from public.folio_items fi where fi.tax_rate_id = p_id) then
    raise exception 'Charges have been posted with %, so it cannot be deleted. Untick Active to retire it.', v_name;
  end if;
  if exists (select 1 from public.extras e where e.tax_rate_id = p_id)
     or exists (select 1 from public.extra_categories c where c.tax_rate_id = p_id) then
    raise exception '% is set on an extra or an extras category. Change those first, or untick Active to retire it.', v_name;
  end if;

  delete from public.tax_rates where id = p_id and property_id = v_property;
end;
$$;

revoke execute on function public.delete_tax_rate(uuid) from public, anon;
grant execute on function public.delete_tax_rate(uuid) to authenticated;

-- The list gains the order and whether anything points at a rate, so the
-- screen can say which can be deleted before somebody tries. Dropped and
-- recreated: the return type changes.
drop function if exists public.tax_rates_list();

create function public.tax_rates_list()
returns table (
  id uuid,
  name text,
  rate_bps integer,
  inclusion public.tax_inclusion,
  is_active boolean,
  charge_count bigint,
  sort_order integer,
  in_use boolean
)
language sql
stable
set search_path to 'public'
as $function$
  select
    t.id, t.name, t.rate_bps, t.inclusion, t.is_active,
    coalesce(c.charges, 0)::bigint,
    t.sort_order,
    (
      coalesce(c.charges, 0) > 0
      or exists (select 1 from public.extras e where e.tax_rate_id = t.id)
      or exists (select 1 from public.extra_categories ec where ec.tax_rate_id = t.id)
    )
  from public.tax_rates t
  left join lateral (
    select count(*) as charges
    from public.folio_items fi
    where fi.tax_rate_id = t.id
      and fi.property_id = t.property_id
  ) c on true
  where t.property_id = public.current_property_id()
  order by t.sort_order, t.name;
$function$;

revoke execute on function public.tax_rates_list() from public, anon;
grant execute on function public.tax_rates_list() to authenticated;
