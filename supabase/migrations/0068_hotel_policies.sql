-- Hotel Content -> Hotel Policy, cloned from the client's reference system.
--
-- Five things a guest asks before booking -- children, pets, smoking,
-- internet, parking -- each a choice from a short fixed list, "Custom policy"
-- with the hotel's own words, or "Omit this policy". Plus one free-text box
-- for anything else.
--
-- One row per property, keyed on the property. A property with no row has not
-- set a policy, and reads as every choice omitted: a default here would put
-- words in a hotel's mouth ("children welcome") that it never said -- the
-- same reason a cancellation policy reads "Not set" rather than free.
--
-- The choices are text under check constraints rather than enums: the lists
-- are the reference's and short, and adding an option to one is then a
-- constraint change rather than an ALTER TYPE that cannot run in a
-- transaction.

create table public.property_policies (
  property_id uuid primary key references public.properties(id) on delete cascade,

  children text not null default 'omit',
  children_custom text,
  pets text not null default 'omit',
  pets_custom text,
  smoking text not null default 'omit',
  smoking_custom text,
  internet text not null default 'omit',
  internet_custom text,
  parking text not null default 'omit',
  parking_custom text,
  other_policies text,

  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_users(id) on delete set null,

  constraint property_policies_children_choice check (
    children in ('all_ages', 'no_children_or_infants', 'no_infants', 'custom', 'omit')
  ),
  constraint property_policies_pets_choice check (
    pets in ('no_pets', 'pets_surcharge', 'custom', 'omit')
  ),
  constraint property_policies_smoking_choice check (
    smoking in ('no_smoking', 'permitted_areas', 'custom', 'omit')
  ),
  constraint property_policies_internet_choice check (
    internet in ('free_wifi_all', 'free_wifi_most', 'custom', 'omit')
  ),
  constraint property_policies_parking_choice check (
    parking in ('free_on_site', 'limited_on_site', 'custom', 'omit')
  ),

  -- Custom text belongs to "Custom policy" and to nothing else, and "Custom
  -- policy" with nothing written is not a policy.
  constraint property_policies_children_custom check (
    (children = 'custom') = (children_custom is not null and btrim(children_custom) <> '')
  ),
  constraint property_policies_pets_custom check (
    (pets = 'custom') = (pets_custom is not null and btrim(pets_custom) <> '')
  ),
  constraint property_policies_smoking_custom check (
    (smoking = 'custom') = (smoking_custom is not null and btrim(smoking_custom) <> '')
  ),
  constraint property_policies_internet_custom check (
    (internet = 'custom') = (internet_custom is not null and btrim(internet_custom) <> '')
  ),
  constraint property_policies_parking_custom check (
    (parking = 'custom') = (parking_custom is not null and btrim(parking_custom) <> '')
  )
);

alter table public.property_policies enable row level security;

create policy property_policies_select_current_property on public.property_policies
  for select using (property_id = public.current_property_id());

create policy property_policies_insert_revenue_staff on public.property_policies
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

create policy property_policies_update_revenue_staff on public.property_policies
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

-- No delete policy: "Omit this policy" on all five is how a hotel says
-- nothing, and it is an update like any other.

/*
 * Saves the whole page at once, because the page has one Save button.
 * security invoker, so the RLS policies above decide who may write and the
 * role check here only turns a silent zero-row result into a sentence.
 *
 * Custom text sent alongside a choice that is not "custom" is dropped rather
 * than refused -- switching from Custom back to a listed option should not
 * make anybody clear a box first. Same move as a cancellation policy dropping
 * its days when it becomes non-refundable.
 */
create or replace function public.save_property_policies(
  p_children text,
  p_children_custom text,
  p_pets text,
  p_pets_custom text,
  p_smoking text,
  p_smoking_custom text,
  p_internet text,
  p_internet_custom text,
  p_parking text,
  p_parking_custom text,
  p_other_policies text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_children_custom text := nullif(btrim(coalesce(p_children_custom, '')), '');
  v_pets_custom text := nullif(btrim(coalesce(p_pets_custom, '')), '');
  v_smoking_custom text := nullif(btrim(coalesce(p_smoking_custom, '')), '');
  v_internet_custom text := nullif(btrim(coalesce(p_internet_custom, '')), '');
  v_parking_custom text := nullif(btrim(coalesce(p_parking_custom, '')), '');
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the hotel policy';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if p_children = 'custom' and v_children_custom is null then
    raise exception 'Write the children policy, or pick one of the listed options';
  end if;
  if p_pets = 'custom' and v_pets_custom is null then
    raise exception 'Write the pets policy, or pick one of the listed options';
  end if;
  if p_smoking = 'custom' and v_smoking_custom is null then
    raise exception 'Write the smoking policy, or pick one of the listed options';
  end if;
  if p_internet = 'custom' and v_internet_custom is null then
    raise exception 'Write the internet policy, or pick one of the listed options';
  end if;
  if p_parking = 'custom' and v_parking_custom is null then
    raise exception 'Write the parking policy, or pick one of the listed options';
  end if;

  insert into public.property_policies as pp (
    property_id,
    children, children_custom,
    pets, pets_custom,
    smoking, smoking_custom,
    internet, internet_custom,
    parking, parking_custom,
    other_policies,
    updated_at, updated_by
  ) values (
    v_property,
    p_children, case when p_children = 'custom' then v_children_custom end,
    p_pets, case when p_pets = 'custom' then v_pets_custom end,
    p_smoking, case when p_smoking = 'custom' then v_smoking_custom end,
    p_internet, case when p_internet = 'custom' then v_internet_custom end,
    p_parking, case when p_parking = 'custom' then v_parking_custom end,
    nullif(btrim(coalesce(p_other_policies, '')), ''),
    now(), auth.uid()
  )
  on conflict (property_id) do update set
    children = excluded.children,
    children_custom = excluded.children_custom,
    pets = excluded.pets,
    pets_custom = excluded.pets_custom,
    smoking = excluded.smoking,
    smoking_custom = excluded.smoking_custom,
    internet = excluded.internet,
    internet_custom = excluded.internet_custom,
    parking = excluded.parking,
    parking_custom = excluded.parking_custom,
    other_policies = excluded.other_policies,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;
end;
$$;

revoke execute on function public.save_property_policies(
  text, text, text, text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.save_property_policies(
  text, text, text, text, text, text, text, text, text, text, text
) to authenticated;

grant select, insert, update on public.property_policies to authenticated;
revoke all on public.property_policies from anon;
