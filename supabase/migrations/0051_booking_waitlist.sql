-- 0051: the booking waitlist.
--
-- The one report on the client's list with nothing behind it at all. The other
-- eight are questions about data this database already holds; a waitlist is a
-- thing the hotel does that was never modelled, so the report needs the feature
-- first.
--
-- WHAT IT IS: somebody asks for dates that are sold out, or closed, or priced
-- above what they will pay, and the hotel writes them down instead of losing
-- them. When a cancellation frees a room, the front desk works the list.
--
-- WHAT IT IS NOT: a booking. Nothing here holds inventory, generates nights,
-- or appears in occupancy — a waitlist entry that quietly reserved a room would
-- be an overbooking nobody asked for. The link to a real booking is recorded
-- only once somebody converts the entry, and conversion goes through the
-- ordinary `create_booking()` path like any other reservation.

create type public.waitlist_status as enum (
  'waiting',    -- on the list, nothing offered
  'offered',    -- the hotel has come back to them and is waiting for an answer
  'converted',  -- became a booking; converted_booking_id says which
  'expired',    -- the dates went past without anything coming free
  'canceled'    -- the guest no longer wants it
);

create table public.booking_waitlist (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,

  -- Either a customer we already know, or loose contact details for somebody
  -- who rang once. An enquiry that never becomes a booking should not have to
  -- create a customer record to be written down, and a customer created for
  -- every speculative phone call is how a guest list fills with ghosts.
  customer_id uuid,
  contact_name text,
  contact_email text,
  contact_phone text,

  -- Null means "any room type". Somebody who wants a room at all on a sold-out
  -- night does not care which, and forcing a choice would put a false
  -- restriction on the list the front desk works from.
  room_type_id uuid,

  check_in date not null,
  check_out date not null,
  adults smallint not null default 1,
  children smallint not null default 0,

  status public.waitlist_status not null default 'waiting',
  -- Set only by a conversion. Nullable and unconstrained until then.
  converted_booking_id uuid,

  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,

  unique (id, property_id),

  foreign key (customer_id, property_id)
    references public.customers (id, property_id) on delete restrict,
  foreign key (room_type_id, property_id)
    references public.room_types (id, property_id) on delete restrict,
  foreign key (converted_booking_id, property_id)
    references public.bookings (id, property_id) on delete restrict,
  foreign key (created_by, property_id)
    references public.staff_users (id, property_id) on delete restrict,

  -- Same shape as a booking: the departure is the morning they leave, so it is
  -- after the arrival and is not a night stayed. Deliberately NOT the inclusive
  -- range the meeting room module uses -- this is a room stay and matches how
  -- every other date pair in this schema reads.
  constraint booking_waitlist_dates check (check_out > check_in),
  constraint booking_waitlist_party check (adults >= 1 and children >= 0),

  -- Somebody has to be reachable, or the entry cannot be worked. A row with
  -- neither a customer nor a name is a note to nobody.
  constraint booking_waitlist_has_contact check (
    customer_id is not null
    or nullif(btrim(coalesce(contact_name, '')), '') is not null
  ),

  -- A converted entry names its booking; an unconverted one must not. Without
  -- this the status and the link drift apart and the report cannot say which
  -- of the two is true.
  constraint booking_waitlist_converted_has_booking check (
    (status = 'converted') = (converted_booking_id is not null)
  )
);

comment on table public.booking_waitlist is
  'Guests waiting for dates that are not currently sellable. Holds no inventory and appears in no occupancy figure.';

create index booking_waitlist_property_status_idx
  on public.booking_waitlist (property_id, status, check_in);

alter table public.booking_waitlist enable row level security;

-- Read by anyone who can see the front office. Written by front office staff:
-- taking a name for a sold-out date is reception work, not a manager's.
create policy booking_waitlist_select_same_property on public.booking_waitlist
  for select using (property_id = public.current_property_id());
create policy booking_waitlist_insert_front_office on public.booking_waitlist
  for insert with check (
    property_id = public.current_property_id() and public.is_front_office_staff()
  );
create policy booking_waitlist_update_front_office on public.booking_waitlist
  for update using (
    property_id = public.current_property_id() and public.is_front_office_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_front_office_staff()
  );

-- No delete policy, and that is on purpose. An entry that came to nothing is
-- `expired` or `canceled`; removing it loses the fact that somebody asked,
-- which is the only thing the list is evidence of.


/* -------------------------------------------------------------------------- */
/* Adding to the list                                                         */
/* -------------------------------------------------------------------------- */

create function public.add_to_waitlist(
  p_check_in date,
  p_check_out date,
  p_customer_id uuid default null,
  p_contact_name text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_room_type_id uuid default null,
  p_adults smallint default 1,
  p_children smallint default 0,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_property uuid;
  v_id uuid;
  v_name text;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, manager and admin staff can add to the waitlist';
  end if;

  v_property := public.current_property_id();
  v_name := nullif(btrim(coalesce(p_contact_name, '')), '');

  -- Each of these is a check constraint as well. Raising by name here means a
  -- receptionist reads what they did wrong instead of a constraint name.
  if p_check_in is null or p_check_out is null then
    raise exception 'A waitlist entry needs an arrival and a departure date';
  end if;
  if p_check_out <= p_check_in then
    raise exception 'The departure date must be after the arrival date';
  end if;
  if p_customer_id is null and v_name is null then
    raise exception 'A waitlist entry needs either a customer or a contact name';
  end if;

  if p_customer_id is not null and not exists (
    select 1 from public.customers
    where id = p_customer_id and property_id = v_property and merged_into_id is null
  ) then
    raise exception 'That customer is not on this property';
  end if;

  if p_room_type_id is not null and not exists (
    select 1 from public.room_types
    where id = p_room_type_id and property_id = v_property
  ) then
    raise exception 'That room type is not on this property';
  end if;

  insert into public.booking_waitlist (
    property_id, customer_id, contact_name, contact_email, contact_phone,
    room_type_id, check_in, check_out, adults, children, notes, created_by
  ) values (
    v_property, p_customer_id, v_name,
    nullif(btrim(coalesce(p_contact_email, '')), ''),
    nullif(btrim(coalesce(p_contact_phone, '')), ''),
    p_room_type_id, p_check_in, p_check_out,
    greatest(coalesce(p_adults, 1), 1), greatest(coalesce(p_children, 0), 0),
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid()
  )
  returning id into v_id;

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'waitlist', v_id, 'waitlist_added',
    format('Added %s to the waitlist for %s to %s',
           coalesce(v_name, 'a guest'), p_check_in, p_check_out),
    jsonb_build_object('check_in', p_check_in, 'check_out', p_check_out)
  );

  return v_id;
end;
$function$;


/* -------------------------------------------------------------------------- */
/* Moving an entry along                                                      */
/* -------------------------------------------------------------------------- */

/*
 * One function for every status change, because they are the same decision
 * made four ways and splitting them would mean four places to keep the
 * converted-booking rule in step.
 *
 * Converting takes the booking that was made. It does NOT make the booking:
 * taking a reservation goes through `create_booking()` and nothing else, and a
 * waitlist that could mint one would be a second booking path with none of the
 * inventory checks.
 */
create function public.set_waitlist_status(
  p_id uuid,
  p_status public.waitlist_status,
  p_booking_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_property uuid;
  v_found uuid;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, manager and admin staff can change a waitlist entry';
  end if;

  v_property := public.current_property_id();

  if p_status = 'converted' then
    if p_booking_id is null then
      raise exception 'Say which booking the waitlist entry became';
    end if;
    if not exists (
      select 1 from public.bookings
      where id = p_booking_id and property_id = v_property
    ) then
      raise exception 'That booking is not on this property';
    end if;
  elsif p_booking_id is not null then
    -- Silently keeping the link on a non-converted status would leave the row
    -- failing its own check constraint, which is a confusing way to say this.
    raise exception 'Only a converted waitlist entry names a booking';
  end if;

  update public.booking_waitlist
  set status = p_status,
      converted_booking_id = case when p_status = 'converted' then p_booking_id end
  where id = p_id and property_id = v_property
  returning id into v_found;

  if v_found is null then
    raise exception 'That waitlist entry is not on this property';
  end if;

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'waitlist', p_id, 'waitlist_status_changed',
    format('Waitlist entry marked %s', p_status),
    jsonb_build_object('status', p_status, 'booking_id', p_booking_id)
  );
end;
$function$;

revoke all on function public.add_to_waitlist(
  date, date, uuid, text, text, text, uuid, smallint, smallint, text
) from public, anon;
grant execute on function public.add_to_waitlist(
  date, date, uuid, text, text, text, uuid, smallint, smallint, text
) to authenticated;

revoke all on function public.set_waitlist_status(uuid, public.waitlist_status, uuid)
  from public, anon;
grant execute on function public.set_waitlist_status(uuid, public.waitlist_status, uuid)
  to authenticated;
