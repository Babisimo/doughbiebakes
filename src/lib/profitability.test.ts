import assert from "node:assert/strict";
import { test } from "node:test";

import {
  componentCostCents,
  componentsCostCents,
  computeProfitability,
  productCostCents,
  recipeCostCents,
  type LoafLine,
} from "./profitability.ts";

function line(over: Partial<LoafLine> = {}): LoafLine {
  return {
    slug: over.slug ?? "classic",
    name: over.name ?? "Classic",
    units: over.units ?? 10,
    listPriceCents: over.listPriceCents ?? 1200,
    salePriceCents: over.salePriceCents ?? 1200,
    unitCostCents: over.unitCostCents ?? 300,
    ...over,
  };
}

test("basic revenue, cost, profit, ROI in integer cents", () => {
  const r = computeProfitability({
    lines: [line({ units: 10, listPriceCents: 1200, salePriceCents: 1200, unitCostCents: 300 })],
    fixedCosts: [{ name: "Gas", cents: 1500 }],
  });
  assert.equal(r.revenueCents, 12000); // 10 × 1200
  assert.equal(r.variableCostCents, 3000); // 10 × 300
  assert.equal(r.fixedCostCents, 1500);
  assert.equal(r.totalCostCents, 4500);
  assert.equal(r.netProfitCents, 7500); // 12000 − 4500
  assert.equal(r.roiRatio, 7500 / 4500);
  assert.equal(r.grossMarginRatio, (12000 - 3000) / 12000);
  assert.equal(r.unitsTotal, 10);
});

test("favors: charging below list shows up as money given away", () => {
  // 5 loaves listed at $12, given to regulars for $10 each.
  const r = computeProfitability({
    lines: [line({ units: 5, listPriceCents: 1200, salePriceCents: 1000, unitCostCents: 300 })],
    fixedCosts: [],
  });
  assert.equal(r.revenueCents, 5000); // actual money in
  assert.equal(r.listValueCents, 6000); // full-price value
  assert.equal(r.favorsCents, 1000); // $10 given away across the 5
});

test("break-even revenue uses the contribution-margin ratio", () => {
  // CMR = (1000 − 200)/1000 = 0.8 ; fixed 4000 → break-even 5000.
  const r = computeProfitability({
    lines: [line({ units: 10, listPriceCents: 1000, salePriceCents: 1000, unitCostCents: 200 })],
    fixedCosts: [{ name: "Booth", cents: 4000 }],
  });
  assert.equal(r.contributionMarginRatio, 0.8);
  assert.equal(r.breakEvenRevenueCents, 5000);
});

test("no revenue → ratios are null, not misleading zeros", () => {
  const r = computeProfitability({ lines: [], fixedCosts: [{ name: "Rent", cents: 5000 }] });
  assert.equal(r.revenueCents, 0);
  assert.equal(r.grossMarginRatio, null);
  assert.equal(r.contributionMarginRatio, null);
  assert.equal(r.breakEvenRevenueCents, null); // can't break even with no sellable mix
  assert.equal(r.netProfitCents, -5000);
  assert.equal(r.roiRatio, -1); // −5000 net / 5000 fixed cost basis
});

test("losing money on every unit → no finite break-even", () => {
  // Sale price below cost: contribution margin negative.
  const r = computeProfitability({
    lines: [line({ units: 4, listPriceCents: 500, salePriceCents: 500, unitCostCents: 800 })],
    fixedCosts: [{ name: "x", cents: 1000 }],
  });
  assert.ok((r.contributionMarginRatio ?? 0) < 0);
  assert.equal(r.breakEvenRevenueCents, null);
});

test("cost builder: by-weight, by-count, and fraction-of-package all convert", () => {
  // Cheddar: $8.00 family block, 32 oz, use 2 oz → $0.50.
  assert.equal(
    componentCostCents({ name: "Cheddar", packagePriceCents: 800, packageQty: 32, usedQty: 2 }),
    50,
  );
  // Jalapeños: $2.99 bag of ~10, use 1 → $0.30.
  assert.equal(
    componentCostCents({ name: "Jalapeño", packagePriceCents: 299, packageQty: 10, usedQty: 1 }),
    30,
  );
  // Pepperoni: $4.99 package, use 1/6 (qty 6, used 1) → $0.83.
  assert.equal(
    componentCostCents({ name: "Pepperoni", packagePriceCents: 499, packageQty: 6, usedQty: 1 }),
    83,
  );
});

test("cost builder: missing/zero inputs cost nothing; totals sum", () => {
  assert.equal(componentCostCents({ name: "x", packagePriceCents: 0, packageQty: 10, usedQty: 1 }), 0);
  assert.equal(componentCostCents({ name: "x", packagePriceCents: 500, packageQty: 0, usedQty: 1 }), 0);
  assert.equal(
    componentsCostCents([
      { name: "flour", packagePriceCents: 1999, packageQty: 9072, usedQty: 550 }, // ~$1.21
      { name: "salt", packagePriceCents: 799, packageQty: 2268, usedQty: 10 }, // ~$0.04
    ]),
    121 + 4,
  );
});

test("recipeCostCents sums priced lines and skips unpriced ones", () => {
  const cost = recipeCostCents([
    { qtyPerLoaf: 550, ingredient: { packagePriceCents: 1999, packageQty: 9072 } }, // flour ~$1.21
    { qtyPerLoaf: 10, ingredient: { packagePriceCents: 799, packageQty: 2268 } }, // salt ~$0.04
    { qtyPerLoaf: 5, ingredient: null }, // not picked yet → ignored
  ]);
  assert.equal(cost, 121 + 4);
});

test("productCostCents prefers a priced recipe, else the flat field", () => {
  // Recipe present and priced → use it.
  assert.equal(
    productCostCents({
      defaultCostCents: 999,
      recipe: [{ qtyPerLoaf: 32, ingredient: { packagePriceCents: 800, packageQty: 32 } }],
    }),
    800,
  );
  // Recipe present but nothing priced → fall back to flat.
  assert.equal(
    productCostCents({ defaultCostCents: 125, recipe: [{ qtyPerLoaf: 5, ingredient: null }] }),
    125,
  );
  // No recipe → flat field.
  assert.equal(productCostCents({ defaultCostCents: 125 }), 125);
  // Nothing at all → 0.
  assert.equal(productCostCents({}), 0);
});

test("zero/negative units are ignored", () => {
  const r = computeProfitability({
    lines: [line({ units: 0 }), line({ units: -3 }), line({ units: 2, salePriceCents: 1000, unitCostCents: 100 })],
    fixedCosts: [],
  });
  assert.equal(r.unitsTotal, 2);
  assert.equal(r.revenueCents, 2000);
});
