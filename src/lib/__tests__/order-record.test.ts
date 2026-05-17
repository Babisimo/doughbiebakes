import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOrderRecord } from "../order-record.ts";

const LOOKUP = new Map([
  ["classic", { name: "Classic", priceCents: 1100 }],
  ["rye", { name: "Rye", priceCents: 1300 }],
]);

function input(over: Partial<Parameters<typeof buildOrderRecord>[0]> = {}) {
  return {
    stripeSessionId: "cs_test_1",
    customerEmail: "  Buyer@Example.com ",
    customerName: "Buyer",
    customerPhone: "+15205550100",
    dropId: "drop-1",
    sold: [{ slug: "classic", quantity: 2 }],
    productLookup: LOOKUP,
    subtotalCents: 2200,
    shippingCents: 0,
    totalCents: 2200,
    isPickup: true,
    shipState: null,
    shipAddress: null,
    livemode: false,
    createdAt: "2026-05-17T12:00:00.000Z",
    ...over,
  };
}

test("maps sold→items via lookup; lowercases email; pickup", () => {
  const r = buildOrderRecord(input());
  assert.ok(r);
  if (r) {
    assert.equal(r.customerEmail, "buyer@example.com");
    assert.equal(r.fulfillment, "pickup");
    assert.equal(r.dropId, "drop-1");
    assert.deepEqual(r.items, [
      { productSlug: "classic", productName: "Classic", quantity: 2, priceCents: 1100 },
    ]);
    assert.equal(r.totalCents, 2200);
    assert.equal(r.shipAddress, undefined);
  }
});

test("null when no email", () => {
  assert.equal(buildOrderRecord(input({ customerEmail: "  " })), null);
});

test("null when no resolvable items", () => {
  assert.equal(
    buildOrderRecord(input({ sold: [{ slug: "ghost", quantity: 1 }] })),
    null,
  );
});

test("ship keeps shipAddress + shipState; pickup drops them", () => {
  const ship = buildOrderRecord(
    input({
      isPickup: false,
      shipState: "CA",
      shipAddress: { line1: "1 A St", city: "Corona", state: "CA", postalCode: "92879" },
    }),
  );
  assert.ok(ship);
  if (ship) {
    assert.equal(ship.fulfillment, "ship");
    assert.equal(ship.shipState, "CA");
    assert.equal(ship.shipAddress?.postalCode, "92879");
  }
  const pickup = buildOrderRecord(
    input({ isPickup: true, shipAddress: { line1: "x" }, shipState: "CA" }),
  );
  assert.ok(pickup);
  if (pickup) {
    assert.equal(pickup.shipAddress, undefined);
    assert.equal(pickup.shipState, "CA"); // shipState kept even for pickup (billing state)
  }
});

test("omits optional fields when absent; normalizes qty/amounts; passthrough livemode", () => {
  const r = buildOrderRecord(
    input({
      customerName: null,
      customerPhone: null,
      dropId: null,
      sold: [{ slug: "rye", quantity: 0 }],
      subtotalCents: -5,
      livemode: true,
    }),
  );
  assert.ok(r);
  if (r) {
    assert.equal("customerName" in r, false);
    assert.equal("customerPhone" in r, false);
    assert.equal("dropId" in r, false);
    assert.equal(r.items[0].quantity, 1); // floored to min 1
    assert.equal(r.subtotalCents, 0); // clamped min 0
    assert.equal(r.livemode, true);
  }
});
