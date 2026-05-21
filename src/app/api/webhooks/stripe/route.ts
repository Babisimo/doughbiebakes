import type Stripe from "stripe";

import {
  createClubMember,
  createOrder,
  decrementDropQuantities,
  redeemPromo,
  setMemberCard,
} from "@/sanity/lib/mutations";
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
    if (session.mode === "setup") {
      await handleSetupCompleted(stripe, session);
    } else {
      await handleCompletedCheckout(stripe, session);
    }
  }

  return Response.json({ received: true });
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

  // Decrement the exact drop this order was placed against — its id rides
  // along in the Checkout Session metadata (set in /api/checkout). This is
  // authoritative; we never guess "the open drop" from a status query.
  const dropId: string | null =
    typeof session.metadata?.dropId === "string" ? session.metadata.dropId : null;
  if (dropId && sold.length > 0) {
    try {
      await decrementDropQuantities(dropId, sold);
      console.info(`[webhook] drop ${dropId} stock decremented`);
    } catch (err) {
      console.error("[webhook] failed to decrement drop inventory:", err);
    }
  } else if (!dropId && sold.length > 0) {
    console.warn(
      `[webhook] order ${session.id} has no dropId metadata — inventory not decremented`,
    );
  }

  // Founding code: commit the shared counter on real, completed payments
  // only. Over-cap is HONORED (the customer already paid the discounted
  // amount) — never clawed back; just log a greppable signal.
  const promoMeta = session.metadata?.promo;
  const discountCents = session.total_details?.amount_discount ?? 0;
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
      promoCode: promoMeta,
      discountCents,
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
    promoCode: promoMeta,
    discountCents,
    isPickup,
    shipState: state,
  });
}

/**
 * A completed `setup`-mode Checkout — a Bread Club join or a card update.
 * Saves the entered card as the customer's default and writes/updates the
 * member doc. `metadata.kind` distinguishes the two.
 */
async function handleSetupCompleted(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
) {
  const kind = session.metadata?.kind;
  if (kind !== "club-join" && kind !== "club-card-update") return;

  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id;
  const setupIntentId =
    typeof session.setup_intent === "string"
      ? session.setup_intent
      : session.setup_intent?.id;
  if (!customerId || !setupIntentId) {
    console.error("[webhook] setup session missing customer/setup_intent", session.id);
    return;
  }

  let paymentMethodId: string | null = null;
  try {
    const si = await stripe.setupIntents.retrieve(setupIntentId);
    paymentMethodId =
      typeof si.payment_method === "string"
        ? si.payment_method
        : (si.payment_method?.id ?? null);
  } catch (err) {
    // Transient Stripe error — rethrow so the webhook 500s and Stripe retries.
    // Returning here would 200 the delivery and permanently lose the signup.
    console.error("[webhook] setup intent retrieve failed", session.id, err);
    throw err;
  }
  if (!paymentMethodId) {
    console.error("[webhook] setup session has no payment method", session.id);
    return;
  }

  // Make it the customer's default so off-session charges resolve cleanly.
  try {
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  } catch (err) {
    console.error("[webhook] could not set default payment method", customerId, err);
  }

  if (kind === "club-card-update") {
    await setMemberCard(customerId, paymentMethodId);
    console.info(`[webhook] member ${customerId} card updated`);
    return;
  }

  const email = session.customer_details?.email ?? session.customer_email;
  if (!email) {
    console.error("[webhook] club-join session has no email", session.id);
    return;
  }
  await createClubMember({
    stripeCustomerId: customerId,
    stripePaymentMethodId: paymentMethodId,
    customerEmail: email,
  });
  console.info(`[webhook] Bread Club member created ${customerId} <${email}>`);
}
