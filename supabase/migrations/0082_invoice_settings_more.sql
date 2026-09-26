-- Invoice Settings, the rest of the reference's page (0080 was the first two
-- cards): Default Notes at 255 characters, Rounding Options, Invoice Number
-- Settings and Statement Settings. Same row, `invoice_settings`; each card
-- saves only its own columns through its own function.
--
-- WHAT THESE DO TODAY:
--   * Default Notes print at the foot of the invoice (as 0080's notes did;
--     the reference caps them at 255, and so does this now).
--   * Invoice numbers: "By default we use simple increment number" is what
--     the invoice now prints -- the booking's primary folio number, from
--     `folio_number_seq`. The custom scheme behind the checkbox is STORED
--     ONLY: its fields have not been seen, so the switch is kept and the
--     invoice goes on printing the simple number.
--   * Rounding Options: STORED ONLY. "Used across whole system" means every
--     price, tax and total; all money here is integer cents computed in
--     Postgres, and changing how it rounds is a change to every money
--     function, not a setting. `none` and two decimals -- the reference's
--     shown values -- are also exactly what the system does today.
--   * Statement Settings: STORED ONLY. There is no account statement in this
--     system yet; the reminder and terms are kept for when there is.

-- The reference's notes field counts to 255. Nothing longer can exist yet:
-- 0080 shipped minutes before this and the only rows are test rows.
alter table public.invoice_settings drop constraint if exists invoice_settings_notes_check;
alter table public.invoice_settings
  add constraint invoice_settings_notes_check check (notes is null or char_length(notes) <= 255);

alter table public.invoice_settings
  add column round_logic text not null default 'none'
    check (round_logic in ('none', 'nearest', 'up', 'down')),
  add column round_to text not null default 'two_decimals'
    check (round_to in ('two_decimals', 'one_decimal', 'whole')),
  add column custom_invoice_numbers boolean not null default false,
  add column statement_reminder_text text
    check (statement_reminder_text is null or char_length(statement_reminder_text) <= 2000),
  add column statement_terms_text text
    check (statement_terms_text is null or char_length(statement_terms_text) <= 2000);

create or replace function public.save_invoice_logo_and_notes(
  p_use_text_instead_of_logo boolean,
  p_logo_text text,
  p_notes text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.invoice_settings_row();
  v_text text := nullif(btrim(coalesce(p_logo_text, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if coalesce(p_use_text_instead_of_logo, false) and v_text is null then
    raise exception 'Write the text to print instead of the logo';
  end if;
  if v_text is not null and char_length(v_text) > 255 then
    raise exception 'The logo text can be at most 255 characters';
  end if;
  if v_notes is not null and char_length(v_notes) > 255 then
    raise exception 'The default notes can be at most 255 characters';
  end if;

  update public.invoice_settings set
    use_text_instead_of_logo = coalesce(p_use_text_instead_of_logo, false),
    logo_text = v_text,
    notes = v_notes,
    updated_at = now(),
    updated_by = auth.uid()
  where property_id = v_property;
end;
$$;

create or replace function public.save_rounding_options(p_round_logic text, p_round_to text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.invoice_settings_row();
begin
  if coalesce(p_round_logic, '') not in ('none', 'nearest', 'up', 'down') then
    raise exception 'Pick the round logic from the list';
  end if;
  if coalesce(p_round_to, '') not in ('two_decimals', 'one_decimal', 'whole') then
    raise exception 'Pick what to round to from the list';
  end if;
  update public.invoice_settings set
    round_logic = p_round_logic,
    round_to = p_round_to,
    updated_at = now(),
    updated_by = auth.uid()
  where property_id = v_property;
end;
$$;

revoke execute on function public.save_rounding_options(text, text) from public, anon;
grant execute on function public.save_rounding_options(text, text) to authenticated;

create or replace function public.save_invoice_number_settings(p_custom_invoice_numbers boolean)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.invoice_settings_row();
begin
  update public.invoice_settings set
    custom_invoice_numbers = coalesce(p_custom_invoice_numbers, false),
    updated_at = now(),
    updated_by = auth.uid()
  where property_id = v_property;
end;
$$;

revoke execute on function public.save_invoice_number_settings(boolean) from public, anon;
grant execute on function public.save_invoice_number_settings(boolean) to authenticated;

create or replace function public.save_statement_settings(p_reminder_text text, p_terms_text text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.invoice_settings_row();
  v_reminder text := nullif(btrim(coalesce(p_reminder_text, '')), '');
  v_terms text := nullif(btrim(coalesce(p_terms_text, '')), '');
begin
  if v_reminder is not null and char_length(v_reminder) > 2000 then
    raise exception 'The reminder text can be at most 2000 characters';
  end if;
  if v_terms is not null and char_length(v_terms) > 2000 then
    raise exception 'The terms text can be at most 2000 characters';
  end if;
  update public.invoice_settings set
    statement_reminder_text = v_reminder,
    statement_terms_text = v_terms,
    updated_at = now(),
    updated_by = auth.uid()
  where property_id = v_property;
end;
$$;

revoke execute on function public.save_statement_settings(text, text) from public, anon;
grant execute on function public.save_statement_settings(text, text) to authenticated;
