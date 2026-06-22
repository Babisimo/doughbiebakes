import assert from "node:assert/strict";
import { test } from "node:test";

import { parseAmendBody } from "./reservation-amend.ts";

const item = (over = {}) => ({
  productSlug: "classic",
  productName: "Classic",
  quantity: 1,
  priceCents: 1200,
  listPriceCents: 1200,
  ...over,
});

test("rejects a non-object body", () => {
  assert.equal(parseAmendBody(null).ok, false);
  assert.equal(parseAmendBody("x").ok, false);
});

test("rejects when nothing is being updated", () => {
  const r = parseAmendBody({});
  assert.equal(r.ok, false);
});

test("parses an items-only amend, coercing ints", () => {
  const r = parseAmendBody({ items: [item({ priceCents: 1000.4, quantity: 2 })] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value.items, [
    { productSlug: "classic", productName: "Classic", quantity: 2, priceCents: 1000, listPriceCents: 1200 },
  ]);
  assert.equal(r.value.collectedCents, undefined);
});

test("parses a $0 price (own bread)", () => {
  const r = parseAmendBody({ items: [item({ priceCents: 0 })] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.items?.[0].priceCents, 0);
});

test("rejects bad items (empty slug, qty<1, negative price)", () => {
  assert.equal(parseAmendBody({ items: [] }).ok, false);
  assert.equal(parseAmendBody({ items: [item({ productSlug: "" })] }).ok, false);
  assert.equal(parseAmendBody({ items: [item({ quantity: 0 })] }).ok, false);
  assert.equal(parseAmendBody({ items: [item({ priceCents: -1 })] }).ok, false);
});

test("parses collectedCents override and null (clear)", () => {
  const set = parseAmendBody({ collectedCents: 999.6 });
  assert.equal(set.ok, true);
  if (set.ok) assert.equal(set.value.collectedCents, 1000);

  const clear = parseAmendBody({ collectedCents: null });
  assert.equal(clear.ok, true);
  if (clear.ok) assert.equal(clear.value.collectedCents, null);
});

test("rejects a negative collectedCents", () => {
  assert.equal(parseAmendBody({ collectedCents: -5 }).ok, false);
});
