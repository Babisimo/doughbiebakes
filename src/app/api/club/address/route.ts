import "server-only";

import { getMemberByEmail } from "@/lib/catalog";
import { verifyClubToken } from "@/lib/club-token";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * Save (or update) a Bread Club member's shipping name + address on their
 * Stripe customer. Authenticated by the same magic-link token used by
 * /club/[dropId]. Stripe is the source of truth — the admin bake list already
 * reads `customer.shipping` directly, so once we land it here it surfaces
 * everywhere immediately.
 *
 * Cottage Food rule: California sales only. We reject any non-CA address
 * server-side; the form locks the field to "CA" client-side anyway.
 */
export async function POST(req: Request) {
  let body: {
    email?: unknown;
    dropId?: unknown;
    token?: unknown;
    name?: unknown;
    line1?: unknown;
    line2?: unknown;
    city?: unknown;
    state?: unknown;
    postalCode?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const dropId = typeof body.dropId === "string" ? body.dropId : "";
  const token = typeof body.token === "string" ? body.token : "";
  if (!email || !dropId || !token || !verifyClubToken(email, dropId, token)) {
    return Response.json({ error: "Invalid or expired link." }, { status: 403 });
  }

  // Trim everything once, then validate.
  const name = (typeof body.name === "string" ? body.name : "").trim();
  const line1 = (typeof body.line1 === "string" ? body.line1 : "").trim();
  const line2 = (typeof body.line2 === "string" ? body.line2 : "").trim();
  const city = (typeof body.city === "string" ? body.city : "").trim();
  const state = (typeof body.state === "string" ? body.state : "").trim().toUpperCase();
  const postalCode = (typeof body.postalCode === "string" ? body.postalCode : "").trim();

  if (!name || name.length > 80) {
    return Response.json({ error: "Please enter your name." }, { status: 400 });
  }
  if (!line1 || line1.length > 120) {
    return Response.json({ error: "Please enter a street address." }, { status: 400 });
  }
  if (!city || city.length > 60) {
    return Response.json({ error: "Please enter a city." }, { status: 400 });
  }
  if (state !== "CA") {
    return Response.json(
      {
        error:
          "California Cottage Food sales must stay in-state — we can only ship within CA. Pick Local pickup instead if you're outside California.",
      },
      { status: 400 },
    );
  }
  if (!/^\d{5}(-\d{4})?$/.test(postalCode)) {
    return Response.json(
      { error: "Please enter a valid US 5-digit ZIP code." },
      { status: 400 },
    );
  }

  const member = await getMemberByEmail(email, { fresh: true });
  if (!member?.stripeCustomerId) {
    return Response.json(
      { error: "We couldn't find your Bread Club membership for that email." },
      { status: 404 },
    );
  }

  const stripe = getStripe();
  if (!stripe) {
    return Response.json({ error: "Payments aren't configured." }, { status: 503 });
  }

  try {
    await stripe.customers.update(member.stripeCustomerId, {
      name,
      shipping: {
        name,
        address: {
          line1,
          ...(line2 ? { line2 } : {}),
          city,
          state: "CA",
          postal_code: postalCode,
          country: "US",
        },
      },
    });
  } catch (err) {
    console.error("[club/address] Stripe update failed:", err);
    return Response.json(
      { error: "Could not save the address — please try again." },
      { status: 502 },
    );
  }

  return Response.json({ ok: true });
}
