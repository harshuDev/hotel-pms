-- Hardening pass over the function surface that Supabase's database linter
-- flags as externally reachable.
--
-- Supabase grants EXECUTE on new functions to anon and authenticated by
-- default. Migrations 0003 and 0004 revoked from `public`, which does not
-- remove those explicit role grants, so every SECURITY DEFINER function stayed
-- callable over /rest/v1/rpc — by signed-out callers included. The business
-- RPCs each guard themselves with require_financial_staff() or a role check,
-- so this was not exploitable, but an unauthenticated caller should not reach
-- them at all.
--
-- Two rules:
--   * Trigger functions are never a public API. The trigger machinery does not
--     check EXECUTE on the calling user, so no role needs it.
--   * Business RPCs stay callable by authenticated staff and by nobody else.
--
-- current_property_id() and current_role() are deliberately left alone: RLS
-- policies evaluate them as the querying role, and both return null for a
-- signed-out caller, so they leak nothing.

-- Trigger functions: no caller ever invokes these directly.
revoke all on function
  public.audit_room_status_change(),
  public.validate_booking_room(),
  public.sync_booking_room_nights(),
  public.sync_booking_room_status(),
  public.log_booking_activity(),
  public.validate_financial_record(),
  public.log_financial_activity(),
  public.create_primary_folio_for_booking(),
  public.validate_cash_payment_shift()
from public, anon, authenticated;

-- Internal helpers. The SECURITY DEFINER functions that call these run as the
-- owner, so revoking the caller's grant does not affect them.
revoke all on function
  public.require_financial_staff(),
  public.open_business_date(uuid)
from public, anon, authenticated;

-- Business RPCs: signed-in staff only.
revoke all on function
  public.create_folio(uuid, public.folio_kind, boolean),
  public.close_folio(uuid, boolean),
  public.post_charge(uuid, public.folio_item_type, text, bigint, integer, bigint, uuid, date),
  public.post_room_charge(uuid, uuid, date),
  public.reverse_charge(uuid, text),
  public.post_discount(uuid, bigint, text),
  public.record_payment(uuid, uuid, bigint, text, text, uuid, date),
  public.reverse_payment(uuid, text),
  public.open_cashier_shift(bigint, text),
  public.record_cash_movement(uuid, public.cash_movement_type, bigint, text, text, public.cash_movement_direction),
  public.close_cashier_shift(uuid, bigint, text)
from public, anon;

grant execute on function
  public.create_folio(uuid, public.folio_kind, boolean),
  public.close_folio(uuid, boolean),
  public.post_charge(uuid, public.folio_item_type, text, bigint, integer, bigint, uuid, date),
  public.post_room_charge(uuid, uuid, date),
  public.reverse_charge(uuid, text),
  public.post_discount(uuid, bigint, text),
  public.record_payment(uuid, uuid, bigint, text, text, uuid, date),
  public.reverse_payment(uuid, text),
  public.open_cashier_shift(bigint, text),
  public.record_cash_movement(uuid, public.cash_movement_type, bigint, text, text, public.cash_movement_direction),
  public.close_cashier_shift(uuid, bigint, text)
to authenticated;

-- Read models added in 0005 and 0006 are SECURITY INVOKER, so RLS already
-- governs them. Signed-out callers still have no business reaching them.
revoke all on function
  public.house_summary(),
  public.rooms_page(text, text, integer, integer),
  public.bookings_page(text, public.booking_status, integer, integer),
  public.dashboard_arrivals(date),
  public.dashboard_departures(date)
from public, anon;

-- Pin the search_path on the one function this project added without it.
-- The body resolves no unqualified names, but the linter is right that a
-- function should not inherit a caller-controlled search_path.
create or replace function public.customer_display_name(p_customer public.customers)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_customer.kind = 'company' then p_customer.company_name
    else nullif(trim(concat_ws(' ', p_customer.first_name, p_customer.last_name)), '')
  end;
$$;
