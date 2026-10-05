import Stripe from "stripe";

/*
 * The payment gateway (0130): Stripe, for the Payment tab's Card Vault and
 * Request payment.
 *
 * Read on the server only -- from Server Actions and Server Components. The
 * secret key is STRIPE_SECRET_KEY, which is never NEXT_PUBLIC_, so a client
 * bundle that imported this by mistake would find it undefined rather than
 * leak it. The browser is handed the publishable key and nothing else.
 *
 * With either key missing the gateway is "not connected": the Payment tab
 * then says so instead of drawing controls that cannot work.
 */

let client: Stripe | null = null;

/** The publishable key, when the gateway is connected; null when it is not. */
export function stripePublishableKey(): string | null {
  const secret = process.env.STRIPE_SECRET_KEY;
  const publishable = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  return secret && publishable ? publishable : null;
}

export function stripeConnected(): boolean {
  return stripePublishableKey() !== null;
}

export function stripe(): Stripe {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("The payment gateway is not connected");
  client ??= new Stripe(secret, { appInfo: { name: "Hotel PMS" } });
  return client;
}

/** Stripe's own message for a failed call, else the error's. */
export function stripeMessage(e: unknown): string {
  if (e instanceof Stripe.errors.StripeError) return e.message;
  return e instanceof Error ? e.message : String(e);
}
