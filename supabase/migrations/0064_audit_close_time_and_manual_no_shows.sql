-- 0064  The night audit's cut-off time belongs to the property, and a no-show
--       is a person's decision rather than the clock's.
--
-- TWO CHANGES, BOTH FROM THE CLIENT, AND THE SECOND IS THE ONE THAT MATTERS.
--
-- 1. `properties.audit_close_time`. The client: "The clock will control each
--    property closing time. This is very important because a hotel in London
--    cannot run on the same time as a hotel in Mexico for example." The zone
--    was already per property; the HOUR was not, and asked as "Can each hotel
--    choose their cut-off time? Or it has to be set at a system level?" it is
--    per hotel. A city hotel and a resort do not close at the same hour.
--
-- 2. `close_business_date()` NO LONGER MARKS ANYBODY A NO-SHOW. This reverses
--    0040, which swept every confirmed booking whose arrival had been reached
--    and nobody had checked in, released its rooms and billed the first night.
--    The client, on being told the audit would do that unattended: "No show
--    should be manual because sometimes people arrive late because of a
--    delayed flight or whatever reason" and "we don't want it to automatically
--    cancelled reservations of guests that have not arrived at the property.
--    It would generate chaos for the hotel."
--
--    They are right, and it is the kind of wrong that is expensive: a guest
--    landing at 4am on a delayed flight, whose room went back on sale at 2am
--    and was billed a no-show fee they never agreed to, is an argument at the
--    desk and a refund on the folio.
--
--    NOTHING IS LOST, because the manual path already exists: the cancel
--    dialog on the booking screen carries a "Mark no show" tickbox, which
--    calls the same `cancel_booking(..., p_no_show => true)` the sweep called.
--    So this migration deletes a caller, not a capability. What it moves is
--    WHO decides, which was the client's whole point.
--
--    The consequence to know about: a booking whose guest never arrives now
--    stays `confirmed` and holds its rooms until somebody deals with it. It is
--    never billed — the room-charge loop below only posts nights whose status
--    is `checked_in`, so nobody is charged for a bed they did not sleep in —
--    but the room reads as sold and cannot be resold. An overdue-arrivals list
--    is the answer to that and is not in this migration.

/* -------------------------------------------------------------------------- */
/* 1. The property's own cut-off time                                         */
/* -------------------------------------------------------------------------- */

-- `time` and not `timestamptz`: it is an hour on the hotel's own clock, and
-- `properties.timezone` is what turns it into a moment. 02:00 is the default
-- because that is what the client asked for and what most hotels run.
--
-- NOT NULL with a default, unlike `check_in_time` and `check_out_time`, which
-- are nullable for historical reasons. There is no sensible "no cut-off": the
-- day has to close at some hour.
alter table public.properties
  add column if not exists audit_close_time time not null default '02:00';

comment on column public.properties.audit_close_time is
  'The hour, on this property''s own clock, at which its business date closes. Read with properties.timezone, never with the server''s local time.';

/* -------------------------------------------------------------------------- */
/* 2. save_property() carries it                                              */
/* -------------------------------------------------------------------------- */

-- DROPPED FIRST, not `create or replace`. A different parameter list is a new
-- function and not a replacement, so replacing would leave two `save_property`
-- functions side by side and PostgREST would refuse to choose between them --
-- the same overload trap that keeps `set_room_photo()` and
-- `set_rate_plan_cancellation_policy()` out of the functions they belong to.
--
-- A null audit time is refused by name, exactly as the two existing times are.
-- An optional parameter silently meaning "leave it alone" would make a cleared
-- field read as a save that did nothing.
drop function if exists public.save_property(text, text, character, time, time);

create function public.save_property(
  p_name text,
  p_timezone text,
  p_currency char(3),
  p_check_in_time time default null,
  p_check_out_time time default null,
  p_audit_close_time time default null
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_property uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the property';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'The property needs a name';
  end if;

  -- The times are what every arrival and departure is timed against, and a
  -- booking cannot be taken without them, so there is no blank to fall back to.
  if p_check_in_time is null then
    raise exception 'The property needs a check-in time, like 15:00';
  end if;

  if p_check_out_time is null then
    raise exception 'The property needs a check-out time, like 11:00';
  end if;

  if p_audit_close_time is null then
    raise exception 'The property needs a night audit time, like 02:00';
  end if;

  -- now() at time zone raises on an unknown zone, which is the cheapest way to
  -- refuse one before it becomes every business date this property computes.
  perform now() at time zone p_timezone;

  update public.properties set
    name = btrim(p_name),
    timezone = p_timezone,
    currency = upper(p_currency),
    check_in_time = p_check_in_time,
    check_out_time = p_check_out_time,
    audit_close_time = p_audit_close_time
  where id = v_property;
end;
$$;

revoke execute on function public.save_property(text, text, char(3), time, time, time) from public, anon;
grant execute on function public.save_property(text, text, char(3), time, time, time) to authenticated;

/* -------------------------------------------------------------------------- */
/* 3. close_business_date() without the no-show sweep                         */
/* -------------------------------------------------------------------------- */

-- Dropped rather than replaced, because the return type loses two columns.
-- That is deliberate: `no_shows_marked` and `no_show_fees_cents` returning a
-- permanent zero would be two figures on the confirmation dialog that can
-- never be anything else. Dropping them makes every call site a compile error
-- once the types are regenerated, which is how nothing gets missed.
drop function if exists public.close_business_date();

create function public.close_business_date()
returns table (
  closed_date date,
  next_date date,
  room_charges_posted integer,
  room_charges_cents bigint
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_bd public.business_dates;
  v_open_shifts integer;
  v_posted integer := 0;
  v_cents bigint := 0;
  v_folio uuid;
  r record;
begin
  -- coalesce, so a caller with no active staff row -- anonymous, or somebody
  -- deactivated since 0016 -- is refused rather than falling through a null.
  -- `not in` alone evaluates to null for exactly those callers, and plpgsql
  -- treats a null `if` as false, so the guard was skipped by the only
  -- callers it exists to stop.
  if not coalesce(public.current_role() in ('admin', 'manager'), false) then
    raise exception 'Only an administrator or manager may close the business date';
  end if;

  v_property := public.current_property_id();

  select * into v_bd
  from public.business_dates
  where property_id = v_property and status = 'open'
  for update;

  if not found then
    raise exception 'There is no open business date to close';
  end if;

  select count(*) into v_open_shifts
  from public.cashier_shifts
  where property_id = v_property
    and business_date_id = v_bd.id
    and status in ('open', 'closing');

  if v_open_shifts > 0 then
    raise exception
      'Close the % open cashier shift(s) before closing the business date',
      v_open_shifts;
  end if;

  -- THE NO-SHOW SWEEP THAT STOOD HERE IS GONE. See the header. A confirmed
  -- booking whose guest has not arrived is left exactly as it is: still
  -- confirmed, still holding its rooms, and still unbilled -- the loop below
  -- posts only nights that are `checked_in`, so nobody is charged for a room
  -- they never occupied.

  for r in
    select
      n.id as night_id,
      br.booking_id,
      b.reference,
      n.room_rate_cents,
      n.tax_cents,
      n.discount_cents
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    join public.bookings b
      on b.id = br.booking_id and b.property_id = br.property_id
    where n.property_id = v_property
      and n.stay_date = v_bd.business_date
      and n.status = 'checked_in'
      and not exists (
        select 1
        from public.folio_items fi
        where fi.booking_room_night_id = n.id
          and fi.item_type = 'room_charge'
          and fi.reverses_id is null
      )
    order by b.reference
  loop
    select f.id into v_folio
    from public.folios f
    where f.booking_id = r.booking_id
      and f.property_id = v_property
      and f.status = 'open'
    order by f.is_primary desc, f.folio_number
    limit 1;

    if v_folio is null then
      raise exception
        'Booking % has no open folio, so its room charge for % cannot be posted',
        r.reference, v_bd.business_date;
    end if;

    perform public.post_room_charge(v_folio, r.night_id, v_bd.business_date);

    v_posted := v_posted + 1;
    v_cents := v_cents + (r.room_rate_cents - r.discount_cents + r.tax_cents);
  end loop;

  update public.business_dates
  set status = 'closed', closed_at = now(), closed_by = auth.uid()
  where id = v_bd.id;

  insert into public.business_dates (property_id, business_date, status, opened_by)
  values (v_property, v_bd.business_date + 1, 'open', auth.uid());

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'business_date', v_bd.id, 'business_date_closed',
    format('Business date %s closed, %s room charge(s) posted',
           v_bd.business_date, v_posted),
    jsonb_build_object(
      'closed_date', v_bd.business_date,
      'next_date', v_bd.business_date + 1,
      'room_charges_posted', v_posted,
      'room_charges_cents', v_cents
    )
  );

  return query
  select
    v_bd.business_date,
    (v_bd.business_date + 1)::date,
    v_posted,
    v_cents;
end;
$$;

-- `revoke ... from public` does not take the grant off `anon`: the project
-- carries `alter default privileges ... grant execute on functions to anon`,
-- so a freshly created function comes out executable by anon however carefully
-- PUBLIC is revoked. Both revokes, every time. (0047.)
revoke execute on function public.close_business_date() from public, anon;
grant execute on function public.close_business_date() to authenticated;
