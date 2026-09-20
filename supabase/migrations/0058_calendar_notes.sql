-- 0058: an operational note against a day on the calendar.
--
-- The client's reference PMS puts an "Add Note" action on a calendar date: a
-- dialog with the date, a note field, Cancel and Save, and the saved note
-- visible on the board afterwards.
--
-- WHAT THIS IS NOT, and why none of the existing note columns could be reused:
--
--   bookings.guest_notes        what the guest asked for. Belongs to a stay.
--   bookings.internal_notes     staff note about a stay. Belongs to a stay.
--   booking_waitlist.notes      about an enquiry that has no booking.
--   cashier_shifts.*_notes      about a drawer and a shift, not a day.
--   meeting_room_bookings.comments   about one meeting room booking.
--   activity_log                an append-only trail of what the system did.
--                               Deliberately NOT used: it records events that
--                               happened, it is not somewhere a person writes.
--
-- A calendar note belongs to a PROPERTY and a DAY and to nothing else: "coach
-- party arriving 14:00", "lift out of service", "kitchen closed for the
-- evening". Nothing in this schema held that, so this is a new table.

/* -------------------------------------------------------------------------- */
/* The table                                                                  */
/* -------------------------------------------------------------------------- */

/*
 * `note_date` IS NOT `business_date`, AND THERE IS NO FOREIGN KEY TO
 * `business_dates`. That is deliberate and is the one decision here worth
 * arguing about.
 *
 * `business_dates` holds the days the night audit has opened or closed. The
 * board shows weeks ahead of that, and the whole point of a day note is to
 * write something down BEFORE the day arrives -- so keying to `business_dates`
 * would make it impossible to note next Tuesday, and would tie note-keeping to
 * the audit. The business date rules are untouched by this migration: nothing
 * here reads, writes or constrains `business_dates`.
 *
 * SEVERAL NOTES PER DAY ARE ALLOWED. No unique constraint on (property, date):
 * two different things can happen on one day, and forcing them into one
 * textarea means the second person to write overwrites the first.
 */
create table if not exists public.calendar_notes (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  /* The day on the board this note is about. */
  note_date date not null,
  body text not null,
  /* Who wrote it. Nullable, and null if that staff row is ever removed --
     losing the author is not a reason to lose the note. */
  created_by uuid references public.staff_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_notes_body_not_blank check (btrim(body) <> '')
);

create index if not exists calendar_notes_property_date_idx
  on public.calendar_notes (property_id, note_date);

comment on table public.calendar_notes is
  'An operational note against one property and one calendar day. Not a booking note, not a shift note, and not the activity log. note_date is a day on the board and deliberately does not reference business_dates, so a day can be noted before the audit reaches it.';

/* -------------------------------------------------------------------------- */
/* Property isolation                                                         */
/* -------------------------------------------------------------------------- */

alter table public.calendar_notes enable row level security;

/* Anyone signed in to the property may read the day's notes -- that is the
   point of writing one. Housekeeping reads the board too. */
drop policy if exists calendar_notes_select on public.calendar_notes;
create policy calendar_notes_select on public.calendar_notes
  for select using (property_id = public.current_property_id());

/* Writing is front office, matching `assign_room()` and everything else that
   changes what the board says. */
drop policy if exists calendar_notes_write on public.calendar_notes;
create policy calendar_notes_write on public.calendar_notes
  for all
  using (
    property_id = public.current_property_id()
    and public.is_front_office_staff()
  )
  with check (
    property_id = public.current_property_id()
    and public.is_front_office_staff()
  );

/* -------------------------------------------------------------------------- */
/* Reading a window of the board                                              */
/* -------------------------------------------------------------------------- */

/* Shaped like `calendar_seasons()`: the notes touching the dates on screen,
   so the board makes one call rather than one per column. */
create function public.calendar_notes_for(
  p_from date,
  p_days integer default 14
)
returns table (
  id uuid,
  note_date date,
  body text,
  author text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $function$
  select
    n.id,
    n.note_date,
    n.body,
    s.full_name,
    n.created_at,
    n.updated_at
  from public.calendar_notes n
  left join public.staff_users s
    on s.id = n.created_by and s.property_id = n.property_id
  where n.property_id = public.current_property_id()
    and n.note_date >= p_from
    and n.note_date < p_from + greatest(coalesce(p_days, 14), 1)
  order by n.note_date, n.created_at;
$function$;

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

/*
 * One function for create and correct, like `save_season()` and
 * `save_rate_plan()`: a null id writes a new note, an id corrects one.
 *
 * `security invoker`, so the policy above is what decides -- there is no
 * second copy of the role rule here to drift from it.
 */
create function public.save_calendar_note(
  p_note_date date,
  p_body text,
  p_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_property uuid;
  v_body text;
  v_id uuid;
begin
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if p_note_date is null then
    raise exception 'A note needs a date';
  end if;

  v_body := nullif(btrim(coalesce(p_body, '')), '');
  if v_body is null then
    raise exception 'A note needs something written in it';
  end if;

  if p_id is null then
    insert into public.calendar_notes (property_id, note_date, body, created_by)
    values (v_property, p_note_date, v_body, auth.uid())
    returning id into v_id;
  else
    update public.calendar_notes
    set note_date = p_note_date,
        body = v_body,
        updated_at = now()
    where id = p_id and property_id = v_property
    returning id into v_id;

    if v_id is null then
      raise exception 'That note is not on this property';
    end if;
  end if;

  return v_id;
end;
$function$;

/*
 * A calendar note is genuinely deleted, like a season and unlike a room or a
 * folio item. Nothing points at one and it is not a record of money or of a
 * stay -- it is somebody's reminder, and a reminder that no longer applies is
 * noise on the board.
 */
create function public.delete_calendar_note(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_property uuid;
begin
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  delete from public.calendar_notes
  where id = p_id and property_id = v_property;

  if not found then
    raise exception 'That note is not on this property';
  end if;
end;
$function$;

/* -------------------------------------------------------------------------- */
/* Grants                                                                     */
/* -------------------------------------------------------------------------- */

revoke all on function public.calendar_notes_for(date, integer) from public, anon;
revoke all on function public.save_calendar_note(date, text, uuid) from public, anon;
revoke all on function public.delete_calendar_note(uuid) from public, anon;

grant execute on function public.calendar_notes_for(date, integer) to authenticated;
grant execute on function public.save_calendar_note(date, text, uuid) to authenticated;
grant execute on function public.delete_calendar_note(uuid) to authenticated;
