-- 0138, part f: the three trigger functions came out executable by anon
-- through the default privileges. A trigger function cannot be called
-- directly, but the anon check in CLAUDE.md should list only the public
-- surface. EXECUTE is checked when a trigger is created, not when it fires.

revoke all on function public.currency_profiles_in_use_guard() from public;
revoke all on function public.rate_plans_currency_follows_parent() from public;
revoke all on function public.rate_plans_currency_push_to_children() from public;
revoke execute on function public.currency_profiles_in_use_guard() from anon, authenticated;
revoke execute on function public.rate_plans_currency_follows_parent() from anon, authenticated;
revoke execute on function public.rate_plans_currency_push_to_children() from anon, authenticated;
