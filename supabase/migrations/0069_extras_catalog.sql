-- Hotel Content -> Extras, cloned from the client's reference system: a
-- catalog of things the hotel sells besides the room -- airport transfer,
-- breakfast, champagne, early check-in -- grouped into categories, each with
-- a price.
--
-- WHAT THIS IS NOT. An extra charged to a guest is still a folio item, as it
-- has been since 0002: `folio_items` is the only place money lives, and the
-- Extras tab and Extras report read it. This catalog is the MENU a front desk
-- picks from, not a second ledger. So:
--
--   * Charging one goes through `post_charge()` and nothing else, which keeps
--     the business date, the tax arithmetic, the role check and the
--     append-only rules in the one place they already are.
--   * The folio item copies the extra's title, type and price at the moment
--     it is posted, and holds no foreign key back here. Renaming an extra, or
--     repricing it, or deleting it, restates nothing already billed -- which
--     is also why an extra CAN be genuinely deleted, like a season, rather
--     than retired like a tax rate.
--
-- "Accounting category" in the reference is our `folio_item_type`: the
-- revenue bucket the Extras, Financial and Accounting reports already split
-- by. Only the types a person may post by hand are offered -- `post_charge()`
-- refuses room_charge, reversal and discount outright, and tax and adjustment
-- are not things a hotel sells.
--
-- "Is Meal" is NOT a column. The reference shows a fork and knife on
-- Breakfast; here that is simply an extra whose accounting category is food
-- and beverage. A separate flag would be a second way to say the same thing,
-- free to disagree with the first.

create table public.extra_categories (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  title text not null,
  -- The rate an extra in this category is taxed at when it names none itself.
  tax_rate_id uuid references public.tax_rates(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint extra_categories_title_present check (btrim(title) <> '')
);

create unique index extra_categories_title_key
  on public.extra_categories (property_id, lower(btrim(title)));

create table public.extras (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  -- Restrict, so deleting a category that still holds extras is refused by
  -- name in delete_extra_category() rather than orphaning them.
  category_id uuid not null references public.extra_categories(id) on delete restrict,
  title text not null,
  price_cents bigint not null,
  tax_rate_id uuid references public.tax_rates(id) on delete restrict,
  item_type public.folio_item_type not null default 'miscellaneous',
  created_at timestamptz not null default now(),
  constraint extras_title_present check (btrim(title) <> ''),
  constraint extras_price_not_negative check (price_cents >= 0),
  constraint extras_item_type_postable check (
    item_type in ('food_beverage', 'laundry', 'minibar', 'transport', 'miscellaneous')
  )
);

create index extras_property_title_idx on public.extras (property_id, lower(title));
create index extras_category_idx on public.extras (category_id);

alter table public.extra_categories enable row level security;
alter table public.extras enable row level security;

-- Anyone on the property reads the catalog: the front desk charges from it.
-- Changing it is revenue staff, like rates and tax rates.
create policy extra_categories_select_current_property on public.extra_categories
  for select using (property_id = public.current_property_id());
create policy extra_categories_write_revenue_staff on public.extra_categories
  for all using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

create policy extras_select_current_property on public.extras
  for select using (property_id = public.current_property_id());
create policy extras_write_revenue_staff on public.extras
  for all using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

grant select, insert, update, delete on public.extra_categories, public.extras to authenticated;
revoke all on public.extra_categories, public.extras from anon;

/* -------------------------------------------------------------------------
 * Categories
 * ---------------------------------------------------------------------- */

create or replace function public.save_extra_category(
  p_id uuid,
  p_title text,
  p_tax_rate_id uuid
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
    raise exception 'Only managers and administrators can change the extras';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'An extra category needs a title';
  end if;

  if p_tax_rate_id is not null and not exists (
    select 1 from public.tax_rates
    where id = p_tax_rate_id and property_id = v_property
  ) then
    raise exception 'That tax rate is not one of this property''s';
  end if;

  if exists (
    select 1 from public.extra_categories
    where property_id = v_property
      and lower(btrim(title)) = lower(btrim(p_title))
      and id is distinct from p_id
  ) then
    raise exception 'There is already an extra category called %', btrim(p_title);
  end if;

  if p_id is null then
    insert into public.extra_categories (property_id, title, tax_rate_id)
    values (v_property, btrim(p_title), p_tax_rate_id)
    returning id into v_id;
  else
    update public.extra_categories
    set title = btrim(p_title), tax_rate_id = p_tax_rate_id
    where id = p_id and property_id = v_property
    returning id into v_id;
    if v_id is null then
      raise exception 'That extra category no longer exists';
    end if;
  end if;

  return v_id;
end;
$$;

create or replace function public.delete_extra_category(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_title text;
  v_count integer;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the extras';
  end if;
  v_property := public.current_property_id();

  select title into v_title
  from public.extra_categories
  where id = p_id and property_id = v_property;
  if v_title is null then
    raise exception 'That extra category no longer exists';
  end if;

  select count(*) into v_count from public.extras where category_id = p_id;
  if v_count > 0 then
    raise exception '% still holds % extra%. Move or delete them first',
      v_title, v_count, case when v_count = 1 then '' else 's' end;
  end if;

  delete from public.extra_categories where id = p_id and property_id = v_property;
end;
$$;

/* -------------------------------------------------------------------------
 * Extras
 * ---------------------------------------------------------------------- */

create or replace function public.save_extra(
  p_id uuid,
  p_category_id uuid,
  p_title text,
  p_price_cents bigint,
  p_tax_rate_id uuid,
  p_item_type public.folio_item_type
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
    raise exception 'Only managers and administrators can change the extras';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'An extra needs a title';
  end if;
  if p_price_cents is null or p_price_cents < 0 then
    raise exception 'An extra needs a price of zero or more';
  end if;
  if p_item_type is null
     or p_item_type not in ('food_beverage', 'laundry', 'minibar', 'transport', 'miscellaneous') then
    raise exception 'Pick an accounting category for the extra';
  end if;

  if not exists (
    select 1 from public.extra_categories
    where id = p_category_id and property_id = v_property
  ) then
    raise exception 'Pick a category for the extra';
  end if;

  if p_tax_rate_id is not null and not exists (
    select 1 from public.tax_rates
    where id = p_tax_rate_id and property_id = v_property
  ) then
    raise exception 'That tax rate is not one of this property''s';
  end if;

  if p_id is null then
    insert into public.extras (
      property_id, category_id, title, price_cents, tax_rate_id, item_type
    ) values (
      v_property, p_category_id, btrim(p_title), p_price_cents, p_tax_rate_id, p_item_type
    )
    returning id into v_id;
  else
    update public.extras set
      category_id = p_category_id,
      title = btrim(p_title),
      price_cents = p_price_cents,
      tax_rate_id = p_tax_rate_id,
      item_type = p_item_type
    where id = p_id and property_id = v_property
    returning id into v_id;
    if v_id is null then
      raise exception 'That extra no longer exists';
    end if;
  end if;

  return v_id;
end;
$$;

-- A real delete: nothing points at an extra, and a folio item charged from
-- one carries its own copy of the title and price.
create or replace function public.delete_extra(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the extras';
  end if;

  delete from public.extras
  where id = p_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That extra no longer exists';
  end if;
end;
$$;

/* -------------------------------------------------------------------------
 * Charging one to a booking
 *
 * The catalog is only worth keeping if the front desk can charge from it, and
 * until now nothing in the staff application could put an extra on a folio
 * at all -- post_charge() had no caller but the paid-out and meeting room
 * paths. This is that caller.
 *
 * security definer because post_charge() is, and it does its own role check
 * (require_financial_staff: everyone but housekeeping) and its own property
 * check on the folio. What this adds is the lookup: the extra must be this
 * property's, the folio is the booking's open primary one -- the same folio
 * a paid-out recharge lands on -- and the tax is the extra's own rate, else
 * its category's, else none.
 * ---------------------------------------------------------------------- */

create or replace function public.charge_extra(
  p_booking_id uuid,
  p_extra_id uuid,
  p_quantity integer default 1
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_extra public.extras;
  v_tax uuid;
  v_folio uuid;
begin
  perform public.require_financial_staff();

  v_property := public.current_property_id();

  if p_quantity is null or p_quantity < 1 then
    raise exception 'The quantity must be at least 1';
  end if;
  if p_quantity > 999 then
    raise exception 'The quantity must be 999 or fewer';
  end if;

  select * into v_extra
  from public.extras
  where id = p_extra_id and property_id = v_property;
  if not found then
    raise exception 'That extra is not in this property''s catalog';
  end if;

  v_tax := coalesce(
    v_extra.tax_rate_id,
    (select c.tax_rate_id from public.extra_categories c where c.id = v_extra.category_id)
  );

  select f.id into v_folio
  from public.folios f
  join public.bookings b on b.id = f.booking_id
  where f.booking_id = p_booking_id
    and b.property_id = v_property
    and f.property_id = v_property
    and f.status = 'open'
  order by f.is_primary desc, f.folio_number
  limit 1;

  if v_folio is null then
    raise exception 'This booking has no open folio to charge the extra to';
  end if;

  return public.post_charge(
    v_folio,
    v_extra.item_type,
    v_extra.title,
    v_extra.price_cents,
    p_quantity,
    null,
    v_tax
  );
end;
$$;

revoke execute on function public.save_extra_category(uuid, text, uuid) from public, anon;
revoke execute on function public.delete_extra_category(uuid) from public, anon;
revoke execute on function public.save_extra(uuid, uuid, text, bigint, uuid, public.folio_item_type) from public, anon;
revoke execute on function public.delete_extra(uuid) from public, anon;
revoke execute on function public.charge_extra(uuid, uuid, integer) from public, anon;

grant execute on function public.save_extra_category(uuid, text, uuid) to authenticated;
grant execute on function public.delete_extra_category(uuid) to authenticated;
grant execute on function public.save_extra(uuid, uuid, text, bigint, uuid, public.folio_item_type) to authenticated;
grant execute on function public.delete_extra(uuid) to authenticated;
grant execute on function public.charge_extra(uuid, uuid, integer) to authenticated;
