import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateReservation } from "../reservation-eval.ts";
import type { Drop } from "../types.ts";

const NOW = new Date("2026-05-17T12:00:00.000Z");
const FUTURE = "2026-05-24T12:00:00.000Z";

function product(slug: string, priceCents: number) {
  return { id: slug, slug, name: slug.toUpperCase(), priceCents, available: true };
}
function drop(over: Partial<Drop> = {}): Drop {
  return {
    id: "d1",
    slug: "d1",
    title: "Test Drop",
    status: "open",
    ordersCloseAt: FUTURE,
    lineItems: [
      { product: product("classic", 1100), quantity: 3 },
      { product: product("rye", 1300), quantity: 0 },
    ],
    ...over,
  };
}

test("ok: prices and totals an in-stock request", () => {
  const r = evaluateReservation(drop(), [], [{ slug: "classic", quantity: 2 }], NOW);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.totalCents, 2200);
    assert.deepEqual(r.items, [
      { productSlug: "classic", productName: "CLASSIC", quantity: 2, priceCents: 1100 },
    ]);
  }
});

test("empty cart rejected", () => {
  const r = evaluateReservation(drop(), [], [], NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "empty");
});

test("drop not open rejected", () => {
  const r = evaluateReservation(drop({ status: "draft" }), [], [{ slug: "classic", quantity: 1 }], NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "not-open");
});

test("not in drop rejected", () => {
  const r = evaluateReservation(drop(), [], [{ slug: "ghost", quantity: 1 }], NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "not-in-drop");
});

test("sold out rejected", () => {
  const r = evaluateReservation(drop(), [], [{ slug: "rye", quantity: 1 }], NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "soldout");
});

test("qty over remaining rejected", () => {
  const r = evaluateReservation(drop(), [], [{ slug: "classic", quantity: 9 }], NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "qty-exceeded");
});

test("null drop rejected as not-open", () => {
  const r = evaluateReservation(null, [], [{ slug: "classic", quantity: 1 }], NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "not-open");
});
