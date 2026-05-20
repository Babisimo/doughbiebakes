import "server-only";

import { createClient } from "next-sanity";

import type { OrderRecord } from "@/lib/order-record";
import { site } from "@/lib/site";

import { apiVersion, dataset, projectId, sanityConfigured, writeToken } from "../env";

/**
 * Write client used by server-side jobs (e.g. the Stripe webhook). Requires a
 * token with write access in SANITY_API_WRITE_TOKEN. Returns `null` when Sanity
 * or the token is not configured.
 */
const writeClient =
  sanityConfigured && writeToken
    ? createClient({
        projectId,
        dataset,
        apiVersion,
        token: writeToken,
        useCdn: false,
      })
    : null;

type SoldItem = { slug: string; quantity: number };

/**
 * Decrement quantities on a specific drop by array `_key` (never writes
 * `product` — that caused the "Key slug not allowed in ref" corruption).
 * Flips the drop to "soldout" when every line hits 0. Shared by the Stripe
 * webhook and reservation approval.
 */
export async function decrementDropQuantities(
  dropId: string,
  items: SoldItem[],
): Promise<void> {
  if (!writeClient || items.length === 0) return;

  const drop = await writeClient.fetch<{
    _id: string;
    lineItems?: { _key: string; quantity?: number; product?: { slug?: { current?: string } } }[];
  } | null>(
    `*[_type == "drop" && _id == $id][0]{
      _id, "lineItems": lineItems[]{ _key, quantity, "product": product->{ "slug": slug } }
    }`,
    { id: dropId },
  );
  if (!drop?.lineItems?.length) return;

  const wanted = new Map(items.map((i) => [i.slug, i.quantity] as const));
  let patch = writeClient.patch(drop._id);
  let changed = false;
  let allZero = true;
  for (const li of drop.lineItems) {
    const slug = li.product?.slug?.current;
    const dec = slug ? wanted.get(slug) ?? 0 : 0;
    const next = Math.max(0, (li.quantity ?? 0) - dec);
    if (dec > 0 && li._key) {
      changed = true;
      patch = patch.set({ [`lineItems[_key=="${li._key}"].quantity`]: next });
    }
    if (next > 0) allZero = false;
  }
  if (!changed) return;
  if (allZero) patch = patch.set({ status: "soldout" });
  await patch.commit({ autoGenerateArrayKeys: false });
}

type MemberSelectionInput = {
  dropId: string;
  email: string;
  productSlug: string;
  fulfillment: "pickup" | "ship";
  /** Stripe pending invoice item id for the ship surcharge. `null` clears it
   * (member switched back to pickup); `undefined` leaves it untouched. */
  shipInvoiceItemId?: string | null;
};

/**
 * Records (or replaces) one member's selection for a drop. Idempotent on
 * (drop, email) — calling twice with a different slug or fulfillment swaps
 * the pick. Returns true if the write happened, false if Sanity isn't
 * configured.
 */
export async function upsertMemberSelection(
  input: MemberSelectionInput,
): Promise<boolean> {
  if (!writeClient) return false;
  const email = input.email.trim().toLowerCase();

  const existing = await writeClient.fetch<{ _id: string } | null>(
    `*[_type == "memberSelection" && drop._ref == $dropId && customerEmail == $email][0]{ _id }`,
    { dropId: input.dropId, email },
  );

  const now = new Date().toISOString();

  if (existing) {
    let patch = writeClient.patch(existing._id).set({
      productSlug: input.productSlug,
      fulfillment: input.fulfillment,
      selectedAt: now,
    });
    if (input.shipInvoiceItemId === null) {
      patch = patch.unset(["shipInvoiceItemId"]);
    } else if (typeof input.shipInvoiceItemId === "string") {
      patch = patch.set({ shipInvoiceItemId: input.shipInvoiceItemId });
    }
    await patch.commit();
  } else {
    await writeClient.create({
      _type: "memberSelection",
      drop: { _type: "reference", _ref: input.dropId },
      customerEmail: email,
      productSlug: input.productSlug,
      fulfillment: input.fulfillment,
      selectedAt: now,
      ...(typeof input.shipInvoiceItemId === "string"
        ? { shipInvoiceItemId: input.shipInvoiceItemId }
        : {}),
    });
  }
  return true;
}

type MemberSyncInput = {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  customerEmail: string;
  subscriptionStatus: string;
  priceId: string;
  canceled: boolean;
};

/**
 * Mirror a Stripe subscription into the Sanity `member` cache. Idempotent:
 * `_id` is the Stripe customer id, so the same customer always upserts to
 * the same doc. `joinedAt` is set on first sync and preserved thereafter.
 */
export async function upsertMember(input: MemberSyncInput): Promise<boolean> {
  if (!writeClient) return false;
  const docId = input.stripeCustomerId;
  const email = input.customerEmail.trim().toLowerCase();
  const now = new Date().toISOString();

  const existing = await writeClient.fetch<{ _id: string } | null>(
    `*[_type == "member" && _id == $id][0]{ "_id": _id }`,
    { id: docId },
  );
  let founding = false;
  if (!existing) {
    const foundingCount = await writeClient.fetch<number>(
      `count(*[_type == "member" && founding == true])`,
    );
    founding = foundingCount < site.breadClub.foundingSeats;
  }

  await writeClient.createIfNotExists({
    _id: docId,
    _type: "member",
    customerEmail: email,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    subscriptionStatus: input.subscriptionStatus,
    priceId: input.priceId,
    joinedAt: now,
    lastSyncedAt: now,
    ...(founding ? { founding: true } : {}),
  });

  const patch = writeClient.patch(docId).set({
    customerEmail: email,
    stripeSubscriptionId: input.stripeSubscriptionId,
    subscriptionStatus: input.subscriptionStatus,
    priceId: input.priceId,
    lastSyncedAt: now,
    ...(input.canceled ? { canceledAt: now } : {}),
  });
  await patch.commit();
  return true;
}

type ReservationItemInput = {
  productSlug: string;
  productName: string;
  quantity: number;
  priceCents: number;
};

export async function createReservation(input: {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  dropId: string;
  items: ReservationItemInput[];
  totalCents: number;
  promoCode?: string;
  promoPercentOff?: number;
  discountedTotalCents?: number;
}): Promise<string | null> {
  if (!writeClient) return null;
  const now = new Date().toISOString();
  const doc = await writeClient.create({
    _type: "reservation",
    customerName: input.customerName,
    customerEmail: input.customerEmail.trim().toLowerCase(),
    customerPhone: input.customerPhone,
    drop: { _type: "reference", _ref: input.dropId },
    items: input.items.map((i) => ({ _type: "reservationItem", ...i })),
    totalCents: input.totalCents,
    ...(input.promoCode ? { promoCode: input.promoCode } : {}),
    ...(typeof input.promoPercentOff === "number"
      ? { promoPercentOff: input.promoPercentOff }
      : {}),
    ...(typeof input.discountedTotalCents === "number"
      ? { discountedTotalCents: input.discountedTotalCents }
      : {}),
    status: "unverified",
    createdAt: now,
  });
  return doc._id;
}

/**
 * Atomically transition a reservation only if it is still `fromStatus`
 * (fetch current `_rev`, patch with `ifRevisionId`). Returns true if THIS
 * call performed the transition; false if it was already decided / lost the
 * race — callers treat false as an idempotent no-op (no double-decrement).
 */
export async function setReservationStatus(
  id: string,
  fromStatus: string,
  toStatus: string,
): Promise<boolean> {
  if (!writeClient) return false;
  const cur = await writeClient.fetch<{ _rev: string; status: string } | null>(
    `*[_type == "reservation" && _id == $id][0]{ _rev, status }`,
    { id },
  );
  if (!cur || cur.status !== fromStatus) return false;
  try {
    await writeClient
      .patch(id)
      .ifRevisionId(cur._rev)
      .set({ status: toStatus, decidedAt: new Date().toISOString() })
      .commit();
    return true;
  } catch (err) {
    // Swallow ONLY a revision conflict (HTTP 409 — another actor decided it
    // first → idempotent no-op). Re-throw real failures (network/auth) so a
    // transient error is never silently treated as "already decided".
    if (
      err &&
      typeof err === "object" &&
      "statusCode" in err &&
      (err as { statusCode?: number }).statusCode === 409
    ) {
      return false;
    }
    throw err;
  }
}

/**
 * Promote a double-opt-in reservation from `unverified` to `pending`. Does
 * NOT set `decidedAt` (that belongs to approve/decline). Rev-guarded exactly
 * like `setReservationStatus`: a 409 is an idempotent no-op (returns false);
 * real errors re-throw.
 */
export async function markReservationVerified(id: string): Promise<boolean> {
  if (!writeClient) return false;
  const cur = await writeClient.fetch<{ _rev: string; status: string } | null>(
    `*[_type == "reservation" && _id == $id][0]{ _rev, status }`,
    { id },
  );
  if (!cur || cur.status !== "unverified") return false;
  try {
    await writeClient
      .patch(id)
      .ifRevisionId(cur._rev)
      .set({ status: "pending" })
      .commit();
    return true;
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "statusCode" in err &&
      (err as { statusCode?: number }).statusCode === 409
    ) {
      return false;
    }
    throw err;
  }
}

/**
 * Idempotently persist a paid public order. The deterministic
 * `_id = order.<stripeSessionId>` + `createIfNotExists` make duplicate
 * `checkout.session.completed` webhook deliveries a no-op. Returns false
 * when Sanity isn't configured (best-effort).
 */
export async function createOrder(rec: OrderRecord): Promise<boolean> {
  if (!writeClient) return false;
  await writeClient.createIfNotExists({
    _id: `order.${rec.stripeSessionId}`,
    _type: "order",
    stripeSessionId: rec.stripeSessionId,
    customerEmail: rec.customerEmail,
    ...(rec.customerName ? { customerName: rec.customerName } : {}),
    ...(rec.customerPhone ? { customerPhone: rec.customerPhone } : {}),
    ...(rec.dropId ? { drop: { _type: "reference", _ref: rec.dropId } } : {}),
    items: rec.items.map((i) => ({ _type: "orderItem", ...i })),
    subtotalCents: rec.subtotalCents,
    shippingCents: rec.shippingCents,
    totalCents: rec.totalCents,
    fulfillment: rec.fulfillment,
    ...(rec.shipState ? { shipState: rec.shipState } : {}),
    ...(rec.shipAddress ? { shipAddress: rec.shipAddress } : {}),
    livemode: rec.livemode,
    createdAt: rec.createdAt,
  });
  return true;
}

/**
 * Concurrency-safe fulfillment-stage transition. Verifies the doc is still at
 * `fromStatus` (and, for reservations, still `confirmed`), then patches with
 * `ifRevisionId`. Mirrors `setReservationStatus`: a 409 revision conflict is
 * an idempotent no-op (`{ ok:false, conflict:true }`); real errors re-throw.
 */
export async function setFulfillmentStatus(
  type: "order" | "reservation",
  id: string,
  fromStatus: string,
  toStatus: string,
): Promise<{ ok: boolean; conflict?: boolean }> {
  if (!writeClient) return { ok: false };
  const docType = type;
  const cur = await writeClient.fetch<
    { _rev: string; fulfillmentStatus?: string; status?: string } | null
  >(
    `*[_type == $docType && _id == $id][0]{ _rev, fulfillmentStatus, status }`,
    { docType, id },
  );
  if (!cur) return { ok: false };
  if (type === "reservation" && cur.status !== "confirmed") {
    return { ok: false };
  }
  const curStage = cur.fulfillmentStatus ?? "new";
  if (curStage !== fromStatus) return { ok: false, conflict: true };
  try {
    await writeClient
      .patch(id)
      .ifRevisionId(cur._rev)
      .set({ fulfillmentStatus: toStatus })
      .commit();
    return { ok: true };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "statusCode" in err &&
      (err as { statusCode?: number }).statusCode === 409
    ) {
      return { ok: false, conflict: true };
    }
    throw err;
  }
}

/**
 * Atomically claim one redemption of a promo code. Rev-guarded like
 * `setReservationStatus`: succeeds only while the doc is unchanged AND
 * `redeemedCount < maxRedemptions` AND `active`. Per the spec, NEVER throws
 * into callers — a 409 race or any error returns false (caller treats false
 * as "cap hit / not applied"); errors are logged.
 */
export async function redeemPromo(code: string): Promise<boolean> {
  if (!writeClient) return false;
  const norm = code.trim().toUpperCase();
  try {
    const all = await writeClient.fetch<
      {
        _id: string;
        _rev: string;
        code: string;
        maxRedemptions: number;
        redeemedCount?: number;
        active?: boolean;
      }[]
    >(`*[_type == "promoCode"]{ _id, _rev, code, maxRedemptions, redeemedCount, active }`);
    const p = all.find(
      (x) => (x.code ?? "").trim().toUpperCase() === norm,
    );
    if (!p) return false;
    const used = p.redeemedCount ?? 0;
    const cap = typeof p.maxRedemptions === "number" ? p.maxRedemptions : 0;
    if (p.active === false || used >= cap) return false;
    await writeClient
      .patch(p._id)
      .ifRevisionId(p._rev)
      .set({ redeemedCount: used + 1 })
      .commit();
    return true;
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "statusCode" in err &&
      (err as { statusCode?: number }).statusCode === 409
    ) {
      return false;
    }
    console.error("[promo] redeemPromo failed", err);
    return false;
  }
}
