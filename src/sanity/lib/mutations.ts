import "server-only";

import { createClient } from "next-sanity";

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
 * Best-effort: decrement the available quantities on the current open drop
 * after a paid order, and flip status to "soldout" when nothing is left.
 *
 * IMPORTANT: we patch only each line item's `quantity`, addressed by its
 * array `_key`. We must never write `product` back — the query below
 * dereferences it (`product->{ … }`), so re-setting the whole `lineItems`
 * array would replace each reference with a malformed object and corrupt the
 * drop (Sanity then rejects every Studio save with `Key "slug" not allowed in
 * ref`). Keyed quantity patches leave `product` and every other field intact.
 * Fine for the low-volume Cottage Food scale; revisit with optimistic locking
 * if you grow.
 */
export async function applyOrderToActiveDrop(items: SoldItem[]): Promise<void> {
  if (!writeClient || items.length === 0) return;

  const drop = await writeClient.fetch<{
    _id: string;
    lineItems?: { _key: string; quantity?: number; product?: { slug?: { current?: string } } }[];
  } | null>(
    `*[_type == "drop" && status == "open"] | order(pickupOrShipDate asc)[0]{
      _id, "lineItems": lineItems[]{ _key, quantity, "product": product->{ "slug": slug } }
    }`,
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
