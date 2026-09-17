-- Layer 17: promotions.
--
-- A promotion reduces what a stay costs. It is not a second price list: the
-- rate plan still says what a room is worth, and a promotion writes into
-- booking_room_nights.discount_cents, which has existed since 0002 and which
-- the occupancy report and every revenue figure already net off. Nothing about
-- how revenue is counted changes.
--
-- Three kinds to begin with, and the shape takes a fourth without a rewrite:
--
--   percent_off   a percentage off each night
--   amount_off    a fixed sum off each night
--   free_nights   stay N, pay M — the cheapest qualifying nights go to zero
--
-- percent_off and amount_off reduce every night; free_nights zeroes some and
-- leaves the rest alone. That is a real difference in mechanic, which is why
-- the discount is worked out per night by one function with a branch per kind
-- rather than by a single formula pretending they are the same thing.
--
-- Adding a kind later means a value column, a check, and a branch in
-- promotion_night_discounts(). Inclusions — "rate includes breakfast" — are
-- deliberately not here: an inclusion posts something to the folio rather than
-- taking money off a night, so it needs the meal and package model that the
-- Meal report is also waiting on.
--
-- Two decisions taken with the client:
--
--   A promotion may carry a code or not. No code means it applies by itself to
--   any stay that qualifies. A code means somebody has to quote it, which is
--   how a negotiated or private offer is run.
--
--   When several qualify, the best single one wins. Stacking two forty percent
--   offers by accident is sixty-four percent off and nobody notices until the
--   month end.

create type public.promotion_kind as enum ('percent_off', 'amount_off', 'free_nights');

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,

  -- Null applies automatically; set must be quoted.
  code text,
  name text not null,
  description text,

  kind public.promotion_kind not null,
  -- Basis points, like every other rate in this schema: 1500 is 15%.
  percent_bps integer,
  amount_off_cents bigint,
  free_nights integer,
  paid_nights integer,

  -- When the booking must be made for this to be offered.
  sell_from date,
  sell_to date,
  -- Which nights it reduces. A stay reaching outside the window keeps full
  -- price on the nights outside it.
  stay_from date,
  stay_to date,

  min_nights integer,
  max_nights integer,
  -- How far ahead the booking was made: early bird and last minute.
  min_advance_days integer,
  max_advance_days integer,
  -- Postgres numbering, 0 Sunday to 6 Saturday. Null or empty is any day.
  arrival_days_of_week integer[],

  is_active boolean not null default true,
  -- Breaks a tie when two promotions save the guest exactly the same.
  priority integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,

  unique (id, property_id),
  foreign key (created_by, property_id)
    references public.staff_users (id, property_id) on delete set null,

  constraint promotions_value_matches_kind check (
    case kind
      when 'percent_off' then percent_bps is not null
        and percent_bps > 0 and percent_bps <= 10000
      when 'amount_off' then amount_off_cents is not null and amount_off_cents > 0
      when 'free_nights' then free_nights is not null and free_nights > 0
        and paid_nights is not null and paid_nights > 0
    end
  ),
  constraint promotions_windows_sane check (
    (sell_from is null or sell_to is null or sell_to >= sell_from)
    and (stay_from is null or stay_to is null or stay_to >= stay_from)
    and (min_nights is null or min_nights > 0)
    and (max_nights is null or max_nights > 0)
    and (min_nights is null or max_nights is null or max_nights >= min_nights)
    and (min_advance_days is null or min_advance_days >= 0)
    and (max_advance_days is null or max_advance_days >= 0)
  )
);

-- A code has to be unique to be quotable, but only among the live ones: a
-- retired SUMMER24 should not block next year's.
create unique index promotions_code_unique_active
  on public.promotions (property_id, upper(code)) where code is not null and is_active;

create index promotions_property_active_idx
  on public.promotions (property_id, is_active);

-- No rows in these means "every plan" and "every room type". That is the
-- common case, and making it the empty set rather than a row per plan keeps a
-- property-wide offer from needing maintenance every time a plan is added.
create table public.promotion_rate_plans (
  promotion_id uuid not null,
  rate_plan_id uuid not null,
  property_id uuid not null references public.properties(id) on delete restrict,
  primary key (promotion_id, rate_plan_id),
  foreign key (promotion_id, property_id)
    references public.promotions (id, property_id) on delete cascade,
  foreign key (rate_plan_id, property_id)
    references public.rate_plans (id, property_id) on delete cascade
);

create table public.promotion_room_types (
  promotion_id uuid not null,
  room_type_id uuid not null,
  property_id uuid not null references public.properties(id) on delete restrict,
  primary key (promotion_id, room_type_id),
  foreign key (promotion_id, property_id)
    references public.promotions (id, property_id) on delete cascade,
  foreign key (room_type_id, property_id)
    references public.room_types (id, property_id) on delete cascade
);

-- Which promotion a booking actually got, so a guest asking "what discount did
-- I have" has an answer and the reports can group by it.
alter table public.bookings
  add column promotion_id uuid,
  add constraint bookings_promotion_fk
    foreign key (promotion_id, property_id)
      references public.promotions (id, property_id) on delete set null;

alter table public.promotions enable row level security;
alter table public.promotion_rate_plans enable row level security;
alter table public.promotion_room_types enable row level security;

-- Anyone in the property reads: the front desk has to know what a guest
-- qualifies for. Only revenue staff write, same as rates.
create policy promotions_select_same_property on public.promotions
  for select using (property_id = public.current_property_id());
create policy promotions_insert_revenue on public.promotions
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy promotions_update_revenue on public.promotions
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy promotions_delete_revenue on public.promotions
  for delete using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

create policy promotion_rate_plans_select on public.promotion_rate_plans
  for select using (property_id = public.current_property_id());
create policy promotion_rate_plans_insert on public.promotion_rate_plans
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy promotion_rate_plans_delete on public.promotion_rate_plans
  for delete using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

create policy promotion_room_types_select on public.promotion_room_types
  for select using (property_id = public.current_property_id());
create policy promotion_room_types_insert on public.promotion_room_types
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy promotion_room_types_delete on public.promotion_room_types
  for delete using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

create trigger promotions_touch
  before update on public.promotions
  for each row execute function public.touch_updated_at();


-- Does this promotion apply to this stay at all ------------------------------
--
-- Separate from working out what it is worth, because "you do not qualify" and
-- "you qualify and it saves you nothing" are different answers and the front
-- desk needs to be able to give either.

create function public.eligible_promotions(
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_check_in date,
  p_check_out date,
  p_booked_on date default null,
  p_code text default null
)
returns setof public.promotions
language sql
stable
security invoker
set search_path = public
as $$
  select p.*
  from public.promotions p
  where p.property_id = public.current_property_id()
    and p.is_active

    -- A coded promotion is invisible until the code is quoted; an uncoded one
    -- is always a candidate.
    and (
      p.code is null
      or (p_code is not null and upper(btrim(p_code)) = upper(p.code))
    )

    -- The selling window is about when the booking is made, not when the guest
    -- stays. They are different dates and conflating them is how an early bird
    -- offer ends up applying on the day of arrival.
    and (p.sell_from is null or coalesce(p_booked_on, current_date) >= p.sell_from)
    and (p.sell_to is null or coalesce(p_booked_on, current_date) <= p.sell_to)

    -- The stay has to reach the nights the promotion covers at all.
    and (p.stay_from is null or p_check_out > p.stay_from)
    and (p.stay_to is null or p_check_in <= p.stay_to)

    and (p.min_nights is null or (p_check_out - p_check_in) >= p.min_nights)
    and (p.max_nights is null or (p_check_out - p_check_in) <= p.max_nights)

    and (
      p.min_advance_days is null
      or (p_check_in - coalesce(p_booked_on, current_date)) >= p.min_advance_days
    )
    and (
      p.max_advance_days is null
      or (p_check_in - coalesce(p_booked_on, current_date)) <= p.max_advance_days
    )

    and (
      p.arrival_days_of_week is null
      or cardinality(p.arrival_days_of_week) = 0
      or extract(dow from p_check_in)::integer = any (p.arrival_days_of_week)
    )

    -- No links means every plan and every room type.
    and (
      not exists (select 1 from public.promotion_rate_plans x where x.promotion_id = p.id)
      or exists (
        select 1 from public.promotion_rate_plans x
        where x.promotion_id = p.id and x.rate_plan_id = p_rate_plan_id
      )
    )
    and (
      not exists (select 1 from public.promotion_room_types x where x.promotion_id = p.id)
      or exists (
        select 1 from public.promotion_room_types x
        where x.promotion_id = p.id and x.room_type_id = p_room_type_id
      )
    );
$$;


-- What it takes off each night -----------------------------------------------
--
-- One row per night of the stay, whether or not the promotion touches it, so
-- the caller can show a guest the whole stay with the reduced nights marked.
-- Every discount is clamped to the rate: a night can go to zero and no further.

create function public.promotion_night_discounts(
  p_promotion_id uuid,
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_check_in date,
  p_check_out date
)
returns table (stay_date date, rate_cents bigint, discount_cents bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with promo as (
    select * from public.promotions
    where id = p_promotion_id and property_id = public.current_property_id()
  ),
  nights as (
    select
      d::date as stay_date,
      coalesce(rpd.rate_cents, 0)::bigint as rate_cents,
      -- A night outside the promotion's stay window stays at full price.
      (promo.stay_from is null or d::date >= promo.stay_from)
        and (promo.stay_to is null or d::date <= promo.stay_to) as covered
    from promo
    cross join generate_series(p_check_in, p_check_out - 1, interval '1 day') as d
    left join public.rate_plan_days rpd
      on rpd.property_id = public.current_property_id()
     and rpd.rate_plan_id = p_rate_plan_id
     and rpd.room_type_id = p_room_type_id
     and rpd.stay_date = d::date
  ),
  -- For free_nights, the cheapest covered nights are the ones given away: a
  -- "stay 3 pay 2" that handed back the most expensive night would cost the
  -- hotel more than the offer says, and every hotel gives the cheapest.
  ranked as (
    select
      nights.*,
      -- Ranked within the covered nights only, so an uncovered night never
      -- takes a free slot from one the promotion actually reaches.
      case when nights.covered
        then rank() over (
          partition by nights.covered
          order by nights.rate_cents, nights.stay_date
        )
      end as cheapness,
      count(*) filter (where nights.covered) over () as covered_nights
    from nights
  )
  select
    ranked.stay_date,
    ranked.rate_cents,
    case
      when not ranked.covered then 0::bigint
      when promo.kind = 'percent_off' then
        least(
          round(ranked.rate_cents * promo.percent_bps / 10000.0),
          ranked.rate_cents
        )::bigint
      when promo.kind = 'amount_off' then
        least(promo.amount_off_cents, ranked.rate_cents)::bigint
      when promo.kind = 'free_nights' then
        case
          when ranked.cheapness <= (
            (ranked.covered_nights / (promo.paid_nights + promo.free_nights))
            * promo.free_nights
          )
          then ranked.rate_cents
          else 0::bigint
        end
      else 0::bigint
    end as discount_cents
  from ranked
  cross join promo
  order by ranked.stay_date;
$$;


-- Which one wins --------------------------------------------------------------
--
-- The largest saving, with priority as the tiebreak. One promotion, never two:
-- see the note at the top about forty plus forty.

create function public.best_promotion(
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_check_in date,
  p_check_out date,
  p_booked_on date default null,
  p_code text default null
)
returns table (
  promotion_id uuid,
  code text,
  name text,
  kind public.promotion_kind,
  total_discount_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    e.id,
    e.code,
    e.name,
    e.kind,
    coalesce(d.total, 0)::bigint
  from public.eligible_promotions(
    p_rate_plan_id, p_room_type_id, p_check_in, p_check_out, p_booked_on, p_code
  ) e
  cross join lateral (
    select sum(n.discount_cents) as total
    from public.promotion_night_discounts(
      e.id, p_rate_plan_id, p_room_type_id, p_check_in, p_check_out
    ) n
  ) d
  where coalesce(d.total, 0) > 0
  order by coalesce(d.total, 0) desc, e.priority desc, e.name
  limit 1;
$$;

comment on function public.best_promotion(uuid, uuid, date, date, date, text) is
  'The single promotion that saves this stay the most, or no row. Never two: promotions do not stack.';

revoke all on function public.eligible_promotions(uuid, uuid, date, date, date, text)
  from public, anon;
revoke all on function public.promotion_night_discounts(uuid, uuid, uuid, date, date)
  from public, anon;
revoke all on function public.best_promotion(uuid, uuid, date, date, date, text)
  from public, anon;

grant execute on function public.eligible_promotions(uuid, uuid, date, date, date, text)
  to authenticated;
grant execute on function public.promotion_night_discounts(uuid, uuid, uuid, date, date)
  to authenticated;
grant execute on function public.best_promotion(uuid, uuid, date, date, date, text)
  to authenticated;


-- Managing promotions ---------------------------------------------------------

create function public.save_promotion(
  p_name text,
  p_kind public.promotion_kind,
  p_id uuid default null,
  p_code text default null,
  p_description text default null,
  p_percent_bps integer default null,
  p_amount_off_cents bigint default null,
  p_free_nights integer default null,
  p_paid_nights integer default null,
  p_sell_from date default null,
  p_sell_to date default null,
  p_stay_from date default null,
  p_stay_to date default null,
  p_min_nights integer default null,
  p_max_nights integer default null,
  p_min_advance_days integer default null,
  p_max_advance_days integer default null,
  p_arrival_days_of_week integer[] default null,
  p_rate_plan_ids uuid[] default null,
  p_room_type_ids uuid[] default null,
  p_priority integer default 0,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security invoker
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_id uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can set up a promotion';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'A promotion needs a name';
  end if;

  if p_id is null then
    insert into public.promotions (
      property_id, code, name, description, kind,
      percent_bps, amount_off_cents, free_nights, paid_nights,
      sell_from, sell_to, stay_from, stay_to,
      min_nights, max_nights, min_advance_days, max_advance_days,
      arrival_days_of_week, priority, is_active, created_by
    ) values (
      v_property,
      nullif(upper(btrim(coalesce(p_code, ''))), ''),
      btrim(p_name),
      nullif(btrim(coalesce(p_description, '')), ''),
      p_kind,
      p_percent_bps, p_amount_off_cents, p_free_nights, p_paid_nights,
      p_sell_from, p_sell_to, p_stay_from, p_stay_to,
      p_min_nights, p_max_nights, p_min_advance_days, p_max_advance_days,
      nullif(p_arrival_days_of_week, '{}'),
      coalesce(p_priority, 0), coalesce(p_is_active, true), auth.uid()
    )
    returning id into v_id;
  else
    update public.promotions set
      code = nullif(upper(btrim(coalesce(p_code, ''))), ''),
      name = btrim(p_name),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      kind = p_kind,
      percent_bps = p_percent_bps,
      amount_off_cents = p_amount_off_cents,
      free_nights = p_free_nights,
      paid_nights = p_paid_nights,
      sell_from = p_sell_from,
      sell_to = p_sell_to,
      stay_from = p_stay_from,
      stay_to = p_stay_to,
      min_nights = p_min_nights,
      max_nights = p_max_nights,
      min_advance_days = p_min_advance_days,
      max_advance_days = p_max_advance_days,
      arrival_days_of_week = nullif(p_arrival_days_of_week, '{}'),
      priority = coalesce(p_priority, 0),
      is_active = coalesce(p_is_active, true)
    where id = p_id and property_id = v_property
    returning id into v_id;

    if v_id is null then
      raise exception 'That promotion is not on this property';
    end if;
  end if;

  -- The links are replaced wholesale rather than diffed: the form always sends
  -- the full set, and a half-applied change here would quietly widen or narrow
  -- who gets the offer.
  delete from public.promotion_rate_plans where promotion_id = v_id;
  delete from public.promotion_room_types where promotion_id = v_id;

  if p_rate_plan_ids is not null and cardinality(p_rate_plan_ids) > 0 then
    insert into public.promotion_rate_plans (promotion_id, rate_plan_id, property_id)
    select v_id, rp.id, v_property
    from unnest(p_rate_plan_ids) as t(rate_plan_id)
    join public.rate_plans rp
      on rp.id = t.rate_plan_id and rp.property_id = v_property;
  end if;

  if p_room_type_ids is not null and cardinality(p_room_type_ids) > 0 then
    insert into public.promotion_room_types (promotion_id, room_type_id, property_id)
    select v_id, rt.id, v_property
    from unnest(p_room_type_ids) as t(room_type_id)
    join public.room_types rt
      on rt.id = t.room_type_id and rt.property_id = v_property;
  end if;

  return v_id;
end;
$$;

-- The list behind the Promotions screen, with what each one is worth so far.
create function public.promotions_list()
returns table (
  promotion_id uuid,
  code text,
  name text,
  description text,
  kind public.promotion_kind,
  percent_bps integer,
  amount_off_cents bigint,
  free_nights integer,
  paid_nights integer,
  sell_from date,
  sell_to date,
  stay_from date,
  stay_to date,
  min_nights integer,
  max_nights integer,
  min_advance_days integer,
  max_advance_days integer,
  arrival_days_of_week integer[],
  priority integer,
  is_active boolean,
  rate_plan_names text,
  room_type_names text,
  bookings_taken bigint,
  discount_given_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id,
    p.code,
    p.name,
    p.description,
    p.kind,
    p.percent_bps,
    p.amount_off_cents,
    p.free_nights,
    p.paid_nights,
    p.sell_from,
    p.sell_to,
    p.stay_from,
    p.stay_to,
    p.min_nights,
    p.max_nights,
    p.min_advance_days,
    p.max_advance_days,
    p.arrival_days_of_week,
    p.priority,
    p.is_active,
    plans.names,
    types.names,
    coalesce(used.bookings, 0)::bigint,
    coalesce(used.discount, 0)::bigint
  from public.promotions p
  left join lateral (
    select string_agg(rp.name, ', ' order by rp.name) as names
    from public.promotion_rate_plans x
    join public.rate_plans rp on rp.id = x.rate_plan_id
    where x.promotion_id = p.id
  ) plans on true
  left join lateral (
    select string_agg(rt.name, ', ' order by rt.name) as names
    from public.promotion_room_types x
    join public.room_types rt on rt.id = x.room_type_id
    where x.promotion_id = p.id
  ) types on true
  left join lateral (
    select
      count(distinct b.id) as bookings,
      sum(n.discount_cents) as discount
    from public.bookings b
    left join public.booking_rooms br
      on br.booking_id = b.id and br.property_id = b.property_id
    left join public.booking_room_nights n
      on n.booking_room_id = br.id and n.property_id = br.property_id
    where b.promotion_id = p.id
      and b.property_id = p.property_id
      and b.status not in ('canceled', 'no_show')
  ) used on true
  where p.property_id = public.current_property_id()
  order by p.is_active desc, p.priority desc, p.name;
$$;

revoke all on function public.save_promotion(
  text, public.promotion_kind, uuid, text, text, integer, bigint, integer,
  integer, date, date, date, date, integer, integer, integer, integer,
  integer[], uuid[], uuid[], integer, boolean
) from public, anon;
revoke all on function public.promotions_list() from public, anon;

grant execute on function public.save_promotion(
  text, public.promotion_kind, uuid, text, text, integer, bigint, integer,
  integer, date, date, date, date, integer, integer, integer, integer,
  integer[], uuid[], uuid[], integer, boolean
) to authenticated;
grant execute on function public.promotions_list() to authenticated;


-- Taking a booking with a promotion on it -------------------------------------
--
-- Same reasoning as the inventory in 0026: a promotions screen that nothing
-- reads is worse than no screen. The winning promotion is chosen inside the
-- transaction that writes the nights, so two people quoting the same code at
-- once both get the same answer, and it is recorded on the booking so a guest
-- asking "what discount did I have" can be told.
--
-- Dropped and recreated rather than replaced: the new code parameter has a
-- default, so adding it would leave PostgREST choosing between two overloads.

drop function public.create_booking(
  date, date, jsonb, uuid, uuid, jsonb, integer, integer,
  public.booking_status, public.booking_settlement, uuid, text, text, text,
  boolean, uuid, boolean
);

create function public.create_booking(
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
  p_tax_rate_id uuid default null,
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
  v_missing date;
  v_night record;
  v_promo record;
  v_promotion_id uuid;
  v_promotion_name text;
  v_discount_total bigint := 0;
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

  -- A quoted code that matches nothing is worth saying out loud. Silently
  -- taking the booking at full price is how a guest arrives expecting a
  -- discount nobody recorded.
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
    for v_line in
      select (line ->> 'room_type_id')::uuid as room_type_id
      from jsonb_array_elements(p_rooms) as line
    loop
      v_violation := public.stay_rule_violation(
        p_rate_plan_id, v_line.room_type_id, p_check_in, p_check_out
      );
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

    -- The best promotion for this room type, chosen here rather than in the
    -- browser so two people quoting the same code at once get the same answer.
    -- A line priced by hand is left alone: somebody has already decided what
    -- that room costs and a promotion on top would be a second discount.
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

    for i in 1 .. v_line.quantity loop
      insert into public.booking_rooms (
        property_id, booking_id, room_type_id, status,
        check_in, check_out, adults, children
      ) values (
        v_property, v_booking, v_line.room_type_id, p_status,
        p_check_in, p_check_out,
        greatest(coalesce(v_line.adults, p_adults), 1),
        greatest(coalesce(v_line.children, coalesce(p_children, 0)), 0)
      )
      returning id into v_booking_room;

      for v_night in
        select
          bn.id,
          bn.stay_date,
          coalesce(v_line.rate_cents, d.rate_cents) as rate_cents,
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
        if p_tax_rate_id is not null then
          -- Tax follows the money the guest actually pays, so it is worked out
          -- after the discount rather than on the undiscounted rate.
          select t.net_cents, t.tax_cents into v_net_cents, v_tax_cents
          from public.apply_tax_rate(
            p_tax_rate_id, greatest(v_night.rate_cents - v_night.discount_cents, 0)
          ) t;
          -- room_rate_cents stays the full rate and the discount stays
          -- separate, because every report nets them and a pre-netted rate
          -- would make the discount invisible.
          v_net_cents := v_net_cents + v_night.discount_cents;
        else
          v_net_cents := v_night.rate_cents;
          v_tax_cents := 0;
        end if;

        update public.booking_room_nights
        set room_rate_cents = v_net_cents,
            tax_cents = v_tax_cents,
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

comment on function public.create_booking(
  date, date, jsonb, uuid, uuid, jsonb, integer, integer,
  public.booking_status, public.booking_settlement, uuid, text, text, text,
  boolean, uuid, boolean, text
) is
  'Takes a booking against the loaded inventory, applying the best promotion. HP001 means it would oversell; HP002 means it breaks a stay rule.';

revoke all on function public.create_booking(
  date, date, jsonb, uuid, uuid, jsonb, integer, integer,
  public.booking_status, public.booking_settlement, uuid, text, text, text,
  boolean, uuid, boolean, text
) from public, anon;
grant execute on function public.create_booking(
  date, date, jsonb, uuid, uuid, jsonb, integer, integer,
  public.booking_status, public.booking_settlement, uuid, text, text, text,
  boolean, uuid, boolean, text
) to authenticated;
