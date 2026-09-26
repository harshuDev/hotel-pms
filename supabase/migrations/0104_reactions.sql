-- Settings -> Other -> Reactions, cloned from the client's reference: a list
-- (Title / Description, Event, Enabled, copy, edit, delete), "ADD REACTION",
-- and a form -- Task, Title, Description, Conditions (All / Any match, Add
-- Condition, Add Group), Triggers ("CREATE NEW TRIGGER") and Enabled.
--
-- STORED, NOT YET RUN. Nothing fires a reaction. The two tasks the reference
-- ships are about PREPAYMENTS -- "convert prepayments to charges" on check-in,
-- "redeem prepayments" on cancellation -- and this schema has no prepayment:
-- a payment taken before arrival is already a payment on the folio, which is
-- what the Deposit report reads. Running either task would therefore be a
-- change to how money is posted (append-only `folio_items` and `payments`),
-- to be asked for rather than slipped in with a settings screen.
--
-- PROVISIONAL, because the reference's dropdowns were not seen open: the task
-- list beyond the two shown, the events beyond "After check in" and "After
-- booking cancellation", and the condition fields and operators. The ids are
-- checked here and listed in `src/lib/reactions.ts`; they change together.
--
-- A trigger is an event. A reaction may carry several (the list draws its
-- events as bullets), so they are an array on the row rather than a table.
--
-- Conditions are a tree in jsonb:
--   group := { "match": "all" | "any", "items": [ condition | group, ... ] }
--   condition := { "field": <id>, "op": <id>, "value": <text> }
-- validated by `reaction_conditions_check()` on every save: known fields and
-- operators, a value that fits the field (an id on this property, a country
-- code, a whole number), at most three levels and thirty conditions.
--
-- Genuinely deleted: nothing points at a reaction.

create table public.reactions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  task text not null check (task in ('convert_prepayments_to_charges', 'redeem_prepayments')),
  title text not null check (btrim(title) <> '' and char_length(title) <= 120),
  description text check (char_length(description) <= 500),
  conditions jsonb not null default '{"match": "all", "items": []}'::jsonb
    check (jsonb_typeof(conditions) = 'object'),
  events text[] not null default '{}' check (
    events <@ array[
      'after_booking_created', 'after_booking_modified', 'after_booking_cancellation',
      'after_check_in', 'after_check_out'
    ]::text[]
  ),
  is_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index reactions_property on public.reactions (property_id, created_at);

alter table public.reactions enable row level security;

create policy reactions_select_current_property on public.reactions
  for select using (property_id = public.current_property_id());
create policy reactions_insert_revenue_staff on public.reactions
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy reactions_update_revenue_staff on public.reactions
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy reactions_delete_revenue_staff on public.reactions
  for delete using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

grant select, insert, update, delete on public.reactions to authenticated;
revoke all on public.reactions from anon;

/*
 * Raises by name on the first thing wrong with a condition tree; returns the
 * number of conditions in it. p_depth is 1 for the root group.
 */
create or replace function public.reaction_conditions_check(
  p_property uuid,
  p_group jsonb,
  p_depth integer
)
returns integer
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_field text;
  v_op text;
  v_value text;
  v_numeric boolean;
begin
  if jsonb_typeof(p_group) <> 'object'
    or coalesce(p_group ->> 'match', '') not in ('all', 'any')
    or jsonb_typeof(p_group -> 'items') <> 'array' then
    raise exception 'The conditions are not in a shape this screen writes';
  end if;
  if p_depth > 3 then
    raise exception 'Groups can be nested two deep';
  end if;

  for v_item in select value from jsonb_array_elements(p_group -> 'items') loop
    if jsonb_typeof(v_item) = 'object' and v_item ? 'match' then
      v_count := v_count + public.reaction_conditions_check(p_property, v_item, p_depth + 1);
      continue;
    end if;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'The conditions are not in a shape this screen writes';
    end if;

    v_field := v_item ->> 'field';
    v_op := v_item ->> 'op';
    v_value := btrim(coalesce(v_item ->> 'value', ''));
    v_numeric := v_field in ('nights', 'adults');

    if v_field is null or v_field not in (
      'channel', 'booking_status', 'settlement', 'room_type', 'rate_plan',
      'nights', 'adults', 'guest_country'
    ) then
      raise exception 'Choose what each condition checks';
    end if;
    if v_op is null or v_op not in ('eq', 'neq', 'gt', 'lt')
      or (v_op in ('gt', 'lt') and not v_numeric) then
      raise exception 'Choose how each condition compares';
    end if;
    if v_value = '' then
      raise exception 'Give each condition a value';
    end if;

    if v_numeric and v_value !~ '^[0-9]{1,4}$' then
      raise exception 'Nights and adults are whole numbers';
    elsif v_field = 'booking_status' and v_value not in (
      'pending', 'confirmed', 'checked_in', 'checked_out', 'canceled', 'no_show'
    ) then
      raise exception 'Choose a booking status from the list';
    elsif v_field = 'settlement' and v_value not in (
      'at_property', 'prepaid_to_channel', 'virtual_card'
    ) then
      raise exception 'Choose a settlement from the list';
    elsif v_field = 'guest_country' and v_value !~ '^[A-Z]{2}$' then
      raise exception 'Choose a country from the list';
    elsif v_field in ('channel', 'room_type', 'rate_plan') then
      if v_value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or not (
          (v_field = 'channel' and exists (
            select 1 from public.channels c where c.id = v_value::uuid and c.property_id = p_property))
          or (v_field = 'room_type' and exists (
            select 1 from public.room_types t where t.id = v_value::uuid and t.property_id = p_property))
          or (v_field = 'rate_plan' and exists (
            select 1 from public.rate_plans r where r.id = v_value::uuid and r.property_id = p_property))
        ) then
        raise exception 'A condition names something that is not on this property';
      end if;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.reaction_conditions_check(uuid, jsonb, integer) from public, anon;
grant execute on function public.reaction_conditions_check(uuid, jsonb, integer) to authenticated;

/* p_id null adds one. Returns the reaction's id. */
create or replace function public.save_reaction(
  p_id uuid,
  p_task text,
  p_title text,
  p_description text,
  p_conditions jsonb,
  p_events text[],
  p_is_enabled boolean
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_conditions jsonb := coalesce(p_conditions, '{"match": "all", "items": []}'::jsonb);
  v_events text[];
  v_id uuid;
begin
  if not coalesce(public.is_revenue_staff(), false) or v_property is null then
    raise exception 'Only managers and administrators can change reactions';
  end if;
  if coalesce(p_task, '') not in ('convert_prepayments_to_charges', 'redeem_prepayments') then
    raise exception 'Choose a task';
  end if;
  if v_title = '' then
    raise exception 'Write the title';
  end if;
  if char_length(v_title) > 120 then
    raise exception 'Keep the title to 120 characters';
  end if;
  if char_length(coalesce(v_description, '')) > 500 then
    raise exception 'Keep the description to 500 characters';
  end if;

  select coalesce(array_agg(distinct e order by e), '{}') into v_events
  from unnest(coalesce(p_events, '{}')) e;
  if not v_events <@ array[
    'after_booking_created', 'after_booking_modified', 'after_booking_cancellation',
    'after_check_in', 'after_check_out'
  ]::text[] then
    raise exception 'Choose each trigger from the list';
  end if;

  if public.reaction_conditions_check(v_property, v_conditions, 1) > 30 then
    raise exception 'Keep it to thirty conditions';
  end if;

  if p_id is null then
    insert into public.reactions (property_id, task, title, description, conditions, events, is_enabled)
    values (v_property, p_task, v_title, v_description, v_conditions, v_events, coalesce(p_is_enabled, false))
    returning id into v_id;
  else
    update public.reactions set
      task = p_task,
      title = v_title,
      description = v_description,
      conditions = v_conditions,
      events = v_events,
      is_enabled = coalesce(p_is_enabled, false)
    where id = p_id and property_id = v_property
    returning id into v_id;
    if v_id is null then
      raise exception 'That reaction is not on this property';
    end if;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.save_reaction(uuid, text, text, text, jsonb, text[], boolean) from public, anon;
grant execute on function public.save_reaction(uuid, text, text, text, jsonb, text[], boolean) to authenticated;

create or replace function public.delete_reaction(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not coalesce(public.is_revenue_staff(), false) or public.current_property_id() is null then
    raise exception 'Only managers and administrators can change reactions';
  end if;
  delete from public.reactions
  where id = p_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That reaction is not on this property';
  end if;
end;
$$;

revoke execute on function public.delete_reaction(uuid) from public, anon;
grant execute on function public.delete_reaction(uuid) to authenticated;
