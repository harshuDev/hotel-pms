-- 0131: the booking's Email tab SENDS, as the reference's does.
--
-- The client sent their reference's Email tab -- "Send email to clients",
-- Send to, a Basic / Advanced template builder, Email subject, Choose
-- template, a rich-text editor with DROP IN'S, Attach Invoice, Attach
-- Confirmation and SEND EMAIL -- and asked for it built as it is.
--
-- Until now the tab only RECORDED what somebody had sent elsewhere
-- (log_booking_email(), status 'logged'). booking_emails was built for this
-- day: sent_at and the 'sent' / 'failed' statuses have been there since 0063.
--
-- 1. booking_emails gains body_html (the message as sent, sanitised on the
--    server), attachments (their file names) and error (what the mail server
--    said when it refused). body stays the plain-text version.
-- 2. record_booking_email(): the row for a message the server just tried to
--    send. Status 'sent' or 'failed' only -- 'logged' stays
--    log_booking_email()'s. A failure is kept: "we tried on the 4th and it
--    bounced" is correspondence too.
--
-- Still no update and no delete: a correspondence log somebody can edit is
-- not evidence of anything.

alter table public.booking_emails
  add column if not exists body_html text,
  add column if not exists attachments text[] not null default '{}',
  add column if not exists error text;

alter table public.booking_emails
  add constraint booking_emails_body_html_length check (body_html is null or char_length(body_html) <= 500000),
  add constraint booking_emails_error_length check (error is null or char_length(error) <= 2000);

create or replace function public.record_booking_email(
  p_booking_id uuid,
  p_to_address text,
  p_subject text,
  p_body text,
  p_body_html text,
  p_status text,
  p_error text,
  p_attachments text[]
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_id uuid;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, management or an administrator may send email';
  end if;
  v_property := public.current_property_id();
  if not exists (select 1 from public.bookings where id = p_booking_id and property_id = v_property) then
    raise exception 'That booking is not on this property';
  end if;
  if p_status not in ('sent', 'failed') then
    raise exception 'An email is recorded as sent or failed';
  end if;
  if coalesce(btrim(p_to_address), '') = '' then
    raise exception 'Give the address it went to';
  end if;
  if coalesce(btrim(p_subject), '') = '' then
    raise exception 'Give a subject';
  end if;

  insert into public.booking_emails (
    property_id, booking_id, to_address, subject, body, body_html, status, error, attachments, sent_by
  ) values (
    v_property, p_booking_id, btrim(p_to_address), btrim(p_subject), coalesce(p_body, ''),
    p_body_html, p_status::public.booking_email_status, nullif(btrim(p_error), ''),
    coalesce(p_attachments, '{}'), auth.uid()
  )
  returning id into v_id;

  insert into public.activity_log (property_id, actor_id, entity_type, entity_id, action, summary, metadata)
  values (v_property, auth.uid(), 'booking', p_booking_id,
          case when p_status = 'sent' then 'email_sent' else 'email_failed' end,
          case when p_status = 'sent'
               then format('Email "%s" sent to %s', btrim(p_subject), btrim(p_to_address))
               else format('Email "%s" to %s could not be sent', btrim(p_subject), btrim(p_to_address)) end,
          jsonb_build_object('email_id', v_id));
  return v_id;
end;
$$;

revoke all on function public.record_booking_email(uuid, text, text, text, text, text, text, text[]) from public;
revoke execute on function public.record_booking_email(uuid, text, text, text, text, text, text, text[]) from anon;
grant execute on function public.record_booking_email(uuid, text, text, text, text, text, text, text[]) to authenticated;
