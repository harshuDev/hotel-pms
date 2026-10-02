-- 0121: from the client's video review of the booking flow.
--
-- 1. MOVING A GUEST WHO IS ALREADY CHECKED IN MOVES THE ROOM STATUS TOO.
--    assign_room() re-pointed the booking and nothing else, so the room the
--    guest left stayed "occupied" with nobody in it -- refused to the next
--    guest by name ("still has ... checked in") or as "not ready" -- and the
--    room they went to read as vacant with a guest in it. The client moved
--    Junior from room 3 to 27 and then could not put anybody in 3. Now the new
--    room becomes occupied and the old one vacant_dirty, unless somebody else
--    is still checked in to it (the 0112 rule check-out follows).
--    A one-off repair puts right rooms already left in that state: occupied
--    with nobody checked in becomes vacant_dirty; vacant with a guest checked
--    in becomes occupied. Only rooms in those contradictory states are touched.
--
-- 2. booking_quote(): what create_booking() would charge, before it is taken.
--    The client: "when I choose the rate the rate has to show the price of
--    this rate here automatically, then I can change it", and "we need to
--    have the grand total ... the total amount they have to charge". The form
--    could show neither, because a night is priced for its party only in
--    Postgres (rate_plan_night_rate(), 0110). This prices every room line
--    exactly as create_booking() does -- the plan's night rate for that
--    party, or the typed rate, less the best offer, through the chosen taxes
--    -- and writes nothing. Per line: the nightly range, the room's price,
--    tax and total, the line total for its quantity, the first night with no
--    rate loaded (which create_booking() would refuse), and the offer applied;
--    and the booking's tax and grand total, summed here so the form does no
--    arithmetic on money. A quote is advice: create_booking() still decides.

create or replace function public.assign_room(
  p_booking_room_id uuid,
  p_room_id uuid,
  p_allow_type_change boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_br public.booking_rooms;
  v_room public.rooms;
  v_sold_type text;
  v_in record;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, management or an administrator may assign a room';
  end if;

  select * into v_br
  from public.booking_rooms
  where id = p_booking_room_id and property_id = public.current_property_id();

  if not found then
    raise exception 'That booked room does not belong to this property';
  end if;

  if v_br.status in ('canceled', 'no_show', 'checked_out') then
    raise exception 'A % booking cannot be given a room', v_br.status;
  end if;

  select * into v_room
  from public.rooms
  where id = p_room_id and property_id = v_br.property_id;

  if not found then
    raise exception 'That room does not belong to this property';
  end if;

  -- An upgrade is deliberate, never accidental. The sold type and the nightly
  -- rates are never rewritten: the same money, a better room.
  if v_room.room_type_id <> v_br.room_type_id
     and not coalesce(p_allow_type_change, false)
  then
    select rt.name into v_sold_type from public.room_types rt
    where rt.id = v_br.room_type_id and rt.property_id = v_br.property_id;

    raise exception
      'Room % is not a %, which is what this booking was sold. Confirm the upgrade to put the guest in it.',
      v_room.number, coalesce(v_sold_type, 'that type')
      using errcode = 'HP003';
  end if;

  -- Readiness is only a question for a stay that has already started (0053).
  if v_br.check_in <= coalesce(
       (select bd.business_date from public.business_dates bd
         where bd.property_id = v_br.property_id and bd.status = 'open'),
       v_br.check_in
     )
     and v_room.status <> 'vacant_clean'
  then
    -- Occupied by whom (0111): a room still holding a guest past their
    -- departure looks empty on the board, so "occupied" alone reads as a bug.
    if v_room.status = 'occupied' then
      select b.reference,
             coalesce(public.customer_display_name(c), 'No name recorded') as guest,
             br.check_out
        into v_in
      from public.booking_rooms br
      join public.bookings b on b.id = br.booking_id and b.property_id = br.property_id
      left join public.customers c on c.id = b.customer_id and c.property_id = b.property_id
      where br.room_id = v_room.id
        and br.property_id = v_room.property_id
        and br.status = 'checked_in'
        and br.id <> v_br.id
      order by br.check_out
      limit 1;
      if found then
        raise exception 'Room % still has % (%) checked in, due out %. Check them out first.',
          v_room.number, v_in.guest, v_in.reference, to_char(v_in.check_out, 'FMDD Mon YYYY');
      end if;
    end if;
    raise exception 'Room % is %, so it is not ready for a guest', v_room.number, v_room.status;
  end if;

  if exists (
    select 1
    from public.booking_rooms taken
    where taken.room_id = p_room_id
      and taken.property_id = v_br.property_id
      and taken.id <> p_booking_room_id
      and taken.status not in ('canceled', 'no_show', 'checked_out')
      and daterange(taken.check_in, taken.check_out, '[)')
          && daterange(v_br.check_in, v_br.check_out, '[)')
  ) then
    raise exception
      'Room % is already taken for part of % to %',
      v_room.number, v_br.check_in, v_br.check_out;
  end if;

  update public.booking_rooms
  set room_id = p_room_id
  where id = p_booking_room_id and property_id = v_br.property_id;

  -- A GUEST ALREADY CHECKED IN MOVES WITH THEIR ROOM STATUS (0121). Until now
  -- only the booking was re-pointed: the room they left stayed "occupied" with
  -- nobody in it, and the room they went to read as vacant with a guest in it.
  -- The client moved Junior from 3 to 27 and could not put anyone in 3 again.
  if v_br.status = 'checked_in' and v_br.room_id is distinct from p_room_id then
    update public.rooms r
    set status = 'occupied'
    where r.id = p_room_id and r.property_id = v_br.property_id
      and r.status <> 'occupied';

    -- The room left behind is dirty, never ready -- unless somebody else is
    -- still checked in to it, whose room it still is (the 0112 rule).
    if v_br.room_id is not null then
      update public.rooms r
      set status = 'vacant_dirty'
      where r.id = v_br.room_id and r.property_id = v_br.property_id
        and r.status = 'occupied'
        and not exists (
          select 1 from public.booking_rooms other
          where other.room_id = r.id
            and other.property_id = r.property_id
            and other.status = 'checked_in'
        );
    end if;
  end if;
end;
$function$;

revoke all on function public.assign_room(uuid, uuid, boolean) from public, anon;
grant execute on function public.assign_room(uuid, uuid, boolean) to authenticated;

-- The repair. Status changes go through the ordinary triggers (history, the
-- housekeeping flags), as any status change does.
update public.rooms r
set status = 'vacant_dirty'
where r.status = 'occupied'
  and not exists (
    select 1 from public.booking_rooms br
    where br.room_id = r.id and br.property_id = r.property_id and br.status = 'checked_in'
  );

update public.rooms r
set status = 'occupied'
where r.status in ('vacant_clean', 'vacant_dirty')
  and exists (
    select 1 from public.booking_rooms br
    where br.room_id = r.id and br.property_id = r.property_id and br.status = 'checked_in'
  );

create or replace function public.booking_quote(
  p_check_in date,
  p_check_out date,
  p_rooms jsonb,
  p_rate_plan_id uuid default null,
  p_tax_rate_ids uuid[] default null,
  p_promotion_code text default null
)
returns table (
  line_no integer,
  nightly_from_cents bigint,
  nightly_to_cents bigint,
  room_price_cents bigint,
  room_tax_cents bigint,
  room_gross_cents bigint,
  line_gross_cents bigint,
  missing_date date,
  promotion_name text,
  total_tax_cents bigint,
  total_gross_cents bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_property uuid;
  v_line record;
  v_promo_name text;
  v_promotion_id uuid;
  v_night record;
  v_split record;
  v_from bigint;
  v_to bigint;
  v_price bigint;
  v_tax bigint;
  v_gross bigint;
  v_missing date;
  v_qty integer;
  v_adults integer;
  v_children integer;
  v_lines jsonb := '[]'::jsonb;
  v_total_tax bigint := 0;
  v_total_gross bigint := 0;
  i integer := 0;
begin
  if not coalesce(public.is_front_office_staff(), false) then
    raise exception 'Only front desk, manager and admin staff can take a booking';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in
     or p_check_out - p_check_in > 366
     or p_rooms is null or jsonb_typeof(p_rooms) <> 'array' then
    return;
  end if;

  if p_rate_plan_id is not null and not exists (
    select 1 from public.rate_plans rp
    where rp.id = p_rate_plan_id and rp.property_id = v_property
  ) then
    return;
  end if;

  for v_line in
    select
      (line ->> 'room_type_id')::uuid as room_type_id,
      greatest(coalesce((line ->> 'quantity')::integer, 1), 1) as quantity,
      (line ->> 'rate_cents')::bigint as rate_cents,
      (line ->> 'adults')::integer as adults,
      (line ->> 'children')::integer as children
    from jsonb_array_elements(p_rooms) as line
  loop
    i := i + 1;
    v_from := null; v_to := null; v_price := 0; v_tax := 0; v_gross := 0;
    v_missing := null; v_promotion_id := null; v_promo_name := null;
    v_qty := least(v_line.quantity, 50);
    v_adults := greatest(coalesce(v_line.adults, 1), 1);
    v_children := greatest(coalesce(v_line.children, 0), 0);

    if not exists (
      select 1 from public.room_types rt
      where rt.id = v_line.room_type_id and rt.property_id = v_property
    ) or (v_line.rate_cents is null and p_rate_plan_id is null) then
      continue;
    end if;

    -- The same offer create_booking() would apply: only to a line priced
    -- from the plan, never to a hand-typed rate.
    if v_line.rate_cents is null then
      select bp.promotion_id, bp.name into v_promotion_id, v_promo_name
      from public.best_promotion(
        p_rate_plan_id, v_line.room_type_id, p_check_in, p_check_out,
        current_date, nullif(btrim(coalesce(p_promotion_code, '')), '')
      ) bp;
    end if;

    for v_night in
      select
        gs::date as stay_date,
        coalesce(
          v_line.rate_cents,
          public.rate_plan_night_rate(
            p_rate_plan_id, v_line.room_type_id, gs::date, d.rate_cents, v_adults, v_children
          )
        ) as rate_cents,
        coalesce(pd.discount_cents, 0) as discount_cents
      from generate_series(p_check_in, p_check_out - 1, interval '1 day') as gs
      left join public.rate_plan_days d
        on d.property_id = v_property
       and d.rate_plan_id = p_rate_plan_id
       and d.room_type_id = v_line.room_type_id
       and d.stay_date = gs::date
      left join lateral (
        select n.discount_cents
        from public.promotion_night_discounts(
          v_promotion_id, p_rate_plan_id, v_line.room_type_id, p_check_in, p_check_out
        ) n
        where v_promotion_id is not null and n.stay_date = gs::date
      ) pd on true
      order by gs
    loop
      if v_night.rate_cents is null then
        v_missing := coalesce(v_missing, v_night.stay_date);
        continue;
      end if;
      v_from := least(coalesce(v_from, v_night.rate_cents), v_night.rate_cents);
      v_to := greatest(coalesce(v_to, v_night.rate_cents), v_night.rate_cents);

      select t.tax_cents, t.gross_cents into v_split
      from public.tax_split_multi(
        v_property, p_tax_rate_ids,
        greatest(v_night.rate_cents - v_night.discount_cents, 0)
      ) t;

      v_price := v_price + greatest(v_night.rate_cents - v_night.discount_cents, 0);
      v_tax := v_tax + coalesce(v_split.tax_cents, 0);
      v_gross := v_gross + coalesce(v_split.gross_cents, greatest(v_night.rate_cents - v_night.discount_cents, 0));
    end loop;

    if v_missing is null then
      v_total_tax := v_total_tax + v_tax * v_qty;
      v_total_gross := v_total_gross + v_gross * v_qty;
    end if;

    v_lines := v_lines || jsonb_build_object(
      'line_no', i,
      'from', v_from, 'to', v_to,
      'price', case when v_missing is null then v_price end,
      'tax', case when v_missing is null then v_tax end,
      'gross', case when v_missing is null then v_gross end,
      'line_gross', case when v_missing is null then v_gross * v_qty end,
      'missing', v_missing,
      'promotion', v_promo_name
    );
  end loop;

  return query
  select
    (l ->> 'line_no')::integer,
    (l ->> 'from')::bigint,
    (l ->> 'to')::bigint,
    (l ->> 'price')::bigint,
    (l ->> 'tax')::bigint,
    (l ->> 'gross')::bigint,
    (l ->> 'line_gross')::bigint,
    (l ->> 'missing')::date,
    l ->> 'promotion',
    v_total_tax,
    v_total_gross
  from jsonb_array_elements(v_lines) as l;
end;
$$;
revoke all on function public.booking_quote(date, date, jsonb, uuid, uuid[], text) from public, anon;
grant execute on function public.booking_quote(date, date, jsonb, uuid, uuid[], text) to authenticated;
