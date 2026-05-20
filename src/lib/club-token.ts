import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signs a Bread Club magic link. Token format is a hex HMAC-SHA256 of
 * `${email.toLowerCase()}|${dropId}` keyed by CLUB_LINK_SECRET. Verifying with
 * timingSafeEqual avoids leaking valid-token-prefix information.
 */
function getSecret(): string {
  const secret = process.env.CLUB_LINK_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "CLUB_LINK_SECRET is not set (or too short) — Bread Club links cannot be signed.",
    );
  }
  return secret;
}

function payload(email: string, dropId: string): string {
  return `${email.trim().toLowerCase()}|${dropId}`;
}

export function signClubToken(email: string, dropId: string): string {
  return createHmac("sha256", getSecret()).update(payload(email, dropId)).digest("hex");
}

export function verifyClubToken(
  email: string,
  dropId: string,
  token: string,
): boolean {
  if (!email || !dropId || !token) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(signClubToken(email, dropId), "hex");
  } catch {
    return false;
  }
  let actual: Buffer;
  try {
    actual = Buffer.from(token, "hex");
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Member-scoped magic-link token (cancel, card-update) — HMAC of the Stripe
 * customer id, distinct namespace from the per-drop token via the `member:`
 * prefix. */
export function signClubMemberToken(customerId: string): string {
  return createHmac("sha256", getSecret())
    .update(`member:${customerId}`)
    .digest("hex");
}

export function verifyClubMemberToken(customerId: string, token: string): boolean {
  if (!customerId || !token) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(signClubMemberToken(customerId), "hex");
  } catch {
    return false;
  }
  let actual: Buffer;
  try {
    actual = Buffer.from(token, "hex");
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
