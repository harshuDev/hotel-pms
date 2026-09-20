-- 0060: cancellation policies, which the client described directly.
--
--   "for CANCELLATION POLICY each hotel have different policy.
--
--    Flexible Cancellation: The hotel choose how many day in Advance the guest
--    can cancel for free.
--
--    Non Refundable: Means that the guests cannot cancel or modify and the
--    hotel can charge the guest card anytime."
--
-- This is the table CLAUDE.md has been pointing at since 0054, where the rate
-- plan note reads: "'Non-refundable' is a name, not yet a rule. A plan can be
-- called that and priced like it today; what actually refuses a refund is a
-- cancellation policy, and there is no cancellation policy table yet. Do not
-- pretend otherwise in the interface." There is one now, so that stops being
-- true and the interface can stop pretending.
--
-- A POLICY HANGS OFF A RATE PLAN, not off the property. "Each hotel have
-- different policy" is satisfied by the policies being per-property rows that
-- each hotel writes for itself; what a policy actually governs is a rate,
-- because Flexible and Non-refundable are two things one hotel sells side by
-- side at two different prices. That is the whole commercial point of a
-- non-refundable rate, and it is why "Non-refundable" was already a rate plan
-- NAME here before it was a rule.
--
-- WHAT THIS DOES NOT DO: charge anybody's card. "The hotel can charge the
-- guest card anytime" describes a right the policy grants the hotel, and this
-- migration records that right. It cannot exercise it -- there is no Stripe
-- code in this repository and no keys in any environment (see "Card capture is
-- not built" in CLAUDE.md). A non-refundable booking here means the charge
-- stands and the folio still says what is owed; collecting it is the front
-- desk's job until card capture is built.

/* -------------------------------------------------------------------------- */
/* The kinds                                                                  */
/* -------------------------------------------------------------------------- */

/*
 * Two kinds, because the client named two and they behave differently rather
 * than being one setting at two values:
 *
 *   flexible         free to cancel up to N days before arrival, then not.
 *                    N is the hotel's choice and 0 is meaningful -- it means
 *                    free until the arrival day itself.
 *   non_refundable   never free, and the hotel may charge regardless.
 *
 * A third kind would be a new value plus a branch in the deadline arithmetic,
 * the same shape `promotion_kind` already has.
 */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'cancellation_policy_kind') then
    create type public.cancellation_policy_kind as enum ('flexible', 'non_refundable');
  end if;
end $$;

/* -------------------------------------------------------------------------- */
/* The table                                                                  */
/* -------------------------------------------------------------------------- */

create table if not exists public.cancellation_policies (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  /* What the hotel calls it. This is what a guest reads, so it is the hotel's
     wording and not the enum: "Free cancellation until 3 days before". */
  name text not null,
  kind public.cancellation_policy_kind not null,
  /*
   * How many days before arrival the guest may still cancel for free.
   * Flexible only, and required there. Null on a non-refundable policy,
   * because "how many days" has no answer when the answer is never.
   */
  free_cancellation_days integer,
  /* The hotel's own words, shown to the guest under the name. */
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cancellation_policies_name_not_blank check (btrim(name) <> ''),
  /* The two kinds carry different columns, and the check is what stops a
     non-refundable policy quietly holding a free-cancellation window that
     nothing would ever read. */
  constraint cancellation_policies_days_match_kind check (
    (kind = 'flexible' and free_cancellation_days is not null and free_cancellation_days >= 0)
    or
    (kind = 'non_refundable' and free_cancellation_days is null)
  )
);

create index if not exists cancellation_policies_property_idx
  on public.cancellation_policies (property_id, is_active);

comment on table public.cancellation_policies is
  'What a rate plan promises about cancelling. Flexible carries a free-cancellation window in days before arrival; non-refundable carries none and never goes free. Recording that a hotel MAY charge a card is not the same as charging one -- there is no card capture in this system.';

/* -------------------------------------------------------------------------- */
/* Property isolation                                                         */
/* -------------------------------------------------------------------------- */

alter table public.cancellation_policies enable row level security;

/* Everyone on the property reads: a receptionist taking a booking has to be
   able to say what the terms are. */
drop policy if exists cancellation_policies_select on public.cancellation_policies;
create policy cancellation_policies_select on public.cancellation_policies
  for select using (property_id = public.current_property_id());

/* Writing is revenue staff -- admin and manager -- the same gate rate plans
   and rates already sit behind. What a cancellation costs is a commercial
   decision, not a front desk one. */
drop policy if exists cancellation_policies_write on public.cancellation_policies;
create policy cancellation_policies_write on public.cancellation_policies
  for all
  using (
    property_id = public.current_property_id()
    and public.is_revenue_staff()
  )
  with check (
    property_id = public.current_property_id()
    and public.is_revenue_staff()
  );

/* -------------------------------------------------------------------------- */
/* The link to a rate plan                                                    */
/* -------------------------------------------------------------------------- */

/*
 * Nullable, and null means "no rule" -- the same convention the whole
 * inventory uses. A plan with no policy promises nothing in particular and
 * the screens say exactly that rather than inventing a default. Setting a
 * default here would be putting words in a hotel's mouth about refunds.
 *
 * `on delete restrict`: a policy a booking was sold under cannot be deleted
 * out from under it, which is why the screen retires rather than deletes.
 */
alter table public.rate_plans
  add column if not exists cancellation_policy_id uuid
  references public.cancellation_policies(id) on delete restrict;

comment on column public.rate_plans.cancellation_policy_id is
  'The cancellation terms this rate is sold on. Null means no policy is set, which is not the same as free cancellation -- the screens say "not set" rather than guessing.';

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

create or replace function public.cancellation_policies_list()
returns table (
  id uuid,
  name text,
  kind public.cancellation_policy_kind,
  free_cancellation_days integer,
  description text,
  is_active boolean,
  sort_order integer,
  /* How many rate plans point at it. The screen says so instead of letting
     somebody retire the policy every live rate is sold on and find out
     afterwards. */
  rate_plan_count integer
)
language sql
stable
security invoker
set search_path = public
as $function$
  select
    c.id,
    c.name,
    c.kind,
    c.free_cancellation_days,
    c.description,
    c.is_active,
    c.sort_order,
    (
      select count(*)::integer
      from public.rate_plans rp
      where rp.cancellation_policy_id = c.id
        and rp.property_id = c.property_id
    )
  from public.cancellation_policies c
  where c.property_id = public.current_property_id()
  order by c.sort_order, c.name;
$function$;

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

/*
 * One function for create and correct, like `save_season()` and
 * `save_rate_plan()`. A null id writes a new policy, an id corrects one.
 *
 * There is NO DELETE, for the same reason a rate plan and a tax rate have
 * none: `rate_plans.cancellation_policy_id` points at it under
 * `on delete restrict`, and a booking taken on a policy keeps meaning what it
 * was sold under. One no longer offered is `is_active = false`.
 */
create or replace function public.save_cancellation_policy(
  p_name text,
  p_kind public.cancellation_policy_kind,
  p_free_cancellation_days integer default null,
  p_description text default null,
  p_is_active boolean default true,
  p_sort_order integer default 0,
  p_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_property uuid;
  v_name text;
  v_days integer;
  v_id uuid;
begin
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'A cancellation policy needs a name';
  end if;

  /*
   * The days field belongs to `flexible` and only to it. Rather than refusing
   * a stray value on a non-refundable policy, it is dropped -- somebody
   * switching a policy from Flexible to Non-refundable in the form should not
   * have to clear a field that the new kind does not have.
   */
  if p_kind = 'flexible' then
    v_days := coalesce(p_free_cancellation_days, 0);
    if v_days < 0 then
      raise exception 'Free cancellation days cannot be negative';
    end if;
    if v_days > 365 then
      raise exception 'Free cancellation days cannot be more than 365';
    end if;
  else
    v_days := null;
  end if;

  if p_id is null then
    insert into public.cancellation_policies
      (property_id, name, kind, free_cancellation_days, description, is_active, sort_order)
    values
      (v_property, v_name, p_kind, v_days, nullif(btrim(coalesce(p_description, '')), ''),
       coalesce(p_is_active, true), coalesce(p_sort_order, 0))
    returning id into v_id;
  else
    update public.cancellation_policies
    set name = v_name,
        kind = p_kind,
        free_cancellation_days = v_days,
        description = nullif(btrim(coalesce(p_description, '')), ''),
        is_active = coalesce(p_is_active, true),
        sort_order = coalesce(p_sort_order, 0),
        updated_at = now()
    where id = p_id and property_id = v_property
    returning id into v_id;

    if v_id is null then
      raise exception 'That cancellation policy is not on this property';
    end if;
  end if;

  return v_id;
end;
$function$;

/* -------------------------------------------------------------------------- */
/* Putting a policy on a rate plan                                            */
/* -------------------------------------------------------------------------- */

/*
 * Its own function rather than a seventh parameter on `save_rate_plan()`, for
 * the reason `set_room_photo()` is its own function and not a parameter on
 * `save_room()`: an optional parameter would be an overload for PostgREST to
 * choose between, and every rename of a plan would otherwise be saying
 * "and no cancellation policy" unless the form remembered to send it back.
 *
 * Null clears the policy, which is a real thing to want: a hotel that stops
 * promising anything about cancellation should be able to say so.
 */
create or replace function public.set_rate_plan_cancellation_policy(
  p_rate_plan_id uuid,
  p_cancellation_policy_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_property uuid;
  v_ok boolean;
begin
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if not coalesce(public.is_revenue_staff(), false) then
    raise exception 'Only an administrator or manager can set cancellation terms';
  end if;

  /* A policy from another property is not a policy this plan may carry. RLS
     already hides it, so this turns an invisible row into a named refusal. */
  if p_cancellation_policy_id is not null then
    select true into v_ok
    from public.cancellation_policies c
    where c.id = p_cancellation_policy_id and c.property_id = v_property;

    if not coalesce(v_ok, false) then
      raise exception 'That cancellation policy is not on this property';
    end if;
  end if;

  update public.rate_plans
  set cancellation_policy_id = p_cancellation_policy_id,
      updated_at = now()
  where id = p_rate_plan_id and property_id = v_property;

  if not found then
    raise exception 'That rate plan is not on this property';
  end if;
end;
$function$;

/* -------------------------------------------------------------------------- */
/* What a booking's terms actually are                                        */
/* -------------------------------------------------------------------------- */

/*
 * The deadline, worked out against the property's business date rather than
 * the clock. `business_date` is the hotel's operating day and is what every
 * other operational question here is answered against; `now()` would make the
 * answer change at UTC midnight rather than when the hotel says the day has
 * turned.
 *
 * Free when `business_date <= check_in - free_cancellation_days`. So a policy
 * of 3 days on an arrival of the 20th is free through the 17th and not on the
 * 18th, and a policy of 0 days is free through the arrival day itself.
 *
 * A BOOKING CAN CARRY MORE THAN ONE POLICY, because `booking_rooms` holds a
 * rate plan per room and a group booking may mix them. Rather than picking one
 * and hiding the rest, this reports the STRICTEST -- non-refundable beats
 * flexible, and among flexible the longest notice wins -- and sets `is_mixed`
 * so the screen can say the rooms differ instead of stating one room's terms
 * as though they were the booking's.
 */
create or replace function public.booking_cancellation_terms(p_booking_id uuid)
returns table (
  policy_name text,
  kind public.cancellation_policy_kind,
  free_cancellation_days integer,
  /* The last business date on which cancelling is still free. Null when the
     booking is non-refundable or carries no policy at all. */
  free_until date,
  /* Whether it is free TODAY, on the property's business date. */
  is_free_now boolean,
  /* True when the rooms on this booking do not all share one policy. */
  is_mixed boolean,
  /* True when no room on the booking names a policy -- "not set", which is
     not the same as free and must not be drawn as though it were. */
  has_no_policy boolean
)
language sql
stable
security invoker
set search_path = public
as $function$
  with bd as (
    select d.business_date
    from public.business_dates d
    where d.property_id = public.current_property_id()
      and d.closed_at is null
    order by d.business_date
    limit 1
  ),
  lines as (
    select
      br.check_in,
      c.id as policy_id,
      c.name as policy_name,
      c.kind,
      c.free_cancellation_days
    from public.booking_rooms br
    join public.bookings b
      on b.id = br.booking_id and b.property_id = br.property_id
    left join public.rate_plans rp
      on rp.id = br.rate_plan_id and rp.property_id = br.property_id
    left join public.cancellation_policies c
      on c.id = rp.cancellation_policy_id and c.property_id = rp.property_id
    where br.booking_id = p_booking_id
      and br.property_id = public.current_property_id()
      and br.status not in ('canceled', 'no_show')
  ),
  ranked as (
    select
      l.*,
      /* Strictest first: non-refundable, then the longest free window. */
      row_number() over (
        order by
          case when l.kind = 'non_refundable' then 0
               when l.kind = 'flexible' then 1
               else 2 end,
          l.free_cancellation_days desc nulls last
      ) as rn
    from lines l
  )
  select
    r.policy_name,
    r.kind,
    r.free_cancellation_days,
    case
      when r.kind = 'flexible'
        then r.check_in - r.free_cancellation_days
      else null
    end,
    case
      when r.kind = 'flexible'
        then (select bd.business_date from bd) <= (r.check_in - r.free_cancellation_days)
      when r.kind = 'non_refundable' then false
      else null
    end,
    (select count(distinct coalesce(l.policy_id::text, 'none')) from lines l) > 1,
    (select count(*) from lines l where l.policy_id is not null) = 0
  from ranked r
  where r.rn = 1;
$function$;

comment on function public.booking_cancellation_terms(uuid) is
  'The cancellation terms a booking was sold on, dated against the open business date. Reports the strictest policy across the booking rooms and flags a mixed booking rather than stating one room''s terms as the whole booking''s. It REPORTS and does not enforce: staff can always cancel, because a hotel that cannot cancel its own booking is broken.';

/* -------------------------------------------------------------------------- */
/* The guest has to be told before they book                                  */
/* -------------------------------------------------------------------------- */

/*
 * The return type changes, so this is a drop and recreate rather than a
 * replace -- `create or replace function` cannot change a return type.
 *
 * A guest agreeing to a non-refundable rate without being shown that it is
 * non-refundable is the one failure this whole feature exists to prevent, so
 * the terms travel with the plan on the public surface too. Still
 * `security definer` and still granted to `anon`, like the rest of that
 * surface, and it reads nothing a guest should not see: a name, a kind and a
 * number of days.
 */
drop function if exists public.public_rate_plans(uuid);

create function public.public_rate_plans(p_property_id uuid)
returns table (
  rate_plan_id uuid,
  code text,
  name text,
  description text,
  cancellation_name text,
  cancellation_kind public.cancellation_policy_kind,
  cancellation_free_days integer,
  cancellation_description text
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    rp.id,
    rp.code,
    rp.name,
    rp.description,
    c.name,
    c.kind,
    c.free_cancellation_days,
    c.description
  from public.rate_plans rp
  join public.properties p on p.id = rp.property_id and p.is_active
  left join public.cancellation_policies c
    on c.id = rp.cancellation_policy_id
   and c.property_id = rp.property_id
   and c.is_active
  where rp.property_id = p_property_id
    and rp.is_active
    and rp.is_public
  order by rp.sort_order, rp.name;
$function$;

/* -------------------------------------------------------------------------- */
/* Grants                                                                     */
/* -------------------------------------------------------------------------- */

revoke all on function public.cancellation_policies_list() from public, anon;
revoke all on function public.save_cancellation_policy(text, public.cancellation_policy_kind, integer, text, boolean, integer, uuid) from public, anon;
revoke all on function public.set_rate_plan_cancellation_policy(uuid, uuid) from public, anon;
revoke all on function public.booking_cancellation_terms(uuid) from public, anon;

grant execute on function public.cancellation_policies_list() to authenticated;
grant execute on function public.save_cancellation_policy(text, public.cancellation_policy_kind, integer, text, boolean, integer, uuid) to authenticated;
grant execute on function public.set_rate_plan_cancellation_policy(uuid, uuid) to authenticated;
grant execute on function public.booking_cancellation_terms(uuid) to authenticated;

/* The public surface keeps its anon grant, as it had before the recreate. */
revoke all on function public.public_rate_plans(uuid) from public;
grant execute on function public.public_rate_plans(uuid) to anon, authenticated;
