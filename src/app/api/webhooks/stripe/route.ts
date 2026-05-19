import type Stripe from "stripe";

import { applyOrderToActiveDrop, createOrder, redeemPromo, upsertMember } from "@/sanity/lib/mutations";
import { buildOrderRecord, type OrderShipAddress } from "@/lib/order-record";
import { sendOrderEmails, type OrderEmailLine } from "@/lib/order-email";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * Stripe webhook. Configure the endpoint in the Stripe dashboard (or `stripe
 * listen --forward-to localhost:3000/api/webhooks/stripe` in dev) and put the
 * signing secret in STRIPE_WEBHOOK_SECRET.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return Response.json(
      { error: "Webhook not configured." },
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing signature." }, { status: 400 });
  }

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("[webhook] signature verification failed:", err);
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    await handleCompletedCheckout(stripe, session);
  } else if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = event.data.object;
    await handleSubscriptionEvent(stripe, sub, event.type);
  }

  return Response.json({ received: true });
}

async function handleSubscriptionEvent(
  stripe: Stripe,
  sub: Stripe.Subscription,
  eventType: string,
) {
  const breadClubPriceId = process.env.STRIPE_BREAD_CLUB_PRICE_ID;
  if (!breadClubPriceId) {
    console.warn("[webhook] STRIPE_BREAD_CLUB_PRICE_ID not set — skipping subscription sync.");
    return;
  }

  // Only mirror subscriptions on the Bread Club price. Other subscription
  // products (if any) shouldn't pollute the membership table.
  const onBreadClubPrice = sub.items?.data?.some(
    (i) => i.price?.id === breadClubPriceId,
  );
  if (!onBreadClubPrice) return;

  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  let email: string | null = null;
  if (typeof sub.customer === "object" && !sub.customer.deleted) {
    email = sub.customer.email ?? null;
  }
  if (!email) {
    try {
      const c = await stripe.customers.retrieve(customerId);
      if (!c.deleted) email = c.email ?? null;
    } catch (err) {
      console.error("[webhook] failed to fetch customer", customerId, err);
    }
  }
  if (!email) {
    console.warn(
      `[webhook] subscription ${sub.id} (${eventType}) has no customer email — skipping member sync`,
    );
    return;
  }

  const canceled =
    eventType === "customer.subscription.deleted" || sub.status === "canceled";

  try {
    await upsertMember({
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      customerEmail: email,
      subscriptionStatus: sub.status,
      priceId: breadClubPriceId,
      canceled,
    });
    console.info(
      `[webhook] member ${email} synced (status=${sub.status}, event=${eventType})`,
    );
  } catch (err) {
    console.error("[webhook] failed to upsert member", email, err);
  }
}

function mapAddr(
  a:
    | { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postal_code?: string | null }
    | null
    | undefined,
): OrderShipAddress | null {
  if (!a) return null;
  const out: OrderShipAddress = {};
  if (a.line1) out.line1 = a.line1;
  if (a.line2) out.line2 = a.line2;
  if (a.city) out.city = a.city;
  if (a.state) out.state = a.state;
  if (a.postal_code) out.postalCode = a.postal_code;
  return Object.keys(out).length > 0 ? out : null;
}

async function handleCompletedCheckout(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
) {
  const shipState =
    session.collected_information?.shipping_details?.address?.state;
  const billState = session.customer_details?.address?.state;
  const state = shipState ?? billState;
  // Heuristic: a non-zero shipping charge means the CA Priority option (not pickup).
  const isPickup = (session.shipping_cost?.amount_total ?? 0) === 0;

  // Cottage Food compliance flag — review before fulfilling.
  if (state && state.toUpperCase() !== "CA") {
    console.warn(
      `[webhook] ⚠️ Order ${session.id} address is in ${state}, not CA. ` +
        `Cottage Food sales must stay in-state — review before fulfilling (refund or arrange local pickup).`,
    );
  }

  // Parse what was ordered (from metadata; fall back to expanded line items).
  let sold: { slug: string; quantity: number }[] = [];
  const raw = session.metadata?.cart;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { s: string; q: number }[];
      sold = parsed
        .filter((x) => x && typeof x.s === "string" && Number.isFinite(x.q))
        .map((x) => ({ slug: x.s, quantity: Math.max(1, Math.floor(x.q)) }));
    } catch {
      /* ignore malformed metadata */
    }
  }
  if (sold.length === 0) {
    const items = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 100,
      expand: ["data.price.product"],
    });
    sold = items.data
      .map((li) => {
        const product = li.price?.product;
        const slug =
          product && typeof product !== "string" && !("deleted" in product)
            ? product.metadata?.slug
            : undefined;
        return slug ? { slug, quantity: li.quantity ?? 1 } : null;
      })
      .filter((x): x is { slug: string; quantity: number } => x !== null);
  }

  console.info(
    `[webhook] ✅ Paid order ${session.id} — ${session.amount_total != null ? `$${(session.amount_total / 100).toFixed(2)}` : "?"} — ` +
      `${session.customer_details?.email ?? "no email"} — ${isPickup ? "pickup" : `ship to ${state ?? "?"}`} — ` +
      sold.map((s) => `${s.quantity}× ${s.slug}`).join(", "),
  );

  let dropId: string | null = null;
  try {
    dropId = await applyOrderToActiveDrop(sold);
  } catch (err) {
    console.error("[webhook] failed to update drop inventory:", err);
  }

  // Founding code: commit the shared counter on real, completed payments
  // only. Over-cap is HONORED (the customer already paid the discounted
  // amount) — never clawed back; just log a greppable signal.
  const promoMeta = session.metadata?.promo;
  if (session.mode === "payment" && session.livemode && promoMeta) {
    try {
      const ok = await redeemPromo(promoMeta);
      if (!ok) {
        console.warn(`[promo] OVER-CAP REDEMPTION HONORED ${session.id} (${promoMeta})`);
      }
    } catch (err) {
      console.error("[promo] webhook redeem failed", session.id, err);
    }
  }

  const customerEmail = session.customer_details?.email;
  if (!customerEmail) {
    console.warn(
      `[webhook] order ${session.id} has no customer email — skipping confirmation`,
    );
    return;
  }

  // Prefer Stripe's line items for the email — they carry the names and the
  // exact amounts the customer was actually charged.
  let emailLines: OrderEmailLine[] = [];
  const productLookup = new Map<string, { name: string; priceCents: number }>();
  try {
    const li = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 100,
      expand: ["data.price.product"],
    });
    emailLines = li.data.map((item) => {
      const product = item.price?.product;
      const resolved =
        product && typeof product !== "string" && !("deleted" in product)
          ? product
          : null;
      const name = item.description ?? resolved?.name ?? "Loaf";
      const slug = resolved?.metadata?.slug;
      if (slug) {
        productLookup.set(slug, {
          name: resolved?.name ?? item.description ?? "Loaf",
          priceCents: item.price?.unit_amount ?? 0,
        });
      }
      return {
        name,
        quantity: item.quantity ?? 1,
        amountCents: item.amount_total ?? 0,
      };
    });
  } catch (err) {
    console.error(
      "[webhook] failed to list line items — order will not be persisted:",
      err,
    );
  }

  // Best-effort: persist a public-order record (Bread Club subscription
  // checkouts are `mode: "subscription"` — never recorded as orders).
  if (session.mode === "payment") {
    const rec = buildOrderRecord({
      stripeSessionId: session.id,
      customerEmail: customerEmail,
      customerName: session.customer_details?.name,
      customerPhone: session.customer_details?.phone,
      dropId,
      sold,
      productLookup,
      subtotalCents: session.amount_subtotal ?? 0,
      shippingCents: session.shipping_cost?.amount_total ?? 0,
      totalCents: session.amount_total ?? 0,
      isPickup,
      shipState: state,
      // ship orders only: prefer the collected shipping address, fall back
      // to the billing address if no shipping address was collected.
      shipAddress: isPickup
        ? null
        : mapAddr(
            session.collected_information?.shipping_details?.address ??
              session.customer_details?.address,
          ),
      livemode: session.livemode,
      // Stripe-authoritative completion time (stable across webhook
      // redeliveries), not wall-clock processing time.
      createdAt: new Date(session.created * 1000).toISOString(),
    });
    if (rec) {
      try {
        await createOrder(rec);
      } catch (err) {
        console.error("[webhook] ORDER NOT PERSISTED", session.id, err);
      }
    } else {
      console.warn(
        "[webhook] order not recorded — no resolvable items/email",
        session.id,
      );
    }
  }

  // Best-effort: never blocks the 200 (sendOrderEmails swallows its own errors).
  await sendOrderEmails({
    to: customerEmail,
    customerName: session.customer_details?.name,
    orderRef: session.id.slice(-8).toUpperCase(),
    lines: emailLines,
    subtotalCents: session.amount_subtotal ?? 0,
    shippingCents: session.shipping_cost?.amount_total ?? 0,
    totalCents: session.amount_total ?? 0,
    isPickup,
    shipState: state,
  });
}
