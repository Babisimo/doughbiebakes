import { createReservation } from "@/sanity/lib/mutations";
import { sendReservationVerify } from "@/lib/reservation-email";
import { validateReservationCart } from "@/lib/reservations";
import { getActiveDrop } from "@/lib/catalog";
import { SEED_DROP_ID } from "@/lib/seed-products";
import { looksLikeBot, reservationCapError } from "@/lib/reserve-guard";
import { rateLimited } from "@/lib/rate-limit";
import { sanityClient } from "@/sanity/client";
import { OPEN_RESERVATION_FOR_EMAIL_DROP_QUERY } from "@/sanity/lib/queries";
import { getPromoByCode, isRedeemable, normalizeCode } from "@/lib/promo";
import { discountedTotalCents } from "@/lib/promo-math";

export const runtime = "nodejs";

const fresh = sanityClient?.withConfig({ useCdn: false }) ?? null;

type Body = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  items?: unknown;
  company?: unknown; // honeypot
  elapsedMs?: unknown;
  code?: unknown;
};

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return (xff?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown");
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const honeypot = typeof body.company === "string" ? body.company : "";
  const elapsedMs = Number(body.elapsedMs);
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems
    .map((it) => {
      const slug = (it as { slug?: unknown })?.slug;
      const qty = Math.floor(Number((it as { quantity?: unknown })?.quantity));
      return typeof slug === "string" && Number.isFinite(qty) && qty > 0
        ? { slug, quantity: Math.min(qty, 20) }
        : null;
    })
    .filter((x): x is { slug: string; quantity: number } => x !== null);

  // Layer 1 (bot deterrents) — honeypot/timing silent drop: never signal the bot (fake success).
  if (looksLikeBot(honeypot, elapsedMs)) {
    return Response.json({ ok: true });
  }

  // Layer 2 (anti-flood) — best-effort per-IP burst guard (3 / 10 min).
  if (rateLimited(`reserve:${clientIp(req)}`, 3, 600_000)) {
    return Response.json(
      { error: "Too many reservation attempts — please try again in a few minutes." },
      { status: 429 },
    );
  }

  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !phone) {
    return Response.json(
      { error: "Name, a valid email, and phone are required." },
      { status: 400 },
    );
  }

  // Layer 1 (bot deterrents) — input length/quantity caps.
  const capMsg = reservationCapError(name, email, phone, items);
  if (capMsg) return Response.json({ error: capMsg }, { status: 400 });

  if (items.length === 0) {
    return Response.json({ error: "Your order is empty." }, { status: 400 });
  }

  const result = await validateReservationCart(items);
  if (!result.ok) {
    return Response.json({ error: result.message }, { status: 409 });
  }

  const drop = await getActiveDrop({ fresh: true });
  if (!drop || drop.id === SEED_DROP_ID) {
    return Response.json(
      { error: "Ordering isn't open right now." },
      { status: 409 },
    );
  }

  // Layer 2 (anti-flood) — one open (unverified|pending) reservation per email per drop.
  if (fresh) {
    const existing = await fresh.fetch<{ id: string; status: string } | null>(
      OPEN_RESERVATION_FOR_EMAIL_DROP_QUERY,
      { dropId: drop.id, email: email.toLowerCase() },
      { cache: "no-store" as const },
    );
    if (existing) {
      // Tailor the message so the customer knows which step they're actually
      // stuck on. Both branches return 409 so the form surfaces it as an error.
      const message =
        existing.status === "unverified"
          ? "You already started a reservation for this drop, but you haven't clicked the confirmation link in your email yet. Check your inbox (and spam) for our verification email — once you click it, the baker reviews it. If you can't find it, email us and we'll resend."
          : "You already have a reservation in for this drop and it's waiting on baker review. We'll email you the moment it's approved — no need to submit again.";
      return Response.json({ error: message }, { status: 409 });
    }
  }

  let promoCode: string | undefined;
  let promoPercentOff: number | undefined;
  let discounted: number | undefined;
  let notice: string | undefined;
  const codeRaw = typeof body.code === "string" ? body.code.trim() : "";
  if (codeRaw) {
    const promo = await getPromoByCode(codeRaw);
    if (isRedeemable(promo)) {
      promoCode = normalizeCode(promo.code);
      promoPercentOff = promo.percentOff;
      discounted = discountedTotalCents(result.totalCents, promo.percentOff);
    } else {
      notice = "That code isn't valid or is fully claimed — reserved at full price.";
    }
  }

  const id = await createReservation({
    customerName: name,
    customerEmail: email,
    customerPhone: phone,
    dropId: drop.id,
    items: result.items,
    totalCents: result.totalCents,
    promoCode,
    promoPercentOff,
    discountedTotalCents: discounted,
  });
  if (!id) {
    return Response.json(
      { error: "Reservations are temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  const emailInput = {
    id,
    customerName: name,
    customerEmail: email,
    customerPhone: phone,
    lines: result.items.map((i) => ({
      productName: i.productName,
      quantity: i.quantity,
      priceCents: i.priceCents,
    })),
    totalCents: discounted ?? result.totalCents,
    originalTotalCents: discounted != null ? result.totalCents : undefined,
    promoPercentOff,
    pickupDate: drop.pickupOrShipDate,
  };
  console.info(
    `[reserve] unverified reservation ${id} — ${name} <${email}> — ` +
      `$${((discounted ?? result.totalCents) / 100).toFixed(2)}` +
      (promoCode ? ` [promo ${promoCode} −${promoPercentOff}%]` : "") +
      ` — ` +
      result.items.map((i) => `${i.quantity}× ${i.productSlug}`).join(", "),
  );
  // Double opt-in: only the verify email goes out now. Baker alert + "received"
  // fire from /api/reservations/verify once the customer clicks.
  await sendReservationVerify(emailInput);

  return Response.json({
    ok: true,
    pendingVerification: true,
    ...(notice ? { notice } : {}),
  });
}
