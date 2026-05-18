import assert from "node:assert/strict";
import { test } from "node:test";

import { __resetRateLimit, rateLimited } from "../rate-limit.ts";

test("allows up to max within the window, blocks the next", () => {
  __resetRateLimit();
  const t = 1_000_000;
  assert.equal(rateLimited("ip1", 3, 600_000, t), false); // 1
  assert.equal(rateLimited("ip1", 3, 600_000, t + 1), false); // 2
  assert.equal(rateLimited("ip1", 3, 600_000, t + 2), false); // 3
  assert.equal(rateLimited("ip1", 3, 600_000, t + 3), true); // 4 -> blocked
});

test("window expiry frees the key", () => {
  __resetRateLimit();
  const t = 2_000_000;
  for (let i = 0; i < 4; i++) rateLimited("ip2", 3, 600_000, t + i);
  assert.equal(rateLimited("ip2", 3, 600_000, t + 600_001), false);
});

test("keys are independent", () => {
  __resetRateLimit();
  const t = 3_000_000;
  for (let i = 0; i < 4; i++) rateLimited("a", 3, 600_000, t + i);
  assert.equal(rateLimited("b", 3, 600_000, t + 5), false);
});
