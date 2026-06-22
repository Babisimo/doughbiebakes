/**
 * Pure validation/normalization for the reservation "amend pricing" request
 * body. No I/O. Integer cents in, integer cents out. The route layer turns a
 * failure into a 400 and a success into a Sanity patch.
 */

export type AmendItem = {
  productSlug: string;
  productName: string;
  quantity: number;
  priceCents: number;
  listPriceCents: number;
};

export type AmendInput = {
  items?: AmendItem[];
  collectedCents?: number | null;
};

const int = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : NaN;
};

export function parseAmendBody(
  body: unknown,
): { ok: true; value: AmendInput } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid body." };
  }
  const b = body as Record<string, unknown>;
  const value: AmendInput = {};

  if ("items" in b && b.items !== undefined) {
    if (!Array.isArray(b.items) || b.items.length === 0) {
      return { ok: false, error: "Provide at least one item." };
    }
    const items: AmendItem[] = [];
    for (const raw of b.items) {
      const o = (raw ?? {}) as Record<string, unknown>;
      const productSlug = typeof o.productSlug === "string" ? o.productSlug : "";
      const productName = typeof o.productName === "string" ? o.productName : "";
      const quantity = int(o.quantity);
      const priceCents = int(o.priceCents);
      const listPriceCents = int(o.listPriceCents);
      if (!productSlug || !(quantity >= 1) || !(priceCents >= 0) || !(listPriceCents >= 0)) {
        return { ok: false, error: "An item has an invalid slug, quantity, or price." };
      }
      items.push({ productSlug, productName, quantity, priceCents, listPriceCents });
    }
    value.items = items;
  }

  if ("collectedCents" in b && b.collectedCents !== undefined) {
    if (b.collectedCents === null) {
      value.collectedCents = null;
    } else {
      const c = int(b.collectedCents);
      if (!(c >= 0)) return { ok: false, error: "Collected amount can't be negative." };
      value.collectedCents = c;
    }
  }

  if (value.items === undefined && value.collectedCents === undefined) {
    return { ok: false, error: "Nothing to update." };
  }
  return { ok: true, value };
}
