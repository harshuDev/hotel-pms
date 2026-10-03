-- 0122: a tax rate can be a FEE -- a fixed amount a night, per room or per
-- person -- which is how a tourism or city tax is levied. The client: "the
-- tourism fee is not a percentage, it is an amount, e.g. 6 euros per night,
-- per room or per person".
--
-- A fee is a row of tax_rates, not a table of its own, so everything 0116
-- built for several taxes on a night carries it with no second path: the
-- rate plan's Attached Taxes and the booking form's Taxes pick it, the night's
-- tax_breakdown holds its share, the folio posts it with the room charge, the
-- invoice lists it by name, and a fee in use is frozen and undeletable like
-- any rate.
--   - kind 'tax' | 'fee'. A fee has rate_bps 0, is always on top of the rate
--     (exclusive), and carries fee_cents and fee_per ('room' | 'person' |
--     'adult'). A check constraint holds each kind to its own columns.
--   - tax_split_multi() takes the party (p_adults, p_children, default one
--     adult) and adds each fee: fee_cents x 1 a room, x (adults + children) a
--     person, x adults an adult. It is called once a night, so a fee is per
--     night. It is on top of the net and never taxed itself (no tax on tax,
--     as before). The function is dropped and recreated -- a changed
--     parameter list is a new function, the overload trap -- and every
--     existing call keeps working through the defaults.
--   - The five places a night is priced pass the room line's party:
--     create_booking(), set_booking_room_rate(), create_public_booking(),
--     public_room_types() and booking_quote().
--   - A fee is not an extra's tax: an extra is charged once, not a night per
--     person. A trigger refuses it on extras and extra categories by name.
--   - save_tax_rate() takes the kind, amount and unit (dropped and
--     recreated); a fee with charges posted against it is frozen like a rate.
--     tax_rates_list() returns them.

alter table public.tax_rates
  add column kind text not null default 'tax',
  add column fee_cents bigint,
  add column fee_per text;

alter table public.tax_rates
  add constraint tax_rates_kind_valid check (kind in ('tax', 'fee')),
  add constraint tax_rates_fee_shape check (
    (kind = 'tax' and fee_cents is null and fee_per is null)
    or (kind = 'fee' and fee_cents is not null and fee_cents >= 0
        and fee_per in ('room', 'person', 'adult')
        and rate_bps = 0 and inclusion = 'exclusive')
  );

-- tax_split_multi(): fees added per night for the party. Otherwise as 0116.
drop function public.tax_split_multi(uuid, uuid[], bigint, boolean);

create function public.tax_split_multi(
  p_property_id uuid,
  p_tax_rate_ids uuid[],
  p_amount_cents bigint,
  p_refuse_retired boolean default false,
  p_adults integer default 1,
  p_children integer default 0
)
returns table (net_cents bigint, tax_cents bigint, gross_cents bigint, breakdown jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_name text;
  v_rate record;
  v_incl_bps bigint;
  v_incl_total bigint := 0;
  v_net bigint;
  v_share bigint;
  v_given bigint := 0;
  v_first uuid;
  v_excl bigint := 0;
  v_breakdown jsonb := '{}'::jsonb;
begin
  if p_amount_cents is null then
    return query select null::bigint, null::bigint, null::bigint, null::jsonb;
    return;
  end if;
  if p_amount_cents < 0 then
    raise exception 'Tax cannot be applied to a negative amount';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids
  from unnest(coalesce(p_tax_rate_ids, '{}'::uuid[])) as x where x is not null;

  if (select count(*) from public.tax_rates t
      where t.id = any(v_ids) and t.property_id = p_property_id) <> cardinality(v_ids) then
    raise exception 'That tax rate does not belong to this property';
  end if;

  if p_refuse_retired then
    select t.name into v_name from public.tax_rates t
    where t.id = any(v_ids) and not t.is_active order by t.name limit 1;
    if v_name is not null then
      raise exception 'Tax rate % is retired and cannot be applied to a new charge', v_name;
    end if;
  end if;

  -- Inclusive rates come out of the amount together; a retired rate a guest
  -- path still names is left out rather than charged.
  select coalesce(sum(t.rate_bps), 0) into v_incl_bps
  from public.tax_rates t
  where t.id = any(v_ids) and t.is_active and t.kind = 'tax' and t.inclusion = 'inclusive';

  if v_incl_bps > 0 then
    v_incl_total := round(p_amount_cents::numeric * v_incl_bps / (10000 + v_incl_bps))::bigint;
    for v_rate in
      select t.id, t.rate_bps from public.tax_rates t
      where t.id = any(v_ids) and t.is_active and t.kind = 'tax' and t.inclusion = 'inclusive'
      order by t.rate_bps desc, t.id
    loop
      v_first := coalesce(v_first, v_rate.id);
      v_share := (v_incl_total * v_rate.rate_bps) / v_incl_bps;
      v_given := v_given + v_share;
      v_breakdown := v_breakdown || jsonb_build_object(v_rate.id::text, v_share);
    end loop;
    -- The pennies integer division leaves go to the largest rate, so the
    -- shares always add up to the inclusive total exactly.
    if v_given <> v_incl_total then
      v_breakdown := jsonb_set(v_breakdown, array[v_first::text],
        to_jsonb((v_breakdown ->> v_first::text)::bigint + (v_incl_total - v_given)));
    end if;
  end if;

  v_net := p_amount_cents - v_incl_total;

  for v_rate in
    select t.id, t.rate_bps from public.tax_rates t
    where t.id = any(v_ids) and t.is_active and t.kind = 'tax' and t.inclusion = 'exclusive'
    order by t.rate_bps desc, t.id
  loop
    v_share := round(v_net::numeric * v_rate.rate_bps / 10000)::bigint;
    v_excl := v_excl + v_share;
    v_breakdown := v_breakdown || jsonb_build_object(v_rate.id::text, v_share);
  end loop;

  -- Fees (0122): a fixed amount on top, for this night and this party.
  for v_rate in
    select t.id, t.fee_cents, t.fee_per from public.tax_rates t
    where t.id = any(v_ids) and t.is_active and t.kind = 'fee'
    order by t.sort_order, t.id
  loop
    v_share := v_rate.fee_cents * case v_rate.fee_per
      when 'person' then greatest(coalesce(p_adults, 1), 0) + greatest(coalesce(p_children, 0), 0)
      when 'adult' then greatest(coalesce(p_adults, 1), 0)
      else 1
    end;
    v_excl := v_excl + v_share;
    v_breakdown := v_breakdown || jsonb_build_object(v_rate.id::text, v_share);
  end loop;

  return query select
    v_net,
    v_incl_total + v_excl,
    p_amount_cents + v_excl,
    case when v_breakdown = '{}'::jsonb then null else v_breakdown end;
end;
$$;

revoke all on function public.tax_split_multi(uuid, uuid[], bigint, boolean, integer, integer) from public, anon;
grant execute on function public.tax_split_multi(uuid, uuid[], bigint, boolean, integer, integer) to authenticated;

-- create_booking(): the room line's party reaches the fees. Otherwise as 0116.
create or replace function public.create_booking(
  p_check_in date,
  p_check_out date,
  p_rooms jsonb,
  p_channel_id uuid,
  p_customer_id uuid default null,
  p_customer jsonb default null,
  p_adults integer default 1,
  p_children integer default 0,
  p_status public.booking_status default 'confirmed',
  p_settlement public.booking_settlement default 'at_property',
  p_tax_rate_ids uuid[] default null,
  p_guest_notes text default null,
  p_internal_notes text default null,
  p_external_reference text default null,
  p_allow_overbook boolean default false,
  p_rate_plan_id uuid default null,
  p_ignore_restrictions boolean default false,
  p_promotion_code text default null
)
returns table (booking_id uuid, reference text, promotion_name text, discount_cents bigint)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_customer uuid;
  v_booking uuid;
  v_reference text;
  v_booking_room uuid;
  v_line record;
  v_available bigint;
  v_type_name text;
  v_violation text;
  v_net_cents bigint;
  v_tax_cents bigint;
  v_breakdown jsonb;
  v_missing date;
  v_night record;
  v_promo record;
  v_promotion_id uuid;
  v_promotion_name text;
  v_discount_total bigint := 0;
  v_room_adults integer;
  v_room_children integer;
  v_today date;
  i integer;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, manager and admin staff can take a booking';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if p_check_out <= p_check_in then
    raise exception 'The departure date must be after the arrival date';
  end if;

  if p_status not in ('pending', 'confirmed') then
    raise exception 'A new booking can only be taken as pending or confirmed';
  end if;

  if p_adults is null or p_adults < 1 then
    raise exception 'A booking needs at least one adult';
  end if;

  if p_rooms is null or jsonb_typeof(p_rooms) <> 'array'
     or jsonb_array_length(p_rooms) = 0 then
    raise exception 'A booking needs at least one room';
  end if;

  if p_rate_plan_id is not null and not exists (
    select 1 from public.rate_plans rp
    where rp.id = p_rate_plan_id and rp.property_id = v_property and rp.is_active
  ) then
    raise exception 'That rate plan is not available on this property';
  end if;

  if p_customer_id is not null then
    select c.id into v_customer
    from public.customers c
    where c.id = p_customer_id and c.property_id = v_property;
    if v_customer is null then
      raise exception 'That customer is not on this property';
    end if;
  elsif p_customer is not null then
    insert into public.customers (
      property_id, kind, first_name, last_name, company_name, email, phone
    ) values (
      v_property,
      coalesce((p_customer ->> 'kind')::public.customer_kind, 'personal'),
      nullif(btrim(coalesce(p_customer ->> 'first_name', '')), ''),
      nullif(btrim(coalesce(p_customer ->> 'last_name', '')), ''),
      nullif(btrim(coalesce(p_customer ->> 'company_name', '')), ''),
      nullif(btrim(coalesce(p_customer ->> 'email', '')), ''),
      nullif(btrim(coalesce(p_customer ->> 'phone', '')), '')
    )
    returning id into v_customer;
  else
    raise exception 'A booking needs a guest: pick an existing customer or enter a new one';
  end if;

  if not exists (
    select 1 from public.channels ch
    where ch.id = p_channel_id and ch.property_id = v_property and ch.is_active
  ) then
    raise exception 'That booking source is not available on this property';
  end if;

  if nullif(btrim(coalesce(p_promotion_code, '')), '') is not null
     and not exists (
       select 1 from public.promotions p
       where p.property_id = v_property
         and p.is_active
         and p.code is not null
         and upper(p.code) = upper(btrim(p_promotion_code))
     ) then
    raise exception 'There is no live promotion with the code %', upper(btrim(p_promotion_code));
  end if;

  if not p_ignore_restrictions then
    v_today := public.open_business_date(v_property);
    for v_line in
      select
        (line ->> 'room_type_id')::uuid as room_type_id,
        (line ->> 'adults')::integer as adults,
        (line ->> 'children')::integer as children
      from jsonb_array_elements(p_rooms) as line
    loop
      v_violation := public.rate_plan_condition_violation(
        v_property, p_rate_plan_id, p_check_in, p_check_out,
        greatest(coalesce(v_line.adults, p_adults), 1),
        greatest(coalesce(v_line.children, coalesce(p_children, 0)), 0),
        p_channel_id, v_today
      );
      if v_violation is null then
        v_violation := public.stay_rule_violation(
          p_rate_plan_id, v_line.room_type_id, p_check_in, p_check_out
        );
      end if;
      if v_violation is not null then
        raise exception '%', v_violation using errcode = 'HP002';
      end if;
    end loop;
  end if;

  if not p_allow_overbook then
    for v_line in
      select
        (line ->> 'room_type_id')::uuid as room_type_id,
        coalesce((line ->> 'quantity')::integer, 1) as quantity
      from jsonb_array_elements(p_rooms) as line
    loop
      select b.available, b.name into v_available, v_type_name
      from public.bookable_room_types(p_check_in, p_check_out) b
      where b.room_type_id = v_line.room_type_id;

      if v_available is null then
        raise exception 'That room type is not on this property';
      end if;

      if v_line.quantity > greatest(v_available, 0) then
        raise exception
          'Only % of % free for these dates, and % asked for.',
          greatest(v_available, 0), v_type_name, v_line.quantity
          using errcode = 'HP001';
      end if;
    end loop;
  end if;

  v_reference := public.next_booking_reference();

  insert into public.bookings (
    property_id, reference, customer_id, channel_id, status, settlement,
    check_in, check_out, adults, children, guest_notes, internal_notes,
    external_reference, created_by
  ) values (
    v_property, v_reference, v_customer, p_channel_id, p_status, p_settlement,
    p_check_in, p_check_out, p_adults, coalesce(p_children, 0),
    nullif(btrim(coalesce(p_guest_notes, '')), ''),
    nullif(btrim(coalesce(p_internal_notes, '')), ''),
    nullif(btrim(coalesce(p_external_reference, '')), ''),
    auth.uid()
  )
  returning id into v_booking;

  for v_line in
    select
      (line ->> 'room_type_id')::uuid as room_type_id,
      coalesce((line ->> 'quantity')::integer, 1) as quantity,
      (line ->> 'rate_cents')::bigint as rate_cents,
      (line ->> 'adults')::integer as adults,
      (line ->> 'children')::integer as children
    from jsonb_array_elements(p_rooms) as line
  loop
    if v_line.quantity < 1 or v_line.quantity > 50 then
      raise exception 'A room line must be for between one and fifty rooms';
    end if;
    if v_line.rate_cents is not null and v_line.rate_cents < 0 then
      raise exception 'A nightly rate cannot be negative';
    end if;

    if not exists (
      select 1 from public.room_types rt
      where rt.id = v_line.room_type_id and rt.property_id = v_property
    ) then
      raise exception 'That room type is not on this property';
    end if;

    if v_line.rate_cents is null then
      if p_rate_plan_id is null then
        raise exception
          'Give a nightly rate, or pick a rate plan that has one loaded for these dates';
      end if;

      select gs::date into v_missing
      from generate_series(p_check_in, p_check_out - 1, interval '1 day') as gs
      where not exists (
        select 1 from public.rate_plan_days d
        where d.property_id = v_property
          and d.rate_plan_id = p_rate_plan_id
          and d.room_type_id = v_line.room_type_id
          and d.stay_date = gs::date
          and d.rate_cents is not null
      )
      order by gs
      limit 1;

      if v_missing is not null then
        raise exception
          'No rate is loaded for % on this plan. Load one, or give a rate for the booking.',
          to_char(v_missing, 'FMDay FMDD Mon YYYY');
      end if;
    end if;

    v_promotion_id := null;
    if v_line.rate_cents is null and p_rate_plan_id is not null then
      select bp.promotion_id, bp.name into v_promo
      from public.best_promotion(
        p_rate_plan_id, v_line.room_type_id, p_check_in, p_check_out,
        current_date, p_promotion_code
      ) bp;
      if found then
        v_promotion_id := v_promo.promotion_id;
        v_promotion_name := v_promo.name;
      end if;
    end if;

    v_room_adults := greatest(coalesce(v_line.adults, p_adults), 1);
    v_room_children := greatest(coalesce(v_line.children, coalesce(p_children, 0)), 0);

    for i in 1 .. v_line.quantity loop
      insert into public.booking_rooms (
        property_id, booking_id, room_type_id, rate_plan_id, status,
        check_in, check_out, adults, children
      ) values (
        v_property, v_booking, v_line.room_type_id, p_rate_plan_id, p_status,
        p_check_in, p_check_out, v_room_adults, v_room_children
      )
      returning id into v_booking_room;

      for v_night in
        select
          bn.id,
          bn.stay_date,
          coalesce(
            v_line.rate_cents,
            public.rate_plan_night_rate(
              p_rate_plan_id, v_line.room_type_id, bn.stay_date, d.rate_cents,
              v_room_adults, v_room_children
            )
          ) as rate_cents,
          coalesce(pd.discount_cents, 0) as discount_cents
        from public.booking_room_nights bn
        left join public.rate_plan_days d
          on d.property_id = v_property
         and d.rate_plan_id = p_rate_plan_id
         and d.room_type_id = v_line.room_type_id
         and d.stay_date = bn.stay_date
        left join lateral (
          select n.discount_cents
          from public.promotion_night_discounts(
            v_promotion_id, p_rate_plan_id, v_line.room_type_id,
            p_check_in, p_check_out
          ) n
          where v_promotion_id is not null and n.stay_date = bn.stay_date
        ) pd on true
        where bn.booking_room_id = v_booking_room
          and bn.property_id = v_property
      loop
        if coalesce(cardinality(p_tax_rate_ids), 0) > 0 then
          select t.net_cents, t.tax_cents, t.breakdown into v_net_cents, v_tax_cents, v_breakdown
          from public.tax_split_multi(
            v_property, p_tax_rate_ids,
            greatest(v_night.rate_cents - v_night.discount_cents, 0), true,
            v_room_adults, v_room_children
          ) t;
          v_net_cents := v_net_cents + v_night.discount_cents;
        else
          v_net_cents := v_night.rate_cents;
          v_tax_cents := 0;
          v_breakdown := null;
        end if;

        update public.booking_room_nights
        set room_rate_cents = v_net_cents,
            tax_cents = v_tax_cents,
            tax_breakdown = v_breakdown,
            discount_cents = least(v_night.discount_cents, v_net_cents)
        where id = v_night.id;

        v_discount_total := v_discount_total + least(v_night.discount_cents, v_net_cents);
      end loop;
    end loop;
  end loop;

  if v_promotion_id is not null then
    update public.bookings set promotion_id = v_promotion_id
    where id = v_booking and property_id = v_property;
  end if;

  return query select v_booking, v_reference, v_promotion_name, v_discount_total;
end;
$$;

-- set_booking_room_rate(): the room's party reaches the fees. Otherwise as 0117.
create or replace function public.set_booking_room_rate(
  p_booking_room_id uuid,
  p_rate_cents bigint,
  p_from date default null,
  p_to date default null,
  p_tax_rate_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_room public.booking_rooms;
  v_taxes uuid[];
  v_net bigint;
  v_tax bigint;
  v_breakdown jsonb;
  v_count integer;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, manager and admin staff can change a rate';
  end if;

  v_property := public.current_property_id();

  select * into v_room from public.booking_rooms
  where id = p_booking_room_id and property_id = v_property;
  if not found then
    raise exception 'That room is not on a booking for this property';
  end if;

  if p_rate_cents is null or p_rate_cents < 0 then
    raise exception 'A nightly rate cannot be negative';
  end if;

  -- None named: the taxes the rest of this room's stay carries.
  v_taxes := p_tax_rate_ids;
  if v_taxes is null then
    select coalesce(array_agg(distinct k::uuid), '{}') into v_taxes
    from public.booking_room_nights bn
    cross join lateral jsonb_object_keys(bn.tax_breakdown) k
    where bn.booking_room_id = p_booking_room_id
      and bn.property_id = v_property
      and bn.tax_breakdown is not null;
  end if;

  if cardinality(v_taxes) > 0 then
    -- A named set must be live; one inherited from the stay skips a rate
    -- retired since, as the guest page does.
    select t.net_cents, t.tax_cents, t.breakdown into v_net, v_tax, v_breakdown
    from public.tax_split_multi(v_property, v_taxes, p_rate_cents, p_tax_rate_ids is not null,
                                 v_room.adults, v_room.children) t;
  else
    v_net := p_rate_cents;
    v_tax := 0;
    v_breakdown := null;
  end if;

  -- A night already charged keeps its rate. The folio is what the guest owes,
  -- and changing the night underneath it would put the two out of step.
  update public.booking_room_nights bn
  set room_rate_cents = v_net, tax_cents = coalesce(v_tax, 0), tax_breakdown = v_breakdown
  where bn.booking_room_id = p_booking_room_id
    and bn.property_id = v_property
    and (p_from is null or bn.stay_date >= p_from)
    and (p_to is null or bn.stay_date <= p_to)
    and not exists (
      select 1 from public.folio_items fi
      where fi.booking_room_night_id = bn.id
        and fi.property_id = bn.property_id
        and fi.reverses_id is null
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- public_room_types(): the quote carries the fees for the party asked about,
-- or the room type's base occupancy when none is given. Otherwise as 0116.
create or replace function public.public_room_types(
  p_property_id uuid,
  p_rate_plan_id uuid,
  p_from date,
  p_to date,
  p_adults integer default null,
  p_children integer default null
)
returns table (
  room_type_id uuid, code text, name text, base_occupancy integer,
  max_occupancy integer, available bigint, nights integer,
  total_cents bigint, unavailable_reason text
)
language sql
stable
security definer
set search_path = public
as $$
  with plan as (
    select rp.id,
      array(select x.tax_rate_id from public.rate_plan_taxes x
            where x.rate_plan_id = rp.id order by x.sort_order) as tax_ids
    from public.rate_plans rp
    join public.properties p on p.id = rp.property_id and p.is_active
    where rp.id = p_rate_plan_id
      and rp.property_id = p_property_id
      and rp.is_active
      and rp.is_public
  ),
  nights as (
    select d::date as stay_date
    from generate_series(p_from, greatest(p_to - 1, p_from), interval '1 day') as d
  ),
  types as (
    select
      rt.id, rt.code, coalesce(rt.display_name, rt.name) as name,
      rt.base_occupancy, rt.max_occupancy, rt.sort_order,
      count(r.id) filter (where r.status <> 'ooo' and r.available_online) as sellable
    from public.room_types rt
    left join public.rooms r
      on r.room_type_id = rt.id and r.property_id = rt.property_id
    where rt.property_id = p_property_id
    group by rt.id, rt.code, rt.display_name, rt.name, rt.sort_order
  ),
  sold as (
    select n.stay_date, coalesce(r.room_type_id, br.room_type_id) as room_type_id, count(*) as sold
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    left join public.rooms r
      on r.id = br.room_id and r.property_id = br.property_id
    where n.property_id = p_property_id
      and n.status not in ('canceled', 'no_show')
      and n.stay_date >= p_from
      and n.stay_date < p_to
    group by n.stay_date, coalesce(r.room_type_id, br.room_type_id)
  ),
  priced as (
    select
      types.id,
      types.code,
      types.name,
      types.base_occupancy,
      types.max_occupancy,
      types.sort_order,
      coalesce(
        min(
          case
            when coalesce(rtd.close_out, false) then 0
            else least(types.sellable, coalesce(rtd.allotment, types.sellable))
                 - coalesce(sold.sold, 0)
          end
        ),
        types.sellable
      )::bigint as available,
      (p_to - p_from)::integer as nights,
      case
        when bool_or(rpd.rate_cents is null) then null
        else sum(
          (select t.gross_cents from public.tax_split_multi(
             p_property_id,
             (select tax_ids from plan),
             public.rate_plan_night_rate(
               (select id from plan), types.id, nights.stay_date, rpd.rate_cents,
               p_adults, p_children
             ),
             false,
             coalesce(p_adults, types.base_occupancy),
             coalesce(p_children, 0)
           ) t)
        )::bigint
      end as total_cents
    from types
    cross join nights
    left join public.room_type_days rtd
      on rtd.room_type_id = types.id
     and rtd.stay_date = nights.stay_date
     and rtd.property_id = p_property_id
    left join public.rate_plan_days rpd
      on rpd.room_type_id = types.id
     and rpd.stay_date = nights.stay_date
     and rpd.property_id = p_property_id
     and rpd.rate_plan_id = (select id from plan)
    left join sold
      on sold.stay_date = nights.stay_date and sold.room_type_id = types.id
    group by types.id, types.code, types.name, types.base_occupancy,
             types.max_occupancy, types.sort_order, types.sellable
  )
  select
    priced.id,
    priced.code,
    priced.name,
    priced.base_occupancy,
    priced.max_occupancy,
    greatest(priced.available, 0)::bigint,
    priced.nights,
    priced.total_cents,
    coalesce(
      public.public_booking_cutoff_reason(p_property_id, p_from, p_to),
      public.rate_plan_condition_violation(
        p_property_id, (select id from plan), p_from, p_to, p_adults, p_children,
        public.public_direct_channel(p_property_id),
        public.open_business_date(p_property_id)
      ),
      public.stay_rule_violation_for(
        p_property_id, (select id from plan), priced.id, p_from, p_to
      )
    )
  from priced
  where exists (select 1 from plan)
  order by priced.sort_order, priced.name;
$$;

-- create_public_booking(): the party reaches the fees. Otherwise as 0116.
create or replace function public.create_public_booking(
  p_property_id uuid,
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_check_in date,
  p_check_out date,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text default null,
  p_adults integer default 2,
  p_children integer default 0,
  p_notes text default null
)
returns table (booking_id uuid, reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_nights constant integer := 30;
  c_max_days_ahead constant integer := 500;
  c_max_pending constant integer := 5;

  v_channel uuid;
  v_customer uuid;
  v_booking uuid;
  v_booking_room uuid;
  v_reference text;
  v_available bigint;
  v_total bigint;
  v_reason text;
  v_max_occupancy integer;
  v_pending integer;
  v_night record;
  v_rate bigint;
  v_tax_rates uuid[];
  v_breakdown jsonb;
  v_net bigint;
  v_tax bigint;
begin
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    raise exception 'Choose a departure date after the arrival date';
  end if;

  if p_check_in < current_date then
    raise exception 'That arrival date has passed';
  end if;

  if p_check_out - p_check_in > c_max_nights then
    raise exception
      'Stays longer than % nights cannot be booked online. Please contact the hotel.',
      c_max_nights;
  end if;

  if p_check_in > current_date + c_max_days_ahead then
    raise exception 'That date is too far ahead to book online yet';
  end if;

  if btrim(coalesce(p_first_name, '')) = '' or btrim(coalesce(p_last_name, '')) = '' then
    raise exception 'A booking needs a first and last name';
  end if;

  if btrim(coalesce(p_email, '')) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That email address does not look right';
  end if;

  if coalesce(p_adults, 0) < 1 then
    raise exception 'A booking needs at least one adult';
  end if;

  if coalesce(p_children, 0) < 0 then
    raise exception 'That is not a number of children';
  end if;

  select c.id into v_channel
  from public.channels c
  join public.properties p on p.id = c.property_id and p.is_active
  where c.property_id = p_property_id and c.kind = 'direct' and c.is_active
  order by c.code
  limit 1;

  if v_channel is null then
    raise exception 'This property is not set up to take bookings online';
  end if;

  select rt.max_occupancy into v_max_occupancy
  from public.room_types rt
  where rt.id = p_room_type_id and rt.property_id = p_property_id;

  if v_max_occupancy is null then
    raise exception 'That room is not available on this rate';
  end if;

  if p_adults + coalesce(p_children, 0) > v_max_occupancy then
    raise exception 'That room sleeps % people', v_max_occupancy;
  end if;

  select t.available, t.total_cents, t.unavailable_reason
    into v_available, v_total, v_reason
  from public.public_room_types(
    p_property_id, p_rate_plan_id, p_check_in, p_check_out,
    p_adults, coalesce(p_children, 0)
  ) t
  where t.room_type_id = p_room_type_id;

  if not found then
    raise exception 'That room is not available on this rate';
  end if;

  if v_reason is not null then
    raise exception '%', v_reason using errcode = 'HP002';
  end if;

  if coalesce(v_available, 0) < 1 then
    raise exception 'That room is fully booked for those dates' using errcode = 'HP001';
  end if;

  if v_total is null then
    raise exception 'That room has no price loaded for those dates' using errcode = 'HP002';
  end if;

  select c.id into v_customer
  from public.customers c
  where c.property_id = p_property_id
    and lower(c.email) = lower(btrim(p_email))
  limit 1;

  if v_customer is not null then
    select count(*) into v_pending
    from public.bookings b
    where b.property_id = p_property_id
      and b.customer_id = v_customer
      and b.status = 'pending';

    if v_pending >= c_max_pending then
      raise exception
        'There are already % unconfirmed bookings on this email. The hotel will be in touch about those first.',
        v_pending;
    end if;
  end if;

  if v_customer is null then
    insert into public.customers (
      property_id, kind, first_name, last_name, email, phone
    )
    values (
      p_property_id, 'personal', btrim(p_first_name), btrim(p_last_name),
      lower(btrim(p_email)), nullif(btrim(coalesce(p_phone, '')), '')
    )
    returning id into v_customer;
  end if;

  v_reference := public.next_booking_reference();

  insert into public.bookings (
    property_id, reference, customer_id, channel_id, status, settlement,
    check_in, check_out, adults, children, guest_notes, booked_at
  )
  values (
    p_property_id, v_reference, v_customer, v_channel, 'pending', 'at_property',
    p_check_in, p_check_out, p_adults, coalesce(p_children, 0),
    nullif(btrim(coalesce(p_notes, '')), ''), now()
  )
  returning id into v_booking;

  insert into public.booking_rooms (
    property_id, booking_id, room_type_id, rate_plan_id, status,
    check_in, check_out, adults, children
  )
  values (
    p_property_id, v_booking, p_room_type_id, p_rate_plan_id, 'pending',
    p_check_in, p_check_out, p_adults, coalesce(p_children, 0)
  )
  returning id into v_booking_room;

  select coalesce(array_agg(x.tax_rate_id order by x.sort_order), '{}') into v_tax_rates
  from public.rate_plan_taxes x
  where x.rate_plan_id = p_rate_plan_id and x.property_id = p_property_id;

  for v_night in
    select n.id, n.stay_date
    from public.booking_room_nights n
    where n.booking_room_id = v_booking_room
  loop
    select public.rate_plan_night_rate(
             p_rate_plan_id, p_room_type_id, v_night.stay_date, d.rate_cents,
             p_adults, coalesce(p_children, 0)
           )
      into v_rate
    from public.rate_plan_days d
    where d.property_id = p_property_id
      and d.rate_plan_id = p_rate_plan_id
      and d.room_type_id = p_room_type_id
      and d.stay_date = v_night.stay_date;

    select t.net_cents, t.tax_cents, t.breakdown into v_net, v_tax, v_breakdown
    from public.tax_split_multi(p_property_id, v_tax_rates, v_rate, false,
                                 p_adults, coalesce(p_children, 0)) t;

    update public.booking_room_nights
    set room_rate_cents = v_net,
        tax_cents = coalesce(v_tax, 0),
        tax_breakdown = v_breakdown
    where id = v_night.id;
  end loop;

  return query select v_booking, v_reference;
end;
$$;

-- booking_quote(): the room line's party reaches the fees. Otherwise as 0121.
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
        greatest(v_night.rate_cents - v_night.discount_cents, 0), false,
        v_adults, v_children
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

-- A fee is levied a night on the party; an extra is charged once. Refused on
-- the catalog by name rather than charged as a zero tax.
create or replace function public.extras_tax_is_not_a_fee()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_name text;
begin
  if new.tax_rate_id is not null then
    select name into v_name from public.tax_rates
    where id = new.tax_rate_id and kind = 'fee';
    if v_name is not null then
      raise exception '% is a fee charged per night, so it cannot be the tax on an extra', v_name;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.extras_tax_is_not_a_fee() from public, anon;

create trigger extras_tax_is_not_a_fee
  before insert or update of tax_rate_id on public.extras
  for each row execute function public.extras_tax_is_not_a_fee();
create trigger extra_categories_tax_is_not_a_fee
  before insert or update of tax_rate_id on public.extra_categories
  for each row execute function public.extras_tax_is_not_a_fee();

-- save_tax_rate(): the kind, and a fee's amount and unit. A fee with charges
-- posted is frozen like a rate. Dropped and recreated -- the overload trap.
drop function public.save_tax_rate(text, integer, public.tax_inclusion, uuid, boolean);

create function public.save_tax_rate(
  p_name text,
  p_rate_bps integer,
  p_inclusion public.tax_inclusion,
  p_id uuid default null,
  p_is_active boolean default true,
  p_kind text default 'tax',
  p_fee_cents bigint default null,
  p_fee_per text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_id uuid;
  v_kind text := coalesce(p_kind, 'tax');
  v_rate integer := p_rate_bps;
  v_inclusion public.tax_inclusion := p_inclusion;
  v_fee bigint;
  v_per text;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can set up tax rates';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'A tax rate needs a name';
  end if;

  if v_kind not in ('tax', 'fee') then
    raise exception 'A tax rate is a tax or a fee';
  end if;

  if v_kind = 'fee' then
    if p_fee_cents is null or p_fee_cents < 0 then
      raise exception 'A fee needs an amount';
    end if;
    if p_fee_per is null or p_fee_per not in ('room', 'person', 'adult') then
      raise exception 'A fee is charged per room, per person or per adult';
    end if;
    v_fee := p_fee_cents;
    v_per := p_fee_per;
    v_rate := 0;
    v_inclusion := 'exclusive';
  elsif v_rate is null or v_rate < 0 or v_rate > 10000 then
    raise exception 'A tax rate must be between 0 and 100 percent';
  end if;

  if p_id is null then
    insert into public.tax_rates (property_id, name, rate_bps, inclusion, is_active, kind, fee_cents, fee_per)
    values (v_property, btrim(p_name), v_rate, v_inclusion, coalesce(p_is_active, true), v_kind, v_fee, v_per)
    returning id into v_id;
  else
    -- What a rate charges is not changed in place once charges have been
    -- posted against it: a folio item records which rate it used, and moving
    -- that rate underneath it would silently restate history.
    if exists (
      select 1 from public.folio_items fi
      where (fi.tax_rate_id = p_id or fi.tax_breakdown ? p_id::text) and fi.property_id = v_property
    ) and (
      select t.rate_bps <> v_rate or t.inclusion <> v_inclusion or t.kind <> v_kind
        or t.fee_cents is distinct from v_fee or t.fee_per is distinct from v_per
      from public.tax_rates t where t.id = p_id and t.property_id = v_property
    ) then
      raise exception
        'Charges have already been posted at this rate. Retire it and add a new one rather than changing it.';
    end if;

    if v_kind = 'fee' and (
      exists (select 1 from public.extras e where e.tax_rate_id = p_id)
      or exists (select 1 from public.extra_categories ec where ec.tax_rate_id = p_id)
    ) then
      raise exception 'An extra is taxed at this rate, so it cannot become a fee';
    end if;

    update public.tax_rates set
      name = btrim(p_name),
      rate_bps = v_rate,
      inclusion = v_inclusion,
      is_active = coalesce(p_is_active, true),
      kind = v_kind,
      fee_cents = v_fee,
      fee_per = v_per
    where id = p_id and property_id = v_property
    returning id into v_id;

    if v_id is null then
      raise exception 'That tax rate is not on this property';
    end if;
  end if;

  return v_id;
end;
$$;
revoke all on function public.save_tax_rate(text, integer, public.tax_inclusion, uuid, boolean, text, bigint, text) from public, anon;
grant execute on function public.save_tax_rate(text, integer, public.tax_inclusion, uuid, boolean, text, bigint, text) to authenticated;

-- tax_rates_list(): the kind and a fee's amount and unit. A changed return
-- type is a new function.
drop function public.tax_rates_list();

create function public.tax_rates_list()
returns table (
  id uuid, name text, rate_bps integer, inclusion public.tax_inclusion,
  is_active boolean, charge_count bigint, sort_order integer, in_use boolean,
  kind text, fee_cents bigint, fee_per text
)
language sql
stable
set search_path = public
as $$
  select
    t.id, t.name, t.rate_bps, t.inclusion, t.is_active,
    coalesce(c.charges, 0)::bigint,
    t.sort_order,
    (
      coalesce(c.charges, 0) > 0
      or exists (select 1 from public.extras e where e.tax_rate_id = t.id)
      or exists (select 1 from public.extra_categories ec where ec.tax_rate_id = t.id)
      or exists (select 1 from public.rate_plan_taxes rpt where rpt.tax_rate_id = t.id)
    ),
    t.kind, t.fee_cents, t.fee_per
  from public.tax_rates t
  left join lateral (
    select count(*) as charges
    from public.folio_items fi
    where (fi.tax_rate_id = t.id or fi.tax_breakdown ? t.id::text)
      and fi.property_id = t.property_id
  ) c on true
  where t.property_id = public.current_property_id()
  order by t.sort_order, t.name;
$$;
revoke all on function public.tax_rates_list() from public, anon;
grant execute on function public.tax_rates_list() to authenticated;
