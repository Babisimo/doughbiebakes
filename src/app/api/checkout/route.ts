import type Stripe from "stripe";

import {
  getActiveDrop,
  getMemberSelectionsForDrop,
  getReservationHoldsForDrop,
} from "@/lib/catalog";
import { effectiveDropStatus } from "@/lib/drop-status";
import { IS_PRELAUNCH } from "@/lib/launch-mode";
import { getPromoByCode, isRedeemable, normalizeCode } from "@/lib/promo";
import { shippingOptions } from "@/lib/site";
import { getStripe } from "@/lib/stripe";
import { siteUrl } from "@/lib/url";

export const runtime = "nodejs";

type IncomingItem = { slug: string; quantity: number };

function parseCart(body: unknown): IncomingItem[] {
  if (!body || typeof body !== "object") return [];
  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items
    .map((it): IncomingItem | null => {
      if (!it || typeof it !== "object") return null;
      const slug = (it as { slug?: unknown }).slug;
      const quantity = (it as { quantity?: unknown }).quantity;
      if (typeof slug !== "string") return null;
      const qty = Math.floor(Number(quantity));
      if (!Number.isFinite(qty) || qty < 1) return null;
      return { slug, quantity: Math.min(qty, 20) };
    })
    .filter((it): it is IncomingItem => it !== null);
}

/**
 * A reusable Stripe coupon for the founding discount, keyed by percent so it's
 * created once and shared. Applied as a session-level discount so it comes off
 * the order TOTAL, not each loaf's unit price.
 */
async function ensureFoundingCoupon(
  stripe: Stripe,
  percentOff: number,
): Promise<string> {
  const id = `founding-${percentOff}pct`;
  try {
    await stripe.coupons.create({
      id,
      percent_off: percentOff,
      duration: "once",
      name: `Founding ${percentOff}% off`,
    });
  } catch (err) {
    // Already created by an earlier checkout — reuse it. Re-throw anything else.
    if ((err as { code?: string })?.code !== "resource_already_exists") throw err;
  }
  return id;
}

export async function POST(request: Request) {
  // Pre-launch guard: refuse online checkout server-side even if the UI is
  // somehow bypassed. Friends pre-order through /reserve and pay at pickup.
  if (IS_PRELAUNCH) {
    return Response.json(
      {
        error:
          "Online payments aren't open yet — we're in our founding tasting period while our Cottage Food Operation registration finishes. Reserve a loaf for local pickup instead.",
      },
      { status: 503 },
    );
  }

  const stripe = getStripe();
  if (!stripe) {
    return Response.json(
      { error: "Payments are not configured yet. Set STRIPE_SECRET_KEY." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const cart = parseCart(body);
  if (cart.length === 0) {
    return Response.json({ error: "Your cart is empty." }, { status: 400 });
  }

  // The open drop is the single source of truth: only its line items are
  // sellable, only while it's open, and only up to the quantity that's left.
  // (This is the authoritative check — the storefront UI mirrors it, but a
  // hand-crafted request still can't buy what isn't there.) Prices are read
  // here, server-side, so amounts sent by the browser are never trusted.
  // Authoritative point-of-sale inventory check — read live (no CDN / no
  // cache) so a stale snapshot can't oversell a sold-out loaf.
  const drop = await getActiveDrop({ fresh: true });
  if (!drop || effectiveDropStatus(drop, new Date()) !== "open") {
    return Response.json(
      { error: "Ordering isn't open right now — check the current drop." },
      { status: 409 },
    );
  }
  const dropBySlug = new Map(drop.lineItems.map((li) => [li.product.slug, li]));

  // Member-club picks reserve a loaf out of the public quantity. Subtract them
  // here so the public never checks out a loaf a member has already claimed.
  const memberSelections = await getMemberSelectionsForDrop(drop, { fresh: true });
  const claimedBySlug = new Map<string, number>();
  for (const sel of memberSelections) {
    claimedBySlug.set(sel.productSlug, (claimedBySlug.get(sel.productSlug) ?? 0) + 1);
  }

  // Pending (email-confirmed) reservations also hold loaves out of the public
  // quantity — subtract them so two customers can't buy the same last loaf.
  const reservationHolds = await getReservationHoldsForDrop(drop.id, { fresh: true });

  const codeRaw =
    body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string"
      ? ((body as { code?: string }).code as string).trim()
      : "";
  let promoPercentOff = 0;
  let promoMeta: string | undefined;
  if (codeRaw) {
    const promo = await getPromoByCode(codeRaw);
    if (isRedeemable(promo)) {
      promoPercentOff = promo.percentOff;
      promoMeta = normalizeCode(promo.code);
    }
  }

  const lineItems: NonNullable<
    Stripe.Checkout.SessionCreateParams["line_items"]
  > = [];
  for (const item of cart) {
    const li = dropBySlug.get(item.slug);
    if (!li || !li.product.available) {
      return Response.json(
        { error: `"${item.slug}" isn't part of this week's drop.` },
        { status: 409 },
      );
    }
    const raw = Math.max(0, Math.floor(li.quantity ?? 0));
    const claimed = claimedBySlug.get(item.slug) ?? 0;
    const held = reservationHolds.get(item.slug) ?? 0;
    const left = Math.max(0, raw - claimed - held);
    if (left <= 0) {
      return Response.json(
        { error: `"${li.product.name}" is sold out.` },
        { status: 409 },
      );
    }
    if (item.quantity > left) {
      return Response.json(
        {
          error: `Only ${left} ${left === 1 ? "loaf" : "loaves"} of "${li.product.name}" left — please lower the quantity.`,
        },
        { status: 409 },
      );
    }
    lineItems.push({
      quantity: item.quantity,
      price_data: {
        currency: "usd",
        unit_amount: li.product.priceCents,
        product_data: {
          name: li.product.name,
          description: li.product.tagline ?? undefined,
          metadata: { slug: li.product.slug },
          ...(li.product.imageUrl ? { images: [li.product.imageUrl] } : {}),
        },
      },
    });
  }

  // Apply the founding discount to the order TOTAL via a reusable Stripe
  // coupon — line items stay full price; Stripe takes the % off the subtotal.
  const couponId =
    promoPercentOff > 0 ? await ensureFoundingCoupon(stripe, promoPercentOff) : null;

  const base = siteUrl();
  const cartSummary = JSON.stringify(
    cart.map((c) => ({ s: c.slug, q: c.quantity })),
  ).slice(0, 480);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      // Cottage Food: intrastate only. Stripe can't filter to a single state,
      // so we collect a US address, warn clearly, and verify CA in the webhook.
      shipping_address_collection: { allowed_countries: ["US"] },
      phone_number_collection: { enabled: true },
      billing_address_collection: "auto",
      // Founding discount comes off the order total via a session coupon.
      // Stripe's own promo-code field is intentionally never shown: the
      // founding code is app-managed (one shared cap across online orders
      // AND reservations), so the cart's promo field is the only code entry.
      ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
      shipping_options: shippingOptions.map((opt) => ({
        shipping_rate_data: {
          // Required by the Stripe API (the only allowed value).
          type: "fixed_amount",
          display_name: opt.label,
          fixed_amount: { amount: opt.amountCents, currency: "usd" },
        },
      })),
      custom_text: {
        shipping_address: {
          message:
            "California addresses only — Cottage Food rules prohibit shipping out of state. Choose Local Pickup if you're in the Corona area.",
        },
        submit: {
          message:
            "You're pre-ordering from a home kitchen. We'll confirm pickup/ship details by email.",
        },
      },
      metadata: {
        cart: cartSummary,
        // The exact drop this order is for — the webhook decrements THIS drop,
        // rather than guessing "the open drop" from a stored-status query.
        dropId: drop.id,
        ...(promoMeta ? { promo: promoMeta } : {}),
      },
      success_url: `${base}/order/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/order/canceled`,
    });

    return Response.json({ url: session.url });
  } catch (err) {
    console.error("[checkout] Stripe error:", err);
    return Response.json(
      { error: "Could not start checkout. Please try again." },
      { status: 502 },
    );
  }
}
