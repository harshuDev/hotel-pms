-- Settings -> System Settings -> Language Settings, cloned from the client's
-- reference: a Default language and the Supported languages, each its own
-- card with its own Save.
--
-- WIRED to the guest booking page, which is the part of this system that
-- speaks more than one language: the default is what a guest sees when the
-- link carries no `?lang=`, and the supported set is what its language picker
-- offers. The staff application stays English -- see CLAUDE.md on why.
--
-- The codes are the nineteen `LOCALES` in `src/lib/i18n/locales.ts`, listed
-- again here because Postgres cannot read a TypeScript file. Adding a
-- language is a dictionary, a line there and a name in both lists below.
--
-- One row per property. No row reads as English by default and all nineteen
-- supported, which is what the page did before this setting existed.

create table public.language_settings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  default_locale text not null default 'en',
  supported_locales text[] not null default array[
    'en','de','fr','es','it','pt','nl','pl','sv','da','no','fi','cs','el','ro','hu','uk','ru','tr'
  ],
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_users(id) on delete set null,
  constraint language_settings_known check (
    default_locale = any (array[
      'en','de','fr','es','it','pt','nl','pl','sv','da','no','fi','cs','el','ro','hu','uk','ru','tr'
    ])
    and supported_locales <@ array[
      'en','de','fr','es','it','pt','nl','pl','sv','da','no','fi','cs','el','ro','hu','uk','ru','tr'
    ]
  ),
  -- The page falls back to the default, so it has to be one the page offers.
  constraint language_settings_default_supported check (
    default_locale = any (supported_locales)
  )
);

alter table public.language_settings enable row level security;

create policy language_settings_select_current_property on public.language_settings
  for select using (property_id = public.current_property_id());
create policy language_settings_insert_revenue_staff on public.language_settings
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy language_settings_update_revenue_staff on public.language_settings
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

grant select, insert, update on public.language_settings to authenticated;
revoke all on public.language_settings from anon;

create or replace function public.known_locales()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'en','de','fr','es','it','pt','nl','pl','sv','da','no','fi','cs','el','ro','hu','uk','ru','tr'
  ];
$$;

revoke execute on function public.known_locales() from public, anon;
grant execute on function public.known_locales() to authenticated;

/* Each card saves only what it shows -- two forms, two functions, like
   save_property_details() and save_property_times(). */

create or replace function public.save_default_language(p_locale text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_locale text := lower(btrim(coalesce(p_locale, '')));
  v_supported text[];
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the language settings';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  if not (v_locale = any (public.known_locales())) then
    raise exception 'Pick the default language from the list';
  end if;

  select supported_locales into v_supported
  from public.language_settings where property_id = v_property;
  v_supported := coalesce(v_supported, public.known_locales());
  if not (v_locale = any (v_supported)) then
    raise exception 'The default language has to be one of the supported languages. Add it there first.';
  end if;

  insert into public.language_settings as l (property_id, default_locale, updated_at, updated_by)
  values (v_property, v_locale, now(), auth.uid())
  on conflict (property_id) do update set
    default_locale = excluded.default_locale,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;
end;
$$;

create or replace function public.save_supported_languages(p_locales text[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_locales text[];
  v_default text;
  v_bad text;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the language settings';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  -- Kept in the order of the list, not the order they were ticked, so the
  -- guest page's picker always reads the same way.
  select array_agg(k order by i) into v_locales
  from unnest(public.known_locales()) with ordinality as t(k, i)
  where k = any (select lower(btrim(x)) from unnest(coalesce(p_locales, '{}')) x);

  select x into v_bad
  from unnest(coalesce(p_locales, '{}')) x
  where not (lower(btrim(x)) = any (public.known_locales()))
  limit 1;
  if v_bad is not null then
    raise exception 'Unknown language %', v_bad;
  end if;
  if v_locales is null or cardinality(v_locales) = 0 then
    raise exception 'Keep at least one language';
  end if;

  select default_locale into v_default
  from public.language_settings where property_id = v_property;
  v_default := coalesce(v_default, 'en');
  if not (v_default = any (v_locales)) then
    raise exception 'The default language has to stay supported. Change the default first.';
  end if;

  insert into public.language_settings as l (property_id, supported_locales, updated_at, updated_by)
  values (v_property, v_locales, now(), auth.uid())
  on conflict (property_id) do update set
    supported_locales = excluded.supported_locales,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;
end;
$$;

revoke execute on function public.save_default_language(text) from public, anon;
grant execute on function public.save_default_language(text) to authenticated;
revoke execute on function public.save_supported_languages(text[]) from public, anon;
grant execute on function public.save_supported_languages(text[]) to authenticated;

/*
 * THE GUEST PAGE'S READ. Security definer and granted to anon, like the other
 * public_* reads: a guest has no staff row, so RLS would show them nothing.
 * It returns two values about one active property and nothing else.
 */
create or replace function public.public_language_settings(p_property_id uuid)
returns table (default_locale text, supported_locales text[])
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(l.default_locale, 'en'),
    coalesce(l.supported_locales, public.known_locales())
  from public.properties p
  left join public.language_settings l on l.property_id = p.id
  where p.id = p_property_id and p.is_active;
$$;

revoke execute on function public.public_language_settings(uuid) from public;
grant execute on function public.public_language_settings(uuid) to anon, authenticated;
