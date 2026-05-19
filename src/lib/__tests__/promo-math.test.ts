import assert from "node:assert/strict";
import { test } from "node:test";

import {
  discountCents,
  discountedTotalCents,
  discountedUnitCents,
} from "../promo-math.ts";

test("discountCents rounds to whole cents", () => {
  assert.equal(discountCents(2200, 15), 330);
  assert.equal(discountCents(1100, 15), 165);
});

test("discountedTotalCents subtracts the rounded discount", () => {
  assert.equal(discountedTotalCents(2200, 15), 1870);
  assert.equal(discountedTotalCents(0, 15), 0);
});

test("discountedUnitCents never goes below 1 cent", () => {
  assert.equal(discountedUnitCents(1100, 15), 935);
  assert.equal(discountedUnitCents(1, 15), 1);
  assert.equal(discountedUnitCents(100, 100), 1);
});
