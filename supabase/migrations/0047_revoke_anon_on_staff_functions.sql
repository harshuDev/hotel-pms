-- 0047: take `anon` back off the staff functions, and close a role guard that
-- never fired.
--
-- Found while verifying 0046 against the hosted database rather than by
-- reading the code, which is the only way it could have been found.
--
-- WHAT DRIFTED. `revoke all on function ... from public` does not remove a
-- grant held by a named role, and Supabase projects carry
-- `alter default privileges in schema public grant execute on functions to
-- anon, authenticated, service_role`. So every function created since that
-- default was set came out with `anon=X` on it however carefully the migration
-- revoked PUBLIC afterwards. Thirteen had it, and the ones added by the recent
-- calendar, meal and debtors work are among them.
--
-- CLAUDE.md says the public surface is four `security definer` RPCs and
-- nothing else. This restores that. It is tidying rather than a breach: every
-- one of these is `security invoker` bar `close_business_date`, so an
-- anonymous caller runs them as `anon`, `current_property_id()` is null, and
-- RLS returns nothing. Being able to call a staff function at all is still not
-- what the brief says, and a future function that is less careful would inherit
-- the same grant silently.
--
-- THE GUARD THAT NEVER FIRED, which is the part that actually matters.
--
--   if public.current_role() not in ('admin', 'manager') then raise ...
--
-- `current_role()` is null for anybody with no active `staff_users` row, and
-- `null not in (...)` is null, not true. plpgsql treats a null `if` as false,
-- so the guard is skipped exactly for the callers it exists to stop. The
-- function then failed anyway, on "There is no open business date to close",
-- because `current_property_id()` is null too — it fails closed by accident,
-- one query away from not doing so.
--
-- That matters most here because `close_business_date()` is `security definer`:
-- it runs as its owner, so RLS is not the backstop it is everywhere else.
--
-- 0016 makes this more than theoretical. It made `is_active = false` withdraw
-- access everywhere, and `current_role()` returns null for a deactivated user —
-- so a member of staff who had just been deactivated passed this check too.
--
-- The codebase already has the right idiom, in `is_revenue_staff()`:
-- `coalesce(public.current_role() in ('admin', 'manager'), false)`. Only the
-- guard changes below; the body is 0040's, unchanged.
--
-- SEVEN MORE LIKE IT ARE LEFT ALONE, deliberately. The same `not in` shape is
-- in 0003, 0004 (four times), 0011 and 0013, on the folio and cashier paths.
-- Each looks to fail closed the same accidental way, but proving that one by
-- one is a bigger change than this, and it touches money. Raised rather than
-- swept in.

/* -------------------------------------------------------------------------- */
/* anon comes off every staff function                                        */
/* -------------------------------------------------------------------------- */

revoke execute on function public.calendar_bookings(date, integer, integer, boolean) from anon;
revoke execute on function public.calendar_seasons(date, integer) from anon;
revoke execute on function public.close_business_date() from anon;
revoke execute on function public.customer_display_name(public.customers) from anon;
revoke execute on function public.debtors_report() from anon;
revoke execute on function public.delete_season(uuid) from anon;
revoke execute on function public.get_folio_balance(uuid) from anon;
revoke execute on function public.room_status_by_type() from anon;
revoke execute on function public.save_season(text, date, date, uuid) from anon;
revoke execute on function public.set_rate_plan_meal_value(uuid, public.meal_type, bigint) from anon;

-- Trigger functions. A trigger does not need EXECUTE to fire, so this changes
-- nothing about how they run; it is only that nothing should be able to call
-- them directly.
revoke execute on function public.prevent_cashier_mutation() from anon;
revoke execute on function public.prevent_financial_mutation() from anon;
revoke execute on function public.protect_cashier_shift() from anon;

-- Four of them hold it through PUBLIC rather than a grant to `anon` — the
-- Postgres default for a new function is EXECUTE to PUBLIC, and their
-- migrations (0001 to 0004) never revoked it. `revoke ... from anon` does not
-- touch a PUBLIC grant, so these need the other revoke. `authenticated` keeps
-- its own explicit grant, which is what the callers actually use:
-- customer_display_name and get_folio_balance are called from inside other
-- `security invoker` functions running as the signed-in staff user.
revoke execute on function public.customer_display_name(public.customers) from public;
revoke execute on function public.get_folio_balance(uuid) from public;
revoke execute on function public.prevent_cashier_mutation() from public;
revoke execute on function public.protect_cashier_shift() from public;

/* -------------------------------------------------------------------------- */
/* The guard, written so null is a refusal                                    */
/* -------------------------------------------------------------------------- */

create or replace function public.close_business_date()
returns table(
  closed_date date,
  next_date date,
  room_charges_posted integer,
  room_charges_cents bigint,
  no_shows_marked integer,
  no_show_fees_cents bigint
)
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_property uuid;
  v_bd public.business_dates;
  v_open_shifts integer;
  v_posted integer := 0;
  v_cents bigint := 0;
  v_no_shows integer := 0;
  v_fees bigint := 0;
  v_folio uuid;
  v_net bigint;
  v_tax bigint;
  r record;
begin
  -- coalesce, so a caller with no active staff row — anonymous, or somebody
  -- deactivated since 0016 — is refused rather than falling through a null.
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

  -- A shift belongs to a business date, and a cash payment must land on an
  -- open one. Closing the day under an open drawer would strand that shift:
  -- it could never take another cash payment, and its float would sit on a
  -- day that is already shut.
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

  -- No-shows first. They cannot collide with the room charges below: that loop
  -- only posts nights already `checked_in`, and these are `confirmed`, so no
  -- booking is touched by both. Doing them first means the released rooms are
  -- free from the moment the day rolls.
  --
  -- `<=` rather than `=` on the arrival date so a backlog cannot accumulate
  -- silently. Run daily there is never more than one day's worth; run for the
  -- first time against an old open date, it sweeps what was missed.
  for r in
    select b.id, b.reference, b.check_in
    from public.bookings b
    where b.property_id = v_property
      and b.status = 'confirmed'
      and b.check_in <= v_bd.business_date
    order by b.reference
  loop
    -- Read the arrival night before releasing it. cancel_booking() moves the
    -- night to `no_show` but leaves its money alone, so either order would
    -- give the same figure; taking it first says which figure is meant.
    select
      coalesce(sum(n.room_rate_cents - n.discount_cents), 0)::bigint,
      coalesce(sum(n.tax_cents), 0)::bigint
    into v_net, v_tax
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    where br.booking_id = r.id
      and n.property_id = v_property
      and n.stay_date = r.check_in
      and n.status not in ('canceled', 'no_show');

    perform public.cancel_booking(
      r.id,
      true,
      format('No-show recorded by the night audit closing %s', v_bd.business_date)
    );

    v_no_shows := v_no_shows + 1;

    if v_net > 0 then
      select f.id into v_folio
      from public.folios f
      where f.booking_id = r.id
        and f.property_id = v_property
        and f.status = 'open'
      order by f.is_primary desc, f.folio_number
      limit 1;

      if v_folio is null then
        raise exception
          'Booking % has no open folio, so its no-show fee for % cannot be posted',
          r.reference, r.check_in;
      end if;

      perform public.post_charge(
        v_folio,
        'miscellaneous',
        format('No-show fee for %s (first night)', r.check_in),
        v_net,
        1,
        v_tax,
        null,
        v_bd.business_date
      );

      v_fees := v_fees + v_net + v_tax;
    end if;
  end loop;

  -- One room charge per room per night. The not-exists keeps a retried audit
  -- from double-charging, and the unique index behind it is the real guard.
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
    format('Business date %s closed, %s room charge(s) posted, %s no-show(s)',
           v_bd.business_date, v_posted, v_no_shows),
    jsonb_build_object(
      'closed_date', v_bd.business_date,
      'next_date', v_bd.business_date + 1,
      'room_charges_posted', v_posted,
      'room_charges_cents', v_cents,
      'no_shows_marked', v_no_shows,
      'no_show_fees_cents', v_fees
    )
  );

  return query
  select
    v_bd.business_date,
    (v_bd.business_date + 1)::date,
    v_posted,
    v_cents,
    v_no_shows,
    v_fees;
end;
$function$;

revoke all on function public.close_business_date() from public;
revoke execute on function public.close_business_date() from anon;
grant execute on function public.close_business_date() to authenticated;
