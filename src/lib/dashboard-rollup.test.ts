import assert from "node:assert/strict";
import { test } from "node:test";

import type { DropFinancials } from "./types.ts";
import { isoWeek, rollupFinancials, totalFinancials } from "./dashboard-rollup.ts";

function snap(over: Partial<DropFinancials> & { id: string }): DropFinancials {
  return {
    dropId: over.id,
    dropTitle: over.dropTitle ?? over.id,
    periodDate: over.periodDate,
    revenueCents: over.revenueCents ?? 0,
    listValueCents: over.listValueCents ?? 0,
    favorsCents: over.favorsCents ?? 0,
    variableCostCents: over.variableCostCents ?? 0,
    fixedCostCents: over.fixedCostCents ?? 0,
    netProfitCents: over.netProfitCents ?? 0,
    unitsTotal: over.unitsTotal ?? 0,
    actualCollectedCents: over.actualCollectedCents ?? 0,
    ...over,
  };
}

test("isoWeek matches known ISO-8601 values", () => {
  // 2026-01-01 is a Thursday → ISO week 1 of 2026.
  assert.deepEqual(isoWeek(new Date("2026-01-01T12:00:00")), { year: 2026, week: 1 });
  // 2027-01-01 is a Friday → still week 53 of the 2026 ISO year.
  assert.equal(isoWeek(new Date("2027-01-01T12:00:00")).year, 2026);
});

test("monthly rollup groups by calendar month, newest first", () => {
  const rows = [
    snap({ id: "a", periodDate: "2026-06-05T10:00:00", revenueCents: 1000, netProfitCents: 400, unitsTotal: 5 }),
    snap({ id: "b", periodDate: "2026-06-20T10:00:00", revenueCents: 2000, netProfitCents: 600, unitsTotal: 8 }),
    snap({ id: "c", periodDate: "2026-05-10T10:00:00", revenueCents: 500, netProfitCents: 100, unitsTotal: 2 }),
  ];
  const r = rollupFinancials(rows, "month");
  assert.equal(r.length, 2);
  assert.equal(r[0].key, "2026-06"); // June first (newest)
  assert.equal(r[0].revenueCents, 3000);
  assert.equal(r[0].netProfitCents, 1000);
  assert.equal(r[0].unitsTotal, 13);
  assert.equal(r[0].drops.length, 2);
  assert.equal(r[1].key, "2026-05");
});

test("weekly rollup splits adjacent weeks; totalCost = variable + fixed", () => {
  const rows = [
    snap({ id: "a", periodDate: "2026-06-02T10:00:00", variableCostCents: 300, fixedCostCents: 100 }),
    snap({ id: "b", periodDate: "2026-06-09T10:00:00", variableCostCents: 200, fixedCostCents: 50 }),
  ];
  const r = rollupFinancials(rows, "week");
  assert.equal(r.length, 2);
  assert.equal(r[0].totalCostCents, 250); // newer week (Jun 9)
  assert.equal(r[1].totalCostCents, 400);
});

test("snapshots with no date go to an Undated bucket, never dropped", () => {
  const rows = [snap({ id: "x", revenueCents: 100 }), snap({ id: "y", periodDate: "bad-date", revenueCents: 50 })];
  const r = rollupFinancials(rows, "month");
  assert.equal(r.length, 1);
  assert.equal(r[0].key, "undated");
  assert.equal(r[0].revenueCents, 150);
});

test("totalFinancials sums everything", () => {
  const t = totalFinancials([
    snap({ id: "a", revenueCents: 1000, variableCostCents: 300, fixedCostCents: 100, netProfitCents: 600, unitsTotal: 5 }),
    snap({ id: "b", revenueCents: 500, variableCostCents: 100, fixedCostCents: 0, netProfitCents: 400, unitsTotal: 3 }),
  ]);
  assert.equal(t.revenueCents, 1500);
  assert.equal(t.totalCostCents, 500);
  assert.equal(t.netProfitCents, 1000);
  assert.equal(t.unitsTotal, 8);
});
