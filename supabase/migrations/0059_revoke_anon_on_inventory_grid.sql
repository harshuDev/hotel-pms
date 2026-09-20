-- 0059: take `anon` off the three staff functions that still hold EXECUTE.
--
-- Found by running the standing check from CLAUDE.md, which should return only
-- the public booking surface and the two policy helpers:
--
--   select proname from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and has_function_privilege('anon', p.oid, 'execute');
--
-- On the hosted project it already does. On a database built from these
-- migrations alone it does not: three more come back.
--
--   inventory_grid          an explicit `anon=X` grant, and NO migration has
--                           ever revoked it. It was created in 0025, and the
--                           hosted project's `alter default privileges ...
--                           grant execute on functions to anon` is exactly the
--                           drift 0047 was written to clean up -- 0047 simply
--                           did not list this one.
--   customer_display_name   revoked by 0047, but the Postgres default of
--   get_folio_balance       EXECUTE to PUBLIC comes back whenever a function
--                           is dropped and recreated rather than replaced.
--                           Re-asserting both costs nothing and makes the end
--                           state the same however the database was built.
--
-- NOTHING LEAKED. All three are `security invoker`, so RLS was still deciding
-- what the caller could see, and it was doing its job: as `anon`,
-- `current_property_id()` is null, `inventory_grid()` returns zero rows and
-- `get_folio_balance()` cannot read `folios` at all. Both were confirmed
-- against a live database rather than assumed. This is the grant being wrong,
-- not the data being reachable -- which is worth fixing while it is still only
-- that, because the grant is what turns a future `security definer` or a
-- relaxed policy into a real hole.
--
-- `authenticated` keeps its own explicit grant, which is what the callers use:
-- the Inventory screens read `inventory_grid()` as the signed-in staff user,
-- and the other two are called from inside other `security invoker` functions.

revoke execute on function public.inventory_grid(uuid, date, integer) from anon;
revoke execute on function public.inventory_grid(uuid, date, integer) from public;
revoke execute on function public.customer_display_name(public.customers) from anon;
revoke execute on function public.customer_display_name(public.customers) from public;
revoke execute on function public.get_folio_balance(uuid) from anon;
revoke execute on function public.get_folio_balance(uuid) from public;

grant execute on function public.inventory_grid(uuid, date, integer) to authenticated;
grant execute on function public.customer_display_name(public.customers) to authenticated;
grant execute on function public.get_folio_balance(uuid) to authenticated;
