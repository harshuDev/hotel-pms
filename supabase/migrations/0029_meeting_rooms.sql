-- Layer 18: meeting rooms.
--
-- A separate booking module, confirmed with the client. The purpose is
-- availability visibility: staff see at a glance which meeting room is free on
-- which date, and book one in a couple of clicks.
--
-- Meeting rooms never go in `rooms`, and their bookings never go in `bookings`
-- or `booking_room_nights`. Occupancy, ADR, RevPAR and the revenue chart all
-- aggregate over those tables, and a meeting room sitting in `rooms` would
-- silently inflate every one of them — a hotel with six meeting rooms would
-- read six rooms emptier than it is, for ever, with nothing to show why.
--
-- The ~1,800 room rule does not apply here. A property has a handful of
-- meeting rooms, so a row-per-room calendar grid is the right shape.
--
-- Whole-day bookings, as confirmed: starts_on and ends_on are dates and the
-- range is inclusive at both ends, because a room booked "Monday to Wednesday"
-- is occupied on the Wednesday. That is the '[]' in the exclusion constraint,
-- and it is the one place this module differs from room bookings, where
-- check_out is the morning the guest leaves and is not a night stayed.

create table public.meeting_rooms (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  name text not null,
  capacity integer,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, property_id),
  unique (property_id, name),
  constraint meeting_rooms_capacity_positive
    check (capacity is null or capacity > 0)
);

create type public.meeting_room_booking_status as enum
  ('pending', 'confirmed', 'canceled');

create sequence public.meeting_room_reference_seq as bigint;

create function public.next_meeting_room_reference()
returns text
language sql
volatile
set search_path = public
as $$
  select 'MR-' || lpad(nextval('public.meeting_room_reference_seq')::text, 6, '0');
$$;

create table public.meeting_room_bookings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  meeting_room_id uuid not null,
  reference text not null,

  -- Required, per the client: a meeting room booking nobody can identify from
  -- the calendar is worse than an empty slot.
  event_name text not null,
  guest_count integer not null,

  -- Optional: an internal event has no customer, and a company enquiry may not
  -- have one yet. It becomes required the moment money is taken, because a
  -- folio has to belong to somebody.
  customer_id uuid,

  starts_on date not null,
  ends_on date not null,
  status public.meeting_room_booking_status not null default 'confirmed',
  comments text,

  -- Null when no money is taken. When there is a payment it posts folio_items
  -- and payments like any other charge, so append-only, signed_amount_cents
  -- and affects_drawer all keep applying. There is deliberately no amount
  -- column here: that would be a second money system the cashier drawer
  -- cannot see.
  folio_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,

  unique (id, property_id),
  unique (property_id, reference),
  foreign key (meeting_room_id, property_id)
    references public.meeting_rooms (id, property_id) on delete restrict,
  foreign key (customer_id, property_id)
    references public.customers (id, property_id) on delete restrict,
  foreign key (folio_id, property_id)
    references public.folios (id, property_id) on delete restrict,
  foreign key (created_by, property_id)
    references public.staff_users (id, property_id) on delete set null,

  constraint meeting_room_bookings_dates_valid check (ends_on >= starts_on),
  constraint meeting_room_bookings_guests_positive check (guest_count > 0),
  constraint meeting_room_bookings_event_named
    check (btrim(event_name) <> ''),

  -- Double-booking is prevented here, not in application code. Two people
  -- booking the same room for the same day at the same moment both see it free
  -- in their own form; only one of them gets past this.
  exclude using gist (
    meeting_room_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  ) where (status = 'confirmed')
);

create index meeting_room_bookings_property_dates_idx
  on public.meeting_room_bookings (property_id, starts_on, ends_on);
create index meeting_room_bookings_room_idx
  on public.meeting_room_bookings (meeting_room_id, starts_on);


-- The folio path, opened up ---------------------------------------------------
--
-- folios, folio_items and payments have always keyed everything to a booking,
-- with booking_id not null. A meeting room booking is not a booking in that
-- sense and must never become one, so the column becomes nullable and a folio
-- belongs to exactly one of the two things.
--
-- This is the least invasive way to let meeting room money through the ledger
-- that already exists. The alternative — a second set of money tables — would
-- put meeting room payments outside the cashier drawer, outside the financial
-- report and outside the append-only rules, which is exactly the outcome the
-- client's brief rules out.
--
-- Everything that reads money by property and business date keeps working
-- untouched: the financial report, the payments report and the cashier drawer
-- never join on booking_id. What does join on it — the debtors report, the
-- daily checkout report, the booking screen — keeps returning room bookings
-- only, which is correct for those and is a known gap for debtors.

alter table public.folios
  alter column booking_id drop not null,
  alter column customer_id drop not null;

alter table public.folio_items alter column booking_id drop not null;
alter table public.payments alter column booking_id drop not null;

-- A folio with neither a booking nor a meeting room booking pointing at it is
-- money attributed to nothing. The pointer lives on the meeting room booking,
-- so this is checked there rather than here.
alter table public.folios
  add constraint folios_guest_folio_has_customer check (
    booking_id is null or customer_id is not null
  );

-- v_folio.booking_id <> new.booking_id is null when either side is null, and
-- `if null` is false, so a mismatched meeting room row would have sailed
-- through. `is distinct from` is the null-safe comparison.
create or replace function public.validate_financial_record()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_folio public.folios;
  v_night_booking_id uuid;
begin
  select * into v_folio from public.folios
    where id = new.folio_id and property_id = new.property_id;
  if not found or v_folio.booking_id is distinct from new.booking_id then
    raise exception 'Financial record booking must match its folio booking';
  end if;
  if tg_table_name = 'folio_items' then
    if new.booking_room_night_id is not null then
      -- A meeting room charge has no room night, so this never fires for one.
      select br.booking_id into v_night_booking_id
      from public.booking_room_nights brn
      join public.booking_rooms br on br.id = brn.booking_room_id and br.property_id = brn.property_id
      where brn.id = new.booking_room_night_id and brn.property_id = new.property_id;
      if v_night_booking_id is null or v_night_booking_id <> new.booking_id then
        raise exception 'Room night must belong to the financial record booking';
      end if;
    end if;
  end if;
  return new;
end;
$$;

alter table public.meeting_rooms enable row level security;
alter table public.meeting_room_bookings enable row level security;

-- Anyone in the property reads the calendar: knowing which room is free is the
-- whole point. Front office books; only revenue staff configure the rooms.
create policy meeting_rooms_select_same_property on public.meeting_rooms
  for select using (property_id = public.current_property_id());
create policy meeting_rooms_insert_revenue on public.meeting_rooms
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy meeting_rooms_update_revenue on public.meeting_rooms
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy meeting_rooms_delete_revenue on public.meeting_rooms
  for delete using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

create policy meeting_room_bookings_select_same_property on public.meeting_room_bookings
  for select using (property_id = public.current_property_id());
create policy meeting_room_bookings_insert_front_office on public.meeting_room_bookings
  for insert with check (
    property_id = public.current_property_id() and public.is_front_office_staff()
  );
create policy meeting_room_bookings_update_front_office on public.meeting_room_bookings
  for update using (
    property_id = public.current_property_id() and public.is_front_office_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_front_office_staff()
  );

create trigger meeting_rooms_touch
  before update on public.meeting_rooms
  for each row execute function public.touch_updated_at();
create trigger meeting_room_bookings_touch
  before update on public.meeting_room_bookings
  for each row execute function public.touch_updated_at();

revoke all on function public.next_meeting_room_reference() from public, anon, authenticated;


-- The calendar ----------------------------------------------------------------
--
-- One row per meeting room per day, which is the grid the screen draws. A
-- handful of rooms over a few weeks, so unlike the house board this can safely
-- be a cell per room per day.

create function public.meeting_room_calendar(p_from date, p_days integer default 14)
returns table (
  meeting_room_id uuid,
  meeting_room_name text,
  capacity integer,
  stay_date date,
  booking_id uuid,
  reference text,
  event_name text,
  guest_count integer,
  customer_name text,
  status public.meeting_room_booking_status,
  starts_on date,
  ends_on date,
  is_first_day boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with span as (
    select d::date as stay_date
    from generate_series(
      p_from,
      p_from + greatest(coalesce(p_days, 14), 1) - 1,
      interval '1 day'
    ) as d
  )
  select
    mr.id,
    mr.name,
    mr.capacity,
    span.stay_date,
    b.id,
    b.reference,
    b.event_name,
    b.guest_count,
    public.customer_display_name(c),
    b.status,
    b.starts_on,
    b.ends_on,
    (b.starts_on = span.stay_date)
  from public.meeting_rooms mr
  cross join span
  -- Cancelled bookings leave no mark on the calendar: the room is free, and
  -- showing it as anything else is how a room ends up unsellable on paper.
  left join public.meeting_room_bookings b
    on b.meeting_room_id = mr.id
   and b.property_id = mr.property_id
   and b.status <> 'canceled'
   and span.stay_date between b.starts_on and b.ends_on
  left join public.customers c
    on c.id = b.customer_id and c.property_id = b.property_id
  where mr.property_id = public.current_property_id()
    and mr.is_active
  order by mr.sort_order, mr.name, span.stay_date;
$$;

comment on function public.meeting_room_calendar(date, integer) is
  'One row per meeting room per day, with the booking occupying it if any. Cancelled bookings are not shown: the room is free.';

-- One booking, with what it owes. Two hops to the folio because the pointer
-- lives on the booking, which is what keeps folios and meeting room bookings
-- from referencing each other in a circle.
create function public.meeting_room_booking_detail(p_booking_id uuid)
returns table (
  booking_id uuid,
  reference text,
  meeting_room_id uuid,
  meeting_room_name text,
  event_name text,
  guest_count integer,
  customer_id uuid,
  customer_name text,
  starts_on date,
  ends_on date,
  days integer,
  status public.meeting_room_booking_status,
  comments text,
  folio_id uuid,
  folio_number bigint,
  charges_cents bigint,
  payments_cents bigint,
  balance_cents bigint,
  booked_by text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    b.id,
    b.reference,
    b.meeting_room_id,
    mr.name,
    b.event_name,
    b.guest_count,
    b.customer_id,
    public.customer_display_name(c),
    b.starts_on,
    b.ends_on,
    ((b.ends_on - b.starts_on) + 1)::integer,
    b.status,
    b.comments,
    b.folio_id,
    f.folio_number,
    coalesce(fb.total_charges_cents, 0)::bigint,
    coalesce(fb.total_payments_cents, 0)::bigint,
    coalesce(fb.outstanding_cents, 0)::bigint,
    su.full_name,
    b.created_at
  from public.meeting_room_bookings b
  join public.meeting_rooms mr
    on mr.id = b.meeting_room_id and mr.property_id = b.property_id
  left join public.customers c
    on c.id = b.customer_id and c.property_id = b.property_id
  left join public.folios f
    on f.id = b.folio_id and f.property_id = b.property_id
  left join public.folio_balances fb
    on fb.folio_id = b.folio_id and fb.property_id = b.property_id
  left join public.staff_users su
    on su.id = b.created_by and su.property_id = b.property_id
  where b.id = p_booking_id
    and b.property_id = public.current_property_id();
$$;


-- Booking a meeting room ------------------------------------------------------

create function public.book_meeting_room(
  p_meeting_room_id uuid,
  p_event_name text,
  p_guest_count integer,
  p_starts_on date,
  p_ends_on date,
  p_customer_id uuid default null,
  p_comments text default null,
  p_status public.meeting_room_booking_status default 'confirmed'
)
returns table (booking_id uuid, reference text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_room public.meeting_rooms;
  v_clash record;
  v_id uuid;
  v_reference text;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, manager and admin staff can book a meeting room';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  select * into v_room from public.meeting_rooms
  where id = p_meeting_room_id and property_id = v_property and is_active;
  if not found then
    raise exception 'That meeting room is not available on this property';
  end if;

  if btrim(coalesce(p_event_name, '')) = '' then
    raise exception 'A meeting room booking needs an event name';
  end if;

  if p_guest_count is null or p_guest_count < 1 then
    raise exception 'A meeting room booking needs a guest count';
  end if;

  if p_ends_on < p_starts_on then
    raise exception 'The last day must not be before the first';
  end if;

  if v_room.capacity is not null and p_guest_count > v_room.capacity then
    raise exception
      '% seats %, and this is for %. Pick a bigger room or reduce the count.',
      v_room.name, v_room.capacity, p_guest_count;
  end if;

  if p_customer_id is not null and not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.property_id = v_property
  ) then
    raise exception 'That customer is not on this property';
  end if;

  -- The exclusion constraint is the real guard and still catches a race, but
  -- it reports a gist key clash, so this says the useful thing first.
  if coalesce(p_status, 'confirmed') = 'confirmed' then
    select b.reference, b.event_name, b.starts_on, b.ends_on into v_clash
    from public.meeting_room_bookings b
    where b.meeting_room_id = p_meeting_room_id
      and b.property_id = v_property
      and b.status = 'confirmed'
      and daterange(b.starts_on, b.ends_on, '[]')
          && daterange(p_starts_on, p_ends_on, '[]')
    order by b.starts_on
    limit 1;

    if found then
      raise exception
        '% is already booked for % from % to %.',
        v_room.name, v_clash.event_name,
        to_char(v_clash.starts_on, 'FMDay FMDD Mon'),
        to_char(v_clash.ends_on, 'FMDay FMDD Mon');
    end if;
  end if;

  v_reference := public.next_meeting_room_reference();

  insert into public.meeting_room_bookings (
    property_id, meeting_room_id, reference, event_name, guest_count,
    customer_id, starts_on, ends_on, status, comments, created_by
  ) values (
    v_property, p_meeting_room_id, v_reference, btrim(p_event_name), p_guest_count,
    p_customer_id, p_starts_on, p_ends_on, coalesce(p_status, 'confirmed'),
    nullif(btrim(coalesce(p_comments, '')), ''), auth.uid()
  )
  returning id into v_id;

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'meeting_room_booking', v_id, 'meeting_room_booked',
    format('%s booked for %s', v_room.name, btrim(p_event_name)),
    jsonb_build_object(
      'reference', v_reference,
      'meeting_room', v_room.name,
      'starts_on', p_starts_on,
      'ends_on', p_ends_on
    )
  );

  return query select v_id, v_reference;
end;
$$;

create function public.cancel_meeting_room_booking(
  p_booking_id uuid,
  p_reason text default null
)
returns bigint
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_booking public.meeting_room_bookings;
  v_outstanding bigint;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, manager and admin staff can cancel a meeting room booking';
  end if;

  v_property := public.current_property_id();

  select * into v_booking from public.meeting_room_bookings
  where id = p_booking_id and property_id = v_property;
  if not found then
    raise exception 'That meeting room booking is not on this property';
  end if;

  if v_booking.status = 'canceled' then
    raise exception 'Booking % is already cancelled', v_booking.reference;
  end if;

  -- As with a room booking, a balance does not stop this. Cancelling frees the
  -- room; it does not write off what is owed.
  select coalesce(sum(fb.outstanding_cents), 0) into v_outstanding
  from public.folio_balances fb
  where fb.folio_id = v_booking.folio_id and fb.property_id = v_property;

  update public.meeting_room_bookings
  set status = 'canceled',
      comments = case
        when nullif(btrim(coalesce(p_reason, '')), '') is null then comments
        else coalesce(comments || E'\n', '') || btrim(p_reason)
      end
  where id = p_booking_id and property_id = v_property;

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'meeting_room_booking', p_booking_id,
    'meeting_room_cancelled',
    format('Meeting room booking %s cancelled', v_booking.reference),
    jsonb_build_object('reference', v_booking.reference)
  );

  return v_outstanding;
end;
$$;

-- Charging for the room. The folio is made on the first charge and not before,
-- which is what makes folio_id null mean "no money was taken" rather than
-- "there is an empty folio nobody looked at".
create function public.charge_meeting_room_booking(
  p_booking_id uuid,
  p_amount_cents bigint,
  p_description text default null,
  p_tax_rate_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_booking public.meeting_room_bookings;
  v_room_name text;
  v_folio uuid;
  v_item uuid;
  v_currency char(3);
begin
  perform public.require_financial_staff();

  v_property := public.current_property_id();

  select * into v_booking from public.meeting_room_bookings
  where id = p_booking_id and property_id = v_property;
  if not found then
    raise exception 'That meeting room booking is not on this property';
  end if;

  if v_booking.status = 'canceled' then
    raise exception 'Booking % is cancelled', v_booking.reference;
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'A charge must be more than nothing';
  end if;

  if v_booking.customer_id is null then
    raise exception
      'Booking % has no customer, and a folio has to belong to somebody. Add the customer first.',
      v_booking.reference;
  end if;

  select mr.name into v_room_name from public.meeting_rooms mr
  where mr.id = v_booking.meeting_room_id and mr.property_id = v_property;

  v_folio := v_booking.folio_id;

  if v_folio is null then
    select p.currency into v_currency from public.properties p where p.id = v_property;

    insert into public.folios (
      property_id, booking_id, customer_id, kind, is_primary, currency
    ) values (
      v_property, null, v_booking.customer_id, 'guest', false, v_currency
    )
    returning id into v_folio;

    update public.meeting_room_bookings set folio_id = v_folio
    where id = p_booking_id and property_id = v_property;
  end if;

  -- post_charge() takes it from here, so the append-only rules, the business
  -- date and the tax split are all the same ones every other charge goes
  -- through. Nothing about meeting rooms is special once there is a folio.
  v_item := public.post_charge(
    v_folio,
    'miscellaneous',
    coalesce(
      nullif(btrim(coalesce(p_description, '')), ''),
      format('%s — %s', coalesce(v_room_name, 'Meeting room'), v_booking.event_name)
    ),
    p_amount_cents,
    1,
    null,
    p_tax_rate_id,
    null
  );

  return v_item;
end;
$$;

create function public.save_meeting_room(
  p_name text,
  p_id uuid default null,
  p_capacity integer default null,
  p_description text default null,
  p_sort_order integer default null,
  p_is_active boolean default true
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
    raise exception 'Only managers and administrators can set up meeting rooms';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'A meeting room needs a name';
  end if;

  if p_id is null then
    insert into public.meeting_rooms (
      property_id, name, capacity, description, sort_order, is_active
    ) values (
      v_property, btrim(p_name), p_capacity,
      nullif(btrim(coalesce(p_description, '')), ''),
      coalesce(
        p_sort_order,
        (select coalesce(max(sort_order) + 1, 0) from public.meeting_rooms where property_id = v_property)
      ),
      coalesce(p_is_active, true)
    )
    returning id into v_id;
  else
    update public.meeting_rooms set
      name = btrim(p_name),
      capacity = p_capacity,
      description = nullif(btrim(coalesce(p_description, '')), ''),
      sort_order = coalesce(p_sort_order, sort_order),
      is_active = coalesce(p_is_active, true)
    where id = p_id and property_id = v_property
    returning id into v_id;

    if v_id is null then
      raise exception 'That meeting room is not on this property';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.meeting_room_calendar(date, integer) from public, anon;
revoke all on function public.meeting_room_booking_detail(uuid) from public, anon;
revoke all on function public.book_meeting_room(
  uuid, text, integer, date, date, uuid, text, public.meeting_room_booking_status
) from public, anon;
revoke all on function public.cancel_meeting_room_booking(uuid, text) from public, anon;
revoke all on function public.charge_meeting_room_booking(uuid, bigint, text, uuid)
  from public, anon;
revoke all on function public.save_meeting_room(text, uuid, integer, text, integer, boolean)
  from public, anon;

grant execute on function public.meeting_room_calendar(date, integer) to authenticated;
grant execute on function public.meeting_room_booking_detail(uuid) to authenticated;
grant execute on function public.book_meeting_room(
  uuid, text, integer, date, date, uuid, text, public.meeting_room_booking_status
) to authenticated;
grant execute on function public.cancel_meeting_room_booking(uuid, text) to authenticated;
grant execute on function public.charge_meeting_room_booking(uuid, bigint, text, uuid)
  to authenticated;
grant execute on function public.save_meeting_room(text, uuid, integer, text, integer, boolean)
  to authenticated;
