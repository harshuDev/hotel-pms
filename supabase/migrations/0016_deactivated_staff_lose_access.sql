-- Deactivating a member of staff did nothing.
--
-- staff_users.is_active has existed since 0001 and was honoured nowhere.
-- current_property_id() and current_role() both read the row without looking
-- at it, so a deactivated user kept their property scope and their role —
-- every table through RLS, payments, check-in, the business date, the lot.
-- Unticking the box a hotel would reach for when somebody leaves had no
-- effect whatsoever.
--
-- Both functions are the root of every RLS policy in the schema, so this one
-- change withdraws access everywhere at once. A deactivated user now resolves
-- to no property and no role, which means no rows anywhere and a refusal from
-- every role-gated RPC.

create or replace function public.current_property_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select property_id from public.staff_users where id = auth.uid() and is_active;
$$;

create or replace function public.current_role()
returns public.staff_role
language sql
stable
security definer
set search_path = public, auth
as $$
  select role from public.staff_users where id = auth.uid() and is_active;
$$;

comment on function public.current_property_id() is
  'The active staff user''s property, or null. The root of every RLS policy here.';
comment on function public.current_role() is
  'The active staff user''s role, or null if they have none or are deactivated.';

-- While here: the role guards were not null-safe.
--
-- current_role() is null for a deactivated or non-staff caller, and
--   null not in ('admin', ...)   is null, not true
--   not <null>                   is null, not true
-- so `if not is_front_office_staff() then raise` never fired for exactly the
-- callers it was meant to stop. Nothing was actually reachable — every one of
-- those functions does a property-scoped lookup straight afterwards and
-- current_property_id() is null too, so they refused anyway. But they refused
-- by luck of a later query rather than by the guard, and the next function
-- written without that lookup would have been wide open.
--
-- These three are pure guards, so they get a real boolean. The guards in 0004
-- and 0011 are left as they are: they are AND-ed with a cashier check or
-- followed immediately by a property lookup, and a non-null role — the only
-- case that reaches them in practice — has always compared correctly.

create or replace function public.can_see_drawer_total()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(public.current_role() in ('admin', 'manager'), false);
$$;

create or replace function public.is_front_office_staff()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    public.current_role() in ('admin', 'manager', 'front_desk'),
    false
  );
$$;

create or replace function public.require_financial_staff()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- A null role now fails here rather than falling through: coalesce turns
  -- "no active staff row" into a plain false.
  if not coalesce(
       public.current_role() in ('admin', 'manager', 'front_desk', 'cashier'),
       false
     ) then
    raise exception 'Current staff user is not permitted to post financial transactions';
  end if;
end;
$$;
