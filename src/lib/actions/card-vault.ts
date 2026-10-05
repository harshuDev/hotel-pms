"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { localised } from "@/lib/i18n/localised";
import { getT } from "@/lib/i18n/server";
import type { ActionResult } from "@/lib/actions/cashier";
import { stripe, stripeConnected, stripeMessage } from "@/lib/stripe";

/*
 * Card Vault and Request payment (0130), through Stripe.
 *
 * Every card number stays inside Stripe's own frame in the browser; these
 * actions handle only Stripe's ids. Every write to this database goes through
 * a staff session and a Postgres function that checks the role and the
 * property -- the same rules as any other payment. What Stripe says happened
 * is read back from Stripe here, on the server, never taken from the browser.
 */

// Stripe counts these in whole units, not hundredths; our amounts are always
// hundredths, so a hotel in one of them would be charged a hundred times over.
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

function revalidateBooking(bookingId: string) {
  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath("/calendar");
  revalidatePath("/cashier");
}

async function notConnected<T>(): Promise<ActionResult<T>> {
  return { ok: false, error: await localised("Card payments need a Stripe account connected to this system.") };
}

/** The booking under the caller's own session, with what Stripe needs. */
async function loadBooking(bookingId: string) {
  const supabase = await createClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, property_id, reference, customer_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return null;
  const [{ data: property }, { data: customer }] = await Promise.all([
    supabase.from("properties").select("name, currency").eq("id", booking.property_id).single(),
    booking.customer_id
      ? supabase.from("customers").select("first_name, last_name, company_name, email").eq("id", booking.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const currency = (property?.currency ?? "").trim().toUpperCase();
  const name = customer
    ? [customer.first_name, customer.last_name].filter(Boolean).join(" ") || customer.company_name || null
    : null;
  return {
    supabase,
    booking,
    hotel: property?.name ?? "",
    currency,
    guestName: name,
    guestEmail: customer?.email ?? null,
  };
}

/* ---------------------------------------------------------------------------
 * Card Vault
 * ------------------------------------------------------------------------- */

/** Starts saving a card: a SetupIntent the browser confirms in Stripe's frame. */
export async function startCardSetup(
  bookingId: string,
): Promise<ActionResult<{ clientSecret: string; setupIntentId: string }>> {
  if (!stripeConnected()) return notConnected();
  const ctx = await loadBooking(bookingId);
  if (!ctx) return { ok: false, error: await localised("That booking does not belong to this property") };
  try {
    // One Stripe customer per guest: reuse the one an earlier card made.
    let customerId: string | null = null;
    if (ctx.booking.customer_id) {
      const { data } = await ctx.supabase
        .from("booking_cards")
        .select("gateway_customer_id")
        .eq("customer_id", ctx.booking.customer_id)
        .limit(1)
        .maybeSingle();
      customerId = data?.gateway_customer_id ?? null;
    }
    if (!customerId) {
      const created = await stripe().customers.create({
        name: ctx.guestName ?? undefined,
        email: ctx.guestEmail ?? undefined,
        metadata: { property_id: ctx.booking.property_id, customer_id: ctx.booking.customer_id ?? "" },
      });
      customerId = created.id;
    }
    const intent = await stripe().setupIntents.create({
      customer: customerId,
      usage: "off_session",
      metadata: { property_id: ctx.booking.property_id, booking_id: ctx.booking.id },
    });
    if (!intent.client_secret) throw new Error("Stripe returned no client secret");
    return { ok: true, data: { clientSecret: intent.client_secret, setupIntentId: intent.id } };
  } catch (e) {
    return { ok: false, error: await localised(stripeMessage(e)) };
  }
}

/** Records the card the browser just saved -- read back from Stripe, not trusted from the page. */
export async function saveCard(input: {
  bookingId: string;
  setupIntentId: string;
  holderName: string;
}): Promise<ActionResult<null>> {
  if (!stripeConnected()) return notConnected();
  const ctx = await loadBooking(input.bookingId);
  if (!ctx) return { ok: false, error: await localised("That booking does not belong to this property") };
  let intent: Stripe.SetupIntent;
  try {
    intent = await stripe().setupIntents.retrieve(input.setupIntentId, { expand: ["payment_method"] });
  } catch (e) {
    return { ok: false, error: await localised(stripeMessage(e)) };
  }
  if (
    intent.status !== "succeeded" ||
    intent.metadata?.booking_id !== ctx.booking.id ||
    intent.metadata?.property_id !== ctx.booking.property_id
  ) {
    return { ok: false, error: await localised("The card was not saved at the payment gateway") };
  }
  const pm = intent.payment_method as Stripe.PaymentMethod | null;
  const customer = typeof intent.customer === "string" ? intent.customer : intent.customer?.id;
  if (!pm || !customer) {
    return { ok: false, error: await localised("The card was not saved at the payment gateway") };
  }
  const { error } = await ctx.supabase.rpc("add_booking_card", {
    p_booking_id: ctx.booking.id,
    p_gateway_customer_id: customer,
    p_gateway_payment_method_id: pm.id,
    p_brand: pm.card?.brand ?? "",
    p_last4: pm.card?.last4 ?? "",
    p_exp_month: pm.card?.exp_month ?? 0,
    p_exp_year: pm.card?.exp_year ?? 0,
    p_holder_name: input.holderName.trim() || pm.billing_details?.name || "",
  });
  if (error) {
    // Postgres refused: take the card back off Stripe rather than leave one
    // saved there that nothing here points at.
    await stripe().paymentMethods.detach(pm.id).catch(() => undefined);
    return { ok: false, error: await localised(error.message) };
  }
  revalidateBooking(ctx.booking.id);
  return { ok: true, data: null };
}

export async function removeCard(input: { bookingId: string; cardId: string }): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("remove_booking_card", { p_card_id: input.cardId });
  if (error) return { ok: false, error: await localised(error.message) };
  if (stripeConnected() && data) {
    await stripe().paymentMethods.detach(String(data)).catch(() => undefined);
  }
  revalidateBooking(input.bookingId);
  return { ok: true, data: null };
}

/** Charges a saved card now and posts the payment on the folio. */
export async function chargeCard(input: {
  bookingId: string;
  cardId: string;
  folioId: string | null;
  amountCents: number;
  description: string;
  payerName: string;
  /** One per attempt from the page, so a retry never charges twice. */
  attemptId: string;
}): Promise<ActionResult<null>> {
  if (!stripeConnected()) return notConnected();
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, error: await localised("The amount must be more than zero.") };
  }
  const ctx = await loadBooking(input.bookingId);
  if (!ctx) return { ok: false, error: await localised("That booking does not belong to this property") };
  if (ZERO_DECIMAL.has(ctx.currency)) {
    return { ok: false, error: await localised("Card payments are not available in this currency") };
  }
  const { data: card } = await ctx.supabase
    .from("booking_cards")
    .select("id, booking_id, gateway_customer_id, gateway_payment_method_id")
    .eq("id", input.cardId)
    .maybeSingle();
  if (!card || card.booking_id !== ctx.booking.id) {
    return { ok: false, error: await localised("That card is not on this booking") };
  }

  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe().paymentIntents.create(
      {
        amount: input.amountCents,
        currency: ctx.currency.toLowerCase(),
        customer: card.gateway_customer_id,
        payment_method: card.gateway_payment_method_id,
        off_session: true,
        confirm: true,
        description: `${ctx.hotel} ${ctx.booking.reference}`.trim(),
        metadata: { property_id: ctx.booking.property_id, booking_id: ctx.booking.id, card_id: card.id },
      },
      { idempotencyKey: `charge-${card.id}-${input.attemptId}` },
    );
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "authentication_required") {
      return {
        ok: false,
        error: await localised("The card's bank asks the guest to confirm this payment. Send them a payment request instead."),
      };
    }
    return { ok: false, error: await localised(stripeMessage(e)) };
  }
  if (intent.status !== "succeeded") {
    return { ok: false, error: await localised("The card was not charged") };
  }

  const { error } = await ctx.supabase.rpc("record_gateway_payment", {
    p_booking_id: ctx.booking.id,
    p_folio_id: input.folioId,
    p_amount_cents: intent.amount_received || intent.amount,
    p_gateway_reference: intent.id,
    p_payer_name: input.payerName,
    p_description: input.description,
    p_request_id: null,
  });
  if (error) {
    // The money has left the card. Saying so, with Stripe's id, is what lets
    // the desk put it right: pressing Charge again with this same attempt
    // returns this same payment from Stripe and records it.
    const tr = await getT();
    return {
      ok: false,
      error: `${tr("The card was charged ({id}) but the payment was not recorded", { id: intent.id })}: ${tr.message(error.message)}`,
    };
  }
  revalidateBooking(ctx.booking.id);
  return { ok: true, data: null };
}

/* ---------------------------------------------------------------------------
 * Request payment
 * ------------------------------------------------------------------------- */

/** A Stripe Checkout link for the guest to pay by card. */
export async function createPaymentRequest(input: {
  bookingId: string;
  folioId: string | null;
  amountCents: number;
  description: string;
}): Promise<ActionResult<{ url: string }>> {
  if (!stripeConnected()) return notConnected();
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, error: await localised("The amount must be more than zero.") };
  }
  const ctx = await loadBooking(input.bookingId);
  if (!ctx) return { ok: false, error: await localised("That booking does not belong to this property") };
  if (ZERO_DECIMAL.has(ctx.currency)) {
    return { ok: false, error: await localised("Card payments are not available in this currency") };
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;
  const name = `${ctx.hotel} · ${ctx.booking.reference}`;

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: ctx.currency.toLowerCase(),
            unit_amount: input.amountCents,
            product_data: { name, description: input.description.trim() || undefined },
          },
        },
      ],
      customer_email: ctx.guestEmail ?? undefined,
      success_url: `${origin}/book/paid`,
      locale: "auto",
      metadata: { property_id: ctx.booking.property_id, booking_id: ctx.booking.id },
      payment_intent_data: {
        description: name,
        metadata: { property_id: ctx.booking.property_id, booking_id: ctx.booking.id },
      },
    });
  } catch (e) {
    return { ok: false, error: await localised(stripeMessage(e)) };
  }
  if (!session.url) return { ok: false, error: await localised("Stripe returned no payment link") };

  const { error } = await ctx.supabase.rpc("add_payment_request", {
    p_booking_id: ctx.booking.id,
    p_folio_id: input.folioId,
    p_amount_cents: input.amountCents,
    p_currency: ctx.currency,
    p_gateway_session_id: session.id,
    p_url: session.url,
    p_description: input.description,
  });
  if (error) {
    await stripe().checkout.sessions.expire(session.id).catch(() => undefined);
    return { ok: false, error: await localised(error.message) };
  }
  revalidateBooking(ctx.booking.id);
  return { ok: true, data: { url: session.url } };
}

export async function cancelPaymentRequest(input: {
  bookingId: string;
  requestId: string;
}): Promise<ActionResult<null>> {
  if (!stripeConnected()) return notConnected();
  const supabase = await createClient();
  const { data: request } = await supabase
    .from("payment_requests")
    .select("id, gateway_session_id, status")
    .eq("id", input.requestId)
    .maybeSingle();
  if (!request) return { ok: false, error: await localised("That payment request is not on this booking") };
  if (request.status === "open") {
    try {
      await stripe().checkout.sessions.expire(request.gateway_session_id);
    } catch {
      // Already paid or expired at Stripe: the sync below finds out which.
      const synced = await syncPaymentRequests(input.bookingId);
      if (!synced.ok) return synced;
      return { ok: true, data: null };
    }
  }
  const { error } = await supabase.rpc("close_payment_request", {
    p_request_id: request.id,
    p_status: "canceled",
  });
  if (error) return { ok: false, error: await localised(error.message) };
  revalidateBooking(input.bookingId);
  return { ok: true, data: null };
}

/**
 * Asks Stripe about every open request on the booking and records what it
 * says: a paid one becomes a payment on the folio, an expired one is closed.
 * The Payment tab calls this when it opens, under the staff member's session.
 */
export async function syncPaymentRequests(bookingId: string): Promise<ActionResult<{ changed: number }>> {
  if (!stripeConnected()) return { ok: true, data: { changed: 0 } };
  const supabase = await createClient();
  const { data: open } = await supabase
    .from("payment_requests")
    .select("id, folio_id, gateway_session_id, description")
    .eq("booking_id", bookingId)
    .eq("status", "open");
  let changed = 0;
  for (const r of open ?? []) {
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe().checkout.sessions.retrieve(r.gateway_session_id);
    } catch (e) {
      return { ok: false, error: await localised(stripeMessage(e)) };
    }
    if (session.payment_status === "paid") {
      const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      if (!intent || !session.amount_total) continue;
      const { error } = await supabase.rpc("record_gateway_payment", {
        p_booking_id: bookingId,
        p_folio_id: r.folio_id,
        p_amount_cents: session.amount_total,
        p_gateway_reference: intent,
        p_payer_name: session.customer_details?.name ?? "",
        p_description: r.description ?? "",
        p_request_id: r.id,
      });
      if (error) return { ok: false, error: await localised(error.message) };
      changed++;
    } else if (session.status === "expired") {
      const { error } = await supabase.rpc("close_payment_request", { p_request_id: r.id, p_status: "expired" });
      if (error) return { ok: false, error: await localised(error.message) };
      changed++;
    }
  }
  if (changed > 0) revalidateBooking(bookingId);
  return { ok: true, data: { changed } };
}
