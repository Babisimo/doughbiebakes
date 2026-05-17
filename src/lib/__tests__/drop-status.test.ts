import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dropRecencyKey,
  effectiveDropStatus,
  isCurrentDrop,
  isPreviousDrop,
} from "../drop-status.ts";
import type { Drop } from "../types.ts";

const NOW = new Date("2026-05-17T12:00:00.000Z");
const PAST = "2026-05-10T12:00:00.000Z";
const FUTURE = "2026-05-24T12:00:00.000Z";

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

test("draft stays draft regardless of dates", () => {
  assert.equal(
    effectiveDropStatus(drop({ status: "draft", ordersOpenAt: PAST }), NOW),
    "draft",
  );
});

test("manual closed stays closed", () => {
  assert.equal(
    effectiveDropStatus(drop({ status: "closed", ordersCloseAt: FUTURE }), NOW),
    "closed",
  );
});

test("no dates => behaves exactly as stored status", () => {
  for (const s of ["announced", "open", "soldout"] as const) {
    assert.equal(effectiveDropStatus(drop({ status: s }), NOW), s);
  }
});

test("announced auto-opens once ordersOpenAt has passed", () => {
  assert.equal(
    effectiveDropStatus(
      drop({ status: "announced", ordersOpenAt: PAST, ordersCloseAt: FUTURE }),
      NOW,
    ),
    "open",
  );
});

test("announced stays announced before ordersOpenAt", () => {
  assert.equal(
    effectiveDropStatus(
      drop({ status: "announced", ordersOpenAt: FUTURE }),
      NOW,
    ),
    "announced",
  );
});

test("open auto-closes once ordersCloseAt has passed", () => {
  assert.equal(
    effectiveDropStatus(
      drop({ status: "open", ordersOpenAt: PAST, ordersCloseAt: PAST }),
      NOW,
    ),
    "closed",
  );
});

test("open before its ordersOpenAt is treated as announced", () => {
  assert.equal(
    effectiveDropStatus(
      drop({ status: "open", ordersOpenAt: FUTURE, ordersCloseAt: FUTURE }),
      NOW,
    ),
    "announced",
  );
});

test("soldout stays soldout until close, then closed", () => {
  assert.equal(
    effectiveDropStatus(
      drop({ status: "soldout", ordersCloseAt: FUTURE }),
      NOW,
    ),
    "soldout",
  );
  assert.equal(
    effectiveDropStatus(
      drop({ status: "soldout", ordersCloseAt: PAST }),
      NOW,
    ),
    "closed",
  );
});

test("announced past close (never opened) is closed", () => {
  assert.equal(
    effectiveDropStatus(
      drop({ status: "announced", ordersOpenAt: PAST, ordersCloseAt: PAST }),
      NOW,
    ),
    "closed",
  );
});

test("predicates partition current vs previous", () => {
  const live = drop({ status: "open", ordersCloseAt: FUTURE });
  const ended = drop({ status: "open", ordersCloseAt: PAST });
  assert.equal(isCurrentDrop(live, NOW), true);
  assert.equal(isPreviousDrop(live, NOW), false);
  assert.equal(isCurrentDrop(ended, NOW), false);
  assert.equal(isPreviousDrop(ended, NOW), true);
});

test("dropRecencyKey prefers close, then pickup, then createdAt", () => {
  assert.equal(
    dropRecencyKey(drop({ ordersCloseAt: PAST, pickupOrShipDate: FUTURE })),
    new Date(PAST).getTime(),
  );
  assert.equal(
    dropRecencyKey(drop({ pickupOrShipDate: FUTURE })),
    new Date(FUTURE).getTime(),
  );
  assert.equal(
    dropRecencyKey(drop({ createdAt: PAST })),
    new Date(PAST).getTime(),
  );
  assert.equal(dropRecencyKey(drop({})), 0);
});
