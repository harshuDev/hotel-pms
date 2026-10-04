-- 0125: room charges post when the guest CHECKS OUT, not every night.
--
-- The client: "the charges are applied when the guest checks out, it doesn't
-- charge the client on the daily basis." Decided with them: replaced for
-- every hotel (not a setting), and every night is posted on the CHECK-OUT
-- business date -- closed days never change afterwards, so a closed day's
-- End of day report stays what it was. Occupancy, ADR and RevPAR read
-- booking_room_nights, not the folio, so they still count each night on its
-- own date; the money reports show a stay's room revenue on its departure day.
--
-- 1. close_business_date() posts nothing. It closes the day and opens the
--    next. Its two charge columns are DROPPED rather than left returning zero,
--    so the regenerated types make every caller a compile error.
-- 2. check_out_booking() posts, before the balance it returns is read, every
--    night of the stay that was slept (stay_date before the open business
--    date, status checked_in) and has no room charge yet -- with the extras
--    the rate sells "each night" -- then the "at check-out" extras as before.
--    A night already charged (by an audit before 0125) is never charged
--    twice; an early departure's unslept nights are not charged.
-- 3. post_room_charge() posts on the open business date, any night up to it,
--    never a night not yet reached. post_rate_plan_extras() posts an
--    "each night" extra on the open business date too; its night still keys
--    booking_extra_postings, so nothing posts twice.
-- 4. booking_checkout_charges() tells the check-out dialog what is about to
--    post, so it never calls a folio settled while the stay is uncharged.

create or replace function public.post_room_charge(
  p_folio_id uuid,
  p_booking_room_night_id uuid,
  p_business_date date default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_folio public.folios;
  v_night record;
  v_date date;
  v_id uuid;
  v_line uuid;
  v_net bigint;
  v_first date;
  v_inc record;
  -- The lines the night is split into; index 1 is always accommodation.
  v_nets bigint[];
  v_types public.folio_item_type[];
  v_descs text[];
  v_taxes bigint[];
  v_bds jsonb[];
  v_included bigint := 0;
  v_key text;
  v_part bigint;
  v_share bigint;
  v_given bigint;
  n integer;
  c integer;
begin
  perform public.require_financial_staff();

  select * into v_folio
  from public.folios
  where id = p_folio_id
    and property_id = public.current_property_id()
    and status = 'open';

  select brn.*, br.booking_id, br.rate_plan_id, br.adults, br.children into v_night
  from public.booking_room_nights brn
  join public.booking_rooms br
    on br.id = brn.booking_room_id and br.property_id = brn.property_id
  where brn.id = p_booking_room_night_id
    and brn.property_id = public.current_property_id();

  if not found or v_night.booking_id <> v_folio.booking_id then
    raise exception 'Room night does not belong to folio booking';
  end if;

  -- 0125: room charges post at check-out, so a night is posted on the open
  -- business date the guest leaves, never before the night itself.
  v_date := public.open_business_date(v_folio.property_id);
  if v_date is null or (p_business_date is not null and p_business_date <> v_date) then
    raise exception 'Room charge must post on the open business date';
  end if;
  if v_night.stay_date > v_date then
    raise exception 'A night cannot be charged before it is stayed';
  end if;

  v_net := v_night.room_rate_cents - v_night.discount_cents;
  if v_net < 0 then
    raise exception 'Room night discount exceeds room rate';
  end if;

  v_nets := array[0::bigint];
  v_types := array['room_charge'::public.folio_item_type];
  v_descs := array[format('Room charge for %s', v_night.stay_date)];

  -- What this night's rate includes, priced. A stay booked before 0037 has no
  -- rate_plan_id and so never splits.
  if v_night.rate_plan_id is not null and v_net > 0 then
    select coalesce(sum(rpm.value_cents), 0)::bigint into v_part
    from public.rate_plan_meals rpm
    where rpm.rate_plan_id = v_night.rate_plan_id
      and rpm.property_id = v_folio.property_id
      and rpm.value_cents is not null;
    if v_part > 0 then
      v_nets := v_nets || v_part;
      v_types := v_types || 'food_beverage'::public.folio_item_type;
      v_descs := v_descs || format('Meals included in the rate for %s', v_night.stay_date);
      v_included := v_included + v_part;
    end if;

    select min(x.stay_date) into v_first
    from public.booking_room_nights x
    where x.booking_room_id = v_night.booking_room_id
      and x.property_id = v_night.property_id
      and x.status not in ('canceled', 'no_show');

    for v_inc in
      select e.title, e.item_type,
             coalesce(rpe.price_cents, e.price_cents)
               * public.rate_plan_extra_units(rpe.per_unit, rpe.quantity, v_night.adults, v_night.children)
               as value_cents
      from public.rate_plan_extras rpe
      join public.extras e on e.id = rpe.extra_id and e.property_id = rpe.property_id
      where rpe.rate_plan_id = v_night.rate_plan_id
        and rpe.property_id = v_folio.property_id
        and rpe.posting = 'included'
        and (rpe.frequency = 'per_night' or v_night.stay_date = v_first)
      order by e.title
    loop
      continue when v_inc.value_cents <= 0;
      v_nets := v_nets || v_inc.value_cents;
      v_types := v_types || v_inc.item_type;
      v_descs := v_descs || format('%s included in the rate for %s', v_inc.title, v_night.stay_date);
      v_included := v_included + v_inc.value_cents;
    end loop;

    if v_included > v_net then
      raise exception
        'What this rate includes is priced at % but the night is worth %. Correct the meal values or the extras sold with the rate.',
        v_included, v_net;
    end if;
  end if;

  v_nets[1] := v_net - v_included;
  n := cardinality(v_nets);

  if n = 1 then
    insert into public.folio_items(
      property_id, folio_id, booking_id, booking_room_night_id, business_date,
      item_type, description, quantity, unit_amount_cents, net_amount_cents,
      tax_amount_cents, amount_cents, posted_by, tax_breakdown
    ) values (
      v_folio.property_id, v_folio.id, v_folio.booking_id,
      p_booking_room_night_id, v_date, 'room_charge', v_descs[1],
      1, v_net, v_net, v_night.tax_cents, v_net + v_night.tax_cents, auth.uid(),
      case when v_night.tax_cents > 0 then v_night.tax_breakdown end
    )
    returning id into v_id;
    return v_id;
  end if;

  -- Every tax on the night is shared across the lines by net; what integer
  -- division leaves goes to accommodation. A night with no per-tax split
  -- (taken before 0116) shares its one figure the same way.
  v_taxes := array_fill(0::bigint, array[n]);
  v_bds := array_fill('{}'::jsonb, array[n]);
  for v_key, v_part in
    select k, (v_night.tax_breakdown ->> k)::bigint
    from jsonb_object_keys(coalesce(v_night.tax_breakdown, '{}'::jsonb)) as k
    union all
    select '', v_night.tax_cents where v_night.tax_breakdown is null
  loop
    v_given := 0;
    for c in 2 .. n loop
      v_share := case when v_net = 0 then 0 else (v_part * v_nets[c]) / v_net end;
      v_taxes[c] := v_taxes[c] + v_share;
      v_bds[c] := v_bds[c] || jsonb_build_object(v_key, v_share);
      v_given := v_given + v_share;
    end loop;
    v_taxes[1] := v_taxes[1] + (v_part - v_given);
    v_bds[1] := v_bds[1] || jsonb_build_object(v_key, v_part - v_given);
  end loop;

  for c in 1 .. n loop
    insert into public.folio_items(
      property_id, folio_id, booking_id, booking_room_night_id, business_date,
      item_type, description, quantity, unit_amount_cents, net_amount_cents,
      tax_amount_cents, amount_cents, posted_by, tax_breakdown
    ) values (
      v_folio.property_id, v_folio.id, v_folio.booking_id,
      p_booking_room_night_id, v_date, v_types[c], v_descs[c],
      1, v_nets[c], v_nets[c], v_taxes[c], v_nets[c] + v_taxes[c], auth.uid(),
      case when v_night.tax_breakdown is not null and v_taxes[c] > 0 then v_bds[c] end
    )
    returning id into v_line;
    if c = 1 then
      v_id := v_line;
    end if;
  end loop;

  -- The accommodation line, as before.
  return v_id;
end;
$function$;

create or replace function public.post_rate_plan_extras(
  p_booking_room_id uuid,
  p_event text,
  p_date date default null
)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_room record;
  v_folio uuid;
  v_nights integer;
  v_x record;
  v_qty integer;
  v_item uuid;
  v_posted integer := 0;
begin
  select br.id, br.property_id, br.booking_id, br.rate_plan_id, br.adults, br.children,
         br.status, b.reference
    into v_room
  from public.booking_rooms br
  join public.bookings b on b.id = br.booking_id and b.property_id = br.property_id
  where br.id = p_booking_room_id;

  if not found or v_room.rate_plan_id is null or v_room.status in ('canceled', 'no_show') then
    return 0;
  end if;

  select count(*) into v_nights
  from public.booking_room_nights n
  where n.booking_room_id = v_room.id
    and n.property_id = v_room.property_id
    and n.status not in ('canceled', 'no_show');

  for v_x in
    select rpe.extra_id, rpe.frequency, rpe.per_unit, rpe.quantity,
           coalesce(rpe.price_cents, e.price_cents) as price_cents,
           e.title, e.item_type,
           coalesce(e.tax_rate_id, c.tax_rate_id) as tax_rate_id
    from public.rate_plan_extras rpe
    join public.extras e on e.id = rpe.extra_id and e.property_id = rpe.property_id
    left join public.extra_categories c on c.id = e.category_id and c.property_id = e.property_id
    where rpe.rate_plan_id = v_room.rate_plan_id
      and rpe.property_id = v_room.property_id
      and rpe.posting = 'added'
      and rpe.charge_on = p_event
    order by e.title
  loop
    v_qty := public.rate_plan_extra_units(v_x.per_unit, v_x.quantity, v_room.adults, v_room.children)
      * case when v_x.frequency = 'per_night' and p_event <> 'each_night' then v_nights else 1 end;
    continue when v_qty <= 0;

    continue when exists (
      select 1 from public.booking_extra_postings p
      where p.booking_room_id = v_room.id
        and p.extra_id = v_x.extra_id
        and p.event = p_event
        and p.stay_date is not distinct from (case when p_event = 'each_night' then p_date end)
    );

    if v_folio is null then
      select f.id into v_folio
      from public.folios f
      where f.booking_id = v_room.booking_id
        and f.property_id = v_room.property_id
        and f.status = 'open'
      order by f.is_primary desc, f.folio_number
      limit 1;
      if v_folio is null then
        raise exception 'Booking % has no open folio, so the extras sold with its rate cannot be charged',
          v_room.reference;
      end if;
    end if;

    v_item := public.post_charge(
      v_folio, v_x.item_type, v_x.title, v_x.price_cents, v_qty, null, v_x.tax_rate_id,
      null  -- 0125: posted on the open business date; p_date names the night
    );

    insert into public.booking_extra_postings (
      property_id, booking_room_id, extra_id, event, stay_date, folio_item_id
    ) values (
      v_room.property_id, v_room.id, v_x.extra_id, p_event,
      case when p_event = 'each_night' then p_date end, v_item
    );
    v_posted := v_posted + 1;
  end loop;

  return v_posted;
end;
$$;

create or replace function public.check_out_booking(p_booking_id uuid)
returns table (rooms_released integer, outstanding_cents bigint)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_booking public.bookings;
  v_count integer;
  v_owed bigint;
  v_br uuid;
  v_today date;
  v_folio uuid;
  r record;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, management or an administrator may check a guest out';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id and property_id = public.current_property_id()
  for update;

  if not found then
    raise exception 'That booking does not belong to this property';
  end if;

  if v_booking.status <> 'checked_in' then
    raise exception 'Booking % is %, so it cannot be checked out', v_booking.reference, v_booking.status;
  end if;

  v_today := public.open_business_date(v_booking.property_id);
  if v_today is null then
    raise exception 'There is no open business date';
  end if;

  -- The stay's room charges (0125), every night slept and not yet charged.
  for r in
    select n.id as night_id, n.booking_room_id, n.stay_date
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    where br.booking_id = v_booking.id
      and n.property_id = v_booking.property_id
      and n.status = 'checked_in'
      and n.stay_date < v_today
      and not exists (
        select 1 from public.folio_items fi
        where fi.booking_room_night_id = n.id
          and fi.item_type = 'room_charge'
          and fi.reverses_id is null
      )
    order by n.stay_date, n.booking_room_id
  loop
    if v_folio is null then
      select f.id into v_folio
      from public.folios f
      where f.booking_id = v_booking.id
        and f.property_id = v_booking.property_id
        and f.status = 'open'
      order by f.is_primary desc, f.folio_number
      limit 1;
      if v_folio is null then
        raise exception 'Booking % has no open folio, so its room charges cannot be posted', v_booking.reference;
      end if;
    end if;

    begin
      perform public.post_room_charge(v_folio, r.night_id, v_today);
      perform public.post_rate_plan_extras(r.booking_room_id, 'each_night', r.stay_date);
    exception when raise_exception then
      raise exception 'Booking %: %', v_booking.reference, sqlerrm;
    end;
  end loop;

  -- Extras the rate sells "at check-out" (0118), before the balance is read.
  for v_br in
    select br.id from public.booking_rooms br
    where br.booking_id = v_booking.id
      and br.property_id = v_booking.property_id
      and br.status not in ('canceled', 'no_show')
  loop
    perform public.post_rate_plan_extras(v_br, 'check_out');
  end loop;

  update public.bookings set status = 'checked_out' where id = v_booking.id;

  -- A room a guest has just left is dirty, never ready -- unless another guest
  -- is still checked in to it, whose room it still is (0112).
  update public.rooms r
  set status = 'vacant_dirty'
  from public.booking_rooms br
  where br.booking_id = v_booking.id
    and br.property_id = v_booking.property_id
    and br.room_id = r.id
    and r.property_id = v_booking.property_id
    and not exists (
      select 1 from public.booking_rooms other
      where other.room_id = r.id
        and other.property_id = r.property_id
        and other.booking_id <> v_booking.id
        and other.status = 'checked_in'
    );

  get diagnostics v_count = row_count;

  select coalesce(sum(greatest(fb.outstanding_cents, 0)), 0) into v_owed
  from public.folio_balances fb
  where fb.booking_id = v_booking.id
    and fb.property_id = v_booking.property_id;

  return query select v_count, v_owed;
end;
$$;

-- What checking this booking out now would post, and the balance after it.
-- security invoker: RLS decides what the caller sees. Extras sold with the
-- rate are not counted here; they post with the nights as before.
create or replace function public.booking_checkout_charges(p_booking_id uuid)
returns table (nights integer, room_charges_cents bigint, balance_cents bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with b as (
    select id, property_id from public.bookings where id = p_booking_id
  ), due as (
    select count(*)::integer as nights,
           coalesce(sum(n.room_rate_cents - n.discount_cents + n.tax_cents), 0)::bigint as cents
    from b
    join public.booking_rooms br on br.booking_id = b.id and br.property_id = b.property_id
    join public.booking_room_nights n on n.booking_room_id = br.id and n.property_id = br.property_id
    where n.status = 'checked_in'
      and n.stay_date < (select bd.business_date from public.business_dates bd
                         where bd.property_id = b.property_id and bd.status = 'open')
      and not exists (
        select 1 from public.folio_items fi
        where fi.booking_room_night_id = n.id
          and fi.item_type = 'room_charge'
          and fi.reverses_id is null
      )
  )
  select due.nights, due.cents,
         coalesce((select sum(fb.outstanding_cents) from public.folio_balances fb, b
                   where fb.booking_id = b.id and fb.property_id = b.property_id), 0)::bigint
  from due;
$$;

revoke all on function public.booking_checkout_charges(uuid) from public;
revoke execute on function public.booking_checkout_charges(uuid) from anon;
grant execute on function public.booking_checkout_charges(uuid) to authenticated;

drop function public.close_business_date();

create function public.close_business_date()
returns table (
  closed_date date,
  next_date date
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_bd public.business_dates;
  v_open_shifts integer;
begin
  -- coalesce, so a caller with no active staff row -- anonymous, or somebody
  -- deactivated since 0016 -- is refused rather than falling through a null.
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

  -- No no-show sweep (0064), and no room charges (0125): a stay is charged
  -- when the guest checks out.

  update public.business_dates
  set status = 'closed', closed_at = now(), closed_by = auth.uid()
  where id = v_bd.id;

  insert into public.business_dates (property_id, business_date, status, opened_by)
  values (v_property, v_bd.business_date + 1, 'open', auth.uid());

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'business_date', v_bd.id, 'business_date_closed',
    format('Business date %s closed', v_bd.business_date),
    jsonb_build_object('closed_date', v_bd.business_date, 'next_date', v_bd.business_date + 1)
  );

  return query select v_bd.business_date, (v_bd.business_date + 1)::date;
end;
$$;

revoke all on function public.close_business_date() from public;
revoke execute on function public.close_business_date() from anon;
grant execute on function public.close_business_date() to authenticated;
