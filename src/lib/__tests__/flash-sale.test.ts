import assert from "node:assert/strict";
import { test } from "node:test";

import { flashSaleStatus } from "../flash-sale.ts";
import type { Drop } from "../types.ts";

const NOW = new Date("2026-06-23T12:00:00.000Z");
const PAST = "2026-06-23T10:00:00.000Z";
const FUTURE = "2026-06-23T14:00:00.000Z";

function drop(over: Partial<Drop>): Drop {
  return {
    id: "d1",
    slug: "d1",
    title: "Test Drop",
    status: "open",
    lineItems: [],
    ...over,
  };
}

test("inactive when no flashSale present", () => {
  const s = flashSaleStatus(drop({}), NOW);
  assert.deepEqual(s, { active: false, percentOff: 0 });
});

test("inactive when null drop", () => {
  assert.equal(flashSaleStatus(null, NOW).active, false);
});

test("inactive when disabled", () => {
  const s = flashSaleStatus(
    drop({ flashSale: { enabled: false, percentOff: 20, endsAt: FUTURE } }),
    NOW,
  );
  assert.equal(s.active, false);
  assert.equal(s.percentOff, 0);
});

test("active when enabled, within window, drop open, no startsAt", () => {
  const s = flashSaleStatus(
    drop({ flashSale: { enabled: true, percentOff: 20, endsAt: FUTURE, headline: "Surprise!" } }),
    NOW,
  );
  assert.equal(s.active, true);
  assert.equal(s.percentOff, 20);
  assert.equal(s.endsAt, FUTURE);
  assert.equal(s.headline, "Surprise!");
});

test("active when now is between startsAt and endsAt", () => {
  const s = flashSaleStatus(
    drop({ flashSale: { enabled: true, percentOff: 15, startsAt: PAST, endsAt: FUTURE } }),
    NOW,
  );
  assert.equal(s.active, true);
});

test("inactive before startsAt", () => {
  const s = flashSaleStatus(
    drop({ flashSale: { enabled: true, percentOff: 15, startsAt: FUTURE, endsAt: FUTURE } }),
    NOW,
  );
  assert.equal(s.active, false);
});

test("inactive after endsAt", () => {
  const s = flashSaleStatus(
    drop({ flashSale: { enabled: true, percentOff: 15, endsAt: PAST } }),
    NOW,
  );
  assert.equal(s.active, false);
});

test("inactive when endsAt missing", () => {
  const s = flashSaleStatus(
    drop({ flashSale: { enabled: true, percentOff: 15 } as Drop["flashSale"] }),
    NOW,
  );
  assert.equal(s.active, false);
});

test("inactive when drop is not open (announced)", () => {
  const s = flashSaleStatus(
    drop({
      status: "open",
      ordersOpenAt: FUTURE, // effective status becomes "announced"
      flashSale: { enabled: true, percentOff: 20, endsAt: FUTURE },
    }),
    NOW,
  );
  assert.equal(s.active, false);
});

test("inactive when drop sold out", () => {
  const s = flashSaleStatus(
    drop({ status: "soldout", flashSale: { enabled: true, percentOff: 20, endsAt: FUTURE } }),
    NOW,
  );
  assert.equal(s.active, false);
});
