-- 0129: the rest of the reference's folio -- several folios, Move To, Add
-- discount, folio notes.
--
-- The client: "please copy and make them exactly like in the previous
-- system". Every one of these is a money change, so each is built on the
-- append-only rules rather than around them.
--
-- 1. ADD FOLIO. add_folio() opens another folio on the booking (create_folio()
--    as the one place a folio is made). set_folio_customer() is the "Folio
--    For" pencil: a company can be billed on its own folio.
-- 2. MOVE TO. move_folio_items() moves posted charges to another folio of
--    the same booking: folio_items is append-only, so a move is a REVERSAL in
--    the folio it leaves and a COPY in the folio it joins, both on the open
--    business date -- revenue nets to nothing, the night it belongs to stays
--    the same. Moving an accommodation line also routes that room's nights
--    not yet charged (booking_rooms.folio_id), so check-out posts them there.
--    - The unique index "one room charge per night" could not survive a move
--      (the copy is a second room_charge row for the night). It is replaced
--      by a trigger that keeps the rule it stood for: at most one LIVE
--      (unreversed) room charge per night.
--    - A line carrying a discount cannot be moved: a discount is the one row
--      allowed to point at it (one reversal per item), so it could not be
--      reversed in the folio it leaves. Refused by name.
-- 3. ADD DISCOUNT. apply_folio_discount() takes a percentage or an amount off
--    the ticked lines -- the Inventory -> Discounts catalog is what the
--    dialog offers, so that screen is live now.
--    - A POSTED line gets a discount row pointing at it, with the line's own
--      tax split shared out in proportion -- post_discount() posted a zero
--      tax split, which on an inclusive rate overstated the tax; it is not
--      used. One discount per line (the one-reversal-per-item index).
--    - A night NOT YET CHARGED (since 0125, every night until check-out) is
--      repriced the way an offer is: discount_cents grows and the tax is
--      worked out again on the lower price through tax_split_multi(), so the
--      night check-out posts is already the discounted one.
-- 4. NOTES. folios.notes ("Write Your Folio Notes") and folios.overlay_text
--    ("Write Your Folio Overlay Text"), set by set_folio_notes().
-- 5. booking_folio(booking, folio) shows ONE folio, and lists them all for
--    the tabs. record_folio_payment() takes the folio to pay into, and
--    booking_payment_rows() says which folio each payment is on. New names,
--    not changed signatures, so the 0127/0128 functions stay (unused) and
--    nothing has to be dropped.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.folios
  add column notes text,
  add column overlay_text text,
  add constraint folios_notes_length check (notes is null or char_length(notes) <= 2000),
  add constraint folios_overlay_length check (overlay_text is null or char_length(overlay_text) <= 200);

alter table public.booking_rooms
  add column folio_id uuid references public.folios(id) on delete set null;

-- ---------------------------------------------------------------------------
-- One live room charge per night, as a trigger
-- ---------------------------------------------------------------------------

drop index if exists public.folio_items_one_room_charge_per_night_idx;

create or replace function public.folio_items_one_live_room_charge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.item_type = 'room_charge' and new.reverses_id is null and new.booking_room_night_id is not null then
    perform pg_advisory_xact_lock(hashtext('room_charge:' || new.booking_room_night_id::text));
    if exists (
      select 1 from public.folio_items fi
      where fi.booking_room_night_id = new.booking_room_night_id
        and fi.item_type = 'room_charge'
        and fi.reverses_id is null
        and not exists (
          select 1 from public.folio_items r
          where r.reverses_id = fi.id and r.item_type = 'reversal'
        )
    ) then
      raise exception 'That night already carries a room charge';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.folio_items_one_live_room_charge() from public, anon, authenticated;

create trigger folio_items_one_live_room_charge
  before insert on public.folio_items
  for each row execute function public.folio_items_one_live_room_charge();

-- ---------------------------------------------------------------------------
-- Add Folio, Folio For, notes
-- ---------------------------------------------------------------------------

create or replace function public.add_folio(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_booking public.bookings;
  v_id uuid;
  v_number bigint;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, management or an administrator may add a folio';
  end if;
  select * into v_booking from public.bookings
  where id = p_booking_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That booking does not belong to this property';
  end if;
  v_id := public.create_folio(
    v_booking.id, 'guest'::public.folio_kind,
    not exists (select 1 from public.folios where booking_id = v_booking.id and is_primary)
  );
  select folio_number into v_number from public.folios where id = v_id;
  insert into public.activity_log (property_id, actor_id, entity_type, entity_id, action, summary, metadata)
  values (v_booking.property_id, auth.uid(), 'booking', v_booking.id, 'folio_added',
          format('Folio #%s added', v_number), jsonb_build_object('folio_id', v_id));
  return v_id;
end;
$$;

create or replace function public.set_folio_customer(p_folio_id uuid, p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_folio public.folios;
  v_customer public.customers;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, management or an administrator may change who a folio is for';
  end if;
  select * into v_folio from public.folios
  where id = p_folio_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That folio is not on this property';
  end if;
  select * into v_customer from public.customers
  where id = p_customer_id and property_id = v_folio.property_id and merged_into_id is null;
  if not found then
    raise exception 'That customer is not on this property';
  end if;
  update public.folios set customer_id = v_customer.id where id = v_folio.id;
  insert into public.activity_log (property_id, actor_id, entity_type, entity_id, action, summary, metadata)
  values (v_folio.property_id, auth.uid(), 'booking', v_folio.booking_id, 'folio_customer_changed',
          format('Folio #%s is now for %s', v_folio.folio_number, public.customer_display_name(v_customer)),
          jsonb_build_object('folio_id', v_folio.id, 'customer_id', v_customer.id));
end;
$$;

create or replace function public.set_folio_notes(p_folio_id uuid, p_notes text, p_overlay_text text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_folio public.folios;
begin
  perform public.require_financial_staff();
  select * into v_folio from public.folios
  where id = p_folio_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That folio is not on this property';
  end if;
  update public.folios
  set notes = nullif(btrim(p_notes), ''),
      overlay_text = nullif(btrim(p_overlay_text), '')
  where id = v_folio.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Move To
-- ---------------------------------------------------------------------------

create or replace function public.move_folio_items(
  p_target_folio_id uuid,
  p_item_ids uuid[],
  p_booking_room_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_target public.folios;
  v_today date;
  v_item public.folio_items;
  v_ids uuid[];
  v_one uuid;
  v_moved integer := 0;
  v_source_status text;
begin
  perform public.require_financial_staff();

  select * into v_target from public.folios
  where id = p_target_folio_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That folio is not on this property';
  end if;
  if v_target.status <> 'open' then
    raise exception 'Folio #% is closed, so nothing can be moved to it', v_target.folio_number;
  end if;

  v_today := public.open_business_date(v_target.property_id);
  if v_today is null then
    raise exception 'There is no open business date';
  end if;

  -- The ticked lines, plus every live charge posted for the ticked rooms'
  -- nights in the booking's other folios.
  select coalesce(array_agg(distinct x), '{}') into v_ids
  from (
    select unnest(coalesce(p_item_ids, '{}'::uuid[])) as x
    union
    select fi.id
    from public.folio_items fi
    join public.booking_room_nights n on n.id = fi.booking_room_night_id
    where n.booking_room_id = any (coalesce(p_booking_room_ids, '{}'::uuid[]))
      and fi.booking_id = v_target.booking_id
      and fi.folio_id <> v_target.id
      and fi.reverses_id is null
      and not exists (select 1 from public.folio_items r where r.reverses_id = fi.id and r.item_type = 'reversal')
  ) s;

  foreach v_one in array v_ids loop
    select * into v_item from public.folio_items
    where id = v_one and property_id = v_target.property_id;
    if not found or v_item.booking_id is distinct from v_target.booking_id then
      raise exception 'Only charges on this booking can be moved between its folios';
    end if;
    continue when v_item.folio_id = v_target.id;
    if v_item.reverses_id is not null then
      raise exception '"%" is a reversal or a discount and moves with the line it belongs to', v_item.description;
    end if;
    if exists (select 1 from public.folio_items r where r.reverses_id = v_item.id and r.item_type = 'discount') then
      raise exception '"%" carries a discount, so it cannot be moved', v_item.description;
    end if;
    continue when exists (select 1 from public.folio_items r where r.reverses_id = v_item.id);
    select status::text into v_source_status from public.folios where id = v_item.folio_id;
    if v_source_status <> 'open' then
      raise exception '"%" is on a closed folio, so it cannot be moved', v_item.description;
    end if;

    -- Out of the folio it leaves...
    insert into public.folio_items (
      property_id, folio_id, booking_id, booking_room_night_id, business_date, item_type, description,
      quantity, unit_amount_cents, net_amount_cents, tax_amount_cents, amount_cents, tax_rate_id,
      reverses_id, posted_by, tax_breakdown
    ) values (
      v_item.property_id, v_item.folio_id, v_item.booking_id, v_item.booking_room_night_id, v_today, 'reversal',
      format('Moved to folio #%s: %s', v_target.folio_number, v_item.description),
      v_item.quantity, v_item.unit_amount_cents, v_item.net_amount_cents, v_item.tax_amount_cents, v_item.amount_cents,
      v_item.tax_rate_id, v_item.id, auth.uid(), v_item.tax_breakdown
    );
    -- ...and into the one it joins, the same charge.
    insert into public.folio_items (
      property_id, folio_id, booking_id, booking_room_night_id, business_date, item_type, description,
      quantity, unit_amount_cents, net_amount_cents, tax_amount_cents, amount_cents, tax_rate_id,
      reverses_id, posted_by, tax_breakdown
    ) values (
      v_item.property_id, v_target.id, v_item.booking_id, v_item.booking_room_night_id, v_today, v_item.item_type,
      v_item.description,
      v_item.quantity, v_item.unit_amount_cents, v_item.net_amount_cents, v_item.tax_amount_cents, v_item.amount_cents,
      v_item.tax_rate_id, null, auth.uid(), v_item.tax_breakdown
    );
    v_moved := v_moved + 1;
  end loop;

  -- The ticked rooms' nights not charged yet post to this folio at check-out.
  update public.booking_rooms br
  set folio_id = v_target.id
  where br.id = any (coalesce(p_booking_room_ids, '{}'::uuid[]))
    and br.booking_id = v_target.booking_id
    and br.property_id = v_target.property_id;

  insert into public.activity_log (property_id, actor_id, entity_type, entity_id, action, summary, metadata)
  values (v_target.property_id, auth.uid(), 'booking', v_target.booking_id, 'folio_items_moved',
          format('%s charge(s) moved to folio #%s', v_moved, v_target.folio_number),
          jsonb_build_object('folio_id', v_target.id, 'moved', v_moved, 'rooms', p_booking_room_ids));

  return v_moved;
end;
$$;

-- ---------------------------------------------------------------------------
-- Add discount
-- ---------------------------------------------------------------------------

-- The lines a discount reaches, in a fixed order: the folio's live posted
-- lines that are ticked or belong to a ticked room's nights, then the ticked
-- rooms' nights not charged anywhere yet that post to this folio. Granted to
-- nobody; apply_folio_discount() reads it.
create or replace function public.folio_discount_targets(
  p_folio_id uuid,
  p_primary_id uuid,
  p_item_ids uuid[],
  p_booking_room_ids uuid[]
)
returns table (kind text, id uuid, gross bigint, ord bigint)
language sql
stable
security definer
set search_path = public
as $$
  select 'item'::text, fi.id, fi.amount_cents::bigint,
         row_number() over (order by fi.posted_at, fi.id)
  from public.folio_items fi
  where fi.folio_id = p_folio_id
    and fi.reverses_id is null
    and fi.amount_cents > 0
    and not exists (select 1 from public.folio_items r where r.reverses_id = fi.id)
    and (
      fi.id = any (coalesce(p_item_ids, '{}'::uuid[]))
      or fi.booking_room_night_id in (
        select n.id from public.booking_room_nights n
        where n.booking_room_id = any (coalesce(p_booking_room_ids, '{}'::uuid[]))
      )
    )
  union all
  select 'night'::text, n.id, (n.room_rate_cents - n.discount_cents + n.tax_cents)::bigint,
         1000000 + row_number() over (order by n.stay_date, n.id)
  from public.booking_room_nights n
  join public.booking_rooms br on br.id = n.booking_room_id
  join public.folios fo on fo.id = p_folio_id and fo.booking_id = br.booking_id
  where br.id = any (coalesce(p_booking_room_ids, '{}'::uuid[]))
    and n.status not in ('canceled', 'no_show')
    and n.room_rate_cents - n.discount_cents + n.tax_cents > 0
    and coalesce((select f.id from public.folios f where f.id = br.folio_id and f.status = 'open'), p_primary_id) = p_folio_id
    and not exists (
      select 1 from public.folio_items fi
      where fi.booking_room_night_id = n.id and fi.item_type = 'room_charge'
    );
$$;

revoke all on function public.folio_discount_targets(uuid, uuid, uuid[], uuid[]) from public, anon, authenticated;

create or replace function public.apply_folio_discount(
  p_folio_id uuid,
  p_item_ids uuid[],
  p_booking_room_ids uuid[],
  p_percent_bps integer,
  p_amount_cents bigint,
  p_description text
)
returns bigint
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_folio public.folios;
  v_primary uuid;
  v_today date;
  v_desc text;
  v_total bigint := 0;
  v_given bigint := 0;
  v_count integer;
  v_i integer := 0;
  v_share bigint;
  v_row record;
  v_net bigint;
  v_tax bigint;
  v_bd jsonb;
  v_key text;
  v_part bigint;
  v_left bigint;
  v_taxes uuid[];
  v_p0 bigint;
  v_n bigint;
  v_t bigint;
  v_b jsonb;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, management or an administrator may give a discount';
  end if;

  select * into v_folio from public.folios
  where id = p_folio_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That folio is not on this property';
  end if;
  if v_folio.status <> 'open' then
    raise exception 'Folio #% is closed, so it cannot be discounted', v_folio.folio_number;
  end if;

  if (p_percent_bps is null) = (p_amount_cents is null) then
    raise exception 'Give the discount as a percentage or as an amount';
  end if;
  if p_percent_bps is not null and (p_percent_bps < 1 or p_percent_bps > 10000) then
    raise exception 'A percentage discount is between 0.01 and 100';
  end if;
  if p_amount_cents is not null and p_amount_cents <= 0 then
    raise exception 'A discount must be more than zero';
  end if;

  v_today := public.open_business_date(v_folio.property_id);
  if v_today is null then
    raise exception 'There is no open business date';
  end if;
  v_desc := coalesce(nullif(btrim(p_description), ''), 'Discount');

  select id into v_primary from public.folios
  where booking_id = v_folio.booking_id and is_primary;

  -- A ticked line already discounted or reversed is refused, not skipped.
  if exists (
    select 1 from public.folio_items fi
    where fi.id = any (coalesce(p_item_ids, '{}'::uuid[]))
      and (fi.reverses_id is not null
           or exists (select 1 from public.folio_items r where r.reverses_id = fi.id))
  ) then
    raise exception 'A ticked line already carries a discount or was reversed, so it cannot be discounted again';
  end if;

  -- What is being discounted (public.folio_discount_targets): posted lines of
  -- this folio and the ticked rooms' nights not charged yet that post to it,
  -- each with what it is worth now.
  select coalesce(sum(t.gross), 0), count(*) into v_total, v_count
  from public.folio_discount_targets(v_folio.id, v_primary, p_item_ids, p_booking_room_ids) t;
  if v_count = 0 then
    raise exception 'Tick the lines to discount';
  end if;
  if p_amount_cents is not null and p_amount_cents > v_total then
    raise exception 'The discount is more than the ticked lines are worth';
  end if;

  for v_row in
    select * from public.folio_discount_targets(v_folio.id, v_primary, p_item_ids, p_booking_room_ids) t
    order by t.ord
  loop
    v_i := v_i + 1;
    if p_percent_bps is not null then
      v_share := (v_row.gross * p_percent_bps + 5000) / 10000;
    elsif v_i = v_count then
      v_share := p_amount_cents - v_given;          -- the pennies to the last line
    else
      v_share := (p_amount_cents * v_row.gross) / v_total;
    end if;
    v_share := least(v_share, v_row.gross);
    continue when v_share <= 0;
    v_given := v_given + v_share;

    if v_row.kind = 'item' then
      declare
        v_item public.folio_items;
      begin
        select * into v_item from public.folio_items where id = v_row.id;
        v_net := (v_share * v_item.net_amount_cents) / v_item.amount_cents;
        v_tax := v_share - v_net;
        v_bd := null;
        if v_item.tax_breakdown is not null and v_item.tax_amount_cents > 0 then
          v_bd := '{}'::jsonb;
          v_left := v_tax;
          for v_key, v_part in
            select key, (value)::bigint from jsonb_each_text(v_item.tax_breakdown) order by key
          loop
            v_part := (v_tax * v_part) / v_item.tax_amount_cents;
            v_bd := v_bd || jsonb_build_object(v_key, v_part);
            v_left := v_left - v_part;
          end loop;
          -- The rounding pennies to the first tax, so the parts add up.
          select key into v_key from jsonb_each_text(v_bd) order by key limit 1;
          v_bd := jsonb_set(v_bd, array[v_key], to_jsonb((v_bd ->> v_key)::bigint + v_left));
        end if;
        insert into public.folio_items (
          property_id, folio_id, booking_id, booking_room_night_id, business_date, item_type, description,
          quantity, unit_amount_cents, net_amount_cents, tax_amount_cents, amount_cents, tax_rate_id,
          reverses_id, posted_by, tax_breakdown
        ) values (
          v_item.property_id, v_item.folio_id, v_item.booking_id, v_item.booking_room_night_id, v_today, 'discount',
          v_desc, 1, v_share, v_net, v_tax, v_share, v_item.tax_rate_id, v_item.id, auth.uid(), v_bd
        );
      end;
    else
      declare
        v_night public.booking_room_nights;
        v_room public.booking_rooms;
      begin
        select * into v_night from public.booking_room_nights where id = v_row.id;
        select * into v_room from public.booking_rooms where id = v_night.booking_room_id;
        select coalesce(array_agg(k::uuid), '{}') into v_taxes
        from jsonb_object_keys(coalesce(v_night.tax_breakdown, '{}'::jsonb)) k;
        if cardinality(v_taxes) = 0 then
          update public.booking_room_nights
          set discount_cents = discount_cents + v_share
          where id = v_night.id;
        else
          -- The price before exclusive taxes and fees: the net after the
          -- discount so far, plus the inclusive taxes in it.
          select v_night.room_rate_cents - v_night.discount_cents
                 + coalesce(sum((b.value)::bigint) filter (
                     where tr.kind = 'tax' and tr.inclusion = 'inclusive'), 0)
            into v_p0
          from jsonb_each_text(v_night.tax_breakdown) b
          join public.tax_rates tr on tr.id = (b.key)::uuid;
          select t.net_cents, t.tax_cents, t.breakdown into v_n, v_t, v_b
          from public.tax_split_multi(v_night.property_id, v_taxes, greatest(v_p0 - v_share, 0), false,
                                      v_room.adults, v_room.children) t;
          update public.booking_room_nights
          set room_rate_cents = v_n + v_night.discount_cents + v_share,
              discount_cents = v_night.discount_cents + v_share,
              tax_cents = coalesce(v_t, 0),
              tax_breakdown = v_b
          where id = v_night.id;
        end if;
      end;
    end if;
  end loop;

  insert into public.activity_log (property_id, actor_id, entity_type, entity_id, action, summary, metadata)
  values (v_folio.property_id, auth.uid(), 'booking', v_folio.booking_id, 'folio_discount',
          format('Discount "%s" of %s.%s given on folio #%s', v_desc, v_given / 100,
                 lpad((v_given % 100)::text, 2, '0'), v_folio.folio_number),
          jsonb_build_object('folio_id', v_folio.id, 'cents', v_given,
                             'percent_bps', p_percent_bps, 'amount_cents', p_amount_cents));

  return v_given;
end;
$$;

-- ---------------------------------------------------------------------------
-- Check-out posts each room's nights to the folio it is routed to
-- ---------------------------------------------------------------------------

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
  v_primary uuid;
  v_folio uuid;
  v_n record;
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

  select f.id into v_primary
  from public.folios f
  where f.booking_id = v_booking.id and f.property_id = v_booking.property_id and f.status = 'open'
  order by f.is_primary desc, f.folio_number
  limit 1;

  -- The stay's room charges (0125), every night slept and not yet charged,
  -- each on the folio its room is routed to (0129), else the primary.
  for v_n in
    select n.id as night_id, n.booking_room_id, n.stay_date,
           (select f.id from public.folios f where f.id = br.folio_id and f.status = 'open') as routed
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
    v_folio := coalesce(v_n.routed, v_primary);
    if v_folio is null then
      raise exception 'Booking % has no open folio, so its room charges cannot be posted', v_booking.reference;
    end if;

    begin
      perform public.post_room_charge(v_folio, v_n.night_id, v_today);
      perform public.post_rate_plan_extras(v_n.booking_room_id, 'each_night', v_n.stay_date);
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

-- ---------------------------------------------------------------------------
-- The Folio tab, one folio at a time
-- ---------------------------------------------------------------------------

-- A new name rather than a changed signature: booking_folio_view(uuid) from
-- 0127 stays, unused, so nothing has to be dropped.
create or replace function public.booking_folio(p_booking_id uuid, p_folio_id uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with b as (
    select bk.id, bk.property_id
    from public.bookings bk
    where bk.id = p_booking_id
  ),
  all_folios as (
    select f.id, f.folio_number, f.status, f.opened_at, f.is_primary, f.notes, f.overlay_text,
           c.id as customer_id, public.customer_display_name(c) as customer_name
    from public.folios f
    join b on f.booking_id = b.id and f.property_id = b.property_id
    left join public.customers c on c.id = f.customer_id
  ),
  primary_folio as (
    select id from all_folios where status = 'open'
    order by is_primary desc, folio_number limit 1
  ),
  folio as (
    select * from all_folios
    where id = coalesce(p_folio_id, (select id from primary_folio),
                        (select id from all_folios order by is_primary desc, folio_number limit 1))
  ),
  -- Items of THIS folio posted against a night.
  night_items as (
    select fi.booking_room_night_id as night_id,
           sum(fi.signed_net_amount_cents)::bigint as net,
           sum(fi.signed_tax_amount_cents)::bigint as tax
    from public.folio_items fi
    where fi.folio_id = (select id from folio)
      and fi.booking_room_night_id is not null
    group by fi.booking_room_night_id
  ),
  nights as (
    -- Posted to this folio...
    select n.id, n.booking_room_id, n.stay_date, true as charged, ni.net, ni.tax
    from night_items ni
    join public.booking_room_nights n on n.id = ni.night_id
    where ni.net <> 0 or ni.tax <> 0
    union all
    -- ...or not charged anywhere yet, and routed here.
    select n.id, n.booking_room_id, n.stay_date, false,
           (n.room_rate_cents - n.discount_cents)::bigint, n.tax_cents::bigint
    from b
    join public.booking_rooms br on br.booking_id = b.id and br.property_id = b.property_id
    join public.booking_room_nights n on n.booking_room_id = br.id and n.property_id = br.property_id
    where n.status not in ('canceled', 'no_show')
      and not exists (
        select 1 from public.folio_items fi
        where fi.booking_room_night_id = n.id and fi.item_type = 'room_charge'
      )
      and coalesce(
            (select f.id from all_folios f where f.id = br.folio_id and f.status = 'open'),
            (select id from primary_folio)
          ) = (select id from folio)
  ),
  rooms as (
    select br.id, br.status, br.adults, br.children,
           coalesce(rt.display_name, rt.name) as room_type,
           r.number as room_number,
           rp.name as rate_plan,
           br.check_in
    from b
    join public.booking_rooms br on br.booking_id = b.id and br.property_id = b.property_id
    join public.room_types rt on rt.id = br.room_type_id
    left join public.rooms r on r.id = br.room_id
    left join public.rate_plans rp on rp.id = br.rate_plan_id
    where exists (select 1 from nights x where x.booking_room_id = br.id)
  ),
  tax_parts as (
    select key::uuid as tax_rate_id, (value)::bigint as cents, n.net as base, n.id as line
    from nights n
    join public.booking_room_nights brn on brn.id = n.id
    cross join lateral jsonb_each_text(coalesce(brn.tax_breakdown, '{}'::jsonb))
    where not n.charged
    union all
    select (bd.key)::uuid,
           (bd.value)::bigint * case when fi.reverses_id is null then 1 else -1 end,
           fi.signed_net_amount_cents, fi.id
    from public.folio_items fi
    cross join lateral jsonb_each_text(fi.tax_breakdown) bd
    where fi.folio_id = (select id from folio) and fi.tax_breakdown is not null
    union all
    select fi.tax_rate_id, fi.signed_tax_amount_cents, fi.signed_net_amount_cents, fi.id
    from public.folio_items fi
    where fi.folio_id = (select id from folio)
      and fi.tax_breakdown is null and fi.signed_tax_amount_cents <> 0
  ),
  taxes as (
    select tp.tax_rate_id, tr.name, tr.kind, tr.rate_bps, tr.fee_cents, tr.fee_per, tr.sort_order,
           sum(tp.cents)::bigint as cents,
           sum(tp.base)::bigint as base
    from tax_parts tp
    left join public.tax_rates tr on tr.id = tp.tax_rate_id
    group by tp.tax_rate_id, tr.name, tr.kind, tr.rate_bps, tr.fee_cents, tr.fee_per, tr.sort_order
    having sum(tp.cents) <> 0
  ),
  extras as (
    select fi.id, fi.description, fi.quantity, fi.item_type, fi.business_date,
           fi.signed_net_amount_cents as net,
           fi.signed_tax_amount_cents as tax,
           fi.signed_amount_cents as total,
           (fi.reverses_id is not null) as is_reversal,
           (fi.item_type = 'discount') as is_discount,
           exists (select 1 from public.folio_items rv where rv.reverses_id = fi.id and rv.item_type = 'reversal') as is_reversed,
           exists (select 1 from public.folio_items rv where rv.reverses_id = fi.id and rv.item_type = 'discount') as is_discounted,
           fi.posted_at
    from public.folio_items fi
    where fi.folio_id = (select id from folio)
      and fi.booking_room_night_id is null
  ),
  pays as (
    select p.id, p.business_date, p.paid_at, pm.name as method,
           p.signed_amount_cents as amount,
           (p.reverses_id is not null) as is_reversal
    from public.payments p
    left join public.payment_methods pm on pm.id = p.payment_method_id
    where p.folio_id = (select id from folio)
  ),
  sums as (
    select
      coalesce((select sum(net) from nights), 0)::bigint as acc_net,
      coalesce((select sum(tax) from nights), 0)::bigint as acc_tax,
      coalesce((select sum(net) from extras), 0)::bigint as ext_net,
      coalesce((select sum(tax) from extras), 0)::bigint as ext_tax,
      coalesce((select sum(amount) from pays), 0)::bigint as paid
  )
  select jsonb_build_object(
    'folios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'number', f.folio_number, 'status', f.status, 'is_primary', f.is_primary,
        'customer_name', f.customer_name) order by f.is_primary desc, f.folio_number)
      from all_folios f), '[]'::jsonb),
    'folio', (select jsonb_build_object(
                'id', f.id, 'number', f.folio_number, 'status', f.status, 'opened_at', f.opened_at,
                'is_primary', f.is_primary, 'notes', f.notes, 'overlay_text', f.overlay_text,
                'customer_id', f.customer_id, 'customer_name', f.customer_name)
              from folio f),
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'booking_room_id', r.id,
        'room_type', r.room_type,
        'room_number', r.room_number,
        'rate_plan', r.rate_plan,
        'status', r.status,
        'adults', r.adults,
        'children', r.children,
        'count', (select count(*) from nights n where n.booking_room_id = r.id),
        'net', (select coalesce(sum(n.net), 0) from nights n where n.booking_room_id = r.id),
        'tax', (select coalesce(sum(n.tax), 0) from nights n where n.booking_room_id = r.id),
        'discounted', exists (
          select 1 from nights n
          join public.booking_room_nights brn on brn.id = n.id
          where n.booking_room_id = r.id and not n.charged and brn.discount_cents > 0
        ) or exists (
          select 1 from public.folio_items fi
          join public.booking_room_nights brn on brn.id = fi.booking_room_night_id
          where brn.booking_room_id = r.id and fi.folio_id = (select id from folio) and fi.item_type = 'discount'
        ),
        'nights', (select jsonb_agg(jsonb_build_object(
                      'stay_date', n.stay_date, 'net', n.net, 'tax', n.tax, 'charged', n.charged)
                    order by n.stay_date)
                   from nights n where n.booking_room_id = r.id),
        'taxes', (select coalesce(jsonb_agg(jsonb_build_object('tax_rate_id', t.tax_rate_id, 'cents', t.cents)), '[]'::jsonb)
                  from (
                    select tp.tax_rate_id, sum(tp.cents)::bigint as cents
                    from tax_parts tp
                    where tp.line in (select n.id from nights n where n.booking_room_id = r.id and not n.charged)
                       or tp.line in (select fi.id from public.folio_items fi
                                      join public.booking_room_nights brn on brn.id = fi.booking_room_night_id
                                      where brn.booking_room_id = r.id and fi.folio_id = (select id from folio))
                    group by tp.tax_rate_id
                    having sum(tp.cents) <> 0
                  ) t)
      ) order by r.check_in, r.room_number nulls last, r.id)
      from rooms r), '[]'::jsonb),
    'extras', coalesce((
      select jsonb_agg(jsonb_build_object(
        'folio_item_id', e.id, 'description', e.description, 'quantity', e.quantity,
        'item_type', e.item_type, 'business_date', e.business_date,
        'net', e.net, 'tax', e.tax, 'total', e.total,
        'is_reversal', e.is_reversal, 'is_discount', e.is_discount,
        'is_reversed', e.is_reversed, 'is_discounted', e.is_discounted
      ) order by e.posted_at)
      from extras e), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'payment_id', p.id, 'business_date', p.business_date, 'paid_at', p.paid_at,
        'method', p.method, 'amount', p.amount, 'is_reversal', p.is_reversal
      ) order by p.paid_at)
      from pays p), '[]'::jsonb),
    'taxes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tax_rate_id', t.tax_rate_id, 'name', t.name, 'kind', t.kind, 'rate_bps', t.rate_bps,
        'fee_cents', t.fee_cents, 'fee_per', t.fee_per, 'base', t.base, 'cents', t.cents)
        order by t.sort_order nulls last, t.name)
      from taxes t), '[]'::jsonb),
    'accommodation_net', s.acc_net,
    'accommodation_tax', s.acc_tax,
    'extras_net', s.ext_net,
    'extras_tax', s.ext_tax,
    'total', s.acc_net + s.acc_tax + s.ext_net + s.ext_tax,
    'paid', s.paid,
    'due', s.acc_net + s.acc_tax + s.ext_net + s.ext_tax - s.paid
  )
  from sums s
  where exists (select 1 from b);
$$;

-- ---------------------------------------------------------------------------
-- Payments into a chosen folio
-- ---------------------------------------------------------------------------

-- record_booking_payment() from 0128 stays, unused: a new name, not an overload.
create or replace function public.record_folio_payment(
  p_booking_id uuid,
  p_payment_method_id uuid,
  p_amount_cents bigint,
  p_payer_name text default null,
  p_description text default null,
  p_reference text default null,
  p_folio_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_booking public.bookings;
  v_method public.payment_methods;
  v_folio public.folios;
  v_folio_id uuid;
  v_date date;
  v_shift uuid;
  v_id uuid;
begin
  perform public.require_financial_staff();

  select * into v_booking from public.bookings
  where id = p_booking_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That booking does not belong to this property';
  end if;

  select * into v_method from public.payment_methods
  where id = p_payment_method_id and property_id = v_booking.property_id and is_active;
  if not found then
    raise exception 'Choose an active payment type';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Payment amount must be positive';
  end if;

  v_date := public.open_business_date(v_booking.property_id);
  if v_date is null then
    raise exception 'There is no open business date';
  end if;

  if v_method.affects_drawer then
    select s.id into v_shift
    from public.cashier_shifts s
    join public.business_dates bd on bd.id = s.business_date_id and bd.property_id = s.property_id
    where s.property_id = v_booking.property_id
      and s.cashier_id = auth.uid()
      and s.status = 'open'
      and bd.business_date = v_date
    order by s.opened_at desc
    limit 1;
    if v_shift is null then
      raise exception 'Open your cashier shift before taking a cash payment';
    end if;
  end if;

  if p_folio_id is not null then
    select * into v_folio from public.folios
    where id = p_folio_id and booking_id = v_booking.id and property_id = v_booking.property_id;
    if not found then
      raise exception 'That folio is not on this booking';
    end if;
    if v_folio.status <> 'open' then
      raise exception 'Folio #% is closed, so it cannot take a payment', v_folio.folio_number;
    end if;
  else
    select * into v_folio from public.folios
    where booking_id = v_booking.id and property_id = v_booking.property_id and status = 'open'
    order by is_primary desc, folio_number
    limit 1;
    v_folio_id := v_folio.id;
    if v_folio_id is null then
      v_folio_id := public.create_folio(
        v_booking.id, 'guest'::public.folio_kind,
        not exists (select 1 from public.folios where booking_id = v_booking.id and is_primary)
      );
      select * into v_folio from public.folios where id = v_folio_id;
    end if;
  end if;

  insert into public.payments (
    property_id, folio_id, booking_id, payment_method_id, amount_cents, currency, business_date,
    received_by, external_reference, shift_id, payer_name, description
  ) values (
    v_folio.property_id, v_folio.id, v_folio.booking_id, v_method.id, p_amount_cents, v_folio.currency, v_date,
    auth.uid(), nullif(btrim(p_reference), ''), v_shift,
    nullif(btrim(p_payer_name), ''), nullif(btrim(p_description), '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.booking_payment_rows(p_booking_id uuid)
returns table (
  payment_id uuid,
  folio_number bigint,
  business_date date,
  paid_at timestamptz,
  method text,
  payer_name text,
  description text,
  reference text,
  amount_cents bigint,
  is_reversal boolean,
  is_reversed boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id, f.folio_number, p.business_date, p.paid_at, pm.name, p.payer_name, p.description,
         p.external_reference, p.signed_amount_cents::bigint,
         (p.reverses_id is not null),
         exists (select 1 from public.payments r where r.reverses_id = p.id)
  from public.payments p
  join public.folios f on f.id = p.folio_id
  left join public.payment_methods pm on pm.id = p.payment_method_id
  where p.booking_id = p_booking_id
  order by p.paid_at, p.id;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.add_folio(uuid) from public;
revoke execute on function public.add_folio(uuid) from anon;
grant execute on function public.add_folio(uuid) to authenticated;

revoke all on function public.set_folio_customer(uuid, uuid) from public;
revoke execute on function public.set_folio_customer(uuid, uuid) from anon;
grant execute on function public.set_folio_customer(uuid, uuid) to authenticated;

revoke all on function public.set_folio_notes(uuid, text, text) from public;
revoke execute on function public.set_folio_notes(uuid, text, text) from anon;
grant execute on function public.set_folio_notes(uuid, text, text) to authenticated;

revoke all on function public.move_folio_items(uuid, uuid[], uuid[]) from public;
revoke execute on function public.move_folio_items(uuid, uuid[], uuid[]) from anon;
grant execute on function public.move_folio_items(uuid, uuid[], uuid[]) to authenticated;

revoke all on function public.apply_folio_discount(uuid, uuid[], uuid[], integer, bigint, text) from public;
revoke execute on function public.apply_folio_discount(uuid, uuid[], uuid[], integer, bigint, text) from anon;
grant execute on function public.apply_folio_discount(uuid, uuid[], uuid[], integer, bigint, text) to authenticated;

revoke all on function public.booking_folio(uuid, uuid) from public;
revoke execute on function public.booking_folio(uuid, uuid) from anon;
grant execute on function public.booking_folio(uuid, uuid) to authenticated;

revoke all on function public.record_folio_payment(uuid, uuid, bigint, text, text, text, uuid) from public;
revoke execute on function public.record_folio_payment(uuid, uuid, bigint, text, text, text, uuid) from anon;
grant execute on function public.record_folio_payment(uuid, uuid, bigint, text, text, text, uuid) to authenticated;

revoke all on function public.booking_payment_rows(uuid) from public;
revoke execute on function public.booking_payment_rows(uuid) from anon;
grant execute on function public.booking_payment_rows(uuid) to authenticated;
