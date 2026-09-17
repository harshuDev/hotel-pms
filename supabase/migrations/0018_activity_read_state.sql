-- The activity feed's "unread" was a lie.
--
-- activity_feed() returned unread: false for every row because nothing
-- tracked what anyone had seen, and "Mark all read" only set a flag in the
-- browser that a refresh threw away. The highlight meant nothing.
--
-- One timestamp per member of staff is enough for a feed like this: anything
-- newer than the last time you cleared it is unread. Per-row read receipts
-- would be a lot of rows to answer a question nobody asks.

alter table public.staff_users
  add column activity_seen_at timestamptz;

comment on column public.staff_users.activity_seen_at is
  'When this member of staff last cleared the activity feed. Null means they never have.';

-- Return type changes, so this is dropped rather than replaced, and the grant
-- is restored below.
drop function public.activity_feed(integer, integer);

create function public.activity_feed(p_limit integer default 40, p_offset integer default 0)
returns table (
  id uuid,
  kind text,
  summary text,
  emphasis text[],
  created_at timestamptz,
  unread boolean
)
language sql
stable
security invoker
set search_path = public, auth
as $$
  select
    a.id,
    case a.action
      when 'booking_created' then 'BOOKING'
      when 'booking_cancelled' then 'CANCELLATION'
      when 'guest_checked_in' then 'CHECKIN'
      when 'guest_checked_out' then 'CHECKOUT'
      when 'payment_received' then 'PAYMENT'
      when 'cash_payment_received' then 'PAYMENT'
      when 'payment_reversed' then 'PAYMENT'
      when 'folio_settled' then 'PAYMENT'
      else 'MODIFICATION'
    end as kind,
    a.summary,
    array_remove(
      array[
        a.metadata ->> 'reference',
        a.metadata ->> 'room_number'
      ],
      null
    ) as emphasis,
    a.created_at,
    a.created_at > coalesce(
      (select u.activity_seen_at from public.staff_users u where u.id = auth.uid()),
      '-infinity'::timestamptz
    ) as unread
  from public.activity_log a
  where a.property_id = public.current_property_id()
  order by a.created_at desc
  limit greatest(coalesce(p_limit, 40), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.activity_feed(integer, integer) is
  'Most recent activity_log rows, classified into the six kinds the feed renders, with unread measured against the viewer''s last clear.';

-- Security definer because staff_users may only be updated by an
-- administrator, and clearing your own feed is not an administrative act.
create function public.mark_activity_seen()
returns timestamptz
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_now timestamptz := now();
begin
  update public.staff_users
  set activity_seen_at = v_now
  where id = auth.uid()
    and property_id = public.current_property_id();

  if not found then
    raise exception 'No active staff account to clear the feed for';
  end if;

  return v_now;
end;
$$;

comment on function public.mark_activity_seen() is
  'Marks the activity feed read up to now for the signed-in member of staff.';

revoke all on function
  public.activity_feed(integer, integer),
  public.mark_activity_seen()
from public, anon;

grant execute on function
  public.activity_feed(integer, integer),
  public.mark_activity_seen()
to authenticated;
