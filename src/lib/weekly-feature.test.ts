import assert from "node:assert/strict";
import { test } from "node:test";

import type { Product } from "./types";
import { pickWeeklyFeatured } from "./weekly-feature.ts";

function product(slug: string, withImage: boolean): Product {
  return {
    id: slug,
    slug,
    name: slug,
    priceCents: 1000,
    available: true,
    imageUrl: withImage ? `/img/${slug}.jpg` : undefined,
  };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const atWeek = (week: number) => new Date(week * WEEK_MS + 1000);

test("returns null when there are no products", () => {
  assert.equal(pickWeeklyFeatured([], new Date()), null);
});

test("only ever picks loaves that have an image when some do", () => {
  const products = [
    product("a", true),
    product("b", false),
    product("c", true),
  ];
  for (let week = 0; week < 12; week++) {
    const picked = pickWeeklyFeatured(products, atWeek(week));
    assert.ok(picked && picked.imageUrl, `week ${week} picked an imageless loaf`);
  }
});

test("rotation is stable within a week and advances across weeks", () => {
  const products = [product("a", true), product("c", true)];
  // Same week → same loaf on repeated calls.
  assert.equal(
    pickWeeklyFeatured(products, atWeek(5))?.slug,
    pickWeeklyFeatured(products, atWeek(5))?.slug,
  );
  // Two adjacent weeks land on different loaves (pool of 2).
  assert.notEqual(
    pickWeeklyFeatured(products, atWeek(5))?.slug,
    pickWeeklyFeatured(products, atWeek(6))?.slug,
  );
  // Order is slug-stable regardless of input order.
  assert.equal(
    pickWeeklyFeatured(products, atWeek(7))?.slug,
    pickWeeklyFeatured([...products].reverse(), atWeek(7))?.slug,
  );
});

test("falls back to imageless products only when none have images", () => {
  const products = [product("a", false), product("b", false)];
  const picked = pickWeeklyFeatured(products, atWeek(3));
  assert.ok(picked);
  assert.equal(picked.imageUrl, undefined);
});
