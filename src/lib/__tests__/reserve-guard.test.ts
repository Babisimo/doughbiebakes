import assert from "node:assert/strict";
import { test } from "node:test";

import { looksLikeBot, reservationCapError } from "../reserve-guard.ts";

test("cap: accepts a normal reservation", () => {
  assert.equal(
    reservationCapError("Ada", "ada@example.com", "555-1212", [{ quantity: 2 }]),
    null,
  );
});

test("cap: rejects an over-long name", () => {
  assert.equal(
    typeof reservationCapError("x".repeat(81), "a@b.co", "555", [{ quantity: 1 }]),
    "string",
  );
});

test("cap: rejects too many total loaves", () => {
  const msg = reservationCapError("Ada", "a@b.co", "555", [
    { quantity: 4 },
    { quantity: 4 },
  ]);
  assert.equal(typeof msg, "string");
});

test("cap: rejects too many distinct items", () => {
  const items = Array.from({ length: 7 }, () => ({ quantity: 1 }));
  assert.equal(typeof reservationCapError("Ada", "a@b.co", "555", items), "string");
});

test("bot: honeypot filled is a bot", () => {
  assert.equal(looksLikeBot("buy-cheap", 9000), true);
});

test("bot: too-fast submit is a bot", () => {
  assert.equal(looksLikeBot("", 800), true);
});

test("bot: normal submit is not a bot", () => {
  assert.equal(looksLikeBot("", 9000), false);
});

test("bot: missing/NaN timing fails open (not a bot)", () => {
  assert.equal(looksLikeBot("", Number.NaN), false);
});
