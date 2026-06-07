// Bulk-fermentation timing model, grounded in The Sourdough Journey's
// "Dough Temping Guide" (© 2024) and the "Bulk-O-Matic" guide (v3.0, 2023).
//
// The source is calibrated to ONE standard recipe:
//   90% bread flour / 10% whole wheat, 75% hydration, 2% salt, 20% starter,
//   with bulk timed from the moment the starter is added to the dough.
//
// Two ideas drive the model:
//   1. Warmer dough ferments faster AND should be pulled at a *lower* % rise,
//      because it keeps fermenting through shaping and final proof — you have
//      to "hit the brakes" earlier. Cooler dough is pulled at a higher % rise
//      over a longer time. That temperature → (time, target-rise) relationship
//      is the lookup table below.
//   2. Most of the rise happens late in bulk, so rise-vs-time is an
//      accelerating curve, not a straight line.
//
// Time is the *least* reliable indicator of doneness — every number here is a
// planning starting point, not a verdict. Watch the dough, not the clock.

export const STANDARD_STARTER_PCT = 20;

export type TempUnit = "F" | "C";

type GuideRow = { tempF: number; hours: number; risePct: number };

// The Dough Temping Guide, at the calibrated 20% starter. `hours` is the
// approximate time to reach `risePct` — the recommended pull point for that
// dough temperature. Ordered warm → cool.
export const DOUGH_TEMPING_GUIDE: readonly GuideRow[] = [
  { tempF: 80, hours: 5.5, risePct: 30 },
  { tempF: 79, hours: 5.5, risePct: 30 },
  { tempF: 78, hours: 6, risePct: 40 },
  { tempF: 77, hours: 6, risePct: 40 },
  { tempF: 76, hours: 7, risePct: 50 },
  { tempF: 75, hours: 7, risePct: 50 },
  { tempF: 74, hours: 8, risePct: 55 },
  { tempF: 73, hours: 9, risePct: 60 },
  { tempF: 72, hours: 10, risePct: 65 },
  { tempF: 71, hours: 11, risePct: 70 },
  { tempF: 70, hours: 12, risePct: 75 },
  { tempF: 69, hours: 13, risePct: 80 },
  { tempF: 68, hours: 14, risePct: 85 },
  { tempF: 67, hours: 15, risePct: 90 },
  { tempF: 66, hours: 16, risePct: 95 },
  // Guide lists "16+ Hrs, 100%+"; we anchor it at 16.5h / 100%.
  { tempF: 65, hours: 16.5, risePct: 100 },
];

export const TEMP_MIN_F = 65;
export const TEMP_MAX_F = 80;

export const fToC = (f: number): number => ((f - 32) * 5) / 9;
export const cToF = (c: number): number => (c * 9) / 5 + 32;

// How sharply rise accelerates over bulk. >1 concentrates the rise late,
// matching "most of the rise happens in the last 15–20% of the duration."
const RISE_CURVE_EXPONENT = 3;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));

// Interpolate the guide for an arbitrary dough temperature (°F). Clamps to the
// table's bounds (65–80°F) outside that range.
export function recommendedForTemp(tempF: number): {
  hours: number;
  risePct: number;
} {
  const rows = DOUGH_TEMPING_GUIDE;
  const warmest = rows[0];
  const coolest = rows[rows.length - 1];
  if (tempF >= warmest.tempF)
    return { hours: warmest.hours, risePct: warmest.risePct };
  if (tempF <= coolest.tempF)
    return { hours: coolest.hours, risePct: coolest.risePct };

  for (let i = 0; i < rows.length - 1; i++) {
    const hi = rows[i]; // warmer row
    const lo = rows[i + 1]; // cooler row
    if (tempF <= hi.tempF && tempF >= lo.tempF) {
      const t = (tempF - lo.tempF) / (hi.tempF - lo.tempF); // 0 at lo … 1 at hi
      return {
        hours: lerp(lo.hours, hi.hours, t),
        risePct: lerp(lo.risePct, hi.risePct, t),
      };
    }
  }
  return { hours: coolest.hours, risePct: coolest.risePct }; // unreachable
}

export type ProofState = "under" | "on-target" | "over";

export type FermentEstimate = {
  /** Estimated hours to reach the target rise at this temp + starter. */
  hours: number;
  /** Recommended pull point for this temperature (% rise). */
  recommendedRisePct: number;
  /** Approx hours to the recommended pull point, at the calibrated 20% starter. */
  recommendedHours: number;
  /** The % rise this estimate was computed for. */
  targetRisePct: number;
  /** Where the chosen target sits relative to the recommendation. */
  proofState: ProofState;
  /** True when the temperature is outside the guide's 65–80°F range. */
  outOfRange: boolean;
  starterPct: number;
};

export type FermentInput = {
  tempF: number;
  /** Defaults to the recommended pull point for the temperature. */
  targetRisePct?: number;
  /** Defaults to the calibrated 20%. */
  starterPct?: number;
};

// Starter is a *rate* lever, not a *target* lever: more starter → faster bulk.
// The source quantifies this only loosely ("a weak starter can take ~2× as
// long"), so this is a gentle, deliberately-approximate adjustment around the
// calibrated 20%. At exactly 20% the multiplier is 1 (no effect).
export function starterTimeMultiplier(starterPct: number): number {
  const pct = clamp(starterPct, 2, 60);
  return clamp((STANDARD_STARTER_PCT / pct) ** 0.7, 0.45, 2.5);
}

export function estimateFermentation(input: FermentInput): FermentEstimate {
  const { tempF } = input;
  const starterPct = input.starterPct ?? STANDARD_STARTER_PCT;
  const outOfRange = tempF > TEMP_MAX_F || tempF < TEMP_MIN_F;

  const rec = recommendedForTemp(tempF);
  const targetRisePct = input.targetRisePct ?? rec.risePct;

  // Rise-vs-time anchored at the recommended (time, rise) point:
  //   rise(t) = recRise · (t / recHours) ^ p
  // Invert to get the time to reach an arbitrary rise, then scale by starter.
  const riseRatio = targetRisePct / rec.risePct;
  const baseHours = rec.hours * riseRatio ** (1 / RISE_CURVE_EXPONENT);
  const hours = baseHours * starterTimeMultiplier(starterPct);

  let proofState: ProofState = "on-target";
  if (targetRisePct < rec.risePct * 0.85) proofState = "under";
  else if (targetRisePct > rec.risePct * 1.15) proofState = "over";

  return {
    hours,
    recommendedRisePct: rec.risePct,
    recommendedHours: rec.hours,
    targetRisePct,
    proofState,
    outOfRange,
    starterPct,
  };
}

// Format hours as "7h 25m", rounding minutes to the nearest 5.
export function formatHours(hours: number): string {
  const totalMin = Math.round((hours * 60) / 5) * 5;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
