import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cToF,
  estimateFermentation,
  fToC,
  formatHours,
  recommendedForTemp,
  STANDARD_STARTER_PCT,
  starterTimeMultiplier,
} from "../fermentation-math.ts";

test("recommendedForTemp returns exact guide rows", () => {
  assert.deepEqual(recommendedForTemp(77), { hours: 6, risePct: 40 });
  assert.deepEqual(recommendedForTemp(70), { hours: 12, risePct: 75 });
  assert.deepEqual(recommendedForTemp(80), { hours: 5.5, risePct: 30 });
  assert.deepEqual(recommendedForTemp(65), { hours: 16.5, risePct: 100 });
});

test("recommendedForTemp interpolates between rows", () => {
  // Halfway between 70°F (75% / 12h) and 71°F (70% / 11h).
  const r = recommendedForTemp(70.5);
  assert.equal(r.risePct, 72.5);
  assert.equal(r.hours, 11.5);
});

test("recommendedForTemp clamps outside the 65–80°F table", () => {
  assert.deepEqual(recommendedForTemp(90), { hours: 5.5, risePct: 30 });
  assert.deepEqual(recommendedForTemp(55), { hours: 16.5, risePct: 100 });
});

test("default target uses the recommended rise, and matches table at 20% starter", () => {
  const e = estimateFermentation({ tempF: 77 });
  assert.equal(e.targetRisePct, 40);
  assert.equal(e.recommendedRisePct, 40);
  assert.equal(e.recommendedHours, 6);
  // target == recommended and starter == 20 → no curve/starter adjustment.
  assert.ok(Math.abs(e.hours - 6) < 1e-9);
  assert.equal(e.proofState, "on-target");
  assert.equal(e.outOfRange, false);
});

test("the original question: 75% rise at 77°F, 20% starter is past the pull point", () => {
  const e = estimateFermentation({ tempF: 77, targetRisePct: 75, starterPct: 20 });
  assert.equal(e.proofState, "over"); // recommended pull is 40% at this temp
  // Accelerating curve: ~6h · (75/40)^(1/3) ≈ 7.4h.
  assert.ok(e.hours > 7 && e.hours < 8, `expected ~7.4h, got ${e.hours}`);
});

test("proof state classifies under / on-target / over relative to the recommendation", () => {
  assert.equal(estimateFermentation({ tempF: 77, targetRisePct: 25 }).proofState, "under");
  assert.equal(estimateFermentation({ tempF: 77, targetRisePct: 40 }).proofState, "on-target");
  assert.equal(estimateFermentation({ tempF: 77, targetRisePct: 75 }).proofState, "over");
});

test("a higher target rise takes longer; a lower target takes less", () => {
  const base = estimateFermentation({ tempF: 75, targetRisePct: 50 }).hours;
  const more = estimateFermentation({ tempF: 75, targetRisePct: 80 }).hours;
  const less = estimateFermentation({ tempF: 75, targetRisePct: 30 }).hours;
  assert.ok(more > base);
  assert.ok(less < base);
});

test("starter multiplier: 20% is neutral, weaker is slower, stronger is faster", () => {
  assert.ok(Math.abs(starterTimeMultiplier(STANDARD_STARTER_PCT) - 1) < 1e-9);
  assert.ok(starterTimeMultiplier(10) > 1);
  assert.ok(starterTimeMultiplier(40) < 1);
  // monotonic: less starter → larger multiplier
  assert.ok(starterTimeMultiplier(10) > starterTimeMultiplier(30));
});

test("more starter shortens the estimate", () => {
  const slow = estimateFermentation({ tempF: 75, starterPct: 10 }).hours;
  const fast = estimateFermentation({ tempF: 75, starterPct: 40 }).hours;
  assert.ok(fast < slow);
});

test("outOfRange flags temperatures beyond the guide", () => {
  assert.equal(estimateFermentation({ tempF: 84 }).outOfRange, true);
  assert.equal(estimateFermentation({ tempF: 62 }).outOfRange, true);
  assert.equal(estimateFermentation({ tempF: 72 }).outOfRange, false);
});

test("temperature conversions round-trip", () => {
  assert.ok(Math.abs(fToC(77) - 25) < 1e-9);
  assert.ok(Math.abs(cToF(25) - 77) < 1e-9);
  assert.ok(Math.abs(cToF(fToC(73.4)) - 73.4) < 1e-9);
});

test("formatHours renders h/m, rounding minutes to nearest 5", () => {
  assert.equal(formatHours(6), "6h");
  assert.equal(formatHours(7.4), "7h 25m");
  assert.equal(formatHours(0.5), "30m");
  assert.equal(formatHours(12), "12h");
});
