-- Settings -> Guest Configuration, cloned from the client's reference: three
-- screens -- Guest Registration Form, Identification Types and Guest Details
-- Settings.
--
-- Each one is wired to something that reads it, rather than stored and left:
--
--   * Identification types are a pick-list on the guest's own record (the
--     Identity band of the Customers form), saying what document the number
--     on file belongs to.
--   * Guest detail fields are extra fields that appear on that same form, the
--     values kept on the customer.
--   * The registration form settings -- two custom questions and the terms
--     and conditions -- print on a booking's Guest Registration Card, with
--     the guest's details filled in and a line to sign.

/* -------------------------------------------------------------------------
 * Identification types
 * ---------------------------------------------------------------------- */

create table public.identification_types (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  title text not null,
  created_at timestamptz not null default now(),
  constraint identification_types_title_present check (btrim(title) <> '')
);

create unique index identification_types_title_key
  on public.identification_types (property_id, lower(btrim(title)));

alter table public.identification_types enable row level security;

create policy identification_types_select_current_property on public.identification_types
  for select using (property_id = public.current_property_id());
create policy identification_types_write_revenue_staff on public.identification_types
  for all using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

-- Restrict, so a type a guest's record names cannot silently disappear from
-- it; delete_identification_type() refuses by name first.
alter table public.customers
  add column identification_type_id uuid references public.identification_types(id) on delete restrict;

create index customers_identification_type_idx
  on public.customers (identification_type_id) where identification_type_id is not null;

create or replace function public.save_identification_type(p_id uuid, p_title text)
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
    raise exception 'Only managers and administrators can change the guest configuration';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'An identification type needs a title';
  end if;
  if exists (
    select 1 from public.identification_types
    where property_id = v_property
      and lower(btrim(title)) = lower(btrim(p_title))
      and id is distinct from p_id
  ) then
    raise exception 'There is already an identification type called %', btrim(p_title);
  end if;

  if p_id is null then
    insert into public.identification_types (property_id, title)
    values (v_property, btrim(p_title))
    returning id into v_id;
  else
    update public.identification_types set title = btrim(p_title)
    where id = p_id and property_id = v_property
    returning id into v_id;
    if v_id is null then
      raise exception 'That identification type no longer exists';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.delete_identification_type(p_id uuid)
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
    raise exception 'Only managers and administrators can change the guest configuration';
  end if;
  v_property := public.current_property_id();

  select title into v_title from public.identification_types
  where id = p_id and property_id = v_property;
  if v_title is null then
    raise exception 'That identification type no longer exists';
  end if;

  select count(*) into v_count from public.customers
  where identification_type_id = p_id and property_id = v_property;
  if v_count > 0 then
    raise exception '% is on % guest record%. Change them first',
      v_title, v_count, case when v_count = 1 then '' else 's' end;
  end if;

  delete from public.identification_types where id = p_id and property_id = v_property;
end;
$$;

/* -------------------------------------------------------------------------
 * Additional guest fields
 *
 * The definitions are a table; the values live on the customer as jsonb,
 * keyed by field id. jsonb rather than a values table because they are read
 * and written as one set with the guest's record and never queried across
 * guests -- and a field that is later removed leaves nothing to clean up
 * that anything reads.
 * ---------------------------------------------------------------------- */

create table public.guest_fields (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  label text not null,
  kind text not null default 'text',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint guest_fields_label_present check (btrim(label) <> ''),
  constraint guest_fields_kind_known check (kind in ('text', 'number', 'date', 'yes_no'))
);

alter table public.guest_fields enable row level security;

create policy guest_fields_select_current_property on public.guest_fields
  for select using (property_id = public.current_property_id());
create policy guest_fields_write_revenue_staff on public.guest_fields
  for all using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

alter table public.customers
  add column custom_fields jsonb not null default '{}'::jsonb;

/*
 * The whole list at once, as the reference's single SAVE does: rows with an
 * id are updated, rows without one are added, and any field not in the list
 * is removed. Order is the order sent.
 */
create or replace function public.save_guest_fields(p_fields jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_item jsonb;
  v_index integer := 0;
  v_keep uuid[] := '{}';
  v_id uuid;
  v_label text;
  v_kind text;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the guest configuration';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  if jsonb_typeof(coalesce(p_fields, '[]'::jsonb)) <> 'array' then
    raise exception 'The guest fields must be a list';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_fields, '[]'::jsonb)) loop
    v_index := v_index + 1;
    v_label := btrim(coalesce(v_item->>'label', ''));
    v_kind := coalesce(nullif(v_item->>'kind', ''), 'text');
    if v_label = '' then
      raise exception 'Guest field % needs a name', v_index;
    end if;
    if v_kind not in ('text', 'number', 'date', 'yes_no') then
      raise exception 'Guest field % has a type this system does not know', v_label;
    end if;

    v_id := nullif(v_item->>'id', '')::uuid;
    if v_id is not null then
      update public.guest_fields
      set label = v_label, kind = v_kind, sort_order = v_index
      where id = v_id and property_id = v_property
      returning id into v_id;
    end if;
    if v_id is null then
      insert into public.guest_fields (property_id, label, kind, sort_order)
      values (v_property, v_label, v_kind, v_index)
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;

  delete from public.guest_fields
  where property_id = v_property and not (id = any (v_keep));
end;
$$;

/*
 * The two extras on a guest's own record: which identification document the
 * number on file is, and the values of the additional fields. Its own
 * function rather than parameters on save_customer(), for the overload reason
 * set_room_photo() stands apart from save_room(). Values for fields that do
 * not exist are dropped rather than stored, so the jsonb only ever holds what
 * the Settings list defines.
 */
create or replace function public.set_customer_details(
  p_customer_id uuid,
  p_identification_type_id uuid,
  p_custom_fields jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_values jsonb;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front office staff can change a guest''s details';
  end if;
  v_property := public.current_property_id();

  if p_identification_type_id is not null and not exists (
    select 1 from public.identification_types
    where id = p_identification_type_id and property_id = v_property
  ) then
    raise exception 'That identification type no longer exists';
  end if;

  select coalesce(jsonb_object_agg(f.id::text, btrim(v.value)), '{}'::jsonb)
  into v_values
  from jsonb_each_text(coalesce(p_custom_fields, '{}'::jsonb)) v
  join public.guest_fields f
    on f.id::text = v.key and f.property_id = v_property
  where btrim(coalesce(v.value, '')) <> '';

  update public.customers
  set identification_type_id = p_identification_type_id,
      custom_fields = v_values
  where id = p_customer_id and property_id = v_property;
  if not found then
    raise exception 'That guest no longer exists';
  end if;
end;
$$;

/* -------------------------------------------------------------------------
 * Guest registration form
 * ---------------------------------------------------------------------- */

create table public.registration_form_settings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  question_1 text,
  question_2 text,
  terms text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_users(id) on delete set null
);

alter table public.registration_form_settings enable row level security;

create policy registration_form_settings_select_current_property
  on public.registration_form_settings
  for select using (property_id = public.current_property_id());
create policy registration_form_settings_insert_revenue_staff
  on public.registration_form_settings
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy registration_form_settings_update_revenue_staff
  on public.registration_form_settings
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

create or replace function public.save_registration_form(
  p_question_1 text,
  p_question_2 text,
  p_terms text
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
    raise exception 'Only managers and administrators can change the guest configuration';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  insert into public.registration_form_settings as r (
    property_id, question_1, question_2, terms, updated_at, updated_by
  ) values (
    v_property,
    nullif(btrim(coalesce(p_question_1, '')), ''),
    nullif(btrim(coalesce(p_question_2, '')), ''),
    nullif(btrim(coalesce(p_terms, '')), ''),
    now(), auth.uid()
  )
  on conflict (property_id) do update set
    question_1 = excluded.question_1,
    question_2 = excluded.question_2,
    terms = excluded.terms,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;
end;
$$;

/* -------------------------------------------------------------------------
 * Grants
 * ---------------------------------------------------------------------- */

grant select, insert, update, delete on public.identification_types, public.guest_fields
  to authenticated;
grant select, insert, update on public.registration_form_settings to authenticated;
revoke all on public.identification_types, public.guest_fields,
  public.registration_form_settings from anon;

revoke execute on function public.save_identification_type(uuid, text) from public, anon;
revoke execute on function public.delete_identification_type(uuid) from public, anon;
revoke execute on function public.save_guest_fields(jsonb) from public, anon;
revoke execute on function public.set_customer_details(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.save_registration_form(text, text, text) from public, anon;

grant execute on function public.save_identification_type(uuid, text) to authenticated;
grant execute on function public.delete_identification_type(uuid) to authenticated;
grant execute on function public.save_guest_fields(jsonb) to authenticated;
grant execute on function public.set_customer_details(uuid, uuid, jsonb) to authenticated;
grant execute on function public.save_registration_form(text, text, text) to authenticated;
