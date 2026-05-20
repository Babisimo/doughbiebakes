export type OrderItemRecord = {
  productSlug: string;
  productName: string;
  quantity: number;
  priceCents: number;
};

export type OrderShipAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
};

export type OrderRecord = {
  stripeSessionId: string;
  customerEmail: string;
  customerName?: string;
  customerPhone?: string;
  dropId?: string;
  items: OrderItemRecord[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  /** Founding promo code applied, if any. */
  promoCode?: string;
  /** Discount taken off the order, in cents (0/absent when no promo). */
  discountCents?: number;
  fulfillment: "pickup" | "ship";
  shipState?: string;
  shipAddress?: OrderShipAddress;
  livemode: boolean;
  createdAt: string;
};

export type BuildOrderInput = {
  stripeSessionId: string;
  customerEmail: string | null | undefined;
  customerName?: string | null;
  customerPhone?: string | null;
  dropId?: string | null;
  sold: { slug: string; quantity: number }[];
  productLookup: Map<string, { name: string; priceCents: number }>;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  promoCode?: string | null;
  discountCents?: number;
  isPickup: boolean;
  shipState?: string | null;
  shipAddress?: OrderShipAddress | null;
  livemode: boolean;
  createdAt: string;
};

const cents = (n: number) => Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));

/**
 * Pure: shape a paid Stripe session (raw values extracted by the webhook)
 * into an `order` doc record. Returns null when there's no customer email
 * or no resolvable items — the caller logs + skips rather than writing a
 * malformed doc.
 */
export function buildOrderRecord(input: BuildOrderInput): OrderRecord | null {
  const email = input.customerEmail?.trim().toLowerCase();
  if (!email) return null;

  const items: OrderItemRecord[] = [];
  for (const s of input.sold) {
    const p = input.productLookup.get(s.slug);
    if (!p) continue;
    const quantity = Math.floor(s.quantity);
    if (quantity <= 0) continue; // never fabricate a unit from a 0/neg qty
    items.push({
      productSlug: s.slug,
      productName: p.name,
      quantity,
      priceCents: cents(p.priceCents),
    });
  }
  if (items.length === 0) return null;

  const rec: OrderRecord = {
    stripeSessionId: input.stripeSessionId,
    customerEmail: email,
    items,
    subtotalCents: cents(input.subtotalCents),
    shippingCents: cents(input.shippingCents),
    totalCents: cents(input.totalCents),
    fulfillment: input.isPickup ? "pickup" : "ship",
    livemode: input.livemode,
    createdAt: input.createdAt,
  };
  if (input.customerName) rec.customerName = input.customerName;
  if (input.customerPhone) rec.customerPhone = input.customerPhone;
  if (input.dropId) rec.dropId = input.dropId;
  if (input.promoCode) rec.promoCode = input.promoCode;
  if (input.discountCents && input.discountCents > 0) {
    rec.discountCents = cents(input.discountCents);
  }
  if (input.shipState) rec.shipState = input.shipState;
  if (!input.isPickup && input.shipAddress) rec.shipAddress = input.shipAddress;
  return rec;
}
