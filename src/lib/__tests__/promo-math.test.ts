import assert from "node:assert/strict";
import { test } from "node:test";

import { discountCents, discountedTotalCents } from "../promo-math.ts";

test("discountCents rounds to whole cents", () => {
  assert.equal(discountCents(2200, 15), 330);
  assert.equal(discountCents(1100, 15), 165);
});

test("discountedTotalCents subtracts the rounded discount", () => {
  assert.equal(discountedTotalCents(2200, 15), 1870);
  assert.equal(discountedTotalCents(0, 15), 0);
});
