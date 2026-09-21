-- 0063: the two tabs the reference's booking popup has and ours did not.
--
-- The client: "Copy them too, I just want to clone the application." Their
-- reference's reservation panel carries eight tabs; ours carried six. The two
-- missing ones were Attachments and Email, and both had been left out -- no
-- storage for one, no mail provider for the other. The client decided they
-- want parity, so both are built.
--
-- WHAT IS REAL IN EACH, because they are not in the same position:
--
--   * ATTACHMENTS is complete. Files go to Supabase Storage from the browser
--     under the uploader's own session, exactly as a room photograph already
--     does, and `booking_attachments` records what is there. Nothing on this
--     server holds a service key.
--
--   * EMAIL IS A RECORD OF CORRESPONDENCE and does not send. Sending needs a
--     mail provider and an API key that no environment here holds, and a Send
--     button that cannot send is the dead control this application keeps
--     refusing to ship. So `booking_emails` is the log -- who was written to,
--     about what, when, and by whom -- which is what a front desk reads that
--     tab for. Wiring a provider later is an action and a key, not a second
--     migration: `sent_at` and `status` are already in the shape.

/* ========================================================================== */
/* PART 1 -- Attachments                                                      */
/* ========================================================================== */

create table if not exists public.booking_attachments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  /*
   * The object path inside the bucket, never a URL -- the same rule
   * `rooms.photo_path` follows. A url column renders whatever the browser
   * sent; a path is checked against the property prefix on both sides.
   */
  storage_path text not null unique,
  /* What the file was called when it was picked, for the list. */
  file_name text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  /*
   * Who attached it. `set null` rather than cascade: a member of staff
   * leaving does not un-attach the passport scan they uploaded, and the row
   * is evidence about the booking rather than about them.
   */
  uploaded_by uuid references public.staff_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists booking_attachments_booking_idx
  on public.booking_attachments (property_id, booking_id, created_at desc);

alter table public.booking_attachments enable row level security;

drop policy if exists booking_attachments_select on public.booking_attachments;
create policy booking_attachments_select on public.booking_attachments
  for select using (property_id = public.current_property_id());

drop policy if exists booking_attachments_insert on public.booking_attachments;
create policy booking_attachments_insert on public.booking_attachments
  for insert with check (
    property_id = public.current_property_id()
    and public.is_front_office_staff()
  );

/*
 * DELETE IS ALLOWED, unlike a folio row. An attachment is a document somebody
 * put on the booking, not a record of money or of a stay -- the wrong file
 * uploaded to the wrong reservation is a mistake to undo, not history to
 * keep. Same reasoning as a calendar note and a season.
 */
drop policy if exists booking_attachments_delete on public.booking_attachments;
create policy booking_attachments_delete on public.booking_attachments
  for delete using (
    property_id = public.current_property_id()
    and public.is_front_office_staff()
  );

/*
 * THE BUCKET IS PRIVATE, which is the opposite of `room-photos` and
 * deliberately so. A room photograph is marketing material that belongs on
 * the hotel's own website. An attachment on a reservation is a passport scan,
 * a signed registration card, a company purchase order -- guest documents,
 * and a public bucket would put them one guessed URL away from anyone.
 *
 * Reading therefore goes through a signed URL minted under the reader's own
 * session, so RLS and the storage policies both apply and the link expires.
 *
 * 10MB and a named list of types, set on the BUCKET rather than in the form:
 * an accept attribute is a hint to a file picker, and the storage endpoint is
 * reachable without one.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'booking-attachments',
  'booking-attachments',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/*
 * THE FIRST PATH SEGMENT IS THE PROPERTY, and every policy turns on it --
 * the same rule the room photographs follow. `<property_id>/<booking_id>/<file>`,
 * so a name invented in the browser cannot reach another hotel's documents.
 */
drop policy if exists "booking attachments are read on the property" on storage.objects;
create policy "booking attachments are read on the property"
  on storage.objects for select
  using (
    bucket_id = 'booking-attachments'
    and (storage.foldername(name))[1] = public.current_property_id()::text
  );

drop policy if exists "booking attachments are written by front office" on storage.objects;
create policy "booking attachments are written by front office"
  on storage.objects for insert
  with check (
    bucket_id = 'booking-attachments'
    and (storage.foldername(name))[1] = public.current_property_id()::text
    and public.is_front_office_staff()
  );

drop policy if exists "booking attachments are removed by front office" on storage.objects;
create policy "booking attachments are removed by front office"
  on storage.objects for delete
  using (
    bucket_id = 'booking-attachments'
    and (storage.foldername(name))[1] = public.current_property_id()::text
    and public.is_front_office_staff()
  );

/* -------------------------------------------------------------------------- */

create or replace function public.booking_attachments_list(p_booking_id uuid)
returns table(
  id uuid,
  storage_path text,
  file_name text,
  content_type text,
  size_bytes bigint,
  uploaded_by_name text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select
    a.id,
    a.storage_path,
    a.file_name,
    a.content_type,
    a.size_bytes,
    s.full_name as uploaded_by_name,
    a.created_at
  from public.booking_attachments a
  left join public.staff_users s on s.id = a.uploaded_by
  where a.booking_id = p_booking_id
  order by a.created_at desc;
$function$;

comment on function public.booking_attachments_list(uuid) is
  'Files attached to one booking, newest first. security invoker, so RLS decides what the caller sees.';

/*
 * RECORDING THE UPLOAD IS SEPARATE FROM THE UPLOAD, because the file goes
 * straight from the browser to storage under the user's own session --
 * nothing here holds a service key. This writes the row once the object is
 * there, and re-checks the property prefix that the storage policy already
 * checked. Two checks on the same rule, for the same reason `set_room_photo()`
 * has them: the path is a string the browser chose.
 */
create or replace function public.add_booking_attachment(
  p_booking_id uuid,
  p_storage_path text,
  p_file_name text,
  p_content_type text,
  p_size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_property uuid;
  v_id uuid;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, management or an administrator may attach a file';
  end if;

  v_property := public.current_property_id();

  if not exists (
    select 1 from public.bookings
    where id = p_booking_id and property_id = v_property
  ) then
    raise exception 'That booking is not on this property';
  end if;

  if p_storage_path is null
     or p_storage_path not like v_property::text || '/' || p_booking_id::text || '/%'
  then
    raise exception 'That file was not uploaded against this booking';
  end if;

  if coalesce(p_size_bytes, 0) <= 0 then
    raise exception 'That file is empty';
  end if;

  insert into public.booking_attachments (
    property_id, booking_id, storage_path, file_name, content_type,
    size_bytes, uploaded_by
  )
  values (
    v_property, p_booking_id, p_storage_path,
    coalesce(nullif(btrim(p_file_name), ''), 'Attachment'),
    coalesce(nullif(btrim(p_content_type), ''), 'application/octet-stream'),
    p_size_bytes, auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$function$;

comment on function public.add_booking_attachment(uuid, text, text, text, bigint) is
  'Records a file already uploaded to the booking-attachments bucket. Re-checks the <property>/<booking>/ prefix the storage policy checked, because the path is a string the browser chose.';

create or replace function public.delete_booking_attachment(p_attachment_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_path text;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, management or an administrator may remove a file';
  end if;

  delete from public.booking_attachments
  where id = p_attachment_id
    and property_id = public.current_property_id()
  returning storage_path into v_path;

  if v_path is null then
    raise exception 'That file is not on this property';
  end if;

  /*
   * The row goes here and the OBJECT goes from the browser, under the same
   * session, because nothing on this server holds a service key. Returning
   * the path is how the caller knows what to remove.
   */
  return v_path;
end;
$function$;

comment on function public.delete_booking_attachment(uuid) is
  'Removes the row and returns the storage path, which the caller deletes from the bucket under its own session.';


/* ========================================================================== */
/* PART 2 -- Email                                                            */
/* ========================================================================== */

/*
 * A RECORD OF CORRESPONDENCE. See the header: this does not send, because
 * sending needs a provider and a key no environment here holds, and a Send
 * button that cannot send is a dead control.
 *
 * `sent_at` and `status` are here from the start so that wiring a provider
 * later is an action and a key rather than a migration. A row written by a
 * person recording what they sent is `logged`; a row written by a provider
 * would be `sent` or `failed`.
 */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'booking_email_status') then
    create type public.booking_email_status as enum ('logged', 'sent', 'failed');
  end if;
end
$$;

create table if not exists public.booking_emails (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  to_address text not null check (btrim(to_address) <> ''),
  subject text not null check (btrim(subject) <> ''),
  body text not null default '',
  status public.booking_email_status not null default 'logged',
  /*
   * When it actually went. `now()` for something recorded after the fact is
   * near enough and is what the person means; a provider would set its own.
   * `timestamptz` and not `business_date`: this is wall-clock correspondence,
   * not an operating day, and the dates rule keeps the two apart.
   */
  sent_at timestamptz not null default now(),
  sent_by uuid references public.staff_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists booking_emails_booking_idx
  on public.booking_emails (property_id, booking_id, sent_at desc);

alter table public.booking_emails enable row level security;

drop policy if exists booking_emails_select on public.booking_emails;
create policy booking_emails_select on public.booking_emails
  for select using (property_id = public.current_property_id());

drop policy if exists booking_emails_insert on public.booking_emails;
create policy booking_emails_insert on public.booking_emails
  for insert with check (
    property_id = public.current_property_id()
    and public.is_front_office_staff()
  );

/*
 * NO UPDATE AND NO DELETE POLICY, which is the opposite of an attachment and
 * the same as a folio row. This is a record of what was said to a guest. A
 * correspondence log somebody can quietly edit is not evidence of anything,
 * and "we told them on the 4th" is exactly the sort of claim it exists to
 * settle.
 */

create or replace function public.booking_emails_list(p_booking_id uuid)
returns table(
  id uuid,
  to_address text,
  subject text,
  body text,
  status public.booking_email_status,
  sent_at timestamptz,
  sent_by_name text
)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select
    e.id,
    e.to_address,
    e.subject,
    e.body,
    e.status,
    e.sent_at,
    s.full_name as sent_by_name
  from public.booking_emails e
  left join public.staff_users s on s.id = e.sent_by
  where e.booking_id = p_booking_id
  order by e.sent_at desc;
$function$;

comment on function public.booking_emails_list(uuid) is
  'Correspondence recorded against one booking, newest first. security invoker, so RLS decides what the caller sees.';

create or replace function public.log_booking_email(
  p_booking_id uuid,
  p_to_address text,
  p_subject text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_property uuid;
  v_id uuid;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, management or an administrator may record correspondence';
  end if;

  v_property := public.current_property_id();

  if not exists (
    select 1 from public.bookings
    where id = p_booking_id and property_id = v_property
  ) then
    raise exception 'That booking is not on this property';
  end if;

  if coalesce(btrim(p_to_address), '') = '' then
    raise exception 'Give the address it went to';
  end if;

  if coalesce(btrim(p_subject), '') = '' then
    raise exception 'Give a subject';
  end if;

  insert into public.booking_emails (
    property_id, booking_id, to_address, subject, body, sent_by
  )
  values (
    v_property, p_booking_id, btrim(p_to_address), btrim(p_subject),
    coalesce(p_body, ''), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$function$;

comment on function public.log_booking_email(uuid, text, text, text) is
  'Records an email sent to a guest about a booking. Does NOT send: there is no mail provider in this deployment, and the row is the correspondence log the reference PMS shows on its Email tab.';

/* ========================================================================== */
/* GRANTS                                                                     */
/* ========================================================================== */

/*
 * `revoke all ... from public` does NOT take the grant off `anon`. The hosted
 * project carries a default privilege handing execute to anon on every new
 * function, so each one needs anon named explicitly. See 0047.
 */
revoke all on function public.booking_attachments_list(uuid) from public, anon;
revoke all on function public.add_booking_attachment(uuid, text, text, text, bigint) from public, anon;
revoke all on function public.delete_booking_attachment(uuid) from public, anon;
revoke all on function public.booking_emails_list(uuid) from public, anon;
revoke all on function public.log_booking_email(uuid, text, text, text) from public, anon;

grant execute on function public.booking_attachments_list(uuid) to authenticated;
grant execute on function public.add_booking_attachment(uuid, text, text, text, bigint) to authenticated;
grant execute on function public.delete_booking_attachment(uuid) to authenticated;
grant execute on function public.booking_emails_list(uuid) to authenticated;
grant execute on function public.log_booking_email(uuid, text, text, text) to authenticated;

grant select, insert, delete on public.booking_attachments to authenticated;
grant select, insert on public.booking_emails to authenticated;
