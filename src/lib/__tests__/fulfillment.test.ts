import assert from "node:assert/strict";
import { test } from "node:test";

import {
  coerceStage,
  deriveDelay,
  isAdjacentTransition,
  isStage,
  next,
  prev,
  summarize,
} from "../fulfillment.ts";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-05-20T12:00:00.000Z");

test("next/prev walk the ladder and saturate at the ends", () => {
  assert.equal(next("new"), "baking");
  assert.equal(next("baking"), "ready");
  assert.equal(next("ready"), "sent");
  assert.equal(next("sent"), null);
  assert.equal(prev("sent"), "ready");
  assert.equal(prev("new"), null);
});

test("isStage / coerceStage", () => {
  assert.equal(isStage("baking"), true);
  assert.equal(isStage("nope"), false);
  assert.equal(isStage(undefined), false);
  assert.equal(coerceStage("ready"), "ready");
  assert.equal(coerceStage("garbage"), "new");
  assert.equal(coerceStage(null), "new");
});

test("isAdjacentTransition: one step either way only", () => {
  assert.equal(isAdjacentTransition("new", "baking"), true);
  assert.equal(isAdjacentTransition("baking", "new"), true);
  assert.equal(isAdjacentTransition("new", "ready"), false);
  assert.equal(isAdjacentTransition("new", "new"), false);
  assert.equal(isAdjacentTransition("new", "nope"), false);
  assert.equal(isAdjacentTransition("x", "baking"), false);
});

test("deriveDelay: sent is always done, even far past the date", () => {
  assert.equal(deriveDelay("sent", "2020-01-01T00:00:00.000Z", now), "done");
});

test("deriveDelay: missing/unparseable date → on-track", () => {
  assert.equal(deriveDelay("new", null, now), "on-track");
  assert.equal(deriveDelay("baking", undefined, now), "on-track");
  assert.equal(deriveDelay("new", "not-a-date", now), "on-track");
});

test("deriveDelay: ready is on-track even past the date", () => {
  assert.equal(
    deriveDelay("ready", "2026-05-19T00:00:00.000Z", now),
    "on-track",
  );
});

test("deriveDelay: past date + new/baking → behind", () => {
  assert.equal(deriveDelay("new", "2026-05-20T00:00:00.000Z", now), "behind");
  assert.equal(
    deriveDelay("baking", "2026-05-19T00:00:00.000Z", now),
    "behind",
  );
  // exact boundary: t === due → behind (condition is `t >= due`)
  assert.equal(deriveDelay("new", now.toISOString(), now), "behind");
});

test("deriveDelay: within 24h (not past) + new/baking → due-soon", () => {
  const soon = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
  assert.equal(deriveDelay("new", soon, now), "due-soon");
  assert.equal(deriveDelay("baking", soon, now), "due-soon");
  // exact 24h boundary: due - t === DAY_MS → due-soon (condition is `<= DAY_MS`)
  const exactDay = new Date(now.getTime() + DAY).toISOString();
  assert.equal(deriveDelay("new", exactDay, now), "due-soon");
  // 1ms past the 24h window → on-track
  const justOver = new Date(now.getTime() + DAY + 1).toISOString();
  assert.equal(deriveDelay("new", justOver, now), "on-track");
});

test("deriveDelay: comfortably before the date → on-track", () => {
  const later = new Date(now.getTime() + 5 * DAY).toISOString();
  assert.equal(deriveDelay("new", later, now), "on-track");
});

test("summarize: per-stage counts + behind/dueSoon; empty → zeros", () => {
  const soon = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();
  const past = "2026-05-19T00:00:00.000Z";
  const s = summarize(
    [
      { fulfillmentStatus: "new" },
      { fulfillmentStatus: "baking" },
      { fulfillmentStatus: "ready" },
      { fulfillmentStatus: "sent" },
    ],
    past,
    now,
  );
  assert.deepEqual(s.byStage, { new: 1, baking: 1, ready: 1, sent: 1 });
  assert.equal(s.behind, 2);
  assert.equal(s.dueSoon, 0);

  const s2 = summarize([{ fulfillmentStatus: "new" }], soon, now);
  assert.equal(s2.dueSoon, 1);
  assert.equal(s2.behind, 0);

  const empty = summarize([], past, now);
  assert.deepEqual(empty.byStage, { new: 0, baking: 0, ready: 0, sent: 0 });
  assert.equal(empty.behind, 0);
  assert.equal(empty.dueSoon, 0);
});
