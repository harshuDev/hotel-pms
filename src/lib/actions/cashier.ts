"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { PaidOutCategory } from "@/lib/types";

/**
 * Cashier writes. Every one of these goes through a Layer 4 RPC rather than
 * touching a table, so the drawer rules, the append-only ledger and the
 * business-date checks stay in Postgres where they are enforced for everyone.
 */

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Postgres raises these as plain exceptions; the message is the useful part. */
function failed(prefix: string, message: string): ActionResult<never> {
  return { ok: false, error: `${prefix}: ${message}` };
}

export async function openShift(
  openingFloatCents: number,
): Promise<ActionResult> {
  if (!Number.isSafeInteger(openingFloatCents) || openingFloatCents < 0) {
    return { ok: false, error: "The opening float must be zero or more." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("open_cashier_shift", {
    p_opening_balance_cents: openingFloatCents,
    p_opening_notes: null,
  });

  if (error) return failed("The shift did not open", error.message);

  revalidatePath("/cashier");
  return { ok: true, data: null };
}

export async function takePayment(input: {
  bookingId: string;
  paymentMethodId: string;
  amountCents: number;
  businessDate: string;
  shiftId: string;
}): Promise<ActionResult> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, error: "The amount must be more than zero." };
  }

  const supabase = await createClient();

  // Cash must carry the shift; anything else must not — validate_cash_payment_shift()
  // rejects the wrong combination, so the method decides what we send.
  const { data: method, error: methodError } = await supabase
    .from("payment_methods")
    .select("affects_drawer")
    .eq("id", input.paymentMethodId)
    .single();

  if (methodError) {
    return failed("That payment method could not be read", methodError.message);
  }

  const { data: folio, error: folioError } = await supabase
    .from("folios")
    .select("id")
    .eq("booking_id", input.bookingId)
    .eq("status", "open")
    .order("is_primary", { ascending: false })
    .order("folio_number")
    .limit(1)
    .maybeSingle();

  if (folioError) {
    return failed("The folio could not be read", folioError.message);
  }
  if (!folio) {
    return {
      ok: false,
      error:
        "That booking has no open folio, so there is nothing to pay against.",
    };
  }

  const { error } = await supabase.rpc("record_payment", {
    p_folio_id: folio.id,
    p_payment_method_id: input.paymentMethodId,
    p_amount_cents: input.amountCents,
    p_external_reference: null,
    p_authorization_reference: null,
    p_shift_id: method.affects_drawer ? input.shiftId : null,
    p_business_date: input.businessDate,
  });

  if (error) return failed("The payment was not recorded", error.message);

  revalidatePath("/cashier");
  revalidatePath("/dashboard");
  return { ok: true, data: null };
}

export async function recordPaidOut(input: {
  shiftId: string;
  amountCents: number;
  category: PaidOutCategory;
  reason: string;
  payee: string | null;
  rechargeBookingId: string | null;
}): Promise<ActionResult> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, error: "The amount must be more than zero." };
  }
  if (!input.reason.trim()) {
    return { ok: false, error: "Say what the money was for." };
  }

  const supabase = await createClient();

  // The RPC posts the guest charge and the drawer movement together, so a
  // recharge that cannot be charged takes no cash out of the drawer either.
  const { error } = await supabase.rpc("record_paid_out", {
    p_shift_id: input.shiftId,
    p_amount_cents: input.amountCents,
    p_category: input.category,
    p_reason: input.reason.trim(),
    p_payee: input.payee?.trim() || null,
    p_recharge_booking_id: input.rechargeBookingId,
  });

  if (error) return failed("The paid-out was not recorded", error.message);

  revalidatePath("/cashier");
  revalidatePath("/dashboard");
  return { ok: true, data: null };
}

/**
 * Closes the shift and returns what it should have held.
 *
 * This is the blind count: the expected figure is computed and revealed by
 * the same call that commits the count, so it cannot be read beforehand.
 */
export async function closeShift(input: {
  shiftId: string;
  countedCents: number;
  notes: string | null;
}): Promise<ActionResult<{ expectedCents: number; varianceCents: number }>> {
  if (!Number.isSafeInteger(input.countedCents) || input.countedCents < 0) {
    return { ok: false, error: "The counted total must be zero or more." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("close_cashier_shift", {
    p_shift_id: input.shiftId,
    p_counted_cash_cents: input.countedCents,
    p_closing_notes: input.notes?.trim() || null,
  });

  if (error) return failed("The shift did not close", error.message);

  const row = (
    (data ?? []) as {
      expected_cash_cents: number;
      variance_cents: number;
    }[]
  )[0];

  if (!row) {
    return {
      ok: false,
      error: "The shift closed but returned no figures. Check it in reports.",
    };
  }

  revalidatePath("/cashier");
  revalidatePath("/dashboard");
  return {
    ok: true,
    data: {
      expectedCents: row.expected_cash_cents,
      varianceCents: row.variance_cents,
    },
  };
}
