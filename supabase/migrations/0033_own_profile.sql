-- Changing your own name.
--
-- save_staff_user() is administrator-only, and the sole UPDATE policy on
-- staff_users is administrator-only too, so until now a receptionist whose name
-- was typed wrong when their account was made had to ask an administrator to
-- fix it. That is the right gate for role and is_active, and the wrong one for
-- somebody's own name.
--
-- Widening the policy is not the fix. RLS cannot say "the same row, but the
-- role column must not change" — a policy sees the new row, not the old one —
-- so `for update using (id = auth.uid())` would let anybody set their own role
-- to admin. The gate therefore stays where every other privileged operation in
-- this schema keeps it: inside a function that names exactly what it will
-- write.
--
-- This one writes full_name, on the row belonging to auth.uid(), on the
-- caller's own property, and nothing else. role and is_active are not
-- parameters, so no call of it can move them.

create function public.save_own_profile(p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_id uuid;
begin
  if btrim(coalesce(p_full_name, '')) = '' then
    raise exception 'Your name cannot be blank';
  end if;

  update public.staff_users set
    full_name = btrim(p_full_name)
  where id = auth.uid()
    and property_id = public.current_property_id()
    and is_active
  returning id into v_id;

  if v_id is null then
    raise exception 'No active staff account for the current user';
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_own_profile(text) from public, anon;
grant execute on function public.save_own_profile(text) to authenticated;
