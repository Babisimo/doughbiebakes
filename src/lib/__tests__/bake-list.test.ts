import assert from "node:assert/strict";
import { test } from "node:test";

import { buildBakeListView } from "../bake-list.ts";

const drop = {
  lineItems: [
    { product: { slug: "classic", name: "Classic Sourdough" } },
    { product: { slug: "jalapeno", name: "Jalapeño Cheddar" } },
    { product: { slug: "rosemary", name: "Rosemary" } },
  ],
};

function base(over: Partial<Parameters<typeof buildBakeListView>[0]> = {}) {
  return {
    drop,
    members: [],
    orders: [],
    reservations: [],
    pendingReservationCount: 0,
    ...over,
  };
}

test("combines tally across members + orders + confirmed reservations", () => {
  const v = buildBakeListView(
    base({
      members: [
        { customerEmail: "a@x.com", productSlug: "classic", source: "explicit", fulfillment: "pickup" },
        { customerEmail: "b@x.com", productSlug: "classic", source: "explicit", fulfillment: "ship" },
      ],
      orders: [
        {
          customerEmail: "c@x.com",
          customerName: "Cee",
          customerPhone: "555",
          items: [{ productSlug: "classic", productName: "Classic Sourdough", quantity: 3 }],
          fulfillment: "ship",
          shipAddress: null,
          totalCents: 3300,
        },
      ],
      reservations: [
        {
          customerEmail: "d@x.com",
          customerName: "Dee",
          customerPhone: "556",
          items: [{ productSlug: "jalapeno", productName: "Jalapeño Cheddar", quantity: 2 }],
          totalCents: 2400,
        },
      ],
    }),
  );
  assert.equal(v.totals.find((t) => t.slug === "classic")?.count, 5);
  assert.equal(v.totals.find((t) => t.slug === "jalapeno")?.count, 2);
  assert.equal(v.counts.loaves, 7);
  assert.equal(v.counts.members, 2);
  assert.equal(v.counts.orders, 1);
  assert.equal(v.counts.reservations, 1);
});

test("tally sums quantities, not row counts", () => {
  const v = buildBakeListView(
    base({
      orders: [
        {
          customerEmail: "c@x.com",
          customerName: null,
          customerPhone: null,
          items: [{ productSlug: "rosemary", productName: "Rosemary", quantity: 4 }],
          fulfillment: "pickup",
          shipAddress: null,
          totalCents: 4400,
        },
      ],
    }),
  );
  assert.equal(v.totals.find((t) => t.slug === "rosemary")?.count, 4);
});

test("synthetic default member picks count toward the tally", () => {
  const v = buildBakeListView(
    base({
      members: [{ customerEmail: "z@x.com", productSlug: "classic", source: "default" }],
    }),
  );
  assert.equal(v.totals.find((t) => t.slug === "classic")?.count, 1);
  assert.equal(v.members[0].source, "default");
  assert.equal(v.members[0].fulfillment, "pickup");
});

test("slug not in drop → inDrop:false, name from productName, ordered after drop items", () => {
  const v = buildBakeListView(
    base({
      members: [{ customerEmail: "a@x.com", productSlug: "classic", source: "explicit" }],
      orders: [
        {
          customerEmail: "c@x.com",
          customerName: "Cee",
          customerPhone: "555",
          items: [{ productSlug: "ghost", productName: "Ghost Loaf", quantity: 1 }],
          fulfillment: "pickup",
          shipAddress: null,
          totalCents: 1000,
        },
      ],
    }),
  );
  const ghost = v.totals.find((t) => t.slug === "ghost");
  assert.equal(ghost?.inDrop, false);
  assert.equal(ghost?.name, "Ghost Loaf");
  assert.equal(v.totals[0].slug, "classic");
  assert.equal(v.totals[v.totals.length - 1].slug, "ghost");
});

test("qty <= 0 and non-integer are floored/dropped (tally and row)", () => {
  const v = buildBakeListView(
    base({
      orders: [
        {
          customerEmail: "c@x.com",
          customerName: "Cee",
          customerPhone: "555",
          items: [
            { productSlug: "classic", productName: "Classic Sourdough", quantity: 0 },
            { productSlug: "rosemary", productName: "Rosemary", quantity: 2.5 },
          ],
          fulfillment: "pickup",
          shipAddress: null,
          totalCents: 0,
        },
      ],
    }),
  );
  assert.equal(v.totals.find((t) => t.slug === "classic"), undefined);
  assert.equal(v.totals.find((t) => t.slug === "rosemary")?.count, 2);
  assert.deepEqual(v.orders[0].items.map((i) => i.slug), ["rosemary"]);
});

test("empty sources → empty totals, zeroed counts, pending passthrough", () => {
  const v = buildBakeListView(base({ pendingReservationCount: 3 }));
  assert.deepEqual(v.totals, []);
  assert.equal(v.counts.loaves, 0);
  assert.equal(v.counts.members, 0);
  assert.equal(v.counts.orders, 0);
  assert.equal(v.counts.reservations, 0);
  assert.equal(v.pendingReservationCount, 3);
});

test("no dedup across sources — same email as member and order both count", () => {
  const v = buildBakeListView(
    base({
      members: [{ customerEmail: "same@x.com", productSlug: "classic", source: "explicit" }],
      orders: [
        {
          customerEmail: "same@x.com",
          customerName: "Same",
          customerPhone: "555",
          items: [{ productSlug: "classic", productName: "Classic Sourdough", quantity: 2 }],
          fulfillment: "pickup",
          shipAddress: null,
          totalCents: 2200,
        },
      ],
    }),
  );
  assert.equal(v.totals.find((t) => t.slug === "classic")?.count, 3);
  assert.equal(v.members.length, 1);
  assert.equal(v.orders.length, 1);
});
