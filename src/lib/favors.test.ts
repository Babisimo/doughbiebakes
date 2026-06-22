import assert from "node:assert/strict";
import { test } from "node:test";

import {
  actualFavorsCents,
  computeSaleTotals,
  reservationCollectedCents,
  type SaleLineInput,
  type SoldSource,
} from "./favors.ts";

function sale(over: Partial<SaleLineInput> = {}): SaleLineInput {
  return {
    productSlug: over.productSlug ?? "classic",
    productName: over.productName ?? "Classic",
    quantity: over.quantity ?? 1,
    priceCents: over.priceCents ?? 1200,
    listPriceCents: over.listPriceCents ?? 1200,
    ...over,
  };
}

test("computeSaleTotals: full price has no favor", () => {
  const r = computeSaleTotals([sale({ quantity: 2, priceCents: 1200, listPriceCents: 1200 })]);
  assert.equal(r.totalCents, 2400);
  assert.equal(r.favorsCents, 0);
});

test("computeSaleTotals: charging below list records a favor", () => {
  // 1 @ $12 (list $12) + 1 @ $10 (list $12) = $22 collected, $2 favor.
  const r = computeSaleTotals([
    sale({ quantity: 1, priceCents: 1200, listPriceCents: 1200 }),
    sale({ quantity: 1, priceCents: 1000, listPriceCents: 1200 }),
  ]);
  assert.equal(r.totalCents, 2200);
  assert.equal(r.favorsCents, 200);
});

test("computeSaleTotals: above-list never makes a negative favor", () => {
  const r = computeSaleTotals([sale({ quantity: 1, priceCents: 1500, listPriceCents: 1200 })]);
  assert.equal(r.totalCents, 1500);
  assert.equal(r.favorsCents, 0);
});

test("actualFavorsCents: sums (list - charged) x qty across sources", () => {
  const listBySlug = new Map([["classic", 1200], ["rye", 1000]]);
  const sources: SoldSource[] = [
    { items: [{ productSlug: "classic", quantity: 1, priceCents: 1000 }] }, // $2 favor
    { items: [{ productSlug: "classic", quantity: 2, priceCents: 1200 }] }, // $0
    { items: [{ productSlug: "rye", quantity: 1, priceCents: 800 }] },      // $2 favor
  ];
  assert.equal(actualFavorsCents(sources, listBySlug), 400);
});

test("actualFavorsCents: skips items with no price or unknown slug", () => {
  const listBySlug = new Map([["classic", 1200]]);
  const sources: SoldSource[] = [
    { items: [{ productSlug: "classic", quantity: 1 }] },            // no priceCents -> skip
    { items: [{ productSlug: "ghost", quantity: 1, priceCents: 1 }] }, // unknown slug -> skip
  ];
  assert.equal(actualFavorsCents(sources, listBySlug), 0);
});

test("computeSaleTotals: a loaf reserved for yourself at $0 is a full-list favor", () => {
  const r = computeSaleTotals([sale({ quantity: 1, priceCents: 0, listPriceCents: 1200 })]);
  assert.equal(r.totalCents, 0);
  assert.equal(r.favorsCents, 1200);
});

test("reservationCollectedCents: falls back to totalCents when no override", () => {
  assert.equal(reservationCollectedCents({ totalCents: 1200 }), 1200);
  assert.equal(reservationCollectedCents({ totalCents: 1200, collectedCents: undefined }), 1200);
  assert.equal(reservationCollectedCents({ totalCents: 1200, collectedCents: null }), 1200);
});

test("reservationCollectedCents: uses the override when present (incl. 0)", () => {
  assert.equal(reservationCollectedCents({ totalCents: 1200, collectedCents: 1000 }), 1000);
  assert.equal(reservationCollectedCents({ totalCents: 1200, collectedCents: 0 }), 0);
});
