import type { Product } from "./types";

/** One week in milliseconds. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pick the "loaf of the week" for the hero — rotating once per week, and
 * preferring loaves that actually have a photo (a hero card with a missing
 * image looks broken). Deterministic for a given week so every request in
 * the same week shows the same loaf, then it advances on its own.
 *
 * Candidates are sorted by slug so the rotation order is stable regardless of
 * the order products come back from Sanity. Falls back to the full list when
 * no product has an image, and to `null` only when there are no products.
 */
export function pickWeeklyFeatured(
  products: Product[],
  now: Date = new Date(),
): Product | null {
  if (products.length === 0) return null;
  const withImages = products.filter((p) => Boolean(p.imageUrl));
  const pool = (withImages.length > 0 ? withImages : products)
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const week = Math.floor(now.getTime() / WEEK_MS);
  // `((n % len) + len) % len` keeps the index non-negative for any week value.
  return pool[((week % pool.length) + pool.length) % pool.length];
}
