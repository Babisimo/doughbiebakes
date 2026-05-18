import assert from "node:assert/strict";
import { test } from "node:test";

import {
  signReservationToken,
  verifyReservationToken,
} from "../reservation-token.ts";

process.env.CLUB_LINK_SECRET ||= "test-secret-at-least-16-chars-long";

test("sign then verify round-trips", () => {
  const t = signReservationToken("res123", "approve");
  assert.equal(verifyReservationToken("res123", "approve", t), true);
});

test("rejects wrong action", () => {
  const t = signReservationToken("res123", "approve");
  assert.equal(verifyReservationToken("res123", "decline", t), false);
});

test("rejects wrong id", () => {
  const t = signReservationToken("res123", "approve");
  assert.equal(verifyReservationToken("resXXX", "approve", t), false);
});

test("rejects tampered/garbage token", () => {
  assert.equal(verifyReservationToken("res123", "approve", "deadbeef"), false);
  assert.equal(verifyReservationToken("res123", "approve", ""), false);
});

test("verify action round-trips and is distinct", () => {
  const v = signReservationToken("res123", "verify");
  assert.equal(verifyReservationToken("res123", "verify", v), true);
  assert.equal(verifyReservationToken("res123", "approve", v), false);
});
