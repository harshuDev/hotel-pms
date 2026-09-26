-- Settings -> Other -> Templates, cloned from the client's reference: the
-- "Folio/invoice template" -- a Liquid editor and a CSS editor side by side,
-- "Preview Folio Number", Is Active, PREVIEW, LOAD DEFAULTS and SAVE
-- TEMPLATE.
--
-- LIVE: with Is Active ticked, the printable invoice (/bookings/[id]/invoice)
-- is the hotel's template filled in with that booking's invoice, instead of
-- the built-in layout. The figures are the same ones the built-in layout
-- prints -- read off the folio, never recomputed -- and the template only
-- arranges them.
--
-- THE TEMPLATE IS HTML WRITTEN IN A BROWSER, which this codebase has refused
-- to print back out everywhere else for want of a sanitiser. It has one now,
-- and that is what makes this screen acceptable: the rendered output goes
-- through `sanitize-html` on the server (no script, no event handlers, no
-- javascript: URLs, no iframes, objects or forms) before any staff browser
-- sees it, and the CSS is kept from closing its own <style> element. Without
-- that, a manager could plant script that runs in an administrator's session.
-- See `src/lib/document-template.ts`.
--
-- One row per property per kind. Only `folio` exists: the reference's URL is
-- /settings/other/folio, which suggests other kinds, none of them seen.

create table public.document_templates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  kind text not null check (kind in ('folio')),
  liquid text not null default '' check (char_length(liquid) <= 200000),
  css text not null default '' check (char_length(css) <= 100000),
  is_active boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (property_id, kind),
  constraint document_templates_active_has_body check (not is_active or btrim(liquid) <> '')
);

alter table public.document_templates enable row level security;

create policy document_templates_select_current_property on public.document_templates
  for select using (property_id = public.current_property_id());
create policy document_templates_insert_revenue_staff on public.document_templates
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy document_templates_update_revenue_staff on public.document_templates
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

grant select, insert, update on public.document_templates to authenticated;
revoke all on public.document_templates from anon;

create or replace function public.save_document_template(
  p_kind text,
  p_liquid text,
  p_css text,
  p_is_active boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
begin
  if not coalesce(public.is_revenue_staff(), false) or v_property is null then
    raise exception 'Only managers and administrators can change templates';
  end if;
  if coalesce(p_kind, '') <> 'folio' then
    raise exception 'Choose a template from the list';
  end if;
  if char_length(coalesce(p_liquid, '')) > 200000 or char_length(coalesce(p_css, '')) > 100000 then
    raise exception 'The template is too long';
  end if;
  if coalesce(p_is_active, false) and btrim(coalesce(p_liquid, '')) = '' then
    raise exception 'Write the template, or load the defaults, before making it active';
  end if;

  insert into public.document_templates (property_id, kind, liquid, css, is_active, updated_at)
  values (v_property, p_kind, coalesce(p_liquid, ''), coalesce(p_css, ''), coalesce(p_is_active, false), now())
  on conflict (property_id, kind) do update set
    liquid = excluded.liquid,
    css = excluded.css,
    is_active = excluded.is_active,
    updated_at = now();
end;
$$;

revoke execute on function public.save_document_template(text, text, text, boolean) from public, anon;
grant execute on function public.save_document_template(text, text, text, boolean) to authenticated;
