import { createReservation } from "@/sanity/lib/mutations";
import {
  sendReservationBakerAlert,
  sendReservationReceived,
} from "@/lib/reservation-email";
import { validateReservationCart } from "@/lib/reservations";
import { getActiveDrop } from "@/lib/catalog";
import { SEED_DROP_ID } from "@/lib/seed-products";

export const runtime = "nodejs";

type Body = { name?: unknown; email?: unknown; phone?: unknown; items?: unknown };

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

  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !phone) {
    return Response.json(
      { error: "Name, a valid email, and phone are required." },
      { status: 400 },
    );
  }
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

  const id = await createReservation({
    customerName: name,
    customerEmail: email,
    customerPhone: phone,
    dropId: drop.id,
    items: result.items,
    totalCents: result.totalCents,
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
    totalCents: result.totalCents,
    pickupDate: drop.pickupOrShipDate,
  };
  console.info(
    `[reserve] new reservation ${id} — ${name} <${email}> — ` +
      `$${(result.totalCents / 100).toFixed(2)} — ` +
      result.items.map((i) => `${i.quantity}× ${i.productSlug}`).join(", "),
  );
  await sendReservationReceived(emailInput);
  await sendReservationBakerAlert(emailInput);

  return Response.json({ ok: true });
}
