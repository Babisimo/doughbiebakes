import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveDiscount } from "../flash-sale.ts";

test("none when both zero", () => {
  assert.deepEqual(resolveDiscount({ flashPercent: 0, promoPercent: 0 }), {
    percentOff: 0,
    source: "none",
  });
});

test("flash only", () => {
  assert.deepEqual(resolveDiscount({ flashPercent: 20, promoPercent: 0 }), {
    percentOff: 20,
    source: "flash",
    label: "Flash Sale −20%",
  });
});

test("promo only", () => {
  assert.deepEqual(resolveDiscount({ flashPercent: 0, promoPercent: 15 }), {
    percentOff: 15,
    source: "promo",
  });
});

test("larger wins — promo", () => {
  const r = resolveDiscount({ flashPercent: 10, promoPercent: 25 });
  assert.equal(r.source, "promo");
  assert.equal(r.percentOff, 25);
});

test("larger wins — flash", () => {
  const r = resolveDiscount({ flashPercent: 30, promoPercent: 25 });
  assert.equal(r.source, "flash");
  assert.equal(r.percentOff, 30);
  assert.equal(r.label, "Flash Sale −30%");
});

test("tie resolves to flash (no code needed)", () => {
  const r = resolveDiscount({ flashPercent: 20, promoPercent: 20 });
  assert.equal(r.source, "flash");
  assert.equal(r.percentOff, 20);
});

test("label only set for flash source", () => {
  assert.equal(resolveDiscount({ flashPercent: 0, promoPercent: 15 }).label, undefined);
  assert.equal(resolveDiscount({ flashPercent: 0, promoPercent: 0 }).label, undefined);
});
