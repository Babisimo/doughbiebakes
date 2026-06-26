import assert from "node:assert/strict";
import { test } from "node:test";

import {
  actualFavorsCents,
  computeSaleTotals,
  effectiveListCents,
  favorLines,
  reservationCollectedCents,
  type FavorSource,
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

test("effectiveListCents: no sale returns the list price unchanged", () => {
  assert.equal(effectiveListCents(1200, 0), 1200);
  assert.equal(effectiveListCents(1200, undefined), 1200);
  assert.equal(effectiveListCents(1200, null), 1200);
});

test("effectiveListCents: a flash percent marks the baseline down", () => {
  // $12 at 15% off => $10.20 going price.
  assert.equal(effectiveListCents(1200, 15), 1020);
  assert.equal(effectiveListCents(1000, 20), 800);
});

test("actualFavorsCents: a free favor during a sale is valued at the sale price", () => {
  const list = new Map([["banana", 1200]]);
  // Free loaf during a 15% sale => favor is $10.20, not the full $12.
  const sources: SoldSource[] = [
    { promoPercentOff: 15, items: [{ productSlug: "banana", quantity: 1, priceCents: 0 }] },
  ];
  assert.equal(actualFavorsCents(sources, list), 1020);
});

test("actualFavorsCents: paying the sale price is not a favor", () => {
  const list = new Map([["pepperoni", 1200]]);
  // Charged the sale price ($10.20) during a 15% sale => no favor.
  const sources: SoldSource[] = [
    { promoPercentOff: 15, items: [{ productSlug: "pepperoni", quantity: 1, priceCents: 1020 }] },
  ];
  assert.equal(actualFavorsCents(sources, list), 0);
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

test("favorLines: two buyers of one loaf at different prices → two lines, biggest first", () => {
  const list = new Map([["classic", 1200]]);
  const lines = favorLines(
    [
      { who: "Maria", items: [{ productSlug: "classic", productName: "Classic", quantity: 1, priceCents: 1000 }] },
      { who: "Babo", items: [{ productSlug: "classic", productName: "Classic", quantity: 1, priceCents: 0 }] },
    ],
    list,
  );
  assert.equal(lines.length, 2);
  assert.deepEqual(
    { who: lines[0].who, favor: lines[0].favorCents, charged: lines[0].chargedCents, list: lines[0].listCents },
    { who: "Babo", favor: 1200, charged: 0, list: 1200 },
  );
  assert.equal(lines[1].who, "Maria");
  assert.equal(lines[1].favorCents, 200);
});

test("favorLines: during a sale, the line's favor + baseline use the sale price", () => {
  const list = new Map([["banana", 1200]]);
  const lines = favorLines(
    [
      {
        who: "Victoria",
        promoPercentOff: 15,
        items: [{ productSlug: "banana", productName: "Banana", quantity: 1, priceCents: 0 }],
      },
    ],
    list,
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].favorCents, 1020); // $10.20, the sale-price giveaway
  assert.equal(lines[0].listCents, 1020); // baseline shown is the sale price
});

test("favorLines: full-price and above-list items produce no line", () => {
  const list = new Map([["classic", 1200]]);
  const lines = favorLines(
    [
      { who: "A", items: [{ productSlug: "classic", productName: "Classic", quantity: 1, priceCents: 1200 }] },
      { who: "B", items: [{ productSlug: "classic", productName: "Classic", quantity: 1, priceCents: 1500 }] },
    ],
    list,
  );
  assert.equal(lines.length, 0);
});

test("favorLines: unknown list price or missing charged price are skipped", () => {
  const list = new Map([["classic", 1200]]);
  const lines = favorLines(
    [
      { who: "A", items: [{ productSlug: "mystery", productName: "?", quantity: 1, priceCents: 0 }] },
      { who: "B", items: [{ productSlug: "classic", productName: "Classic", quantity: 1 }] },
    ],
    list,
  );
  assert.equal(lines.length, 0);
});

test("favorLines: $0 comp → one line with favor = qty × list; quantity respected", () => {
  const list = new Map([["classic", 1200]]);
  const lines = favorLines(
    [{ who: "Babo", items: [{ productSlug: "classic", productName: "Classic", quantity: 2, priceCents: 0 }] }],
    list,
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].quantity, 2);
  assert.equal(lines[0].favorCents, 2400);
});

test("favorLines: productName falls back to slug when absent", () => {
  const list = new Map([["classic", 1200]]);
  const lines = favorLines([{ who: "A", items: [{ productSlug: "classic", quantity: 1, priceCents: 1000 }] }], list);
  assert.equal(lines[0].productName, "classic");
});

test("favorLines: line favors sum to actualFavorsCents for the same input", () => {
  const list = new Map([["classic", 1200], ["rye", 1000]]);
  const sources: FavorSource[] = [
    {
      who: "A",
      items: [
        { productSlug: "classic", productName: "Classic", quantity: 2, priceCents: 1000 },
        { productSlug: "rye", productName: "Rye", quantity: 1, priceCents: 1000 },
      ],
    },
    { who: "B", items: [{ productSlug: "classic", productName: "Classic", quantity: 1, priceCents: 0 }] },
  ];
  const sum = favorLines(sources, list).reduce((s, l) => s + l.favorCents, 0);
  assert.equal(sum, actualFavorsCents(sources, list));
});
