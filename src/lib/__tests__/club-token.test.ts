import assert from "node:assert/strict";
import { test } from "node:test";

import {
  signClubMemberToken,
  verifyClubMemberToken,
} from "../club-token.ts";

process.env.CLUB_LINK_SECRET ||= "test-secret-at-least-16-chars-long";

test("club member token round-trips", () => {
  const t = signClubMemberToken("cus_ABC123");
  assert.equal(verifyClubMemberToken("cus_ABC123", t), true);
});

test("club member token rejects a different customer", () => {
  const t = signClubMemberToken("cus_ABC123");
  assert.equal(verifyClubMemberToken("cus_XYZ999", t), false);
});

test("club member token rejects garbage/empty", () => {
  assert.equal(verifyClubMemberToken("cus_ABC123", "deadbeef"), false);
  assert.equal(verifyClubMemberToken("cus_ABC123", ""), false);
  assert.equal(verifyClubMemberToken("", "deadbeef"), false);
});
