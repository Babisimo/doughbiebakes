import type { FulfillmentStage } from "./fulfillment.ts";

export type BakeListItem = {
  productSlug: string;
  productName: string;
  quantity: number;
  /** Charged unit price in cents. Present on order/reservation items;
   * absent on member selections (used for favor math, optional everywhere). */
  priceCents?: number;
};

export type BakeOrderShipAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
};

/** A member's pick. `fulfillment`/`source` are optional because the
 * `memberSelection` doc/type leaves them optional; we coalesce. */
export type MemberSource = {
  customerEmail: string;
  productSlug: string;
  fulfillment?: "pickup" | "ship";
  source?: "explicit" | "default";
};

export type OrderSource = {
  id?: string;
  fulfillmentStatus?: FulfillmentStage;
  customerEmail: string;
  customerName?: string | null;
  customerPhone?: string | null;
  items: BakeListItem[];
  fulfillment: "pickup" | "ship";
  shipAddress?: BakeOrderShipAddress | null;
  totalCents: number;
};

export type ReservationSource = {
  id?: string;
  fulfillmentStatus?: FulfillmentStage;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  items: BakeListItem[];
  totalCents: number;
};

export type DropForBake = {
  lineItems: { product: { slug: string; name: string } }[];
};

export type BakeListInput = {
  drop: DropForBake;
  members: MemberSource[];
  orders: OrderSource[];
  reservations: ReservationSource[];
  pendingReservationCount: number;
};

export type BakeTotal = {
  slug: string;
  name: string;
  count: number;
  inDrop: boolean;
};

export type BakeMemberRow = {
  email: string;
  slug: string;
  productName: string;
  source: "explicit" | "default";
  fulfillment: "pickup" | "ship";
};

export type BakeOrderRow = {
  id: string;
  fulfillmentStatus: FulfillmentStage;
  email: string;
  name: string | null;
  phone: string | null;
  items: { slug: string; name: string; qty: number }[];
  fulfillment: "pickup" | "ship";
  shipAddress: BakeOrderShipAddress | null;
  totalCents: number;
};

export type BakeReservationRow = {
  id: string;
  fulfillmentStatus: FulfillmentStage;
  email: string;
  name: string;
  phone: string;
  items: { slug: string; name: string; qty: number }[];
  totalCents: number;
};

export type BakeListView = {
  totals: BakeTotal[];
  members: BakeMemberRow[];
  orders: BakeOrderRow[];
  reservations: BakeReservationRow[];
  pendingReservationCount: number;
  counts: { members: number; orders: number; reservations: number; loaves: number };
};

/**
 * Merge Bread Club member picks, live public orders, and confirmed
 * reservations into one per-drop bake tally plus per-source roster rows.
 * Pure: no I/O. The member person-name/contact is layered on by the page
 * (Stripe lookup) after this returns — this only carries the chosen flavor.
 */
export function buildBakeListView(input: BakeListInput): BakeListView {
  const { drop, members, orders, reservations, pendingReservationCount } = input;

  const dropNameBySlug = new Map<string, string>();
  const dropOrder = new Map<string, number>();
  drop.lineItems.forEach((li, i) => {
    if (!dropNameBySlug.has(li.product.slug)) {
      dropNameBySlug.set(li.product.slug, li.product.name);
      dropOrder.set(li.product.slug, i);
    }
  });

  const tally = new Map<string, BakeTotal>();

  const norm = (q: number) => {
    const n = Math.floor(Number.isFinite(q) ? q : 0);
    return n >= 1 ? n : 0;
  };

  const add = (slug: string, qty: number, fallbackName: string) => {
    const n = norm(qty);
    if (n === 0) return;
    const cur = tally.get(slug);
    if (cur) {
      cur.count += n;
      return;
    }
    tally.set(slug, {
      slug,
      name: dropNameBySlug.get(slug) ?? fallbackName ?? slug,
      count: n,
      inDrop: dropNameBySlug.has(slug),
    });
  };

  const memberRows: BakeMemberRow[] = members.map((m) => {
    add(m.productSlug, 1, m.productSlug);
    return {
      email: m.customerEmail,
      slug: m.productSlug,
      productName: dropNameBySlug.get(m.productSlug) ?? m.productSlug,
      source: m.source ?? "explicit",
      fulfillment: m.fulfillment ?? "pickup",
    };
  });

  const mapItems = (items: BakeListItem[]) =>
    items
      .map((it) => ({
        slug: it.productSlug,
        name: dropNameBySlug.get(it.productSlug) ?? it.productName ?? it.productSlug,
        qty: norm(it.quantity),
      }))
      .filter((it) => it.qty >= 1);

  const orderRows: BakeOrderRow[] = orders.map((o) => {
    for (const it of o.items) add(it.productSlug, it.quantity, it.productName);
    return {
      id: o.id ?? "",
      fulfillmentStatus: o.fulfillmentStatus ?? "new",
      email: o.customerEmail,
      name: o.customerName ?? null,
      phone: o.customerPhone ?? null,
      items: mapItems(o.items),
      fulfillment: o.fulfillment,
      shipAddress: o.shipAddress ?? null,
      totalCents: o.totalCents,
    };
  });

  const reservationRows: BakeReservationRow[] = reservations.map((r) => {
    for (const it of r.items) add(it.productSlug, it.quantity, it.productName);
    return {
      id: r.id ?? "",
      fulfillmentStatus: r.fulfillmentStatus ?? "new",
      email: r.customerEmail,
      name: r.customerName,
      phone: r.customerPhone,
      items: mapItems(r.items),
      totalCents: r.totalCents,
    };
  });

  const all = [...tally.values()];
  const totals: BakeTotal[] = [
    ...all
      .filter((t) => t.inDrop)
      .sort((a, b) => (dropOrder.get(a.slug) ?? 0) - (dropOrder.get(b.slug) ?? 0)),
    ...all.filter((t) => !t.inDrop),
  ];

  return {
    totals,
    members: memberRows,
    orders: orderRows,
    reservations: reservationRows,
    pendingReservationCount,
    counts: {
      members: memberRows.length,
      orders: orderRows.length,
      reservations: reservationRows.length,
      loaves: totals.reduce((s, t) => s + t.count, 0),
    },
  };
}
