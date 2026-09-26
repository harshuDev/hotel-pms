-- Settings -> Finances -> Accounting Categories, cloned from the client's
-- reference: a list of categories (Name, Internal Code, External Code, edit,
-- delete, "Add new accounting category" opening a Create form inside the
-- card), and underneath it Default Accounting Categories -- four pickers,
-- the defaults for accommodation, extras, taxes and payments -- with one Save.
--
-- WHAT A CATEGORY IS: a ledger account the hotel's bookkeeper posts to, named
-- with the codes their own books and an outside accounting system use. It is
-- NOT the Extras catalog's "Accounting Category", which is `folio_item_type`
-- -- the report bucket a charge lands in (0069). The two sit at different
-- levels: the bucket says what a line is, this says which account it goes to.
--
-- THE FOUR DEFAULTS HAVE A READER: the Accounting report names the account
-- beside every line -- room revenue under the accommodation default, every
-- other revenue line under the extras default, the tax under the taxes
-- default and every payment method under the payments default -- with its
-- codes, so the report is what the bookkeeper keys in.
--
-- The reference ships each hotel with four categories, one per default:
-- Accommodation, Extras, Taxes and Income. They are seeded here for every
-- property, and for any property made later by trigger, so the four pickers
-- always have something to show. The defaults are required: a category that
-- is a default is refused on delete by name, and nothing can clear one.

create table public.accounting_categories (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null check (btrim(name) <> '' and char_length(name) <= 120),
  internal_code text check (internal_code is null or char_length(internal_code) <= 60),
  external_code text check (external_code is null or char_length(external_code) <= 60),
  created_at timestamptz not null default now()
);

create unique index accounting_categories_name_unique
  on public.accounting_categories (property_id, lower(btrim(name)));

alter table public.accounting_categories enable row level security;

create policy accounting_categories_select_current_property on public.accounting_categories
  for select using (property_id = public.current_property_id());
create policy accounting_categories_insert_revenue_staff on public.accounting_categories
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy accounting_categories_update_revenue_staff on public.accounting_categories
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy accounting_categories_delete_revenue_staff on public.accounting_categories
  for delete using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

grant select, insert, update, delete on public.accounting_categories to authenticated;
revoke all on public.accounting_categories from anon;

-- One row per property. Each default points at a category under
-- `on delete restrict`, so a default can never be deleted out from under it.
create table public.accounting_defaults (
  property_id uuid primary key references public.properties(id) on delete cascade,
  accommodation_id uuid not null references public.accounting_categories(id) on delete restrict,
  extras_id uuid not null references public.accounting_categories(id) on delete restrict,
  taxes_id uuid not null references public.accounting_categories(id) on delete restrict,
  payments_id uuid not null references public.accounting_categories(id) on delete restrict,
  updated_at timestamptz not null default now()
);

alter table public.accounting_defaults enable row level security;

create policy accounting_defaults_select_current_property on public.accounting_defaults
  for select using (property_id = public.current_property_id());
create policy accounting_defaults_update_revenue_staff on public.accounting_defaults
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

-- Rows are only ever made by the seed below; staff change them, never add.
grant select, update on public.accounting_defaults to authenticated;
revoke all on public.accounting_defaults from anon;

/* -- The reference's four, for a property that has none ------------------ */

create or replace function public.seed_accounting_categories(p_property uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_accommodation uuid;
  v_extras uuid;
  v_taxes uuid;
  v_income uuid;
begin
  if exists (select 1 from public.accounting_defaults where property_id = p_property) then
    return;
  end if;
  insert into public.accounting_categories (property_id, name)
    values (p_property, 'Accommodation') returning id into v_accommodation;
  insert into public.accounting_categories (property_id, name)
    values (p_property, 'Extras') returning id into v_extras;
  insert into public.accounting_categories (property_id, name)
    values (p_property, 'Taxes') returning id into v_taxes;
  insert into public.accounting_categories (property_id, name)
    values (p_property, 'Income') returning id into v_income;
  insert into public.accounting_defaults
    (property_id, accommodation_id, extras_id, taxes_id, payments_id)
  values (p_property, v_accommodation, v_extras, v_taxes, v_income);
end;
$$;

-- Called by the trigger and this migration only.
revoke execute on function public.seed_accounting_categories(uuid) from public, anon, authenticated;

create or replace function public.properties_seed_accounting_categories()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_accounting_categories(new.id);
  return new;
end;
$$;

revoke execute on function public.properties_seed_accounting_categories() from public, anon, authenticated;

create trigger properties_seed_accounting_categories
  after insert on public.properties
  for each row execute function public.properties_seed_accounting_categories();

select public.seed_accounting_categories(p.id) from public.properties p;

/* -- Writes -------------------------------------------------------------- */

create or replace function public.save_accounting_category(
  p_id uuid,
  p_name text,
  p_internal_code text,
  p_external_code text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_internal text := nullif(btrim(coalesce(p_internal_code, '')), '');
  v_external text := nullif(btrim(coalesce(p_external_code, '')), '');
  v_id uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the accounting categories';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  if v_name = '' then
    raise exception 'Write the name';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'Keep the name to 120 characters';
  end if;
  if char_length(coalesce(v_internal, '')) > 60 or char_length(coalesce(v_external, '')) > 60 then
    raise exception 'Keep each code to 60 characters';
  end if;
  if exists (
    select 1 from public.accounting_categories c
    where c.property_id = v_property and lower(btrim(c.name)) = lower(v_name)
      and (p_id is null or c.id <> p_id)
  ) then
    raise exception 'There is already an accounting category called %', v_name;
  end if;

  if p_id is null then
    insert into public.accounting_categories (property_id, name, internal_code, external_code)
    values (v_property, v_name, v_internal, v_external)
    returning id into v_id;
    return v_id;
  end if;

  update public.accounting_categories set
    name = v_name,
    internal_code = v_internal,
    external_code = v_external
  where id = p_id and property_id = v_property
  returning id into v_id;
  if v_id is null then
    raise exception 'That accounting category is not on this property';
  end if;
  return v_id;
end;
$$;

revoke execute on function public.save_accounting_category(uuid, text, text, text) from public, anon;
grant execute on function public.save_accounting_category(uuid, text, text, text) to authenticated;

-- Genuinely deleted when nothing uses it; a default is refused by name.
create or replace function public.delete_accounting_category(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_name text;
  v_default text;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the accounting categories';
  end if;
  v_property := public.current_property_id();
  select name into v_name from public.accounting_categories
  where id = p_id and property_id = v_property;
  if v_name is null then
    raise exception 'That accounting category is not on this property';
  end if;

  select case
    when d.accommodation_id = p_id then 'accommodation'
    when d.extras_id = p_id then 'extras'
    when d.taxes_id = p_id then 'taxes'
    when d.payments_id = p_id then 'payments'
  end into v_default
  from public.accounting_defaults d
  where d.property_id = v_property;
  if v_default is not null then
    raise exception '% is the default for %. Choose another default first.', v_name, v_default;
  end if;

  delete from public.accounting_categories
  where id = p_id and property_id = v_property;
end;
$$;

revoke execute on function public.delete_accounting_category(uuid) from public, anon;
grant execute on function public.delete_accounting_category(uuid) to authenticated;

create or replace function public.save_accounting_defaults(
  p_accommodation_id uuid,
  p_extras_id uuid,
  p_taxes_id uuid,
  p_payments_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the accounting categories';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  if p_accommodation_id is null or p_extras_id is null
     or p_taxes_id is null or p_payments_id is null then
    raise exception 'Choose a category for each default';
  end if;
  if (
    select count(distinct c.id) from public.accounting_categories c
    where c.property_id = v_property
      and c.id in (p_accommodation_id, p_extras_id, p_taxes_id, p_payments_id)
  ) <> (
    select count(distinct x) from unnest(array[
      p_accommodation_id, p_extras_id, p_taxes_id, p_payments_id
    ]) x
  ) then
    raise exception 'Choose each default from this hotel''s accounting categories';
  end if;

  update public.accounting_defaults set
    accommodation_id = p_accommodation_id,
    extras_id = p_extras_id,
    taxes_id = p_taxes_id,
    payments_id = p_payments_id,
    updated_at = now()
  where property_id = v_property;
  if not found then
    raise exception 'This hotel has no accounting defaults to change';
  end if;
end;
$$;

revoke execute on function public.save_accounting_defaults(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.save_accounting_defaults(uuid, uuid, uuid, uuid) to authenticated;
