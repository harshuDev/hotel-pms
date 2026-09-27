-- The staff application's language, per member of staff.
--
-- The client asked for their reference's language switch in the user menu:
-- twelve languages, a confirmation, and the page reloads in the chosen one.
-- It is a person's preference rather than the hotel's -- two receptionists on
-- one desk may read different languages -- so it lives on `staff_users`, and
-- follows the person to any machine they sign in on.
--
-- The codes are the reference's, "sl-SI" included; `src/lib/i18n/staff-locales.ts`
-- lists the same twelve and the two change together.
--
-- Written the way save_own_profile() (0033) writes a name: a security definer
-- function that names exactly what it touches -- this column, on the caller's
-- own active row -- because the UPDATE policy on staff_users is
-- administrator-only and must stay so.

alter table public.staff_users
  add column locale text not null default 'en'
    check (locale in ('en', 'de', 'el', 'es', 'fr', 'id', 'it', 'pt', 'ro', 'sl-SI', 'th', 'is'));

create function public.save_own_locale(p_locale text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_id uuid;
begin
  if coalesce(p_locale, '') not in ('en', 'de', 'el', 'es', 'fr', 'id', 'it', 'pt', 'ro', 'sl-SI', 'th', 'is') then
    raise exception 'Choose a language from the list';
  end if;

  update public.staff_users set locale = p_locale
  where id = auth.uid()
    and property_id = public.current_property_id()
    and is_active
  returning id into v_id;

  if v_id is null then
    raise exception 'No active staff account for the current user';
  end if;
end;
$$;

revoke all on function public.save_own_locale(text) from public, anon;
grant execute on function public.save_own_locale(text) to authenticated;
