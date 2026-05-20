import assert from "node:assert/strict";
import { test } from "node:test";

import { dropChargeCents, shouldChargeMember } from "../club-billing.ts";

test("dropChargeCents: $10 pickup, $22 ship", () => {
  assert.equal(dropChargeCents("pickup"), 1000);
  assert.equal(dropChargeCents("ship"), 2200);
});

test("shouldChargeMember: charge a member with no selection (silent = in)", () => {
  assert.equal(shouldChargeMember(null, null), true);
});

test("shouldChargeMember: charge a member who picked a loaf", () => {
  assert.equal(shouldChargeMember({ skipped: false }, null), true);
});

test("shouldChargeMember: do NOT charge a skipped member", () => {
  assert.equal(shouldChargeMember({ skipped: true }, null), false);
});

test("shouldChargeMember: do NOT re-charge an already-paid member", () => {
  assert.equal(shouldChargeMember(null, "paid"), false);
  assert.equal(shouldChargeMember({ skipped: false }, "paid"), false);
});

test("shouldChargeMember: DO retry a previously-failed member", () => {
  assert.equal(shouldChargeMember(null, "failed"), true);
  assert.equal(shouldChargeMember({ skipped: false }, "failed"), true);
});
