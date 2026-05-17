import "server-only";

import Stripe from "stripe";

let cached: Stripe | null | undefined;

/**
 * Lazily-constructed server-side Stripe client. Returns `null` when
 * STRIPE_SECRET_KEY is not set so routes can respond with a clear 503 instead
 * of crashing the whole app during local development.
 */
export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  cached = key
    ? new Stripe(key, {
        apiVersion: "2026-04-22.dahlia",
        appInfo: { name: "doughbie" },
      })
    : null;
  return cached;
}
